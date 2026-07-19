export interface OpportunityQualityInput {
  /** Expected profit/loss ratio, e.g. 5 means 5:1. */
  payoffRatio: number | null | undefined;
  /** Expected drawdown in percentage points, e.g. 2 means 2%. */
  drawdownPct: number | null | undefined;
}

export function computeOpportunityQuality({
  payoffRatio,
  drawdownPct,
}: OpportunityQualityInput): number | null {
  const ratio = Number(payoffRatio);
  const drawdown = Number(drawdownPct);
  if (!Number.isFinite(ratio) || !Number.isFinite(drawdown) || ratio <= 0 || drawdown <= 0) {
    return null;
  }
  return ratio / drawdown;
}

/**
 * Closed-campaign opportunity quality uses the ABSOLUTE realized payoff ratio.
 * 机会质量衡量的是这次机会的「量级」（|盈亏比| ÷ 回撤），只看幅度、不看盈亏方向——
 * 盈利 / 亏损另由胜率与盈亏列表达。亏损战役因此保留其正的机会质量，而非被记成负数。
 */
export function computeRealizedOpportunityQuality({
  payoffRatio,
  drawdownPct,
}: OpportunityQualityInput): number | null {
  const ratio = Number(payoffRatio);
  const drawdown = Number(drawdownPct);
  if (!Number.isFinite(ratio) || !Number.isFinite(drawdown) || drawdown <= 0) {
    return null;
  }
  return Math.abs(ratio) / drawdown;
}

export function formatOpportunityQuality(value: number | null | undefined, digits = 2): string {
  return value != null && Number.isFinite(value) ? value.toFixed(digits) : '—';
}
