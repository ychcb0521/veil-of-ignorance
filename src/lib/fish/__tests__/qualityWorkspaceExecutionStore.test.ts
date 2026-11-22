import {afterEach,expect,it,vi} from 'vitest';
import {newQualityStudy,qualityComparisonRows} from '../quality';
import {browseInformationStudy} from '../browseInformationStudy';
import {loadQualityWorkspaceExecution,saveExecutableQualityStudy,mergeQualityWorkspaceExecution} from '../qualityWorkspaceExecutionStore';
import {workspaceCampaignFixture} from './workspaceCampaign.fixture';
const historical=vi.hoisted(()=>vi.fn(async()=>true));
vi.mock('../qualityStore',()=>({saveQualityStudy:historical}));
function fixture(){
 const rows=new Map<string,unknown>(),reads:string[]=[],writes:string[]=[];
 const db={close(){},transaction(){
  let pending=0;const tx={error:null,oncomplete:()=>{},onerror:()=>{},onabort:()=>{},objectStore:()=>({
   get(key:string){expect(key).not.toBe('fish-quality:alice');reads.push(key);pending++;const r={result:undefined as unknown,onsuccess:()=>{}};queueMicrotask(()=>{r.result=structuredClone(rows.get(key));r.onsuccess();if(!--pending)queueMicrotask(()=>tx.oncomplete());});return r;},
   put(value:unknown,key:string){writes.push(key);rows.set(key,structuredClone(value));pending++;queueMicrotask(()=>{if(!--pending)queueMicrotask(()=>tx.oncomplete());});},
  })};return tx;
 }};
 vi.stubGlobal('indexedDB',{open:()=>{const r={result:db,onsuccess:()=>{},onerror:()=>{},onblocked:()=>{}};queueMicrotask(()=>r.onsuccess());return r;}});
 return {rows,reads,writes};
}
afterEach(()=>{vi.unstubAllGlobals();historical.mockClear();});
it('restores and persists an executable selected table without reading or writing the historical row or templates',async()=>{
 const f=fixture(),original={...newQualityStudy(1),planTemplates:[{id:'asset',name:'原模板',savedAt:1,updatedAt:1}]};
 f.rows.set('fish-quality:alice',original);const before=structuredClone(original);
 const info=browseInformationStudy('filter','r',[['PICKED',1,'冻结值','a'],['UNPICKED',2,'','b']]);info.workspaceUpdatedAt=10;info.selectedRowIds=[qualityComparisonRows(info)[0].id];
 const settings={...newQualityStudy(),sellPlans:[],sellPlansConfigured:true,planTemplates:original.planTemplates};
 const loaded=await loadQualityWorkspaceExecution('alice',info,settings);
 expect(loaded.workspaceExecution).toBe(1);expect(loaded.selectedRowIds).toEqual(info.selectedRowIds);
 const next={...loaded,workspaceUpdatedAt:11,filterReadings:[{key:'read',value:0}]};
 expect(await saveExecutableQualityStudy('alice',next)).toBe(true);
 const restored=await loadQualityWorkspaceExecution('alice',info,settings);
 expect(restored.filterReadings).toEqual(next.filterReadings);expect(restored.samples).toEqual(info.samples);
 expect(f.writes).not.toContain('fish-quality:alice');expect(f.rows.get('fish-quality:alice')).toEqual(before);expect(historical).not.toHaveBeenCalled();
 expect((f.rows.get('fish-quality:alice:workspace-execution-v1') as any).planTemplates).toBeUndefined();
 const other=await loadQualityWorkspaceExecution('bob',newQualityStudy(),settings);expect(other.samples).toEqual([]);
});
it('preserves legacy saves and merges working results into an explicitly loaded history without changing frozen templates',async()=>{
 const history={...newQualityStudy(1),planTemplates:[{id:'old',name:'冻结模板',savedAt:1,updatedAt:1}]},before=structuredClone(history);
 await saveExecutableQualityStudy('alice',history);expect(historical).toHaveBeenCalledWith('alice',history);
 const working={...browseInformationStudy('mining','r',[['PICKED',2,'','a']]),workspaceExecution:1 as const,workspaceUpdatedAt:2,
  results:[{key:'new-result',sampleId:'a',groupId:'p',evaluatedAt:2,status:'closed' as const}],filterReadings:[{key:'zero',value:0}]};
 const merged=mergeQualityWorkspaceExecution(history,working);
 expect(merged.workspaceExecution).toBeUndefined();expect(merged.planTemplates).toEqual(history.planTemplates);expect(merged.results).toEqual(working.results);expect(merged.filterReadings).toEqual(working.filterReadings);expect(history).toEqual(before);
});
it('keeps working frozen campaign history after a full archive is explicitly opened, even if current samples/plans were removed',()=>{
 const history=newQualityStudy(1),working=workspaceCampaignFixture();
 const frozen=structuredClone(working.campaignRuns);
 working.samples=[];working.sellPlans=[];working.results=[];
 const merged=mergeQualityWorkspaceExecution(history,working);
 expect(merged.campaignRuns).toEqual(frozen);expect(history.campaignRuns).toBeUndefined();
});
it('commits the working snapshot before letting the campaign reader enter the archive queue and publishes a saved event',async()=>{
 const f=fixture(),study={...newQualityStudy(),workspaceExecution:1 as const};
 const listener=vi.fn();window.addEventListener('fish-quality-saved',listener);
 try{
  const save=saveExecutableQualityStudy('alice',study);
  const {serializeArchiveWork}=await import('@/lib/serializeArchiveWork');
  const observed=serializeArchiveWork(async()=>structuredClone(f.rows.get('fish-quality:alice:workspace-execution-v1')));
  expect(await save).toBe(true);expect(await observed).toMatchObject({workspaceExecution:1});
  expect(listener).toHaveBeenCalledOnce();expect(listener.mock.calls[0][0].detail).toEqual({owner:'alice'});
 }finally{window.removeEventListener('fish-quality-saved',listener);}
});
