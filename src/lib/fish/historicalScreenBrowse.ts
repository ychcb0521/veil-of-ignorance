import {readImmutableAccountBlobForVerification} from '../accountBlobSync';
import {preEntryV5AccountBlob} from './preEntryMonitorV5Store';
import {preEntryTableClearsAccountBlob} from './preEntryMonitorV6Store';
import {readRecentMonitorDirectory} from './qualityRecentLibraryStore';
import {readBrowseRevisions} from './libraryBrowse';
import {screenBrowse} from './screenBrowse';

export async function historicalScreenBrowse(owner:string,signal:AbortSignal){
 const [library,marks,directory]=await Promise.all([
   readImmutableAccountBlobForVerification(preEntryV5AccountBlob,owner),
   readImmutableAccountBlobForVerification(preEntryTableClearsAccountBlob,owner),
   readRecentMonitorDirectory(owner),
 ]);
 if(signal.aborted||!library.value||!directory)return;
 const revisions=await readBrowseRevisions(owner,'screen',signal);
 if(!revisions||revisions['idb:fish-quality']!==directory.sourceRevision||
   revisions['idb:pre-entry-monitor-v5']!==library.revision||
   revisions['idb:pre-entry-table-clears-v1']!==(marks.revision??''))return;
 return screenBrowse(library.value,marks.value??{},directory.edits);
}
