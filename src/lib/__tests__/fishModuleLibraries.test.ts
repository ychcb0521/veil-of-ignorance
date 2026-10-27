// 【用户要求】2026-10-27「批量挖掘、买前过滤、持仓监测的逻辑和运行是独立的，因此需要有各自的数据库」
import { expect, it } from 'vitest';
import { importQualityLibrary, newQualityStudy, qualityComparisonRows, qualityDisplayRows, qualityFilterReadingKey, type FishQualityStudy } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { makeQualityBuyFilter } from '@/lib/fish/qualityFilters';
import { beginQualityFilterRound, finishQualityFilterRound, preserveQualityFilterLibrary, recoverQualityFilterRounds } from '@/lib/fish/qualityFilterLibrary';
import { libraryRoundRecordIds } from '@/lib/fish/libraryRounds';
import { adoptMinedFish, compactMinedSignal, emptyMiningLibrary, mergeMiningLibraries, recordMinedAnchor, recordMiningError } from '@/lib/fish/miningLibrary';
import { newMiningState } from '@/lib/fish/miningState';
import { BSS_DEF, definitionKey } from '@/lib/deepDig/features';
import type { TradeSignal } from '@/lib/signalLibrary';

const T = Date.UTC(2026, 5, 1);
function filterStudy(count = 4, threshold = .7): FishQualityStudy {
  const signals = Array.from({ length: count }, (_, i) => ({ id: `s${i}`, symbol: `C${i}USDT`, timeMs: T + i * 3_600_000, timeLabel: '', fallbackZone: '' }));
  const study = enableQualityComparison(importQualityLibrary(newQualityStudy(T), signals as never, T));
  study.sellPlans = study.sellPlans!.map((p, i) => ({ ...p, buyFilters: i ? [makeQualityBuyFilter('state:state', '>', threshold)] : [makeQualityBuyFilter('state:state', '>', threshold), makeQualityBuyFilter('cda:CDA', '>', 0)] }));
  return { ...study, selectedRowIds: qualityDisplayRows(study).map(r => r.id) };
}
const withReadings = (study: FishQualityStudy, value: (i: number, j: number) => number): FishQualityStudy => {
  const rows = qualityComparisonRows(study);
  return { ...study, filterReadings: rows.flatMap((row, i) => study.sellPlans!.flatMap(p => (p.buyFilters ?? []).map((f, j) => ({ key: qualityFilterReadingKey(row, f), value: value(i, j), at: T })))) };
};

it('filter library: freezes each round, records a threshold-only change as a new round, and keeps both judgements', () => {
  let study = withReadings(filterStudy(4, .7), i => [.9, .5, .8, .2][i]);
  const first = beginQualityFilterRound(study, study, T + 1)!;
  study = finishQualityFilterRound(first.study, first.capture, 'complete', T + 2);
  const lib1 = study.filterLibrary!;
  // 两套方案：一套两条件、一套一条件 → 两组条件 × 4 条信号
  expect(lib1.settings).toHaveLength(2);
  expect(lib1.records).toHaveLength(8);
  const single = lib1.settings.find(s => s.filters.length === 1)!;
  expect(lib1.records.filter(r => r.settingId === single.id).map(r => r.status.state).sort()).toEqual(['fail', 'fail', 'pass', 'pass']);
  // 读数与条件一一对应
  const double = lib1.settings.find(s => s.filters.length === 2)!;
  expect(lib1.records.find(r => r.settingId === double.id)!.readings).toHaveLength(2);

  // 只改门槛（读数可复用）：新的一轮，旧判断仍在
  const relaxed = { ...study, sellPlans: study.sellPlans!.map(p => ({ ...p, buyFilters: p.buyFilters!.map(f => f.metric === 'state' ? makeQualityBuyFilter('state:state', '>', .4) : f) })) };
  const second = beginQualityFilterRound(relaxed, withReadings(relaxed, i => [.9, .5, .8, .2][i]), T + 10)!;
  study = finishQualityFilterRound(second.study, second.capture, 'complete', T + 11);
  const lib2 = study.filterLibrary!;
  expect(lib2.rounds).toHaveLength(2);
  expect(lib2.settings).toHaveLength(4);
  expect(lib2.records).toHaveLength(16);
  const [r1, r2] = [...lib2.rounds].sort((a, b) => a.startedAt - b.startedAt);
  expect(libraryRoundRecordIds(lib2.rounds, r1)).toHaveLength(8);
  expect(libraryRoundRecordIds(lib2.rounds, r2)).toHaveLength(8);
  expect(new Set(libraryRoundRecordIds(lib2.rounds, r2)).has(libraryRoundRecordIds(lib2.rounds, r1)[0])).toBe(false);
  const looser = lib2.settings.find(s => s.filters.length === 1 && s.filters[0].threshold === .4)!;
  expect(lib2.records.filter(r => r.settingId === looser.id).map(r => r.status.state).sort()).toEqual(['fail', 'pass', 'pass', 'pass']);
});

it('filter library: same conditions merge into one record per signal, readings arriving mid-round are kept on pause', () => {
  let study = filterStudy(3);
  const a = beginQualityFilterRound(study, study, T + 1)!;
  // 还没读数 → 待判断
  expect(a.study.filterLibrary!.records.every(r => r.status.state === 'pending')).toBe(true);
  const row = qualityComparisonRows(study)[0], f = study.sellPlans![1].buyFilters![0];
  a.capture.readings.set(qualityFilterReadingKey(row, f), { key: qualityFilterReadingKey(row, f), value: .95, at: T });
  study = finishQualityFilterRound(a.study, a.capture, 'paused', T + 2);
  const setting = study.filterLibrary!.settings.find(s => s.filters.length === 1)!;
  expect(study.filterLibrary!.records.filter(r => r.settingId === setting.id && r.status.state === 'pass')).toHaveLength(1);
  expect(study.filterLibrary!.rounds[0].state).toBe('paused');
  const b = beginQualityFilterRound(study, study, T + 5)!;
  study = finishQualityFilterRound(b.study, b.capture, 'complete', T + 6);
  expect(study.filterLibrary!.records).toHaveLength(6);
  expect(study.filterLibrary!.rounds).toHaveLength(2);
  // 没有任何启用条件：不记轮次
  const none = { ...study, sellPlans: study.sellPlans!.map(p => ({ ...p, buyFilters: [] })) };
  expect(beginQualityFilterRound(none, none, T + 9)).toBeNull();
});

it('filter library: running rounds become paused on reload, and two tabs merge without losing anything', () => {
  const study = filterStudy(2), begun = beginQualityFilterRound(study, study, T + 1)!;
  expect(recoverQualityFilterRounds(begun.study, T + 5).filterLibrary!.rounds[0].state).toBe('paused');
  const other = beginQualityFilterRound(study, study, T + 3)!;
  const merged = preserveQualityFilterLibrary(begun.study, other.study);
  expect(merged.filterLibrary!.rounds).toHaveLength(2);
  expect(preserveQualityFilterLibrary(begun.study, { ...other.study, filterLibrary: undefined }).filterLibrary).toBe(begun.study.filterLibrary);
});

const mined = (i: number, anchorMs: number): TradeSignal => ({ id: `f${i}|mine:${anchorMs}`, symbol: `M${i}USDT`, timeMs: anchorMs - 3_600_000, timeLabel: '', fallbackZone: '', caughtAt: anchorMs + 60_000, mined: { anchorMs },
  fish: { featureId: 'bss', featureShort: 'BSS', definitionKey: definitionKey(BSS_DEF), statistic: 'BSS', cutoffMs: anchorMs, threshold: 1, average: 2.5, cbi2: 2.5, startAverage: 2, previousAverage: 0, direction: '>', scale: 1, trace: { t0: 0, dt: 1, values: Array.from({ length: 500 }, (_, k) => k) } } } as TradeSignal);
const state = { ...newMiningState(), enabled: true, rules: [{ id: 'bss', featureId: 'bss', statistic: '结果', threshold: '1' }] };

it('mining library: records each anchor independently of the hold, strips traces, and an error is replaced by a later success', () => {
  const A = T, B = T + 12 * 3_600_000;
  let lib = recordMinedAnchor(emptyMiningLibrary(), state, A, 5, [mined(1, A), mined(2, A)], A + 100);
  lib = recordMiningError(lib, state, B, '行情超时', B + 100);
  lib = recordMiningError(lib, state, B, '行情超时', B + 200);
  expect(lib.anchors.find(a => a.anchorMs === B)).toMatchObject({ error: '行情超时', attempts: 2, added: 0 });
  lib = recordMinedAnchor(lib, state, B, 3, [mined(3, B)], B + 300);
  const b = lib.anchors.find(a => a.anchorMs === B)!;
  expect(b.error).toBeUndefined(); expect(b).toMatchObject({ found: 3, added: 1, attempts: 3 });
  expect(lib.runs).toHaveLength(1);
  expect(lib.records).toHaveLength(3);
  expect(lib.records[0].signal.fish!.trace).toBeUndefined();
  expect(lib.records[0].signal.fish!.average).toBe(2.5);
  // 出错不会盖掉已成功的一档
  expect(recordMiningError(lib, state, A, '又错了', A + 999).anchors.find(a => a.anchorMs === A)!.error).toBeUndefined();
});

it('mining library: adopts fish mined before the library existed exactly once, and merges two copies additively', () => {
  const A = T, B = T + 12 * 3_600_000, hold = [mined(1, A), mined(2, A), mined(3, B), { ...mined(9, A), mined: undefined }];
  const adopted = adoptMinedFish(emptyMiningLibrary(), state, hold, B + 1);
  expect(adopted.records).toHaveLength(3); expect(adopted.anchors).toHaveLength(2); expect(adopted.adoptedHold).toBe(true);
  expect(adoptMinedFish(adopted, state, [...hold, mined(4, B)], B + 2)).toBe(adopted);
  // 从没开始过（没冻结规则）不补
  expect(adoptMinedFish(emptyMiningLibrary(), newMiningState(), hold, B).records).toHaveLength(0);
  const other = recordMinedAnchor(emptyMiningLibrary(), state, B + 12 * 3_600_000, 1, [mined(5, B + 12 * 3_600_000)], B + 50);
  const merged = mergeMiningLibraries(adopted, other);
  expect(merged.records).toHaveLength(4); expect(merged.anchors).toHaveLength(3); expect(merged.runs).toHaveLength(1);
  expect(compactMinedSignal(mined(1, A)).freshCatch).toBeUndefined();
});
