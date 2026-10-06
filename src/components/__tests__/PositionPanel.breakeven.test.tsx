import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PositionPanel } from '@/components/PositionPanel';
import type { Position, TradeRecord } from '@/types/trading';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    setSymbolLeverage: vi.fn(), tradingMode: 'direct',
    setTradeHistory: vi.fn(), setBalance: vi.fn(),
  }),
}));
vi.mock('@/lib/journalApi', () => ({
  findUnreviewedJournalForClose: vi.fn(async () => null),
  listJournals: vi.fn(async () => []),
  listJournalsByTradeRecordId: vi.fn(async () => []),
  backfillJournalFromRecord: vi.fn(),
  getJournalById: vi.fn(),
  syncTradeRecordCorrectionToJournals: vi.fn(async () => []),
}));

/**
 * 【用户要求】仓位卡上「保本线 / 开仓均价」共用一格，点一下切换，默认保本线；已落袋利润只算镜像止盈。
 * 数字照 HEIUSDT 2026-06-25：开 7,000 万币 @0.161673，手动减仓 61% 落袋 +220,831.21，剩 2,730 万币。
 */
const OPENED = Date.parse('2026-06-25T23:58:00+08:00');
const REDUCED = Date.parse('2026-06-26T01:06:00+08:00');

const heiLong = (over: Partial<Position> = {}): Position => ({
  id: 'hei-position', side: 'LONG', symbol: 'HEIUSDT', quantity: 27_300_000, entryPrice: 0.161673,
  leverage: 10, margin: 441_367, marginMode: 'cross', settlementMode: 'usdt', settlementAsset: 'USDT',
  openTime: OPENED, fills: [{ id: 'hei-fill', openTime: OPENED, entryPrice: 0.161673, units: 27_300_000 }],
  ...over,
} as Position);

const reduce = (over: Partial<TradeRecord> = {}): TradeRecord => ({
  id: 'hei-reduce', symbol: 'HEIUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE', settlementMode: 'usdt',
  entryPrice: 0.161673, exitPrice: 0.166938, quantity: 42_700_000, leverage: 10, pnl: 220_831.21, fee: 0, slippage: 0,
  openTime: OPENED, closeTime: REDUCED, positionId: 'hei-position', fillId: 'hei-fill', exit_method: 'manual',
  ...over,
} as TradeRecord);

function renderPanel(positions: Position[], tradeHistory: TradeRecord[], price = 0.1725) {
  const symbol = (positions[0] as Position & { symbol: string }).symbol;
  return render(
    <PositionPanel
      positionsMap={{ [symbol]: positions }}
      ordersMap={{}}
      tradeHistory={tradeHistory}
      priceMap={{ [symbol]: price }}
      activeSymbol={symbol}
      onClosePosition={vi.fn()}
      onCancelOrder={vi.fn()}
      activeTab="positions"
      onTabChange={vi.fn()}
    />,
  );
}

const cell = () => screen.getByTestId('position-entry-cell');

describe('仓位卡：保本线 / 开仓均价共用一格', () => {
  it('默认显示保本线（手动减仓做的镜像止盈也算落袋）；点一下切成开仓均价，再点切回来', () => {
    renderPanel([heiLong()], [reduce()]);
    // 0.161673 − 220,831.21 ÷ 27,300,000 = 0.153584
    expect(cell()).toHaveAttribute('data-mode', 'breakeven');
    expect(cell()).toHaveTextContent('保本线');
    expect(cell()).toHaveTextContent('0.153584');
    expect(cell()).not.toHaveTextContent('0.161673');
    expect(cell().getAttribute('title')).toContain('镜像止盈已落袋 +220,831.21 USDT（1 笔');
    expect(cell().getAttribute('title')).toContain('点一下切换为「开仓均价」');

    fireEvent.click(cell());
    expect(cell()).toHaveAttribute('data-mode', 'entry');
    expect(cell()).toHaveTextContent('开仓均价');
    expect(cell()).toHaveTextContent('0.161673');
    expect(cell().getAttribute('title')).toContain('不扣已落袋的利润');
    expect(cell().getAttribute('aria-label')).toBe('开仓均价 0.161673，点击切换为保本线');

    fireEvent.click(cell());
    expect(cell()).toHaveTextContent('保本线');
    expect(cell()).toHaveTextContent('0.153584');
  });

  it('用镜像利润加仓之后：保本线按合并后的币数与均价重算（0.159009），真实均价是 0.164775', () => {
    const merged = heiLong({
      quantity: 38_300_000,
      entryPrice: (27_300_000 * 0.161673 + 11_000_000 * 0.172473) / 38_300_000,
      fills: [
        { id: 'hei-fill', openTime: OPENED, entryPrice: 0.161673, units: 27_300_000 },
        { id: 'hei-add-1', openTime: Date.parse('2026-06-26T01:32:00+08:00'), entryPrice: 0.172473, units: 11_000_000 },
      ],
    } as Partial<Position>);
    renderPanel([merged], [reduce()]);
    expect(cell()).toHaveTextContent('0.159009');
    fireEvent.click(cell());
    expect(cell()).toHaveTextContent('0.164775');
  });

  it('没有镜像止盈落袋：保本线就是开仓均价；亏着减仓、止损打掉的、别的仓位的盈利都不算', () => {
    const { unmount } = renderPanel([heiLong()], []);
    expect(cell()).toHaveTextContent('保本线');
    expect(cell()).toHaveTextContent('0.161673');
    expect(cell().getAttribute('title')).toContain('还没有镜像止盈落袋，保本线就是开仓均价');
    unmount();
    renderPanel([heiLong()], [
      reduce({ id: 'loss', pnl: -50_000 }),
      reduce({ id: 'stop', pnl: 30_000, exit_method: 'sl' }),
      reduce({ id: 'other', pnl: 80_000, positionId: 'closed-position', fillId: 'closed-fill' }),
    ]);
    expect(cell()).toHaveTextContent('0.161673');
  });

  it('空单：保本线在均价上方；切换是面板级的，同屏每张卡一起切', () => {
    const short = heiLong({ id: 'hei-short', side: 'SHORT', fills: [{ id: 'short-fill', openTime: OPENED, entryPrice: 0.161673, units: 27_300_000 }] } as Partial<Position>);
    renderPanel([heiLong(), short], [
      reduce(),
      reduce({ id: 'short-reduce', side: 'SHORT', positionId: 'hei-short', fillId: 'short-fill', pnl: 136_500, exitPrice: 0.1566 }),
    ]);
    const cells = screen.getAllByTestId('position-entry-cell');
    expect(cells).toHaveLength(2);
    const texts = cells.map(node => node.textContent ?? '');
    expect(texts.some(text => text.includes('0.153584'))).toBe(true);   // 多：0.161673 − 0.008089
    expect(texts.some(text => text.includes('0.166673'))).toBe(true);   // 空：0.161673 + 136,500 ÷ 27,300,000
    fireEvent.click(cells[0]);
    for (const node of screen.getAllByTestId('position-entry-cell')) {
      expect(node).toHaveAttribute('data-mode', 'entry');
      expect(node).toHaveTextContent('0.161673');
    }
  });

  it('币本位（反向合约）按币算：2,845 张 × 10 USD @2.8489，镜像落袋 150 币 → 保本线 = 28,450 ÷（9,986.31 + 150）', () => {
    const coin: Position = {
      id: 'ordi', side: 'LONG', symbol: 'ORDIUSD', quantity: 2_845, contracts: 2_845, entryPrice: 2.8489,
      leverage: 10, margin: 2_845, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'ORDI',
      contractSizeUsd: 10, openTime: OPENED, fills: [{ id: 'ordi-fill', openTime: OPENED, entryPrice: 2.8489, units: 2_845 }],
    } as Position;
    const cut = {
      id: 'ordi-reduce', symbol: 'ORDIUSD', side: 'LONG', type: 'MARKET', action: 'CLOSE', settlementMode: 'coin',
      entryPrice: 2.8489, exitPrice: 2.99, quantity: 4_000, contracts: 4_000, contractSizeUsd: 10, leverage: 10,
      pnl: 448.5, pnlCoin: 150, fee: 0, slippage: 0, openTime: OPENED, closeTime: REDUCED,
      positionId: 'ordi', fillId: 'ordi-fill', exit_method: 'manual',
    } as unknown as TradeRecord;
    renderPanel([coin], [cut], 2.992);
    const expected = 28_450 / (28_450 / 2.8489 + 150);
    expect(cell()).toHaveTextContent(expected.toFixed(4));
    expect(cell().getAttribute('title')).toContain('镜像止盈已落袋 +150.000000 ORDI');
    fireEvent.click(cell());
    expect(cell()).toHaveTextContent('2.8489');
  });
});
