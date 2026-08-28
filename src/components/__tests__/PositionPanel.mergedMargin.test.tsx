import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PositionPanel } from '@/components/PositionPanel';
import type { Position } from '@/types/trading';
import { firstLiquidationPrice, positionLiquidationPrice } from '@/lib/positionGroupRisk';
import { formatPrice } from '@/lib/formatters';

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
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

const FACE = 10;
const MARK = 0.154646;

/** 用户截图那张卡的两条腿：Σn·E 与 Σn/E 一起唯一确定了它们。 */
const leg = (id: string, contracts: number, entryPrice: number, mode: 'isolated' | 'cross' = 'isolated'): Position => {
  const m = contracts * FACE / 10;
  return {
    id, side: 'LONG', quantity: contracts, contracts, contractSizeUsd: FACE,
    settlementMode: 'coin', settlementAsset: 'RED', entryPrice, leverage: 10,
    marginMode: mode, openTime: 0,
    margin: m, isolatedMargin: mode === 'isolated' ? m : undefined,
    marginCoin: m / entryPrice,
  } as Position;
};
const A = leg('a', 52_466, 0.138395);
const B = leg('b', 52_467, 0.156118);

function renderPanel(positions: Position[], onAdjustMargin = vi.fn()) {
  render(
    <PositionPanel
      positionsMap={{ REDUSD: positions }}
      ordersMap={{}}
      tradeHistory={[]}
      priceMap={{ REDUSD: MARK }}
      activeSymbol="REDUSD"
      onClosePosition={vi.fn()}
      onCancelOrder={vi.fn()}
      onAdjustMargin={onAdjustMargin}
      availableBalance={4_281_950.6}
      activeTab="positions"
      onTabChange={vi.fn()}
    />,
  );
  return onAdjustMargin;
}

describe('合并持仓卡的保证金', () => {
  it('【回归】追加保证金按钮在「2 笔合并」的卡上也要在', () => {
    // 此前 children.length === 1 把整张合并卡的按钮挡掉了。
    renderPanel([A, B]);
    expect(screen.getByTestId('adjust-margin')).toBeInTheDocument();
  });

  it('单笔时按钮照旧在——合并逻辑不得动到单笔', () => {
    renderPanel([A]);
    expect(screen.getByTestId('adjust-margin')).toBeInTheDocument();
  });

  it('【回归】强平价写的是「最先撞线」的那一笔，不是拼出来的合成价', () => {
    // 合成价（把总量/总保证金/加权均价拼成一笔虚构仓位算出来的）是 0.134361 ——
    // 用户截图上就是这个数。真正先爆的是开仓价更高的那一腿。
    // 卡说还有 13.1% 空间，实际只有 7.9%，差的是现价的 5.26%。
    renderPanel([A, B]);
    const first = firstLiquidationPrice([A, B], 'LONG')!;
    const own = [A, B].map(p => positionLiquidationPrice(p)!);
    expect(first).toBeCloseTo(Math.max(...own), 9);

    expect(screen.getByText('强平价格（最先）')).toBeInTheDocument();
    expect(screen.getByText(formatPrice(first, 'REDUSD'))).toBeInTheDocument();
    expect(screen.queryByText('0.134361')).not.toBeInTheDocument();
    // 卡上的数必须比合成价更靠近现价（更保守）
    expect(first).toBeGreaterThan(0.134361);
  });

  it('混进一条全仓腿时不给按钮——分组键不含保证金模式，会并成同一张卡', () => {
    // 写到一半会被全仓那一腿顶回来，不如根本不出现。
    renderPanel([A, leg('c', 100, 0.15, 'cross')]);
    expect(screen.queryByTestId('adjust-margin')).not.toBeInTheDocument();
  });

  it('点开后按 id 下发分摊，两腿都拿到钱且总额等于填的数', () => {
    const onAdjustMargin = renderPanel([A, B]);
    fireEvent.click(screen.getByTestId('adjust-margin'));
    const amountBox = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(amountBox, { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: /确认|确定/ }));

    expect(onAdjustMargin).toHaveBeenCalledTimes(1);
    const [symbol, allocations] = onAdjustMargin.mock.calls[0];
    expect(symbol).toBe('REDUSD');
    expect(allocations.map((a: { positionId: string }) => a.positionId).sort()).toEqual(['a', 'b']);
    expect(allocations.reduce((s: number, a: { deltaUsd: number }) => s + a.deltaUsd, 0)).toBeCloseTo(100_000, 6);
  });
});
