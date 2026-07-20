import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

/**
 * 镜像止盈达成统计（战役维度）。
 * 「实现镜像止盈」= 该战役里有一条 mirror_tp 腿真正成交（trade_record_id 对应到成交记录），
 * 与 computeDecisionAccuracy.mirror_tp_capture.was_triggered 同口径，但不需要 K 线、可对整表批量统计。
 * 盈利 / 亏损按战役 final_realized_pnl 判定（>0 盈利、<0 亏损、其余 = 进行中 / 打平）。
 */
export interface MirrorTpCampaignInput {
  /** 镜像止盈是否已达成（mirror_tp 腿成交）。 */
  achieved: boolean;
  /** 战役已实现盈亏；null = 未结束 / 无数据。 */
  realizedPnl: number | null;
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
 * 镜像止盈排序权重：实现·盈利(3) > 实现·打平 / 进行中(2) > 实现·亏损(1) > 未实现(0)。
 * 降序把「镜像止盈生效且赚钱」的战役排在最前。
 */
export function mirrorTpRank(achieved: boolean, realizedPnl: number | null): number {
  if (!achieved) return 0;
  if (realizedPnl == null || !Number.isFinite(realizedPnl)) return 2; // 实现·进行中
  if (realizedPnl > 0) return 3;
  if (realizedPnl < 0) return 1;
  return 2; // 实现·打平
}

export function summarizeMirrorTp(campaigns: MirrorTpCampaignInput[]): MirrorTpSummary {
  const total = campaigns.length;
  const achievedList = campaigns.filter(campaign => campaign.achieved);
  const achieved = achievedList.length;
  const achievedWin = achievedList.filter(c => c.realizedPnl != null && c.realizedPnl > 0).length;
  const achievedLoss = achievedList.filter(c => c.realizedPnl != null && c.realizedPnl < 0).length;
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
