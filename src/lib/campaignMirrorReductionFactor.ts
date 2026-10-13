import { computeCampaignGeometricMetrics } from '@/lib/campaignGeometricMetrics';
import type { CampaignAddSizingInput } from '@/lib/campaignAddSizingCheck';
import type { LegGeometricFactor } from '@/lib/campaignLegGeometricFactor';
import type { TradeCampaign } from '@/types/journal';

export const MIRROR_REDUCTION_FACTOR_HINT = '镜像止盈为减仓：本次因子 = 1 − αf；αf = 首次实际减仓币数 ÷ 减仓前主力与镜像合计币数。理论累计公式也采用这次实际减仓，因此减仓因子的实际值与理论值相同。同一次首次减仓若分多腿成交，逐腿扣减，因子相乘等于总保留比例；后续减仓不属于当前首次减仓因子。';

/** Reuse the exact first-cut ledger behind both campaign products. */
export function buildCampaignMirrorReductionFactors(campaign: TradeCampaign, input: CampaignAddSizingInput): Map<string, LegGeometricFactor | null> {
  const mirrors = input.legs.filter(leg => leg.leg_role === 'mirror_tp');
  if (!mirrors.length) return new Map();
  const basis = computeCampaignGeometricMetrics(campaign, input.legs, input.tradeRecords, input.reverseHedgeOrders, input.legExitPriceCorrections).geometricMetricBasis;
  return new Map(mirrors.map(leg => [leg.id, basis.initialReductionFactors?.find(factor => factor.legId === leg.id) ?? null]));
}
