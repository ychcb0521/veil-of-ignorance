import {useEffect,useRef,useState} from 'react';
import {listQualityTemplateArchive,readQualityTemplateArchive,type QualityTemplateArchiveRow} from '@/lib/fish/qualityTemplateArchive';
import type {QualityPlanTemplate} from '@/lib/fish/qualityPlanTemplates';
export function FishQualityTemplateArchive({owner,restore}:{owner?:string;restore?:(t:QualityPlanTemplate)=>void}){
 const [open,setOpen]=useState(false),[rows,setRows]=useState<QualityTemplateArchiveRow[]>([]),[loading,setLoading]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[revision,setRevision]=useState(0);
 const current=useRef(owner);current.current=owner;
 useEffect(()=>{setRows([]);setMessage('');setError('');setBusy('');setLoading(false);setOpen(false);},[owner]);
 useEffect(()=>{if(!open||!owner)return;let active=true;setLoading(true);setError('');void listQualityTemplateArchive(owner).then(data=>{if(active)setRows(data);},()=>{if(active)setError('系统存档读取失败，请重试');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[open,owner,revision]);
 if(!owner||!restore)return null;
 const recover=async(row:QualityTemplateArchiveRow)=>{
  if(busy)return;setBusy(row.id);setError('');setMessage('');const savedOwner=owner;
  try{const t=await readQualityTemplateArchive(savedOwner,row.id);if(current.current!==savedOwner)return;restore(t);setMessage('已恢复到模板库，原有模板保留。');}
  catch(e){if(current.current===savedOwner)setError(e instanceof Error?e.message:'恢复失败');}
  finally{if(current.current===savedOwner)setBusy('');}
 };
 return <section className="border-t border-border px-2 py-2 text-[11px]" data-testid="template-system-archive">
  <button type="button" aria-expanded={open} onClick={()=>setOpen(!open)} className="font-medium text-primary">系统存档{open?' ▴':' ▾'}</button>
  {open&&<div className="mt-2 space-y-2"><p className="text-muted-foreground">模板新增、改名或恢复后由系统自动固化版本；日常删除模板、清理缓存或重置交易数据不会清除此处。旧算法版本也会原样保留。</p>
   {loading?<p role="status">读取系统存档…</p>:!error&&!rows.length?<p>还没有系统存档；模板同步成功后会自动建立。</p>:null}
   {error&&<p role="alert" className="text-destructive">{error} <button type="button" onClick={()=>setRevision(v=>v+1)}>重试</button></p>}
   {message&&<p role="status" className="text-primary">{message}</p>}
   <ul className="max-h-72 space-y-2 overflow-y-auto">{rows.map(r=><li key={r.id} className="flex items-center gap-2 rounded bg-muted/40 p-2"><div className="min-w-0 flex-1"><p className="truncate">{r.template_name}</p><p className="text-[10px] text-muted-foreground">固化于 {new Date(r.created_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</p></div><button type="button" disabled={!!busy} className="shrink-0 rounded border border-primary/25 px-2 py-1 text-primary disabled:opacity-50" aria-label={`恢复系统存档 ${r.template_name}`} onClick={()=>void recover(r)}>{busy===r.id?'恢复中…':'恢复到模板库'}</button></li>)}</ul>
  </div>}
 </section>;
}
