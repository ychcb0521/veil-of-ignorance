import {beforeEach,expect,it,vi} from 'vitest';
const cloud=vi.hoisted(()=>({owner:'alice',rows:new Map<string,unknown>(),reads:[] as string[][],writes:[] as {key:string;value:any}[],body:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getSession:async()=>({data:{session:{user:{id:cloud.owner}}}})},from:()=>({
 select:()=>{let keys:string[]=[],owner='';const q:any={eq:(_key:string,value:string)=>{owner=value;return q;},in:(_key:string,value:string[])=>{keys=value;return q;},abortSignal:()=>q,
 then:(resolve:any,reject:any)=>{cloud.reads.push(keys);return Promise.resolve({data:owner===cloud.owner?keys.filter(key=>cloud.rows.has(key)).map(key=>({key,value:cloud.rows.get(key)})):[],error:null}).then(resolve,reject);}};return q;},
 upsert:async(row:any)=>{cloud.rows.set(row.key,structuredClone(row.value));cloud.writes.push(structuredClone(row));return {error:null};},
})}}));
vi.mock('../qualityArchiveStore',()=>({readOriginalQualityArchive:cloud.body,qualityArchiveBodyBlob:()=>({read:async()=>undefined,write:async()=>{}})}));
vi.mock('@/lib/accountBlobSync',()=>({syncAccountBlobFully:async()=> 'pushed',readImmutableAccountBlobForVerification:cloud.body,decodeAccountBlob:vi.fn()}));
import {readRecentMonitorDirectory,readRecentMonitorBody,publishRecentMonitorDirectory} from '../qualityRecentLibraryStore';
import {recentMonitorDirectoryKey,recentMonitorDeletionsKey,type RecentMonitorDirectory} from '../qualityRecentLibrary';
import {newQualityStudy} from '../quality';
import {__resetAccountSyncTransportForTests} from '../../accountSyncTransport';
const at=1795242107522;
function catalog():RecentMonitorDirectory{return {version:1,owner:'alice',sourceRevision:'r1',generatedAt:at,total:1,deletions:{},entries:[{id:'round',at,label:'监测轮次',summary:'1',bodyId:'body',templateDirectory:{id:'P',title:'P'}}]};}
beforeEach(()=>{cloud.owner='alice';cloud.rows.clear();cloud.reads=[];cloud.writes=[];cloud.body.mockReset();cloud.rows.set('idb:fish-quality',{rev:'r1'});__resetAccountSyncTransportForTests();});
it('reads only the current lightweight catalog and rejects another account or revision',async()=>{
 cloud.rows.set(recentMonitorDirectoryKey('r1'),catalog());
 expect(await readRecentMonitorDirectory('alice')).toEqual(catalog());
 expect(cloud.reads).toEqual([['idb:fish-quality'],[recentMonitorDirectoryKey('r1')]]);
 await expect(readRecentMonitorDirectory('bob')).rejects.toThrow('账号已切换');
 cloud.rows.set('idb:fish-quality',{rev:'r2'});expect(await readRecentMonitorDirectory('alice')).toBeUndefined();
});
it('does not expose a body if the source revision changes during its read',async()=>{
 const directory=catalog();cloud.body.mockImplementation(async()=>{cloud.rows.set('idb:fish-quality',{rev:'r2'});return {value:newQualityStudy(at),revision:'body-r1'};});
 await expect(readRecentMonitorBody(directory,directory.entries[0])).rejects.toThrow('目录已更新');
 expect(cloud.writes).toEqual([]);
});
it('publishes newest-first pages without writing any original study, template or archive key',async()=>{
 const study=newQualityStudy(at);study.monitorLibrary={version:1,importedLegacy:true,settings:[],records:[],rounds:[],archives:Array.from({length:14},(_,i)=>({id:'old-body-'+i,version:1,createdAt:at+i,reason:'restart'}))};
 await publishRecentMonitorDirectory('alice','r1',study);
 const catalogs=cloud.writes.filter(row=>row.key===recentMonitorDirectoryKey('r1'));
 expect(catalogs.map(row=>row.value.entries.length)).toEqual([12,14]);
 expect(cloud.writes.every(row=>[recentMonitorDirectoryKey('r1'),recentMonitorDeletionsKey('r1')].includes(row.key))).toBe(true);
 expect(catalogs[0].value.entries[0].id).toBe('old-body-13');expect(catalogs[0].value.deletions).toBeUndefined();expect(cloud.body).not.toHaveBeenCalled();
 expect(cloud.rows.get('idb:fish-quality')).toEqual({rev:'r1'});
});
it('skips an obsolete publisher before uploading any body',async()=>{
 await publishRecentMonitorDirectory('alice','r2',newQualityStudy(at));expect(cloud.writes).toEqual([]);
});
it('keeps deleted bodies unavailable even if an old local archive copy might still exist',async()=>{
 cloud.body.mockResolvedValue({value:undefined,revision:'deleted'});const directory=catalog();
 await expect(readRecentMonitorBody(directory,directory.entries[0])).rejects.toThrow('已删除');expect(cloud.writes).toEqual([]);
});
it('returns a normal study so private transfer metadata cannot be copied into the active study',async()=>{
 const directory=catalog();directory.entries[0].bodyId='recent-v1-'+'a'.repeat(64);
 const body={...newQualityStudy(at),recentMonitorPaths:{}};cloud.body.mockResolvedValue({value:body,revision:'body-r1'});
 const view=await readRecentMonitorBody(directory,directory.entries[0]);
 expect(view).toEqual(newQualityStudy(at));expect(view).not.toHaveProperty('recentMonitorPaths');expect(body).toHaveProperty('recentMonitorPaths');
});
