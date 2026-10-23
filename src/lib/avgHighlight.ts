import { rollingMean, barsForHours } from '@/lib/deepDig/formula';
/** Display-only calibration; raw indicators and their formulas do not use these limits. */
export const AVG_HIGHLIGHT_COLORS = { buyer: '#0ECB81', seller: '#F6465D', neutral: '#848E9C' } as const;
export type AverageKind = 'avg' | 'avg2';
/** All N share this frozen, fully closed historical corpus; changing N never changes the sample. */
export const AVG_CALIBRATION_CUTOFF = Date.parse('2026-10-23T08:30:00Z');
export function avgCoreKey(symbols: readonly string[], def: { id: string; formula: string; scale: number; halfLifeHours?: number; avgHours?: number }, period: number): string {
  return JSON.stringify([1, AVG_CALIBRATION_CUTOFF, [...symbols].sort(), def.id, def.formula, def.scale, def.halfLifeHours ?? 6, def.avgHours ?? 24, period]);
}
export const avgResultKey = (coreKey: string, hours: number, kind: AverageKind) => JSON.stringify([coreKey, hours, kind]);
export const AVG_HIGHLIGHT_SPECS = [
  { id: 'CBI2', featureId: 'cbi2', core: 'CBI2', center: 0, range: [-1, 1] },
  { id: 'CDI2', featureId: 'cdi2', core: 'CDI2', center: 0, range: [-1, 1] },
  { id: 'DSP_Z', featureId: 'drift-speed-z', core: 'az', center: 0, range: null },
  { id: 'SELLER_CONTROL', featureId: 'seller-control', core: 'bc', center: 0, range: null },
  { id: 'STATE', featureId: 'state', core: 'state', center: 0.5, range: [0, 1] },
  { id: 'STATE2', featureId: 'state2', core: 'state2', center: 0.5, range: [0, 1] },
  { id: 'BSS', featureId: 'bss', core: 'BSS', center: 0, range: [-1, 1] },
  { id: 'DSS', featureId: 'dss', core: 'DSS', center: 0, range: [-1, 1] },
  { id: 'CBA', featureId: 'cba', core: 'CBA', center: 0, range: [-100, 100] },
  { id: 'CDA', featureId: 'cda', core: 'CDA', center: 0, range: [-100, 100] },
] as const;
export type AvgHighlightSpec = typeof AVG_HIGHLIGHT_SPECS[number];
export interface AverageLimits { lower: number; upper: number; d: number; count: number; above: number; below: number }
export function averageHighlightColor(value: number | null | undefined, limits?: Pick<AverageLimits, 'lower' | 'upper'>): string {
  if (!Number.isFinite(value) || !limits) return AVG_HIGHLIGHT_COLORS.neutral;
  return value! > limits.upper ? AVG_HIGHLIGHT_COLORS.buyer : value! < limits.lower ? AVG_HIGHLIGHT_COLORS.seller : AVG_HIGHLIGHT_COLORS.neutral;
}
/** Same 4:3:2:1 segmented average as avg_X_2. N denotes the complete four-block window. */
export function displayAverage(values: ArrayLike<number | null>, hours: number, kind: AverageKind): Float64Array {
  if (!(hours > 0) || !Number.isFinite(hours)) throw Error('均值时长 N 必须为正数');
  const core = Float64Array.from(values, v => v == null ? NaN : v);
  if (kind === 'avg') return rollingMean(core, barsForHours(hours, 5));
  const block = rollingMean(core, barsForHours(hours / 4, 5));
  const out = new Float64Array(values.length).fill(NaN);
  const offsets = [0, 1, 2, 3].map(k => k === 0 ? 0 : barsForHours(hours * k / 4, 5));
  for (let i = 0; i < values.length; i++) {
    if (offsets.every(k => i >= k && Number.isFinite(block[i - k])))
      out[i] = (4 * block[i] + 3 * block[i - offsets[1]] + 2 * block[i - offsets[2]] + block[i - offsets[3]]) / 10;
  }
  return out;
}
/** Exact pooled empirical quantile with linear interpolation (type 7). */
export function calibratedAverageLimits(values: ArrayLike<number>, spec: AvgHighlightSpec): AverageLimits {
  const finite = Float64Array.from(Array.from(values).filter(Number.isFinite));
  if (!finite.length) throw Error('没有有效历史均值，不能校准高亮界限');
  const deviations = Float64Array.from(finite, v => Math.abs(v - spec.center)).sort();
  const at = (deviations.length - 1) * 0.6, lo = Math.floor(at);
  let d = deviations[lo] + (deviations[Math.ceil(at)] - deviations[lo]) * (at - lo);
  if (spec.range) d = Math.min(d, spec.center - spec.range[0], spec.range[1] - spec.center);
  const lower = spec.center - d, upper = spec.center + d;
  let above = 0, below = 0;
  for (const value of finite) { if (value > upper) above++; if (value < lower) below++; }
  return { lower, upper, d, count: finite.length, above: above / finite.length, below: below / finite.length };
}
