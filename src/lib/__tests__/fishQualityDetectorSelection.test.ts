import { expect, it } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import type { QualityGroup } from '@/lib/fish/quality';
import { defaultQualityDetectorIds, qualityDetectorVariables } from '@/lib/fish/qualityDetectorSelection';

function group(id: string, featureId: string, statistic: string, threshold: number): QualityGroup {
  return { id, label: statistic, metric: statistic, snapshot: { featureId, statistic, threshold, direction: '>', interval: '5m', scale: 1, cutoffMs: 1, average: 1, cbi2: 1, startAverage: 1, previousAverage: 0 } };
}
const defaults = () => [group('cbi', 'cbi2', 'avg_CBI2', .04), group('cba', 'cba', 'avg_CBA', 8), group('cbi2', 'cbi2', 'avg_CBI2_2', .04), group('cba2', 'cba', 'avg_CBA_2', 8)];

it('defaults to exactly the four pictured levels, not other thresholds, directions, constraints or similarly named features', () => {
  const good = defaults(), other = group('other', 'cbi2', 'avg_CBI2', .06);
  const wrongDirection = { ...good[0], id: 'lower', snapshot: { ...good[0].snapshot, direction: '<' as const } };
  const constrained = { ...good[0], id: 'extra', snapshot: { ...good[0].snapshot, constraints: ['C > O'] } };
  const misleading = group('misleading', 'state', 'avg_CBI2', .04);
  expect(defaultQualityDetectorIds([other, ...good, wrongDirection, constrained, misleading])).toEqual(good.map(g => g.id));
  expect(defaultQualityDetectorIds([])).toEqual([]);
});

it('recognizes historical 结果 from its frozen formula and keeps raw or externally averaged results out', () => {
  const legacy = group('legacy', 'cbi2', '结果', .04);
  legacy.snapshot.definitionKey = definitionKey({ formula: 'CBI2 = C\navg_CBI2 = avg(CBI2,24)\navg_CBI2_2 = avg(avg_CBI2,24)', positive: '1', control: '0' });
  const raw = { ...legacy, id: 'raw', snapshot: { ...legacy.snapshot, statistic: 'CBI2' } };
  const external = { ...legacy, id: 'external', snapshot: { ...legacy.snapshot, H: 24 } };
  expect(defaultQualityDetectorIds([legacy, raw, external])).toEqual(['legacy']);
});

it('puts checked variables and levels first, preserves their groups and leaves saved data untouched', () => {
  const preferred = defaults(), otherLevel = group('other-level', 'cbi2', 'avg_CBI2', .06), state = group('state', 'state', 'avg_state_2', .6);
  const input = [otherLevel, state, ...preferred], before = JSON.stringify(input);
  const variables = qualityDetectorVariables(input, ['state', 'cbi']);
  expect(variables.map(v => v.levels[0].id)).toEqual(['cbi', 'state', 'cba', 'cbi2', 'cba2']);
  expect(variables[0].levels.map(g => g.id)).toEqual(['cbi', 'other-level']);
  expect(JSON.stringify(input)).toBe(before);
});
