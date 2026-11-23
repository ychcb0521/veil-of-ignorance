import type {QualityHoldingVeto} from './qualityVeto';
import type {QualityMirrorFill} from './qualityMirror';
import type {QualityAdditionFill,QualityReductionFill} from './qualityAddition';
import {mirrorCompletedBy,MIRROR_DEADLINE_KIND,MIRROR_DEADLINE_VERSION} from './qualityMirrorDeadline';
import {replayQualityHoldingLedger} from './qualityHoldingLedger';

export const MIRROR_LOSS_REVIEW_KIND='mirror-loss-review' as const;
export const MIRROR_LOSS_REVIEW_VERSION='holding-mirror-loss-review-v2' as const;
export const MIRROR_LOSS_THRESHOLD_VERSION='holding-mirror-loss-threshold-v3' as const;
export const MIRROR_REVIEW_SCHEDULE_VERSION='holding-mirror-review-schedule-v4' as const;
export interface MirrorLossThreshold {version:typeof MIRROR_LOSS_THRESHOLD_VERSION;unit:'percent'|'usdt';value:number}
export const MIRROR_REVIEW_ONCE_VERSION='holding-mirror-review-once-v5' as const;
export type MirrorReviewSchedule =
 | {version:typeof MIRROR_REVIEW_SCHEDULE_VERSION;intervalHours:number;endHours:12}
 | {version:typeof MIRROR_REVIEW_ONCE_VERSION;intervalHours:null;endHours:12};
export type MirrorLossReviewVersion=typeof MIRROR_LOSS_REVIEW_VERSION|typeof MIRROR_LOSS_THRESHOLD_VERSION|typeof MIRROR_REVIEW_SCHEDULE_VERSION|typeof MIRROR_REVIEW_ONCE_VERSION;
export function validateMirrorLossThreshold(rule:{mirrorDeadlineVersion?:string;mirrorLossThreshold?:MirrorLossThreshold;mirrorReviewSchedule?:MirrorReviewSchedule}){
 const value=rule.mirrorLossThreshold;
 const schedule=rule.mirrorReviewSchedule;
 if(rule.mirrorDeadlineVersion===MIRROR_LOSS_REVIEW_VERSION){if(value!==undefined||schedule!==undefined)throw Error('原版定时检查不能自动套用新版亏损门槛或间隔，请新建副本');return;}
 if(rule.mirrorDeadlineVersion===MIRROR_REVIEW_ONCE_VERSION){
  if(schedule?.version!==MIRROR_REVIEW_ONCE_VERSION||schedule.intervalHours!==null||schedule.endHours!==12)throw Error('单次检查的参数与版本不符');
 }else if(rule.mirrorDeadlineVersion===MIRROR_REVIEW_SCHEDULE_VERSION){
  if(!schedule||schedule.version!==MIRROR_REVIEW_SCHEDULE_VERSION||!Number.isFinite(schedule.intervalHours)||schedule.intervalHours<1/60||schedule.intervalHours>12||schedule.endHours!==12)throw Error('判断间隔须为 1 分钟至 12 小时，并保留原检查截止时间和执行版本');
 }else if(schedule!==undefined)throw Error('原版固定判断间隔不能自动转换，请新建副本');
 if(![MIRROR_LOSS_THRESHOLD_VERSION,MIRROR_REVIEW_SCHEDULE_VERSION,MIRROR_REVIEW_ONCE_VERSION].some(v=>v===rule.mirrorDeadlineVersion)||!value||value.version!==MIRROR_LOSS_THRESHOLD_VERSION
  ||!['percent','usdt'].includes(value.unit)||!Number.isFinite(value.value)||value.value<0)throw Error('亏损门槛须使用保留版本，并填写大于或等于 0 的有限数字及有效单位');
}
export const MIRROR_LOSS_REVIEW_LABEL='未镜像且亏损定时终止';
export const MIRROR_LOSS_REVIEW_INTERVAL_HOURS=.5;
export const MIRROR_LOSS_REVIEW_END_HOURS=12;
export const isMirrorClockExit=(cause?:{kind:string;mirrorDeadlineVersion?:string})=>
 cause?.kind===MIRROR_DEADLINE_KIND&&cause.mirrorDeadlineVersion===MIRROR_DEADLINE_VERSION
 ||cause?.kind===MIRROR_LOSS_REVIEW_KIND&&(cause.mirrorDeadlineVersion===MIRROR_LOSS_REVIEW_VERSION||cause.mirrorDeadlineVersion===MIRROR_LOSS_THRESHOLD_VERSION||cause.mirrorDeadlineVersion===MIRROR_REVIEW_SCHEDULE_VERSION||cause.mirrorDeadlineVersion===MIRROR_REVIEW_ONCE_VERSION);
export interface MirrorLossReviewCheck {
 at:number;price:number;pnl:number;quantity:number;cost:number;realizedPnl:number;
 decision:'continue'|'close';
 pnlPct?:number;totalInvested?:number;lossThreshold?:MirrorLossThreshold;
}
export interface MirrorLossReviewState {
 version:MirrorLossReviewVersion;entry:number;through:number;checks:MirrorLossReviewCheck[];
 finished?:'mirror-completed'|'window-ended';
}
export type MirrorLossReviewStates=Record<string,MirrorLossReviewState>;
export function mirrorLossReviewPoints(entry:number,firstHours:number,intervalHours:number|null=MIRROR_LOSS_REVIEW_INTERVAL_HOURS):number[]{
 if(!Number.isFinite(entry)||!Number.isFinite(firstHours)||firstHours<1/60||firstHours>12||(intervalHours!==null&&(!Number.isFinite(intervalHours)||intervalHours<1/60||intervalHours>12)))throw Error('定时亏损检查的起点、首次时长或判断间隔无效');
 if(intervalHours===null)return [Math.ceil((entry+firstHours*3_600_000)/60_000)*60_000];
 const count=Math.floor((MIRROR_LOSS_REVIEW_END_HOURS-firstHours)/intervalHours+1e-10);
 return Array.from({length:Math.max(0,count+1)},(_,i)=>Math.ceil((entry+(firstHours+i*intervalHours)*3_600_000)/60_000)*60_000);
}
export const mirrorLossReviewSummary=(hours:number,loss?:MirrorLossThreshold,schedule?:MirrorReviewSchedule)=>`${schedule?.intervalHours===null?`持仓 ${hours} 小时后只检查一次`:`首次 ${hours} 小时，此后每 ${schedule?.intervalHours??.5} 小时检查至 12 小时`}；未镜像且${loss&&loss.value>0?`亏损达到 ${loss.value}${loss.unit==='percent'?'%':' USDT'}`:'整笔账面盈亏 < 0'} 时市价清仓，盈利或持平继续观察`;
export async function reviewMirrorLoss(o:{
 rules:readonly QualityHoldingVeto[];entry:number;end:number;entryPrice:number;notional:number;
 additions:readonly QualityAdditionFill[];reductions?:readonly QualityReductionFill[];mirror?:QualityMirrorFill;
 actual?:boolean;observeFrom?:number;previous?:MirrorLossReviewStates;readPrice:(at:number)=>Promise<number>;
}):Promise<{states:MirrorLossReviewStates;stop?:{rule:QualityHoldingVeto;check:MirrorLossReviewCheck}}>{
 const states:MirrorLossReviewStates=structuredClone(o.previous??{});
 const rules=o.rules.filter(v=>v.enabled&&v.kind===MIRROR_LOSS_REVIEW_KIND);
 const events:{rule:QualityHoldingVeto;at:number;last:number}[]=[];
 for(const rule of rules){
  if(!(rule.threshold>=1/60&&rule.threshold<=12))throw Error('定时亏损终止的版本或首次检查时间不可用，请保留原方案');
  validateMirrorLossThreshold(rule);
  const version=rule.mirrorDeadlineVersion as MirrorLossReviewVersion;
  const saved=states[rule.id];
  if(saved&&(saved.version!==version||saved.entry!==o.entry))throw Error('定时亏损检查记录的版本或建仓时点不符，不能重写历史检查');
  const from=Math.max(o.entry,o.observeFrom??o.entry);
  if(!Number.isFinite(from))throw Error('实际持仓的定时检查启动时间无效');
  const state=states[rule.id]??={version,entry:o.entry,through:Math.max(o.entry,from-1),checks:[]};
  // Live reconciliation already proves a completed mirror. Do not backfill a
  // missed historical liquidation after that actual execution has settled.
  if(o.actual&&mirrorCompletedBy(o.mirror,o.entry,o.end)){state.finished='mirror-completed';continue;}
  if(state.finished)continue;
  const points=mirrorLossReviewPoints(o.entry,rule.threshold,rule.mirrorReviewSchedule?.intervalHours),last=points.at(-1)!;
  if(from>last){state.finished='window-ended';continue;}
  for(const at of points)if(at>=from&&at>state.through&&at<=o.end)events.push({rule,at,last});
 }
 events.sort((a,b)=>a.at-b.at||a.rule.id.localeCompare(b.rule.id));
 const prices=new Map<number,number>();
 for(const {rule,at,last} of events){
  const state=states[rule.id];if(state.finished)continue;
  if(mirrorCompletedBy(o.mirror,o.entry,at)){state.finished='mirror-completed';state.through=at;continue;}
  let price=prices.get(at);if(price==null){price=await o.readPrice(at);prices.set(at,price);}
  if(!Number.isFinite(price)||!(price>0))throw Error('检查时点缺少有效行情，不能把盈亏缺失当作盈利或亏损');
  // Opening decisions cannot borrow fills from the minute that is just starting.
  const additions=o.additions.map(f=>({...f,at:f.executedAt??f.at})).filter(f=>f.at<at);
  const reductions=o.reductions?.map(f=>({...f,at:f.executedAt??f.at})).filter(f=>f.at<at);
  const ledger=replayQualityHoldingLedger({notional:o.notional,entryPrice:o.entryPrice,entryAt:o.entry,additions,reductions,through:at,details:false});
  const pnl=ledger.realized+ledger.held*price-ledger.cost;
  if(!Number.isFinite(pnl))throw Error('检查时点的盈亏超出可计算范围');
  const tolerance=64*Number.EPSILON*Math.max(1,o.notional,ledger.cost,Math.abs(ledger.realized),ledger.held*price);
  const loss=rule.mirrorLossThreshold;
  const target=loss?loss.unit==='usdt'?loss.value:ledger.totalInvested*loss.value/100:0;
  if(!Number.isFinite(target))throw Error('亏损门槛超出可计算范围');
  const met=pnl < -tolerance&&(-pnl>=target||Math.abs(-pnl-target)<=tolerance);
  const check:MirrorLossReviewCheck={at,price,pnl,quantity:ledger.held,cost:ledger.cost,realizedPnl:ledger.realized,decision:met?'close':'continue',
   ...(loss?{pnlPct:pnl/ledger.totalInvested*100,totalInvested:ledger.totalInvested,lossThreshold:structuredClone(loss)}:{})};
  state.checks.push(check);state.through=at;
  if(check.decision==='close')return {states,stop:{rule,check}};
  if(at===last)state.finished='window-ended';
 }
 return {states};
}
