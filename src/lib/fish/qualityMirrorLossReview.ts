import type {QualityHoldingVeto} from './qualityVeto';
import type {QualityMirrorFill} from './qualityMirror';
import type {QualityAdditionFill,QualityReductionFill} from './qualityAddition';
import {mirrorCompletedBy,MIRROR_DEADLINE_KIND,MIRROR_DEADLINE_VERSION} from './qualityMirrorDeadline';
import {replayQualityHoldingLedger} from './qualityHoldingLedger';

export const MIRROR_LOSS_REVIEW_KIND='mirror-loss-review' as const;
export const MIRROR_LOSS_REVIEW_VERSION='holding-mirror-loss-review-v2' as const;
export const MIRROR_LOSS_REVIEW_LABEL='未镜像且亏损定时终止';
export const MIRROR_LOSS_REVIEW_INTERVAL_HOURS=.5;
export const MIRROR_LOSS_REVIEW_END_HOURS=12;
export const isMirrorClockExit=(cause?:{kind:string;mirrorDeadlineVersion?:string})=>
 cause?.kind===MIRROR_DEADLINE_KIND&&cause.mirrorDeadlineVersion===MIRROR_DEADLINE_VERSION
 ||cause?.kind===MIRROR_LOSS_REVIEW_KIND&&cause.mirrorDeadlineVersion===MIRROR_LOSS_REVIEW_VERSION;
export interface MirrorLossReviewCheck {
 at:number;price:number;pnl:number;quantity:number;cost:number;realizedPnl:number;
 decision:'continue'|'close';
}
export interface MirrorLossReviewState {
 version:typeof MIRROR_LOSS_REVIEW_VERSION;entry:number;through:number;checks:MirrorLossReviewCheck[];
 finished?:'mirror-completed'|'window-ended';
}
export type MirrorLossReviewStates=Record<string,MirrorLossReviewState>;
export function mirrorLossReviewPoints(entry:number,firstHours:number):number[]{
 if(!Number.isFinite(entry)||!Number.isFinite(firstHours)||firstHours<1/60||firstHours>12)throw Error('定时亏损检查的起点或首次时长无效');
 const count=Math.floor((MIRROR_LOSS_REVIEW_END_HOURS-firstHours)/MIRROR_LOSS_REVIEW_INTERVAL_HOURS+1e-10);
 return Array.from({length:Math.max(0,count+1)},(_,i)=>Math.ceil((entry+(firstHours+i*MIRROR_LOSS_REVIEW_INTERVAL_HOURS)*3_600_000)/60_000)*60_000);
}
export const mirrorLossReviewSummary=(hours:number)=>`首次 ${hours} 小时，此后每 0.5 小时检查至 12 小时；未镜像且整笔账面盈亏 < 0 时市价清仓，盈利或持平继续观察`;
export async function reviewMirrorLoss(o:{
 rules:readonly QualityHoldingVeto[];entry:number;end:number;entryPrice:number;notional:number;
 additions:readonly QualityAdditionFill[];reductions?:readonly QualityReductionFill[];mirror?:QualityMirrorFill;
 actual?:boolean;observeFrom?:number;previous?:MirrorLossReviewStates;readPrice:(at:number)=>Promise<number>;
}):Promise<{states:MirrorLossReviewStates;stop?:{rule:QualityHoldingVeto;check:MirrorLossReviewCheck}}>{
 const states:MirrorLossReviewStates=structuredClone(o.previous??{});
 const rules=o.rules.filter(v=>v.enabled&&v.kind===MIRROR_LOSS_REVIEW_KIND);
 const events:{rule:QualityHoldingVeto;at:number;last:number}[]=[];
 for(const rule of rules){
  if(rule.mirrorDeadlineVersion!==MIRROR_LOSS_REVIEW_VERSION||!(rule.threshold>=1/60&&rule.threshold<=12))throw Error('定时亏损终止的版本或首次检查时间不可用，请保留原方案');
  const saved=states[rule.id];
  if(saved&&(saved.version!==MIRROR_LOSS_REVIEW_VERSION||saved.entry!==o.entry))throw Error('定时亏损检查记录的版本或建仓时点不符，不能重写历史检查');
  const from=Math.max(o.entry,o.observeFrom??o.entry);
  if(!Number.isFinite(from))throw Error('实际持仓的定时检查启动时间无效');
  const state=states[rule.id]??={version:MIRROR_LOSS_REVIEW_VERSION,entry:o.entry,through:Math.max(o.entry,from-1),checks:[]};
  // Live reconciliation already proves a completed mirror. Do not backfill a
  // missed historical liquidation after that actual execution has settled.
  if(o.actual&&mirrorCompletedBy(o.mirror,o.entry,o.end)){state.finished='mirror-completed';continue;}
  if(state.finished)continue;
  const points=mirrorLossReviewPoints(o.entry,rule.threshold),last=points.at(-1)!;
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
  const check:MirrorLossReviewCheck={at,price,pnl,quantity:ledger.held,cost:ledger.cost,realizedPnl:ledger.realized,decision:pnl < -tolerance?'close':'continue'};
  state.checks.push(check);state.through=at;
  if(check.decision==='close')return {states,stop:{rule,check}};
  if(at===last)state.finished='window-ended';
 }
 return {states};
}
