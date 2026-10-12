/** One signed risk-unit metric. Legacy percent fields remain storage-compatible. */
export const MAGIC_B_DIRECT_FORMULA = '神奇的 b = 已实现净盈亏 ÷ 初始最大预期亏损 L₀';

export function magicBFromRealizedPnl(pnl: number | null | undefined, initialRisk: number | null | undefined): number | null {
  if (pnl == null || initialRisk == null || !Number.isFinite(pnl) || !Number.isFinite(initialRisk) || initialRisk <= 0) return null;
  const b = pnl / initialRisk;
  return Number.isFinite(b) ? b : null;
}

/** Explicit null means unknown, never replace it with a stale geometric/cache value. */
export function resolveUnifiedMagicB(legacyPercent: number | null | undefined, geometricB?: number | null): number | null {
  if (legacyPercent !== undefined) return legacyPercent != null && Number.isFinite(legacyPercent) ? legacyPercent / 100 : null;
  return geometricB != null && Number.isFinite(geometricB) ? geometricB : null;
}
