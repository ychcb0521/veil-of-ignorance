import { describe, expect, it } from 'vitest';
import type { PendingOrder, Position } from '@/types/trading';
import { getConditionalTriggerDecisionFromRange } from '@/lib/conditionalOrders';
import { planReduceOnlyTrigger } from '@/lib/reduceOnlyOrderExecution';

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'position-1',
    side: 'LONG',
    entryPrice: 100,
    quantity: 10,
    leverage: 10,
    marginMode: 'isolated',
    settlementMode: 'usdt',
    settlementAsset: 'USDT',
    margin: 100,
    isolatedMargin: 100,
    openTime: 1_000,
    ...overrides,
  };
}

function makeTakeProfit(position: Position, overrides: Partial<PendingOrder> = {}): PendingOrder {
  const closesLong = position.side === 'LONG';
  return {
    id: 'take-profit-1',
    side: closesLong ? 'SHORT' : 'LONG',
    type: 'CONDITIONAL',
    price: 0,
    stopPrice: closesLong ? 120 : 80,
    quantity: 10,
    leverage: position.leverage,
    marginMode: position.marginMode,
    settlementMode: position.settlementMode,
    settlementAsset: position.settlementAsset,
    status: 'PENDING',
    createdAt: 1_500,
    conditionalExecType: 'MARKET',
    operator: closesLong ? '>=' : '<=',
    triggerDirection: closesLong ? 'UP' : 'DOWN',
    reduceOnly: true,
    reduceSymbol: 'TESTUSDT',
    reducePositionSide: position.side,
    linkedPositionId: position.id,
    reduceKind: 'TP',
    reducePercentage: 100,
    ...overrides,
  };
}

describe('reduce-only take-profit execution', () => {
  it('records a SHORT-side take-profit order that closes a long position', () => {
    const position = makePosition();
    const order = makeTakeProfit(position);
    const decision = getConditionalTriggerDecisionFromRange(order, { high: 121, low: 99 });

    expect(decision).toMatchObject({ triggered: true, triggerPriceNum: 120 });

    const execution = planReduceOnlyTrigger({
      symbol: 'TESTUSDT',
      order,
      triggerPrice: decision!.triggerPriceNum,
      closeTime: 2_000,
      closedRealAt: 3_000,
      positions: { TESTUSDT: [position] },
      orders: { TESTUSDT: [order] },
    });

    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    expect(execution.positions).toEqual([]);
    expect(execution.orders).toEqual([]);
    expect(execution.record).toMatchObject({
      positionId: position.id,
      symbol: 'TESTUSDT',
      side: 'LONG',
      action: 'CLOSE',
      quantity: 10,
      closeTime: 2_000,
      closedRealAt: 3_000,
      exit_method: 'tp1',
    });
    expect(execution.record.pnl).toBeGreaterThan(0);
    expect(execution.filledOrder).toMatchObject({
      id: order.id,
      side: 'SHORT',
      reduceOnly: true,
      reduceKind: 'TP',
      linkedPositionId: position.id,
      positionId: position.id,
      triggerPrice: 120,
      filledAt: 2_000,
    });
  });

  it('records a LONG-side take-profit order that closes a short position', () => {
    const position = makePosition({ side: 'SHORT' });
    const order = makeTakeProfit(position);
    const decision = getConditionalTriggerDecisionFromRange(order, { high: 101, low: 79 });

    expect(decision).toMatchObject({ triggered: true, triggerPriceNum: 80 });

    const execution = planReduceOnlyTrigger({
      symbol: 'TESTUSDT',
      order,
      triggerPrice: decision!.triggerPriceNum,
      closeTime: 2_000,
      closedRealAt: 3_000,
      positions: { TESTUSDT: [position] },
      orders: { TESTUSDT: [order] },
    });

    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    expect(execution.record).toMatchObject({ side: 'SHORT', action: 'CLOSE', exit_method: 'tp1' });
    expect(execution.record.pnl).toBeGreaterThan(0);
    expect(execution.filledOrder.side).toBe('LONG');
  });

  it('does not trigger before the take-profit price is reached', () => {
    const position = makePosition();
    const order = makeTakeProfit(position);

    expect(getConditionalTriggerDecisionFromRange(order, { high: 119.99, low: 90 })).toMatchObject({
      triggered: false,
    });
  });

  it('never consumes an order when the linked position snapshot is unavailable', () => {
    const position = makePosition();
    const order = makeTakeProfit(position);
    const sourceOrders = { TESTUSDT: [order] };

    const execution = planReduceOnlyTrigger({
      symbol: 'TESTUSDT',
      order,
      triggerPrice: 120,
      closeTime: 2_000,
      positions: { TESTUSDT: [] },
      orders: sourceOrders,
    });

    expect(execution).toEqual({ ok: false, reason: 'linked_position_missing' });
    expect(sourceOrders.TESTUSDT).toEqual([order]);
  });

  it('is idempotent after the first successful execution', () => {
    const position = makePosition();
    const order = makeTakeProfit(position);
    const first = planReduceOnlyTrigger({
      symbol: 'TESTUSDT',
      order,
      triggerPrice: 120,
      closeTime: 2_000,
      positions: { TESTUSDT: [position] },
      orders: { TESTUSDT: [order] },
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = planReduceOnlyTrigger({
      symbol: 'TESTUSDT',
      order,
      triggerPrice: 120,
      closeTime: 2_000,
      positions: { TESTUSDT: first.positions },
      orders: { TESTUSDT: first.orders },
    });
    expect(second).toEqual({ ok: false, reason: 'order_missing' });
  });
});
