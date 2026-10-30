import {expect,it} from 'vitest';
import {payload} from './libraryTransfer.fixture';
import {newQualityStudy} from '../quality';
import {markSourceDeletions,preserveSourceDeletions,deleteMiningRecords} from '../libraryDeletion';
import {mergeMiningLibraries,normalizeMiningLibrary} from '../miningLibrary';
import {validateLibraryPayload} from '../libraryTransfer';
function fixture(){const p=payload();return {...newQualityStudy(1),filterLibrary:p.filter,monitorLibrary:p.monitor,samples:[{id:'sample',source:p.monitor!.records[0].source,enteredAt:1300000,basis:'capture',groups:[]}],results:p.monitor!.records.map(r=>r.result!),selectedRowIds:['sample']} as ReturnType<typeof newQualityStudy>;}
it('deletes matching entries for every threshold, preserves a different entry/exchange, and repairs delta-round references',()=>{
 const s=fixture(),r=s.monitorLibrary!.records[0];s.monitorLibrary!.records.push({...r,id:'other-threshold',settingId:r.settingId},{...r,id:'other-entry',enteredAt:1400000},{...r,id:'other-exchange',source:{...r.source,exchange:'okx'}});s.monitorLibrary!.rounds[0].recordIds=s.monitorLibrary!.records.map(r=>r.id);
 const next=markSourceDeletions(s,[{source:r.source,entry:r.enteredAt}],2000);expect(next.monitorLibrary!.records.map(r=>r.id)).toEqual(['other-entry','other-exchange']);expect(next.filterLibrary!.records).toHaveLength(0);expect(next.samples).toHaveLength(0);expect(next.results).toHaveLength(0);expect(next.selectedRowIds).toEqual([]);expect(next.monitorLibrary!.rounds[0].recordIds).toEqual(['other-entry','other-exchange']);expect(next.filterLibrary!.rounds[1].base).toBe('f-round');expect(()=>validateLibraryPayload({filter:next.filterLibrary,monitor:next.monitorLibrary})).not.toThrow();expect(s.filterLibrary!.records).toHaveLength(1);
 const restored=preserveSourceDeletions(next,s);expect(restored.monitorLibrary!.records.map(r=>r.id)).toEqual(['other-entry','other-exchange']);expect(restored.results).toHaveLength(0);
});
it('removes just selected mining records and never merges them back from an older device',()=>{
 const mining=payload().mining!,copy=structuredClone(mining),next=deleteMiningRecords(mining,['mined'],2000);expect(next.records).toEqual([]);expect(next.anchors[0].recordIds).toEqual([]);expect(next.anchors[0].found).toBe(1);expect(next.runs).toEqual(mining.runs);expect(mergeMiningLibraries(next,copy).records).toEqual([]);expect(normalizeMiningLibrary(next).deletedRecords).toEqual({mined:2000});expect(mining.records).toHaveLength(1);
});
it('drops entry and post-sale readings but preserves shared observations referenced by a retained trade',()=>{
 const s=fixture(),r=s.monitorLibrary!.records[0],prefix=['binance','crypto','TESTUSDT',null],ek=JSON.stringify(['sell-entry-v1',...prefix,r.enteredAt]),pk=JSON.stringify(['post-exit-v1',...prefix,r.result!.endTime,r.result!.endPrice]);s.entryReadings=[{key:ek,evaluatedAt:100,entryTime:r.enteredAt!,mode:'closed',metric:'state',value:.5}];s.postExitReadings=[{key:pk,evaluatedAt:100,exitTime:r.result!.endTime!,exitPrice:r.result!.endPrice!,startMs:0,excludedExitMinute:true,windows:[]}];
 const next=markSourceDeletions(s,[{source:r.source,entry:r.enteredAt}],2000);expect(next.entryReadings).toEqual([]);expect(next.postExitReadings).toEqual([]);expect(preserveSourceDeletions(next,{...next,entryReadings:s.entryReadings,postExitReadings:s.postExitReadings}).entryReadings).toEqual([]);
});
