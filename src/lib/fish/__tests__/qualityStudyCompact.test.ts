import { expect, it } from 'vitest';
import { monitorArchiveFixture } from './monitorArchive.fixture';
import { compactQualityStudyForStorage, compactQualityRuns } from '../qualityStudyCompact';
import type { FishQualityStudy } from '../quality';
import type { QualityCampaignRun } from '../qualityCampaignArchive';

/** 每条运行记录各自深拷贝一份方案和算法——和线上数据一样的冗余形态。 */
function duplicated(): FishQualityStudy {
  const s = monitorArchiveFixture(), plan = s.sellPlans![0], detectors = s.sellPlans!.slice(1, 2);
  const runs: QualityCampaignRun[] = s.results.map((result, i) => ({ sample: s.samples[i % s.samples.length], plan: structuredClone(plan), detectors: structuredClone(detectors), result, observeHours: 24, firstEvaluatedAt: i, priorResults: [{ at: i, plan: structuredClone(plan), result }] }));
  return { ...s, campaignRuns: [...runs, ...runs.map(r => structuredClone(r))] };
}

it('shares identical plans and detectors without changing any stored value, and the sharing survives a storage round trip', () => {
  const s = duplicated(), compact = compactQualityRuns(s), runs = compact.campaignRuns!;
  expect(JSON.stringify(compact)).toBe(JSON.stringify(s));
  expect(new Set(runs.map(r => r.plan)).size).toBe(1);
  expect(new Set(runs.map(r => r.detectors)).size).toBe(1);
  expect(runs[0].priorResults![0].plan).toBe(runs[0].plan);
  const reloaded = structuredClone(compact).campaignRuns!;
  expect(reloaded[0].plan).toBe(reloaded[reloaded.length - 1].plan);
  expect(compactQualityRuns(compact)).toBe(compact);
});

it('keeps distinct plans apart, including values that JSON alone would confuse', () => {
  const s = duplicated(), runs = s.campaignRuns!;
  const changed = { ...runs[1], plan: { ...runs[1].plan, snapshot: { ...runs[1].plan.snapshot, average: NaN } } };
  const other = { ...runs[2], plan: { ...runs[2].plan, snapshot: { ...runs[2].plan.snapshot, average: null as unknown as number } } };
  const out = compactQualityRuns({ ...s, campaignRuns: [runs[0], changed, other] }).campaignRuns!;
  expect(out[1].plan).not.toBe(out[0].plan);
  expect(out[2].plan).not.toBe(out[1].plan);
  expect(Number.isNaN(out[1].plan.snapshot.average)).toBe(true);
});

it('drops only monitor settings that no record references', () => {
  const s = monitorArchiveFixture(), library = s.monitorLibrary!, orphan = { ...library.settings[0], id: 'setting-orphan', signature: 'orphan' };
  const out = compactQualityStudyForStorage({ ...s, monitorLibrary: { ...library, settings: [...library.settings, orphan] } });
  expect(out.monitorLibrary!.settings.map(x => x.id)).toEqual(library.settings.map(x => x.id));
  expect(out.monitorLibrary!.records).toBe(library.records);
  expect(JSON.stringify(out.monitorLibrary!.settings)).toBe(JSON.stringify(library.settings));
});
