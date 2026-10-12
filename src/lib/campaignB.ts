/** The geometric definition is the sole source of b; net settlement is a separate metric. */
export const PAYOFF_RATIO_FORMULA = '盈亏比 = 已实现净盈亏 ÷ 初始最大预期亏损 L₀';

export function resolveUnifiedMagicB(geometricB: number | null | undefined): number | null {
  return geometricB != null && Number.isFinite(geometricB) ? geometricB : null;
}

/** Original signed profit-to-initial-risk ratio, independent of any add-position model. */
export function computeSettlementPayoffRatio(pnl: number | null | undefined, initialRisk: number | null | undefined): number | null {
  if (pnl == null || initialRisk == null || !Number.isFinite(pnl) || !Number.isFinite(initialRisk) || initialRisk <= 0) return null;
  const ratio = pnl / initialRisk;
  return Number.isFinite(ratio) ? ratio : null;
}
