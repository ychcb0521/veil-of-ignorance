import {retiredDirectoryIds} from './directoryTrash';
import {supabase} from '@/integrations/supabase/client';
import {readImmutableAccountBlobForVerification} from '../accountBlobSync';
import {preEntryV5AccountBlob} from './preEntryMonitorV5Store';
import {preEntryTableClearsAccountBlob} from './preEntryMonitorV6Store';
import {readRecentMonitorDirectory} from './qualityRecentLibraryStore';
import {fullBrowseKey,readBrowseRevisions,type BrowseGroup} from './libraryBrowse';
import {writeBrowsePage} from './libraryBrowsePublisher';
import {screenBrowse} from './screenBrowse';

/** Rebuild only the derived index requested by the user. The revision-specific
 * catalog becomes visible after its immutable pages are saved and checked. */
export async function rebuildHistoricalScreenCatalog(owner:string,signal:AbortSignal){
 const [library,marks,directory]=await Promise.all([
   readImmutableAccountBlobForVerification(preEntryV5AccountBlob,owner,signal),
   readImmutableAccountBlobForVerification(preEntryTableClearsAccountBlob,owner,signal),
   readRecentMonitorDirectory(owner),
 ]);
 signal.throwIfAborted();
 if(!library.value||!directory)throw Error('缺少可核验的历史筛选数据或目录编辑记录');
 const revisions=await readBrowseRevisions(owner,'screen',signal);
 if(!revisions||revisions['idb:fish-quality']!==directory.sourceRevision||
   revisions['idb:pre-entry-monitor-v5']!==library.revision||
   revisions['idb:pre-entry-table-clears-v1']!==(marks.revision??''))throw Error('历史归档版本已更新，请重试');
 const snapshot=screenBrowse(library.value,marks.value??{},directory.edits)??{groups:[],pages:{}};
 const retired=await retiredDirectoryIds(owner,'screen',signal);
 const groups:BrowseGroup[]=[];
 for(const group of snapshot.groups){
   if(retired.has(group.id))continue;
   const pages:string[]=[];
   for(const page of group.pages){
     signal.throwIfAborted();
     const hash=await writeBrowsePage(owner,snapshot.pages[page],signal);
     if(!hash)throw Error('归档记录页未保存，请重试');
     pages.push(hash);
   }
   groups.push({...group,pages});
 }
 const latest=await readBrowseRevisions(owner,'screen',signal);
 if(!latest||fullBrowseKey('screen',latest)!==fullBrowseKey('screen',revisions))throw Error('归档在建立目录期间已更新，请重试');
 const key=fullBrowseKey('screen',revisions);
 const row={user_id:owner,key,value:{browse:{version:1,owner,scope:'screen',revisions,groups}}};
 const {error}=await supabase.from('user_sim_state').upsert(row as never,{onConflict:'user_id,key',ignoreDuplicates:true}).abortSignal(signal);
 if(error)throw Error('历史归档目录未保存，请重试');
}
