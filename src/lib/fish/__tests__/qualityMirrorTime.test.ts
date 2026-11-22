import { expect, it } from 'vitest';
import type { QualityResult } from '../quality';
import { qualityMirrorTimeHours, qualityMirrorTimeText } from '../qualityPresentation';

const T = Date.UTC(2026, 10, 22);
const result: QualityResult = { key: 'frozen', sampleId: 's', groupId: 'p', status: 'closed', evaluatedAt: T + 12 * 3600_000,
  entryTime: T, entryPrice: 100, endTime: T + 10 * 3600_000, endPrice: 120,
  mirrorFill: { at: T + 2 * 3600_000, price: 105, fraction: .5, gainPct: 5, atOpen: false } };

it('measures original entry to actual mirror execution independently of the final exit and preserves the frozen record', () => {
  const before = structuredClone(result);
  expect(qualityMirrorTimeHours(result)).toBe(2);
  expect(qualityMirrorTimeHours({ ...result, status: 'open', evaluatedAt: T + 50 * 3600_000 })).toBe(2);
  expect(result).toEqual(before);
});
it('retains zero duration for a genuine execution in the entry minute', () => {
  expect(qualityMirrorTimeHours({ ...result, mirrorFill: { ...result.mirrorFill!, at: T, atOpen: true } })).toBe(0);
});
it.each([
  undefined,
  { ...result, mirrorFill: undefined, peakPct: 999 },
  { ...result, entryTime: undefined },
  { ...result, entryTime: Number.NaN },
  { ...result, status: 'error' as const },
  { ...result, mirrorFill: { ...result.mirrorFill!, at: T - 1 } },
  { ...result, mirrorFill: { ...result.mirrorFill!, at: Infinity } },
  { ...result, mirrorFill: { ...result.mirrorFill!, fraction: 0 } },
])('does not invent elapsed time for an absent, incomplete or invalid execution %#', value => {
  expect(qualityMirrorTimeHours(value)).toBeNull();
});
it.each([
  [null, '—'], [0, '0 秒'], [1 / 120, '30 秒'], [1 / 6, '10 分钟'], [1.5, '1.5 小时'], [72, '3.0 天'],
] as const)('formats %s hours as a duration with units', (hours, text) => {
  expect(qualityMirrorTimeText(hours)).toBe(text);
});
