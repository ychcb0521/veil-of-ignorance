import {createQualityTemplateDirectory, unknownTemplateGroup} from '@/lib/fish/qualityTemplateDirectory';
import {useCallback,useState,type ReactNode} from 'react';
import {filterLibraryCondition,libraryConditionSearch} from '@/lib/fish/libraryConditions';
import {FishStudyRecoveryStatus} from './FishStudyRecoveryStatus';
import {FilterDirectorySettings} from './FishLibraryFrozenSettings';
import {FishLibraryCondition} from './FishLibraryConditions';
import {libraryCell} from './FishLibraryDialog';
import {FishDeferredDetails,FishLibraryTimeDirectory,type FishDirectoryItem,type FishTemplateRenderer,type FishDirectoryRequest} from './FishLibraryTimeDirectory';
import {FishStoredLibraryTransferMenu} from './FishLibraryTransferContext';
import type {FishQualityStudy} from '@/lib/fish/quality';
import type {QualityFilterRecord,QualityFilterSetting} from '@/lib/fish/qualityFilterLibrary';
import {createFilterDirectoryReader,filterDirectoryStudy,downloadDirectoryTables} from '@/lib/fish/qualityLibraryDirectory';
import {qualityFilterValueText} from '@/lib/fish/qualityFilterColumns';
import {formatUTC8} from '@/lib/timeFormat';
const date=(t:number|null|undefined)=>t==null?'—':formatUTC8(t);
const STATE={pass:'满足',fail:'不满足',error:'缺数据',pending:'待判断',none:'不过滤'} as const;
const ROUND_STATE={running:'运行中',complete:'已完成',paused:'已暂停',failed:'失败'} as const;
export function FishFilterLibrary({study,ready=true,account,requestWorkspace,loadError,onRetry,renderStudy,renderTemplate,onCopyStudy,onSetHidden,onRename,openRequest,onSelectDirectory}:{requestWorkspace?:()=>void;ready?:boolean;account?:string;loadError?:string;onRetry?:()=>void;openRequest?:FishDirectoryRequest;onSelectDirectory?:(id:string,s:FishQualityStudy,ids?:string[])=>Promise<boolean>;study:FishQualityStudy;renderTemplate?:FishTemplateRenderer;renderStudy?:(s:FishQualityStudy, close?: () => void)=>ReactNode;onCopyStudy?:(s:FishQualityStudy)=>Promise<boolean>;onSetHidden?:(id:string,hidden:boolean)=>Promise<boolean>;onRename?:(id:string,name:string)=>Promise<boolean>}){
 const library=study.filterLibrary;
 const getItems=useCallback(():FishDirectoryItem[]=>{
  if(!library)return [];
  const templates=createQualityTemplateDirectory(study,true);
  const read=createFilterDirectoryReader(library);
  const items:FishDirectoryItem[]=library.rounds.map(r=>{
   const data=read(r);
   const used=new Set(data.records.map(record=>record.settingId));
   const settings=data.settings.filter(setting=>used.has(setting.id));
   const templateGroup=templates.groupFilters(settings,r.filterSnapshot);
   return {id:r.id,templateGroup,at:r.startedAt,label:'过滤轮次',summary:data.records.length+' 条记录 · '+ROUND_STATE[r.state],revision:library,
     settings:()=> <FilterDirectorySettings settings={settings} snapshot={r.filterSnapshot}/>,study:()=>filterDirectoryStudy(library,r,data),details:<FilterEvidence {...data}/>,note:r.filterSnapshot?'保留本轮组合表输入、冻结条件和判断；后续重算不会覆盖。':'早期轮次仅保存记录引用，展示当前仍保存的版本；未保存的探测值和评分保持缺失。'};
  });
  const legacy=read();
  const used=new Set(legacy.records.map(record=>record.settingId));
  if(legacy.records.length)items.push({id:'filter-legacy',templateGroup:unknownTemplateGroup,at:legacy.records.reduce((at,r)=>Math.max(at,r.updatedAt),0),label:'历史记录',summary:legacy.records.length+' 条记录',revision:library,
   settings:()=> <FilterDirectorySettings settings={legacy.settings.filter(setting=>used.has(setting.id))}/>,study:()=>filterDirectoryStudy(library,undefined,legacy),details:<FilterEvidence {...legacy}/>,note:'历史记录未保存轮次，只展示已有的冻结条件与读数，不补造缺失数据。'});
  return templates.withHistoricalNames(items,'filter');
 },[library,study.planTemplates]);
 return <FishLibraryTimeDirectory browseArchive={{owner:account,scope:'filter',directoryOnly:!ready,loadFull:requestWorkspace??onRetry}} browseRounds loading={!ready&&!loadError} loadError={loadError} onRetry={onRetry}
  loadingStatus={<FishStudyRecoveryStatus owner={account}/>} renderTemplate={renderTemplate} openRequest={openRequest} onSelectDirectory={onSelectDirectory} name="过滤库" prefix="filter" kind="template" items={getItems} edits={study.monitorLibrary?.directoryEdits} onSetHidden={onSetHidden} onRename={onRename} onCopyStudy={onCopyStudy} renderStudy={renderStudy} recordCount={library?.records.length??0}
  description={`${library?.records.length??0} 条记录 · ${library?.rounds.length??0} 轮过滤`} transferMenu={actions=><FishStoredLibraryTransferMenu scope="filter" actions={actions}/>} download={()=>downloadDirectoryTables('过滤库',getItems().map(item=>({id:item.id,study:item.study() as FishQualityStudy})))}
  info={<><p>按冻结模板整理过滤轮次。展开后展示该轮组合表，条件、读数和判断取自保存记录，不重新计算。</p><p>新轮次单独保存组合表输入和过滤结果；早期轮次只有记录引用，会明确标注。目录可编辑名称、删除和恢复，复制前先完整归档当前组合表。</p></>}
  empty="暂无过滤记录。运行完成后可在组合表保存到过滤库。"/>;
}
type FilterEvidenceProps={settings:QualityFilterSetting[];records:QualityFilterRecord[]};
function FilterEvidence(props:FilterEvidenceProps) {
 return <FishDeferredDetails summary="过滤判定详情" className="m-4 text-[11px]"><FilterEvidenceRows {...props}/></FishDeferredDetails>;
}
function FilterEvidenceRows({settings:catalog,records}:FilterEvidenceProps){
 const [query,setQuery]=useState(''),settings=new Map(catalog.map(s=>[s.id,s]));
 const items=records.filter(r=>{const s=settings.get(r.settingId);return s&&(!query||r.source.symbol.toUpperCase().includes(query.toUpperCase())||s.filters.some(f=>libraryConditionSearch(filterLibraryCondition(f)).toUpperCase().includes(query.toUpperCase())));});
 return <><input aria-label="搜索过滤库" placeholder="搜索标的、过滤条件…" value={query} onChange={e=>setQuery(e.target.value)} className="my-2 h-8 w-64 rounded border bg-background px-2"/><div className="overflow-auto"><table className="w-full text-[11px]"><thead><tr>{['标的','信号时间','买入时刻','过滤条件','关联方式','读数','判断','保存时间'].map(h=><th key={h} className={libraryCell}>{h}</th>)}</tr></thead><tbody>{items.map(r=>{
  const setting=settings.get(r.settingId)!;
  return <tr key={r.id} data-testid="filter-library-row" className="border-t border-border/40" title={r.status.detail}>
   <td className={libraryCell}>{r.source.symbol}</td><td className={libraryCell}>{date(r.source.timeMs)}</td><td className={libraryCell}>{date(r.enteredAt)}</td>
   <td className={libraryCell}><p className="text-muted-foreground">{setting.filters.length>1?'交集 · 以下条件全部满足':'单条件'}</p>{setting.filters.map((f,i)=><FishLibraryCondition key={i} condition={filterLibraryCondition(f)}/>)}</td>
   <td className={libraryCell}>{setting.plans.length?'历史绑定 · '+setting.plans.join('、'):'独立过滤'}</td>
   <td className={libraryCell}>{setting.filters.map((f,i)=>{const reading=r.readings[i],valid=reading&&!reading.error&&Number.isFinite(reading.value),passed=valid&&(f.direction==='>'?reading.value!>f.threshold:reading.value!<f.threshold);return <div key={i} title={reading?.error??date(reading?.at)}><p>{filterLibraryCondition(f).metric} = {valid?qualityFilterValueText(reading.value!):reading?'缺数据':'待计算'}</p><p className={valid?passed?'text-emerald-600':'text-destructive':'text-muted-foreground'}>{valid?passed?'满足':'不满足':reading?'读数无效':'尚未取得读数'}</p></div>;})}</td>
   <td className={libraryCell}>{STATE[r.status.state]}</td><td className={libraryCell}>{date(r.updatedAt)}</td>
  </tr>;
 })}</tbody></table></div></>;
}
