import {qualityMonitorEntryAt, type QualityMonitorTimeBasis} from './qualityAdmissionTime';
import {qualityEntryIdentity, qualityRunSamples, type FishQualityStudy, type QualitySample} from './quality';

type Times = NonNullable<FishQualityStudy['staticTimeByEntry']>;

export function staticTimeSample<T extends QualitySample>(row:T, times?:Times):T {
  if (!times) return row;
  const time = times[qualityEntryIdentity(row.source,row.enteredAt)];
  return time === undefined ? row : {...row, staticTime:time ?? undefined};
}

/** Resolve against the original entry identity before creating a round. The source
 * and its entry time also identify the result when it returns to the table. */
export function prepareFilterTime(study:FishQualityStudy, basis:QualityMonitorTimeBasis, mode:'static'|'screening') {
  const times:Times = {};
  const allowed = new Set<string>();
  const rows = qualityRunSamples(study);
  let eligible=0;
  for (const row of rows) {
    const key=qualityEntryIdentity(row.source,row.enteredAt);
    const at=qualityMonitorEntryAt(row,basis);
    times[key]={basis,at};
    if (at !== null) { allowed.add(key); eligible++; }
  }
  const samples=study.samples.filter(row=>allowed.has(qualityEntryIdentity(row.source,row.enteredAt)));
  return {times, eligible, skipped:rows.length-eligible,
    study:{...study,samples:mode==='static'?samples.map(row=>staticTimeSample(row,times)):samples}};
}
