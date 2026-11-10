import {useRef,useState} from 'react';
import {Download,Upload} from 'lucide-react';
import {preparePreEntryDownload,importPreEntryFile} from '@/lib/fish/preEntryArchiveClient';
import type {PreEntryLibrary} from '@/lib/fish/preEntryMonitor';
export function FishEntryLibraryDataActions({library,onImport,owner,ready=true,onReload}:{library:PreEntryLibrary;onImport?:(l:PreEntryLibrary)=>Promise<boolean>;owner?:string;ready?:boolean;onReload?:()=>void}){
 const input=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const action='inline-flex h-7 items-center gap-1 rounded px-2 text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40';
 const download=async()=>{setBusy(true);setError('');try{const blob=await preparePreEntryDownload(owner,library),url=URL.createObjectURL(blob),link=document.createElement('a');try{link.href=url;link.download='入选库完整备份.json';document.body.appendChild(link);link.click();}finally{link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}}catch(reason){setError(reason instanceof Error?reason.message:'下载失败，原库保留');}finally{setBusy(false);}};
 return <span className="inline-flex flex-wrap items-center gap-1">
  <button type="button" disabled={busy||!ready} className={action} aria-label="完整下载筛选库" onClick={()=>void download()}><Download className="h-3 w-3"/>{busy?'正在处理…':'完整下载'}</button>
  <button type="button" disabled={busy||!onImport||!ready} className={action} aria-label="导入筛选库数据" onClick={()=>input.current?.click()}><Upload className="h-3 w-3"/>导入</button>
  <input ref={input} type="file" accept=".json,application/json" className="hidden" aria-label="选择筛选库数据文件" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file||!onImport)return;setBusy(true);setError('');try{if(file.size>8*1024*1024*1024)throw Error('数据文件超过 8 GB');const value=await importPreEntryFile(owner,file);if(!await onImport(value))throw Error('筛选库导入未保存，请重试');}catch(reason){setError(reason instanceof Error?reason.message:'导入失败');}finally{setBusy(false);}}}/>
  {error&&<><span role="alert" className="text-xs text-destructive">{error}</span>{onReload&&<button type="button" className={action} disabled={busy} onClick={onReload}>重新读取</button>}</>}
 </span>;
}
