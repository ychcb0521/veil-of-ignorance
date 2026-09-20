import { describe, expect, it } from 'vitest';
import { resolveLegExecutionMethods } from '../legExecutionMethod';
import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

const leg = (over: Partial<TradeJournal> = {}) => ({
  id: 'leg', symbol: 'XUSDT', trade_record_id: 'record', direction: 'short',
  order_kind: 'hedge', leg_role: 'hedge_rolling', source: 'retroactive_from_record',
  pre_simulated_time: '2026-09-20T01:00:00.000Z', pre_entry_price: 100, ...over,
} as TradeJournal);
const record = (over: Partial<TradeRecord> = {}): TradeRecord => ({
  id: 'record', symbol: 'XUSDT', side: 'SHORT', type: 'MARKET', action: 'CLOSE',
  entryPrice: 100, exitPrice: 99, quantity: 1, leverage: 3, pnl: 1, fee: 0, slippage: 0,
  openTime: Date.parse('2026-09-20T01:00:00.000Z'), closeTime: Date.parse('2026-09-20T02:00:00.000Z'), ...over,
});
const triggered: CampaignReverseHedgeOrder = {
  id: 'order', tradeRecordId: 'record', side: 'SHORT', price: 100,
  status: 'triggered', createdAt: Date.parse('2026-09-20T00:00:00.000Z'),
  triggeredAt: Date.parse('2026-09-20T01:00:00.000Z'), cancelledAt: null,
};

describe('execution method evidence', () => {
  it('does not infer manual from MARKET, retroactive source, roles or missing orders', () => {
    const methods = resolveLegExecutionMethods(leg(), record());
    expect(methods.open.label).toBe('未记录');
    expect(methods.close.label).toBe('未记录');
  });
  it('separately resolves entry and exit from explicit fill evidence', () => {
    expect(resolveLegExecutionMethods(leg(), record({ entry_method: 'manual', exit_method: 'sl' })))
      .toMatchObject({ open: { label: '手动' }, close: { label: '非手动', reason: '止损委托触发平仓。' } });
    expect(resolveLegExecutionMethods(leg(), record({ entry_method: 'order', exit_method: 'manual' })))
      .toMatchObject({ open: { label: '非手动' }, close: { label: '手动' } });
  });
  it.each(['tp1', 'tp2', 'tp3', 'liquidation'] as const)('recognizes non-manual exit %s', method => {
    expect(resolveLegExecutionMethods(leg(), record({ exit_method: method })).close.kind).toBe('order');
  });
  it('recognizes legacy liquidation without exit_method', () => {
    expect(resolveLegExecutionMethods(leg(), record({ action: 'LIQUIDATION' })).close.kind).toBe('order');
  });
  it('can recover an old triggered short from the full order history', () => {
    expect(resolveLegExecutionMethods(leg(), record(), [triggered]).open.kind).toBe('order');
    expect(resolveLegExecutionMethods(leg(), record(), [{ ...triggered, status: 'cancelled' }]).open.kind).toBe('unknown');
    expect(resolveLegExecutionMethods(leg({ direction: 'long', order_kind: 'main', leg_role: 'main_open' }), record({ side: 'LONG' }), [triggered]).open.kind).toBe('unknown');
  });
  it('explicit manual evidence wins over a similar same-time triggered order', () => {
    expect(resolveLegExecutionMethods(leg(), record({ entry_method: 'manual' }), [triggered]).open.kind).toBe('manual');
  });
  it('uses explicit entry snapshot methods but never derives exit method from them', () => {
    expect(resolveLegExecutionMethods(leg({ hedge_order_method: 'market_chase' }), null)).toMatchObject({
      open: { kind: 'manual' }, close: { kind: 'unknown' },
    });
    expect(resolveLegExecutionMethods(leg({ hedge_order_method: 'limit_preset' }), null).open.kind).toBe('order');
  });
  it('does not override an explicit manual snapshot with a nearby triggered order', () => {
    expect(resolveLegExecutionMethods(leg({ hedge_order_method: 'market_chase' }), record(), [triggered]).open.kind).toBe('manual');
  });
  it('requires identity, not a coincident time, price, or merged position', () => {
    const otherOrder = { ...triggered, tradeRecordId: 'other' };
    const otherRecord = record({ id: 'other', positionId: 'merged', fillId: 'other-fill' });
    expect(resolveLegExecutionMethods(leg(), record({ positionId: 'merged', fillId: 'this-fill' }), [otherOrder], [otherRecord]).open.kind).toBe('unknown');
    expect(resolveLegExecutionMethods(leg(), record(), [{ ...triggered, tradeRecordId: null }]).open.kind).toBe('unknown');
    expect(resolveLegExecutionMethods(leg(), record(), [{ ...triggered, foreignReplay: true }]).open.kind).toBe('unknown');
  });
  it('recognizes different partial closes of the same explicitly linked fill', () => {
    const linked = record({ id: 'earlier-cut', fillId: 'fill' });
    expect(resolveLegExecutionMethods(leg(), record({ fillId: 'fill' }), [{ ...triggered, tradeRecordId: linked.id }], [linked]).open.kind).toBe('order');
  });
});
