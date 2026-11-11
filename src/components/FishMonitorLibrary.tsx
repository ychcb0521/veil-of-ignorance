import {useMemo,type ReactNode} from 'react';
import {FishLibraryDataActions} from './FishLibraryTransferContext';
import {FishLibraryTimeDirectory,type FishDirectoryItem,type FishDirectoryPicker} from './FishLibraryTimeDirectory';
import {monitorRoundStudy} from '@/lib/fish/qualityMonitorArchive';
import type {FishQualityStudy} from '@/lib/fish/quality';
import {qualityMonitorArchiveResultCount,qualityMonitorRoundRecordIds,type QualityMonitorArchive,type QualityMonitorArchiveStudy} from '@/lib/fish/qualityMonitorLibrary';
import {downloadMonitorRecords} from '@/lib/fish/qualityMonitorTable';
import type {TradeSignal} from '@/lib/signalLibrary';
export function FishMonitorLibrary({study,renderStudy,onCopyStudy,onSetHidden,onRename,loadArchive,picker,onOpenChange}:{study:FishQualityStudy;picker?:FishDirectoryPicker;onOpenChange?:(open:boolean)=>void;onJump?:(s:TradeSignal)=>void;canJump?:(s:TradeSignal)=>boolean;onOpenCampaign?:()=>void;renderStudy?:(snapshot:FishQualityStudy)=>ReactNode;onCopyStudy?:(snapshot:FishQualityStudy,sourceRoundId?:string)=>Promise<boolean>;onSetHidden?:(id:string,hidden:boolean)=>Promise<boolean>;onRename?:(id:string,name:string)=>Promise<boolean>;loadArchive?:(archive:QualityMonitorArchive)=>Promise<QualityMonitorArchiveStudy>}){
 const library=study.monitorLibrary,settings=useMemo(()=>new Map((library?.settings??[]).map(s=>[s.id,s])),[library?.settings]);
 const rounds=library?.rounds??[],archives=library?.archives??[],frozen=new Set(archives.map(a=>a.sourceRoundId));
 const state={running:'运行中',complete:'已完成',paused:'已暂停',failed:'失败'} as const;
 const items:FishDirectoryItem[]=[
  ...archives.map(a=>({id:a.id,at:a.createdAt,label:a.reason==='copy'?'载入副本前归档':a.reason==='copy-source'?'监测轮次快照':'重算前完整归档',summary:qualityMonitorArchiveResultCount(a)==null?'完整快照':qualityMonitorArchiveResultCount(a)+' 项运行结果',revision:a,study:()=>{if(a.study)return a.study as FishQualityStudy;if(!loadArchive)throw Error('这份归档的正文不在当前页面');return loadArchive(a).then(s=>s as FishQualityStudy);}})),
  ...rounds.filter(r=>!frozen.has(r.id)).map(r=>({id:r.id,at:r.startedAt,label:r.legacy?'历史记录':'监测轮次',summary:qualityMonitorRoundRecordIds(library!,r).length+' 条记录 · '+state[r.state],revision:library?.records,sourceRoundId:r.id,study:()=>monitorRoundStudy(study,r),note:'早期轮次仅保存记录引用，重复条件可能已更新，展示当前仍保存的版本；未保存的探测值、入场读数和反事实保持缺失。重算前完整归档则保留当时的独立快照。'}))
 ];
 const records=(library?.records??[]).filter(r=>settings.has(r.settingId));
 return <FishLibraryTimeDirectory name="监测库" prefix="monitor" picker={picker} onOpenChange={onOpenChange} items={items} edits={library?.directoryEdits} onSetHidden={onSetHidden} onRename={onRename} onCopyStudy={onCopyStudy} renderStudy={renderStudy} recordCount={records.length} download={()=>downloadMonitorRecords(records,settings)} dataActions={!picker&&<FishLibraryDataActions scope="monitor"/>}
  description={`${library?.records.length??0} 条记录 · ${rounds.filter(r=>!r.legacy).length} 轮监测 · ${archives.length} 份完整归档${rounds.some(r=>r.legacy)?' · 含历史快照':''}`}
  info={<><p>时间目录按保存时间从新到旧排列，保留每份运行的条件和结果。目录菜单可编辑名称、删除并恢复目录，保存后保留原时间和全部内容。</p><p>展开记录后点“复制至组合表”，沿用现有复制功能：先完整归档当前组合表，再载入独立副本。原归档保留，副本可继续操作，不自动运行。</p><p>早期轮次只展示仍保存的记录和条件，不补造缺失读数。完整下载、导入及导出保留。</p></>}
  empty="暂无监测归档。点击“从头重新计算”时，会先归档当前已有的运行结果。"/>;
}
