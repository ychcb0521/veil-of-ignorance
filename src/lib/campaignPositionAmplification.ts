/**
 * 仓位放大 =（主方向总名义仓位 − 镜像止盈名义仓位）÷ 初始开仓名义仓位（倍）。
 * 分母保留入场时主力与镜像的初始敞口；分子排除同方向镜像、挂单和反向对冲。
 * 详情页盈亏概览、战役封面、排序、散点图与导出都读这一处。
 */
import { computeInitialMainExposureNotional } from '@/lib/campaignAnalysis';
import type { LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import { buildLegPositionShareInputs, campaignMainSideNotional } from '@/lib/legPositionShareInputs';
import type { LegFillEvidence } from '@/lib/legRowStatus';
import { buildTradeRecordLookup } from '@/lib/objectiveOperationTime';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

/** 读不出主力开仓名义仓位（或不为正）、主方向一条成交的腿都没有时为 null。 */
export function computePositionAmplification(
  initialMainExposureNotional: number | null | undefined,
  mainSideNotionalTotal: number | null | undefined,
  mirrorNotional: number | null | undefined = 0,
): number | null {
  if (initialMainExposureNotional == null || !Number.isFinite(initialMainExposureNotional) || initialMainExposureNotional <= 0) return null;
  if (mainSideNotionalTotal == null || !Number.isFinite(mainSideNotionalTotal)) return null;
  if (mirrorNotional == null || !Number.isFinite(mirrorNotional) || mirrorNotional < 0 || mainSideNotionalTotal < mirrorNotional) return null;
  return (mainSideNotionalTotal - mirrorNotional) / initialMainExposureNotional;
}

/** 从战役与腿直接算；挂单判定的凭据（evidence）给得越全，与详情页 Legs 表合计行越一致。 */
export function computeCampaignPositionAmplification(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  corrections?: LegExitPriceCorrections,
  evidence: LegFillEvidence = {},
): number | null {
  const initial = computeInitialMainExposureNotional(campaign, legs, tradeRecords);
  if (!Number.isFinite(initial) || initial <= 0) return null;
  const inputs = buildLegPositionShareInputs(legs, buildTradeRecordLookup(tradeRecords), corrections, { events: campaign.actual_evolution, ...evidence });
  const mainSide = campaignMainSideNotional(campaign.direction, inputs);
  return computePositionAmplification(initial, mainSide.total, mainSide.mirrorTotal);
}
