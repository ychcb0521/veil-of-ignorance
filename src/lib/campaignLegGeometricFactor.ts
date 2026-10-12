import { formatAddSizingCoinQuantity, resolveCampaignAddQuantitySteps, type CampaignAddSizingInput } from '@/lib/campaignAddSizingCheck';

export const LEG_GEOMETRIC_FACTOR_LABEL = '仓位的几何复利（1+α）';
export const LEG_GEOMETRIC_FACTOR_HINT = '本次仓位倍数 = 1 + α；α = 本次实际加仓币数 ÷ 加仓前实际持币数。按实际成交计算，不是可允许加仓上限；各次倍数的乘积为仓位几何累积倍数。';

export interface LegGeometricFactor {
  beforeCoins: number;
  addCoins: number;
  multiple: number;
}

/** Share the actual partial-close ledger with the campaign's alpha product. */
export function buildCampaignLegGeometricFactors(input: CampaignAddSizingInput): Map<string, LegGeometricFactor | null> {
  return new Map(resolveCampaignAddQuantitySteps(input).map(step => {
    const before = step.beforeCoins;
    const added = step.addCoins;
    const multiple = before != null && added != null ? 1 + added / before : NaN;
    return [step.legId, Number.isFinite(step.openTime) && before != null && added != null
      && before > 0 && added > 0 && [before, added, multiple].every(Number.isFinite)
      ? { beforeCoins: before, addCoins: added, multiple } : null];
  }));
}

export function formatLegGeometricFactor(factor: LegGeometricFactor | null | undefined): string {
  return factor ? `${factor.multiple.toFixed(2)}×` : '—';
}

export function describeLegGeometricFactor(factor: LegGeometricFactor | null | undefined): string {
  return factor
    ? `1 + α = 1 + ${formatAddSizingCoinQuantity(factor.addCoins)} ÷ ${formatAddSizingCoinQuantity(factor.beforeCoins)} ≈ ${formatLegGeometricFactor(factor)}；按完整精度计算，显示值四舍五入。`
    : '缺少实际加仓币数或加仓前持币数，无法计算。';
}
