import {entryProcessText} from './preEntryExclusionProcess';
import {qualityEntryIdentity,type FishQualityStudy} from './quality';
import {preEntrySignal,type PreEntryLibrary,type PreEntryRecord,type PreEntryRound} from './preEntryMonitor';
import {qualityTableMembers,qualityTableRange,type QualityTableRow} from './qualityTableRows';
import {formatUTC8} from '@/lib/timeFormat';
import type {XlsxSheet} from '@/lib/xlsxWorkbook';

export interface QualityScreeningResult {record:PreEntryRecord;round:PreEntryRound}
export const screeningStatus={queued:'待筛选',scanning:'筛选中',paused:'已暂停',matched:'已入选',unmatched:'未入选',warming:'历史不足',error:'缺数据'} as const;
export const hasScreeningTableResult=(record:PreEntryRecord)=>!record.tableClearedAt||record.updatedAt>record.tableClearedAt;
/** Canonical history remains in its library. A saved table may also own a frozen display snapshot. */
export function qualityScreeningResults(study:Pick<FishQualityStudy,'screeningResults'|'screeningRounds'>,library?:PreEntryLibrary):QualityScreeningResult[]{
 const rounds=new Map(library?.rounds.map(r=>[r.id,r])),results=new Map<string,QualityScreeningResult>();
 for(const record of library?.records??[]){const round=rounds.get(record.roundId);if(round&&hasScreeningTableResult(record))results.set(record.id,{record,round});}
 const savedRounds=new Map(study.screeningRounds?.map(r=>[r.id,r]));
 for(const record of study.screeningResults??[]){const round=savedRounds.get(record.roundId);if(round&&hasScreeningTableResult(record)&&(!results.has(record.id)||results.get(record.id)!.record.updatedAt<=record.updatedAt))results.set(record.id,{record,round});}
 return [...results.values()];
}
export function screeningResultIndex(results:readonly QualityScreeningResult[]){
 const index=new Map<string,QualityScreeningResult[]>();
 for(const result of results){const r=result.record,keys=new Set([qualityEntryIdentity(r.sample.source,r.sample.enteredAt)]),signal=preEntrySignal(r);if(signal){keys.add(qualityEntryIdentity(signal,signal.timeMs));keys.add(qualityEntryIdentity(r.sample.source,signal.timeMs));}
  for(const key of keys){const entries=index.get(key)??[];entries.push(result);index.set(key,entries);}
 }
 return index;
}
export function screeningRowResults(row:QualityTableRow,index:ReturnType<typeof screeningResultIndex>,roundId?:string,workingRoundId?:string):QualityScreeningResult[]{
 const entries=new Map<string,QualityScreeningResult>();
 for(const member of qualityTableMembers(row)){const matches=index.get(qualityEntryIdentity(member.source,member.enteredAt))??[];
 const scope=workingRoundId&&matches.some(r=>r.round.id===workingRoundId)?workingRoundId:roundId??member.source.preEntryMonitor?.roundId;
 for(const result of matches){
  if(scope&&result.round.id!==scope)continue;
  const plan=result.round.plans?.find(p=>p.id===result.record.planId),key=JSON.stringify(plan??result.round.filters),old=entries.get(key);
  if(!old||result.record.updatedAt>old.record.updatedAt||result.record.updatedAt===old.record.updatedAt&&result.round.startedAt>old.round.startedAt)entries.set(key,result);
 }}
 return [...entries.values()];
}
export function screeningCell(results:readonly QualityScreeningResult[]){
 const plans=[...new Set(results.map(({record,round})=>round.plans?.find(p=>p.id===record.planId)?.label??(round.filters.map(f=>f.label).join(' 且 ')||'历史筛选方案')))];
 const statuses=[...new Set(results.map(({record})=>screeningStatus[record.status]))],matched=results.filter(r=>r.record.status==='matched'&&r.record.matchedAt);
 const detail=results.map(({record:r,round})=>[plans.length===1?plans[0]:round.plans?.find(p=>p.id===r.planId)?.label??'历史筛选方案',screeningStatus[r.status],r.detail,`引擎 ${round.engine??'pre-entry-close-v1'}`,`原信号 ${formatUTC8(r.sample.source.timeMs)}`,`扫描到 ${formatUTC8(Math.min(r.cursor,r.endTime??r.cursor))}`,r.matchedAt?`首次满足 ${formatUTC8(r.matchedAt)}`:'',...r.readings.map((reading,i)=>{const conditions=round.plans?.find(p=>p.id===r.planId)?.preEntryThreeStage?.required??round.filters,f=conditions.find(f=>f.id===reading.key)??(!round.engine?conditions[i]:undefined),label=f?.label??r.threeStage?.readings.find(x=>x.id===reading.key)?.label??'观测读数 '+(i+1);return `${label} = ${reading.error??(reading.value==null?'缺数据':String(+reading.value.toPrecision(8)))}${f?`（${f.direction} ${f.threshold}）`:''}`;}),r.threeStage?`${r.threeStage.zero?'⓪ 必要条件 '+r.threeStage.zero.status+' / ① 防守线 '+r.threeStage.first.status+' / ② 排除门槛 '+r.threeStage.second.status:'三阶：'+r.threeStage.first.status+' / '+r.threeStage.second.status+' / '+r.threeStage.third?.status}${r.threeStage.event?'；新防守线 '+r.threeStage.event.price:''}`:''].filter(Boolean).join('；')).join('\n');
 return {plan:plans.join(' / ')||'—',status:statuses.join(' / ')||'—',at:matched.length?qualityTableRange(matched.map(r=>r.record.matchedAt),formatUTC8):'—',time:matched.length?Math.max(...matched.map(r=>r.record.matchedAt!)):null,detail,matched:!!results.length&&results.every(r=>r.record.status==='matched'),error:results.some(r=>r.record.status==='error')};
}
export function screeningResultsSheet(results:readonly QualityScreeningResult[]):XlsxSheet{
 return {name:'动态筛选',columns:['标的','原信号时间','筛选方案','筛选结果','首次满足时间','排除过程','排除过程 JSON','扫描到','引擎版本','判定证据','冻结方案 JSON'].map(header=>({header,width:header.includes('JSON')?80:header==='判定证据'?100:28})),rows:results.map(result=>{const {record:r,round}=result,cell=screeningCell([result]);return [r.sample.source.symbol,formatUTC8(r.sample.source.timeMs),cell.plan,cell.status,r.matchedAt?formatUTC8(r.matchedAt):null,r.exclusionProcess?entryProcessText(r.exclusionProcess):(r.detail??'历史记录未保存完整排除过程'),r.exclusionProcess?JSON.stringify(r.exclusionProcess):null,formatUTC8(Math.min(r.cursor,r.endTime??r.cursor)),round.engine??'pre-entry-close-v1',cell.detail,JSON.stringify(round.plans??round.filters)];})};
}
