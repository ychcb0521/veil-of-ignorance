/**
 * 「一键结束进行中的战役」的判定层。
 *
 * 列表页顶部那条黄条在说「不要让它无限期 active」，但它此前只是一句话。
 * 这个模块把那句话变成可执行的动作，并且把**结论算在写库之前**——
 * 界面显示的每一场要变成什么状态、盖哪个时间戳，都由这里给出，
 * 用户在确认框里读到的就是随后写进数据库的那一份。
 *
 * 两条不肯让步的原则：
 *
 * 1. **状态不是选出来的，是算出来的。**
 *    单场的「结束战役」对话框让人手选 closed_profit / closed_loss，
 *    于是「亏损结束」配一个绿色正数这种事才可能发生。批量路径不给这个机会：
 *    状态一律由 campaignStatusFromRealizedPnl 从已实现盈亏推出，与列表上
 *    显示的那个数同源（settlement 直接来自行数据，不重算）。
 *
 * 2. **结束时间不是「此刻」。**
 *    一场三天前就打完、只是忘了点结束的战役，盖上今天的时间戳会污染
 *    持续时间、closed_at 时间窗筛选、复合战役增长曲线。所以时间取
 *    「最后一笔结算成交 → 最后一条事件 → 该币种当前模拟时钟」，
 *    并把来源一并返回，让确认框能说清楚这个时间是哪来的。
 *
 * 还有一档不能一刀切：**仍有未结算腿的战役**。它是真的还在跑，
 * 硬给它一个「盈利/亏损结束」等于用半场数据定性。这类只允许被标成
 * abandoned（放弃），而且必须由用户在确认框里额外勾选——默认不动。
 */
import { campaignStatusFromRealizedPnl, type CampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import type { CampaignStatus, TradeCampaign, TradeJournal } from '@/types/journal';

/** 结束时间戳的来源，只用于界面说明，不参与计算。 */
export type CloseTimeSource =
  | 'last_fill'   // 本场最后一笔结算成交
  | 'last_event'  // 事件流里最后一条
  | 'clock';      // 都没有，退到当前模拟时钟

export type SettledCloseStatus = Extract<
  CampaignStatus,
  'closed_profit' | 'closed_loss' | 'closed_breakeven'
>;

export type BulkCloseVerdict =
  /** 全部腿都已结算：状态由金额推出，可以直接结束。 */
  | { kind: 'settled'; status: SettledCloseStatus }
  /** 还有腿没结算：只能标记为放弃，且需要用户显式勾选。 */
  | { kind: 'unsettled'; status: Extract<CampaignStatus, 'abandoned'>; unsettledLegCount: number };

export interface BulkCloseCandidate {
  campaign: TradeCampaign;
  legs: TradeJournal[];
  /** 列表页已经算好的那一份，原样传进来——重算会引入平仓价校正的漂移。 */
  settlement: CampaignRealizedPnl;
}

export interface BulkClosePlanItem {
  campaign: TradeCampaign;
  verdict: BulkCloseVerdict;
  /** 要写进 final_realized_pnl 的数，与列表上显示的完全一致。 */
  realizedPnl: number | null;
  /** 已实现盈亏 ÷ Σ 计划最大亏损，与单场对话框同一个算法。 */
  finalRMultiple: number | null;
  closedAt: string;
  closedAtSource: CloseTimeSource;
}

/** 一条成交记录的时间：优先平仓时刻，退到开仓时刻。 */
function recordTime(record: { closeTime?: number | null; openTime?: number | null }): number {
  return record.closeTime || record.openTime || 0;
}

/**
 * 这场战役最后一次真正发生事情是什么时候。
 * 只看已认领给腿的结算记录——没被任何腿认领的记录不属于本场。
 */
function resolveCloseTime(
  candidate: BulkCloseCandidate,
  fallbackNowMs: number,
): { closedAt: string; source: CloseTimeSource } {
  let latestFill = 0;
  for (const records of candidate.settlement.recordsByLeg.values()) {
    for (const record of records) latestFill = Math.max(latestFill, recordTime(record));
  }
  if (latestFill > 0) {
    return { closedAt: new Date(latestFill).toISOString(), source: 'last_fill' };
  }

  let latestEvent = 0;
  for (const event of candidate.campaign.actual_evolution ?? []) {
    const ms = Date.parse(event.timestamp ?? '');
    if (Number.isFinite(ms)) latestEvent = Math.max(latestEvent, ms);
  }
  if (latestEvent > 0) {
    return { closedAt: new Date(latestEvent).toISOString(), source: 'last_event' };
  }

  return { closedAt: new Date(fallbackNowMs).toISOString(), source: 'clock' };
}

/** Σ 各腿的计划最大亏损。与 EndCampaignDialog 同一个口径，两条路径不能算出两个 R。 */
function plannedMaxLoss(legs: TradeJournal[]): number {
  return legs.reduce((sum, leg) => sum + (leg.pre_max_loss_usdt ?? 0), 0);
}

function verdictFor(candidate: BulkCloseCandidate, closedAt: string): BulkCloseVerdict {
  const { settlement, legs } = candidate;
  if (settlement.settled) {
    const status = campaignStatusFromRealizedPnl(settlement, closedAt);
    // settled + 有 closedAt ⇒ 必然落在三个结束态之一；这里只是把类型收窄。
    if (status === 'closed_profit' || status === 'closed_loss' || status === 'closed_breakeven') {
      return { kind: 'settled', status };
    }
  }
  const unsettledLegCount = legs.filter(leg => settlement.byLeg.get(leg.id) == null).length;
  return {
    kind: 'unsettled',
    status: 'abandoned',
    // 一条腿都没有的战役也归到这一档：它同样不该被判成盈利或亏损。
    unsettledLegCount: legs.length === 0 ? 0 : unsettledLegCount,
  };
}

/**
 * 为每一场进行中的战役算出「如果现在结束，会变成什么样」。
 * 纯函数：不写库、不排序、不过滤——过滤 active 与归属权由调用方决定。
 */
export function planBulkCampaignClose(
  candidates: BulkCloseCandidate[],
  fallbackNowMs: number,
): BulkClosePlanItem[] {
  return candidates.map(candidate => {
    const { closedAt, source } = resolveCloseTime(candidate, fallbackNowMs);
    const realizedPnl = candidate.settlement.total;
    const risk = plannedMaxLoss(candidate.legs);
    return {
      campaign: candidate.campaign,
      verdict: verdictFor(candidate, closedAt),
      realizedPnl,
      finalRMultiple: risk > 0 && realizedPnl != null ? realizedPnl / risk : null,
      closedAt,
      closedAtSource: source,
    };
  });
}

export const CLOSE_TIME_SOURCE_LABELS: Record<CloseTimeSource, string> = {
  last_fill: '最后一笔成交',
  last_event: '最后一条事件',
  clock: '当前时钟',
};

export const BULK_CLOSE_STATUS_LABELS: Record<SettledCloseStatus | 'abandoned', string> = {
  closed_profit: '盈利结束',
  closed_loss: '亏损结束',
  closed_breakeven: '打平结束',
  abandoned: '放弃',
};
