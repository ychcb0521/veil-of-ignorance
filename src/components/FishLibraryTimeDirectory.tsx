import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ChevronDown,Database,Download,MoreHorizontal,Copy,Trash2,Undo2} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger} from './ui/dialog';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from './ui/dropdown-menu';
import {FishQualityInfo} from './FishQualityModule';
import {formatUTC8} from '@/lib/timeFormat';
import type {FishQualityStudy} from '@/lib/fish/quality';

export interface FishDirectoryItem {
  id:string; at:number; label:string; summary:string; note?:string; sourceRoundId?:string;
  revision?:unknown;
  details?:ReactNode|((close:()=>void)=>ReactNode);
  study:()=>FishQualityStudy|Promise<FishQualityStudy>;
}
export interface FishDirectoryRequest {key:number;selectedId?:string}
export const libraryDirectoryAction='inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40';
export function FishLibraryTimeDirectory({name,prefix,description,info,dataActions,items,edits,recordCount,download,renderStudy,onCopyStudy,onSetHidden,empty,kind='time',onOpenChange,openRequest,onSelectDirectory}:{
  name:string;prefix:string;description:string;info:ReactNode;dataActions?:ReactNode;items:FishDirectoryItem[];
  edits?:Record<string,{hidden:boolean;at:number}>;recordCount:number;download:()=>void;
  renderStudy?:(study:FishQualityStudy)=>ReactNode;
  onCopyStudy?:(study:FishQualityStudy,sourceRoundId?:string)=>Promise<boolean>;
  onSetHidden?:(id:string,hidden:boolean)=>Promise<boolean>;empty:string;kind?:'time'|'algorithm';onOpenChange?:(open:boolean)=>void;
  openRequest?:FishDirectoryRequest;onSelectDirectory?:(id:string,study:FishQualityStudy)=>Promise<boolean>;
}){
  const [open,setOpen]=useState(false),[selectedId,setSelectedId]=useState(''),[showDeleted,setShowDeleted]=useState(false),[deleteId,setDeleteId]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState('');
  const [loaded,setLoaded]=useState<{id:string;study?:FishQualityStudy;error?:string}>();
  const selected=items.find(item=>item.id===selectedId),itemRef=useRef(selected);itemRef.current=selected;
  const openCallback=useRef(onOpenChange);openCallback.current=onOpenChange;const requestRef=useRef(openRequest);requestRef.current=openRequest;
  useEffect(()=>{const request=requestRef.current;if(request){setOpen(true);setSelectedId(request.selectedId??'');openCallback.current?.(true);}},[openRequest?.key]);
  useEffect(()=>{
    if(!open||!selectedId)return;
    const item=itemRef.current;if(!item)return;
    let active=true;setLoaded({id:item.id});
    try{
      const result=item.study();
      if(result instanceof Promise)void result.then(study=>{if(active)setLoaded({id:item.id,study});},e=>{if(active)setLoaded({id:item.id,error:e instanceof Error?e.message:'归档读取失败，请重试'});});
      else setLoaded({id:item.id,study:result});
    }catch(e){setLoaded({id:item.id,error:e instanceof Error?e.message:'归档读取失败，请重试'});}
    return()=>{active=false;};
  },[open,selectedId,selected?.revision]);
  const snapshot=loaded?.id===selectedId?loaded.study:undefined;
  const visible=[...items].filter(item=>showDeleted||!edits?.[item.id]?.hidden).sort((a,b)=>kind==='algorithm'?a.label.localeCompare(b.label):b.at-a.at||b.id.localeCompare(a.id));
  const deleted=items.filter(item=>edits?.[item.id]?.hidden).length,action=libraryDirectoryAction,noun=name.slice(0,-1)+'归档';
  const hide=async(id:string,hidden:boolean)=>{
    if(!onSetHidden||busy)return;setBusy(id);setError('');
    try{if(!await onSetHidden(id,hidden))throw Error('目录修改未保存，请重试');setDeleteId('');if(hidden)setSelectedId('');}
    catch(e){setError(e instanceof Error?e.message:'目录修改失败');}finally{setBusy('');}
  };
  const copy=async()=>{
    if(!snapshot||!onCopyStudy||busy)return;setBusy(selectedId);setError('');
    try{if(!await onCopyStudy(snapshot,selected?.sourceRoundId))throw Error('副本未载入，当前总表仍保留，请重试');setOpen(false);onOpenChange?.(false);}
    catch(e){setError(e instanceof Error?e.message:'复制失败');}finally{setBusy('');}
  };
  const changeOpen=(value:boolean)=>{setOpen(value);onOpenChange?.(value);};
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><button type="button" className={action} aria-label={'打开'+name}><Database aria-hidden className="h-3 w-3"/>{name}</button></DialogTrigger>
    <DialogContent className="flex max-h-[85dvh] w-[calc(100vw-1.5rem)] max-w-[96vw] sm:max-w-[96vw] flex-col gap-3 overflow-y-auto overscroll-contain p-4 sm:p-5">
      <DialogHeader className="shrink-0 space-y-1 text-left">
        <div className="flex flex-wrap items-center gap-1.5 pr-6"><DialogTitle className="text-sm">{name}</DialogTitle>{dataActions}<FishQualityInfo label={name+'说明'}>{info}</FishQualityInfo><button type="button" className={action+' ml-auto'} aria-label={'导出'+name+'数据'} title={'导出'+name+'中已保存的记录'} disabled={!recordCount} onClick={()=>{try{download();setError('');}catch(e){setError(e instanceof Error?e.message:'导出失败');}}}><Download aria-hidden className="h-3 w-3"/>导出数据 <span className="font-mono tabular-nums">{recordCount}</span></button></div>
        <DialogDescription className="text-[11px]">{description}</DialogDescription>
      </DialogHeader>
      <h3 className="shrink-0 rounded-lg bg-muted/50 px-3 py-2 text-[11px] font-medium">{kind==='algorithm'?'算法目录':'时间目录'}</h3>
      <div className="space-y-3" data-testid={prefix+'-archive-directory'}>
        {!!deleted&&<label className="inline-flex items-center gap-2 text-[10px] text-muted-foreground"><input type="checkbox" checked={showDeleted} onChange={e=>setShowDeleted(e.target.checked)}/>显示已删除目录（{deleted}）</label>}
        {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
        {!visible.length&&<p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">{empty}</p>}
        {visible.map(item=><div key={item.id} className={'group/archive rounded-lg border border-border/60 '+(edits?.[item.id]?.hidden?'opacity-60':'')} data-testid={prefix+'-archive-item'}>
          <div className="flex items-center"><button type="button" className="flex min-w-0 flex-1 flex-wrap items-center gap-3 p-3 text-left text-[11px] hover:bg-muted/40" aria-label={'打开'+noun+' '+item.id} aria-expanded={selectedId===item.id} onClick={()=>setSelectedId(selectedId===item.id?'':item.id)}><ChevronDown className={'h-3 w-3 '+(selectedId===item.id?'rotate-180':'')}/>{kind==='time'&&<span className="font-mono">{formatUTC8(item.at)}</span>}<span className="font-medium">{item.label}</span><span className="text-muted-foreground">{item.summary}</span></button>
            {onSetHidden&&<DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label={'管理'+noun+' '+item.id} disabled={!!busy} className="mr-2 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover/archive:opacity-100 group-focus-within/archive:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"><MoreHorizontal className="h-3.5 w-3.5"/></button></DropdownMenuTrigger><DropdownMenuContent align="end">{edits?.[item.id]?.hidden?<DropdownMenuItem onSelect={()=>void hide(item.id,false)}><Undo2 className="mr-2 h-3 w-3"/>恢复目录</DropdownMenuItem>:<DropdownMenuItem className="text-destructive" onSelect={()=>setDeleteId(item.id)}><Trash2 className="mr-2 h-3 w-3"/>删除目录</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>}
          </div>
          {deleteId===item.id&&<div role="alert" className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-[11px]"><span>删除这项目录？可在已删除目录中恢复。</span><button type="button" disabled={!!busy} className={action+' text-destructive'} onClick={()=>void hide(item.id,true)}>确认删除目录</button><button type="button" className={action} onClick={()=>setDeleteId('')}>取消</button></div>}
          {selectedId===item.id&&!snapshot&&<p role={loaded?.error?'alert':'status'} className={'border-t px-4 py-3 text-[10.5px] '+(loaded?.error?'text-destructive':'text-muted-foreground')}>{loaded?.error??'正在读取归档…'}</p>}
          {selectedId===item.id&&snapshot&&<div className="border-t" data-testid={prefix+'-archive-content'}>
            {onSelectDirectory&&<div className="px-4 pt-3"><button type="button" className={action+' text-primary'} disabled={!!busy} onClick={async()=>{setBusy(item.id);setError('');try{if(!await onSelectDirectory(item.id,snapshot))throw Error('目录未载入，当前组合表保留，请重试');changeOpen(false);}catch(e){setError(e instanceof Error?e.message:'目录选择失败');}finally{setBusy('');}}}>{busy===item.id?'正在载入…':'选择此目录'}</button></div>}
            {onCopyStudy&&<div className="flex items-center gap-1 px-4 pt-3"><button type="button" disabled={!!busy} onClick={()=>void copy()} className={action+' text-primary'}><Copy className="h-3 w-3"/>{busy===item.id?'正在保存副本…':'复制至组合表'}</button><FishQualityInfo label="复制至组合表说明"><p>先将当前组合表完整归档，再载入这份记录的独立副本。原归档保留，不自动运行。</p></FishQualityInfo></div>}
            {item.note&&<p className="px-4 pt-3 text-[10px] text-muted-foreground">{item.note}</p>}
            <div key={selectedId}>{renderStudy?.(snapshot)??<p className="px-4 py-3 text-xs text-muted-foreground">{snapshot.results.length} 项运行结果 · 可复制至组合表继续操作</p>}</div>
            {typeof item.details==='function'?item.details(()=>changeOpen(false)):item.details}
          </div>}
        </div>)}
      </div>
    </DialogContent>
  </Dialog>;
}
