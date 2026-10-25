import { expect, it } from 'vitest';
import { CBI2_DEF, CBA_DEF, BSS_DEF, DRIFT_SPEED_Z_DEF, STATE_DEF, definitionKey } from '@/lib/deepDig/features';
import { fishSourceLabel, fishCaughtBy, collapseVisibleFish, legacyFishVisibleCatchKey, fishVisibleKey } from '@/lib/fish/records';
import { applyFishTombstones } from '@/lib/fish/tombstones';
import type { TradeSignal } from '@/lib/signalLibrary';

it.each([
  ['CBI-2', CBI2_DEF, 'CBI2'], ['CBA', CBA_DEF, 'CBA'], ['BSS', BSS_DEF, 'BSS'],
  ['az', DRIFT_SPEED_Z_DEF, 'az'], ['S', STATE_DEF, 'state'],
] as const)('%s labels the actual original, avg, avg₂ and avg₃ separately, including the result alias', (label, base, raw) => {
  const def = { ...base, formula: `${raw}=C\navg_${raw}=avg(${raw},24)\navg_${raw}_2=avg(${raw},12)\navg_${raw}_3=avg(${raw},6)` };
  const saved = { featureId: def.id, featureShort: def.short, definitionKey: definitionKey(def) };
  const before = JSON.stringify(saved);
  expect([raw, `avg_${raw}`, `avg_${raw}_2`, `avg_${raw}_3`, '结果'].map(statistic=>fishSourceLabel({ ...saved, statistic })))
    .toEqual([`${label} 原值`, `${label}·avg`, `${label}·avg₂`, `${label}·avg₃`, `${label}·avg₃`]);
  expect(JSON.stringify(saved)).toBe(before);
});

const row = (metric: string): TradeSignal => ({ id:metric, symbol:'AAAUSDT', timeMs:1000, timeLabel:'', fallbackZone:'', caughtAt:100,
  fish:{ featureId:'cbi2', featureShort:'CBI-2', statistic:metric, algorithmKey:`cbi2|${metric}|=|>|0.04|x`,
    average:1, cbi2:1, startAverage:1, previousAverage:0, cutoffMs:2000, threshold:0.04 } });

it('does not collapse same-time subtypes or omit a second hit of the same indicator', () => {
  const rows = ['CBI2','avg_CBI2','avg_CBI2_2'].map(row);
  expect(collapseVisibleFish(rows)).toHaveLength(3);
  const union = { ...rows[0], fish:{ ...rows[0].fish!, algorithms:rows.map(r=>r.fish!), combination:'or' as const, hitAlgorithms:[2,3] } };
  expect(fishCaughtBy(union)).toEqual(['CBI-2·avg','CBI-2·avg₂']);
});

it('honors old deletion markers after relabeling, while new markers delete only the selected subtype', () => {
  const avg=row('avg_CBI2'), avg2=row('avg_CBI2_2');
  const oldKey=`v|${legacyFishVisibleCatchKey(avg)}|archive`;
  expect(applyFishTombstones([avg,avg2],{[oldKey]:200})).toEqual([]);
  expect(applyFishTombstones([{...avg,caughtAt:300}],{[oldKey]:200})).toHaveLength(1);
  expect(applyFishTombstones([avg,avg2],{[`v|${fishVisibleKey(avg)}`]:200})).toEqual([avg2]);
});
