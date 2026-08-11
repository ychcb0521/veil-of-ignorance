import { describe, expect, it } from 'vitest';
import type { FilledOrderSnapshot, PendingOrder, Position } from '@/types/trading';
import { earliestLongStopPrice } from '../longRiskAnchor';

const longPos = (id: string): Position => ({
  id, side: 'LONG', entryPrice: 100, quantity: 1, leverage: 5,
  marginMode: 'isolated', margin: 20,
} as Position);

const slOrder = (over: Partial<PendingOrder>): PendingOrder => ({
  id: over.id ?? 'o1', side: 'SHORT', type: 'CONDITIONAL', price: 0,
  stopPrice: 90, quantity: 1, leverage: 5, marginMode: 'isolated',
  status: 'PENDING', createdAt: 1000,
  reduceOnly: true, reducePositionSide: 'LONG', reduceKind: 'SL',
  linkedPositionId: 'p1',
  ...over,
} as PendingOrder);

const filledSl = (over: Partial<FilledOrderSnapshot>): FilledOrderSnapshot => ({
  id: over.id ?? 'f1', symbol: 'AUSDT', side: 'SHORT', reduceOnly: true,
  reduceKind: 'SL', linkedPositionId: 'p1', price: 89.8, triggerPrice: 90,
  quantity: 0.5, leverage: 5, createdAt: 500, filledAt: 2000,
  ...over,
} as FilledOrderSnapshot);

describe('earliestLongStopPrice', () => {
  it('取当前多单关联止损里 createdAt 最早那张的触发价', () => {
    const anchor = earliestLongStopPrice('AUSDT', [longPos('p1')], [
      slOrder({ id: 'late', stopPrice: 95, createdAt: 3000 }),
      slOrder({ id: 'first', stopPrice: 88, createdAt: 1000 }),
    ], []);
    expect(anchor).toBe(88);
  });

  it('止损上移后锚不动：已触发的部分止损（更早）仍然定义风险锚', () => {
    // 最早的止损 90 已部分触发（createdAt 500），之后重挂到 95——锚仍是 90
    const anchor = earliestLongStopPrice('AUSDT', [longPos('p1')], [
      slOrder({ stopPrice: 95, createdAt: 4000 }),
    ], [filledSl({ triggerPrice: 90, createdAt: 500 })]);
    expect(anchor).toBe(90);
  });

  it('只认关联当前多单的止损：别的仓位 / 别的标的 / TP 单都不算', () => {
    const anchor = earliestLongStopPrice('AUSDT', [longPos('p1')], [
      slOrder({ linkedPositionId: 'other-pos', stopPrice: 80, createdAt: 1 }),
      slOrder({ reduceKind: 'TP' as const, stopPrice: 120, createdAt: 2 }),
      slOrder({ reducePositionSide: 'SHORT' as const, stopPrice: 70, createdAt: 3 }),
      slOrder({ stopPrice: 91, createdAt: 100 }),
    ], [
      filledSl({ symbol: 'BUSDT', triggerPrice: 60, createdAt: 1 }),
    ]);
    expect(anchor).toBe(91);
  });

  it('无多单或无可追溯止损时返回 null，不臆造锚', () => {
    expect(earliestLongStopPrice('AUSDT', [], [slOrder({})], [])).toBeNull();
    expect(earliestLongStopPrice('AUSDT', [longPos('p1')], [], [])).toBeNull();
    expect(earliestLongStopPrice('AUSDT', [longPos('p1')], [slOrder({ stopPrice: 0 })], [])).toBeNull();
  });
});
