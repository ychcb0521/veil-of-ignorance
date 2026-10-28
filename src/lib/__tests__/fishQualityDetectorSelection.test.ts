import { expect, it } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import type { QualityGroup } from '@/lib/fish/quality';
import { defaultQualityDetectorIds, qualityDetectorChoices } from '@/lib/fish/qualityDetectorSelection';
import { FISH_DEFAULT_RULES } from '@/lib/fish/defaultRules';

function group(id: string, featureId: string, statistic: string, threshold: number): QualityGroup {
  return { id, label: statistic, metric: statistic, snapshot: { featureId, statistic, threshold, direction: '>', interval: '5m', scale: 1, cutoffMs: 1, average: 1, cbi2: 1, startAverage: 1, previousAverage: 0 } };
}
const defaults = () => [group('cbi', 'cbi2', 'avg_CBI2', .04), group('cba', 'cba', 'avg_CBA', 8), group('cbi2', 'cbi2', 'avg_CBI2_2', .04), group('cba2', 'cba', 'avg_CBA_2', 8)];

it('defaults to exactly the four default rules (in 捕捞 card order), not other thresholds, directions, constraints or similarly named features', () => {
  const good = defaults(), other = group('other', 'cbi2', 'avg_CBI2', .06);
  const wrongDirection = { ...good[0], id: 'lower', snapshot: { ...good[0].snapshot, direction: '<' as const } };
  const constrained = { ...good[0], id: 'extra', snapshot: { ...good[0].snapshot, constraints: ['C > O'] } };
  const misleading = group('misleading', 'state', 'avg_CBI2', .04);
  expect(defaultQualityDetectorIds([other, ...good, wrongDirection, constrained, misleading])).toEqual(['cbi2', 'cba2', 'cbi', 'cba']);
  expect(defaultQualityDetectorIds([])).toEqual([]);
});

it('recognizes historical 结果 from its frozen formula and keeps raw or externally averaged results out', () => {
  const legacy = group('legacy', 'cbi2', '结果', .04);
  legacy.snapshot.definitionKey = definitionKey({ formula: 'CBI2 = C\navg_CBI2 = avg(CBI2,24)\navg_CBI2_2 = avg(avg_CBI2,24)', positive: '1', control: '0' });
  const raw = { ...legacy, id: 'raw', snapshot: { ...legacy.snapshot, statistic: 'CBI2' } };
  const external = { ...legacy, id: 'external', snapshot: { ...legacy.snapshot, H: 24 } };
  expect(defaultQualityDetectorIds([legacy, raw, external])).toEqual(['legacy']);
});

// 【用户要求】2026-10-28 下拉只列捕捞 / 批量挖掘的默认算法与数值，其余全部不列；默认新增一条这里自动多一项
it('lists only the default rules, in default order, merging historical versions of the same rule', () => {
  const [cbi, cba, cbi2, cba2] = defaults(), older = { ...cbi, id: 'cbi-old', snapshot: { ...cbi.snapshot, definitionKey: 'older-formula' } };
  const noise = [group('other-level', 'cbi2', 'avg_CBI2', .06), group('state', 'state', 'avg_state_2', .6), group('cba10', 'cba', 'avg_CBA', 10)];
  const input = [...noise, cba, older, cbi, cbi2, cba2], before = JSON.stringify(input);
  const choices = qualityDetectorChoices(input);
  expect(choices.map(c => [c.label, c.threshold])).toEqual([['avg_CBI2_2', .04], ['avg_CBA_2', 8], ['avg_CBI2', .04], ['avg_CBA', 8]]);
  expect(choices.map(c => c.key)).toEqual(FISH_DEFAULT_RULES.map(r => r.id));
  expect(choices[2].ids).toEqual(['cbi-old', 'cbi']);
  expect(qualityDetectorChoices(noise)).toEqual([]);
  expect(JSON.stringify(input)).toBe(before);
});
