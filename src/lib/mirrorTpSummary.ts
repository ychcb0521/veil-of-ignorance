import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

/**
 * 镜像止盈达成统计（战役维度）。
 * 「实现镜像止盈」= 该战役里有一条 mirror_tp 腿真正成交（trade_record_id 对应到成交记录），
 * 与 computeDecisionAccuracy.mirror_tp_capture.was_triggered 同口径，但不需要 K 线、可对整表批量统计。
 * 盈利 / 亏损按战役实际盈亏比 b 判定：|b| ≤ 0.1 记持平，其余按 b 的正负分；
 * 缺少有效 b（没有有效初始最大预期亏损）时退回按 final_realized_pnl 的符号判。
 */
export interface MirrorTpCampaignInput {
  /** 镜像止盈是否已达成（mirror_tp 腿成交）。 */
  achieved: boolean;
  /** 战役实际盈亏比 b = 已实现盈亏 ÷ 初始最大预期亏损；null = 无有效 L，退回按金额符号判。 */
  payoffRatio?: number | null;
  /** 战役已实现盈亏；null = 未结束 / 无数据。 */
  realizedPnl: number | null;
}

/**
 * 盈亏比的「持平带」：|b| ≤ 0.1 一律算持平。
 *
 * 为什么要留这条带：b 是以初始最大预期亏损 L 为单位的，赚回 0.03R 和亏掉 0.03R 在
 * 决策上是同一件事——手续费与滑点级别的噪声，不是镜像止盈这套动作的功劳或过失。
 * 按金额符号切，任何一分钱都会把一场噪声战役推进「盈利」或「亏损」，统计就被噪声灌满。
 */
export const MIRROR_TP_FLAT_BAND = 0.1;

export type MirrorTpOutcome = 'win' | 'flat' | 'loss' | 'open';

/**
 * 战役结果三分（外加未结束）。优先用 b 判，b 不可用时退回金额符号——
 * 后者没有可用的尺度，因此不套持平带，只按正负分。
 */
export function mirrorTpOutcome(payoffRatio: number | null | undefined, realizedPnl: number | null): MirrorTpOutcome {
  if (payoffRatio != null && Number.isFinite(payoffRatio)) {
    if (Math.abs(payoffRatio) <= MIRROR_TP_FLAT_BAND) return 'flat';
    return payoffRatio > 0 ? 'win' : 'loss';
  }
  if (realizedPnl == null || !Number.isFinite(realizedPnl)) return 'open';
  if (realizedPnl > 0) return 'win';
  if (realizedPnl < 0) return 'loss';
  return 'flat';
}

export interface MirrorTpSummary {
  total: number;
  achieved: number;
  notAchieved: number;
  achievedWin: number;
  achievedLoss: number;
  /** 达成但打平 / 进行中（realizedPnl 为 0 或 null）。 */
  achievedNeutral: number;
  /** 达成率 = achieved / total。total=0 → null。 */
  achievedRatePct: number | null;
  /** 未达成率 = notAchieved / total。total=0 → null。 */
  notAchievedRatePct: number | null;
  /** 达成里的盈利率 = achievedWin / achieved。achieved=0 → null。 */
  achievedWinRatePct: number | null;
}

/** 判定一个战役是否达成镜像止盈：存在成交的 mirror_tp 腿。 */
export function campaignAchievedMirrorTp(legs: TradeJournal[], tradeRecords: TradeRecord[]): boolean {
  const recordIds = new Set(tradeRecords.map(record => record.id));
  return legs.some(leg =>
    leg.leg_role === 'mirror_tp'
    && leg.trade_record_id != null
    && recordIds.has(leg.trade_record_id),
  );
}

/**
 * 镜像止盈排序权重：实现·盈利(3) > 实现·持平 / 进行中(2) > 实现·亏损(1) > 未实现(0)。
 * 降序把「镜像止盈生效且赚钱」的战役排在最前。盈亏三分见 mirrorTpOutcome（含 ±0.1 持平带）。
 */
export function mirrorTpRank(
  achieved: boolean,
  payoffRatio: number | null | undefined,
  realizedPnl: number | null,
): number {
  if (!achieved) return 0;
  const outcome = mirrorTpOutcome(payoffRatio, realizedPnl);
  if (outcome === 'win') return 3;
  if (outcome === 'loss') return 1;
  return 2; // 实现·持平 / 进行中
}

export function summarizeMirrorTp(campaigns: MirrorTpCampaignInput[]): MirrorTpSummary {
  const total = campaigns.length;
  const achievedList = campaigns.filter(campaign => campaign.achieved);
  const achieved = achievedList.length;
  const outcomes = achievedList.map(c => mirrorTpOutcome(c.payoffRatio, c.realizedPnl));
  const achievedWin = outcomes.filter(outcome => outcome === 'win').length;
  const achievedLoss = outcomes.filter(outcome => outcome === 'loss').length;
  return {
    total,
    achieved,
    notAchieved: total - achieved,
    achievedWin,
    achievedLoss,
    achievedNeutral: achieved - achievedWin - achievedLoss,
    achievedRatePct: total > 0 ? (achieved / total) * 100 : null,
    notAchievedRatePct: total > 0 ? ((total - achieved) / total) * 100 : null,
    achievedWinRatePct: achieved > 0 ? (achievedWin / achieved) * 100 : null,
  };
}
