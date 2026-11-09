import type { PreEntryRecord, PreEntryRound } from './preEntryMonitor';
import type { EntryExclusionProcess, EntryProcessItem } from './preEntryExclusionProcess';
import type { FishReconstructionLoader } from './reconstruction';
import type { FishProgram } from './algorithm';
import type { TradeSignal } from '../signalLibrary';
import type { ResearchBar } from '../deepRsa/window';
import type { QualityProgress } from './quality';
import { FishError } from './shared';

export interface ScreeningError {message:string;name:string;kind?:FishError['kind'];detail?:FishError['detail']}
export const screeningError = (e:unknown):ScreeningError => ({message:e instanceof Error||e instanceof DOMException?e.message:String(e),name:e instanceof Error||e instanceof DOMException?e.name:'Error',...(e instanceof FishError?{kind:e.kind,detail:e.detail}:{})});
export const restoreScreeningError = (e:ScreeningError):Error => e.kind?new FishError(e.message,e.kind,e.detail):Object.assign(new Error(e.message),{name:e.name});
export interface ScreeningRecordDelta {
  record: Omit<PreEntryRecord,'exclusionProcess'>;
  process?: {meta:Omit<EntryExclusionProcess,'entries'>;baseLength:number;length:number;updates:[number,EntryProcessItem][]};
}
/** Full audit stays identical, but only changed/appended entries cross the worker boundary. */
export function screeningRecordDelta(previous:PreEntryRecord|undefined,next:PreEntryRecord):ScreeningRecordDelta {
  const {exclusionProcess,...record}=next;
  if(!exclusionProcess)return {record};
  const {entries,...meta}=exclusionProcess,old=previous?.exclusionProcess?.entries??[];
  const updates:[number,EntryProcessItem][]=[];
  entries.forEach((entry,i)=>{if(entry!==old[i])updates.push([i,entry]);});
  return {record,process:{meta,baseLength:old.length,length:entries.length,updates}};
}
export function applyScreeningRecordDelta(previous:PreEntryRecord|undefined,delta:ScreeningRecordDelta):PreEntryRecord {
  if(!delta.process)return delta.record;
  const {meta,baseLength,length,updates}=delta.process,old=previous?.exclusionProcess?.entries??[];
  if(old.length!==baseLength)throw Error('筛选历史增量次序不一致，已停止以保留原记录');
  const entries=old.slice(0,length);entries.length=length;
  for(const [i,entry]of updates){if(i<0||i>=length||!Number.isInteger(i))throw Error('筛选历史增量无效');entries[i]=entry;}
  for(let i=0;i<length;i++)if(!entries[i])throw Error('筛选历史增量缺失');
  return {...delta.record,exclusionProcess:{...meta,entries}};
}
export type ScreeningRequest = {type:'request';id:number} & (
  {method:'load';row:TradeSignal;from:number;cut:number;plan:FishProgram} | {method:'start'|'end';symbol:string}
);
export type ScreeningWorkerInput =
  | {type:'start';round:PreEntryRound;records:PreEntryRecord[];now:number;initialization?:FishReconstructionLoader['turingInitialization'];bounds:{start:boolean;end:boolean}}
  | {type:'response';id:number;value?:readonly ResearchBar[]|number;error?:ScreeningError}
  | {type:'ack';seq:number}
  | {type:'abort'};
export type ScreeningWorkerOutput = ScreeningRequest | {type:'record';seq:number;delta:ScreeningRecordDelta} | {type:'progress';value:QualityProgress} | {type:'done';error?:ScreeningError};
