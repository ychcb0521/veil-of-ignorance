import {retiredDirectoryIds} from './directoryTrash';
import {supabase} from '@/integrations/supabase/client';
import {syncedImmutableAccountBlobRevision} from '../accountBlobSync';
import {runAccountSyncRequest} from '../accountSyncTransport';
import {browsePageKey,filterDetectorCatalogKey,miningSeriesCatalogKey,miningSeriesRevisionKey,readBrowseCatalog,readBrowseRevisions,fullBrowseKey,recentBrowseKey,type BrowseRow,type BrowseGroup,type BrowseScope} from './libraryBrowse';
import {filterBrowseRow} from './libraryBrowseProjection';
import {miningBrowseSeriesGroups,type BrowseGroupRows} from './miningSeriesBrowse';
import {createFilterDirectoryReader} from './qualityLibraryDirectory';
import {readRecentMonitorDirectory} from './qualityRecentLibraryStore';
import type {FishQualityStudy} from './quality';
import type {FishMiningLibrary} from './miningLibrary';

type GroupRows=BrowseGroupRows;
const inflight=new Map<string,Promise<void>>();
const byTime=(a:BrowseRow,b:BrowseRow)=>b[1]-a[1]||b[3].localeCompare(a[3]);
const digest=async(raw:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('');
export async function writeBrowsePage(owner:string,rows:BrowseRow[],signal?:AbortSignal){
 const raw=new TextEncoder().encode(JSON.stringify(rows)),hash=await digest(raw);
 const bytes=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 const gzip=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
 const row={user_id:owner,key:browsePageKey(hash),value:{browse:{gzip}}};
 const saved=await runAccountSyncRequest(()=>{
   signal?.throwIfAborted();
   const query=supabase.from('user_sim_state').upsert(row as never,{onConflict:'user_id,key',ignoreDuplicates:true});
   return signal?query.abortSignal(signal):query;
 },{bytes:gzip.length,current:()=>!signal?.aborted});
 return saved&&!saved.error?hash:undefined;
}
async function publish(owner:string,scope:BrowseScope,revision:string,source:(revisions:Record<string,string>)=>Promise<GroupRows[]|undefined>,miningSeries=false){
 const key=owner+'|'+scope+'|'+revision;
 if(inflight.has(key))return inflight.get(key);
 const task=(async()=>{
   const existing=await readBrowseCatalog(owner,scope,AbortSignal.timeout(15000));
   if(existing&&!existing.recent&&(scope!=='filter'||existing.detectorPreview)&&(!miningSeries||existing.miningSeries))return;
   const revisions=await readBrowseRevisions(owner,scope,AbortSignal.timeout(15000));
   if(!revisions)return;
   const main=scope==='filter'?'fish-quality':'fish-mining-library';
   const receipt=scope==='mining'?'fish-mining-library-pages-v1':main;
   if(revisions['idb:'+main]!==revision||await syncedImmutableAccountBlobRevision(receipt,owner)!==revision)return;
   const retired=await retiredDirectoryIds(owner,scope,AbortSignal.timeout(15000));
   const input=await source(revisions);
   if(!input)return;
   const groups:BrowseGroup[]=[], detectorGroups:BrowseGroup[]=[];
   // Publish immutable pages first. Losing the network cannot expose a partial catalog.
   for(const {rows,...group} of input.sort((a,b)=>b.at-a.at)){
     if(retired.has(group.id))continue;
     if(group.children){
       const children:BrowseGroup[]=[];
       for(const child of group.children){
         const pages:string[]=[];
         child.rows.sort(byTime);
         for(let start=0;start<child.rows.length;start+=350){
           const hash=await writeBrowsePage(owner,child.rows.slice(start,start+350));
           if(!hash)return;
           pages.push(hash);
         }
         children.push({id:child.id,title:child.title,at:child.at,count:child.rows.length,pages});
       }
       const pages:string[]=[];
       rows.sort(byTime);
       for(let start=0;start<rows.length;start+=350){
         const hash=await writeBrowsePage(owner,rows.slice(start,start+350));
         if(!hash)return;
         pages.push(hash);
       }
       groups.push({id:group.id,title:group.title,at:group.at,count:rows.length,pages,children});
       continue;
     }
     const pages:string[]=[], detectorPages:string[]=[];
     const withDetectors=rows.some(row=>row[4]?.length);
     rows.sort(byTime);
     for(let start=0;start<rows.length;start+=350){
       const batch=rows.slice(start,start+350);
       const hash=await writeBrowsePage(owner,withDetectors?batch.map(([symbol,time,detail,id])=>[symbol,time,detail,id]):batch);
       if(!hash)return;
       pages.push(hash);
       if(withDetectors){
         const richHash=batch.some(row=>row[4]?.length)?await writeBrowsePage(owner,batch):hash;
         if(!richHash)return;
         detectorPages.push(richHash);
       }
     }
     const metadata={id:group.id,title:group.title,at:group.at,count:rows.length};
     groups.push({...metadata,pages});
     if(scope==='filter')detectorGroups.push({...metadata,pages:withDetectors?detectorPages:pages});
   }
   const latest=await readBrowseRevisions(owner,scope,AbortSignal.timeout(15000));
   if(JSON.stringify(latest)!==JSON.stringify(revisions)||await syncedImmutableAccountBlobRevision(receipt,owner)!==revision)return;
   const value={browse:{version:1,scope,owner,revisions,groups,...(miningSeries?{miningSeries:true}:{})}};
   const catalogs=(miningSeries?[miningSeriesRevisionKey(revisions)]:[fullBrowseKey(scope,revisions),recentBrowseKey(scope,revisions)]).map(key=>({user_id:owner,key,value}));
   if(scope==='filter'){
     const browse={...value.browse,detectorPreview:true,groups:detectorGroups};
     catalogs.push({user_id:owner,key:filterDetectorCatalogKey(revisions),value:{browse}});
   }
   if(miningSeries){
     // The existing purge RPC tracks each parent's flat page references. Keep a
     // reference ledger for child pages without exposing it as a legacy catalog.
     const references={browse:{groups:groups.map(group=>({id:group.id,pages:[...new Set(group.children?.flatMap(child=>child.pages)??[])]}))}};
     const saved=await runAccountSyncRequest(()=>supabase.from('user_sim_state').upsert({user_id:owner,key:miningSeriesRevisionKey(revisions)+'/refs',value:references} as never,{onConflict:'user_id,key',ignoreDuplicates:true}),{bytes:JSON.stringify(references).length});
     if(!saved||saved.error)return;
   }
   const saved=await runAccountSyncRequest(()=>supabase.from('user_sim_state').upsert(catalogs as never,{onConflict:'user_id,key',ignoreDuplicates:true}),{bytes:JSON.stringify(catalogs).length});
   if(!saved||saved.error)return;
   if(miningSeries)await runAccountSyncRequest(()=>supabase.from('user_sim_state').upsert({user_id:owner,key:miningSeriesCatalogKey(),value} as never,{onConflict:'user_id,key'}),{bytes:JSON.stringify(value).length});
 })().finally(()=>inflight.delete(key));
 inflight.set(key,task);return task;
}
export function publishFilterBrowse(owner:string,revision:string,study:FishQualityStudy){
 return publish(owner,'filter',revision,async()=>{
   const library=study.filterLibrary;if(!library)return;
   const read=createFilterDirectoryReader(library),edits=study.monitorLibrary?.directoryEdits;
   const groups=library.rounds.filter(r=>!edits?.[r.id]?.hidden)
     .map(r=>({id:r.id,at:r.startedAt,title:edits?.[r.id]?.name??'过滤轮次',rows:read(r).records.map(filterBrowseRow)}));
   const legacy=read().records;
   if(legacy.length&&!edits?.['filter-legacy']?.hidden)groups.push({id:'filter-legacy',title:edits?.['filter-legacy']?.name??'历史记录',at:legacy.reduce((at,r)=>Math.max(at,r.updatedAt),0),rows:legacy.map(filterBrowseRow)});
   return groups;
 });
}
export async function publishMiningBrowse(owner:string,library:FishMiningLibrary){
 const revision=await syncedImmutableAccountBlobRevision('fish-mining-library-pages-v1',owner);
 if(!revision)return;
 return publish(owner,'mining',revision,async revisions=>{
   const directory=await readRecentMonitorDirectory(owner);
   if(!directory||directory.sourceRevision!==revisions?.['idb:fish-quality']||
     (await syncedImmutableAccountBlobRevision('fish-mining-deletions-v1',owner)??'')!==revisions['idb:fish-mining-deletions-v1'])return;
   return miningBrowseSeriesGroups(library,directory.edits);
 },true);
}
