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

export function formatOpportunityQuality(value: number | null | undefined, digits = 2): string {
  return value != null && Number.isFinite(value) ? value.toFixed(digits) : '—';
}
