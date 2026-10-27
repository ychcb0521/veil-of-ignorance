import { expect, it } from 'vitest';
import { BSS_DEF, definitionKey } from '@/lib/deepDig/features';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { importQualityFish, newQualityStudy, qualityDisplayRows, qualityFilterReadingKey, qualityResultKey, qualityRunSamples, type FishQualityStudy, type QualityResult } from '@/lib/fish/quality';
import { makeQualityBuyFilter, makeQualityHoldingVeto } from '@/lib/fish/qualityFilters';
import { adoptQualityMonitorHistory, beginQualityMonitorRound, captureQualityMonitorResult, finishQualityMonitorRound, preserveQualityMonitorLibrary } from '@/lib/fish/qualityMonitorLibrary';
const T = Date.UTC(2026, 9, 27);
function monitorStudy(): FishQualityStudy {
  const s = enableQualityComparison(importQualityFish(newQualityStudy(T), [{ id: 'fish', symbol: 'AAAUSDT', timeMs: T - 300000, timeLabel: '', fallbackZone: '', fish: { featureId: 'bss', featureShort: 'BSS', definitionKey: definitionKey(BSS_DEF), statistic: '结果', cutoffMs: T, threshold: .12, average: .2, cbi2: .2, startAverage: .2, previousAverage: .1, direction: '>', scale: 1 } }]));
  s.sellPlans = [{ ...s.sellPlans![0], rule: { metric: 'state', direction: '<', threshold: .5 } }];
  s.selectedRowIds = qualityDisplayRows(s).map(r => r.id); return s;
}
function result(s: FishQualityStudy, value = 10): QualityResult {
  const row = qualityRunSamples(s)[0], plan = s.sellPlans![0];
  return { key: qualityResultKey(row, plan, s.observeHours), sampleId: row.id, groupId: plan.id, evaluatedAt: T + 600000, status: 'closed', complete: true, entryTime: T, entryPrice: 100, endTime: T + 600000, endPrice: 100 + value, returnPct: value, pnl: value, adversePct: -2, drawdownPct: 3 };
}
it('saves each round, merges identical trials and freezes different exit thresholds, vetoes, formulas and buying conditions', () => {
  const source = monitorStudy(), first = beginQualityMonitorRound(source, structuredClone(source), T + 1);
  let saved = captureQualityMonitorResult(first.study, first.capture, result(source), T + 2);
  saved = finishQualityMonitorRound(saved, first.capture, 'complete', T + 3);
  const again = beginQualityMonitorRound(saved, structuredClone(saved), T + 4);
  saved = captureQualityMonitorResult(again.study, again.capture, result(saved, 12), T + 5);
  saved = finishQualityMonitorRound(saved, again.capture, 'complete', T + 6);
  expect(saved.monitorLibrary!.records).toHaveLength(1); expect(saved.monitorLibrary!.rounds).toHaveLength(2);
  expect(saved.monitorLibrary!.records[0].result?.returnPct).toBe(12);
  const variants = [
    (s: FishQualityStudy) => { s.sellPlans![0].rule!.threshold = .4; },
    (s: FishQualityStudy) => { s.sellPlans![0].holdingVetoes = [makeQualityHoldingVeto('static-drawdown', '>=', 5)]; },
    (s: FishQualityStudy) => { s.sellPlans![0].snapshot.definitionKey += 'changed-formula'; },
    (s: FishQualityStudy) => { s.sellPlans![0].buyFilters = [makeQualityBuyFilter('state:state', '>', .7)]; },
  ];
  for (const edit of variants) {
    const current = structuredClone(saved); edit(current);
    const next = beginQualityMonitorRound(current, current, T + 10 + saved.monitorLibrary!.rounds.length);
    saved = finishQualityMonitorRound(next.study, next.capture, 'complete', T + 20 + saved.monitorLibrary!.rounds.length);
  }
  expect(saved.monitorLibrary!.records).toHaveLength(5);
  expect(saved.monitorLibrary!.settings[0].plan.rule?.threshold).toBe(.5);
  expect(saved.monitorLibrary!.settings[0].plan.holdingVetoes).toBeUndefined();
  expect(saved.monitorLibrary!.settings[0].plan.buyFilters).toEqual([]);
});
it('deduplicates equivalent condition order while keeping different detector thresholds, exchanges and entry times separate', () => {
  let s = monitorStudy();
  const a = makeQualityBuyFilter('state:state', '>', .7), b = makeQualityBuyFilter('cda:CDA', '>', 0);
  s.sellPlans![0].buyFilters = [a, b];
  let next = beginQualityMonitorRound(s, s, T); s = next.study;
  s = { ...s, sellPlans: [{ ...s.sellPlans![0], buyFilters: [b, a] }] };
  next = beginQualityMonitorRound(s, s, T + 1); expect(next.study.monitorLibrary!.records).toHaveLength(1);
  s = structuredClone(next.study); s.groups[0].snapshot.threshold = .2;
  next = beginQualityMonitorRound(s, s, T + 2); expect(next.study.monitorLibrary!.records).toHaveLength(2);
  s = structuredClone(next.study); s.samples[0].source.exchange = 'bitget'; s.selectedRowIds = qualityDisplayRows(s).map(r => r.id);
  next = beginQualityMonitorRound(s, s, T + 3); expect(next.study.monitorLibrary!.records).toHaveLength(3);
  s = structuredClone(next.study); s.samples[0].enteredAt! += 60000; s.selectedRowIds = qualityDisplayRows(s).map(r => r.id);
  next = beginQualityMonitorRound(s, s, T + 4); expect(next.study.monitorLibrary!.records).toHaveLength(4);
});
it('records filtering failures, missing data and paused rounds without inventing a zero return', () => {
  const s = monitorStudy(), f = makeQualityBuyFilter('state:state', '>', .7); s.sellPlans![0].buyFilters = [f];
  const next = beginQualityMonitorRound(s, s, T), task = [...next.capture.tasks.values()][0];
  expect(next.study.monitorLibrary!.records[0].result).toBeUndefined();
  next.capture.readings.set(qualityFilterReadingKey(task.sample, f), { key: qualityFilterReadingKey(task.sample, f), value: .2 });
  let saved = finishQualityMonitorRound(next.study, next.capture, 'paused', T + 1);
  expect(saved.monitorLibrary!.rounds[0].state).toBe('paused'); expect(saved.monitorLibrary!.records[0].filterStatus.state).toBe('fail');
  expect(saved.monitorLibrary!.records[0].result?.returnPct).toBeUndefined();
  const retry = beginQualityMonitorRound(saved, saved, T + 2);
  saved = captureQualityMonitorResult(retry.study, retry.capture, { ...result(s), status: 'error', returnPct: undefined, reason: 'missing prices' }, T + 3);
  expect(saved.monitorLibrary!.records[0].result?.status).toBe('error');
});
it('preserves additive histories on stale saves and does not let a running snapshot replace a finished round', () => {
  const s = monitorStudy(), first = beginQualityMonitorRound(s, s, T);
  const completed = finishQualityMonitorRound(captureQualityMonitorResult(first.study, first.capture, result(s), T), first.capture, 'complete', T);
  expect(preserveQualityMonitorLibrary(completed, first.study).monitorLibrary!.rounds[0].state).toBe('complete');
  expect(preserveQualityMonitorLibrary(completed, s).monitorLibrary!.records).toHaveLength(1);
  const changed = structuredClone(s); changed.sellPlans![0].rule!.threshold = .4;
  const other = beginQualityMonitorRound(changed, changed, T + 1);
  const merged = preserveQualityMonitorLibrary(completed, other.study);
  expect(merged.monitorLibrary!.records).toHaveLength(2); expect(merged.monitorLibrary!.rounds).toHaveLength(2);
});
it('adopts existing frozen outcomes once without attributing current filters to unknown old trials', () => {
  const s = monitorStudy(), old = result(s); s.results = [old];
  s.sellPlans![0].buyFilters = [makeQualityBuyFilter('state:state', '>', .9)];
  const migrated = adoptQualityMonitorHistory(s);
  expect(migrated.monitorLibrary!.rounds).toHaveLength(1); expect(migrated.monitorLibrary!.rounds[0].legacy).toBe(true);
  expect(migrated.monitorLibrary!.settings[0].filtersKnown).toBe(false);
  expect(migrated.monitorLibrary!.settings[0].plan.buyFilters).toEqual([]);
  expect(migrated.monitorLibrary!.records[0].result).toEqual(old);
  expect(adoptQualityMonitorHistory(migrated)).toBe(migrated); expect(s.monitorLibrary).toBeUndefined();
});

it('marks recovered in-flight rounds incomplete without dropping their saved rows', async () => {
  const { recoverQualityMonitorRounds } = await import('@/lib/fish/qualityMonitorLibrary');
  const s = monitorStudy(), begun = beginQualityMonitorRound(s, s, T);
  const restored = recoverQualityMonitorRounds(begun.study, T + 1);
  expect(restored.monitorLibrary!.rounds[0].state).toBe('paused');
  expect(restored.monitorLibrary!.records).toEqual(begun.study.monitorLibrary!.records);
});
