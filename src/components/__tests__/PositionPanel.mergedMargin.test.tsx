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

  it('【回归】混进全仓腿时按钮**照样在**，只是只对逐仓腿生效', () => {
    // 分组键只有 symbol_side、不含保证金模式，全仓腿会并进同一张卡。
    // 因为一条腿不支持就把另一条腿明明支持的能力一起收走，是错的。
    const onAdjustMargin = renderPanel([A, B, leg('c', 100, 0.15, 'cross')], vi.fn());
    const btn = screen.getByTestId('adjust-margin') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: /确认|确定/ }));

    const [, allocations] = onAdjustMargin.mock.calls[0];
    // 全仓那条不在里面——它会被下游拒掉，而拒掉发生在已经写了一半的时候
    expect(allocations.map((a: { positionId: string }) => a.positionId).sort()).toEqual(['a', 'b']);
  });

  it('整张卡都是全仓时按钮置灰但保留，并说明原因', () => {
    // 全仓共用一个保证金池，单仓位追加在机制上就不存在。
    // 但要把原因说出来，而不是让按钮凭空消失。
    renderPanel([leg('c', 100, 0.15, 'cross'), leg('d', 200, 0.16, 'cross')]);
    const btn = screen.getByTestId('adjust-margin') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/全仓.*共用一个保证金池/);
  });

  it('三笔、四笔合并同样都有——「无论有几笔」不是只到两笔为止', () => {
    for (const n of [3, 4, 6]) {
      const legs = Array.from({ length: n }, (_, i) => leg(`p${i}`, 10_000 + i * 137, 0.13 + i * 0.004));
      const { unmount } = { unmount: () => {} };
      renderPanel(legs);
      expect((screen.getAllByTestId('adjust-margin')[0] as HTMLButtonElement).disabled).toBe(false);
      unmount();
      document.body.innerHTML = '';
    }
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
