import {qualityDisplayRows} from '../quality';
import {expect,it} from 'vitest';
import {monitorArchiveFixture,ARCHIVE_T as T} from './monitorArchive.fixture';
import {archiveQualityMonitorStudy,preserveQualityMonitorLibrary} from '../qualityMonitorLibrary';
import {copyMonitorStudy,editMonitorDirectory,monitorRoundStudy} from '../qualityMonitorArchive';
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

it('copies frozen tables into an editable independent working table and archives the previous one',()=>{
 const current=archiveQualityMonitorStudy(monitorArchiveFixture(),T+4000000),snapshot=current.monitorLibrary!.archives![0].study;current.results=current.results.map(r=>({...r,returnPct:-7}));const before=structuredClone(snapshot),copy=copyMonitorStudy(current,snapshot,T+5000000);
 expect(copy.results[0].returnPct).toBe(10);expect(copy.selectedRowIds).toEqual(qualityDisplayRows(copy).map(row=>row.id));expect(copy.monitorLibrary!.archives).toHaveLength(2);expect(copy.monitorLibrary!.archives![1].study.results[0].returnPct).toBe(-7);expect(copy.monitorLibrary!.archives![1].reason).toBe('copy');
 copy.results[0].returnPct=90;copy.sellPlans![0].label='编辑副本';expect(snapshot).toEqual(before);expect(()=>validateLibraryPayload({monitor:copy.monitorLibrary})).not.toThrow();
});
it('keeps directory deletion and restoration through stale-device merges without breaking round references',()=>{
 const s=archiveQualityMonitorStudy(monitorArchiveFixture(),T+4000000),id=s.monitorLibrary!.archives![0].id,hidden=editMonitorDirectory(s,id,true,T+5000000),merged=preserveQualityMonitorLibrary(hidden,s);
 expect(merged.monitorLibrary!.directoryEdits![id].hidden).toBe(true);expect(merged.monitorLibrary!.archives).toEqual(s.monitorLibrary!.archives);expect(merged.monitorLibrary!.rounds).toEqual(s.monitorLibrary!.rounds);
 const restored=editMonitorDirectory(merged,id,false,T+6000000);expect(preserveQualityMonitorLibrary(hidden,restored).monitorLibrary!.directoryEdits![id].hidden).toBe(false);expect(editMonitorDirectory(s,'missing',true)).toBe(s);expect(()=>validateLibraryPayload({monitor:restored.monitorLibrary})).not.toThrow();
});

it('materializes a record-only source round before a copied trial can update shared monitor records',()=>{
 const s=monitorArchiveFixture(),round=s.monitorLibrary!.rounds[0],snapshot=monitorRoundStudy(s,round),copy=copyMonitorStudy(s,snapshot,T+5000000,round.id),frozen=copy.monitorLibrary!.archives!.find(a=>a.reason==='copy-source')!;expect(frozen.sourceRoundId).toBe(round.id);expect(frozen.study.results.map(r=>r.returnPct)).toEqual(snapshot.results.map(r=>r.returnPct));copy.monitorLibrary!.records[0].result!.returnPct=-99;expect(frozen.study.results[0].returnPct).toBe(10);expect(()=>validateLibraryPayload({monitor:copy.monitorLibrary})).not.toThrow();
});
