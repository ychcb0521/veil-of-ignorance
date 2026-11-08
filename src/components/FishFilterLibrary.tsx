import {useState,type ReactNode} from 'react';
import {filterLibraryCondition,libraryConditionSearch} from '@/lib/fish/libraryConditions';
import {FishLibraryCondition} from './FishLibraryConditions';
import {libraryCell} from './FishLibraryDialog';
import {FishLibraryTimeDirectory,type FishDirectoryItem,type FishDirectoryRequest} from './FishLibraryTimeDirectory';
import {FishLibraryDataActions} from './FishLibraryTransferContext';
import type {FishQualityStudy} from '@/lib/fish/quality';
import type {QualityFilterRecord,QualityFilterSetting} from '@/lib/fish/qualityFilterLibrary';
import {filterDirectoryData,filterDirectoryStudy,downloadDirectoryTables} from '@/lib/fish/qualityLibraryDirectory';
import {qualityFilterValueText} from '@/lib/fish/qualityFilterColumns';
import {formatUTC8} from '@/lib/timeFormat';
const date=(t:number|null|undefined)=>t==null?'—':formatUTC8(t);
const STATE={pass:'满足',fail:'不满足',error:'缺数据',pending:'待判断',none:'不过滤'} as const;
const ROUND_STATE={running:'运行中',complete:'已完成',paused:'已暂停',failed:'失败'} as const;
export function FishFilterLibrary({study,renderStudy,onCopyStudy,onSetHidden,openRequest,onSelectDirectory}:{openRequest?:FishDirectoryRequest;onSelectDirectory?:(id:string,s:FishQualityStudy,ids?:string[])=>Promise<boolean>;study:FishQualityStudy;renderStudy?:(s:FishQualityStudy)=>ReactNode;onCopyStudy?:(s:FishQualityStudy)=>Promise<boolean>;onSetHidden?:(id:string,hidden:boolean)=>Promise<boolean>}){
 const library=study.filterLibrary,rounds=library?.rounds??[];
 const items:FishDirectoryItem[]=library?rounds.map(r=>({id:r.id,at:r.startedAt,label:'过滤轮次',summary:filterDirectoryData(library,r).records.length+' 条记录 · '+ROUND_STATE[r.state],revision:library,study:()=>filterDirectoryStudy(library,r),details:<FilterEvidence {...filterDirectoryData(library,r)}/>,note:r.filterSnapshot?'保留本轮组合表输入、冻结条件和判断；后续重算不会覆盖。':'早期轮次仅保存记录引用，展示当前仍保存的版本；未保存的探测值和评分保持缺失。'})):[];
 const legacy=library?filterDirectoryData(library):undefined;
 if(legacy?.records.length)items.push({id:'filter-legacy',at:Math.max(...legacy.records.map(r=>r.updatedAt)),label:'历史记录',summary:legacy.records.length+' 条记录',revision:library,study:()=>filterDirectoryStudy(library!),details:<FilterEvidence {...legacy}/>,note:'历史记录未保存轮次，只展示已有的冻结条件与读数，不补造缺失数据。'});
 return <FishLibraryTimeDirectory openRequest={openRequest} onSelectDirectory={onSelectDirectory} name="过滤库" prefix="filter" items={items} edits={study.monitorLibrary?.directoryEdits} onSetHidden={onSetHidden} onCopyStudy={onCopyStudy} renderStudy={renderStudy} recordCount={library?.records.length??0}
  description={`${library?.records.length??0} 条记录 · ${rounds.length} 轮过滤`} dataActions={<FishLibraryDataActions scope="filter"/>} download={()=>downloadDirectoryTables('过滤库',items.map(item=>({id:item.id,study:item.study() as FishQualityStudy})))}
  info={<><p>与监测库共用时间目录。展开后展示该轮组合表，条件、读数和判断取自保存记录，不重新计算。</p><p>新轮次单独保存组合表输入和过滤结果；早期轮次只有记录引用，会明确标注。目录可删除和恢复，复制前先完整归档当前组合表。</p></>}
  empty="暂无过滤记录。设置买入条件并开始过滤后，每轮会自动保存。"/>;
}
function FilterEvidence({settings:catalog,records}:{settings:QualityFilterSetting[];records:QualityFilterRecord[]}){
 const [query,setQuery]=useState(''),settings=new Map(catalog.map(s=>[s.id,s]));
 const items=records.filter(r=>{const s=settings.get(r.settingId);return s&&(!query||r.source.symbol.toUpperCase().includes(query.toUpperCase())||s.filters.some(f=>libraryConditionSearch(filterLibraryCondition(f)).toUpperCase().includes(query.toUpperCase())));});
 return <details className="m-4 text-[11px]"><summary className="cursor-pointer text-muted-foreground">过滤判定详情</summary><input aria-label="搜索过滤库" placeholder="搜索标的、过滤条件…" value={query} onChange={e=>setQuery(e.target.value)} className="my-2 h-8 w-64 rounded border bg-background px-2"/><div className="overflow-auto"><table className="w-full text-[11px]"><thead><tr>{['标的','信号时间','买入时刻','过滤条件','关联方式','读数','判断','保存时间'].map(h=><th key={h} className={libraryCell}>{h}</th>)}</tr></thead><tbody>{items.map(r=>{
  const setting=settings.get(r.settingId)!;
  return <tr key={r.id} data-testid="filter-library-row" className="border-t border-border/40" title={r.status.detail}>
   <td className={libraryCell}>{r.source.symbol}</td><td className={libraryCell}>{date(r.source.timeMs)}</td><td className={libraryCell}>{date(r.enteredAt)}</td>
   <td className={libraryCell}><p className="text-muted-foreground">{setting.filters.length>1?'交集 · 以下条件全部满足':'单条件'}</p>{setting.filters.map((f,i)=><FishLibraryCondition key={i} condition={filterLibraryCondition(f)}/>)}</td>
   <td className={libraryCell}>{setting.plans.length?'历史绑定 · '+setting.plans.join('、'):'独立过滤'}</td>
   <td className={libraryCell}>{setting.filters.map((f,i)=>{const reading=r.readings[i],valid=reading&&!reading.error&&Number.isFinite(reading.value),passed=valid&&(f.direction==='>'?reading.value!>f.threshold:reading.value!<f.threshold);return <div key={i} title={reading?.error??date(reading?.at)}><p>{filterLibraryCondition(f).metric} = {valid?qualityFilterValueText(reading.value!):reading?'缺数据':'待计算'}</p><p className={valid?passed?'text-emerald-600':'text-destructive':'text-muted-foreground'}>{valid?passed?'满足':'不满足':reading?'读数无效':'尚未取得读数'}</p></div>;})}</td>
   <td className={libraryCell}>{STATE[r.status.state]}</td><td className={libraryCell}>{date(r.updatedAt)}</td>
  </tr>;
 })}</tbody></table></div></details>;
}
