import {expect,it} from 'vitest';
import {monitorArchiveFixture,ARCHIVE_T as T} from './monitorArchive.fixture';
import {archiveQualityMonitorStudy,preserveQualityMonitorLibrary} from '../qualityMonitorLibrary';
import {monitorRoundStudy} from '../qualityMonitorArchive';
import {markSourceDeletions} from '../libraryDeletion';
import {validateLibraryPayload} from '../libraryTransfer';
it('clones the entire current table independently of selection and later mutations without nesting libraries',()=>{
 const s=monitorArchiveFixture();s.selectedRowIds=s.selectedRowIds!.slice(0,1);const before=structuredClone(s),next=archiveQualityMonitorStudy(s,T+4000000),a=next.monitorLibrary!.archives![0];
 expect(a.study.results).toEqual(before.results);expect(a.study.samples).toEqual(before.samples);expect(a.study.entryReadings).toEqual(before.entryReadings);expect(a.study).not.toHaveProperty('monitorLibrary');expect(a.study).not.toHaveProperty('filterLibrary');
 s.results[0].returnPct=-99;s.sellPlans![0].snapshot.threshold=-100;s.entryReadings![0].value=999;
 expect(a.study.results[0].returnPct).toBe(10);expect(a.study.sellPlans![0].snapshot.threshold).not.toBe(-100);expect(a.study.entryReadings![0].value).toBe(.8);
 expect(()=>validateLibraryPayload({monitor:next.monitorLibrary})).not.toThrow();
});
it('keeps independent snapshots of repeated runs with the same conditions during stale-device merges',()=>{
 const first=archiveQualityMonitorStudy(monitorArchiveFixture(),T+4000000),saved=structuredClone(first.monitorLibrary!.archives![0]);first.results=first.results.map(r=>({...r,returnPct:-7}));
 const second=archiveQualityMonitorStudy(first,T+5000000),merged=preserveQualityMonitorLibrary(second,{...second,monitorLibrary:{...second.monitorLibrary!,archives:[]}});
 expect(merged.monitorLibrary!.archives).toHaveLength(2);expect(merged.monitorLibrary!.archives![0]).toEqual(saved);expect(merged.monitorLibrary!.archives![1].study.results[0].returnPct).toBe(-7);
});
it('applies linked deletion to archived rows as well as live results and never replays prices for older rounds',()=>{
 const s=archiveQualityMonitorStudy(monitorArchiveFixture(),T+4000000),before=structuredClone(s),row=s.samples[0],next=markSourceDeletions(s,[{source:row.source,entry:row.enteredAt}],T+6000000);
 expect(next.monitorLibrary!.archives![0].study.samples).toHaveLength(1);expect(next.monitorLibrary!.archives![0].study.results).toHaveLength(before.results.length/2);
 const view=monitorRoundStudy(before,before.monitorLibrary!.rounds[0]);expect(view.results.map(r=>[r.returnPct,r.endTime,r.endPrice])).toEqual(before.results.map(r=>[r.returnPct,r.endTime,r.endPrice]));expect(view.entryReadings).toEqual([]);
});
