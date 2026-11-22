import type { FishQualityStudy } from './quality';
import { archiveQualityStudy } from './qualityCampaignArchive';
import { preserveQualityFilterLibrary } from './qualityFilterLibrary';
import { preserveQualityMonitorLibrary } from './qualityMonitorLibrary';
import { preserveQualityWorkspace } from './qualitySignalReadingsStore';
import { preserveQualityRepairs } from './qualityRepair';
import { preserveSourceDeletions } from './libraryDeletion';

/** Join read snapshots without adopting current settings into historical trades. */
export function mergeQualityWorkspaceExecution(history: FishQualityStudy, working: FishQualityStudy): FishQualityStudy {
  // Adopt each source against its own samples/plans before joining the results.
  const old = archiveQualityStudy(history), current = archiveQualityStudy(working);
  const runs = new Map(old.campaignRuns?.map(run => [run.result.key, run]));
  for (const run of current.campaignRuns ?? []) {
    const previous = runs.get(run.result.key);
    if (!previous || previous.result.evaluatedAt <= run.result.evaluatedAt) runs.set(run.result.key, run);
  }
  const combined = preserveQualityFilterLibrary(current, preserveQualityMonitorLibrary(current,
    preserveQualityWorkspace(current, preserveSourceDeletions(current, old))));
  const readings = <T extends { key: string }>(a: readonly T[] | undefined, b: readonly T[] | undefined) =>
    [...new Map([...(a ?? []), ...(b ?? [])].map(item => [item.key, item])).values()];
  return preserveQualityRepairs(old, preserveQualityRepairs(current, { ...combined, workspaceExecution: undefined,
    campaignRuns: [...runs.values()],
    results: readings(old.results, current.results),
    buyFilters: current.buyFilters, independentFilters: current.independentFilters,
    workspaceFilterDraft: current.workspaceFilterDraft, workspaceFilterDraftUpdatedAt: current.workspaceFilterDraftUpdatedAt,
    signalMetrics: current.signalMetrics, signalMetricsUpdatedAt: current.signalMetricsUpdatedAt, turingStaticSettings: current.turingStaticSettings,
    signalReadings: readings(old.signalReadings, current.signalReadings), filterReadings: readings(old.filterReadings, current.filterReadings),
  }));
}
