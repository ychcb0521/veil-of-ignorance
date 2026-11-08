import {useRef,useState} from 'react';
import {Download,Upload} from 'lucide-react';
import {parsePreEntryLibraryBackup,downloadPreEntryLibraryBackup} from '@/lib/fish/preEntryLibraryTransfer';
import type {PreEntryLibrary} from '@/lib/fish/preEntryMonitor';
export function FishEntryLibraryDataActions({library,onImport}:{library:PreEntryLibrary;onImport?:(l:PreEntryLibrary)=>Promise<boolean>}){
 const input=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const action='inline-flex h-7 items-center gap-1 rounded px-2 text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground';
 return <span className="inline-flex flex-wrap items-center gap-1"><button type="button" className={action} aria-label="完整下载筛选库" onClick={()=>downloadPreEntryLibraryBackup(library)}><Download className="h-3 w-3"/>完整下载</button><button type="button" disabled={busy||!onImport} className={action} aria-label="导入筛选库数据" onClick={()=>input.current?.click()}><Upload className="h-3 w-3"/>{busy?'正在导入…':'导入'}</button><input ref={input} type="file" accept=".json,application/json" className="hidden" aria-label="选择筛选库数据文件" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file||!onImport)return;setBusy(true);setError('');try{if(file.size>128*1024*1024)throw Error('数据文件超过 128 MB');const value=parsePreEntryLibraryBackup(await file.text());if(!await onImport(value))throw Error('筛选库导入未保存，请重试');}catch(reason){setError(reason instanceof Error?reason.message:'导入失败');}finally{setBusy(false);}}}/>{error&&<span role="alert" className="text-xs text-destructive">{error}</span>}</span>;
}
