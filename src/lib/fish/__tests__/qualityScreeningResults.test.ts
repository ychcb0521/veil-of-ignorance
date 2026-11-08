import {expect,it} from 'vitest';
import {qualityScreeningResults,screeningResultIndex,screeningRowResults,screeningCell,screeningResultsSheet} from '../qualityScreeningResults';
import {emptyPreEntryLibrary,mergePreEntryLibraries,preEntrySignal,type PreEntryLibrary} from '../preEntryMonitor';
import {entryDirectoryStudy} from '../qualityLibraryDirectory';
import {newQualityStudy,qualityComparisonRows,type QualitySample} from '../quality';
import {makeQualityBuyFilter} from '../qualityFilters';
const T=Date.UTC(2026,10,8);
function library():PreEntryLibrary{
 const f=makeQualityBuyFilter('state:state','>',.7),sample:QualitySample={id:'s',source:{id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:'',exchange:'binance'},enteredAt:T,basis:'signal',groups:[],importedAt:T};
 return {...emptyPreEntryLibrary(),rounds:[{id:'r',state:'complete',startedAt:T,updatedAt:T,filters:[f],plans:[{id:'p',label:'冻结方案',metric:f.metric,snapshot:f.snapshot,rule:{metric:f.metric,direction:f.direction,threshold:f.threshold}}],hours:1}],records:[{id:'record',roundId:'r',planId:'p',status:'matched',startTime:T,cursor:T+60000,matchedAt:T+60000,sample,updatedAt:T+60000,readings:[{key:f.id,value:0}]}]};
}
it('matches both the original row and the admitted row without attributing a result to another entry or exchange',()=>{
 const l=library(),snapshots=qualityScreeningResults({},l),index=screeningResultIndex(snapshots),row=l.records[0].sample;
 expect(screeningRowResults(row,index)).toHaveLength(1);const signal=preEntrySignal(l.records[0])!;expect(screeningRowResults({...row,source:signal,enteredAt:signal.timeMs},index)).toHaveLength(1);
 expect(screeningRowResults({...row,enteredAt:T+120000},index)).toEqual([]);expect(screeningRowResults({...row,source:{...row.source,exchange:'okx'}},index)).toEqual([]);
 expect(screeningCell(snapshots)).toMatchObject({plan:'冻结方案',status:'已入选',at:'2026-11-08 08:01:00',time:T+60000});
});
it('keeps changed frozen conditions distinct, chooses the latest identical scheme and respects the selected round',()=>{
 const l=library(),old=l.rounds[0],record=l.records[0],second={...structuredClone(old),id:'second',startedAt:T+1};
 l.rounds.push(second);l.records.push({...record,id:'second-record',roundId:'second',status:'unmatched',matchedAt:undefined,updatedAt:T+120000});
 let index=screeningResultIndex(qualityScreeningResults({},l));expect(screeningRowResults(record.sample,index)).toHaveLength(1);expect(screeningCell(screeningRowResults(record.sample,index)).status).toBe('未入选');expect(screeningCell(screeningRowResults(record.sample,index,'r')).status).toBe('已入选');
 second.plans![0].rule!.threshold=.9;index=screeningResultIndex(qualityScreeningResults({},l));expect(screeningRowResults(record.sample,index)).toHaveLength(2);expect(old.plans![0].rule!.threshold).toBe(.7);
});
it('clears only the table display and retains its marker through stale saves, while new observations become visible',()=>{
 const l=library(),before=structuredClone(l),cleared={...l,records:l.records.map(r=>({...r,tableClearedAt:T+120000}))},merged=mergePreEntryLibraries(cleared,l);
 expect(qualityScreeningResults({},merged)).toEqual([]);expect(merged.records[0].readings).toEqual(before.records[0].readings);expect(merged.rounds).toEqual(before.rounds);expect(merged.records[0].status).toBe('matched');expect(preEntrySignal(merged.records[0])).toEqual(preEntrySignal(before.records[0]));
 const fresh=mergePreEntryLibraries(merged,{...l,records:[{...l.records[0],updatedAt:T+180000}]});expect(qualityScreeningResults({},fresh)).toHaveLength(1);
});
it('keeps the library directory readable after clearing and freezes independent snapshots without changing the scheme',()=>{
 const l=library();l.records[0].tableClearedAt=T+120000;const before=structuredClone(l),study=entryDirectoryStudy(l,l.rounds[0]),results=qualityScreeningResults(study);
 expect(results).toHaveLength(1);expect(results[0].record.tableClearedAt).toBeUndefined();expect(screeningRowResults(qualityComparisonRows(study)[0],screeningResultIndex(results))).toHaveLength(1);
 results[0].round.plans![0].rule!.threshold=.3;expect(l).toEqual(before);expect(newQualityStudy(T).screeningResults).toBeUndefined();
});
it('exports actual evidence including zero readings and never invents a first-match time for a failed record',()=>{
 const l=library();l.records[0].status='unmatched';delete l.records[0].matchedAt;const results=qualityScreeningResults({},l),cell=screeningCell(results),sheet=screeningResultsSheet(results);
 expect(cell.at).toBe('—');expect(cell.detail).toContain(' = 0');expect(sheet.rows[0]).toHaveLength(sheet.columns.length);expect(sheet.rows[0][4]).toBeNull();expect(sheet.rows[0][8]).toBe(JSON.stringify(l.rounds[0].plans));
});

it('shows newer live observations over a copied table snapshot while keeping its archived snapshot frozen',()=>{
 const l=library(),snapshot=entryDirectoryStudy(l,l.rounds[0]),before=structuredClone(snapshot);
 l.records[0]={...l.records[0],status:'scanning',matchedAt:undefined,updatedAt:T+180000,detail:'正在继续'};
 expect(qualityScreeningResults(snapshot,l)[0].record.status).toBe('scanning');expect(qualityScreeningResults(snapshot)[0].record.status).toBe('matched');expect(snapshot).toEqual(before);
});

it('renders v6 zero/guard/exclusion evidence without requiring the removed third field',()=>{
 const l=library();l.records[0].threeStage={at:T+60000,state:'matched',zero:{status:'pass'},first:{status:'pass'},second:{status:'pass'},readings:[]};
 expect(screeningCell(qualityScreeningResults({},l)).detail).toContain('⓪ 必要条件 pass / ① 防守线 pass / ② 排除门槛 pass');
});

it('prefers the active round for participating rows even in a selected history directory and leaves other rows historical',()=>{
 const l=library(),old=l.records[0],round={...structuredClone(l.rounds[0]),id:'working',startedAt:T+1},current={...structuredClone(old),id:'new-record',roundId:'working',status:'queued' as const,matchedAt:undefined,updatedAt:T+120000},outside={...structuredClone(old),id:'outside',sample:{...structuredClone(old.sample),source:{...old.sample.source,id:'other',symbol:'OTHERUSDT'}}};
 l.rounds.push(round);l.records.push(current,outside);const index=screeningResultIndex(qualityScreeningResults({},l));expect(screeningCell(screeningRowResults(old.sample,index,'r','working')).status).toBe('待筛选');expect(screeningCell(screeningRowResults(old.sample,index,'r')).status).toBe('已入选');expect(screeningCell(screeningRowResults(outside.sample,index,'r','working')).status).toBe('已入选');
});
