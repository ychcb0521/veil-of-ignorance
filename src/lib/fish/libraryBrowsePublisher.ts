import {supabase} from '@/integrations/supabase/client';
import {syncedImmutableAccountBlobRevision} from '../accountBlobSync';
import {runAccountSyncRequest} from '../accountSyncTransport';
import {browsePageKey,readBrowseCatalog,readBrowseRevisions,recentBrowseKey,type BrowseRow,type BrowseGroup,type BrowseScope} from './libraryBrowse';
import {filterBrowseRow,miningBrowseRows} from './libraryBrowseProjection';
import {createFilterDirectoryReader} from './qualityLibraryDirectory';
import {miningRecordSavedAt} from './libraryDeletion';
import {readRecentMonitorDirectory} from './qualityRecentLibraryStore';
import type {FishQualityStudy} from './quality';
import type {FishMiningLibrary} from './miningLibrary';

type GroupRows={id:string;title:string;at:number;rows:BrowseRow[]};
const inflight=new Map<string,Promise<void>>();
const byTime=(a:BrowseRow,b:BrowseRow)=>b[1]-a[1]||b[3].localeCompare(a[3]);
const digest=async(raw:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('');
async function publish(owner:string,scope:BrowseScope,revision:string,source:(revisions:Record<string,string>)=>Promise<GroupRows[]|undefined>){
 const key=owner+'|'+scope+'|'+revision;
 if(inflight.has(key))return inflight.get(key);
 const task=(async()=>{
   if(await readBrowseCatalog(owner,scope,AbortSignal.timeout(15000)))return;
   const revisions=await readBrowseRevisions(owner,scope,AbortSignal.timeout(15000));
   if(!revisions)return;
   const main=scope==='filter'?'fish-quality':'fish-mining-library';
   const receipt=scope==='mining'?'fish-mining-library-pages-v1':main;
   if(revisions['idb:'+main]!==revision||await syncedImmutableAccountBlobRevision(receipt,owner)!==revision)return;
   const input=await source(revisions);
   if(!input)return;
   const groups:BrowseGroup[]=[];
   // Publish immutable pages first. Losing the network cannot expose a partial catalog.
   for(const {rows,...group} of input.sort((a,b)=>b.at-a.at).slice(0,12)){
     const first=rows.sort(byTime).slice(0,100);
     const raw=new TextEncoder().encode(JSON.stringify(first)),hash=await digest(raw);
     const bytes=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
     const gzip=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
     const row={user_id:owner,key:browsePageKey(hash),value:{browse:{gzip}}};
     const saved=await runAccountSyncRequest(()=>supabase.from('user_sim_state').upsert(row as never,{onConflict:'user_id,key',ignoreDuplicates:true}),{bytes:gzip.length});
     if(!saved||saved.error)return;
     groups.push({...group,count:rows.length,pages:first.length?[hash]:[]});
   }
   const latest=await readBrowseRevisions(owner,scope,AbortSignal.timeout(15000));
   if(JSON.stringify(latest)!==JSON.stringify(revisions)||await syncedImmutableAccountBlobRevision(receipt,owner)!==revision)return;
   const value={browse:{version:1,scope,owner,revisions,groups,recent:true}};
   await runAccountSyncRequest(()=>supabase.from('user_sim_state').upsert({user_id:owner,key:recentBrowseKey(scope,revisions),value} as never,{onConflict:'user_id,key',ignoreDuplicates:true}),{bytes:JSON.stringify(value).length});
 })().finally(()=>inflight.delete(key));
 inflight.set(key,task);return task;
}
export function publishFilterBrowse(owner:string,revision:string,study:FishQualityStudy){
 return publish(owner,'filter',revision,async()=>{
   const library=study.filterLibrary;if(!library)return;
   const read=createFilterDirectoryReader(library),edits=study.monitorLibrary?.directoryEdits;
   return library.rounds.filter(r=>!edits?.[r.id]?.hidden).sort((a,b)=>b.startedAt-a.startedAt).slice(0,12)
     .map(r=>({id:r.id,at:r.startedAt,title:edits?.[r.id]?.name??'过滤轮次',rows:read(r).records.map(filterBrowseRow)}));
 });
}
export async function publishMiningBrowse(owner:string,library:FishMiningLibrary){
 const revision=await syncedImmutableAccountBlobRevision('fish-mining-library-pages-v1',owner);
 if(!revision)return;
 return publish(owner,'mining',revision,async revisions=>{
   const directory=await readRecentMonitorDirectory(owner);
   if(!directory||directory.sourceRevision!==revisions?.['idb:fish-quality']||
     (await syncedImmutableAccountBlobRevision('fish-mining-deletions-v1',owner)??'')!==revisions['idb:fish-mining-deletions-v1'])return;
   const groups=new Map<string,GroupRows>(),runs=new Map(library.runs.map(r=>[r.id,r]));
   for(const record of library.records){
     for(const {family,row} of miningBrowseRows(record,runs.get(record.runId))){
       const id='mining-family-'+family,edit=directory.edits?.[id];
       if(edit?.hidden&&miningRecordSavedAt(record)<=edit.at)continue;
       const group=groups.get(id)??{id,at:0,title:edit?.name??family+' 系列',rows:[]};
       group.rows.push(row);group.at=Math.max(group.at,row[1]);groups.set(id,group);
     }
   }
   return [...groups.values()];
 });
}
