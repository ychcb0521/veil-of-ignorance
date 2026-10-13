import { evaluateCampaignAddSizing, formatAddSizingCoinQuantity, resolveCampaignAddQuantitySteps, type AddSizingVerdict, type CampaignAddSizingInput } from '@/lib/campaignAddSizingCheck';

export const LEG_GEOMETRIC_FACTOR_LABEL = '仓位的几何复利（1+α）';
export const LEG_GEOMETRIC_FACTOR_HINT = '仓位的几何复利：本次仓位倍数 = 1 + α；α = 本次实际加仓币数 ÷ 加仓前实际持币数。按实际成交计算，不是可允许加仓上限。各次倍数的乘积再乘 (1−αf)，得到实际几何仓位；αf 为首次减仓币数占初始主力与镜像合计币数的比例。';

export interface LegGeometricFactor {
  kind?: 'reduction';
  beforeCoins: number;
  addCoins: number;
  multiple: number;
}

export interface LegTheoreticalGeometricFactor extends LegGeometricFactor {
  costLine: number; support: number; adjustedSupport: number; addPrice: number;
  bankedProfit: number; firstAdd: boolean; alpha: number;
}

export const LEG_THEORETICAL_FACTOR_HINT = '仓位的几何复利（理论）：α₁ = max(0, K₁ + G ÷ Q₁ − S₁) ÷ (T₁ − K₁)。K₁ + G ÷ Q₁ 只用于分子的等效覆盖预算，分母保留实际支撑线。之后 αₖ = max(0, Kₖ − S前) ÷ (Tₖ − Kₖ)，S前为当次加仓前实际仓位的加权成本线，不扣 G。各轮按实际持仓状态独立推算，不模拟另一套理论成交；缺少依据显示「—」。空单方向按价格距离对称计算。';

/** Price-derived capacities, distinct from actual fills and the ongoing Plan B verdict. */
export function buildCampaignLegTheoreticalFactors(input: CampaignAddSizingInput, verdicts?: Map<string, AddSizingVerdict>): Map<string, LegTheoreticalGeometricFactor | null> {
  const checks = verdicts ?? evaluateCampaignAddSizing(input);
  const firstDirections = new Set<string>();
  return new Map(resolveCampaignAddQuantitySteps(input).map(step => {
    const leg = input.legs.find(item => item.id === step.legId)!;
    const firstAdd = !firstDirections.has(leg.direction ?? 'long');
    firstDirections.add(leg.direction ?? 'long');
    const v = checks.get(step.legId), d = leg.direction === 'short' ? -1 : 1;
    const Q = step.beforeCoins, K = v?.s1, T = v?.s2, Y = v?.cushion;
    const G = firstAdd ? v?.banked : 0;
    if (!v || v.status === 'unknown' || Q == null || !(Q > 0) || K == null || T == null || Y == null || G == null
      || ![Q, K, T, Y, G].every(Number.isFinite) || (T - K) * d <= 0) return [step.legId, null];
    const costLine = K - Y / (Q * d), adjustedSupport = K + d * G / Q;
    const alpha = Math.max(0, (adjustedSupport - costLine) * d) / ((T - K) * d), multiple = 1 + alpha;
    if (![costLine, adjustedSupport, alpha, multiple, Q * alpha].every(Number.isFinite) || costLine <= 0) return [step.legId, null];
    return [step.legId, { beforeCoins: Q, addCoins: Q * alpha, multiple, costLine, support: K, adjustedSupport, addPrice: T, bankedProfit: G, firstAdd, alpha }];
  }));
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
  if (factor?.kind === 'reduction') return `1 − αf = 1 − ${formatAddSizingCoinQuantity(factor.addCoins)} ÷ ${formatAddSizingCoinQuantity(factor.beforeCoins)} ≈ ${formatLegGeometricFactor(factor)}；减仓前基数包含初始主力与镜像币数。`;
  return factor
    ? `1 + α = 1 + ${formatAddSizingCoinQuantity(factor.addCoins)} ÷ ${formatAddSizingCoinQuantity(factor.beforeCoins)} ≈ ${formatLegGeometricFactor(factor)}；按完整精度计算，显示值四舍五入。`
    : '缺少实际加仓币数或加仓前持币数，无法计算。';
}
