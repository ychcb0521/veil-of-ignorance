import {expect,it} from 'vitest';
import {newQualityStudy} from '../quality';
import {recentMonitorSource,recentMonitorSnapshots,validRecentMonitorDirectory} from '../qualityRecentLibrary';
import {monitorRoundStudy} from '../qualityMonitorArchive';
import {serializeAccountBlob} from '../../accountBlobCodec';
import {enableQualityComparison} from '../qualityComparison';
import {importQualityLibrary,qualityDisplayRows,qualityRunSamples,qualityResultKey} from '../quality';
import {beginQualityMonitorRound,captureQualityMonitorResult,finishQualityMonitorRound} from '../qualityMonitorLibrary';
const at=Date.UTC(2026,10,21);
function saved(){
 let source=enableQualityComparison(importQualityLibrary(newQualityStudy(at),[{id:'s1',symbol:'AAAUSDT',timeMs:at,timeLabel:'',fallbackZone:''}]));
 source.selectedRowIds=qualityDisplayRows(source).map(row=>row.id);
 const begun=beginQualityMonitorRound(source,source,at),sample=qualityRunSamples(source)[0],plan=source.sellPlans![0];
 source=captureQualityMonitorResult(begun.study,begun.capture,{key:qualityResultKey(sample,plan,0),sampleId:sample.id,groupId:plan.id,status:'closed',complete:true,evaluatedAt:at+1,entryTime:at,entryPrice:100,endTime:at+2,endPrice:110,pnl:10,returnPct:10},at+2);
 return finishQualityMonitorRound(source,begun.capture,'complete',at+3);
}
it('takes only the monitor graph and never copies the multi-GB filter/campaign histories',()=>{
 const source=saved();Object.defineProperty(source,'filterLibrary',{get(){throw Error('large history touched');}});
 Object.defineProperty(source,'campaignRuns',{get(){throw Error('large campaigns touched');}});
 const small=recentMonitorSource(source);
 expect(small.monitorLibrary?.records).toEqual(source.monitorLibrary?.records);expect(small.filterLibrary).toBeUndefined();expect(small.campaignRuns).toBeUndefined();
});
it('orders dates across ID formats, deduplicates archived rounds and preserves original bodies',()=>{
 const source=saved(),round=source.monitorLibrary!.rounds[0],body=monitorRoundStudy(source,round);
 source.monitorLibrary!.archives=[{id:'zzz-older',version:1,createdAt:at-1,reason:'restart',study:body},{id:'aaa-newer',version:1,createdAt:at+50,reason:'copy-source',sourceRoundId:round.id,study:body}];
 const before=serializeAccountBlob(source),entries=recentMonitorSnapshots(recentMonitorSource(source));
 expect(entries.map(item=>item.entry.id)).toEqual(['aaa-newer','zzz-older']);
 expect(serializeAccountBlob(entries[0].body!())).toBe(serializeAccountBlob(body));expect(serializeAccountBlob(source)).toBe(before);
});
it('reconstructs the exact existing round view without rerunning its algorithms',()=>{
 const source=saved(),before=serializeAccountBlob(source),round=source.monitorLibrary!.rounds[0];
 const entry=recentMonitorSnapshots(recentMonitorSource(source))[0];
 expect(serializeAccountBlob(entry.body!())).toBe(serializeAccountBlob(monitorRoundStudy(source,round)));
 expect(serializeAccountBlob(source)).toBe(before);
 source.monitorLibrary!.rounds[0]={...round,state:'running'};
 expect(recentMonitorSnapshots(source)[0].entry.summary).toContain('保存时快照');
});
it('rejects another owner, stale revisions and unfinished body references',()=>{
 const value={version:1,owner:'alice',sourceRevision:'r1',generatedAt:at,total:1,deletions:{},entries:[{id:'a',at,label:'a',summary:'1',bodyId:'body',templateDirectory:{id:'p',title:'P'}}]};
 expect(validRecentMonitorDirectory(value,'alice','r1')).toBe(true);
 expect(validRecentMonitorDirectory(value,'bob','r1')).toBe(false);expect(validRecentMonitorDirectory(value,'alice','r2')).toBe(false);
 expect(validRecentMonitorDirectory({...value,entries:[{...value.entries[0],bodyId:undefined}]},'alice','r1')).toBe(false);
});
it('bounds the recent transfer to 24 visible rounds while resolving older delta parents exactly',()=>{
 const study=saved(),library=study.monitorLibrary!,base=library.rounds[0];
 library.rounds=Array.from({length:32},(_,i)=>i?{...base,id:'r'+i,startedAt:at+i,recordIds:undefined,base:i===1?base.id:'r'+(i-1),added:[],removed:[]}:{...base});
 library.directoryEdits={r31:{hidden:true,at}};
 const before=serializeAccountBlob(study);
 const source=recentMonitorSource(study);
 expect(source.monitorLibrary!.rounds).toHaveLength(24);expect(source.monitorLibrary!.rounds[0].id).toBe('r30');
 expect(source.monitorLibrary!.rounds.every(round=>round.base===undefined&&round.recordIds?.join()===base.recordIds?.join())).toBe(true);
 expect(source.olderMonitorRounds).toBe(7);expect(source.monitorLibrary!.settings[0].plan).toBe(library.settings[0].plan);
 expect(library.rounds).toHaveLength(32);expect(serializeAccountBlob(study)).toBe(before);
});
