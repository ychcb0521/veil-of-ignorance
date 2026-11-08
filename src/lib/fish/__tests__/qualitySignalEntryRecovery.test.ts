import {buildQualitySheets} from '../qualityExport';
import {formatUTC8} from '@/lib/timeFormat';
import {qualityLibraryEntryAt,qualitySignalTime} from '../qualityAdmissionTime';
import {qualityResultKey,type QualityGroup} from '../quality';
import { describe, expect, it } from 'vitest';
import { importQualityLibrary, migrateQualityCaptureEntries, newQualityStudy, qualityComparisonRows, qualityDisplayRows, qualityRunSamples } from '../quality';
import type { TradeSignal } from '@/lib/signalLibrary';

const first = Date.UTC(2026, 2, 29, 5), matched = first + 2 * 86400_000;
const source: TradeSignal = { id: 'turing-replay-sample-v2:TURING 50', symbol: 'TURING:TURING 50', timeMs: first,
  timeLabel: '2026-03-29 13:00:00', fallbackZone: '', turingReplaySample: true };
const match: TradeSignal = { ...source, id: 'pre-entry:match', timeMs: matched, turingReplaySample: undefined,
  preEntryMonitor: { recordId: 'match', roundId: 'round', sourceId: source.id, sourceTime: first } };

describe('signal-library entry times survive study restoration', () => {
  it.each(['library', 'turing', 'pre-entry'] as const)('keeps valid %s entry times without requiring a fish capture snapshot', origin => {
    const study = importQualityLibrary(newQualityStudy(), [origin === 'pre-entry' ? match : source], first, origin);
    expect(migrateQualityCaptureEntries(study)).toBe(study);
    expect(study.samples[0].enteredAt).toBe(origin === 'pre-entry' ? matched : first);
  });

  it.each(['turing', 'pre-entry'] as const)('repairs a previously cleared %s time and preserves checked rows across reloads', origin => {
    const study = importQualityLibrary(newQualityStudy(), [origin === 'pre-entry' ? match : source], first, origin);
    study.sellPlans = [];
    study.samples = study.samples.map(sample => ({ ...sample, enteredAt: null, basis: 'missing' }));
    const oldRow = qualityComparisonRows(study)[0], oldDisplay = qualityDisplayRows(study)[0];
    study.selectedRowIds = [oldRow.id, oldDisplay.id];
    const saved = structuredClone(study), restored = migrateQualityCaptureEntries(study);
    expect(restored.samples[0]).toMatchObject({ enteredAt: origin === 'pre-entry' ? matched : first, basis: 'signal' });
    expect(restored.samples[0].source).toBe(study.samples[0].source);
    expect(restored.selectedRowIds).toEqual([qualityComparisonRows(restored)[0].id, qualityDisplayRows(restored)[0].id]);
    expect(qualityRunSamples(restored)).toHaveLength(1);
    expect(migrateQualityCaptureEntries(structuredClone(restored))).toEqual(restored);
    expect(migrateQualityCaptureEntries(restored)).toBe(restored);
    expect(study).toEqual(saved);
  });

  it('recovers legacy Turing records without an explicit origin from their recorded timeline', () => {
    const study = importQualityLibrary(newQualityStudy(), [source], first, 'turing');
    study.samples = study.samples.map(s => ({ ...s, origin: undefined, origins: undefined, enteredAt: null, basis: 'missing' }));
    expect(migrateQualityCaptureEntries(study).samples[0].enteredAt).toBe(first);
  });

  it('preserves a valid recorded entry even if it differs from the signal onset', () => {
    const study = importQualityLibrary(newQualityStudy(), [source], first, 'turing');
    study.samples[0].enteredAt = first + 123000;
    expect(migrateQualityCaptureEntries(study)).toBe(study);
  });

  it('does not invent an entry when both the entry and source timestamp are missing', () => {
    const study = importQualityLibrary(newQualityStudy(), [{ ...source, timeMs: NaN }], first, 'turing');
    expect(migrateQualityCaptureEntries(study)).toBe(study);
    expect(study.samples[0]).toMatchObject({ enteredAt: null, basis: 'missing' });
  });

  it('retains completed trades and frozen history while repairing a separate damaged entry', () => {
    const study = importQualityLibrary(newQualityStudy(), [source, { ...source, symbol: 'TURING:TURING 49', id: 'second' }], first, 'turing');
    const stable = study.samples[1];
    study.samples[0] = { ...study.samples[0], enteredAt: null, basis: 'missing' };
    study.results = [{ key: 'completed', sampleId: stable.id, groupId: 'plan', status: 'closed', evaluatedAt: first + 60000, entryTime: first, returnPct: 1 }];
    const restored = migrateQualityCaptureEntries(study);
    expect(restored.samples[1]).toBe(stable);
    expect(restored.results).toEqual(study.results);
  });
});

it('uses explicit first-match time rather than source time for admitted entries',()=>{
 const admitted={...match,timeMs:first,preEntryMonitor:{...match.preEntryMonitor!,matchedAt:matched}};
 const input=newQualityStudy(),study=importQualityLibrary(input,[admitted],first,'pre-entry');
 expect(study.samples[0].enteredAt).toBe(matched);expect(qualityLibraryEntryAt(admitted)).toBe(matched);expect(qualitySignalTime(admitted)).toBe(first);
 expect(input.samples).toEqual([]);
 const invalid={...admitted,preEntryMonitor:{...admitted.preEntryMonitor,matchedAt:NaN}};expect(qualityLibraryEntryAt(invalid)).toBeNull();
 expect(migrateQualityCaptureEntries(importQualityLibrary(newQualityStudy(),[invalid],first,'pre-entry')).samples[0].enteredAt).toBeNull();
});
it('repairs a valid but wrong saved admission time, retains history and selects the corrected entry',()=>{
 const admitted={...match,preEntryMonitor:{...match.preEntryMonitor!,matchedAt:matched}},study=importQualityLibrary(newQualityStudy(),[source,admitted],first,'pre-entry');
 study.sellPlans=[];study.samples[1]={...study.samples[1],enteredAt:first};
 const oldRow=qualityComparisonRows(study).find(r=>r.source.preEntryMonitor)!,oldDisplay=qualityDisplayRows(study).find(r=>r.source.preEntryMonitor)!;
 study.selectedRowIds=[oldRow.id,oldDisplay.id];
 study.results=[{key:'old-result',sampleId:oldRow.id,groupId:'plan',status:'closed',entryTime:first,evaluatedAt:first}];
 const before=structuredClone(study),restored=migrateQualityCaptureEntries(study),corrected=qualityComparisonRows(restored).find(r=>r.source.preEntryMonitor)!;
 expect(corrected.enteredAt).toBe(matched);expect(qualityRunSamples(restored).some(r=>r.enteredAt===matched)).toBe(true);
 expect(restored.samples[0]).toBe(study.samples[0]);expect(restored.results).toEqual(study.results);expect(study).toEqual(before);
 const plan={id:'plan',metric:'raw',snapshot:{definitionKey:'same',statistic:'raw',interval:'1m',scale:1}} as QualityGroup;
 expect(qualityResultKey(oldRow,plan,0)).not.toBe(qualityResultKey(corrected,plan,0));
 expect(migrateQualityCaptureEntries(restored)).toBe(restored);
});
it('reconciles an already imported admission against its authoritative match record without changing unrelated entries',()=>{
 const study=importQualityLibrary(newQualityStudy(),[match],first,'pre-entry');
 study.samples[0]={...study.samples[0],enteredAt:first};
 const before=structuredClone(study),admitted={...match,preEntryMonitor:{...match.preEntryMonitor!,matchedAt:matched}};
 const repaired=importQualityLibrary(study,[admitted],first+1,'pre-entry');
 expect(repaired.samples).toHaveLength(1);expect(repaired.samples[0].enteredAt).toBe(matched);expect(repaired.samples[0].source.preEntryMonitor?.matchedAt).toBe(matched);
 expect(study).toEqual(before);expect(importQualityLibrary(repaired,[admitted],first+2,'pre-entry')).toBe(repaired);
});

it('exports the original signal time separately from the authoritative admitted buy time',()=>{
 const admitted={...match,preEntryMonitor:{...match.preEntryMonitor!,matchedAt:matched}},study=importQualityLibrary(newQualityStudy(),[admitted],first,'pre-entry');
 const sheet=buildQualitySheets(study,qualityComparisonRows(study))[0],value=(header:string)=>sheet.rows[0][sheet.columns.findIndex(c=>c.header===header)];
 expect(value('信号时间')).toBe(formatUTC8(first));expect(value('买入时间')).toBe(formatUTC8(matched));
});
