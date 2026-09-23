import { describe, expect, it } from 'vitest';
import {
  resolveLegExecutionMethodEvidence,
  resolveLegExecutionMethods,
  shouldHighlightLegExecution,
  type LegExecutionMethod,
} from '../legExecutionMethod';
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
  it('有真实平仓时间的旧记录即使缺action也按手动口径显示，不把OPEN误当平仓', () => {
    const legacy = { ...record(), action: undefined } as unknown as TradeRecord;
    expect(resolveLegExecutionMethods(leg(), legacy)).toMatchObject({ open: { kind: 'manual' }, close: { kind: 'manual' } });
    expect(resolveLegExecutionMethods(leg(), { ...legacy, closeTime: 0 }).close.kind).toBe('unknown');
    expect(resolveLegExecutionMethods(leg(), { ...legacy, action: 'OPEN' }).close.kind).toBe('unknown');
  });
  it('does not infer manual from MARKET, retroactive source, roles or missing orders', () => {
    const methods = resolveLegExecutionMethodEvidence(leg(), record());
    expect(methods.open.label).toBe('未记录');
    expect(methods.close.label).toBe('未记录');
  });
  it('separately resolves entry and exit from explicit fill evidence', () => {
    expect(resolveLegExecutionMethodEvidence(leg(), record({ entry_method: 'manual', exit_method: 'sl' })))
      .toMatchObject({ open: { label: '手动' }, close: { label: '自动', reason: '止损委托触发平仓。' } });
    expect(resolveLegExecutionMethodEvidence(leg(), record({ entry_method: 'order', exit_method: 'manual' })))
      .toMatchObject({ open: { label: '自动' }, close: { label: '手动' } });
  });
  it.each(['tp1', 'tp2', 'tp3', 'liquidation'] as const)('recognizes non-manual exit %s', method => {
    expect(resolveLegExecutionMethodEvidence(leg(), record({ exit_method: method })).close.kind).toBe('order');
  });
  it('被强平的镜像腿：执行方式是「强制平仓」，不套镜像止盈的 60% 显示规则（否则与红色「爆仓」标签自相矛盾）', () => {
    const mirror = leg({ direction: 'long', order_kind: 'main', leg_role: 'mirror_tp' });
    const liquidated = record({ side: 'LONG', action: 'LIQUIDATION', exit_method: 'liquidation', liquidationSettlement: 'bankruptcy', pnl: -100 });
    // 比例不是 60% 时以前会显示成琥珀色「手动」；是 60% 时会写成「按镜像止盈规则……显示为自动」
    for (const pct of [100, 60, null]) {
      const close = resolveLegExecutionMethods(mirror, liquidated, [], [], pct).close;
      expect(close).toMatchObject({ kind: 'order', reason: '强制平仓，不是手动平仓。' });
    }
    // 正常镜像止盈照旧走显示规则
    expect(resolveLegExecutionMethods(mirror, record({ side: 'LONG' }), [], [], 100).close.label).toBe('手动');
  });
  it('recognizes legacy liquidation without exit_method', () => {
    expect(resolveLegExecutionMethodEvidence(leg(), record({ action: 'LIQUIDATION' })).close.kind).toBe('order');
  });
  it('can recover an old triggered short from the full order history', () => {
    expect(resolveLegExecutionMethodEvidence(leg(), record(), [triggered]).open.kind).toBe('order');
    expect(resolveLegExecutionMethodEvidence(leg(), record(), [{ ...triggered, status: 'cancelled' }]).open.kind).toBe('unknown');
    expect(resolveLegExecutionMethodEvidence(leg({ direction: 'long', order_kind: 'main', leg_role: 'main_add_1' }), record({ side: 'LONG' }), [triggered]).open.kind).toBe('unknown');
  });
  it('explicit manual evidence wins over a similar same-time triggered order', () => {
    expect(resolveLegExecutionMethodEvidence(leg(), record({ entry_method: 'manual' }), [triggered]).open.kind).toBe('manual');
  });
  it('uses explicit entry snapshot methods but never derives exit method from them', () => {
    expect(resolveLegExecutionMethodEvidence(leg({ hedge_order_method: 'market_chase' }), null)).toMatchObject({
      open: { kind: 'manual' }, close: { kind: 'unknown' },
    });
    expect(resolveLegExecutionMethodEvidence(leg({ hedge_order_method: 'limit_preset' }), null).open.kind).toBe('order');
  });
  it('does not override an explicit manual snapshot with a nearby triggered order', () => {
    expect(resolveLegExecutionMethodEvidence(leg({ hedge_order_method: 'market_chase' }), record(), [triggered]).open.kind).toBe('manual');
  });
  it('requires identity, not a coincident time, price, or merged position', () => {
    const otherOrder = { ...triggered, tradeRecordId: 'other' };
    const otherRecord = record({ id: 'other', positionId: 'merged', fillId: 'other-fill' });
    expect(resolveLegExecutionMethodEvidence(leg(), record({ positionId: 'merged', fillId: 'this-fill' }), [otherOrder], [otherRecord]).open.kind).toBe('unknown');
    expect(resolveLegExecutionMethodEvidence(leg(), record(), [{ ...triggered, tradeRecordId: null }]).open.kind).toBe('unknown');
    expect(resolveLegExecutionMethodEvidence(leg(), record(), [{ ...triggered, foreignReplay: true }]).open.kind).toBe('unknown');
  });
  it('recognizes different partial closes of the same explicitly linked fill', () => {
    const linked = record({ id: 'earlier-cut', fillId: 'fill' });
    expect(resolveLegExecutionMethodEvidence(leg(), record({ fillId: 'fill' }), [{ ...triggered, tradeRecordId: linked.id }], [linked]).open.kind).toBe('order');
  });
});

describe('execution method display conventions', () => {
  it.each(['main_open', 'reentry_main'] as const)('主力 %s 按明确业务规则显示手动，但不伪造实际证据', role => {
    const main = leg({ leg_role: role, order_kind: 'main', direction: 'long' });
    expect(resolveLegExecutionMethods(main, null).open).toMatchObject({ kind: 'manual', label: '手动' });
    expect(resolveLegExecutionMethods(main, null).open.reason).toContain('业务约定');
    expect(resolveLegExecutionMethodEvidence(main, null).open.kind).toBe('unknown');
    expect(resolveLegExecutionMethods(main, record({ entry_method: 'order' })).open.kind).toBe('manual');
    expect(resolveLegExecutionMethodEvidence(main, record({ entry_method: 'order' })).open.kind).toBe('order');
  });

  it.each(['main_add_1', 'standalone'] as const)('主力开仓约定不扩大到 %s；无成交记录仍显示未记录', role => {
    expect(resolveLegExecutionMethods(leg({ leg_role: role, order_kind: 'main' }), null).open.kind).toBe('unknown');
  });

  it('真实成交缺少方式记录时按用户确认显示手动，但证据仍为未知', () => {
    const sourceLeg = leg();
    const sourceRecord = record();
    const methods = resolveLegExecutionMethods(sourceLeg, sourceRecord);
    expect(methods).toMatchObject({ open: { kind: 'manual', label: '手动' }, close: { kind: 'manual', label: '手动' } });
    expect(methods.open.reason).toContain('用户确认');
    expect(methods.close.reason).toContain('原始方式字段保持不变');
    expect(resolveLegExecutionMethodEvidence(sourceLeg, sourceRecord)).toMatchObject({
      open: { kind: 'unknown' }, close: { kind: 'unknown' },
    });
  });

  it.each(['sl', 'tp1', 'tp2', 'tp3', 'liquidation'] as const)('不覆盖明确自动开仓和 %s 平仓方式', exitMethod => {
    expect(resolveLegExecutionMethods(leg(), record({ entry_method: 'order', exit_method: exitMethod })))
      .toMatchObject({ open: { kind: 'order', label: '自动' }, close: { kind: 'order', label: '自动' } });
  });

  it('无平仓方式字段的强平仍自动；身份关联委托仍自动开仓', () => {
    expect(resolveLegExecutionMethods(leg(), record({ action: 'LIQUIDATION' })).close.kind).toBe('order');
    expect(resolveLegExecutionMethods(leg(), record(), [triggered]).open.kind).toBe('order');
  });

  it('没有成交或仅资金费记录不兜底，OPEN 记录尚未平仓时不制造平仓方式', () => {
    expect(resolveLegExecutionMethods(leg(), null)).toMatchObject({ open: { kind: 'unknown' }, close: { kind: 'unknown' } });
    expect(resolveLegExecutionMethods(leg(), record({ action: 'FUNDING' })))
      .toMatchObject({ open: { kind: 'unknown' }, close: { kind: 'unknown' } });
    expect(resolveLegExecutionMethods(leg(), record({ action: 'OPEN' })))
      .toMatchObject({ open: { kind: 'manual' }, close: { kind: 'unknown' } });
  });

  it('显示约定不回写原始 journal、成交或委托对象', () => {
    const sourceLeg = Object.freeze(leg());
    const sourceRecord = Object.freeze(record());
    const sourceOrder = Object.freeze({ ...triggered, tradeRecordId: 'unrelated' });
    const originalLeg = { ...sourceLeg };
    const originalRecord = { ...sourceRecord };
    const originalOrder = { ...sourceOrder };
    resolveLegExecutionMethods(sourceLeg, sourceRecord, [sourceOrder]);
    expect(sourceLeg).toEqual(originalLeg);
    expect(sourceRecord).toEqual(originalRecord);
    expect(sourceOrder).toEqual(originalOrder);
    expect(sourceRecord.entry_method).toBeUndefined();
    expect(sourceRecord.exit_method).toBeUndefined();
  });
});

describe('manual hedge opening emphasis', () => {
  const manual: LegExecutionMethod = { kind: 'manual', label: '手动', reason: 'test' };
  const automatic: LegExecutionMethod = { kind: 'order', label: '自动', reason: 'test' };
  const unknown: LegExecutionMethod = { kind: 'unknown', label: '未记录', reason: 'test' };

  it.each(['main_open', 'reentry_main', 'main_add_1', 'main_add_2', 'mirror_tp'] as const)('不强调 %s 的手动操作', role => {
    const sourceLeg = leg({ leg_role: role, order_kind: 'main' });
    expect(shouldHighlightLegExecution(sourceLeg, 'open', manual)).toBe(false);
    expect(shouldHighlightLegExecution(sourceLeg, 'close', manual)).toBe(false);
  });

  it.each(['hedge_initial_a', 'hedge_initial_b', 'hedge_rolling', 'reentry_hedge', 'standalone', null] as const)('只强调 %s 的手动对冲开仓', role => {
    const sourceLeg = leg({ leg_role: role, order_kind: 'hedge' });
    expect(shouldHighlightLegExecution(sourceLeg, 'open', manual)).toBe(true);
    expect(shouldHighlightLegExecution(sourceLeg, 'close', manual)).toBe(false);
    expect(shouldHighlightLegExecution(sourceLeg, 'open', automatic)).toBe(false);
    expect(shouldHighlightLegExecution(sourceLeg, 'open', unknown)).toBe(false);
  });

  it.each(['standalone', null] as const)('没有对冲类型的 %s 不强调', role => {
    expect(shouldHighlightLegExecution(leg({ leg_role: role, order_kind: 'main' }), 'open', manual)).toBe(false);
  });
});

describe('mirror execution method display conventions', () => {
  const mirror = () => leg({ leg_role: 'mirror_tp', order_kind: 'main', direction: 'long' });

  it.each([
    [60, 'order', '自动'],
    [59.99, 'manual', '手动'],
    [60.01, 'manual', '手动'],
    [50, 'manual', '手动'],
  ] as const)('镜像实际平仓比例 %s%% 显示 %s', (ratio, kind, label) => {
    expect(resolveLegExecutionMethods(mirror(), record({ side: 'LONG' }), [], [], ratio))
      .toMatchObject({ open: { kind: 'order', label: '自动' }, close: { kind, label } });
  });

  it('60% 的浮点运算尾差仍自动，但不将 59.99% 或 60.01% 四舍五入为自动', () => {
    const floatingSixtyPct = (0.1 + 0.2 + 0.3) * 100;
    expect(floatingSixtyPct).not.toBe(60);
    expect(resolveLegExecutionMethods(mirror(), record(), [], [], floatingSixtyPct).close.kind).toBe('order');
    for (const ratio of [59.99, 60.01]) {
      expect(resolveLegExecutionMethods(mirror(), record(), [], [], ratio).close.kind).toBe('manual');
    }
  });

  it('镜像开仓固定自动、平仓按比例；不改变原始手动来源证据', () => {
    const sourceLeg = Object.freeze(mirror());
    const sourceRecord = Object.freeze(record({ side: 'LONG', entry_method: 'manual', exit_method: 'manual' }));
    expect(resolveLegExecutionMethods(sourceLeg, sourceRecord, [], [], 60))
      .toMatchObject({ open: { kind: 'order' }, close: { kind: 'order' } });
    expect(resolveLegExecutionMethodEvidence(sourceLeg, sourceRecord))
      .toMatchObject({ open: { kind: 'manual' }, close: { kind: 'manual' } });
    expect(sourceRecord.entry_method).toBe('manual');
    expect(sourceRecord.exit_method).toBe('manual');
  });

  it('非 60% 镜像显示手动平仓，原记录的 TP 来源仍保持自动证据', () => {
    const sourceRecord = record({ side: 'LONG', entry_method: 'manual', exit_method: 'tp1' });
    expect(resolveLegExecutionMethods(mirror(), sourceRecord, [], [], 50))
      .toMatchObject({ open: { kind: 'order' }, close: { kind: 'manual' } });
    expect(resolveLegExecutionMethodEvidence(mirror(), sourceRecord))
      .toMatchObject({ open: { kind: 'manual' }, close: { kind: 'order' } });
  });

  it('没有成交记录或尚未平仓时，60% 规则不制造平仓记录', () => {
    expect(resolveLegExecutionMethods(mirror(), null, [], [], 60))
      .toMatchObject({ open: { kind: 'order' }, close: { kind: 'unknown' } });
    expect(resolveLegExecutionMethods(mirror(), record({ action: 'OPEN' }), [], [], 60))
      .toMatchObject({ open: { kind: 'order' }, close: { kind: 'unknown' } });
  });
});
