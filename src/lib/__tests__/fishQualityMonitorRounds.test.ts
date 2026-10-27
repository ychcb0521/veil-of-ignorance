// 【2026-10-27 审查】监测库每轮只存与上一轮的差异：数据量随新增记录增长，不随轮数线性膨胀；每轮仍能完整还原。
import { expect, it } from 'vitest';
import { importQualityLibrary, newQualityStudy, qualityDisplayRows, type FishQualityStudy } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { beginQualityMonitorRound, compactQualityMonitorRounds, finishQualityMonitorRound, preserveQualityMonitorLibrary, qualityMonitorRoundRecordIds, recoverQualityMonitorRounds } from '@/lib/fish/qualityMonitorLibrary';

const T = Date.UTC(2026, 5, 1);
const signal = (i: number) => ({ id: `s${i}`, symbol: `C${i}USDT`, timeMs: T + i * 3_600_000, timeLabel: '', fallbackZone: '' });
function studyWith(count: number, previous?: FishQualityStudy): FishQualityStudy {
  const base = previous ?? enableQualityComparison(newQualityStudy(T));
  const study = importQualityLibrary(base, Array.from({ length: count }, (_, i) => signal(i)) as never, T);
  return { ...study, selectedRowIds: qualityDisplayRows(study).map(r => r.id) };
}
function round(study: FishQualityStudy, at: number) {
  const begun = beginQualityMonitorRound(study, structuredClone(study), at);
  const done = finishQualityMonitorRound(begun.study, begun.capture, 'complete', at + 1);
  return { study: done, ids: [...new Set([...begun.capture.tasks.values()].map(t => t.id))] };
}

it('keeps each later round as a small delta while every round still resolves to its full record list', () => {
  let study = studyWith(300);
  const expected: string[][] = [];
  for (let n = 0; n < 40; n++) {
    // 每隔几轮挖到新鱼：勾选范围逐步扩大
    if (n % 5 === 4) study = studyWith(300 + n, study);
    const next = round(study, T + n * 1000); study = next.study; expected.push(next.ids);
  }
  const library = study.monitorLibrary!;
  expect(library.rounds).toHaveLength(40);
  library.rounds.forEach((r, i) => expect(new Set(qualityMonitorRoundRecordIds(library, r))).toEqual(new Set(expected[i])));
  expect(library.rounds.filter(r => r.recordIds)).toHaveLength(1);
  const roundsBytes = JSON.stringify(library.rounds).length, oneFullList = JSON.stringify(expected.at(-1)).length;
  // 40 轮的总大小不到两份完整清单（以前是 40 份）
  expect(roundsBytes).toBeLessThan(oneFullList * 2);
});

it('compacts old full-list rounds without changing what any round shows, and stays stable across tabs', () => {
  let study = studyWith(120);
  for (let n = 0; n < 6; n++) study = round(study, T + n * 1000).study;
  // 模拟旧版本：每轮都存完整清单
  const library = study.monitorLibrary!, cache = new Map<string, string[]>();
  const full = { ...study, monitorLibrary: { ...library, rounds: library.rounds.map(r => ({ id: r.id, startedAt: r.startedAt, updatedAt: r.updatedAt, finishedAt: r.finishedAt, state: r.state, recordIds: qualityMonitorRoundRecordIds(library, r, cache) })) } };
  const compacted = recoverQualityMonitorRounds(full, T + 99_999);
  const before = full.monitorLibrary.rounds.map(r => qualityMonitorRoundRecordIds(full.monitorLibrary, r));
  const after = compacted.monitorLibrary!.rounds.map(r => qualityMonitorRoundRecordIds(compacted.monitorLibrary!, r));
  expect(after).toEqual(before);
  expect(compacted.monitorLibrary!.rounds.filter(r => r.recordIds)).toHaveLength(1);
  expect(compacted.monitorLibrary!.rounds.map(r => [r.id, r.startedAt, r.updatedAt, r.state])).toEqual(full.monitorLibrary.rounds.map(r => [r.id, r.startedAt, r.updatedAt, r.state]));
  expect(compactQualityMonitorRounds(compacted)).toBe(compacted);
  // 一个标签页还是旧格式、另一个已压缩：合并后每轮内容仍一致
  const merged = preserveQualityMonitorLibrary(full, compacted);
  expect(merged.monitorLibrary!.rounds.map(r => qualityMonitorRoundRecordIds(merged.monitorLibrary!, r))).toEqual(before);
});

it('stores a removed selection as a delta too and never loses rows when the base is missing', () => {
  let study = studyWith(50);
  const first = round(study, T); study = first.study;
  study = { ...study, selectedRowIds: study.selectedRowIds!.slice(0, 40) };
  const second = round(study, T + 1000); study = second.study;
  const library = study.monitorLibrary!, last = library.rounds.at(-1)!;
  expect(last.base).toBe(library.rounds[0].id);
  expect(last.removed!.length).toBeGreaterThan(0);
  expect(new Set(qualityMonitorRoundRecordIds(library, last))).toEqual(new Set(second.ids));
  // 基准轮不在（数据损坏）：至少还能看到本轮新增的那部分，不抛错
  expect(() => qualityMonitorRoundRecordIds({ rounds: [last] }, last)).not.toThrow();
});
