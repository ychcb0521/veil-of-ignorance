import type {FishQualityStudy} from './quality';

/** Monitoring/filtering own their executable inputs. Historical libraries,
 * templates and screening audit are independent immutable assets, not inputs
 * to either engine. Keep them in the owning study, out of the run's clone. */
export function qualityExecutionSnapshot(study:FishQualityStudy):FishQualityStudy {
  const {monitorLibrary:_monitor,filterLibrary:_filter,campaignRuns:_runs,
    planTemplates:_templates,campaignRepair:_repair,entryReadings:_entry,
    postExitReadings:_post,screeningResults:_screening,screeningRounds:_rounds,...inputs}=study;
  return structuredClone(inputs);
}
