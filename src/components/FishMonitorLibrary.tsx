import {createQualityTemplateDirectory, unknownTemplateGroup} from '@/lib/fish/qualityTemplateDirectory';
import { qualityMonitorTimeLabels } from '@/lib/fish/qualityAdmissionTime';
import {useCallback,useMemo,type ReactNode} from 'react';
import {ArchiveDirectorySettings,MonitorDirectorySettings} from './FishLibraryFrozenSettings';
import {FishLibraryDataActions} from './FishLibraryTransferContext';
import {FishLibraryTimeDirectory,type FishDirectoryItem,type FishDirectoryPicker,type FishDirectoryRequest} from './FishLibraryTimeDirectory';
import {monitorRoundStudy} from '@/lib/fish/qualityMonitorArchive';
import type {FishQualityStudy} from '@/lib/fish/quality';
import {qualityMonitorArchiveResultCount,qualityMonitorRoundRecordIds,type QualityMonitorArchive,type QualityMonitorArchiveStudy} from '@/lib/fish/qualityMonitorLibrary';
import {downloadMonitorRecords} from '@/lib/fish/qualityMonitorTable';
import type {TradeSignal} from '@/lib/signalLibrary';
export function FishMonitorLibrary({study,renderStudy,onCopyStudy,onSetHidden,onPurgeDirectory,onRename,loadArchive,picker,onOpenChange,openRequest}:{study:FishQualityStudy;picker?:FishDirectoryPicker;openRequest?:FishDirectoryRequest;onOpenChange?:(open:boolean)=>void;onJump?:(s:TradeSignal)=>void;canJump?:(s:TradeSignal)=>boolean;onOpenCampaign?:()=>void;renderStudy?:(snapshot:FishQualityStudy, close?: () => void)=>ReactNode;onCopyStudy?:(snapshot:FishQualityStudy,sourceRoundId?:string)=>Promise<boolean>;onSetHidden?:(id:string,hidden:boolean)=>Promise<boolean>;onPurgeDirectory?:(ids:readonly string[])=>Promise<{removed:readonly string[];retained:readonly string[]}>;onRename?:(id:string,name:string)=>Promise<boolean>;loadArchive?:(archive:QualityMonitorArchive, updateDirectory?:boolean)=>Promise<QualityMonitorArchiveStudy>}){
 const library=study.monitorLibrary,settings=useMemo(()=>new Map((library?.settings??[]).map(s=>[s.id,s])),[library?.settings]);
 const getItems=useCallback(():FishDirectoryItem[]=>{
  const rounds=library?.rounds??[],archives=library?.archives??[],frozen=new Set(archives.map(a=>a.sourceRoundId));
  const templates=createQualityTemplateDirectory(study), recordSettings=new Map(library?.records.map(record=>[record.id,record.settingId]));
  const roundCache=new Map<string,string[]>();
  const settingsForRound=new Map(rounds.map(round=>[round.id,[...new Set(qualityMonitorRoundRecordIds(library!,round,roundCache).map(id=>recordSettings.get(id)))].flatMap(id=>{
    const setting=id&&settings.get(id);
    return setting?[setting]:[];
  })]));
  const groups=new Map(rounds.map(round=>[round.id,templates.groupPlans((settingsForRound.get(round.id)??[]).map(setting=>setting.plan))]));
  const readArchive=(archive:QualityMonitorArchive, updateDirectory=true)=>{
    if(archive.study)return archive.study as FishQualityStudy;
    if(!loadArchive)throw Error('这份归档的正文不在当前页面');
    return (updateDirectory ? loadArchive(archive) : loadArchive(archive,false)) as Promise<FishQualityStudy>;
  };
  const state={running:'运行中',complete:'已完成',paused:'已暂停',failed:'失败'} as const;
  return [
  ...archives.map(a=>({id:a.id,at:a.createdAt,label:a.reason==='copy'?'载入副本前归档':a.reason==='copy-source'?'监测轮次快照':'重算前完整归档',summary:qualityMonitorArchiveResultCount(a)==null?'完整快照':qualityMonitorArchiveResultCount(a)+' 项运行结果',revision:a.study??a.id,purgeable:true,templateGroup:a.templateDirectory??(a.study?templates.groupPlans(a.study.sellPlans??[]):(a.reason==='copy-source'&&a.sourceRoundId?groups.get(a.sourceRoundId):undefined)??unknownTemplateGroup),study:()=>readArchive(a),settings:async()=> <ArchiveDirectorySettings study={await readArchive(a,false)}/>})),
  ...rounds.filter(r=>!frozen.has(r.id)).map(r=>({id:r.id,at:r.startedAt,label:r.legacy?'历史记录':'监测轮次',summary:qualityMonitorRoundRecordIds(library!,r,roundCache).length+' 条记录 · '+state[r.state]+(r.timeBasis?' · '+qualityMonitorTimeLabels[r.timeBasis]:''),revision:library?.records,purgeable:r.state==='complete'||r.state==='failed',templateGroup:groups.get(r.id),sourceRoundId:r.id,study:()=>monitorRoundStudy(study,r),settings:()=> <MonitorDirectorySettings settings={settingsForRound.get(r.id)??[]} timeBasis={r.timeBasis}/>,note:'早期轮次仅保存记录引用，重复条件可能已更新，展示当前仍保存的版本；未保存的探测值、入场读数和反事实保持缺失。重算前完整归档则保留当时的独立快照。'}))
  ];
 },[library,loadArchive,settings,study]);
 const records=useMemo(()=>(library?.records??[]).filter(r=>settings.has(r.settingId)),[library?.records,settings]);
 const rounds=library?.rounds??[], archives=library?.archives??[];
 return <FishLibraryTimeDirectory name="监测库" prefix="monitor" kind="template" openRequest={openRequest} picker={picker} onOpenChange={onOpenChange} items={getItems} edits={library?.directoryEdits} onSetHidden={onSetHidden} onPurgeDirectory={picker?undefined:onPurgeDirectory} onRename={onRename} onCopyStudy={onCopyStudy} renderStudy={renderStudy} recordCount={records.length} download={()=>downloadMonitorRecords(records,settings)} dataActions={!picker&&<FishLibraryDataActions scope="monitor"/>}
  description={`${library?.records.length??0} 条记录 · ${rounds.filter(r=>!r.legacy).length} 轮监测 · ${archives.length} 份完整归档${rounds.some(r=>r.legacy)?' · 含历史快照':''}`}
  info={<><p>模板下的监测轮次和归档按时间排列，保留每份运行的条件和结果。目录菜单可编辑名称、删除并恢复目录，保存后保留原时间和全部内容。</p><p>展开目录后可选择记录导入组合表，原归档保留。</p><p>早期轮次只展示仍保存的记录和条件，不补造缺失读数。完整下载、导入及导出保留。</p></>}
  empty="暂无监测归档。运行完成后可在组合表保存到监测库。"/>;
}
