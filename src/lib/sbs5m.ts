import type {ResearchBar} from './deepRsa/window';

export const SBS5M_ID='sbs_5m';
export const SBS5M_VERSION='sbs-5m-v1';
export const SBS5M_STEP=300_000;
export type SbsVolumeMode='quote'|'base_times_close';
export interface SbsConfig {
  bar_interval:'5m'; volume_mode:SbsVolumeMode;
  box_formation_bars:number; volatility_lookback_bars:number; volatility_half_life:number;
  box_min_width_ticks:number; box_max_width_scale:number; box_max_efficiency_ratio:number;
  formation_max_lower_wick_scale:number; touch_band_scale:number; touch_band_width_fraction:number;
  invalidation_buffer_scale:number; candidate_max_age:number; active_box_max_age:number;
  test_max_bars:number; turnover_reference_bars:number; turnover_reference_half_life:number;
  test_min_turnover_ratio:number; breakout_buffer_scale:number; breakout_confirm_bars:number;
  step_min_raise_ticks:number; step_min_raise_scale:number;
  quality_lookback:number; quality_half_life:number; test_freshness_half_life:number;
}
export const SBS5M_DEFAULTS:Readonly<SbsConfig>=Object.freeze({
  bar_interval:'5m',volume_mode:'quote',box_formation_bars:6,volatility_lookback_bars:24,volatility_half_life:30,
  box_min_width_ticks:4,box_max_width_scale:2,box_max_efficiency_ratio:.5,formation_max_lower_wick_scale:1.5,
  touch_band_scale:.25,touch_band_width_fraction:.25,invalidation_buffer_scale:.5,candidate_max_age:60,
  active_box_max_age:6,test_max_bars:3,turnover_reference_bars:12,turnover_reference_half_life:30,
  test_min_turnover_ratio:.25,breakout_buffer_scale:.1,breakout_confirm_bars:2,step_min_raise_ticks:2,
  step_min_raise_scale:.1,quality_lookback:60,quality_half_life:30,test_freshness_half_life:60,
});
export interface SbsParameterSpec {key:Exclude<keyof SbsConfig,'bar_interval'|'volume_mode'>;label:string;unit:string;min:number;max:number;integer?:boolean;description:string}
export const SBS5M_PARAMETER_SPECS:readonly SbsParameterSpec[]=[
  {key:'box_formation_bars',label:'箱体形成',unit:'根',min:2,max:288,integer:true,description:'整个形成区间须晚于上次终止或父箱突破。'},
  {key:'volatility_lookback_bars',label:'事前波动窗口',unit:'根',min:2,max:2016,integer:true,description:'仅用当前根之前的有限窗口真实波幅。'},
  {key:'volatility_half_life',label:'波动半衰期',unit:'分钟',min:1,max:10080,description:'按实际时间差指数加权，非默认 ATR。'},
  {key:'box_min_width_ticks',label:'最小箱宽',unit:'tick',min:4,max:10000,integer:true,description:'至少4个最小价格单位，避免测试带覆盖浅箱。'},
  {key:'box_max_width_scale',label:'最大箱宽',unit:'事前尺度',min:.01,max:100,description:'箱宽不得超过冻结事前尺度的该倍数。'},
  {key:'box_max_efficiency_ratio',label:'最大路径效率',unit:'比例',min:0,max:1,description:'单向上涨不能仅因范围窄而形成箱体。'},
  {key:'formation_max_lower_wick_scale',label:'形成下针上限',unit:'各根事前尺度',min:.01,max:100,description:'严格小于；各根各用自己的事前尺度。'},
  {key:'touch_band_scale',label:'测试带尺度',unit:'冻结尺度',min:.001,max:1,description:'与箱宽约束同时取较小值，再至少1 tick。'},
  {key:'touch_band_width_fraction',label:'测试带箱宽占比',unit:'比例',min:.001,max:.25,description:'最多箱宽四分之一。'},
  {key:'invalidation_buffer_scale',label:'失效缓冲',unit:'冻结尺度',min:.01,max:100,description:'冻结后不下移，不自动修改实际止损。'},
  {key:'candidate_max_age',label:'候选寿命',unit:'分钟',min:5,max:10080,description:'达到期限即终止，优先于当根确认。'},
  {key:'active_box_max_age',label:'有效支撑寿命',unit:'小时',min:1/12,max:168,description:'从正式确认计时，再次测试不续期。'},
  {key:'test_max_bars',label:'测试恢复期限',unit:'根（含触碰）',min:1,max:288,integer:true,description:'最后一根先检查恢复，再判超时。'},
  {key:'turnover_reference_bars',label:'成交额基准',unit:'根',min:1,max:2016,integer:true,description:'只使用触碰根之前的成交额。'},
  {key:'turnover_reference_half_life',label:'成交额半衰期',unit:'分钟',min:1,max:10080,description:'按实际时间差加权，不能逐根切换成交口径。'},
  {key:'test_min_turnover_ratio',label:'最小成交活动',unit:'基准倍数',min:0,max:100,description:'真实成交额必须为正，不把聚合K线解释为订单吸收。'},
  {key:'breakout_buffer_scale',label:'突破缓冲',unit:'冻结尺度',min:0,max:100,description:'至少1 tick；只在确认之后的收盘计数。'},
  {key:'breakout_confirm_bars',label:'突破确认',unit:'连续收盘根数',min:1,max:288,integer:true,description:'不继承父箱突破计数或时间。'},
  {key:'step_min_raise_ticks',label:'最小抬升',unit:'tick',min:1,max:10000,integer:true,description:'还须满足尺度抬升、箱顶与失效参考均提高。'},
  {key:'step_min_raise_scale',label:'最小尺度抬升',unit:'新冻结尺度',min:0,max:100,description:'不因旧低点滚出窗口自动抬升。'},
  {key:'quality_lookback',label:'守住证据窗口',unit:'分钟',min:5,max:10080,description:'左开右闭；零成交不增加守住证据。'},
  {key:'quality_half_life',label:'守住证据半衰期',unit:'分钟',min:1,max:10080,description:'不改变累计最大穿透。'},
  {key:'test_freshness_half_life',label:'测试新鲜度半衰期',unit:'分钟',min:1,max:10080,description:'仅成功完成的独立测试刷新。'},
];
export function sbsParameters(input:Partial<SbsConfig>={}):SbsConfig {
  for(const k of Object.keys(input))if(!(k in SBS5M_DEFAULTS))throw new Error('SBS-5M 未知参数：'+k);
  const p={...SBS5M_DEFAULTS,...input};
  if(p.bar_interval!=='5m'||!['quote','base_times_close'].includes(p.volume_mode))throw new Error('SBS-5M 仅支持已收盘5m与明确成交额模式');
  for(const s of SBS5M_PARAMETER_SPECS){const v=p[s.key];if(!Number.isFinite(v)||v<s.min||v>s.max||s.integer&&!Number.isInteger(v))throw new Error('SBS-5M 参数越界：'+s.key);}
  return p;
}
export function sbsHistoryBars(config:Partial<SbsConfig>={}){const p=sbsParameters(config);return Math.ceil(Math.max(288,p.active_box_max_age*12,p.volatility_lookback_bars+p.box_formation_bars+p.turnover_reference_bars+p.test_max_bars+p.breakout_confirm_bars+2));}
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
function hash(s:string):string {const h=[0x811c9dc5,0x243f6a88,0x85a308d3,0x13198a2e];for(let i=0;i<s.length;i++)for(let j=0;j<h.length;j++)h[j]=Math.imul(h[j]^s.charCodeAt(i),0x01000193+j*2);return h.map(x=>(x>>>0).toString(16).padStart(8,'0')).join('');}
export const sbsConfigHash=(p:Partial<SbsConfig>={})=>hash(canonical([SBS5M_VERSION,sbsParameters(p)]));
export type SbsSupportStatus='NO_STRUCTURE'|'ACTIVE'|'INVALID'|'STALE'|'DATA_UNAVAILABLE';
export type SbsCandidateStatus='NONE'|'FROZEN'|'TESTING'|'CONFIRMED'|'FAILED'|'INVALID'|'EXPIRED'|'PARENT_TERMINATED'|'DATA_UNAVAILABLE';
export type SbsRetestStatus='WAITING_FOR_DEPARTURE'|'ARMED'|'TESTING'|'SUCCEEDED'|'FAILED'|'NONE';
export type SbsBar=ResearchBar&{SBS5M_closed?:boolean;SBS5M_tick_size?:number|null;SBS5M_symbol?:string;SBS5M_data_source?:string;SBS5M_data_version?:string};
interface SbsPoint {at:number;bar:SbsBar;amount:number;tr:number|null;scale:number|null;tick:number}
export interface SbsTest {status:SbsRetestStatus;started_at:number|null;completed_at:number|null;ended_at:number|null;armed_at:number|null}
export interface SbsParent {box_id:string;support_price:number;box_top:number;invalidation_price:number;confirmed_at:number;breakout_at:number}
export interface SbsBox {
  box_id:string;parent_box_id:string|null;parent:SbsParent|null;episode_id:string|null;
  s:number;u:number;W:number;a0:number;delta:number;K:number;tick:number;
  formation_start:number;formation_end:number;frozen_at:number;confirmed_at:number|null;
  breakout_at:number|null;last_successful_test_at:number|null;invalidated_at:number|null;expired_at:number|null;
  test_started_at:number|null;test_completed_at:number|null;ended_at:number|null;
  state:'PENDING'|'ACTIVE'|'REPLACED'|'INVALID'|'STALE'|'TEST_FAILED'|'EXPIRED'|'PARENT_TERMINATED'|'DATA_UNAVAILABLE';
  below:number;above:number;max_penetration:number;retest:SbsTest;feature_version:string;config_hash:string;data_checksum_at_freeze:string;
}
export interface SbsEvent {id:string;type:string;at:number|null;box_id:string;parent_box_id:string|null;episode_id:string|null;reason_codes:string[];support_price:number;box_top:number;invalidation_price:number;step_event_height?:number}
export interface SbsRow {
  at:number|null;support_price:number|null;box_top:number|null;invalidation_price:number|null;support_quality:number|null;
  support_status:SbsSupportStatus;candidate_status:SbsCandidateStatus;retest_status:SbsRetestStatus;
  candidate_support_price:number|null;candidate_box_top:number|null;candidate_invalidation_price:number|null;
  distance_to_support:number|null;step_height_atr:number|null;step_event_height:number|null;
  box_id:string|null;parent_box_id:string|null;episode_id:string|null;candidate_box_id:string|null;
  frozen_at:number|null;confirmed_at:number|null;breakout_at:number|null;last_successful_test_at:number|null;invalidated_at:number|null;expired_at:number|null;
  reason_codes:string[];feature_version:string;config_hash:string;volume_mode:SbsVolumeMode;
  data_valid:boolean;data_checksum:string;initialization_id:string;calculation_status:'READY'|'PARTIAL'|'WARMUP'|'DATA_UNAVAILABLE';scale_before:number|null;
  hold_fraction:number|null;penetration_component:number|null;test_freshness:number|null;
  active:SbsBox|null;pending:SbsBox|null;events:SbsEvent[];
}
export interface SbsCheckpoint {
  checkpoint_version:1;feature_id:typeof SBS5M_ID;feature_version:string;config_hash:string;config:SbsConfig;
  symbol:string;timeframe:'5m';data_source:string;data_version:string;volume_mode:SbsVolumeMode;
  tick_size:number|null;last_time:number|null;first_time:number|null;initialization_id:string;data_checksum:string;not_before:number;points:SbsPoint[];
  active:SbsBox|null;pending:SbsBox|null;history:SbsBox[];events:SbsEvent[];
}
export interface SbsOptions {symbol:string;dataSource?:string;dataVersion?:string;tickSize?:number|null;config?:Partial<SbsConfig>;checkpoint?:SbsCheckpoint;asOf?:number;initializationId?:string}
const emptyTest=():SbsTest=>({status:'WAITING_FOR_DEPARTURE',started_at:null,completed_at:null,ended_at:null,armed_at:null});
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
/** Finite-window exponential mean: a missing or nonfinite member never becomes zero. */
export function sbsAverage<T>(values:readonly T[],anchor:number,halfLifeMs:number,value:(x:T)=>number|null,at:(x:T)=>number):number|null {
  if(!values.length)return null;let numerator=0,denominator=0;
  for(const x of values){const v=value(x),t=at(x);if(v===null||!finite(v)||!finite(t)||t>anchor)return null;const w=2**(-(anchor-t)/halfLifeMs);numerator+=w*v;denominator+=w;}
  return denominator>0?numerator/denominator:null;
}
export function sbsQuality(h:number|null,d:number|null,f:number|null):number|null {return h===null||d===null||f===null||![h,d,f].every(finite)?null:100*Math.cbrt(h*d*f);}
const priceValid=(b:SbsBar)=>[b.open,b.high,b.low,b.close].every(positive)&&b.low<=Math.min(b.open,b.close)&&Math.max(b.open,b.close)<=b.high;

/** A single causal state machine powers batch replay and incremental/checkpoint consumers. */
export class Sbs5mEngine {
  readonly config:SbsConfig;readonly config_hash:string;readonly symbol:string;readonly data_source:string;readonly data_version:string;
  readonly asOf:number;readonly initialization_id:string;data_checksum:string;first_time:number|null=null;tick_size:number|null;last_time:number|null=null;not_before=-1;
  points:SbsPoint[]=[];active:SbsBox|null=null;pending:SbsBox|null=null;history:SbsBox[]=[];events:SbsEvent[]=[];
  constructor(options:SbsOptions){
    this.config=sbsParameters(options.config??options.checkpoint?.config);this.config_hash=sbsConfigHash(this.config);
    this.symbol=options.symbol;this.data_source=options.dataSource??'binance';this.data_version=options.dataVersion??'closed-bars-v1';this.asOf=options.asOf??Infinity;this.tick_size=options.tickSize??options.checkpoint?.tick_size??null;
    this.initialization_id=options.initializationId??options.checkpoint?.initialization_id??'explicit-sequence-v1';this.data_checksum=hash(canonical([this.symbol,this.data_source,this.data_version,this.initialization_id]));
    if(!this.symbol||!this.data_source||!this.data_version)throw new Error('SBS-5M 需要品种、数据源和数据版本');
    const c=options.checkpoint;
    if(c){if(c.checkpoint_version!==1||c.feature_id!==SBS5M_ID||c.feature_version!==SBS5M_VERSION||c.config_hash!==this.config_hash||c.symbol!==this.symbol||c.timeframe!=='5m'||c.data_source!==this.data_source||c.data_version!==this.data_version||c.volume_mode!==this.config.volume_mode||c.tick_size!==this.tick_size||c.initialization_id!==this.initialization_id)throw new Error('SBS-5M 检查点身份、版本或参数不一致');
      const copy=structuredClone(c);this.last_time=copy.last_time;this.first_time=copy.first_time;this.data_checksum=copy.data_checksum;this.not_before=copy.not_before;this.points=copy.points;this.active=copy.active;this.pending=copy.pending;this.history=copy.history;this.events=copy.events;
    }
  }
  checkpoint():SbsCheckpoint {return structuredClone({checkpoint_version:1,feature_id:SBS5M_ID,feature_version:SBS5M_VERSION,config_hash:this.config_hash,config:this.config,symbol:this.symbol,timeframe:'5m',data_source:this.data_source,data_version:this.data_version,volume_mode:this.config.volume_mode,tick_size:this.tick_size,last_time:this.last_time,first_time:this.first_time,initialization_id:this.initialization_id,data_checksum:this.data_checksum,not_before:this.not_before,points:this.points,active:this.active,pending:this.pending,history:this.history,events:this.events});}
  private event(box:SbsBox,type:string,at:number|null,reasons:string[]=[],step?:number){const e:SbsEvent={id:'sbs-event-'+hash(canonical([box.box_id,type,at])),type,at,box_id:box.box_id,parent_box_id:box.parent_box_id,episode_id:box.episode_id,reason_codes:reasons,support_price:box.s,box_top:box.u,invalidation_price:box.K,...(step!==undefined?{step_event_height:step}:{})};if(!this.events.some(x=>x.id===e.id))this.events.push(e);}
  private finish(box:SbsBox,state:SbsBox['state'],at:number|null,reasons:string[]){box.state=state;box.ended_at=at;if(state==='INVALID')box.invalidated_at=at;if(state==='STALE'||state==='EXPIRED')box.expired_at=at;this.history.push(structuredClone(box));this.event(box,state,at,reasons);this.not_before=Math.max(this.not_before,at??this.last_time??-1);}
  private terminateActive(state:SbsBox['state'],at:number|null,reasons:string[]){if(!this.active)return;this.finish(this.active,state,at,reasons);this.active=null;if(this.pending){this.finish(this.pending,'PARENT_TERMINATED',at,['PARENT_TERMINATED']);this.pending=null;}}
  private terminatePending(state:SbsBox['state'],at:number|null,reasons:string[]){if(!this.pending)return;this.finish(this.pending,state,at,reasons);this.pending=null;}
  private count(values:readonly SbsPoint[],n:number){return values.length===n&&values.every((p,i)=>i===0||p.at===values[i-1].at+SBS5M_STEP);}
  private touches(box:SbsBox,p:SbsPoint,prior:SbsPoint|undefined){
    const refs=this.points.slice(-this.config.turnover_reference_bars);
    const ref=this.count(refs,this.config.turnover_reference_bars)?sbsAverage(refs,refs.at(-1)!.at,this.config.turnover_reference_half_life*60000,x=>x.amount,x=>x.at):null;
    return p.at>box.frozen_at&&!!prior&&prior.bar.close>=box.s+2*box.delta&&p.bar.low<=box.s+box.delta&&p.bar.high>=box.s-box.delta&&p.amount>0&&ref!==null&&ref>0&&p.amount>=this.config.test_min_turnover_ratio*ref;
  }
  private destroyed(box:SbsBox,p:SbsPoint){if(p.at<=box.frozen_at)return false;box.below=p.bar.close<box.s?box.below+1:0;box.max_penetration=Math.max(box.max_penetration,Math.max(box.s-p.bar.low,0)/box.a0);return p.bar.low<=box.K||box.below>=2;}
  private newCandidate(p:SbsPoint):SbsBox|null {
    const c=this.config,form=[...this.points,p].slice(-c.box_formation_bars),scale=p.scale;
    if(!positive(scale)||!this.count(form,c.box_formation_bars)||form[0].at<=this.not_before||form.some(x=>!(x.amount>0)||!positive(x.scale)))return null;
    const parent=this.active;
    if(parent&&(parent.breakout_at===null||form[0].at<=parent.breakout_at))return null;
    const s=Math.min(...form.map(x=>x.bar.low)),u=Math.max(...form.map(x=>x.bar.high)),W=u-s;
    const path=form.slice(1).reduce((n,x,i)=>n+Math.abs(x.bar.close-form[i].bar.close),0),ER=path===0?0:Math.abs(form.at(-1)!.bar.close-form[0].bar.close)/path;
    if(W<c.box_min_width_ticks*p.tick||W>c.box_max_width_scale*scale||ER>c.box_max_efficiency_ratio||form.some(x=>(Math.min(x.bar.open,x.bar.close)-x.bar.low)/x.scale!>=c.formation_max_lower_wick_scale))return null;
    const delta=Math.max(p.tick,Math.min(c.touch_band_scale*scale,W*c.touch_band_width_fraction)),K=s-c.invalidation_buffer_scale*scale;
    if(p.bar.close<s+2*delta)return null;
    if(parent&&(s-parent.s<Math.max(c.step_min_raise_ticks*p.tick,c.step_min_raise_scale*scale)||u-parent.u<p.tick||K-parent.K<p.tick))return null;
    const parentCopy=parent?{box_id:parent.box_id,support_price:parent.s,box_top:parent.u,invalidation_price:parent.K,confirmed_at:parent.confirmed_at!,breakout_at:parent.breakout_at!}:null;
    const id='sbs-box-'+hash(canonical([this.symbol,'5m',this.data_source,this.data_version,SBS5M_VERSION,this.config_hash,this.config.volume_mode,p.tick,this.data_checksum,form[0].at,p.at,parent?.box_id??null]));
    return {box_id:id,parent_box_id:parent?.box_id??null,parent:parentCopy,episode_id:parent?.episode_id??null,s,u,W,a0:scale,delta,K,tick:p.tick,formation_start:form[0].at,formation_end:p.at,frozen_at:p.at,confirmed_at:null,breakout_at:null,last_successful_test_at:null,invalidated_at:null,expired_at:null,test_started_at:null,test_completed_at:null,ended_at:null,state:'PENDING',below:0,above:0,max_penetration:0,retest:emptyTest(),feature_version:SBS5M_VERSION,config_hash:this.config_hash,data_checksum_at_freeze:this.data_checksum};
  }
  push(bar:SbsBar):SbsRow|null {
    if(bar.SBS5M_closed===false||bar.PRS6H_closed===false)return null;
    const timeOk=finite(bar.openTime)&&Number.isInteger(bar.openTime)&&bar.openTime>=0&&bar.openTime%SBS5M_STEP===0;
    const at=timeOk?bar.openTime+SBS5M_STEP:null;
    if(at!==null&&(at>this.asOf||this.last_time!==null&&at<=this.last_time))return null;
    if(this.first_time===null&&at!==null)this.first_time=at;
    this.data_checksum=hash(canonical([this.data_checksum,bar.openTime,bar.open,bar.high,bar.low,bar.close,bar.quoteVolume,bar.volume,bar.SBS5M_tick_size??this.tick_size]));
    const startEvents=this.events.length,c=this.config,reasons:string[]=[];
    let supportStatus:SbsSupportStatus='NO_STRUCTURE',candidateStatus:SbsCandidateStatus='NONE',terminal:SbsBox|null=null,stepEvent:number|null=null,baseline=false;
    const tick=bar.SBS5M_tick_size??this.tick_size;
    const amount=c.volume_mode==='quote'?bar.quoteVolume:finite(bar.volume)&&finite(bar.close)?bar.volume*bar.close:null;
    const valid=timeOk&&priceValid(bar)&&finite(amount)&&amount>=0&&positive(tick);
    const gap=at!==null&&this.last_time!==null&&at!==this.last_time+SBS5M_STEP;
    const changedTick=positive(tick)&&positive(this.tick_size)&&tick!==this.tick_size;
    const prior=this.points.at(-1);
    const ref=this.points.slice(-c.volatility_lookback_bars);
    const scale=this.count(ref,c.volatility_lookback_bars)?sbsAverage(ref,ref.at(-1)!.at,c.volatility_half_life*60000,x=>x.tr,x=>x.at):null;
    const currentScale=positive(scale)?scale:null;
    if(!valid||gap||changedTick){
      const reason=gap?'DATA_GAP':changedTick?'TICK_SIZE_CHANGED':!timeOk?'INVALID_TIMESTAMP':!priceValid(bar)?'INVALID_OHLC':!finite(amount)||amount<0?'INVALID_TURNOVER':'MISSING_TICK_SIZE';
      reasons.push(reason);terminal=this.active?structuredClone(this.active):null;
      this.terminateActive('DATA_UNAVAILABLE',at,[reason]);this.terminatePending('DATA_UNAVAILABLE',at,[reason]);
      supportStatus='DATA_UNAVAILABLE';candidateStatus='DATA_UNAVAILABLE';this.points=[];this.not_before=Math.max(this.not_before,at??this.last_time??-1);
      if(positive(tick))this.tick_size=tick;
      if(valid&&at!==null)this.points.push({at,bar:{...bar},amount:amount!,tr:null,scale:null,tick:tick!});
      if(at!==null)this.last_time=at;
      return this.row(at,null,false,supportStatus,candidateStatus,terminal,null,false,reasons,startEvents);
    }
    const p:SbsPoint={at:at!,bar:{...bar},amount:amount!,tick:tick!,scale:currentScale,tr:prior?Math.max(bar.high-bar.low,Math.abs(bar.high-prior.bar.close),Math.abs(bar.low-prior.bar.close)):null};
    this.tick_size=tick!;
    // Priority 2/3: a parent termination cancels its dependent candidate before tests can finish.
    if(this.active&&this.destroyed(this.active,p)){
      terminal=structuredClone(this.active);terminal.invalidated_at=p.at;supportStatus='INVALID';reasons.push('ACTIVE_PRICE_INVALID');this.terminateActive('INVALID',p.at,['ACTIVE_PRICE_INVALID']);candidateStatus='PARENT_TERMINATED';
    }else if(this.active&&p.at-this.active.confirmed_at!>=c.active_box_max_age*3600000){
      terminal=structuredClone(this.active);terminal.expired_at=p.at;supportStatus='STALE';reasons.push('ACTIVE_EXPIRED');this.terminateActive('STALE',p.at,['ACTIVE_EXPIRED']);candidateStatus='PARENT_TERMINATED';
    }
    // Priority 4: candidate expiry wins even if that same close could complete its test.
    if(this.pending){
      if(this.destroyed(this.pending,p)){candidateStatus='INVALID';reasons.push('CANDIDATE_PRICE_INVALID');this.terminatePending('INVALID',p.at,['CANDIDATE_PRICE_INVALID']);}
      else if(p.at-this.pending.frozen_at>=c.candidate_max_age*60000){candidateStatus='EXPIRED';reasons.push('CANDIDATE_EXPIRED');this.terminatePending('EXPIRED',p.at,['CANDIDATE_EXPIRED']);}
      else if(this.pending.parent_box_id&&this.active?.box_id!==this.pending.parent_box_id){candidateStatus='PARENT_TERMINATED';this.terminatePending('PARENT_TERMINATED',p.at,['PARENT_TERMINATED']);}
    }
    // Priority 5/6: only candles strictly after freeze can start the independent test.
    if(this.pending){
      const box=this.pending;
      if(box.test_started_at===null&&this.touches(box,p,prior)){box.test_started_at=p.at;this.event(box,'TEST_STARTED',p.at);}
      if(box.test_started_at!==null){
        if(bar.close>=box.s+2*box.delta){
          box.test_completed_at=p.at;box.last_successful_test_at=p.at;this.event(box,'TEST_SUCCEEDED',p.at);
          const old=this.active;
          if(!box.parent_box_id||old?.box_id===box.parent_box_id){
            box.confirmed_at=p.at;box.state='ACTIVE';box.above=0;box.breakout_at=null;box.retest=emptyTest();box.retest.ended_at=p.at;
            if(old){stepEvent=(box.s-old.s)/box.a0;box.episode_id=old.episode_id;this.finish(old,'REPLACED',p.at,['HIGHER_BOX_CONFIRMED']);}
            else{baseline=true;box.episode_id='sbs-episode-'+hash(canonical([box.box_id,p.at]));}
            this.active=box;this.pending=null;candidateStatus='CONFIRMED';this.event(box,old?'STEP_CONFIRMED':'BASELINE_CONFIRMED',p.at,[],stepEvent??undefined);
          }
        }else if(p.at-box.test_started_at>=(c.test_max_bars-1)*SBS5M_STEP){candidateStatus='FAILED';reasons.push('CANDIDATE_TEST_FAILED');this.terminatePending('TEST_FAILED',p.at,['CANDIDATE_TEST_FAILED']);}
      }
    }
    // Priority 7: timeout is a failed observation, never an additional hard invalidation rule.
    if(this.active&&p.at>this.active.confirmed_at!){
      const box=this.active,t=box.retest;
      if(t.status==='TESTING'){
        if(bar.close>=box.s+2*box.delta){t.status='SUCCEEDED';t.completed_at=p.at;t.ended_at=p.at;t.armed_at=null;box.last_successful_test_at=p.at;this.event(box,'RETEST_SUCCEEDED',p.at);}
        else if(p.at-t.started_at!>=(c.test_max_bars-1)*SBS5M_STEP){t.status='FAILED';t.ended_at=p.at;t.armed_at=null;reasons.push('RETEST_FAILED');this.event(box,'RETEST_FAILED',p.at,['RETEST_FAILED']);}
      }else if(t.armed_at!==null&&p.at>t.armed_at&&this.touches(box,p,prior)){
        t.started_at=p.at;t.completed_at=null;t.status='TESTING';this.event(box,'RETEST_STARTED',p.at);
        if(bar.close>=box.s+2*box.delta){t.status='SUCCEEDED';t.completed_at=p.at;t.ended_at=p.at;t.armed_at=null;box.last_successful_test_at=p.at;this.event(box,'RETEST_SUCCEEDED',p.at);}
        else if(c.test_max_bars===1){t.status='FAILED';t.ended_at=p.at;t.armed_at=null;reasons.push('RETEST_FAILED');this.event(box,'RETEST_FAILED',p.at,['RETEST_FAILED']);}
      }else if(t.armed_at===null&&p.at>(t.ended_at??box.confirmed_at!)&&bar.close>=box.s+2*box.delta){t.armed_at=p.at;t.status='ARMED';}
    }
    // Priority 8: a new active box starts its own two-close breakout count from zero.
    if(this.active&&p.at>this.active.confirmed_at!&&this.active.breakout_at===null){
      const box=this.active;box.above=bar.close>box.u+Math.max(box.tick,c.breakout_buffer_scale*box.a0)?box.above+1:0;
      if(box.above>=c.breakout_confirm_bars){box.breakout_at=p.at;this.event(box,'BREAKOUT_CONFIRMED',p.at);}
    }
    if(!this.pending&&!terminal){const box=this.newCandidate(p);if(box){this.pending=box;candidateStatus='FROZEN';this.event(box,'FROZEN',p.at);}}
    this.points.push(p);const keep=Math.max(c.volatility_lookback_bars,c.box_formation_bars,c.turnover_reference_bars,Math.ceil(c.quality_lookback/5))+1;this.points=this.points.slice(-keep);this.last_time=p.at;
    if(currentScale===null)reasons.push('PRIOR_VOLATILITY_UNAVAILABLE');
    return this.row(p.at,currentScale,true,supportStatus,candidateStatus,terminal,stepEvent,baseline,reasons,startEvents);
  }
  private row(at:number|null,scale:number|null,valid:boolean,status:SbsSupportStatus,candidateStatus:SbsCandidateStatus,terminal:SbsBox|null,step:number|null,baseline:boolean,reasons:string[],startEvents:number):SbsRow {
    const box=this.active,p=this.pending,c=this.config;let h:number|null=null,d:number|null=null,f:number|null=null;
    if(box&&at!==null&&valid){
      const seen=this.points.filter(x=>x.at>box.frozen_at&&at-c.quality_lookback*60000<x.at&&x.at<=at&&x.amount>0);
      h=sbsAverage(seen,at,c.quality_half_life*60000,x=>x.bar.close>=box.s?1:0,x=>x.at);
      d=Math.min(1,Math.max(0,1-box.max_penetration/.5));
      f=box.last_successful_test_at===null?null:2**(-(at-box.last_successful_test_at)/(c.test_freshness_half_life*60000));
      if(h===null)reasons.push('NO_RECENT_TURNOVER_EVIDENCE');
    }
    const quality=box&&valid?sbsQuality(h,d,f):null;
    return {at,support_price:box?.s??null,box_top:box?.u??null,invalidation_price:box?.K??null,support_quality:quality,support_status:box?'ACTIVE':status,
      candidate_status:p?p.test_started_at===null?'FROZEN':'TESTING':candidateStatus,retest_status:box?.retest.status??'NONE',
      candidate_support_price:p?.s??null,candidate_box_top:p?.u??null,candidate_invalidation_price:p?.K??null,
      distance_to_support:box&&scale!==null&&this.points.length?(this.points.at(-1)!.bar.close-box.s)/scale:null,
      step_height_atr:box?baseline?null:step??0:null,step_event_height:step,
      box_id:box?.box_id??terminal?.box_id??null,parent_box_id:box?.parent_box_id??terminal?.parent_box_id??null,episode_id:box?.episode_id??terminal?.episode_id??null,candidate_box_id:p?.box_id??null,
      frozen_at:box?.frozen_at??null,confirmed_at:box?.confirmed_at??null,breakout_at:box?.breakout_at??null,last_successful_test_at:box?.last_successful_test_at??null,invalidated_at:terminal?.invalidated_at??null,expired_at:terminal?.expired_at??null,
      reason_codes:[...new Set(reasons)],feature_version:SBS5M_VERSION,config_hash:this.config_hash,volume_mode:c.volume_mode,data_valid:valid,data_checksum:this.data_checksum,initialization_id:this.initialization_id,
      calculation_status:!valid?'DATA_UNAVAILABLE':scale===null?'WARMUP':box&&quality===null?'PARTIAL':'READY',scale_before:scale,
      hold_fraction:h,penetration_component:d,test_freshness:f,active:box?structuredClone(box):null,pending:p?structuredClone(p):null,events:this.events.slice(startEvents).map(x=>structuredClone(x))};
  }
}
export function computeSbs5m(bars:readonly SbsBar[],options:SbsOptions){const engine=new Sbs5mEngine(options),rows=bars.flatMap(bar=>{const row=engine.push(bar);return row?[row]:[];});return {rows,checkpoint:engine.checkpoint(),history:engine.history,events:engine.events};}
export const SBS5M_FIELDS=['SBS5M','SBS5M_episode_token','SBS5M_candidate_token','SBS5M_support_price','SBS5M_box_top','SBS5M_invalidation_price','SBS5M_support_quality','SBS5M_distance_to_support','SBS5M_step_height_atr','SBS5M_step_event_height','SBS5M_candidate_support_price','SBS5M_candidate_box_top','SBS5M_candidate_invalidation_price','SBS5M_scale_before','SBS5M_frozen_at','SBS5M_confirmed_at','SBS5M_breakout_at','SBS5M_last_successful_test_at','SBS5M_invalidated_at','SBS5M_expired_at'] as const;
export function sbsNumeric(row:SbsRow,name:string):number|null {if(name==='SBS5M_episode_token')return row.episode_id?parseInt(hash(row.episode_id).slice(0,12),16):null;if(name==='SBS5M_candidate_token')return row.candidate_box_id?parseInt(hash(row.candidate_box_id).slice(0,12),16):null;const key=name==='SBS5M'?'support_price':name.slice('SBS5M_'.length);const v=row[key as keyof SbsRow];return typeof v==='number'&&Number.isFinite(v)?v:null;}
/** Explicit source contract; no existing PRS/default consumer is changed. */
export function sbsSupportSource(row:SbsRow){return {source:SBS5M_ID,version:SBS5M_VERSION,config_hash:row.config_hash,support_price:row.support_price,invalidation_price:row.invalidation_price,status:row.support_status,test_status:row.retest_status,quality:row.support_quality,box_id:row.box_id,episode_id:row.episode_id,data_valid:row.data_valid};}
