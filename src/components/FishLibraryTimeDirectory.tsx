import {FishLibraryTransferMenu} from './FishLibraryDataMenu';
import {FishLibraryRowExportContext,type FishLibraryRowExport,type FishLibraryExportActions} from './FishLibraryRowExport';
import {createQualityTemplateTable,type QualityTemplateTable} from '@/lib/fish/qualityTemplateTable';
import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {ChevronDown,Database,Download,MoreHorizontal,Search,Copy,Trash2,Undo2,Pencil} from 'lucide-react';
import {FishDirectorySettingsButton,type DirectorySettingsEntry} from './FishDirectorySettingsButton';
import {unknownTemplateGroup,type QualityTemplateDirectoryGroup} from '@/lib/fish/qualityTemplateDirectory';
import {DIRECTORY_NAME_MAX_LENGTH,type LibraryDirectoryEdits} from '@/lib/fish/libraryDirectoryEdits';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger} from './ui/dialog';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from './ui/dropdown-menu';
import {FishQualityInfo,qualityRowItem} from './FishQualityModule';
import {formatUTC8} from '@/lib/timeFormat';
import type {FishQualityStudy,QualityResult} from '@/lib/fish/quality';
import {combineDirectoryStudies} from '@/lib/fish/qualityDirectorySelection';

export interface FishDirectoryItem {
  id:string; at:number; label:string; summary:string; note?:string; sourceRoundId?:string;
  revision?:unknown;
  templateGroup?:QualityTemplateDirectoryGroup;
  settings?:()=>ReactNode|Promise<ReactNode>;
  purgeable?: boolean;
  preview?:()=>FishQualityStudy|Promise<FishQualityStudy>;
  campaignPath?:(result:QualityResult)=>string|undefined;
  details?:ReactNode|((close:()=>void)=>ReactNode);
  study:()=>FishQualityStudy|Promise<FishQualityStudy>;
}
const NO_DIRECTORY_ITEMS: FishDirectoryItem[] = [];
const normalizeTemplateQuery=(value:string)=>value.normalize('NFKC').toLocaleLowerCase().replace(/[\s_·.-]/g,'');

export function FishDeferredDetails({summary,className,children}:{summary:string;className?:string;children:ReactNode|(()=>ReactNode)}) {
  const [open,setOpen] = useState(false);
  return <details className={className} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-muted-foreground">{summary}</summary>
    {open && (typeof children === 'function' ? children() : children)}
  </details>;
}

export type FishTemplateRenderer=(table:QualityTemplateTable,close:()=>void,importSelection:boolean)=>ReactNode;
function FishTemplateDirectoryTable({members,renderTemplate,close,importSelection}:{importSelection:boolean;members:FishDirectoryItem[];renderTemplate:FishTemplateRenderer;close:()=>void}) {
  const [attempt,setAttempt]=useState(0);
  const [result,setResult]=useState<{table:QualityTemplateTable;errors:number}>();
  const [progress,setProgress]=useState(0);
  const currentMembers=useRef(members);currentMembers.current=members;
  const version=useMemo(()=>JSON.stringify(members.map(member=>member.id)),[members]);
  const latest=useRef(members);
  useEffect(()=>{
    let active=true;
    const entries=currentMembers.current;
    setResult(undefined);setProgress(0);
    void (async()=>{
      const table=createQualityTemplateTable(importSelection);
      let errors=0,done=0;
      for(const member of entries){
        if(!active)return;
        try{
          const input=await (member.preview??member.study)();
          if(!active)return;
          table.append(input,member.campaignPath);
        }catch{errors++;}
        done++;
        // Give the browser a chance to handle input and paint before the next batch.
        if(done%8===0){
          if(active)setProgress(done);
          await new Promise<void>(resolve=>setTimeout(resolve,0));
        }
      }
      if(active)setResult({table:table.finish(),errors});
    })();
    return()=>{active=false;};
  },[version,attempt,importSelection]);
  useEffect(()=>{
    const previous=latest.current;latest.current=members;
    if(previous.length===members.length&&previous.every((item,i)=>item.id===members[i].id)&&previous.some((item,i)=>item.revision!==members[i].revision))setAttempt(n=>n+1);
  },[members]);
  if(!result)return <p role="status" className="px-4 py-3 text-xs text-muted-foreground">正在读取模板记录… {progress}/{members.length}</p>;
  return <>
    {!!result.errors&&<p role="alert" className="px-4 py-3 text-xs text-destructive">{result.errors} 项未能读取，已读取的记录如下。 <button type="button" className="underline" onClick={()=>setAttempt(n=>n+1)}>重试读取</button></p>}
    {result.table.rows.length?renderTemplate(result.table,close,importSelection):<p className="px-4 py-3 text-xs text-muted-foreground">没有可显示的记录。</p>}
  </>;
}

export interface FishDirectoryRequest {key:number;selectedId?:string;selectedIds?:string[];importSelection?:boolean}
export interface FishDirectoryPicker {
  triggerLabel: string;
  footer: (close: () => void) => ReactNode;
}
export const libraryDirectoryAction=`${qualityRowItem} rounded-md transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40`;
export function FishLibraryTimeDirectory({name,prefix,description,info,dataActions,transferMenu,items:itemsSource,edits,recordCount,download,renderStudy,renderTemplate,onCopyStudy,onSetHidden,onDeleteRecords,onPurgeDirectory,onRename,empty,kind='time',onOpenChange,openRequest,onSelectDirectory,loading=false,loadError,onRetry,picker}:{
  loading?:boolean;loadError?:string;onRetry?:()=>void;name:string;prefix:string;description:string|((items:FishDirectoryItem[])=>string);info:ReactNode;dataActions?:ReactNode;transferMenu?:(actions:FishLibraryExportActions)=>ReactNode;items:FishDirectoryItem[]|(()=>FishDirectoryItem[]);
  edits?:LibraryDirectoryEdits;recordCount:number;download:()=>unknown|Promise<unknown>;
  picker?:FishDirectoryPicker;
  onRename?:(id:string,name:string)=>Promise<boolean>;
  onDeleteRecords?:(id:string)=>void;
  onPurgeDirectory?:(ids:readonly string[])=>Promise<{removed:readonly string[];retained:readonly string[]}>;
  renderTemplate?:FishTemplateRenderer;
  renderStudy?:(study:FishQualityStudy, close?: () => void)=>ReactNode;
  onCopyStudy?:(study:FishQualityStudy,sourceRoundId?:string)=>Promise<boolean>;
  onSetHidden?:(id:string,hidden:boolean)=>Promise<boolean>;empty:string;kind?:'time'|'algorithm'|'template';onOpenChange?:(open:boolean)=>void;
  openRequest?:FishDirectoryRequest;onSelectDirectory?:(id:string,study:FishQualityStudy,ids?:string[])=>Promise<boolean>;
}){
  const [open,setOpen]=useState(false),[selectedId,setSelectedId]=useState(''),[showDeleted,setShowDeleted]=useState(false),[deleteId,setDeleteId]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState('');
  const [loaded,setLoaded]=useState<{id:string;study?:FishQualityStudy;error?:string}>();
  const [loadAttempt,setLoadAttempt]=useState(0);
  const [checkedIds,setCheckedIds]=useState<string[]>([]);
  const [purgeMode,setPurgeMode]=useState(false),[confirmPurge,setConfirmPurge]=useState(false),[purgeMessage,setPurgeMessage]=useState('');
  const [manage,setManage]=useState(false),[activeTemplate,setActiveTemplate]=useState('');
  const [importSelection,setImportSelection]=useState(false);
  const [templateQuery,setTemplateQuery]=useState('');
  const templateView=kind==='template'&&!!renderTemplate&&!picker&&!manage&&!purgeMode&&!showDeleted;
  const [selectedExport,setSelectedExport]=useState<FishLibraryRowExport>();
  const registerExport=useCallback((action:FishLibraryRowExport)=>{
    setSelectedExport(action);
    return ()=>setSelectedExport(current=>current===action?undefined:current);
  },[]);
  const compactDirectory=kind==='template'&&!picker;
  const managedExports=compactDirectory;
  const [expandedGroups,setExpandedGroups]=useState<Record<string,boolean>>({});
  const [editingId,setEditingId]=useState(''),[draftName,setDraftName]=useState('');
  const selectionEpoch=useRef(0);
  useEffect(()=>()=>{selectionEpoch.current++;},[]);
  const items = useMemo(() => open ? (typeof itemsSource === 'function' ? itemsSource() : itemsSource) : NO_DIRECTORY_ITEMS, [open,itemsSource]);
  const selected=items.find(item=>item.id===selectedId),itemRef=useRef(selected);itemRef.current=selected;
  const openCallback=useRef(onOpenChange);openCallback.current=onOpenChange;const requestRef=useRef(openRequest);requestRef.current=openRequest;
  useEffect(()=>{const request=requestRef.current;if(request){selectionEpoch.current++;setOpen(true);setImportSelection(!!request.importSelection);if(request.selectedId||request.selectedIds!==undefined)setManage(true);setSelectedId(request.selectedId??'');setCheckedIds(request.selectedIds??(request.selectedId?[request.selectedId]:[]));openCallback.current?.(true);}},[openRequest?.key]);
  useEffect(()=>{
    if(!open){setLoaded(undefined);return;}if(!selectedId)return;
    const item=itemRef.current;if(!item)return;
    let active=true;setLoaded({id:item.id});
    try{
      const result=item.study();
      if(result instanceof Promise)void result.then(study=>{if(active)setLoaded({id:item.id,study});},e=>{if(active)setLoaded({id:item.id,error:e instanceof Error?e.message:'归档读取失败，请重试'});});
      else setLoaded({id:item.id,study:result});
    }catch(e){setLoaded({id:item.id,error:e instanceof Error?e.message:'归档读取失败，请重试'});}
    return()=>{active=false;};
  },[open,selectedId,selected?.id,selected?.revision,loadAttempt]);
  const currentLoad=loaded?.id===selectedId?loaded:undefined;
  const snapshot=currentLoad?.study;
  const archiveError=currentLoad?.error;
  const visible=useMemo(()=>items.filter(item=>{
    const hidden=!!edits?.[item.id]?.hidden;
    const group=item.templateGroup;
    if(templateView&&!group?.savedTemplate)return false;
    return compactDirectory ? hidden===showDeleted : showDeleted||!hidden;
  }).sort((a,b)=>kind==='algorithm'?a.label.localeCompare(b.label):b.at-a.at||b.id.localeCompare(a.id)),[items,showDeleted,edits,kind,compactDirectory,templateView]);
  const deleted=items.filter(item=>edits?.[item.id]?.hidden).length,action=libraryDirectoryAction,noun=name.slice(0,-1)+'归档';
  const selectable=visible.filter(item=>purgeMode ? item.purgeable : !edits?.[item.id]?.hidden);
  const checkedSet=new Set(checkedIds),checked=selectable.filter(item=>checkedSet.has(item.id));
  const query=normalizeTemplateQuery(templateQuery);
  const grouping = useMemo(() => {
    if (kind !== 'template') return [];
    const groups = new Map<string,{group:QualityTemplateDirectoryGroup;items:FishDirectoryItem[]}>();
    for (const item of visible) {
      const group = item.templateGroup ?? unknownTemplateGroup;
      if(templateView&&query&&![group.title,group.originalTitle].some(value=>value&&normalizeTemplateQuery(value).includes(query)))continue;
      const bucket = groups.get(group.id);
      if (bucket) bucket.items.push(item);
      else groups.set(group.id,{group,items:[item]});
    }
    return [...groups.values()];
  },[kind,visible,templateView,query]);
  const purge = async () => {
    if (!onPurgeDirectory || busy || !checked.length) return;
    setBusy('purge'); setError(''); setPurgeMessage('');
    try {
      const answer=await onPurgeDirectory(checked.map(item=>item.id));
      if (answer.removed.includes(selectedId)) setSelectedId('');
      setCheckedIds(ids=>ids.filter(id=>!answer.removed.includes(id)));
      setConfirmPurge(false);
      setPurgeMessage('已永久删除 '+answer.removed.length+' 项'+(answer.retained.length?'，保护或无法核验的 '+answer.retained.length+' 项已保留。':'。'));
    } catch (error) {
      setError(error instanceof Error ? error.message : '永久删除未完成，请重试');
    } finally { setBusy(''); }
  };
  const applySelection=async()=>{
    if(!onSelectDirectory||!checked.length||busy||loading||loadError)return;const epoch=selectionEpoch.current;setBusy('selection');setError('');
    try{
      const snapshots=await Promise.all(checked.map(item=>item.study())),ids=checked.map(item=>item.id);
      if(epoch!==selectionEpoch.current)return;
      if(!await onSelectDirectory(ids[0],combineDirectoryStudies(snapshots),ids))throw Error('目录未载入，当前组合表保留，请重试');
      changeOpen(false);
    }catch(e){if(epoch===selectionEpoch.current)setError(e instanceof Error?e.message:'目录选择失败');}finally{setBusy('');}
  };
  const hide=async(id:string,hidden:boolean)=>{
    if(!onSetHidden||busy)return;setBusy(id);setError('');
    try{if(!await onSetHidden(id,hidden))throw Error('目录修改未保存，请重试');setDeleteId('');if(hidden)setSelectedId('');}
    catch(e){setError(e instanceof Error?e.message:'目录修改失败');}finally{setBusy('');}
  };
  const rename=async()=>{
    if(!editingId||!onRename||busy)return;setBusy(editingId);setError('');
    try{if(!await onRename(editingId,draftName.trim()))throw Error('目录名称未保存，请重试');setEditingId('');}
    catch(e){setError(e instanceof Error?e.message:'目录名称未保存，请重试');}finally{setBusy('');}
  };
  const copy=async()=>{
    if(!snapshot||!onCopyStudy||busy||loading||loadError)return;setBusy(selectedId);setError('');
    try{if(!await onCopyStudy(snapshot,selected?.sourceRoundId))throw Error('副本未载入，当前总表仍保留，请重试');changeOpen(false);}
    catch(e){setError(e instanceof Error?e.message:'复制失败');}finally{setBusy('');}
  };
  const changeOpen=(value:boolean)=>{
    if(!value&&busy==='purge')return;
    selectionEpoch.current++;setOpen(value);onOpenChange?.(value);
    if(!value){setTemplateQuery('');setImportSelection(false);setShowDeleted(false);setActiveTemplate('');setManage(false);setSelectedId('');setCheckedIds([]);setPurgeMode(false);setConfirmPurge(false);setPurgeMessage('');}
  };
  const canExport=!!recordCount&&!busy&&!loading&&!loadError&&!selectedExport?.busy;
  const handleExport=()=>{
    if (!canExport) return;
    const epoch = selectionEpoch.current;
    setBusy('export');
    setError('');
    void (async () => {
      try { await download(); }
      catch (e) { if (epoch === selectionEpoch.current) setError(e instanceof Error ? e.message : '导出失败，请重试'); }
      finally { setBusy(''); }
    })();
  };
  const resetDirectorySelection = () => {
    setSelectedId('');setCheckedIds([]);setActiveTemplate('');setConfirmPurge(false);setError('');setPurgeMessage('');
  };
  const directoryActions = compactDirectory && (onPurgeDirectory || deleted>0) ? <>
    {onPurgeDirectory&&<DropdownMenuItem className="text-xs" disabled={!!busy||loading||!!loadError} onSelect={()=>{
      setPurgeMode(!purgeMode);resetDirectorySelection();
    }}><Trash2 aria-hidden className="mr-2 h-3.5 w-3.5"/>{purgeMode?'退出批量删除':'批量删除'}</DropdownMenuItem>}
    {deleted>0&&<DropdownMenuItem className="text-xs" disabled={!!busy||loading} onSelect={()=>{
      setShowDeleted(!showDeleted);setManage(false);setPurgeMode(false);resetDirectorySelection();
    }}><Undo2 aria-hidden className="mr-2 h-3.5 w-3.5"/>{showDeleted?'返回模板汇总':`已删除目录（${deleted}）`}</DropdownMenuItem>}
  </> : undefined;
  const exportActions={exportLibrary:handleExport,canExportLibrary:canExport,selected:selectedExport,busy:!!busy,directoryActions};
  const settingsEntry = (item: FishDirectoryItem): DirectorySettingsEntry[] => item.settings ? [{
    id:item.id, name:formatUTC8(item.at)+' '+(edits?.[item.id]?.name||item.label), load:item.settings,
  }] : [];
  const renderItem = (item: FishDirectoryItem) => <div key={item.id} className={'group/archive rounded-lg border border-border/60 '+(edits?.[item.id]?.hidden?'opacity-60':'')} data-testid={prefix+'-archive-item'}>
          <div className="flex items-center">{(onSelectDirectory||purgeMode)&&<input type="checkbox" className="ml-3 h-3.5 w-3.5 shrink-0 accent-[hsl(var(--primary))]" aria-label={'选择'+name+'目录 '+(edits?.[item.id]?.name||item.label)+' '+item.id} disabled={loading||!!loadError||!!busy||confirmPurge||(purgeMode ? !item.purgeable : !!edits?.[item.id]?.hidden)} checked={checkedSet.has(item.id)} onChange={e=>setCheckedIds(ids=>e.target.checked?[...new Set([...ids,item.id])]:ids.filter(id=>id!==item.id))}/>}<button type="button" className="flex min-w-0 flex-1 flex-wrap items-center gap-3 p-3 text-left text-[11px] hover:bg-muted/40" aria-label={'打开'+noun+' '+item.id} aria-expanded={selectedId===item.id} onClick={()=>setSelectedId(selectedId===item.id?'':item.id)}><ChevronDown className={'h-3 w-3 '+(selectedId===item.id?'rotate-180':'')}/>{kind!=='algorithm'&&<span className="font-mono">{formatUTC8(item.at)}</span>}<span className="font-medium">{edits?.[item.id]?.name||item.label}</span><span className="text-muted-foreground">{item.summary}</span></button>
            {item.settings&&<FishDirectorySettingsButton name={settingsEntry(item)[0].name} entries={settingsEntry(item)} disabled={!!busy}/>}
            {(onSetHidden||onRename||onDeleteRecords)&&<DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label={'管理'+noun+' '+item.id} disabled={loading||!!loadError||!!busy} className="mr-2 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover/archive:opacity-100 group-focus-within/archive:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"><MoreHorizontal className="h-3.5 w-3.5"/></button></DropdownMenuTrigger><DropdownMenuContent align="end">{onRename&&<DropdownMenuItem onSelect={()=>{setEditingId(item.id);setDraftName(edits?.[item.id]?.name??'');setDeleteId('');setError('');}}><Pencil className="mr-2 h-3 w-3"/>编辑名称</DropdownMenuItem>}{onDeleteRecords&&<DropdownMenuItem className="text-destructive" onSelect={()=>onDeleteRecords(item.id)}><Trash2 className="mr-2 h-3 w-3"/>删除目录记录</DropdownMenuItem>}{onSetHidden&&(edits?.[item.id]?.hidden?<DropdownMenuItem onSelect={()=>void hide(item.id,false)}><Undo2 className="mr-2 h-3 w-3"/>恢复目录</DropdownMenuItem>:<DropdownMenuItem className="text-destructive" onSelect={()=>setDeleteId(item.id)}><Trash2 className="mr-2 h-3 w-3"/>删除目录</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}
          </div>
          {editingId===item.id&&<form className="flex flex-wrap items-center gap-2 border-t px-3 py-3 text-[11px]" onSubmit={e=>{e.preventDefault();void rename();}}>
            <label className="flex min-w-0 flex-1 items-center gap-2">目录名称<input autoFocus aria-label="目录名称" className="h-8 min-w-40 flex-1 rounded-md border bg-background px-2 text-xs" value={draftName} maxLength={DIRECTORY_NAME_MAX_LENGTH} placeholder={item.label} disabled={loading||!!loadError||!!busy} onChange={e=>setDraftName(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.stopPropagation();setEditingId('');}}}/></label>
            <button type="submit" className={action+' text-primary'} disabled={loading||!!loadError||!!busy}>{busy===item.id?'正在保存…':'保存名称'}</button><button type="button" className={action} disabled={loading||!!loadError||!!busy} onClick={()=>setEditingId('')}>取消编辑</button>
            <p className="w-full text-muted-foreground">留空保存可恢复默认名称；原保存时间和目录内容保留。</p>
          </form>}
          {deleteId===item.id&&<div role="alert" className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-[11px]"><span>删除这项目录？可在已删除目录中恢复。</span><button type="button" disabled={loading||!!loadError||!!busy} className={action+' text-destructive'} onClick={()=>void hide(item.id,true)}>确认删除目录</button><button type="button" className={action} onClick={()=>setDeleteId('')}>取消</button></div>}
          {selectedId===item.id&&!snapshot&&<p role={archiveError?'alert':'status'} className={'border-t px-4 py-3 text-[10.5px] '+(archiveError?'text-destructive':'text-muted-foreground')}>{archiveError??'正在读取归档…'}{archiveError&&<button type="button" className="ml-2 underline" onClick={()=>setLoadAttempt(attempt=>attempt+1)}>重试读取归档</button>}</p>}
          {selectedId===item.id&&snapshot&&<div className="border-t" data-testid={prefix+'-archive-content'}>
            {onSelectDirectory&&<div className="px-4 pt-3"><button type="button" className={action+' text-primary'} disabled={loading||!!loadError||!!busy} onClick={async()=>{setBusy(item.id);setError('');try{if(!await onSelectDirectory(item.id,snapshot))throw Error('目录未载入，当前组合表保留，请重试');changeOpen(false);}catch(e){setError(e instanceof Error?e.message:'目录选择失败');}finally{setBusy('');}}}>{busy===item.id?'正在载入…':'选择此目录'}</button></div>}
            {onCopyStudy&&<div className="flex items-center gap-1 px-4 pt-3"><button type="button" disabled={loading||!!loadError||!!busy} onClick={()=>void copy()} className={action+' text-primary'}><Copy className="h-3 w-3"/>{busy===item.id?'正在保存副本…':'复制至组合表'}</button><FishQualityInfo label="复制至组合表说明"><p>先将当前组合表完整归档，再载入这份记录的独立副本。原归档保留，不自动运行。</p></FishQualityInfo></div>}
            {item.note&&<p className="px-4 pt-3 text-[10px] text-muted-foreground">{item.note}</p>}
            <div key={selectedId}>{renderStudy?.(snapshot,()=>changeOpen(false))??<p className="px-4 py-3 text-xs text-muted-foreground">{snapshot.results.length} 项运行结果 · 可复制至组合表继续操作</p>}</div>
            {typeof item.details==='function'?item.details(()=>changeOpen(false)):item.details}
          </div>}
        </div>;
  return <FishLibraryRowExportContext.Provider value={managedExports?registerExport:null}><Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><button type="button" className={action} aria-label={picker?.triggerLabel ?? '打开'+name}><Database aria-hidden className="h-3 w-3"/>{picker?.triggerLabel ?? name}</button></DialogTrigger>
    <DialogContent className="flex max-h-[85dvh] w-[calc(100vw-1.5rem)] max-w-[96vw] sm:max-w-[96vw] flex-col gap-3 overflow-hidden p-4 sm:p-5">
      <DialogHeader className="shrink-0 space-y-1 text-left">
        <div className="group/library-header flex flex-wrap items-center gap-1.5 pr-6">
          <DialogTitle className="text-sm">{name}</DialogTitle>{dataActions}<FishQualityInfo label={name+'说明'}>{info}</FishQualityInfo>
          {transferMenu || compactDirectory ? <div className="ml-auto">{transferMenu ? transferMenu(exportActions) : <FishLibraryTransferMenu name={name} actions={exportActions}/>}</div> :
            <button type="button" className={action+' ml-auto'} aria-label={'导出'+name+'数据'} title={'导出'+name+'中已保存的记录'} disabled={!canExport} onClick={handleExport}><Download aria-hidden className="h-3 w-3"/>{busy==='export'?'正在导出…':'导出数据'} <span className="font-mono tabular-nums">{recordCount}</span></button>}
        </div>
        {(managedExports&&(busy==='export'||selectedExport?.busy))&&<p role="status" className="text-xs text-muted-foreground">正在导出…</p>}
        {templateView&&<div className="relative mt-1 max-w-md">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"/>
          <input type="search" value={templateQuery} onChange={event=>setTemplateQuery(event.target.value)} aria-label={'搜索'+name+'模板'}
            placeholder="搜索模板编号、原名或日期…" className="h-8 w-full rounded-md border border-border/60 bg-background pl-8 pr-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"/>
        </div>}
        <DialogDescription className={compactDirectory?"sr-only":"text-[11px]"}>{typeof description==='function' ? open ? description(items) : '' : description}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain" data-testid={prefix+'-directory-scroll'}>
      <h3 className={compactDirectory?"sr-only":"shrink-0 rounded-lg bg-muted/50 px-3 py-2 text-[11px] font-medium"}>{kind==='algorithm'?'算法目录':kind==='template'?'模板目录':'时间目录'}</h3>
      <div className="space-y-3" data-testid={prefix+'-archive-directory'}>
        {showDeleted&&compactDirectory&&<div className="flex items-center justify-between gap-2 text-xs"><span>已删除目录（{deleted}）</span><button type="button" className={action} disabled={!!busy} onClick={()=>{setShowDeleted(false);setPurgeMode(false);resetDirectorySelection();}}>返回模板汇总</button></div>}
        {onPurgeDirectory&&!picker&&purgeMode&&<div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" aria-label="全选可删除目录"
              ref={element=>{if(element)element.indeterminate=checked.length>0&&checked.length<selectable.length;}}
              checked={!!selectable.length&&checked.length===selectable.length}
              disabled={!selectable.length||!!busy||confirmPurge}
              onChange={event=>setCheckedIds(event.target.checked?selectable.map(item=>item.id):[])}/>全选可删除目录</label>
            <button type="button" className={action+' text-destructive'} disabled={!checked.length||!!busy||confirmPurge}
              onClick={()=>setConfirmPurge(true)}>永久删除所选（{checked.length}）</button>
        </div>}
        {confirmPurge&&<div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 p-2 text-xs">
          <span>永久删除所选 {checked.length} 项？此操作不可恢复。交易战役及其依赖的数据会保留。</span>
          <button type="button" className={action+' text-destructive'} disabled={!!busy} onClick={()=>void purge()}>{busy==='purge'?'正在核验并删除…':'确认永久删除'}</button>
          <button type="button" className={action} disabled={!!busy} onClick={()=>setConfirmPurge(false)}>取消</button>
        </div>}
        {purgeMessage&&<p role="status" className="text-xs text-muted-foreground">{purgeMessage}</p>}
        {onSelectDirectory&&!templateView&&!purgeMode&&<div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 text-[11px]">
          <label className="inline-flex items-center gap-2"><input type="checkbox" aria-label={'全选'+name+'可见目录'} ref={el=>{if(el)el.indeterminate=checked.length>0&&checked.length<selectable.length;}} disabled={loading||!!loadError||!!busy||!selectable.length} checked={!!selectable.length&&checked.length===selectable.length} onChange={e=>setCheckedIds(e.target.checked?selectable.map(item=>item.id):[])}/>全选可见目录</label>
          <button type="button" className={action} disabled={loading||!!loadError||!!busy||!checkedIds.length} onClick={()=>setCheckedIds([])}>清空选择</button>
          <span className="text-muted-foreground">可选一个或多个目录</span>
          <button type="button" className={action+' ml-auto text-primary'} disabled={loading||!!loadError||!!busy||!checked.length} onClick={()=>void applySelection()}>{busy==='selection'?'正在载入…':`应用所选目录（${checked.length}）`}</button>
        </div>}
        {!picker&&!compactDirectory&&!!deleted&&<label className="inline-flex items-center gap-2 text-[10px] text-muted-foreground"><input type="checkbox" checked={showDeleted} onChange={e=>setShowDeleted(e.target.checked)}/>显示已删除目录（{deleted}）</label>}
        {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
        {loading&&<p role="status" className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">正在读取{name}，已有数据仍保留…</p>}{loadError&&<p role="alert" className="rounded-lg border border-destructive/30 p-4 text-xs text-destructive">{loadError}{onRetry&&<button type="button" className="ml-2 underline" onClick={onRetry}>重试读取</button>}</p>}{!loading&&!loadError&&!visible.length&&<p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">{showDeleted&&compactDirectory?'没有已删除的目录。':templateView&&items.length?'暂无与已保存模板对应的记录。':empty}</p>}
        {templateView&&visible.length>0&&!grouping.length&&query&&<p role="status" className="py-5 text-center text-xs text-muted-foreground">没有匹配的模板。</p>}
        {kind==='template'?grouping.map(({group,items:members},index)=>{
          const containsSelection=members.some(item=>item.id===selectedId);
          const expanded=templateView?activeTemplate===group.id:containsSelection||(expandedGroups[group.id]??index===0);
          const checkedCount=templateView?0:members.filter(item=>checkedSet.has(item.id)).length;
          return <section key={group.id} className="rounded-lg border border-border/60" data-testid={prefix+'-template-group'}>
            <div className="flex items-center rounded-lg bg-muted/40 pr-2">
            <button type="button" aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-muted/60"
              onClick={()=>{
                if(templateView){setActiveTemplate(expanded?'':group.id);return;}
                if(expanded&&containsSelection)setSelectedId('');
                setExpandedGroups(previous=>({...previous,[group.id]:!expanded}));
              }}>
              <ChevronDown aria-hidden className={'h-3.5 w-3.5 '+(expanded?'rotate-180':'')}/>
              <span className="min-w-0 flex-1 break-words font-medium">{group.title}</span>
              {!templateView&&group.historical&&<span className="shrink-0 text-[10px] text-muted-foreground">历史快照</span>}
              {!templateView&&<span className="shrink-0 text-muted-foreground">{members.length} 项{checkedCount>0?' · 已选 '+checkedCount:''}</span>}
            </button>
            <FishDirectorySettingsButton name={group.title} originalName={group.originalTitle} historicalAt={group.historical?.firstArchivedAt} entries={members.flatMap(settingsEntry)} disabled={!!busy}/>
            </div>
            {expanded&&(templateView&&renderTemplate?<div className="min-w-0" data-testid={prefix+'-template-content'}>
              <FishTemplateDirectoryTable key={group.id} importSelection={importSelection} members={members} renderTemplate={renderTemplate} close={()=>changeOpen(false)}/>
            </div>:<div className="space-y-2 p-2">{members.map(renderItem)}</div>)}
          </section>;
        }):visible.map(renderItem)}
      </div>
      </div>
      {picker && <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-2 text-[11px]">{picker.footer(()=>changeOpen(false))}</div>}
    </DialogContent>
  </Dialog></FishLibraryRowExportContext.Provider>;
}
