/**
 * 仓位放大 = 主方向总名义仓位 ÷ 主力开仓名义仓位（倍）。
 * 两项都是名义仓位（开仓价 × 币量，USDT）：分子是主方向已成交的主力、镜像、加仓与重新入场腿的名义合计
 * （挂单与反向对冲不计），分母是入场时主力与镜像的初始敞口；没有加仓时就是 1.00。
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
): number | null {
  if (initialMainExposureNotional == null || !Number.isFinite(initialMainExposureNotional) || initialMainExposureNotional <= 0) return null;
  if (mainSideNotionalTotal == null || !Number.isFinite(mainSideNotionalTotal)) return null;
  return mainSideNotionalTotal / initialMainExposureNotional;
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
  return computePositionAmplification(initial, campaignMainSideNotional(campaign.direction, inputs).total);
}
