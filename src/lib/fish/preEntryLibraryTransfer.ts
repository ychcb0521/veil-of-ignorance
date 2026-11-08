import {validLibraryDirectoryEdits} from './libraryDirectoryEdits';
import {type PreEntryLibrary} from './preEntryMonitor';
/** Backup/import is additive. Current runnable settings are never replaced by import. */
export function parsePreEntryLibraryBackup(text:string):PreEntryLibrary{
 const value=JSON.parse(text),library=value?.format==='veil-pre-entry-library'&&value.version===1?value.library:undefined;
 if(!library||library.version!==1||!Array.isArray(library.rounds)||!Array.isArray(library.records))throw Error('入选库数据包格式无效');
 const ids=new Set<string>();
 for(const r of library.rounds){if(!r||typeof r.id!=='string'||ids.has(r.id)||!Number.isFinite(r.startedAt)||!Number.isFinite(r.updatedAt)||!Array.isArray(r.filters)||!['running','paused','complete'].includes(r.state)||r.plans!==undefined&&!Array.isArray(r.plans))throw Error('入选库轮次无效');ids.add(r.id);}
 const records=new Set<string>();
 for(const r of library.records){if(!r||typeof r.id!=='string'||records.has(r.id)||!ids.has(r.roundId)||typeof r.sample?.source?.symbol!=='string'||!Number.isFinite(r.sample?.source?.timeMs)||!Number.isFinite(r.updatedAt)||!Array.isArray(r.sample.groups)||!Array.isArray(r.readings)||!['queued','scanning','paused','matched','unmatched','warming','error'].includes(r.status)||r.status==='matched'&&!(r.matchedAt>0))throw Error('入选库记录无效');records.add(r.id);}
 if(library.directoryEdits!==undefined&&!validLibraryDirectoryEdits(library.directoryEdits))throw Error('目录标记无效');
 return library;
}
export function downloadPreEntryLibraryBackup(library:PreEntryLibrary){
 const url=URL.createObjectURL(new Blob([JSON.stringify({format:'veil-pre-entry-library',version:1,exportedAt:Date.now(),library})],{type:'application/json'})),link=document.createElement('a');
 try{link.href=url;link.download='入选库完整备份.json';document.body.appendChild(link);link.click();}finally{link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
