import {recordEntryEvidence,recordEntryStop,recordEntryRestart,type EntryProcessReading} from './preEntryExclusionProcess';
import {createEntryLongDrawdownReader} from './preEntryLongDrawdown';
import {createVersionedEntryStallTurnReader} from './preEntryStallTurnRule';
import {preEntryWindowLoader} from './preEntryWindowLoader';
import type { PreEntryRun, PreEntryRecord } from './preEntryMonitor';
import type { FishReconstructionLoader } from './reconstruction';
import { qualityMetricPlan, type QualityProgress, qualityGroupId, qualityMembers } from './quality';
import { stricterAdditionThreshold } from './qualityAddition';
import { planVersionChanges } from './qualityPlanVersions';
import { withTuringInitialization } from './qualityInitialization';
import { createPreEntryMarketReader, expressionResult, type EntryConditionReading } from './preEntryMarketReader';
import { expressionConditions, validatePreEntryThreeStage, PRE_ENTRY_THREE_STAGE_VERSION, PRE_ENTRY_SIGNAL_GATE_VERSION, type EntryMarketCondition } from './preEntryThreeStage';
import { createPreEntryGuardReader, type EntryGuardEvent } from './preEntryGuardEvent';
import { createPreEntryGate, preEntryGuardWarmBars } from './preEntryGate';
import { emptyPreEntryConditions } from './preEntryConditions';
import { compileFishProgram, type FishProgram } from './algorithm';
import { minuteTransport } from './qualityIntrabar';
import { loadQualityScanChunk } from './qualityScanChunk';
import { FishError } from './shared';
import { screeningTimeSlice } from './screeningYield';
import { formatUTC8 } from '../timeFormat';
import { completeZeroTradeBar } from './qualityZeroTrade';
import { isTuringCupSymbol } from '../turingCupSymbol';
import { qualitySignalTime } from './qualityAdmissionTime';
import type { TradeSignal } from '../signalLibrary';
import type { ResearchBar } from '../deepRsa/window';

const M=60000;
export interface EntryStageResult { status:'pass'|'blocked'|'pending'; reason?:string }
export interface EntrySignalGateEvidence extends EntryStageResult {
  signalAt: number;
  at: number;
  readings: EntryProcessReading[];
}
type DetectorGroup = {
  config: { match: 'all' | 'any' };
  conditions: EntryMarketCondition[];
};

function decideNecessary(required: EntryMarketCondition[], detectorGroups: DetectorGroup[], readings: ReadonlyMap<string, EntryConditionReading>): EntryStageResult {
  const notMet = required.find(f => readings.get(f.id)?.met === false);
  const unknown = required.find(f => readings.get(f.id)?.met == null);
  let detectorBlocked: string | undefined, detectorPending: string | undefined;
  for (const group of detectorGroups) {
    if (!group.conditions.length) {
      detectorBlocked ??= '原信号没有所选探测算法，必要资格不满足';
      continue;
    }
    const values = group.conditions.map(f => readings.get(f.id)?.met);
    const passed = group.config.match === 'all' ? values.every(v => v === true) : values.some(v => v === true);
    if (!passed) {
      if (values.includes(undefined)) detectorPending ??= '等待原探测算法及其约束读数';
      else detectorBlocked ??= '原探测门槛提高条件未满足';
    }
  }
  if (notMet || detectorBlocked) return { status: 'blocked', reason: detectorBlocked ?? notMet!.label + ' 未满足' };
  if (unknown || detectorPending) return { status: 'pending', reason: detectorPending ?? readings.get(unknown!.id)?.pending };
  return { status: 'pass' };
}

function entryMinuteTransport(plans: FishProgram[]) {
  const price = compileFishProgram({id:'three-stage-minutes',name:'筛选分钟',short:'分钟',definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval:'1m'},{statistic:'结果',direction:'>',threshold:0,constraints:[]});
  const transport = minuteTransport(price);
  transport.usesTaker = plans.some(plan => plan.usesTaker);
  transport.compiled = {...transport.compiled, usesBtc: plans.some(plan => plan.compiled.usesBtc), usesAmounts: plans.some(plan => plan.compiled.usesAmounts)};
  return transport;
}

async function readSignalGate(row: TradeSignal, signalAt: number, required: EntryMarketCondition[], detectorGroups: DetectorGroup[],
  load: FishReconstructionLoader, signal: AbortSignal, availableStart: number | undefined, availableEnd: number): Promise<EntrySignalGateEvidence> {
  const at = Math.floor(signalAt / M) * M;
  const pending = (reason: string): EntrySignalGateEvidence => ({ signalAt, at, status: 'pending', reason, readings: [] });
  if (!(at > 0) || at > availableEnd) return pending('缺少信号时点的已收盘分钟');
  const conditions = [...required, ...detectorGroups.flatMap(group => group.conditions)];
  if (!conditions.length) return { signalAt, at, ...decideNecessary(required, detectorGroups, new Map()), readings: [] };
  if (availableStart != null && !load.turingInitialization && conditions.some(condition => {
    const { plan } = qualityMetricPlan(condition.snapshot, condition.metric);
    return Math.floor(at / plan.step) * plan.step - plan.warm * plan.step < availableStart;
  })) return pending('信号时点行情不足以完成必要条件预热');

  const readers = await Promise.all(conditions.map(condition => createPreEntryMarketReader({
    condition, row, since: at, origin: availableStart ?? 0, load, signal,
  })));
  const transport = entryMinuteTransport(readers.map(reader => reader.plan));
  const from = Math.min(at - M, ...readers.filter(reader => reader.condition.timing === 'intrabar').map(reader => reader.start));
  let minute: ResearchBar | undefined;
  for (let cursor = from; cursor < at;) {
    const chunk = await loadQualityScanChunk(load, row, cursor, cursor, Math.min(at, cursor + 500 * M), transport, signal);
    for (const bar of chunk.bars) {
      for (const reader of readers) reader.push(bar);
      minute = bar;
    }
    cursor = chunk.cut;
  }
  if (!minute) return pending('缺少信号时点的已收盘分钟');
  const readings = readers.map(({ condition, read }) => ({
    ...read(at, minute!), label: condition.label, threshold: condition.threshold, direction: condition.direction,
  }));
  return { signalAt, at, ...decideNecessary(required, detectorGroups, new Map(readings.map(reading => [reading.id, reading]))), readings };
}
/**
 * v5 记录：first＝必要条件+加仓否决，second＝卖出/硬终止，third＝防守线新事件。
 * v6 重排后：zero＝必要条件，first＝防守线新事件，second＝排除段（加仓否决+卖出+硬终止），third 不再写入。
 * 两种记录都读同一结构，展示层按版本的 `zero` 是否存在区分。
 */
export interface EntryStageEvidence {
  attempt?:{index:number;startedAt:number};
  admission?:{join:'any';met:string[]};
  at:number; zero?:EntryStageResult; first:EntryStageResult; second:EntryStageResult; third?:EntryStageResult;
  state:'waiting-data'|'zero-blocked'|'first-blocked'|'second-blocked'|'waiting-guard'|'matched';
  event?:EntryGuardEvent; line?:number; regime?:string;
  readings:EntryConditionReading[];
}
/** v6：⓪ 必要条件 → ① 防守线新事件 → ② 排除段。三者仍在同一分钟同时求值，只改记录与展示的优先级。 */
export function decideThreeStageV6(at:number,zero:EntryStageResult,second:EntryStageResult,guard:{event?:EntryGuardEvent;line?:number;regime?:string},waiting=false):EntryStageEvidence {
  const first:EntryStageResult=guard.event?{status:'pass'}:{status:'pending',reason:'等待新的原生防守线事件'};
  const state:EntryStageEvidence['state']=waiting?'waiting-data':zero.status==='blocked'?'zero-blocked':zero.status==='pending'?'waiting-data':second.status==='blocked'?'second-blocked':second.status==='pending'?'waiting-data':guard.event?'matched':'waiting-guard';
  return {at,zero,first,second,state,...guard,readings:[]};
}
export function decideThreeStage(at:number,first:EntryStageResult,second:EntryStageResult,guard:{event?:EntryGuardEvent;line?:number;regime?:string},waiting=false):EntryStageEvidence {
  const third:EntryStageResult=guard.event?{status:'pass'}:{status:'pending',reason:'等待新的原生防守线事件'};
  const state=waiting?'waiting-data':first.status==='blocked'?'first-blocked':first.status==='pending'?'waiting-data':second.status==='blocked'?'second-blocked':second.status==='pending'?'waiting-data':guard.event?'matched':'waiting-guard';
  return {at,first,second,third,state,...guard,readings:[]};
}
export function decideThreeStageV7(at:number,zero:EntryStageResult,second:EntryStageResult,guard:{event?:EntryGuardEvent;line?:number;regime?:string},met:string[],waiting=false):EntryStageEvidence {
 const first:EntryStageResult=met.length?{status:'pass',reason:'准入满足：'+met.join('、')}:{status:'pending',reason:'等待任一准入算法满足'};
 const state:EntryStageEvidence['state']=waiting?'waiting-data':zero.status==='blocked'?'zero-blocked':zero.status==='pending'?'waiting-data':second.status==='blocked'?'second-blocked':second.status==='pending'?'waiting-data':met.length?'matched':'waiting-guard';
 return {at,zero,first,second,state,...guard,readings:[],admission:{join:'any',met}};
}
export const entryStageText=(e:EntryStageEvidence)=>e.state==='matched'?'三阶同刻通过，已进入入选库'+(e.admission?'；准入：'+e.admission.met.join('、'):''):e.state==='zero-blocked'?'⓪ 必要条件排除：'+e.zero?.reason:e.state==='first-blocked'?(e.zero?'① 防守线排除：'+e.first.reason:'一阶排除：'+e.first.reason):e.state==='second-blocked'?(e.zero?'② 排除门槛：':'二阶排除：')+e.second.reason:e.state==='waiting-data'?'等待数据：'+(e.zero?.status==='pending'?e.zero.reason:e.first.status==='pending'?e.first.reason:e.second.status==='pending'?e.second.reason:'零成交读数恢复中'):e.admission?'等待任一准入算法满足':'等待新防守线';

export async function collectPreEntryThreeStage(task:PreEntryRun,baseLoad:FishReconstructionLoader,now:number,signal:AbortSignal,onProgress:(p:QualityProgress)=>void,
  bounds?:{start?:(symbol:string)=>Promise<number|undefined>;end?:(symbol:string)=>Promise<number>}) {
  let done=0;
  const timeSlice=screeningTimeSlice(signal);
  for(const original of task.records){
    const pause=timeSlice();if(pause)await pause;
    if(signal.aborted)throw new DOMException('已暂停','AbortError');
    if(['matched','unmatched','warming'].includes(original.status)){onProgress({done:++done,total:task.records.length,current:original.sample.source.symbol});continue;}
    let record={...original,exclusionProcess:original.exclusionProcess??{version:1 as const,startedAt:original.cursor,...(original.cursor>original.startTime?{partialBefore:original.cursor}:{}),entries:[]}};
    const publish=(patch:Partial<PreEntryRecord>)=>{
      record={...record,...patch,updatedAt:Date.now()};
      if(patch.status&&patch.status!=='scanning'&&patch.status!=='queued')record={...record,exclusionProcess:recordEntryStop(record.exclusionProcess!,patch.status,patch.matchedAt??record.cursor,patch.detail??'筛选状态变化')};
      task.onRecord(record);
    };
    try{
      if(!Number.isFinite(task.round.hours)||task.round.hours<0||task.round.hours>8784)throw Error('筛选时长无效');
      if(!(record.startTime>0)||!Number.isFinite(record.cursor))throw Error('缺少有效筛选起点');
      const selected=task.round.plans?.find(p=>p.id===record.planId);
      if(!selected)throw Error('缺少本轮冻结的三阶筛选方案');
      if(planVersionChanges(selected).length)throw Error('三阶方案的冻结版本或参数已变化，请保留本轮');
      const config=selected.preEntryThreeStage;validatePreEntryThreeStage(config);
      // 已存 v5 方案继续按 v5 顺序产出证据；新方案走 v6（⓪ 必要条件 → ① 防守线 → ② 排除段）。
      const retry=config.observationBasis==='retry-origin-v2';
      const signalGate=config.version===PRE_ENTRY_SIGNAL_GATE_VERSION;
      if((retry || task.round.engine===PRE_ENTRY_SIGNAL_GATE_VERSION || task.round.engine==='pre-entry-three-stage-v7') && config.version!==task.round.engine)throw Error('重筛轮次与冻结方案版本不符，不能混用');
      if(retry&&task.round.hours<=0)throw Error('否决重筛须设置有限总时限');
      const v6=config.version===PRE_ENTRY_THREE_STAGE_VERSION||retry;
      const row={...record.sample.source,timeMs:now},start=await bounds?.start?.(row.symbol),availableEnd=await bounds?.end?.(row.symbol)??now;
      const initializedLoad=selected.initialization?withTuringInitialization(baseLoad,row.symbol,start??NaN):baseLoad;
      const end=record.endTime??Math.floor(Math.min(now,availableEnd,task.round.hours?record.startTime+task.round.hours*3600000:Infinity)/M)*M;
      const load=v6&&task.round.hours>0?preEntryWindowLoader(initializedLoad,end):initializedLoad;
      const hardIndicators:EntryMarketCondition[]=config.hardVetoes.filter(v=>v.enabled&&v.kind==='indicator').map(v=>({id:'hard:'+v.id,label:v.label,metric:v.metric!,snapshot:v.snapshot!,enabled:true,direction:v.direction,threshold:v.threshold,timing:'intrabar'}));
      const required=config.required.filter(f=>f.enabled),sellers=config.sellRules.filter(r=>r.enabled);
      const originals=Object.values(record.sample.readings??Object.fromEntries(qualityMembers(record.sample.source).map(f=>[qualityGroupId(f),f])));
      const detectorGroups=(config.detectors??[]).map(d=>({config:d,conditions:originals.filter(f=>!d.featureId||f.featureId===d.featureId).map((f,i):EntryMarketCondition=>{
        const direction=f.direction??'>';
        return {id:d.id+':'+i,label:(f.featureShort??f.featureName??'原探测算法')+' 探测值',metric:'capture',snapshot:f,enabled:true,direction,threshold:d.stricterPct===0?f.threshold:stricterAdditionThreshold(f.threshold,direction,d.stricterPct),timing:'closed',originalDetector:{constraints:f.constraints??[]}};
      })}));
      if (signalGate && (required.length || detectorGroups.length)) {
        const gate = record.signalGate ?? await readSignalGate(row, qualitySignalTime(record.sample.source), required, detectorGroups, initializedLoad, signal, start, Math.min(now, availableEnd));
        record = { ...record, signalGate: gate };
        if (gate.status !== 'pass') {
          publish({ status: gate.status === 'blocked' ? 'unmatched' : 'warming', endTime: end,
            detail: '⓪ 信号时点必要条件：' + (gate.reason ?? '读数不可用') });
          continue;
        }
      }
      const admissionAlgorithms=retry?config.admission!.algorithms.filter(c=>c.enabled):[],admissionIds=new Set(admissionAlgorithms.map(c=>c.id));
      const conditions=[...(signalGate?[]:[...required,...detectorGroups.flatMap(g=>g.conditions)]),...sellers.flatMap(r=>expressionConditions(r.expression).filter(c=>c.enabled)),...hardIndicators,...admissionAlgorithms];
      const warmPlans=conditions.map(c=>({c,...qualityMetricPlan(c.snapshot,c.metric)}));
      const firstConfig={...emptyPreEntryConditions(),entryVetoes:config.additionVetoes};
      const secondConfig={...emptyPreEntryConditions(),hardVetoes:config.hardVetoes.filter(v=>v.kind!=='indicator')};
      const readyAt=start==null||selected.initialization?record.startTime:Math.max(record.startTime,
        ...warmPlans.filter(({c})=>!retry||!admissionIds.has(c.id)).map(({plan})=>Math.ceil(start/plan.step)*plan.step+plan.warm*plan.step),
        ...(preEntryGuardWarmBars(firstConfig)?[Math.ceil(start/300000)*300000+preEntryGuardWarmBars(firstConfig)*300000]:[]));
      publish({status:'scanning',endTime:end});
      if(readyAt>end){publish({status:'warming',detail:'行情不足以完成三阶条件预热，未判定入选'});continue;}
      const readers=await Promise.all(conditions.map(async condition=>{
        const plan=warmPlans.find(p=>p.c===condition)!.plan;
        const available=retry&&admissionIds.has(condition.id)&&start!=null&&!selected.initialization?Math.max(readyAt,Math.ceil(start/plan.step)*plan.step+plan.warm*plan.step):readyAt;
        if(available<=readyAt)return {...await createPreEntryMarketReader({condition,row,since:readyAt,origin:record.startTime,load,signal}),prepare:undefined};
        // One slow OR branch must not postpone a ready guard/other algorithm.
        // Construct its reader only when the required history is in the past.
        let active:Awaited<ReturnType<typeof createPreEntryMarketReader>>|undefined,origin=record.startTime;
        return {condition,plan,start:available,async prepare(at:number){if(!active&&at>=available)active=await createPreEntryMarketReader({condition,row,since:available,origin,load,signal});},push(minute:Parameters<NonNullable<typeof active>['push']>[0]){active?.push(minute);},read(at:number,minute:Parameters<NonNullable<typeof active>['read']>[1]):EntryConditionReading{return active?.read(at,minute)??{id:condition.id,at,pending:'等待准入算法预热'};},trim(){active?.trim();},resetObservationOrigin(at:number){origin=at;active?.resetObservationOrigin(at);}};
      }));
      const firstGate=createPreEntryGate({conditions:firstConfig,start:record.startTime,row,load,signal});
      const secondGate=createPreEntryGate({conditions:secondConfig,start:record.startTime,row,load,signal,latchHardStops:signalGate});
      const guardReader:(at:number)=>Promise<{event?:EntryGuardEvent;line?:number;regime?:string}>=!retry||config.admission!.guardEnabled?createPreEntryGuardReader({config,row,start:record.startTime,load,signal}):async()=>({});
      const confirmations=new Map<string,{count:number;lastAt?:number}>();
      const activeAdmissions = new Set<string>();
      let pastMarketExclusion: { at: number; reason: string } | undefined;
      const longDrawdown=retry&&config.longDrawdown?.enabled?createEntryLongDrawdownReader({condition:config.longDrawdown,row,load,signal,availableStart:start}):undefined;
      // Independent history and recovery lock survive observation retries.
      const stallTurn=config.stallTurn?.enabled?createVersionedEntryStallTurnReader({condition:config.stallTurn,row,load,signal,availableStart:start}):undefined;
      let attempt=1,observationStart=record.startTime;
      const resumeAt=original.cursor;
      let lastPaint=0,matched=false;
      const transport=entryMinuteTransport(readers.map(r=>r.plan));
      const replayStart=Math.max(load.turingInitialization?.startMs??0,Math.min(Math.floor(readyAt/M)*M-M,...readers.map(r=>r.start)));
      for(let cursor=replayStart;cursor<end&&!matched;){
        let requestedCut=Math.min(end,cursor+500*M);
        let chunk:Awaited<ReturnType<typeof loadQualityScanChunk>>;
        for(;;){
          try{chunk=await loadQualityScanChunk(load,row,cursor,cursor,requestedCut,transport,signal);break;}
          catch(error){
            if(signal.aborted||!(error instanceof FishError)||error.kind!=='gap'||requestedCut-cursor<=M)throw error;
            // A future gap must not hide a valid earlier event on any market.
            requestedCut=cursor+Math.max(1,Math.floor((requestedCut-cursor)/M/2))*M;
          }
        }
        for(const minute of chunk.bars){
          // Resume replays used to bypass the paint/yield branch below. Yield
          // independently of publishing, including warmup and already-saved time.
          const pause=timeSlice();if(pause)await pause;
          if(signal.aborted)throw new DOMException('已暂停','AbortError');
          const at=minute.openTime+M;
          if(retry)await Promise.all(readers.map(r=>r.prepare?.(at)));
          readers.forEach(r=>r.push(minute));
          if(at<readyAt||at<=record.startTime)continue;
          const guard = await guardReader(at);
          const readings = readers.map(r=>({...r.read(at,minute),label:r.condition.label}));
          const map = new Map(readings.map(r=>[r.id,r]));
          const zeroTrade = isTuringCupSymbol(row.symbol)&&completeZeroTradeBar(minute);
          const metAdmission = retry && (!signalGate || !zeroTrade) ? [
            ...(guard.event ? ['原生防守线新事件'] : []),
            ...admissionAlgorithms.filter(condition => {
              const met = map.get(condition.id)?.met;
              if (!signalGate) return met === true;
              if (met === false) activeAdmissions.delete(condition.id);
              if (met !== true || activeAdmissions.has(condition.id)) return false;
              activeAdmissions.add(condition.id);
              return true;
            }).map(condition => condition.label),
          ] : [];
          const candidate = !signalGate || metAdmission.length > 0;
          // v8 checks historical rules only at a candidate time. The readers
          // rebuild the intervening history through that minute's close.
          const firstGateResult = candidate ? await firstGate(at,minute) : {};
          const secondGateResult = candidate ? await secondGate(at,minute) : {};
          const longResult = candidate ? await longDrawdown?.(at,minute) : undefined;
          const stallResult = candidate ? await stallTurn?.(at,minute) : undefined;
          const observations=[...readings,...(longResult?.reading?[longResult.reading]:[]),...(stallResult?.readings??[])];
          const necessary:EntryStageResult=signalGate?{status:'pass'}:decideNecessary(required,detectorGroups,map);
          const first:EntryStageResult=firstGateResult.blocked?{status:'blocked',reason:firstGateResult.blocked}:necessary.status==='blocked'?necessary:firstGateResult.pending?{status:'pending',reason:firstGateResult.pending}:necessary;
          // v6 的 ⓪ 只留指标与探测门槛：加仓共用否决已挪进 ② 排除段，不能在这里提前判 block。
          const zero:EntryStageResult=v6?necessary:first;
          let sellerHit:string|undefined,sellerPending:string|undefined;
          for(const seller of sellers){
            const met=expressionResult(seller.expression,map),state=confirmations.get(seller.id)??{count:0};
            if(at%(seller.confirmation.minutes*M)===0&&state.lastAt!==at){state.count=met===true?state.count+1:0;state.lastAt=at;}
            confirmations.set(seller.id,state);
            if(met==null)sellerPending??='等待完整卖出读数：'+seller.label;
            if(met===true&&state.count>=seller.confirmation.samples)sellerHit??=seller.label+' 完整成立';
          }
          const hardHit=hardIndicators.find(f=>map.get(f.id)?.met===true),hardUnknown=hardIndicators.find(f=>map.get(f.id)?.met==null);
          // Conditions with no independent lookback use this observation's
          // elapsed minutes. Confirmations still advance even without a candidate.
          if (signalGate && !zeroTrade && (hardHit || sellerHit)) pastMarketExclusion ??= { at, reason: hardHit?.label ?? sellerHit! };
          const historicalHit = pastMarketExclusion && (pastMarketExclusion.at === at
            ? pastMarketExclusion.reason : `${pastMarketExclusion.reason} · 历史触发于 ${formatUTC8(pastMarketExclusion.at)}`);
          const second:EntryStageResult=!candidate?{status:'pass'}:secondGateResult.blocked||historicalHit||hardHit||sellerHit?{status:'blocked',reason:secondGateResult.blocked??historicalHit??hardHit?.label??sellerHit}:secondGateResult.pending||sellerPending||hardUnknown?{status:'pending',reason:secondGateResult.pending??sellerPending??map.get(hardUnknown!.id)?.pending}:{status:'pass'};
          // v6：加仓共用否决属于排除段，与卖出／硬终止并列。
          const gateBlocked=firstGateResult.blocked;
          const baseExclusion:EntryStageResult=v6&&gateBlocked?{status:'blocked',reason:gateBlocked}:second.status==='blocked'?second:second.status==='pending'||firstGateResult.pending?{status:'pending',reason:second.status==='pending'?second.reason:firstGateResult.pending}:{status:'pass'};
          const exclusion:EntryStageResult=stallResult?.blocked?{status:'blocked',reason:stallResult.blocked}:longResult?.blocked?{status:'blocked',reason:longResult.blocked}:baseExclusion.status==='blocked'?baseExclusion:stallResult?.pending?{status:'pending',reason:stallResult.pending}:longResult?.pending?{status:'pending',reason:longResult.pending}:baseExclusion;
          const waiting=zeroTrade||observations.some(r=>r.zeroTrade&&(admissionIds.has(r.id)?!metAdmission.length:candidate));
          const evidence={...(retry?decideThreeStageV7(at,zero,exclusion,guard,metAdmission,waiting):v6?decideThreeStageV6(at,zero,exclusion,guard,waiting):decideThreeStage(at,first,second,guard,waiting)),readings:observations,...(retry?{attempt:{index:attempt,startedAt:observationStart}}:{})};
          const restart=retry&&candidate&&!waiting&&at<end&&(zero.status==='blocked'||exclusion.status==='blocked');
          // Rebuild past attempt transitions even during resume replay. Native
          // guard history stays continuous: a rejected event can never reappear.
          if(restart){
            firstGate.restart(at);secondGate.restart(at);confirmations.clear();readers.forEach(r=>r.resetObservationOrigin(at));
            pastMarketExclusion = undefined;
            observationStart=at;attempt++;
          }
          // Replaying up to the persisted cursor restores locks and confirmation
          // counts; it cannot admit or duplicate a previously observed event.
          if(at<=resumeAt)continue;
          record={...record,cursor:at,threeStage:evidence,exclusionProcess:recordEntryEvidence(record.exclusionProcess!,{...evidence,readings:observations.map(r=>{const condition=conditions.find(c=>c.id===r.id);return {...r,...(admissionIds.has(r.id)?{role:'admission' as const}:{}),...(condition?{threshold:condition.threshold,direction:condition.direction}:{})};})}),readings:observations.filter(r=>r.value!=null).map(r=>({key:r.id,at:r.at,value:r.value!}))};
          if(waiting&&at>(record.zeroTradeWait?.lastAt??-Infinity))record.zeroTradeWait={count:(record.zeroTradeWait?.count??0)+1,firstAt:record.zeroTradeWait?.firstAt??at,lastAt:at};
          if(v6){if(evidence.state==='zero-blocked'||evidence.state==='first-blocked'||evidence.state==='second-blocked')record.lastVeto={at,reason:evidence.state==='zero-blocked'?evidence.zero!.reason!:evidence.state==='first-blocked'?evidence.first.reason!:evidence.second.reason!,count:(record.lastVeto?.count??0)+1};}
          else if(first.status==='blocked'||second.status==='blocked')record.lastVeto={at,reason:first.status==='blocked'?first.reason!:second.reason!,count:(record.lastVeto?.count??0)+1};
          if(guard.event&&evidence.state!=='matched')record.missedGuard={count:(record.missedGuard?.count??0)+1,event:guard.event,reason:entryStageText(evidence)};
          if(retry){
            record.retry={version:'retry-origin-v2',attempt,startedAt:observationStart};
            if(restart)record.exclusionProcess=recordEntryRestart(record.exclusionProcess!,at,attempt,end);
          }
          if(evidence.state==='matched'){
            publish({status:'matched',matchedAt:at,detail:signalGate?`新事件通过排除检查，已入选；准入：${metAdmission.join('、')}`:entryStageText(evidence)});matched=true;break;
          }
          if(performance.now()-lastPaint>=150){lastPaint=performance.now();publish({detail:entryStageText(evidence)+' · '+formatUTC8(at)});onProgress({done,total:task.records.length,current:row.symbol});}
        }
        if(matched)break;
        cursor=chunk.cut;readers.forEach(r=>r.trim());const pause=timeSlice();if(pause)await pause;
      }
      if(!matched)publish({status:'unmatched',cursor:end,detail:record.threeStage?entryStageText(record.threeStage)+(signalGate?'；本轮无通过排除检查的新事件':'；本轮未出现三阶同刻通过'):'本轮无可判断时点'});
    }catch(error){
      if(signal.aborted){publish({status:'paused',detail:'已暂停，继续时恢复本轮三阶条件和历史状态'});throw error;}
      publish({status:'error',detail:error instanceof Error?error.message:'三阶筛选失败'});
    }finally{onProgress({done:++done,total:task.records.length,current:record.sample.source.symbol});}
  }
}
