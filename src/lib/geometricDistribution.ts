import type { CampaignMetricPoint } from '@/lib/campaignMetricSeries';
import { metricDistributionDomain } from '@/lib/oddsDistribution';
import { silvermanBandwidth } from '@/lib/kernelDensity';

/** The stored metric is G−1. Only position/density use ln(G); summaries keep the stored values. */
export function geometricLogPosition(edge: number): number | null {
  return Number.isFinite(edge) && edge > -1 ? Math.log1p(edge) : null;
}

export function formatGeometricDistributionValue(edge: number): string {
  const factor = 1 + edge;
  if (factor === 0) return '0.00';
  if (factor < 0.01 || factor >= 10_000) return factor.toPrecision(3);
  return factor.toFixed(2);
}

export function buildGeometricDistributionModel(points: CampaignMetricPoint[]) {
  const zeroIds = points.filter(point => point.value === -1).map(point => point.campaignId);
  const values = points.flatMap(point => {
    const value = geometricLogPosition(point.value);
    return value == null ? [] : [value];
  });
  const robust = values.length ? metricDistributionDomain(values) : { min: 0, max: 0 };
  // Keep both sides of break-even visible, even for all-win/all-zero samples.
  const min = Math.min(-Math.LN2, robust.min);
  const max = Math.max(Math.LN2, robust.max);
  const span = max - min;
  const candidates: number[] = [0];
  for (let exponent = Math.floor(min / Math.LN10); exponent <= Math.ceil(max / Math.LN10); exponent++) {
    for (const multiplier of [1, 2, 5]) {
      const at = exponent * Math.LN10 + Math.log(multiplier);
      if (at >= min - 1e-10 && at <= max + 1e-10 && Math.abs(at) > 1e-10) candidates.push(at);
    }
  }
  // Reserve 1.00 first; leave enough room between multiplicative tick labels.
  const ticks = [0];
  for (const at of candidates.sort((a, b) => Math.abs(a) - Math.abs(b))) {
    if (ticks.every(other => Math.abs(other - at) >= span / 7)) ticks.push(at);
  }
  return {
    zeroIds,
    values,
    bandwidth: silvermanBandwidth(values),
    domain: { min, max },
    labels: ticks.sort((a, b) => a - b).map(at => ({
      at,
      text: formatGeometricDistributionValue(Math.expm1(at)),
    })),
  };
}
