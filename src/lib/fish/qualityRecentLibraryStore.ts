import {supabase} from '@/integrations/supabase/client';
import {serializeAccountBlob,prepareAccountBlobEncoding} from '../accountBlobCodec';
import {syncAccountBlobFully,readImmutableAccountBlobForVerification,decodeAccountBlob} from '../accountBlobSync';
import {qualityArchiveBodyBlob} from './qualityArchiveStore';
import {applyArchiveSourceDeletions} from './libraryDeletion';
import {RECENT_MONITOR_PAGE_SIZE,fullMonitorDirectoryKey,recentMonitorDirectoryKey,recentMonitorDeletionsKey,recentMonitorSnapshots,recentMonitorBody,validRecentMonitorDirectory,type RecentMonitorBody,type RecentMonitorDirectory,type RecentMonitorEntry} from './qualityRecentLibrary';
import {runAccountSyncRequest} from '../accountSyncTransport';
import {setTemplateCampaignPath} from './qualityTemplateTable';
import type {FishQualityStudy} from './quality';
import {validLibraryDirectoryEdits,type LibraryDirectoryEdits} from './libraryDirectoryEdits';
import type {RecentMonitorSource} from './qualityRecentSource';

async function signedIn(owner:string){return (await supabase.auth.getSession()).data.session?.user.id===owner;}
async function readRows(owner:string,keys:string[],signal?:AbortSignal,headOnly=false){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000);
 try{
  const columns:string=headOnly?'key,revision:value->>rev,removed:value->>deleted':'key,value';
  const response=await supabase.from('user_sim_state').select(columns).eq('user_id',owner).in('key',keys).abortSignal(signal?AbortSignal.any([signal,controller.signal]):controller.signal);
  if(response.error)throw Error('近期目录读取失败，请重试');
  const entries=(response.data??[]) as unknown as {key:string;value?:unknown;revision?:string;removed?:string}[];
  return new Map(entries.map(row=>[row.key,headOnly?{rev:row.revision,deleted:row.removed==='true'}:row.value]));
 }finally{clearTimeout(timer);}
}
/** The screening dialog can open before the research study. Read only the
 * visibility metadata and recheck its revision in the same query. */
export async function readResearchDirectoryEdits(owner:string,signal:AbortSignal):Promise<LibraryDirectoryEdits>{
 if(!await signedIn(owner))throw Error('账号已切换，请重新打开筛选库');
 const headKey='idb:fish-quality';
 const first=await readRows(owner,[headKey],signal,true);
 if(!first.has(headKey))return {};
 const head=first.get(headKey) as {rev?:string;deleted?:boolean};
 if(!head.rev||head.deleted)throw Error('研究目录版本不可用');
 const keys=[fullMonitorDirectoryKey(head.rev),recentMonitorDirectoryKey(head.rev)];
 const columns:string='key,revision:value->>rev,removed:value->>deleted,owner:value->>owner,source:value->>sourceRevision,version:value->>version,edits:value->edits';
 const {data,error}=await supabase.from('user_sim_state').select(columns).eq('user_id',owner).in('key',[headKey,...keys]).abortSignal(signal);
 if(error)throw Error('无法读取筛选轮次的隐藏状态');
 const rows=(data??[]) as unknown as {key:string;revision?:string;removed?:string;owner?:string;source?:string;version?:string;edits?:unknown}[];
 const current=rows.find(row=>row.key===headKey);
 if(current?.revision!==head.rev||current.removed==='true')throw Error('研究目录已更新，请重新核对');
 for(const key of keys){
   const row=rows.find(item=>item.key===key);
   if(row?.owner===owner&&row.source===head.rev&&row.version==='1'){
     if(row.edits==null)return {};
     if(validLibraryDirectoryEdits(row.edits))return row.edits;
   }
 }
 throw Error('当前版本的轮次隐藏状态尚未核验');
}
const directoryReads=new Map<string,Promise<RecentMonitorDirectory|undefined>>();
export function readRecentMonitorDirectory(owner:string):Promise<RecentMonitorDirectory|undefined>{
 const pending=directoryReads.get(owner);
 if(pending)return pending;
 const task=fetchRecentMonitorDirectory(owner).finally(()=>{directoryReads.delete(owner);});
 directoryReads.set(owner,task);return task;
}
async function fetchRecentMonitorDirectory(owner:string):Promise<RecentMonitorDirectory|undefined>{
 if(!await signedIn(owner))throw Error('账号已切换，请重新打开监测库');
 const rows=await readRows(owner,['idb:fish-quality'],undefined,true);
 const head=rows.get('idb:fish-quality') as {rev?:string;deleted?:boolean}|undefined;
 if(!head?.rev||head.deleted)return undefined;
 const full=fullMonitorDirectoryKey(head.rev),recent=recentMonitorDirectoryKey(head.rev);
 const directories=await readRows(owner,[full,recent]);
 for(const key of [full,recent]){
  const directory=directories.get(key);
  if(validRecentMonitorDirectory(directory,owner,head.rev))return directory;
 }
}
async function sameRevision(owner:string,revision:string,signal?:AbortSignal){
 if(!await signedIn(owner))return false;
 const rows=await readRows(owner,['idb:fish-quality'],signal,true);
 const head=rows.get('idb:fish-quality') as {rev?:string;deleted?:boolean}|undefined;
 return !!head&&!head.deleted&&head.rev===revision;
}
export async function readRecentMonitorBody(directory:RecentMonitorDirectory,entry:RecentMonitorEntry,signal?:AbortSignal):Promise<FishQualityStudy>{
 const {owner,sourceRevision}=directory;
 if(!entry.bodyId||!await sameRevision(owner,sourceRevision,signal))throw Error('监测库目录已更新，请重新打开后读取');
 const {value:body}=await readImmutableAccountBlobForVerification(qualityArchiveBodyBlob(entry.bodyId),owner,signal);
 signal?.throwIfAborted();
 if(!body)throw Error('这份归档已删除或正文不可用');
 let marks=directory.deletions;
 if(!entry.bodyId.startsWith('recent-v1-')&&!marks){
  if(directory.deletionsKey!==recentMonitorDeletionsKey(sourceRevision))throw Error('归档删除标记未能核验');
  const row=(await readRows(owner,[directory.deletionsKey],signal)).get(directory.deletionsKey) as {version:number;owner:string;sourceRevision:string;encoded:{enc:'gzip'|'json';text:string}}|undefined;
  if(row?.version!==1||row.owner!==owner||row.sourceRevision!==sourceRevision||!row.encoded)throw Error('归档删除标记未能核验');
  marks=await decodeAccountBlob(row.encoded.enc,row.encoded.text) as NonNullable<RecentMonitorDirectory['deletions']>;
 }
 if(!await sameRevision(owner,sourceRevision,signal))throw Error('监测库目录已更新，请重新打开后读取');
 const result=(entry.bodyId.startsWith('recent-v1-')?body:applyArchiveSourceDeletions(body,marks!)) as FishQualityStudy;
 const {recentMonitorPaths:_paths,...view}=result as RecentMonitorBody;
 for(const value of view.results){const path=(body as RecentMonitorBody).recentMonitorPaths?.[value.key];if(path)setTemplateCampaignPath(value,path);}
 return view;
}

const publishing=new Map<string,Promise<void>>();
export function publishRecentMonitorDirectory(owner:string,sourceRevision:string,study:FishQualityStudy,complete=false):Promise<void>{
 const key=owner+'\0'+sourceRevision+'\0'+complete,active=publishing.get(key);if(active)return active;
 const task=publish(owner,sourceRevision,study,complete).finally(()=>{if(publishing.get(key)===task)publishing.delete(key);});
 publishing.set(key,task);return task;
}
async function publish(owner:string,sourceRevision:string,study:FishQualityStudy,complete:boolean){
 if(!await sameRevision(owner,sourceRevision))return;
 const key=complete?fullMonitorDirectoryKey(sourceRevision):recentMonitorDirectoryKey(sourceRevision);
 const existing=(await readRows(owner,[key])).get(key);
 if(validRecentMonitorDirectory(existing,owner,sourceRevision)&&existing.entries.length===existing.total)return;
 const {retiredDirectoryIds}=await import('./directoryTrash');
 const retired=await retiredDirectoryIds(owner,'monitor',AbortSignal.timeout(15000));
 const snapshots=recentMonitorSnapshots(study).filter(s=>!retired.has(s.entry.id)),entries:RecentMonitorEntry[]=[];
 const deletionsKey=recentMonitorDeletionsKey(sourceRevision);
 const {encoded}=await prepareAccountBlobEncoding({deletedSources:study.deletedSources,deletedReadings:study.deletedReadings,resolvedLegacySources:study.resolvedLegacySources});
 const deletionRow={user_id:owner,key:deletionsKey,value:{version:1,owner,sourceRevision,encoded}};
 const saved=await runAccountSyncRequest(()=>supabase.from('user_sim_state').upsert(deletionRow as never,{onConflict:'user_id,key'}),{bytes:serializeAccountBlob(deletionRow).length});
 if(!saved||saved.error)throw Error('归档删除标记保存未完成');
 const directory:RecentMonitorDirectory={version:1,owner,sourceRevision,generatedAt:Date.now(),entries,total:snapshots.length,olderMonitorRounds:(study as RecentMonitorSource).olderMonitorRounds,
  edits:study.monitorLibrary?.directoryEdits,deletionsKey};
 const save=async()=>{
  if(!await sameRevision(owner,sourceRevision))return false;
  const response=await runAccountSyncRequest(()=>supabase.from('user_sim_state').upsert({user_id:owner,key,value:directory as never},{onConflict:'user_id,key'}),{bytes:serializeAccountBlob(directory).length,preference:true,current:()=>true});
  if(!response||response.error)throw Error('近期目录保存未完成');return true;
 };
 for(const snapshot of snapshots){
  if(!await sameRevision(owner,sourceRevision))return;
  let bodyId=snapshot.entry.bodyId;
  if(snapshot.body){
   const body=recentMonitorBody(snapshot),text=serializeAccountBlob(body);
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
   bodyId='recent-v1-'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
   const blob=qualityArchiveBodyBlob(bodyId);
   // Content-addressed copies have their own IDs. Original archive bodies stay untouched.
   if(!await blob.read(owner))await blob.write(owner,body);
   const status=await syncAccountBlobFully(blob,owner,180_000);
   if(status==='failed'||status==='timed_out'||status==='skipped')throw Error('近期记录保存未完成');
  }
  if(!bodyId)continue;
  entries.push({...snapshot.entry,bodyId});
  if(!complete&&entries.length%RECENT_MONITOR_PAGE_SIZE===0&&!await save())return;
  // Keep UI input responsive while older entries are prepared in the background.
  await new Promise<void>(resolve=>setTimeout(resolve,0));
 }
 await save();
}
