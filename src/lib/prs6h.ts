/** PRS-6H v1. Market-only causal evidence, without account balances or order execution. */
import type {ResearchBar} from './deepRsa/window';
export const PRS6H_ID='prs_intraday_add_evidence_6h', PRS6H_VERSION='v1', PRS6H_CHECKPOINT_VERSION=1;
export type PrsVolumeMode='quote'|'flow'|'base_close_proxy';
export const PRS6H_COMPONENTS=['T','S','D','B','V'] as const;
export type PrsComponent=typeof PRS6H_COMPONENTS[number];
export const PRS6H_DEFAULTS={trendHours:6,resistanceHours:6,referenceHours:6,platformMinutes:30,recentMinutes:60,evidenceHalfLifeMinutes:30,scaleMinutes:120,scaleHalfLifeMinutes:30,spikeMinutes:120,candidateMinutes:120,testValidMinutes:60,recoveryMinutes:15,breakoutBars:2,fastHalfLifeMinutes:15,slowHalfLifeMinutes:60,trendChangeMinutes:30,trendGapScale:.5,trendAccelerationScale:.25,supportMinutes:60,supportPenetrationScale:.5,volumePushScale:.5,closeLocationHalfLifeMinutes:5,pivotSignificanceScale:.5,resistanceBandScale:.1,maxEfficiency:.5,minPlatformTicks:4,maxWidthScale:2,testBandScale:.25,invalidationScale:.5,higherSupportTicks:2,higherSupportScale:.1,minTestVolumeRatio:.25,breakoutScale:.1,wickLimit:2,shockLimit:3,spaceMultiple:2,minDistance:.5,maxDistance:3,scoreThreshold:70,weights:{T:.15,S:.40,D:.25,B:.15,V:.05},coreMin:{T:.35,S:.65,D:.60,B:.60}};
export type PrsParams=typeof PRS6H_DEFAULTS;
export type PrsConfig=Partial<Omit<PrsParams,'weights'|'coreMin'>> & {weights?:Record<PrsComponent,number>;coreMin?:PrsParams['coreMin'];volumeMode?:PrsVolumeMode};
export function prsParameters(config:PrsConfig={}):PrsParams{
 if(!config||Array.isArray(config)||typeof config!=='object')throw Error('PRS-6H 配置必须是参数对象');
 const {volumeMode,...numeric}=config;
 if(volumeMode!==undefined&&!['quote','flow','base_close_proxy'].includes(volumeMode))throw Error('PRS-6H 成交额模式无效');
 if(Object.keys(numeric).some(k=>!(k in PRS6H_DEFAULTS)))throw Error('PRS-6H 存在未知参数');
 const p={...PRS6H_DEFAULTS,...numeric,weights:{...PRS6H_DEFAULTS.weights,...config.weights},coreMin:{...PRS6H_DEFAULTS.coreMin,...config.coreMin}};
 const values=Object.entries(p).filter(([k])=>!['weights','coreMin'].includes(k));
 if(values.some(([,v])=>typeof v!=='number'||!Number.isFinite(v)||v<=0)||p.maxEfficiency>1||p.minDistance>p.maxDistance||p.scoreThreshold>100||p.breakoutBars!==2||Object.keys(p.coreMin).some(k=>!['T','S','D','B'].includes(k))||Object.values(p.coreMin).some(x=>!Number.isFinite(x)||x<0||x>1)||Object.keys(p.weights).some(k=>!PRS6H_COMPONENTS.includes(k as PrsComponent))||Object.values(p.weights).some(x=>!Number.isFinite(x)||x<=0)||Math.abs(Object.values(p.weights).reduce((a,b)=>a+b,0)-1)>1e-12)throw Error('PRS-6H 参数无效；v1突破确认固定连续2根，正权重合计1');
 return p;
}
export const prsClip=(v:number)=>Math.min(1,Math.max(0,v));
export const prsWeight=(now:number,time:number,halfLifeMs:number)=>2**(-(now-time)/halfLifeMs);
export function prsAverage<T>(values:readonly T[],now:number,halfLifeMs:number,pick:(v:T)=>number,time:(v:T)=>number):number|null{
 if(!values.length)return null;let sum=0,denom=0;for(const v of values){const x=pick(v),w=prsWeight(now,time(v),halfLifeMs);if(!Number.isFinite(x))return null;sum+=w*x;denom+=w;}return denom>0?sum/denom:null;
}
const canonical=(value:unknown):string=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value!==null&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}':JSON.stringify(value);
export function prsHash(value:unknown){let hash=2166136261;for(const c of canonical(value))hash=Math.imul(hash^c.charCodeAt(0),16777619);return (hash>>>0).toString(16).padStart(8,'0');}
export function prsGeometric(parts:Record<PrsComponent,number|null>,weights:Record<PrsComponent,number>=PRS6H_DEFAULTS.weights){if(PRS6H_COMPONENTS.some(k=>parts[k]===null||!Number.isFinite(parts[k])))return null;if(PRS6H_COMPONENTS.some(k=>parts[k]===0))return 0;return 100*Math.exp(PRS6H_COMPONENTS.reduce((s,k)=>s+weights[k]*Math.log(parts[k]!),0));}
export type PrsState='SEARCHING'|'FROZEN'|'TESTING'|'VERIFIED'|'BASELINE_ONLY'|'MARKET_READY'|'INVALID'|'TEST_FAILED'|'CANDIDATE_EXPIRED'|'TEST_EXPIRED'|'REFERENCE_EXPIRED'|'DATA_UNAVAILABLE';
export interface PrsBar extends ResearchBar {PRS6H_tick_size?:number|null;PRS6H_closed?:boolean}
interface Point {bar:PrsBar;time:number;index:number;valid:boolean;amount:number|null;buy:number|null;scale:number|null;tr:number|null;fast:number|null;slow:number|null;gap:number|null;trend:boolean|null;T:number|null;delta:number|null;wick:number|null;shock:number|null}
export interface PrsReference {structure_id:string;support:number;invalidation:number;verified_at:number;below:number;valid:boolean;invalid_at:number|null}
export interface PrsStructure {structure_id:string;state:PrsState;support:number;upper:number;scale0:number;band:number;invalidation:number;formed_from:number;formed_to:number;frozen_at:number;previous:PrsReference|null;test_started_at:number|null;test_completed_at:number|null;max_penetration:number;below:number;event_emitted:boolean;breakout_confirmed_at:number|null;terminated_at:number|null}
export interface PrsObstacle {id:string;type:'pivot'|'platform';pivot_time:number;known_at:number;center:number;lower:number;upper:number;above:number;broken_up:boolean}
export interface PrsEvent {event_id:string;feature_id:string;feature_version:string;config_hash:string;symbol:string;timeframe_minutes:number;structure_id:string;signal_time:number;reference_price:number;support:number;platform_upper:number;invalidation:number;parts:Record<PrsComponent,number|null>;evidence_score:number;market_ready:true}
export interface PrsRow {PRS6H:number|null;PRS6H_evidence_raw:number|null;PRS6H_T:number|null;PRS6H_S:number|null;PRS6H_D:number|null;PRS6H_B:number|null;PRS6H_V:number|null;PRS6H_at:number;PRS6H_state:PrsState;PRS6H_market_ready:boolean;PRS6H_gates:Record<string,boolean|null>;PRS6H_reasons:string[];PRS6H_structure:PrsStructure|null;PRS6H_event:PrsEvent|null;PRS6H_events:{type:string;at:number;structure_id:string|null}[];PRS6H_data_complete:boolean;PRS6H_volume_mode:PrsVolumeMode;PRS6H_config_hash:string;PRS6H_version:string;PRS6H_parameters:PrsParams;PRS6H_debug:Record<string,unknown>;PRS6H_source:string;PRS6H_data_version:string}
export interface PrsCheckpoint {checkpoint_version:1;feature_id:string;feature_version:string;config_hash:string;symbol:string;minutes:number;data_source:string;data_version:string;volume_mode:PrsVolumeMode;init_at:number|null;index:number;last_time:number|null;not_before:number;points:Point[];active:PrsStructure|null;references:PrsReference[];obstacles:PrsObstacle[];archive:PrsStructure[];event_ids:string[];last_row:PrsRow|null}
export interface PrsOptions {symbol?:string;minutes?:number;config?:PrsConfig;dataSource?:string;dataVersion?:string;checkpoint?:PrsCheckpoint}
export class Prs6hEngine {
 readonly parameters:PrsParams;readonly mode:PrsVolumeMode;readonly symbol:string;readonly minutes:number;readonly step:number;readonly configHash:string;readonly dataSource:string;readonly dataVersion:string;
 private points:Point[]=[];private active:PrsStructure|null=null;private references:PrsReference[]=[];private obstacles:PrsObstacle[]=[];private archive:PrsStructure[]=[];private eventIds=new Set<string>();private index=-1;private initAt:number|null=null;private notBefore=-Infinity;private lastTime:number|null=null;private lastRow:PrsRow|null=null;
 constructor(options:PrsOptions={}){
  this.parameters=prsParameters(options.config);this.mode=options.config?.volumeMode??'quote';this.symbol=options.symbol??'UNSPECIFIED';this.minutes=options.minutes??5;this.step=this.minutes*60000;this.dataSource=options.dataSource??'binance-usdm';this.dataVersion=options.dataVersion??'closed-kline-v1';
  if(!Number.isFinite(this.minutes)||this.minutes<=0||!['quote','flow','base_close_proxy'].includes(this.mode))throw Error('PRS-6H 周期或成交模式无效');
  this.configHash=prsHash({feature:PRS6H_ID,version:PRS6H_VERSION,parameters:this.parameters,volume_mode:this.mode,minutes:this.minutes,source:this.dataSource,data_version:this.dataVersion});
  if(options.checkpoint)this.restore(options.checkpoint);
 }
 private n(minutes:number){return Math.max(1,Math.ceil(minutes/this.minutes));}
 private window(minutes:number,before=false){const end=this.lastTime!-(before?this.step:0);return this.points.filter(p=>p.time<=end&&p.time>end-Math.ceil(minutes/this.minutes)*this.step);}
 private full(points:readonly Point[],n:number){return points.length===n&&points.every((p,i)=>p.valid&&(i===0||p.time-points[i-1].time===this.step));}
 checkpoint():PrsCheckpoint{return structuredClone({checkpoint_version:1,feature_id:PRS6H_ID,feature_version:PRS6H_VERSION,config_hash:this.configHash,symbol:this.symbol,minutes:this.minutes,data_source:this.dataSource,data_version:this.dataVersion,volume_mode:this.mode,init_at:this.initAt,index:this.index,last_time:this.lastTime,not_before:Number.isFinite(this.notBefore)?this.notBefore:0,points:this.points,active:this.active,references:this.references,obstacles:this.obstacles,archive:this.archive,event_ids:[...this.eventIds],last_row:this.lastRow});}
 private restore(c:PrsCheckpoint){if(c.checkpoint_version!==1||c.feature_id!==PRS6H_ID||c.feature_version!==PRS6H_VERSION||c.config_hash!==this.configHash||c.symbol!==this.symbol||c.minutes!==this.minutes||c.data_source!==this.dataSource||c.data_version!==this.dataVersion||c.volume_mode!==this.mode)throw Error('PRS-6H 检查点的配置、标的、周期或数据版本不一致');const v=structuredClone(c);this.points=v.points;this.active=v.active;this.references=v.references;this.obstacles=v.obstacles;this.archive=v.archive;this.eventIds=new Set(v.event_ids);this.index=v.index;this.initAt=v.init_at;this.lastTime=v.last_time;this.notBefore=v.not_before;this.lastRow=v.last_row;}
 push(bar:PrsBar,options:{asOf?:number}={}):PrsRow|null{
  if(bar.PRS6H_closed===false)return null;
  const time=bar.openTime+this.step;if(options.asOf!==undefined&&time>options.asOf)return null;
  if(this.lastTime!==null&&time<=this.lastTime){if(time===this.lastTime&&this.lastRow)return {...structuredClone(this.lastRow),PRS6H_event:null,PRS6H_events:[]};throw Error('PRS-6H 增量数据必须按时间递增；修订历史须从修订前检查点回放');}
  const p=this.parameters,index=++this.index,prior=this.points.at(-1),events:PrsRow['PRS6H_events']=[],reasons:string[]=[];this.lastTime=time;this.initAt??=time;
  const emit=(type:string,s=this.active)=>events.push({type,at:time,structure_id:s?.structure_id??null});
  let terminal:PrsStructure|null=null,terminalState:PrsState|null=null,skipCreate=false;
  const terminate=(state:PrsState)=>{if(this.active){this.active.state=state;this.active.terminated_at=time;terminal=structuredClone(this.active);this.archive.push(terminal);emit(state);this.active=null;}terminalState=state;this.notBefore=time;skipCreate=true;};
  const valid=Number.isFinite(bar.openTime)&&bar.openTime%this.step===0&&[bar.open,bar.high,bar.low,bar.close].every(v=>Number.isFinite(v)&&v>0)&&bar.high>=Math.max(bar.open,bar.close)&&bar.low<=Math.min(bar.open,bar.close)&&bar.high>=bar.low;
  const gap=!!prior&&time-prior.time!==this.step;
  const quote=this.mode==='base_close_proxy'?bar.volume*bar.close:bar.quoteVolume;
  const amount=quote!=null&&Number.isFinite(quote)&&quote>=0?quote:null;
  const buy=this.mode==='flow'&&bar.takerBuyQuoteVolume!=null&&Number.isFinite(bar.takerBuyQuoteVolume)&&bar.takerBuyQuoteVolume>=0&&amount!==null&&bar.takerBuyQuoteVolume<=amount?bar.takerBuyQuoteVolume:null;
  const point:Point={bar:{...bar},time,index,valid,amount,buy,scale:null,tr:valid&&prior?.valid&&!gap?Math.max(bar.high-bar.low,Math.abs(bar.high-prior.bar.close),Math.abs(bar.low-prior.bar.close)):null,fast:null,slow:null,gap:null,trend:null,T:null,delta:valid&&prior?.valid&&!gap?bar.close-prior.bar.close:null,wick:null,shock:null};
  this.points.push(point);
  if(gap||!valid){terminate('DATA_UNAVAILABLE');this.references.forEach(r=>{r.valid=false;r.invalid_at=time;});this.obstacles=[];this.initAt=time;reasons.push(gap?'missing_or_noncontiguous_candle':'invalid_ohlc_or_timestamp');}
  const scaleBars=this.window(p.scaleMinutes,true);
  if(this.full(scaleBars,this.n(p.scaleMinutes)))point.scale=prsAverage(scaleBars,time-this.step,p.scaleHalfLifeMinutes*60000,x=>x.tr??NaN,x=>x.time);
  if(!(point.scale!==null&&point.scale>0))point.scale=null;
  const trendBars=this.window(p.trendHours*60);
  if(this.full(trendBars,this.n(p.trendHours*60))){point.fast=prsAverage(trendBars,time,p.fastHalfLifeMinutes*60000,x=>x.bar.close,x=>x.time);point.slow=prsAverage(trendBars,time,p.slowHalfLifeMinutes*60000,x=>x.bar.close,x=>x.time);point.gap=point.fast!-point.slow!;const previousTrend=this.points.find(x=>x.time===time-this.n(p.trendChangeMinutes)*this.step);if(previousTrend?.slow!==null&&previousTrend?.slow!==undefined&&point.scale!==null){point.trend=point.gap>0&&point.slow!>previousTrend.slow;const b=(point.gap-(previousTrend.gap??NaN))/point.scale;point.T=Math.tanh(Math.max(point.gap/point.scale,0)/p.trendGapScale)*(.75+.25*Math.tanh(Math.max(b,0)/p.trendAccelerationScale));}}
  if(point.scale!==null&&point.valid){point.wick=(Math.min(bar.open,bar.close)-bar.low)/point.scale;point.shock=prior?.valid&&!gap?Math.max(prior.bar.close-bar.low,0)/point.scale:null;}
  const tick=bar.PRS6H_tick_size, tickOk=tick!==null&&tick!==undefined&&Number.isFinite(tick)&&tick>0;
  if(!tickOk)reasons.push('missing_tick_size');if(amount===null)reasons.push('missing_or_invalid_quote_amount');if(this.mode==='flow'&&buy===null)reasons.push('missing_or_invalid_taker_amount');if(point.scale===null)reasons.push('prior_volatility_unavailable');
  // Frozen references remain subject to every subsequent closed bar, including after candidate termination.
  for(const ref of this.references){if(!ref.valid)continue;ref.below=bar.close<ref.support?ref.below+1:0;if(!valid||gap||bar.low<=ref.invalidation||ref.below>=2){ref.valid=false;ref.invalid_at=time;}if(time-ref.verified_at>p.referenceHours*3600000)ref.valid=false;}
  if(this.active){this.active.below=bar.close<this.active.support?this.active.below+1:0;this.active.max_penetration=Math.max(this.active.max_penetration,Math.max(this.active.support-bar.low,0)/this.active.scale0);
   if(bar.low<=this.active.invalidation||this.active.below>=2)terminate('INVALID');
   else if(time-this.active.frozen_at>p.candidateMinutes*60000)terminate('CANDIDATE_EXPIRED');
   else if(this.active.test_completed_at!==null&&time-this.active.test_completed_at>p.testValidMinutes*60000)terminate('TEST_EXPIRED');
  }
  // Obstacles have frozen bands and a reversible above-band status; invalid support never erases an upper band.
  this.obstacles=this.obstacles.filter(o=>time-o.known_at<p.resistanceHours*3600000);
  for(const o of this.obstacles){if(bar.close>o.upper){o.above++;if(o.above>=2)o.broken_up=true;}else{o.above=0;o.broken_up=false;}}
  const around=this.points.slice(-5),center=around[2];
  if(around.length===5&&this.full(around,5)&&center.scale!==null&&tickOk&&center.bar.high>Math.max(around[0].bar.high,around[1].bar.high)&&center.bar.high>=Math.max(around[3].bar.high,around[4].bar.high)&&center.bar.high-Math.min(...around.map(b=>b.bar.low))>=p.pivotSignificanceScale*center.scale){const eps=Math.max(tick!, p.resistanceBandScale*center.scale);this.obstacles.push({id:'pivot-'+center.time,type:'pivot',pivot_time:center.time,known_at:time,center:center.bar.high,lower:center.bar.high-eps,upper:center.bar.high+eps,above:0,broken_up:false});}
  // Candidate creation consumes only a platform wholly after the previous termination.
  if(!this.active&&!skipCreate&&point.trend===true&&point.scale!==null&&tickOk){
   const formation=this.window(p.platformMinutes);
   if(this.full(formation,this.n(p.platformMinutes))&&formation[0].time>this.notBefore&&formation.every(x=>x.amount!==null&&x.amount>0)){
    const support=Math.min(...formation.map(x=>x.bar.low)),upper=Math.max(...formation.map(x=>x.bar.high)),width=upper-support;
    const travel=formation.slice(1).reduce((s,x,i)=>s+Math.abs(x.bar.close-formation[i].bar.close),0),ER=travel===0?0:Math.abs(formation.at(-1)!.bar.close-formation[0].bar.close)/travel;
    const band=Math.max(tick!,Math.min(p.testBandScale*point.scale,width/4)),K=support-p.invalidationScale*point.scale;
    const previous=this.references.filter(r=>r.valid&&time-r.verified_at<=p.referenceHours*3600000).sort((a,b)=>b.verified_at-a.verified_at||a.structure_id.localeCompare(b.structure_id))[0]??null;
    const higher=!previous||(support-previous.support>=Math.max(p.higherSupportTicks*tick!,p.higherSupportScale*point.scale)&&K-previous.invalidation>=tick!);
    if(width>=p.minPlatformTicks*tick!&&width<=p.maxWidthScale*point.scale&&ER<=p.maxEfficiency&&bar.close>=support+2*band&&higher){
     const structure_id='prs6h-'+prsHash([this.symbol,this.minutes,PRS6H_VERSION,this.configHash,formation[0].time,time]);
     this.active={structure_id,state:'FROZEN',support,upper,scale0:point.scale,band,invalidation:K,formed_from:formation[0].time,formed_to:time,frozen_at:time,previous:previous?structuredClone(previous):null,test_started_at:null,test_completed_at:null,max_penetration:0,below:0,event_emitted:false,breakout_confirmed_at:null,terminated_at:null};
     const eps=Math.max(tick!,p.resistanceBandScale*point.scale);this.obstacles.push({id:'platform-'+structure_id,type:'platform',pivot_time:time,known_at:time,center:upper,lower:upper-eps,upper:upper+eps,above:0,broken_up:false});emit('FROZEN');
    }
   }
  }
  const current=this.active;
  if(current&&time>current.frozen_at&&current.test_completed_at===null){
   if(current.test_started_at===null&&prior?.bar.close>=current.support+2*current.band&&bar.low<=current.support+current.band&&bar.high>=current.support-current.band){
    const qHistory=this.window(p.recentMinutes,true),qRef=this.full(qHistory,this.n(p.recentMinutes))?prsAverage(qHistory,time-this.step,p.evidenceHalfLifeMinutes*60000,x=>x.amount??NaN,x=>x.time):null;
    if(amount!==null&&amount>0&&qRef!==null&&qRef>0&&amount>=p.minTestVolumeRatio*qRef){current.test_started_at=time;current.state='TESTING';emit('TEST_STARTED');}
   }
   if(current.test_started_at!==null){
    const allowed=time-current.test_started_at<this.n(p.recoveryMinutes)*this.step;
    if(allowed&&bar.close>=current.support+2*current.band){current.test_completed_at=time;current.state='VERIFIED';this.references.push({structure_id:current.structure_id,support:current.support,invalidation:current.invalidation,verified_at:time,below:current.below,valid:true,invalid_at:null});emit('VERIFIED');if(!current.previous)terminate('BASELINE_ONLY');}
    else if(!allowed||time-current.test_started_at>=(this.n(p.recoveryMinutes)-1)*this.step)terminate('TEST_FAILED');
   }
  }
  const structure=this.active??terminal;
  const parts:Record<PrsComponent,number|null>={T:point.T,S:null,D:null,B:null,V:null};
  const recent=this.window(p.recentMinutes);let up=0,down=0,volume=0,pushVolume=0;
  if(this.full(recent,this.n(p.recentMinutes))&&recent.every(x=>x.delta!==null)){
   for(const x of recent){const w=prsWeight(time,x.time,p.evidenceHalfLifeMinutes*60000);up+=w*Math.max(x.delta!,0);down+=w*Math.max(-x.delta!,0);}
   if(up+down>0)parts.D=up/(up+down);else reasons.push('no_directional_price_advance');
   let amountsValid=true;
   for(const x of recent){if(x.amount===null||x.scale===null||this.mode==='flow'&&x.buy===null){amountsValid=false;break;}const w=prsWeight(time,x.time,p.evidenceHalfLifeMinutes*60000),eta=prsClip(Math.max(-x.delta!,0)/(p.volumePushScale*x.scale));volume+=w*x.amount;pushVolume+=w*(this.mode==='flow'?x.amount-x.buy!:x.amount)*eta;}
   if(amountsValid&&volume>0)parts.V=1-pushVolume/volume;else reasons.push(amountsValid?'zero_quote_amount':'incomplete_volume_evidence');
  }
  const lastTwo=this.points.slice(-2);
  if(this.full(lastTwo,2)&&lastTwo.every(x=>x.bar.high>x.bar.low))parts.B=prsAverage(lastTwo,time,p.closeLocationHalfLifeMinutes*60000,x=>(x.bar.close-x.bar.low)/(x.bar.high-x.bar.low),x=>x.time);else reasons.push('undefined_close_location');
  if(structure?.test_completed_at!==null&&structure?.test_completed_at!==undefined){const held=this.points.filter(x=>x.time>structure.frozen_at&&time-x.time<p.supportMinutes*60000);const hold=prsAverage(held,time,p.evidenceHalfLifeMinutes*60000,x=>x.bar.close>=structure.support?1:0,x=>x.time);parts.S=hold===null?null:hold*prsClip(1-structure.max_penetration/p.supportPenetrationScale);}
  const spike=this.window(p.spikeMinutes),spikeValid=this.full(spike,this.n(p.spikeMinutes))&&spike.every(x=>x.wick!==null&&x.shock!==null);
  const maxWick=spikeValid?Math.max(...spike.map(x=>x.wick!)):null,maxShock=spikeValid?Math.max(...spike.map(x=>x.shock!)):null;
  const lastViolation=spike.filter(x=>x.wick!==null&&x.wick>=p.wickLimit||x.shock!==null&&x.shock>=p.shockLimit).at(-1)?.time??null;
  const readyHistory=this.initAt!==null&&time-this.initAt>=(this.n(p.resistanceHours*60)+this.n(p.scaleMinutes)+4-1)*this.step&&this.full(this.window(p.trendHours*60),this.n(p.trendHours*60));
  let breakout=false;
  if(this.active?.test_completed_at!==null&&this.active?.test_completed_at!==undefined&&prior){const a=this.active,line=a.upper+Math.max(tick??Infinity,p.breakoutScale*a.scale0);breakout=prior.time>a.test_completed_at&&prior.bar.close>line&&bar.close>line&&bar.close>=prior.bar.close;if(breakout){a.breakout_confirmed_at??=time;if(a.previous&&time-a.previous.verified_at>p.referenceHours*3600000)terminate('REFERENCE_EXPIRED');}}
  const selected=this.active??terminal,range=selected?bar.close+ p.spaceMultiple*(bar.close-selected.invalidation):null;
  const activeObstacles=this.obstacles.filter(o=>!o.broken_up&&o.known_at<=time&&time-o.known_at<p.resistanceHours*3600000);
  const blocking=selected&&range!==null?activeObstacles.filter(o=>o.lower<=range&&o.upper>=bar.close).sort((a,b)=>a.lower-b.lower||a.id.localeCompare(b.id)):[];
  const z=selected&&point.scale!==null?(bar.close-selected.invalidation)/point.scale:null;
  const core=PRS6H_COMPONENTS.filter(k=>k!=='V').some(k=>parts[k]===null)?null:PRS6H_COMPONENTS.filter(k=>k!=='V').every(k=>parts[k]!==null&&parts[k]!>=p.coreMin[k as keyof PrsParams['coreMin']]);
  const gates:Record<string,boolean|null>={trend:point.trend,higher:!!selected?.previous,tested:selected?.test_completed_at!=null,valid:!!this.active,time_valid:!!this.active,breakout,spike:spikeValid?maxWick!<p.wickLimit&&maxShock!<p.shockLimit:null,space:readyHistory&&selected?bar.close-selected.invalidation>0&&blocking.length===0:null,distance:z===null?null:z>=p.minDistance&&z<=p.maxDistance,core};
  for(const [key,value] of Object.entries(gates))if(value===false)reasons.push('gate_'+key);else if(value===null)reasons.push('unknown_'+key);
  const raw=prsGeometric(parts,p.weights),noStructure=!selected||selected.test_completed_at===null||selected.state==='BASELINE_ONLY';
  const basicComplete=valid&&!gap&&tickOk&&amount!==null&&point.scale!==null&&readyHistory&&(this.mode!=='flow'||buy!==null);
  const calculationComplete=basicComplete&&parts.T!==null&&parts.D!==null&&parts.B!==null&&parts.V!==null&&spikeValid;
  let score:number|null=!calculationComplete?null:terminalState&&terminalState!=='DATA_UNAVAILABLE'?0:parts.D===null||parts.B===null||parts.V===null?null:noStructure?0:raw===null?null:Object.values(gates).some(v=>v===null)?null:Object.values(gates).every(v=>v===true)?raw:0;
  let state:PrsState=terminalState??this.active?.state??'SEARCHING',marketReady=score!==null&&score>=p.scoreThreshold&&Object.values(gates).every(v=>v===true),marketEvent:PrsEvent|null=null;
  if(!calculationComplete){reasons.push('insufficient_or_invalid_required_data');if(!terminalState)state='DATA_UNAVAILABLE';}
  if(marketReady&&this.active&&!this.active.event_emitted){const s=this.active,id=prsHash([s.structure_id,'MARKET_READY']);if(!this.eventIds.has(id)){marketEvent={event_id:id,feature_id:PRS6H_ID,feature_version:PRS6H_VERSION,config_hash:this.configHash,symbol:this.symbol,timeframe_minutes:this.minutes,structure_id:s.structure_id,signal_time:time,reference_price:bar.close,support:s.support,platform_upper:s.upper,invalidation:s.invalidation,parts:{...parts},evidence_score:score!,market_ready:true};this.eventIds.add(id);}s.event_emitted=true;terminate('MARKET_READY');state='MARKET_READY';}
  const finalStructure=this.active??terminal;
  const row:PrsRow={PRS6H:score,PRS6H_evidence_raw:raw,PRS6H_T:parts.T,PRS6H_S:parts.S,PRS6H_D:parts.D,PRS6H_B:parts.B,PRS6H_V:parts.V,PRS6H_at:time,PRS6H_state:state,PRS6H_market_ready:marketReady,PRS6H_gates:gates,PRS6H_reasons:[...new Set(reasons)],PRS6H_structure:finalStructure?structuredClone(finalStructure):null,PRS6H_event:marketEvent,PRS6H_events:events,PRS6H_data_complete:calculationComplete,PRS6H_volume_mode:this.mode,PRS6H_config_hash:this.configHash,PRS6H_version:PRS6H_VERSION,PRS6H_parameters:structuredClone(p),PRS6H_debug:{scale_before:point.scale,fast:point.fast,slow:point.slow,mean_gap:point.gap,U:up,N:down,volume_denominator:volume,max_wick:maxWick,max_shock:maxShock,last_spike_at:lastViolation,spike_wait_ms:lastViolation===null?0:Math.max(0,p.spikeMinutes*60000-(time-lastViolation)),nearest_obstacle:blocking[0]?{...blocking[0]}:null,obstacles:activeObstacles.map(o=>({...o})),scan_from:bar.close,scan_to:range,distance_z:z,tick,initialization_at:this.initAt},PRS6H_source:this.dataSource,PRS6H_data_version:this.dataVersion};
  this.lastRow=structuredClone(row);
  const keepMinutes=Math.max(p.trendHours*60+p.trendChangeMinutes,p.resistanceHours*60+p.scaleMinutes+20,p.candidateMinutes,p.testValidMinutes,p.spikeMinutes+p.scaleMinutes)+this.minutes;
  this.points=this.points.filter(x=>time-x.time<=keepMinutes*60000);this.references=this.references.filter(x=>time-x.verified_at<=p.referenceHours*3600000);this.archive=this.archive.filter(x=>time-(x.terminated_at??time)<=Math.max(p.referenceHours,p.resistanceHours)*3600000);
  return row;
 }
}
export function computePrs6h(bars:readonly PrsBar[],options:PrsOptions&{asOf?:number}={}){const engine=new Prs6hEngine(options),rows=bars.flatMap(bar=>{const row=engine.push(bar,{asOf:options.asOf});return row?[row]:[];});return {rows,checkpoint:engine.checkpoint()};}
export const PRS6H_FIELDS=['PRS6H','PRS6H_evidence_raw','PRS6H_T','PRS6H_S','PRS6H_D','PRS6H_B','PRS6H_V','PRS6H_market_ready','PRS6H_support','PRS6H_platform_upper','PRS6H_invalidation','PRS6H_frozen_at','PRS6H_test_started_at','PRS6H_test_completed_at','PRS6H_breakout_at','PRS6H_scale_before','PRS6H_max_wick','PRS6H_max_shock','PRS6H_scan_to','PRS6H_state_code'] as const;
export const PRS6H_STATES:PrsState[]=['SEARCHING','FROZEN','TESTING','VERIFIED','BASELINE_ONLY','MARKET_READY','INVALID','TEST_FAILED','CANDIDATE_EXPIRED','TEST_EXPIRED','REFERENCE_EXPIRED','DATA_UNAVAILABLE'];
export function prsNumeric(row:PrsRow,name:typeof PRS6H_FIELDS[number]):number|null{
 if(name==='PRS6H_market_ready')return Number(row.PRS6H_market_ready);
 if(name==='PRS6H_state_code')return PRS6H_STATES.indexOf(row.PRS6H_state);
 const structureFields:Record<string,keyof PrsStructure>={PRS6H_support:'support',PRS6H_platform_upper:'upper',PRS6H_invalidation:'invalidation',PRS6H_frozen_at:'frozen_at',PRS6H_test_started_at:'test_started_at',PRS6H_test_completed_at:'test_completed_at',PRS6H_breakout_at:'breakout_confirmed_at'};
 const value=structureFields[name]?row.PRS6H_structure?.[structureFields[name]]:name==='PRS6H_scale_before'?row.PRS6H_debug.scale_before:name==='PRS6H_max_wick'?row.PRS6H_debug.max_wick:name==='PRS6H_max_shock'?row.PRS6H_debug.max_shock:name==='PRS6H_scan_to'?row.PRS6H_debug.scan_to:row[name as keyof PrsRow];
 return typeof value==='number'&&Number.isFinite(value)?value:null;
}
/** Consumer contract fails closed when the existing account or risk decision is unavailable. */
export function prsAccountAdmission(event:PrsEvent|null,existing:{positionEligible?:boolean;riskBudgetPassed?:boolean;latestExecutionChecksPassed?:boolean}){const reasons:string[]=[];if(!event?.market_ready)reasons.push('market_not_ready');if(existing.positionEligible!==true)reasons.push('existing_position_permission_not_passed');if(existing.riskBudgetPassed!==true)reasons.push('existing_risk_budget_not_passed');if(existing.latestExecutionChecksPassed!==true)reasons.push('existing_execution_checks_not_passed');return {allowed:reasons.length===0,reasons,event_id:event?.event_id??null};}
