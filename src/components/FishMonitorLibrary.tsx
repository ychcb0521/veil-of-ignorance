import {FishStudyRecoveryStatus} from './FishStudyRecoveryStatus';
import {createLibraryRoundReader} from '@/lib/fish/libraryRounds';
import {createQualityTemplateDirectory, unknownTemplateGroup} from '@/lib/fish/qualityTemplateDirectory';
import { qualityMonitorTimeLabels } from '@/lib/fish/qualityAdmissionTime';
import {useCallback,useMemo,useRef,useState,type ReactNode} from 'react';
import {useRecentMonitorDirectory} from '@/hooks/useRecentMonitorDirectory';
import {RECENT_MONITOR_PAGE_SIZE} from '@/lib/fish/qualityRecentLibrary';
import {readRecentMonitorBody} from '@/lib/fish/qualityRecentLibraryStore';
import {ArchiveDirectorySettings,MonitorDirectorySettings} from './FishLibraryFrozenSettings';
import {FishStoredLibraryTransferMenu} from './FishLibraryTransferContext';
import {FishLibraryTimeDirectory,type FishDirectoryItem,type FishTemplateRenderer,type FishDirectoryPicker,type FishDirectoryRequest} from './FishLibraryTimeDirectory';
import {archivedMonitorCampaignLookup,monitorRoundStudy} from '@/lib/fish/qualityMonitorArchive';
import type {FishQualityStudy} from '@/lib/fish/quality';
import {qualityMonitorArchiveResultCount,type QualityMonitorSetting,type QualityMonitorArchive,type QualityMonitorArchiveStudy} from '@/lib/fish/qualityMonitorLibrary';
import {downloadMonitorRecords} from '@/lib/fish/qualityMonitorTable';
import type {TradeSignal} from '@/lib/signalLibrary';
export function FishMonitorLibrary({study,ready=true,account,loadError,onRetry,renderStudy,renderTemplate,onCopyStudy,onSetHidden,onPurgeDirectory,onRename,loadArchive,picker,onOpenChange,openRequest}:{ready?:boolean;account?:string;loadError?:string;onRetry?:()=>void;study:FishQualityStudy;picker?:FishDirectoryPicker;openRequest?:FishDirectoryRequest;onOpenChange?:(open:boolean)=>void;onJump?:(s:TradeSignal)=>void;canJump?:(s:TradeSignal)=>boolean;onOpenCampaign?:()=>void;renderTemplate?:FishTemplateRenderer;renderStudy?:(snapshot:FishQualityStudy, close?: () => void)=>ReactNode;onCopyStudy?:(snapshot:FishQualityStudy,sourceRoundId?:string)=>Promise<boolean>;onSetHidden?:(id:string,hidden:boolean)=>Promise<boolean>;onPurgeDirectory?:(ids:readonly string[])=>Promise<{removed:readonly string[];retained:readonly string[]}>;onRename?:(id:string,name:string)=>Promise<boolean>;loadArchive?:(archive:QualityMonitorArchive, updateDirectory?:boolean)=>Promise<QualityMonitorArchiveStudy>}){
 const [recentSession,setRecentSession]=useState(false),[pageSize,setPageSize]=useState(RECENT_MONITOR_PAGE_SIZE);
 const recent=useRecentMonitorDirectory(account,recentSession||!!openRequest&&!ready),directory=recent.directory;
 const usingRecent=recentSession&&!!directory;
 const changeOpen=useCallback((open:boolean)=>{if(open){setRecentSession(!ready);setPageSize(RECENT_MONITOR_PAGE_SIZE);}else setRecentSession(false);onOpenChange?.(open);},[ready,onOpenChange]);
 const recentItems=useMemo<FishDirectoryItem[]>(()=>!directory?[]:directory.entries.filter(entry=>!directory.edits?.[entry.id]?.hidden).slice(0,pageSize).map(entry=>{
  const read=()=>readRecentMonitorBody(directory,entry);
  return {id:entry.id,at:entry.at,label:entry.templateDirectory.title+' · '+entry.label,summary:entry.summary,
   sourceRoundId:entry.sourceRoundId,revision:entry.bodyId,templateGroup:entry.templateDirectory,study:read,preview:read,
   settings:async()=> <ArchiveDirectorySettings study={await read()}/>};
 }),[directory,pageSize]);
 const library=study.monitorLibrary,settings=useMemo(()=>new Map((library?.settings??[]).map(s=>[s.id,s])),[library?.settings]);
 const current=useRef(study);current.current=study;
 const getItems=useCallback(():FishDirectoryItem[]=>{
  const rounds=library?.rounds??[],archives=library?.archives??[],frozen=new Set(archives.map(a=>a.sourceRoundId));
  const templates=createQualityTemplateDirectory({planTemplates:study.planTemplates},true);
  const readIds=createLibraryRoundReader(rounds), byRound=new Map(rounds.map(round=>[round.id,round]));
  const catalog=new Map(library?.records.map((record,index)=>[record.id,{record,index}]));
  const summaries=new WeakMap<string[],{settings:QualityMonitorSetting[];group:ReturnType<typeof templates.groupPlans>}>();
  const describe=(ids:string[])=>{
    const cached=summaries.get(ids);if(cached)return cached;
    const matched=[...new Set(ids.map(id=>catalog.get(id)?.record.settingId))].flatMap(id=>{const setting=id&&settings.get(id);return setting?[setting]:[];});
    const summary={settings:matched,group:templates.groupPlans(matched.map(setting=>setting.plan))};
    summaries.set(ids,summary);return summary;
  };
  const recordsFor=(ids:string[])=>ids.flatMap(id=>{const item=catalog.get(id);return item&&settings.has(item.record.settingId)?[item]:[];})
    .sort((a,b)=>a.index-b.index).map(item=>item.record);
  let lookup:ReturnType<typeof archivedMonitorCampaignLookup>|undefined;
  const campaignPath:NonNullable<FishDirectoryItem['campaignPath']>=result=>(lookup??=archivedMonitorCampaignLookup(current.current))(result);
  const inheritedGroup=(id:string)=>{const round=byRound.get(id);return round?describe(readIds(round)).group:undefined;};
  const readArchive=(archive:QualityMonitorArchive, updateDirectory=true)=>{
    if(archive.study)return archive.study as FishQualityStudy;
    if(!loadArchive)throw Error('这份归档的正文不在当前页面');
    return (updateDirectory ? loadArchive(archive) : loadArchive(archive,false)) as Promise<FishQualityStudy>;
  };
  const state={running:'运行中',complete:'已完成',paused:'已暂停',failed:'失败'} as const;
  return templates.withHistoricalNames([
  ...archives.map(a=>({id:a.id,at:a.createdAt,label:a.reason==='copy'?'载入副本前归档':a.reason==='copy-source'?'监测轮次快照':'重算前完整归档',summary:qualityMonitorArchiveResultCount(a)==null?'完整快照':qualityMonitorArchiveResultCount(a)+' 项运行结果',revision:a.study??a.id,purgeable:true,templateGroup:a.templateDirectory?templates.present(a.templateDirectory,a.sourceRoundId?inheritedGroup(a.sourceRoundId):undefined):(a.study?templates.groupPlans(a.study.sellPlans??[]):(a.reason==='copy-source'&&a.sourceRoundId?inheritedGroup(a.sourceRoundId):undefined)??unknownTemplateGroup),study:()=>readArchive(a),preview:()=>readArchive(a,false),campaignPath,settings:async()=> <ArchiveDirectorySettings study={await readArchive(a,false)}/>})),
  ...rounds.filter(r=>!frozen.has(r.id)).map(r=>{
    const ids=readIds(r), summary=describe(ids);
    return {id:r.id,at:r.startedAt,label:r.legacy?'历史记录':'监测轮次',summary:ids.length+' 条记录 · '+state[r.state]+(r.timeBasis?' · '+qualityMonitorTimeLabels[r.timeBasis]:''),revision:library?.records,
      purgeable:r.state==='complete'||r.state==='failed',templateGroup:summary.group,sourceRoundId:r.id,
      study:()=>monitorRoundStudy(current.current,r,recordsFor(ids)),settings:()=> <MonitorDirectorySettings settings={summary.settings} timeBasis={r.timeBasis}/>,
      note:'早期轮次仅保存记录引用，展示当前仍保存的版本。'};
  })
  ],'monitor');
 },[library,loadArchive,settings,study.planTemplates]);
 const records=useMemo(()=>(library?.records??[]).filter(r=>settings.has(r.settingId)),[library?.records,settings]);
 const rounds=library?.rounds??[], archives=library?.archives??[];
 const visibleRecent=directory?.entries.filter(entry=>!directory.edits?.[entry.id]?.hidden).length??0;
 return <FishLibraryTimeDirectory loading={!usingRecent&&!ready&&!loadError} loadError={usingRecent?undefined:loadError} onRetry={onRetry}
  notice={usingRecent?<p role="status" className="text-xs text-muted-foreground">已优先载入最近记录，展开时读取正文。{!ready?(loadError?<>完整研究尚未恢复。{onRetry&&<button type="button" className="ml-2 underline" onClick={onRetry}>重试完整研究</button>}</>:'完整研究仍在后台恢复。'):<button type="button" className="ml-2 underline" onClick={()=>setRecentSession(false)}>查看全部轮次</button>}{!ready&&!!directory!.olderMonitorRounds?'更早的 '+directory!.olderMonitorRounds+' 轮将随完整研究恢复。':''}</p>:recentSession&&recent.error?<p role="alert" className="text-xs text-muted-foreground">{recent.error} <button type="button" className="underline" onClick={recent.retry}>重试近期目录</button></p>:undefined}
  more={usingRecent&&(pageSize<visibleRecent||directory!.entries.length<directory!.total)?<button type="button" className="rounded border px-3 py-2 text-xs" disabled={recent.loading} onClick={()=>{setPageSize(n=>n+RECENT_MONITOR_PAGE_SIZE);if(pageSize>=visibleRecent)recent.retry();}}>{recent.loading?'正在读取更早记录…':'加载更早记录'}</button>:undefined}
  loadingStatus={<FishStudyRecoveryStatus owner={account}/>} renderTemplate={renderTemplate} name="监测库" prefix="monitor" kind={usingRecent?'time':'template'} openRequest={openRequest} picker={picker} onOpenChange={changeOpen} items={usingRecent?recentItems:getItems} edits={usingRecent?directory?.edits:library?.directoryEdits} onSetHidden={ready?onSetHidden:undefined} onPurgeDirectory={picker||!ready?undefined:onPurgeDirectory} onRename={ready?onRename:undefined} onCopyStudy={ready?onCopyStudy:undefined} renderStudy={renderStudy} recordCount={ready?records.length:0} download={()=>downloadMonitorRecords(records,settings)} transferMenu={!picker?(ready?actions=><FishStoredLibraryTransferMenu scope="monitor" actions={actions}/>:()=>null):undefined}
  description={usingRecent?`已显示最近 ${recentItems.length} 项目录`:`${library?.records.length??0} 条记录 · ${rounds.filter(r=>!r.legacy).length} 轮监测 · ${archives.length} 份完整归档${rounds.some(r=>r.legacy)?' · 含历史快照':''}`}
  info={<><p>模板下的监测轮次和归档按时间排列，保留每份运行的条件和结果。目录菜单可编辑名称、删除并恢复目录，保存后保留原时间和全部内容。</p><p>展开目录后可选择记录导入组合表，原归档保留。</p><p>早期轮次只展示仍保存的记录和条件，不补造缺失读数。完整下载、导入及导出保留。</p></>}
  empty="暂无监测归档。运行完成后可在组合表保存到监测库。"/>;
}
