import {useRef,useState} from 'react';
import {FishLibraryTransferMenu} from './FishLibraryDataMenu';
import type {FishLibraryExportActions} from './FishLibraryRowExport';
import {preparePreEntryDownload,importPreEntryFile} from '@/lib/fish/preEntryArchiveClient';
import type {PreEntryLibrary} from '@/lib/fish/preEntryMonitor';
export function FishEntryLibraryDataActions({library,onImport,owner,ready=true,onReload,actions}:{library:PreEntryLibrary;onImport?:(l:PreEntryLibrary)=>Promise<boolean>;owner?:string;ready?:boolean;onReload?:()=>void;actions:FishLibraryExportActions}){
 const input=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const retryClass='inline-flex h-7 items-center gap-1 rounded px-2 text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40';
 const download=async()=>{setBusy(true);setError('');try{const blob=await preparePreEntryDownload(owner,library),url=URL.createObjectURL(blob),link=document.createElement('a');try{link.href=url;link.download='入选库完整备份.json';document.body.appendChild(link);link.click();}finally{link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}}catch(reason){setError(reason instanceof Error?reason.message:'下载失败，原库保留');}finally{setBusy(false);}};
 return <span className="inline-flex flex-wrap items-center gap-1">
  <FishLibraryTransferMenu name="筛选库" actions={actions} disabled={busy}
    onBackup={()=>void download()} backupDisabled={!ready} onUpload={()=>input.current?.click()} uploadDisabled={!ready||!onImport}/>
  {busy&&<span role="status" className="text-xs text-muted-foreground">正在处理备份…</span>}
  <input ref={input} type="file" accept=".json,application/json" className="hidden" aria-label="选择筛选库数据文件" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file||!onImport)return;setBusy(true);setError('');try{if(file.size>8*1024*1024*1024)throw Error('数据文件超过 8 GB');const value=await importPreEntryFile(owner,file);if(!await onImport(value))throw Error('筛选库导入未保存，请重试');}catch(reason){setError(reason instanceof Error?reason.message:'导入失败');}finally{setBusy(false);}}}/>
  {error&&<><span role="alert" className="text-xs text-destructive">{error}</span>{onReload&&<button type="button" className={retryClass} disabled={busy} onClick={onReload}>重新读取</button>}</>}
 </span>;
}
