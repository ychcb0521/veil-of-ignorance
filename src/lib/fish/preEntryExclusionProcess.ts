import type {EntryStageEvidence} from './preEntryThreeStageScan';
import type {EntryConditionReading} from './preEntryMarketReader';
import type {EntryGuardEvent} from './preEntryGuardEvent';
import {formatUTC8} from '../timeFormat';
export type EntryProcessStage='necessary'|'guard'|'admission'|'exclusion'|'first'|'second'|'data';
export type EntryProcessReading=EntryConditionReading&{threshold?:number;direction?:string;role?:'admission'|'veto'};
export interface EntryProcessItem {
  kind:'observation'|'guard-rejected'|'matched'|'unmatched'|'warming'|'error'|'paused'|'restart';
  from:number;through:number;count:number;reason:string;lastReason?:string;
  stage?:EntryProcessStage;status?:'blocked'|'pending';endedAt?:number;nextStatus?:'pass'|'blocked'|'pending';
  readings?:EntryProcessReading[];lastReadings?:EntryProcessReading[];event?:EntryGuardEvent;
}
export interface EntryExclusionProcess {version:1;startedAt:number;partialBefore?:number;entries:EntryProcessItem[]}
export function recordEntryRestart(process:EntryExclusionProcess,at:number,attempt:number,end:number):EntryExclusionProcess {
 const entries=process.entries.map(e=>e.kind==='observation'&&!e.endedAt?{...e,endedAt:at,nextStatus:'pending' as const}:e);
 return {...process,entries:[...entries,{kind:'restart',from:at,through:at,count:1,reason:`第 ${attempt} 次观察：重建起点 ${formatUTC8(at)}，首个新分钟结束后重新判断；原总截止时间 ${formatUTC8(end)} 不变。`}]};
}
export const entryProcessStageLabels:Record<EntryProcessStage,string>={necessary:'⓪ 必要条件',guard:'防守线新事件',admission:'① 并列准入（或）',exclusion:'② 排除门槛',first:'一阶门槛',second:'二阶门槛',data:'数据等待'};
export const entryGuardKindLabels={first:'首次产生',rebuild:'断裂后重建',raise:'价格上移',lower:'价格下移','type-change':'实虚切换'} as const;
const ruleKey=(reason:string)=>reason.split('：')[0];
export function recordEntryEvidence(process:EntryExclusionProcess,e:EntryStageEvidence):EntryExclusionProcess {
  const entries=[...process.entries];
  const stages=e.zero?[['necessary',e.zero],[e.admission?'admission':'guard',e.first],['exclusion',e.second]] as const:[['first',e.first],['second',e.second],['guard',e.third??{status:'pending' as const,reason:'等待新的原生防守线事件'}]] as const;
  const observed=[...stages,...(e.state==='waiting-data'&&!stages.some(([,s])=>s.status==='pending')?[['data',{status:'pending',reason:'等待零成交分钟后的有效读数'}] as const]:[])];
  for(const [stage,state]of observed){
    let index=-1;for(let i=entries.length-1;i>=0;i--)if(entries[i].kind==='observation'&&entries[i].stage===stage){index=i;break;}
    const previous=entries[index],consecutive=previous?.through===e.at-60000&&!previous.endedAt,reason=state.reason??'条件尚未通过';
    if(state.status==='pass'){
      if(consecutive)entries[index]={...previous,endedAt:e.at,nextStatus:'pass'};
      continue;
    }
    const readings=e.readings.map(r=>({...r}));
    if(consecutive&&previous.status===state.status&&ruleKey(previous.reason)===ruleKey(reason)){
      entries[index]={...previous,through:e.at,count:previous.count+1,lastReason:reason,lastReadings:readings};
    }else{
      if(consecutive)entries[index]={...previous,endedAt:e.at,nextStatus:state.status};
      entries.push({kind:'observation',stage,status:state.status,from:e.at,through:e.at,count:1,reason,readings});
    }
  }
  if(e.event&&e.state!=='matched')entries.push({kind:'guard-rejected',from:e.at,through:e.at,count:1,reason:stages.filter(([,s])=>s.status!=='pass').map(([stage,s])=>entryProcessStageLabels[stage]+'：'+(s.reason??'未通过')).join('；')||'本分钟数据未就绪，未准入',event:structuredClone(e.event),readings:e.readings.map(r=>({...r}))});
  return {...process,entries};
}
export function recordEntryStop(process:EntryExclusionProcess,kind:Exclude<EntryProcessItem['kind'],'observation'|'guard-rejected'>,at:number,reason:string):EntryExclusionProcess {
  const last=process.entries.at(-1);if(last?.kind===kind&&last.from===at&&last.reason===reason)return process;
  return {...process,entries:[...process.entries,{kind,from:at,through:at,count:1,reason}]};
}
export function entryProcessText(process:EntryExclusionProcess):string {
  return process.entries.map(e=>`${formatUTC8(e.from)}${e.through!==e.from?' ～ '+formatUTC8(e.through):''} · ${e.stage?entryProcessStageLabels[e.stage]+' · ':''}${e.reason}${e.lastReason&&e.lastReason!==e.reason?' → '+e.lastReason:''}${e.endedAt?'；'+formatUTC8(e.endedAt)+(e.nextStatus==='pass'?' 解除':' 原因切换'):''}${e.event?'；防守线 '+e.event.price+'（'+entryGuardKindLabels[e.event.kind]+'）':''}`).join('\n');
}
