import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

export type LegExecutionMethod = {
  kind: 'manual' | 'order' | 'unknown';
  label: '手动' | '自动' | '未记录';
  reason: string;
};
export type LegExecutionMethods = { open: LegExecutionMethod; close: LegExecutionMethod };

const unknown = (action: string): LegExecutionMethod => ({
  kind: 'unknown', label: '未记录', reason: `没有足够的${action}方式记录；历史回填、角色和市价成交不代表手动操作。`,
});
const manual = (reason: string): LegExecutionMethod => ({ kind: 'manual', label: '手动', reason });
const order = (reason: string): LegExecutionMethod => ({ kind: 'order', label: '自动', reason });

/** 展示业务规则，不是成交来源证据：用户明确约定主力开单均为手动，不扩大到加仓或镜像腿。 */
export function mainOpeningExecutionMethod(role: string | null | undefined): LegExecutionMethod | null {
  return role === 'main_open' || role === 'reentry_main'
    ? manual('按本系统的业务约定，主力开仓为手动；这不是从历史成交来源推断。')
    : null;
}

/** 原始 Legs / 导出使用业务显示规则；持久化实际证据时使用下方 evidence 函数。 */
export function resolveLegExecutionMethods(
  leg: TradeJournal,
  record: TradeRecord | null,
  reverseOrders: CampaignReverseHedgeOrder[] = [],
  tradeRecords: TradeRecord[] = [],
): LegExecutionMethods {
  const evidence = resolveLegExecutionMethodEvidence(leg, record, reverseOrders, tradeRecords);
  return { ...evidence, open: mainOpeningExecutionMethod(leg.leg_role) ?? evidence.open };
}

/** Evidence only: a MARKET close record says nothing about how its position was opened. */
export function resolveLegExecutionMethodEvidence(
  leg: TradeJournal,
  record: TradeRecord | null,
  reverseOrders: CampaignReverseHedgeOrder[] = [],
  tradeRecords: TradeRecord[] = [],
): LegExecutionMethods {
  let open = unknown('开仓');
  if (record?.entry_method === 'manual') {
    open = manual('成交记录明确记为手动立即开仓。');
  } else if (record?.entry_method === 'order') {
    open = order('成交记录明确记为预设委托成交；手动挂出委托不等于手动立即开仓。');
  } else if (leg.hedge_order_method === 'market_chase') {
    open = manual('开仓快照记录为市价追入。');
  } else if (leg.hedge_order_method === 'limit_preset') {
    open = order('开仓快照记录为预设限价委托。');
  } else {
    const hedge = leg.order_kind === 'hedge' || leg.leg_role?.startsWith('hedge_') || leg.leg_role === 'reentry_hedge';
    // Chart attribution may use nearby times/prices; audit labels require an explicit identity.
    // Different partial-close records may share a fill, but a merged position alone is not evidence.
    const matched = hedge && reverseOrders.some(candidate => {
      if (candidate.status !== 'triggered' || candidate.foreignReplay || !candidate.tradeRecordId
        || candidate.side !== (leg.direction === 'long' ? 'LONG' : 'SHORT')) return false;
      if (candidate.tradeRecordId === (record?.id ?? leg.trade_record_id)) return true;
      const linkedRecord = tradeRecords.find(item => item.id === candidate.tradeRecordId);
      return !!(record?.fillId && linkedRecord?.fillId === record.fillId
        && linkedRecord.symbol === record.symbol && linkedRecord.side === record.side);
    });
    if (matched) open = order('成交身份关联到已触发的反向委托（包括盘面隐藏的委托）。');
  }

  let close = unknown('平仓');
  if (record?.action === 'LIQUIDATION' || record?.exit_method === 'liquidation') {
    close = order('强制平仓，不是手动平仓。');
  } else if (record?.exit_method === 'manual') {
    close = manual('成交记录明确记为手动平仓。');
  } else if (record?.exit_method === 'sl') {
    close = order('止损委托触发平仓。');
  } else if (record?.exit_method && /^tp[123]$/.test(record.exit_method)) {
    close = order(`止盈委托 ${record.exit_method.toUpperCase()} 触发平仓。`);
  }
  return { open, close };
}
