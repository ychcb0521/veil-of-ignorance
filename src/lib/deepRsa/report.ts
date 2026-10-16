/**
 * Deep RSA 页面用的汇总：把战役列表的行逐场分组，并给出分组计数、两种口径各自的条件分布、
 * 待判定原因、同一行情去重后的簇数。纯函数，不读网络、不写任何东西。
 */
import { labelInputFromCardRow } from '@/lib/deepRsa/campaignLabels';
import { campaignLetterValues } from '@/lib/campaignMetricLetters';
import {
  clusterEvents, clusterLabelConflict, conditionBreakdown, countGroups, groupCampaign,
  type CampaignGrouping, type CampaignPendingReason, type DeepRsaGroup, type GroupCounts,
} from '@/lib/deepRsa/grouping';
import type { buildCampaignCardData } from '@/lib/campaignListCache';

type CardRow = ReturnType<typeof buildCampaignCardData>;

export interface CampaignGroupRow {
  campaignId: string;
  symbol: string;
  title: string;
  anchorMs: number | null;
  theoreticalB: number | null;
  payoffRatio: number | null;
  grouping: CampaignGrouping;
  /** Deep dig 分组标准可用的读数：指标字母表里每个字母的读数（缺失为 null）。 */
  letters?: Record<string, number | null>;
}

export interface CampaignGroupReport {
  rows: CampaignGroupRow[];
  counts: GroupCounts;
  breakdown: ReturnType<typeof conditionBreakdown>;
  pendingReasons: Partial<Record<CampaignPendingReason, number>>;
  /** 正样本 + 对照 + 冲突里有锚点的事件，按同标的 48h 单链去重后的簇数。 */
  clusters: number;
  /** 簇内同时含正样本与对照的簇数。 */
  conflictingClusters: number;
}

export const GROUP_ORDER: readonly DeepRsaGroup[] = ['positive', 'control', 'conflict', 'middle', 'pending', 'excluded'];

export function buildCampaignGroupReport(rows: readonly CardRow[], correctionsComplete: boolean | null): CampaignGroupReport {
  const out: CampaignGroupRow[] = rows.map(row => {
    const input = labelInputFromCardRow(row, correctionsComplete);
    return {
      campaignId: row.campaign.id,
      symbol: row.campaign.symbol,
      title: row.campaign.title,
      anchorMs: input.anchorMs,
      theoreticalB: input.theoreticalB,
      payoffRatio: input.payoffRatio,
      grouping: groupCampaign(input),
      letters: campaignLetterValues(row),
    };
  });
  const groupings = out.map(r => r.grouping);
  const pendingReasons: Partial<Record<CampaignPendingReason, number>> = {};
  for (const g of groupings) {
    if (g.group !== 'pending') continue;
    for (const reason of g.pendingReasons) pendingReasons[reason] = (pendingReasons[reason] ?? 0) + 1;
  }
  const events = out.filter(r => r.anchorMs != null && ['positive', 'control', 'conflict'].includes(r.grouping.group));
  const groupById = new Map(events.map(r => [r.campaignId, r.grouping.group]));
  const clusters = clusterEvents(events.map(r => ({ id: r.campaignId, symbol: r.symbol, anchorMs: r.anchorMs! })));
  return {
    rows: out.sort((a, b) => GROUP_ORDER.indexOf(a.grouping.group) - GROUP_ORDER.indexOf(b.grouping.group)
      || (b.anchorMs ?? 0) - (a.anchorMs ?? 0) || a.campaignId.localeCompare(b.campaignId)),
    counts: countGroups(groupings),
    breakdown: conditionBreakdown(groupings.filter(g => g.group !== 'excluded')),
    pendingReasons,
    clusters: clusters.length,
    conflictingClusters: clusters.filter(c => clusterLabelConflict(c.memberIds.map(id => groupById.get(id)!))).length,
  };
}
