import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';
import { resolveLegDisplayRole } from '@/lib/campaignMainLegOrdinals';
import { MIRROR_RATIO_EPSILON_PCT } from '@/lib/mirrorExecutionMethod';

export type LegExecutionMethod = {
  kind: 'manual' | 'order' | 'unknown';
  label: '手动' | '自动' | '未记录';
  reason: string;
};
export type LegExecutionMethods = { open: LegExecutionMethod; close: LegExecutionMethod };

/** 复盘重点仅为手动开仓的对冲；保留其他操作记录，但不赋予强调色。 */
export function shouldHighlightLegExecution(
  leg: Pick<TradeJournal, 'order_kind' | 'leg_role'>,
  action: 'open' | 'close',
  method: LegExecutionMethod,
): boolean {
  const role = resolveLegDisplayRole(leg);
  return action === 'open' && method.kind === 'manual'
    && (role?.startsWith('hedge_') === true || role === 'reentry_hedge');
}

const unknown = (action: string): LegExecutionMethod => ({
  kind: 'unknown', label: '未记录', reason: `没有足够的${action}方式记录；历史回填、角色和市价成交不代表手动操作。`,
});
const manual = (reason: string): LegExecutionMethod => ({ kind: 'manual', label: '手动', reason });
const order = (reason: string): LegExecutionMethod => ({ kind: 'order', label: '自动', reason });

/** 用户确认的历史成交显示口径；不回写或冒充记录原本携带的来源证据。 */
export function manualExecutionFallback(method: LegExecutionMethod, executed: boolean): LegExecutionMethod {
  return executed && method.kind === 'unknown'
    ? manual('按用户确认的口径：真实成交未记录操作方式时按手动显示；原始方式字段保持不变。')
    : method;
}

/** 展示业务规则，不是成交来源证据：用户明确约定主力开单均为手动，不扩大到加仓或镜像腿。 */
export function mainOpeningExecutionMethod(role: string | null | undefined): LegExecutionMethod | null {
  return role === 'main_open' || role === 'reentry_main'
    ? manual('按本系统的业务约定，主力开仓为手动；这不是从历史成交来源推断。')
    : null;
}

export function mirrorOpeningExecutionMethod(): LegExecutionMethod {
  return order('按用户确认的镜像止盈规则，开仓显示为自动。');
}

export function mirrorClosingExecutionMethod(reductionPct: number | null | undefined): LegExecutionMethod | null {
  if (reductionPct == null || !Number.isFinite(reductionPct)) return null;
  return Math.abs(reductionPct - 60) <= MIRROR_RATIO_EPSILON_PCT
    ? order('按用户确认的镜像止盈规则：实际平仓比例严格为 60%，显示为自动。')
    : manual(`按用户确认的镜像止盈规则：实际平仓比例 ${Number(reductionPct.toPrecision(12))}%，不是 60%，显示为手动。`);
}

/** 原始 Legs / 导出使用业务显示规则；持久化实际证据时使用下方 evidence 函数。 */
export function resolveLegExecutionMethods(
  leg: TradeJournal,
  record: TradeRecord | null,
  reverseOrders: CampaignReverseHedgeOrder[] = [],
  tradeRecords: TradeRecord[] = [],
  mirrorReductionPct?: number | null,
): LegExecutionMethods {
  const evidence = resolveLegExecutionMethodEvidence(leg, record, reverseOrders, tradeRecords);
  const hasOpening = record != null && record.action !== 'FUNDING';
  const hasClosing = record != null && (record.action === 'CLOSE' || record.action === 'LIQUIDATION'
    || (record.action == null && Number.isFinite(record.closeTime) && record.closeTime > 0));
  return {
    open: leg.leg_role === 'mirror_tp' ? mirrorOpeningExecutionMethod()
      : mainOpeningExecutionMethod(leg.leg_role) ?? manualExecutionFallback(evidence.open, hasOpening),
    close: (leg.leg_role === 'mirror_tp' && hasClosing ? mirrorClosingExecutionMethod(mirrorReductionPct) : null)
      ?? manualExecutionFallback(evidence.close, hasClosing),
  };
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
