/** ATI-6H v1: causal market evidence only. No positions, orders or execution thresholds. */
import type { ResearchBar } from './deepRsa/window';
export const ATI6H_VERSION = 'ati6h-v1';
export type AtiVolumeMode = 'taker' | 'bar_direction_proxy';
export const ATI6H_COMPONENTS = ['A','B','C','D','E','F'] as const;
export type AtiComponent = typeof ATI6H_COMPONENTS[number];
export const ATI6H_LABELS = {A:'买方确认',B:'固定支撑有效性',C:'下行与成交方向支持',D:'近期插针风险低',E:'前方阻力空间',F:'调整后突破前高并维持'};
export const ATI6H_DEFAULTS = {
 WINDOW_HOURS:6, HALF_LIFE_HOURS:1, PIVOT_CONFIRM_MINUTES:10, ADJUST_MIN_MINUTES:15,
 ADJUST_DEPTH_SIGMA:1, BAND_SIGMA:.5, INITIAL_SUPPORT_CAP:.5, RETEST_MAX_MINUTES:30,
 WICK_OK:1.5, WICK_BAD:3, RESISTANCE_ROOM_SIGMA:3,
 WEIGHTS:{A:.15,B:.35,C:.20,D:.10,E:.10,F:.10},
} as const;
export interface AtiParams {
 WINDOW_HOURS:number; HALF_LIFE_HOURS:number; PIVOT_CONFIRM_MINUTES:number; ADJUST_MIN_MINUTES:number;
 ADJUST_DEPTH_SIGMA:number; BAND_SIGMA:number; INITIAL_SUPPORT_CAP:number; RETEST_MAX_MINUTES:number;
 WICK_OK:number; WICK_BAD:number; RESISTANCE_ROOM_SIGMA:number; WEIGHTS:Record<AtiComponent,number>;
}
export type AtiParameters = Partial<Omit<AtiParams,'WEIGHTS'>> & {WEIGHTS?:Record<AtiComponent,number>};
export function atiParams(p:AtiParameters={}):AtiParams {
 const out={...ATI6H_DEFAULTS,...p,WEIGHTS:{...ATI6H_DEFAULTS.WEIGHTS,...p.WEIGHTS}};
 if(Object.entries(out).some(([k,v])=>k!=='WEIGHTS'&&(!Number.isFinite(v)||Number(v)<=0))||out.INITIAL_SUPPORT_CAP>1||out.WICK_BAD<=out.WICK_OK||Object.values(out.WEIGHTS).some(w=>!Number.isFinite(w)||w<=0)||Math.abs(Object.values(out.WEIGHTS).reduce((a,b)=>a+b,0)-1)>1e-12)throw Error('ATI6H 参数无效：正尺度、递增插针映射，正权重合计1');
 return out;
}
export const atiClip=(x:number)=>Math.min(1,Math.max(0,x));
export const atiRamp=(x:number,a:number,b:number)=>atiClip((x-a)/(b-a));
export function atiComposite(s:Record<AtiComponent,number|null>,weights:Record<AtiComponent,number>=ATI6H_DEFAULTS.WEIGHTS){
 if(ATI6H_COMPONENTS.some(k=>s[k]===null||!Number.isFinite(s[k])))return {ATI6H:null,ATI6H_min:null,ATI6H_shortboard:null};
 const min=Math.min(...ATI6H_COMPONENTS.map(k=>s[k]!));
 return {ATI6H:min===0?0:Math.exp(ATI6H_COMPONENTS.reduce((sum,k)=>sum+weights[k]*Math.log(s[k]!),0)),ATI6H_min:min,ATI6H_shortboard:ATI6H_COMPONENTS.find(k=>s[k]===min)!};
}
export interface AtiInput { bar:ResearchBar; mbi2State:number|null; sigmaBefore:number|null; tickSize:number|null }
interface Point extends AtiInput { index:number; time:number; o:number; h:number; l:number; x:number; v:number|null; valid:boolean }
interface High { index:number; time:number; leftAt:number; high:number; delta:number; confirmedAt:number }
export interface AtiStructure {
 ATI6H_structure_id:string; ATI6H_structure_status:'valid'|'broken'|'expired'|'replaced'|'unverifiable';
 ATI6H_high_anchor_at:number; ATI6H_low_anchor_at:number; ATI6H_structure_confirmed_at:number;
 ATI6H_high_left_at:number; ATI6H_low_left_at:number; ATI6H_H_star:number; ATI6H_S_star:number;
 ATI6H_v_0:number; ATI6H_delta_S:number; ATI6H_delta_H:number;
 ATI6H_support_price:number; ATI6H_support_zone_lower:number; ATI6H_support_zone_upper:number; ATI6H_support_failure_price:number;
 ATI6H_pre_adjustment_high:number; ATI6H_breakout_price:number; ATI6H_breakout_first_observed_at:number|null;
 ATI6H_ended_at:number|null;
}
export interface AtiEvent { ATI6H_type:string; ATI6H_at:number; ATI6H_structure_id:string|null; ATI6H_touch_at?:number }
export interface AtiRow extends Record<string,unknown> {
 ATI6H:number|null; ATI6H_at:number; ATI6H_sA:number|null; ATI6H_sB:number|null; ATI6H_sC:number|null; ATI6H_sD:number|null; ATI6H_sE:number|null; ATI6H_sF:number|null;
 ATI6H_min:number|null; ATI6H_shortboard:AtiComponent|null;
 ATI6H_data_status:'complete'|'insufficient'; ATI6H_reason_codes:string[]; ATI6H_volume_mode:AtiVolumeMode; ATI6H_version:string;
 ATI6H_structure:AtiStructure|null; ATI6H_events:AtiEvent[]; ATI6H_parameters:AtiParams;
}
export class Ati6hEngine {
 readonly parameters:AtiParams; readonly stepMs:number; readonly mode:AtiVolumeMode;
 readonly ATI6H_archive:AtiStructure[]=[];
 private points:Point[]=[]; private highs:High[]=[]; private active:AtiStructure|null=null; private pending:High|null=null;
 private index=-1; private resetAt=-Infinity; private reason='no_structure';
 private departedAt:number|null=null; private touch:Point|null=null; private lastTouch:number|null=null; private lastRetest:number|null=null; private retestStatus='none';
 constructor(options:{minutes?:number;parameters?:AtiParameters;volumeMode?:AtiVolumeMode}={}){
  this.parameters=atiParams(options.parameters);this.stepMs=(options.minutes??5)*60000;this.mode=options.volumeMode??'taker';
  if(!Number.isFinite(this.stepMs)||this.stepMs<=0)throw Error('ATI6H 周期必须大于0');
 }
 push(input:AtiInput):AtiRow {
  const p=this.parameters,bar=input.bar,time=bar.openTime+this.stepMs,index=++this.index,previous=this.points.at(-1);
  const reasons:string[]=[],events:AtiEvent[]=[];
  const emit=(type:string,structure=this.active,touch?:number)=>events.push({ATI6H_type:type,ATI6H_at:time,ATI6H_structure_id:structure?.ATI6H_structure_id??null,...(touch!==undefined?{ATI6H_touch_at:touch}:{})});
  const end=(status:AtiStructure['ATI6H_structure_status'])=>{if(this.active){this.active.ATI6H_structure_status=status;this.active.ATI6H_ended_at=time;emit(status);this.ATI6H_archive.push({...this.active});}this.active=null;this.pending=null;this.departedAt=null;this.touch=null;this.lastTouch=null;this.lastRetest=null;this.retestStatus='none';this.resetAt=time;this.reason=status;};
  const valid=Number.isFinite(bar.openTime)&&bar.openTime%this.stepMs===0&&[bar.open,bar.high,bar.low,bar.close].every(x=>Number.isFinite(x)&&x>0)&&bar.high>=Math.max(bar.open,bar.close)&&bar.low<=Math.min(bar.open,bar.close)&&bar.high>=bar.low;
  const gap=!!previous&&time-previous.time!==this.stepMs;
  if(gap||!valid){end('unverifiable');this.pending=null;this.highs=[];this.resetAt=time;this.reason='awaiting_new_structure';}
  const tickOk=input.tickSize!==null&&Number.isFinite(input.tickSize)&&input.tickSize>0;
  const sigmaOk=input.sigmaBefore!==null&&Number.isFinite(input.sigmaBefore)&&input.sigmaBefore>=0;
  const v=valid&&tickOk&&sigmaOk?Math.max(input.sigmaBefore!,Math.log1p(input.tickSize!/bar.open),1e-12):null;
  const current:Point={...input,index,time,o:Math.log(bar.open),h:Math.log(bar.high),l:Math.log(bar.low),x:Math.log(bar.close),v,valid};
  this.points.push(current);
  const cutoff=time-p.WINDOW_HOURS*3600000;
  // Keep one extra close solely for the first return; it cannot form a pivot/event.
  this.points=this.points.filter(pt=>pt.time>cutoff-this.stepMs);
  const window=this.points.filter(pt=>pt.time>cutoff);
  const complete=window.length===Math.ceil(p.WINDOW_HOURS*3600000/this.stepMs)&&window.every((pt,i)=>pt.valid&&(i===0||pt.time-window[i-1].time===this.stepMs));
  if(!complete)reasons.push('incomplete_window');if(!valid)reasons.push('invalid_ohlc_or_timestamp');if(gap)reasons.push('data_gap');
  if(!tickOk)reasons.push('missing_tick_size');if(!sigmaOk)reasons.push('missing_mbi2_sigma');
  let blocked=gap||!valid;
  if(this.active){
   if(!blocked&&current.l<this.active.ATI6H_S_star-this.active.ATI6H_delta_S){end('broken');blocked=true;}
   else if(this.active.ATI6H_high_left_at<=cutoff||this.active.ATI6H_low_left_at<=cutoff){end('expired');blocked=true;}
  }
  this.highs=this.highs.filter(h=>h.leftAt>cutoff);
  if(this.pending&&this.pending.leftAt<=cutoff)this.pending=null;
  const wasActive=this.active?.ATI6H_structure_id;
  const oldX=previous?.valid?previous.x:NaN;
  const crossedBeforeStructure=!!this.active&&bar.close>this.active.ATI6H_breakout_price;
  if(crossedBeforeStructure&&this.active!.ATI6H_breakout_first_observed_at===null){this.active!.ATI6H_breakout_first_observed_at=time;emit('breakout_first_observed');}
  const pivotBars=Math.ceil(p.PIVOT_CONFIRM_MINUTES*60000/this.stepMs),center=this.points.find(pt=>pt.index===index-pivotBars);
  if(!blocked&&center){
   const around=this.points.filter(pt=>Math.abs(pt.index-center.index)<=pivotBars);
   const left=around.filter(pt=>pt.index<center.index),right=around.filter(pt=>pt.index>center.index);
   if(around.length===2*pivotBars+1&&around.every((pt,i)=>pt.valid&&pt.time>cutoff&&(i===0||pt.time-around[i-1].time===this.stepMs))){
    const isHigh=left.every(pt=>center.h>=pt.h)&&right.every(pt=>center.h>pt.h),isLow=left.every(pt=>center.l<=pt.l)&&right.every(pt=>center.l<pt.l);
    let high:High|null=null;
    if(isHigh&&v!==null){high={index:center.index,time:center.time,leftAt:left[0].time,high:center.h,delta:p.BAND_SIGMA*v,confirmedAt:time};this.highs.push(high);}
    const eligible=(!this.active||this.active.ATI6H_breakout_first_observed_at!==null)&&!isLow;
    if(high&&eligible&&high.time>this.resetAt&&(!this.active||(high.high>this.active.ATI6H_H_star&&high.time>=this.active.ATI6H_breakout_first_observed_at!))&&(!this.pending||high.high>=this.pending.high))this.pending=high;
    if(isLow&&!isHigh&&this.pending&&v!==null){
     const h=this.pending,segment=this.points.filter(pt=>pt.index>=h.index&&pt.index<=center.index);
     if(center.time-h.time>=p.ADJUST_MIN_MINUTES*60000&&center.index>h.index&&segment.length===center.index-h.index+1&&segment.every(pt=>pt.h<=h.high)&&segment.filter(pt=>pt.index>h.index).every(pt=>pt.l>=center.l)&&h.high-center.l>=p.ADJUST_DEPTH_SIGMA*v){
      const delta=p.BAND_SIGMA*v;
      if(this.active&&(center.l<=this.active.ATI6H_S_star||center.l-delta<this.active.ATI6H_S_star-this.active.ATI6H_delta_S)){this.pending=null;this.resetAt=center.time;}
      else {
       if(this.active){this.active.ATI6H_structure_status='replaced';this.active.ATI6H_ended_at=time;this.ATI6H_archive.push({...this.active});emit('replaced');}
       const lower=Math.exp(center.l-delta);
       this.active={ATI6H_structure_id:`ati6h-${h.time}-${center.time}-${time}`,ATI6H_structure_status:'valid',ATI6H_high_anchor_at:h.time,ATI6H_low_anchor_at:center.time,ATI6H_structure_confirmed_at:time,ATI6H_high_left_at:h.leftAt,ATI6H_low_left_at:left[0].time,ATI6H_H_star:h.high,ATI6H_S_star:center.l,ATI6H_v_0:v,ATI6H_delta_S:delta,ATI6H_delta_H:h.delta,ATI6H_support_price:Math.exp(center.l),ATI6H_support_zone_lower:lower,ATI6H_support_zone_upper:Math.exp(center.l+delta),ATI6H_support_failure_price:lower,ATI6H_pre_adjustment_high:Math.exp(h.high),ATI6H_breakout_price:Math.exp(h.high+h.delta),ATI6H_breakout_first_observed_at:null,ATI6H_ended_at:null};
       this.pending=null;this.departedAt=null;this.touch=null;this.lastTouch=null;this.lastRetest=null;this.retestStatus='none';this.reason='valid';emit('support_confirmed');
      }
     }
    }
   }
  }
  const s:Record<AtiComponent,number|null>={A:input.mbi2State!==null&&[-2,-1,0,1,2].includes(input.mbi2State)?(input.mbi2State===2?1:0):null,B:complete?0:null,C:null,D:null,E:null,F:complete?0:null};
  if(s.A===null)reasons.push('missing_mbi2_state');
  const a=(then:number)=>2**(-(time-then)/(p.HALF_LIFE_HOURS*3600000));
  let initial=0,retest=0,position=0,cross=false;
  const active=this.active;
  if(active){
   const J=active.ATI6H_S_star+2*active.ATI6H_delta_S;
   if(this.touch){
    const elapsed=time-this.touch.time;
    if(elapsed>p.RETEST_MAX_MINUTES*60000){emit('failed_retest',active,this.touch.time);this.touch=null;this.departedAt=null;this.retestStatus='failed_retest';}
    else if(elapsed>0&&current.x>=J){this.lastRetest=time;emit('retest_confirmed',active,this.touch.time);this.touch=null;this.departedAt=time;this.retestStatus='confirmed';}
   }else if(this.departedAt!==null&&time>this.departedAt&&current.l<=active.ATI6H_S_star+active.ATI6H_delta_S){this.touch=current;this.lastTouch=time;this.departedAt=null;this.retestStatus='pending';emit('touch',active,time);}
   else if(this.departedAt===null&&current.x>=J)this.departedAt=time;
   initial=p.INITIAL_SUPPORT_CAP*a(active.ATI6H_structure_confirmed_at);retest=this.lastRetest===null?0:a(this.lastRetest);position=atiRamp(current.x,active.ATI6H_S_star-active.ATI6H_delta_S,J);
   if(complete){s.B=position*Math.max(initial,retest);s.F=bar.close>active.ATI6H_breakout_price?1:0;}
   if(bar.close>active.ATI6H_breakout_price&&active.ATI6H_breakout_first_observed_at===null){active.ATI6H_breakout_first_observed_at=time;emit('breakout_first_observed');}
   cross=wasActive===active.ATI6H_structure_id&&previous!.bar.close<=active.ATI6H_breakout_price&&bar.close>active.ATI6H_breakout_price;
   if(cross)emit('breakout_cross');
  }else reasons.push(this.reason==='no_structure'?'no_structure':this.reason,'awaiting_new_structure');
  const rawWeights=window.map(pt=>a(pt.time)),sum=rawWeights.reduce((x,y)=>x+y,0);
  let up=0,down=0,buy=0,sell=0,returnsOk=complete,amountsOk=complete,scalesOk=complete,WD=0,maxWick=0,maxWickAt:number|null=null,worstAt:number|null=null;
  for(let j=0;j<window.length;j++){
   const pt=window[j],prev=this.points.find(v=>v.index===pt.index-1),w=rawWeights[j]/sum;
   const r=prev?.valid&&pt.valid&&pt.time-prev.time===this.stepMs?pt.x-prev.x:NaN;
   if(!Number.isFinite(r))returnsOk=false;else {up+=w*Math.max(r,0)**2;down+=w*Math.max(-r,0)**2;}
   const V=pt.bar.quoteVolume,B=pt.bar.takerBuyQuoteVolume;
   if(V==null||!Number.isFinite(V)||V<0){amountsOk=false;if(complete)reasons.push(V==null?'missing_quote_volume':'invalid_quote_volume');}
   else if(this.mode==='taker'){
    if(B==null||!Number.isFinite(B)||B<0||B>V){amountsOk=false;if(complete)reasons.push(B==null?'missing_taker_volume':'invalid_taker_volume');}
    else{buy+=w*B;sell+=w*(V-B);}
   }else if(Number.isFinite(r)){buy+=w*V*(r>0?1:r===0?.5:0);sell+=w*V*(r<0?1:r===0?.5:0);}else amountsOk=false;
   if(pt.v===null||!pt.valid){scalesOk=false;if(complete)reasons.push('missing_window_scale');}
   else{const u=(Math.min(pt.o,pt.x)-pt.l)/pt.v,weighted=rawWeights[j]*u;if(maxWickAt===null||u>=maxWick){maxWick=u;maxWickAt=pt.time;}if(worstAt===null||weighted>=WD){WD=weighted;worstAt=pt.time;}}
  }
  if(!returnsOk&&complete)reasons.push('missing_return_boundary');
  const CP=returnsOk?(up+down>0?up/(up+down):.5):null,CV=amountsOk&&buy+sell>0?buy/(buy+sell):null;
  if(amountsOk&&buy+sell===0)reasons.push('zero_volume');
  s.C=CP===null||CV===null?null:Math.sqrt(CP*CV);s.D=scalesOk?1-atiRamp(WD,p.WICK_OK,p.WICK_BAD):null;
  const candidates=this.highs.map(h=>({...h,type:'confirmed' as string}));
  const recent=window.filter(pt=>pt.index<index&&pt.index>=index-pivotBars&&pt.valid).sort((a,b)=>b.h-a.h||b.time-a.time)[0];
  if(recent&&!candidates.some(h=>h.time===recent.time)&&recent.v!==null)candidates.push({index:recent.index,time:recent.time,leftAt:recent.time,high:recent.h,delta:p.BAND_SIGMA*recent.v,confirmedAt:time,type:'unconfirmed_upper'});
  const retained=candidates.filter(h=>bar.close<=Math.exp(h.high+h.delta)).map(h=>({...h,score:v===null?null:atiClip(Math.max(h.high-current.x,0)/(p.RESISTANCE_ROOM_SIGMA*v))})).sort((a,b)=>(a.score??Infinity)-(b.score??Infinity)||(a.type==='confirmed'?0:1)-(b.type==='confirmed'?0:1)||b.time-a.time);
  const nearest=retained[0];
  if(complete&&v!==null&&scalesOk)s.E=nearest?.score??1;
  if(s.E===1&&!nearest)reasons.push('no_resistance_detected_in_6h');
  const composite=atiComposite(s,p.WEIGHTS),structure=active?{...active}:null;
  return {...composite,ATI6H_at:time,ATI6H_sA:s.A,ATI6H_sB:s.B,ATI6H_sC:s.C,ATI6H_sD:s.D,ATI6H_sE:s.E,ATI6H_sF:s.F,ATI6H_data_status:composite.ATI6H===null?'insufficient':'complete',ATI6H_reason_codes:[...new Set(reasons)],ATI6H_volume_mode:this.mode,ATI6H_version:ATI6H_VERSION,ATI6H_parameters:{...p,WEIGHTS:{...p.WEIGHTS}},ATI6H_structure:structure,ATI6H_events:events,...Object.fromEntries(['ATI6H_structure_id','ATI6H_high_anchor_at','ATI6H_low_anchor_at','ATI6H_structure_confirmed_at','ATI6H_support_price','ATI6H_support_zone_lower','ATI6H_support_zone_upper','ATI6H_support_failure_price','ATI6H_pre_adjustment_high','ATI6H_breakout_price','ATI6H_breakout_first_observed_at','ATI6H_v_0','ATI6H_delta_S','ATI6H_delta_H'].map(name=>[name,null])),...(structure??{}),ATI6H_structure_status:structure?.ATI6H_structure_status??this.reason,ATI6H_structure_status_code:structure?1:({broken:-1,expired:-2,unverifiable:-3,no_structure:0,awaiting_new_structure:-4}[this.reason]??-4),ATI6H_breakout_cross_now:cross,ATI6H_nearest_resistance_price:nearest?Math.exp(nearest.high):null,ATI6H_nearest_resistance_breakout_price:nearest?Math.exp(nearest.high+nearest.delta):null,ATI6H_nearest_resistance_type:nearest?.type??null,ATI6H_nearest_resistance_anchor_at:nearest?.time??null,ATI6H_s_CP:CP,ATI6H_s_CV:CV,ATI6H_U_P:returnsOk?up:null,ATI6H_D_P:returnsOk?down:null,ATI6H_U_V:amountsOk?buy:null,ATI6H_D_V:amountsOk?sell:null,ATI6H_downside_rms:returnsOk?Math.sqrt(down):null,ATI6H_no_directional_return:returnsOk&&up+down===0,ATI6H_W_D:scalesOk?WD:null,ATI6H_raw_max_wick:scalesOk?maxWick:null,ATI6H_raw_max_wick_at:scalesOk?maxWickAt:null,ATI6H_weighted_worst_wick_at:scalesOk?worstAt:null,ATI6H_initial_support_evidence:initial,ATI6H_best_retest_evidence:retest,ATI6H_support_position_factor:position,ATI6H_touch_at:this.lastTouch,ATI6H_retest_confirmed_at:this.lastRetest,ATI6H_retest_status:this.retestStatus,ATI6H_tick_size:input.tickSize,ATI6H_tick_size_source:'exchangeInfo PRICE_FILTER (current evaluation snapshot)',ATI6H_dependency_boundary:'ATI local evidence: 6h; external MBI2 and single-log-return RMS retain their own recurrence and warmup'};
 }
}
export function computeAti6h(inputs:readonly AtiInput[],options:ConstructorParameters<typeof Ati6hEngine>[0]={}) {
 const engine=new Ati6hEngine(options);const rows=inputs.map(input=>engine.push(input));
 return {rows,ATI6H_archive:engine.ATI6H_archive};
}
export const ATI6H_NUMERIC_FIELDS=['ATI6H','ATI6H_sA','ATI6H_sB','ATI6H_sC','ATI6H_sD','ATI6H_sE','ATI6H_sF','ATI6H_min','ATI6H_s_CP','ATI6H_s_CV','ATI6H_U_P','ATI6H_D_P','ATI6H_U_V','ATI6H_D_V','ATI6H_downside_rms','ATI6H_W_D','ATI6H_raw_max_wick','ATI6H_raw_max_wick_at','ATI6H_weighted_worst_wick_at','ATI6H_initial_support_evidence','ATI6H_best_retest_evidence','ATI6H_support_position_factor','ATI6H_support_price','ATI6H_support_zone_lower','ATI6H_support_zone_upper','ATI6H_support_failure_price','ATI6H_pre_adjustment_high','ATI6H_breakout_price','ATI6H_nearest_resistance_price','ATI6H_nearest_resistance_breakout_price','ATI6H_breakout_first_observed_at','ATI6H_structure_confirmed_at','ATI6H_high_anchor_at','ATI6H_low_anchor_at','ATI6H_v_0','ATI6H_delta_S','ATI6H_delta_H','ATI6H_touch_at','ATI6H_retest_confirmed_at','ATI6H_structure_status_code'] as const;
