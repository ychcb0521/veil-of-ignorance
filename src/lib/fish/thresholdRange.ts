/** Preferences and template archives retain the exact text entered in the editor. */
export interface FishRange { min?: number; max?: number }
export type CaptureDirection = '>' | '<';
export interface CaptureLimit { threshold: number; direction: CaptureDirection; range?: FishRange }

export const encodeFishRange = (min: string | number = '', max: string | number = '') => `[${min},${max}]`;
export function fishRangeFields(text: string): [string, string] | undefined {
  const match = /^\[([^,]*),([^,]*)\]$/.exec(text.trim());
  return match ? [match[1].trim(), match[2].trim()] : undefined;
}

export function validateFishRange({ min, max }: FishRange) {
  if (min === undefined && max === undefined) throw Error('区间至少填写一个边界');
  if ([min, max].some(n => n !== undefined && !Number.isFinite(n))) throw Error('区间边界必须是有限数字');
  if (min !== undefined && max !== undefined && min > max) throw Error('区间下限不能大于上限');
}

export function captureLimit(text: string, direction: CaptureDirection): CaptureLimit {
  const fields = fishRangeFields(text);
  if (!fields) {
    const threshold = text.trim() ? Number(text) : NaN;
    if (!Number.isFinite(threshold)) throw Error('请填写有限数字阈值');
    return { direction, threshold };
  }
  const range: FishRange = {};
  if (fields[0]) range.min = Number(fields[0]);
  if (fields[1]) range.max = Number(fields[1]);
  validateFishRange(range);
  const primary = range.min === undefined ? '<' : range.max === undefined ? '>' : direction;
  return { range, direction: primary, threshold: primary === '>' ? range.min! : range.max! };
}

export function savedCaptureLimit(text: string | undefined, direction: CaptureDirection = '>'): CaptureLimit | undefined {
  if (!text) return;
  try { return captureLimit(text, direction); } catch { return; }
}

/** Reconstruction varies the originally selected boundary and preserves the opposite bound. */
export function rangeAtThreshold(range: FishRange, threshold: number, direction: CaptureDirection): FishRange {
  return direction === '<' ? { ...range, max: threshold } : { ...range, min: threshold };
}

export function rangeLabel({ min, max }: FishRange) {
  if (min === undefined) return `≤ ${max}`;
  if (max === undefined) return `≥ ${min}`;
  return `[${min}, ${max}]`;
}

export function captureLimitText(direction: string, threshold: number | string, range?: FishRange) {
  if (range) return rangeLabel(range);
  const fields = typeof threshold === 'string' ? fishRangeFields(threshold) : undefined;
  if (!fields) return `${direction} ${threshold}`;
  const [min, max] = fields;
  if (min && max) return `[${min}, ${max}]`;
  if (min) return '≥ ' + min;
  if (max) return '≤ ' + max;
  return '区间待填';
}

export function captureLimitExpression(series: string, limit: CaptureLimit, scale: number) {
  if (!limit.range) return `${series} ${limit.direction} ${limit.threshold / scale}`;
  validateFishRange(limit.range);
  const { min, max } = limit.range;
  if ([min, max].some(n => n !== undefined && !Number.isFinite(n / scale))) throw Error('换算后的区间边界超出有效范围');
  const terms: string[] = [];
  if (min !== undefined) terms.push(`(${series} >= ${min / scale})`);
  if (max !== undefined) terms.push(`(${series} <= ${max / scale})`);
  return terms.join(' and ');
}

export function withinCaptureLimit(raw: number, limit: CaptureLimit, scale: number) {
  if (!Number.isFinite(raw)) return false;
  if (!limit.range) return limit.direction === '>' ? raw > limit.threshold / scale : raw < limit.threshold / scale;
  const { min, max } = limit.range;
  return (min === undefined || raw >= min / scale) && (max === undefined || raw <= max / scale);
}

export function captureLimitSubset(base: CaptureLimit, target: CaptureLimit) {
  const lower = (limit: CaptureLimit) => limit.range ? (limit.range.min ?? -Infinity) : limit.direction === '>' ? limit.threshold : -Infinity;
  const upper = (limit: CaptureLimit) => limit.range ? (limit.range.max ?? Infinity) : limit.direction === '<' ? limit.threshold : Infinity;
  if (lower(target) < lower(base) || upper(target) > upper(base)) return false;
  // A closed endpoint equal to a legacy strict cutoff includes previously unscanned readings.
  if (target.range && !base.range) return base.direction === '>' ? lower(target) > lower(base) : upper(target) < upper(base);
  return true;
}
