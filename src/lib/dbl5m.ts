import type {ResearchBar} from './deepRsa/window';

export const DBL5_ID='darvas_5m_lower';
export const DBL5_VERSION='dbl-5-v2';
export const DBL5_STEP=300_000;
export interface Dbl5Config extends Dbl5GuardConfig {timeframe:'5m';n:number;window_minutes:number}
export const DBL5_DEFAULTS:Readonly<Dbl5Config>=Object.freeze({timeframe:'5m',n:3,window_minutes:360});
/**
 * 【用户要求】2026-11-02 防守线：箱体下轨把噪音当支撑（SUI 实测 24 次击穿 22 次 1 小时内收回）。
 * 箱体识别不变，另叠一条分行情状态、留足冗余、按收盘确认跌破的线。参数只在用户设置时写入配置，旧定义的配置身份不变。
 */
export interface Dbl5GuardConfig {
  guard_trend_atr?:number;
  guard_range_atr?:number;
  guard_range_closes?:number;
  guard_version?:typeof DBL5_RETEST_GUARD_VERSION;
}
export const DBL5_GUARD_DEFAULTS=Object.freeze({guard_trend_atr:.5,guard_range_atr:1,guard_trend_closes:1,guard_range_closes:2,overlap:.5,atr_period:14});
export const DBL5_GUARD_VERSION='dbl5-guard-v1';
export const DBL5_RETEST_GUARD_VERSION='dbl5-guard-v1-20261112';
export type Dbl5GuardVersion=typeof DBL5_GUARD_VERSION|typeof DBL5_RETEST_GUARD_VERSION;
export const dbl5GuardVersion=(config?:Dbl5GuardConfig):Dbl5GuardVersion=>config?.guard_version??DBL5_GUARD_VERSION;
export const DBL5_GUARD_RETEST=Object.freeze({nearAtr:.5,departureAtr:1});
export function withDbl5GuardVersion(config:Partial<Dbl5Config>|undefined,version:Dbl5GuardVersion):Partial<Dbl5Config> {
  const next={...config};
  if(version===DBL5_RETEST_GUARD_VERSION) next.guard_version=version;
  else delete next.guard_version;
  return next;
}
const GUARD_KEYS=['guard_trend_atr','guard_range_atr','guard_range_closes','guard_version'] as const;
export function dbl5Parameters(input:Partial<Dbl5Config>={}):Dbl5Config {
  for(const key of Object.keys(input))if(!(key in DBL5_DEFAULTS)&&!(GUARD_KEYS as readonly string[]).includes(key))throw Error('DBL-5 未知参数：'+key);
  const p={...DBL5_DEFAULTS,...input},W=p.window_minutes/5;
  for(const key of ['guard_trend_atr','guard_range_atr'] as const){const v=p[key];if(v!==undefined&&(!Number.isFinite(v)||v<0||v>20))throw Error('DBL-5 防守线冗余须为 0–20 倍 ATR');}
  if(p.guard_range_closes!==undefined&&(!Number.isInteger(p.guard_range_closes)||p.guard_range_closes<1||p.guard_range_closes>12))throw Error('DBL-5 震荡期收盘确认须为 1–12 根');
  if(p.guard_version!==undefined&&p.guard_version!==DBL5_RETEST_GUARD_VERSION)throw Error('DBL-5 防守线版本无可用实现：'+p.guard_version);
  if(p.timeframe!=='5m'||!Number.isInteger(W)||p.window_minutes<20||p.window_minutes>10080||!Number.isInteger(p.n)||p.n<1||2*p.n+1>=W)throw Error('DBL-5 需要固定5m，窗口20–10080分钟且为5的整数倍，满足 2n+1<W（默认n为1–35）');
  if(p.guard_version===DBL5_RETEST_GUARD_VERSION){
    return {
      timeframe:p.timeframe,n:p.n,window_minutes:p.window_minutes,guard_version:p.guard_version,
      guard_trend_atr:p.guard_trend_atr??DBL5_GUARD_DEFAULTS.guard_trend_atr,
      guard_range_atr:p.guard_range_atr??DBL5_GUARD_DEFAULTS.guard_range_atr,
      guard_range_closes:p.guard_range_closes??DBL5_GUARD_DEFAULTS.guard_range_closes,
    };
  }
  return p;
}
export function dbl5Hash(value:unknown):string {
  const s=JSON.stringify(value),h=[0x811c9dc5,0x243f6a88,0x85a308d3,0x13198a2e];
  for(let i=0;i<s.length;i++)for(let j=0;j<h.length;j++)h[j]=Math.imul(h[j]^s.charCodeAt(i),0x01000193+j*2);
  return h.map(v=>(v>>>0).toString(16).padStart(8,'0')).join('');
}
export const dbl5ConfigHash=(p:Partial<Dbl5Config>={})=>dbl5Hash([DBL5_VERSION,dbl5Parameters(p)]);
/** Decimal parsing and all geometric comparisons use integers. No epsilon or nearest-tick rounding. */
function decimal(value:string|number):{coefficient:bigint;scale:number} {
  const text=String(value).replace(/^\+?[.]/,'0.'),m=/^\+?(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if(!m)throw Error('DBL-5 无效十进制价格');
  const exponent=Number(m[3]??0);if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>100)throw Error('DBL-5 十进制精度超出范围');
  let coefficient=BigInt(m[1]+(m[2]??'')),scale=(m[2]?.length??0)-exponent;
  if(scale<0){coefficient*=10n**BigInt(-scale);scale=0;}
  while(scale>0&&coefficient%10n===0n){coefficient/=10n;scale--;}
  return {coefficient,scale};
}
export function dbl5TickRule(value:string|number):string {
  const p=decimal(value);if(p.coefficient<=0n||!Number.isFinite(Number(value))||Number(value)<=0)throw Error('DBL-5 缺少有效 tick_size');
  const digits=p.coefficient.toString().padStart(p.scale+1,'0');
  return p.scale?digits.slice(0,-p.scale)+'.'+digits.slice(-p.scale):digits;
}
export function dbl5PriceTicks(price:string|number,tick:string|number):bigint {
  const p=decimal(price),q=decimal(tick);if(p.coefficient<=0n||q.coefficient<=0n)throw Error('DBL-5 价格及tick必须为正');
  const a=p.coefficient*10n**BigInt(q.scale),b=q.coefficient*10n**BigInt(p.scale);
  if(a%b!==0n)throw Error('DBL-5 价格不在整数tick格点上，需明确修订回放');
  return a/b;
}
export function dbl5TickPrice(ticks:string|bigint,tick:string):number {
  const q=decimal(tick),c=(BigInt(ticks)*q.coefficient).toString().padStart(q.scale+1,'0');
  const v=Number(q.scale?c.slice(0,-q.scale)+'.'+c.slice(-q.scale):c);
  if(!Number.isFinite(v)||v<=0)throw Error('DBL-5 外部价格无法表示');return v;
}
function ratio(a:bigint,b:bigint):number|null {
  if(b<=0n)return null;if(a===0n)return 0;const sign=a<0n?-1:1,sa=(a<0n?-a:a).toString(),sb=b.toString();
  const normalized=(s:string)=>Number(s.slice(0,16))/10**(Math.min(16,s.length)-1);
  const value=sign*normalized(sa)/normalized(sb)*10**(sa.length-sb.length);return Number.isFinite(value)?value:null;
}
export type Dbl5Bar=ResearchBar&{DBL5_closed?:boolean;DBL5_tick_size?:string|number|null;DBL5_prices?:{open:string;high:string;low:string;close:string}};
export type Dbl5Selection='BASELINE'|'UP_STEP'|'NESTED_HIGHER_FLOOR'|'SAME_FLOOR';
export type Dbl5EventType=Dbl5Selection|'NONE'|'SUPPORT_BROKEN'|'SUPPORT_EXPIRED'|'DATA_GAP'|'DATA_INVALID'|'BOX_CONFIRMED'|'CANDIDATE_EXPIRED'|'CANDIDATE_CANCELLED';
export type Dbl5Status='ACTIVE'|'WARMUP'|'SEARCHING'|'DATA_UNAVAILABLE';
interface Dbl5Candle {at:number;open_ticks:string;high_ticks:string;low_ticks:string;close_ticks:string}
export interface Dbl5Candidate {candidate_id:string;U_ticks:string;seed_time:number;origin_time:number;top_wait:number;top_confirmed_at:number|null;D_ticks:string|null;floor_anchor_time:number|null;expires_at:number;first_floor_time?:number}
export interface Dbl5Box {
  box_id:string;U:number;D:number;upper_ticks:string;lower_ticks:string;tick_size:string;
  seed_time:number;origin_time:number;floor_anchor_time:number;top_confirmed_at:number;confirmed_at:number;expires_at:number;
  first_floor_time?:number;
}
export interface Dbl5Active extends Dbl5Box {episode_id:string;formation_type:Dbl5Selection}
export interface Dbl5Event {id:string;type:Exclude<Dbl5EventType,'NONE'>;at:number;box_id:string|null;episode_id:string|null;ended_box_id:string|null;ended_episode_id:string|null;double_breach:boolean;reason_codes:string[]}
export interface Dbl5End {box:Dbl5Active;ended_at:number;reason:'BROKEN'|'EXPIRED'|'DATA_GAP'|'DATA_INVALID'|'REPLACED'}
export interface Dbl5Row {
  at:number;darvas_5m_lower:number|null;darvas_5m_upper:number|null;darvas_5m_available:boolean;
  darvas_5m_distance_bps:number|null;darvas_5m_width_bps:number|null;darvas_5m_age_minutes:number|null;darvas_5m_freshness:number|null;
  darvas_5m_event:Dbl5EventType;darvas_5m_status:Dbl5Status;formation_type:Dbl5Selection|null;
  box_id:string|null;episode_id:string|null;seed_time:number|null;origin_time:number|null;floor_anchor_time:number|null;top_confirmed_at:number|null;confirmed_at:number|null;expires_at:number|null;
  ended_box_id:string|null;ended_episode_id:string|null;double_breach:boolean;data_valid:boolean;data_continuous:boolean;reason_codes:string[];
  algorithm_version:string;config_hash:string;effective_parameters:Dbl5Config;tick_size:string|null;symbol:string;market:string;data_source:string;data_version:string;data_checksum:string;initialization_id:string;initialization_start:number|null;
  active:Dbl5Active|null;candidate_count:number;new_confirmations:(Dbl5Box&{selected:boolean})[];events:Dbl5Event[];
  /** 防守线（价格）：上涨期＝箱底−a×ATR 只升不降；震荡期＝震荡区最低箱底−b×ATR；收盘确认跌破后清空，等下一个箱体重建。 */
  darvas_5m_guard?:number|null;darvas_5m_guard_regime?:'trend'|'range'|null;darvas_5m_guard_closes?:number|null;darvas_5m_guard_atr?:number|null;darvas_5m_guard_broken?:boolean;darvas_5m_guard_segment?:number;
  darvas_5m_guard_waiting?:true;
  darvas_5m_guard_retest?:Dbl5Event;
}
/** All prices in integer ticks (as numbers); ATR is Wilder over closed 5m candles of this same sequence. */
export interface Dbl5GuardState {atr:number|null;samples:number;prev_close:number|null;line:number|null;regime:'trend'|'range'|null;floor:number|null;last_box:{box_id:string;lower:number;upper:number}|null;below:number;segment:number}
const freshGuard=(segment=0):Dbl5GuardState=>({atr:null,samples:0,prev_close:null,line:null,regime:null,floor:null,last_box:null,below:0,segment});
interface Dbl5GuardRetestPending {
  boxEvent:Dbl5Event;
  nearUpperTicks:number;
  departureTicks:number;
  departed:boolean;
}
export interface Dbl5Checkpoint {
  checkpoint_version:1;timeframe:'5m';feature_id:typeof DBL5_ID;algorithm_version:string;effective_parameters:Dbl5Config;config_hash:string;
  symbol:string;market:string;data_source:string;data_version:string;tick_size:string|null;initialization_id:string;initialization_start:number|null;first_time:number|null;
  last_time:number|null;last_signature:string|null;data_checksum:string;active:Dbl5Active|null;candidates:Dbl5Candidate[];context:Dbl5Candle[];
  confirmed_boxes:Dbl5Box[];ended:Dbl5End[];events:Dbl5Event[];last_row:Dbl5Row|null;
  /** Optional: older checkpoints restart the guard from their seed. */
  guard?:Dbl5GuardState;
  guard_retest_pending?:Dbl5GuardRetestPending;
}
export interface Dbl5Options {symbol:string;market?:string;dataSource?:string;dataVersion?:string;tickSize?:string|number|null;config?:Partial<Dbl5Config>;asOf?:number;initializationId?:string;initializationStart?:number;checkpoint?:Dbl5Checkpoint}

/** Only this state machine implements recognition. Batch, worker, replay and restore call push. */
export class Dbl5Engine {
  readonly config:Dbl5Config;readonly config_hash:string;readonly symbol:string;readonly market:string;readonly data_source:string;readonly data_version:string;readonly initialization_id:string;readonly initialization_start:number|null;readonly asOf:number;
  tick_size:string|null;first_time:number|null=null;last_time:number|null=null;last_signature:string|null=null;data_checksum:string;
  active:Dbl5Active|null=null;candidates:Dbl5Candidate[]=[];context:Dbl5Candle[]=[];confirmed_boxes:Dbl5Box[]=[];ended:Dbl5End[]=[];events:Dbl5Event[]=[];last_row:Dbl5Row|null=null;guard:Dbl5GuardState=freshGuard();private current:Dbl5Candle|null=null;
  private guardRetestPending?:Dbl5GuardRetestPending;
  private eventIds=new Set<string>();
  constructor(options:Dbl5Options){
    const c=options.checkpoint;this.config=dbl5Parameters(options.config??c?.effective_parameters);this.config_hash=dbl5ConfigHash(this.config);
    this.symbol=options.symbol;this.market=options.market??c?.market??'crypto-perpetual';this.data_source=options.dataSource??c?.data_source??'binance-usdm';this.data_version=options.dataVersion??c?.data_version??'ohlc-v1';
    this.initialization_id=options.initializationId??c?.initialization_id??'explicit-sequence-v1';this.initialization_start=options.initializationStart??c?.initialization_start??null;this.asOf=options.asOf??Infinity;
    this.tick_size=options.tickSize!=null?dbl5TickRule(options.tickSize):c?.tick_size??null;
    if(!this.symbol||!this.market||!this.data_source||!this.data_version||!this.initialization_id)throw Error('DBL-5 需要明确的品种、市场、数据源、版本和初始化身份');
    if(this.initialization_start!==null&&(!Number.isSafeInteger(this.initialization_start)||this.initialization_start%DBL5_STEP!==0))throw Error('DBL-5 初始化起点必须为5m开盘时间');
    this.data_checksum=dbl5Hash(this.identity().filter((_,i)=>i!==7));
    if(c){if(c.checkpoint_version!==1||c.timeframe!=='5m'||c.feature_id!==DBL5_ID||c.algorithm_version!==DBL5_VERSION||c.config_hash!==this.config_hash||c.symbol!==this.symbol||c.market!==this.market||c.data_source!==this.data_source||c.data_version!==this.data_version||c.tick_size!==this.tick_size||c.initialization_id!==this.initialization_id||c.initialization_start!==this.initialization_start)throw Error('DBL-5 检查点身份、精度、版本或配置不一致');
      const copy=structuredClone(c);this.first_time=copy.first_time;this.last_time=copy.last_time;this.last_signature=copy.last_signature;this.data_checksum=copy.data_checksum;this.active=copy.active;this.candidates=copy.candidates;this.context=copy.context;this.confirmed_boxes=copy.confirmed_boxes;this.ended=copy.ended;this.events=copy.events;this.last_row=copy.last_row;this.guard=copy.guard??freshGuard();this.eventIds=new Set(this.events.map(e=>e.id));
      if(this.config.guard_version===DBL5_RETEST_GUARD_VERSION)this.guardRetestPending=copy.guard_retest_pending;
    }
  }
  private identity(){return [DBL5_ID,DBL5_VERSION,this.config_hash,this.symbol,this.market,this.data_source,this.data_version,this.tick_size,this.initialization_id,this.initialization_start];}
  checkpoint():Dbl5Checkpoint {return structuredClone({checkpoint_version:1,timeframe:'5m',feature_id:DBL5_ID,algorithm_version:DBL5_VERSION,effective_parameters:this.config,config_hash:this.config_hash,symbol:this.symbol,market:this.market,data_source:this.data_source,data_version:this.data_version,tick_size:this.tick_size,initialization_id:this.initialization_id,initialization_start:this.initialization_start,first_time:this.first_time,last_time:this.last_time,last_signature:this.last_signature,data_checksum:this.data_checksum,active:this.active,candidates:this.candidates,context:this.context,confirmed_boxes:this.confirmed_boxes,ended:this.ended,events:this.events,last_row:this.last_row,guard:this.guard,...(this.guardRetestPending?{guard_retest_pending:this.guardRetestPending}:{})});}
  private event(type:Dbl5Event['type'],at:number,box:Dbl5Box|null,episode:string|null,endedEpisode:string|null=null,double=false,reasons:string[]=[]):Dbl5Event {
    const e:Dbl5Event={id:'dbl5-event-'+dbl5Hash([this.identity(),box?.box_id,type,at,episode,reasons]),type,at,box_id:box?.box_id??null,episode_id:episode,ended_box_id:['SUPPORT_BROKEN','SUPPORT_EXPIRED','DATA_GAP','DATA_INVALID'].includes(type)?box?.box_id??null:null,ended_episode_id:endedEpisode,double_breach:double,reason_codes:reasons};
    if(!this.eventIds.has(e.id)){this.eventIds.add(e.id);this.events.push(e);}return e;
  }
  private end(at:number,reason:Dbl5End['reason']){const old=this.active;if(old)this.ended.push({box:structuredClone(old),ended_at:at,reason});this.active=null;return old;}
  private publish(at:number,event:Dbl5EventType,events:Dbl5Event[],confirmed:Dbl5Box[],endedBox:Dbl5Active|null,endedEpisode:string|null,double:boolean,valid:boolean,continuous:boolean,reasons:string[],close:bigint|null):Dbl5Row {
    const candle=valid?this.current:null;
    const guard:{broken:boolean;retest?:Dbl5Event}=this.config.guard_version===DBL5_RETEST_GUARD_VERSION
      ?this.advanceRetestGuard(candle,events)
      :this.advanceGuard(candle,events);
    const g=this.guard,tickPrice=(t:number|null)=>t===null||!this.tick_size||t<1?null:dbl5TickPrice(BigInt(Math.floor(t)),this.tick_size);
    const a=this.active,lower=a?BigInt(a.lower_ticks):null,upper=a?BigInt(a.upper_ticks):null;
    const dist=lower!==null&&close!==null?ratio(close-lower,lower):null,width=lower!==null&&upper!==null?ratio(upper-lower,lower):null;
    const row:Dbl5Row={at,darvas_5m_lower:a?.D??null,darvas_5m_upper:a?.U??null,darvas_5m_available:!!a,darvas_5m_distance_bps:dist===null||!Number.isFinite(10000*dist)?null:10000*dist,darvas_5m_width_bps:width===null||!Number.isFinite(10000*width)?null:10000*width,darvas_5m_age_minutes:a?(at-a.confirmed_at)/60000:null,darvas_5m_freshness:a?2**(-(at-a.floor_anchor_time)/3600000):null,
      darvas_5m_event:event,darvas_5m_status:!valid?'DATA_UNAVAILABLE':a?'ACTIVE':this.context.length<this.config.n?'WARMUP':'SEARCHING',formation_type:a?.formation_type??null,
      box_id:a?.box_id??null,episode_id:a?.episode_id??null,seed_time:a?.seed_time??null,origin_time:a?.origin_time??null,floor_anchor_time:a?.floor_anchor_time??null,top_confirmed_at:a?.top_confirmed_at??null,confirmed_at:a?.confirmed_at??null,expires_at:a?.expires_at??null,
      ended_box_id:endedBox?.box_id??null,ended_episode_id:endedEpisode,double_breach:double,data_valid:valid,data_continuous:continuous,reason_codes:reasons,algorithm_version:DBL5_VERSION,config_hash:this.config_hash,effective_parameters:{...this.config},tick_size:this.tick_size,symbol:this.symbol,market:this.market,data_source:this.data_source,data_version:this.data_version,data_checksum:this.data_checksum,initialization_id:this.initialization_id,initialization_start:this.initialization_start??(this.first_time===null?null:this.first_time-DBL5_STEP),
      active:a?structuredClone(a):null,candidate_count:this.candidates.length,new_confirmations:confirmed.map(b=>({...b,selected:b.box_id===a?.box_id})),events,
      darvas_5m_guard:tickPrice(g.line),darvas_5m_guard_regime:g.line===null?null:g.regime,darvas_5m_guard_closes:g.line===null?null:this.guardCloses(g.regime),darvas_5m_guard_atr:g.atr===null||!this.tick_size?null:Number((g.atr*Number(this.tick_size)).toPrecision(12)),darvas_5m_guard_broken:guard.broken,darvas_5m_guard_segment:g.segment};
    if(this.guardRetestPending)row.darvas_5m_guard_waiting=true;
    if(guard.retest)row.darvas_5m_guard_retest=guard.retest;
    this.last_row=structuredClone(row);return row;
  }
  private guardCloses(regime:'trend'|'range'|null){return regime==='trend'?DBL5_GUARD_DEFAULTS.guard_trend_closes:this.config.guard_range_closes??DBL5_GUARD_DEFAULTS.guard_range_closes;}
  private advanceRetestGuard(candle:Dbl5Candle|null,events:readonly Dbl5Event[]):{broken:boolean;retest?:Dbl5Event} {
    const active=this.active;
    const pending=this.guardRetestPending;
    if(!candle||!active||active.box_id!==pending?.boxEvent.box_id)this.guardRetestPending=undefined;
    if(!candle||!active)return this.advanceGuard(candle,events);

    const selection=events.find(event=>event.box_id===active.box_id&&
      (event.type==='BASELINE'||event.type==='UP_STEP'||event.type==='NESTED_HIGHER_FLOOR'||event.type==='SAME_FLOOR'));
    if(selection&&(active.first_floor_time??active.floor_anchor_time)-active.seed_time===DBL5_STEP){
      const result=this.advanceGuard(candle,events.filter(event=>event!==selection));
      if(this.guard.samples>=DBL5_GUARD_DEFAULTS.atr_period&&this.guard.atr!==null){
        const floor=Number(active.lower_ticks);
        this.guardRetestPending={
          boxEvent:selection,
          nearUpperTicks:floor+Math.floor(this.guard.atr*DBL5_GUARD_RETEST.nearAtr),
          departureTicks:floor+Math.ceil(this.guard.atr*DBL5_GUARD_RETEST.departureAtr),
          departed:false,
        };
      }
      return result;
    }

    if(!this.guardRetestPending)return this.advanceGuard(candle,events);
    const candidate=this.guardRetestPending;
    const low=Number(candle.low_ticks),close=Number(candle.close_ticks);
    if(candidate.departed&&low<=candidate.nearUpperTicks&&close>candidate.nearUpperTicks){
      // Only the original box can pass. A strict wick break already removes it before publish().
      const retest={...candidate.boxEvent,at:candle.at,id:'dbl5-guard-retest-'+dbl5Hash([candidate.boxEvent.id,candle.at])};
      this.guardRetestPending=undefined;
      const result=this.advanceGuard(candle,[...events,retest]);
      return this.guard.last_box?.box_id===active.box_id?{...result,retest}:result;
    }
    if(low>candidate.nearUpperTicks&&close>=candidate.departureTicks)candidate.departed=true;
    return this.advanceGuard(candle,events);
  }
  /** Order per closed candle: ATR → close-confirmed break of the prior line → a newly selected box may set the line for later candles. */
  private advanceGuard(candle:Dbl5Candle|null,events:readonly Dbl5Event[]):{broken:boolean} {
    const g=this.guard,reset=()=>{g.line=null;g.regime=null;g.floor=null;g.last_box=null;g.below=0;g.segment++;};
    if(!candle){if(g.line!==null||g.last_box)reset();g.prev_close=null;return {broken:false};}
    if(events.some(e=>e.type==='DATA_GAP')){if(g.line!==null||g.last_box)reset();g.prev_close=null;}
    const h=Number(candle.high_ticks),l=Number(candle.low_ticks),c=Number(candle.close_ticks),P=DBL5_GUARD_DEFAULTS.atr_period;
    const tr=g.prev_close===null?h-l:Math.max(h-l,Math.abs(h-g.prev_close),Math.abs(l-g.prev_close));
    g.samples++;g.atr=g.atr===null?tr:g.samples<=P?g.atr+(tr-g.atr)/g.samples:(g.atr*(P-1)+tr)/P;g.prev_close=c;
    let broken=false;
    if(g.line!==null){g.below=c<g.line?g.below+1:0;if(g.below>=this.guardCloses(g.regime)){broken=true;reset();}}
    const a=this.active;
    if(a&&g.samples>=P&&g.last_box?.box_id!==a.box_id&&events.some(e=>e.box_id===a.box_id&&['BASELINE','UP_STEP','NESTED_HIGHER_FLOOR','SAME_FLOOR'].includes(e.type))){
      const D=Number(a.lower_ticks),U=Number(a.upper_ticks),p=g.last_box,atr=g.atr!,trendAtr=this.config.guard_trend_atr??DBL5_GUARD_DEFAULTS.guard_trend_atr,rangeAtr=this.config.guard_range_atr??DBL5_GUARD_DEFAULTS.guard_range_atr;
      if(g.line===null||!p){g.regime='range';g.floor=D;g.line=Math.floor(D-rangeAtr*atr);g.below=0;}
      else{
        const overlap=Math.min(U,p.upper)-Math.max(D,p.lower),trend=D>p.lower&&overlap<=DBL5_GUARD_DEFAULTS.overlap*Math.min(U-D,p.upper-p.lower);
        if(trend){g.regime='trend';g.floor=D;g.line=Math.max(g.line,Math.floor(D-trendAtr*atr));}
        else if(g.regime!=='range'){g.regime='range';g.floor=Math.min(p.lower,D);g.line=Math.floor(g.floor-rangeAtr*atr);}
        else if(D<g.floor!){g.floor=D;g.line=Math.floor(D-rangeAtr*atr);}
      }
      if(g.line<1){reset();}else g.last_box={box_id:a.box_id,lower:D,upper:U};
    }
    return {broken};
  }
  push(bar:Dbl5Bar):Dbl5Row|null {
    if(bar.DBL5_closed===false||bar.PRS6H_closed===false)return null;
    if(!Number.isSafeInteger(bar.openTime)||bar.openTime%DBL5_STEP!==0)throw Error('DBL-5 无效或未对齐的5m开盘时间');
    const at=bar.openTime+DBL5_STEP;if(at>this.asOf||this.initialization_start!==null&&bar.openTime<this.initialization_start)return null;
    const tick=bar.DBL5_tick_size??this.tick_size,raw=bar.DBL5_prices??bar;let tickSignature:string|null=null;try{tickSignature=tick==null?null:dbl5TickRule(tick);}catch{tickSignature=String(tick);}
    const signature=dbl5Hash([at,raw.open,raw.high,raw.low,raw.close,tickSignature]);
    if(this.last_time!==null){if(at<this.last_time)throw Error('DBL-5 乱序输入：需从有效检查点顺序回放');if(at===this.last_time){if(signature===this.last_signature)return null;throw Error('DBL-5 同时间戳内容冲突：需修订版本并回放后续状态');}}
    let candle:Dbl5Candle;
    try{
      if(tick==null)throw Error('MISSING_TICK_SIZE');const rule=dbl5TickRule(tick);if(this.tick_size!==null&&rule!==this.tick_size)throw Error('TICK_RULE_CHANGED');
      const [o,h,l,c]=[raw.open,raw.high,raw.low,raw.close].map(p=>dbl5PriceTicks(p,rule));
      if(l>o||l>c||o>h||c>h||!Number.isFinite(dbl5TickPrice(h,rule)))throw Error('INVALID_OHLC');
      this.tick_size=rule;candle={at,open_ticks:String(o),high_ticks:String(h),low_ticks:String(l),close_ticks:String(c)};this.current=candle;
    }catch(error){
      if(error instanceof Error&&error.message==='TICK_RULE_CHANGED')this.tick_size=dbl5TickRule(tick!);
      const old=this.end(at,'DATA_INVALID');this.candidates=[];this.context=[];this.last_time=at;this.last_signature=signature;this.data_checksum=dbl5Hash([this.data_checksum,signature,'DATA_INVALID']);
      const reasons=[error instanceof Error?error.message:'INVALID_DATA'],event=this.event('DATA_INVALID',at,old,old?.episode_id??null,old?.episode_id??null,false,reasons);
      return this.publish(at,'DATA_INVALID',[event],[],old,old?.episode_id??null,false,false,false,reasons,null);
    }
    const h=BigInt(candle.high_ticks),l=BigInt(candle.low_ticks),close=BigInt(candle.close_ticks),events:Dbl5Event[]=[],reasons:string[]=[],confirmed:Dbl5Box[]=[];
    let primary:Dbl5EventType='NONE',endedBox:Dbl5Active|null=null,endedEpisode:string|null=null,continuous=true;
    // 1. A real bar after a gap starts fresh context; no virtual bars or carry-forward support.
    if(this.last_time!==null&&at!==this.last_time+DBL5_STEP){endedBox=this.end(at,'DATA_GAP');endedEpisode=endedBox?.episode_id??null;this.candidates=[];this.context=[];continuous=false;primary='DATA_GAP';reasons.push('DATA_GAP');events.push(this.event('DATA_GAP',at,endedBox,endedEpisode,endedEpisode));}
    this.first_time??=at;this.last_time=at;this.last_signature=signature;this.data_checksum=dbl5Hash([this.data_checksum,candle,this.tick_size]);
    // 2. Expiry precedes price breach; young pending candidates survive a main-box expiry.
    if(this.active&&at>=this.active.expires_at){endedBox=this.end(at,'EXPIRED');endedEpisode=endedBox!.episode_id;primary='SUPPORT_EXPIRED';events.push(this.event('SUPPORT_EXPIRED',at,endedBox,endedEpisode,endedEpisode));}
    this.candidates=this.candidates.filter(c=>{if(at<c.expires_at)return true;events.push(this.event('CANDIDATE_EXPIRED',at,null,null,null,false,[c.candidate_id]));return false;});
    // 3. A wick strictly below an in-date floor ends the episode. This entire bar is barred from seeding/replacement.
    if(this.active&&l<BigInt(this.active.lower_ticks)){
      const old=this.end(at,'BROKEN')!,double=h>BigInt(old.upper_ticks);this.candidates=[];this.context=[...this.context,candle].slice(-this.config.n);
      events.push(this.event('SUPPORT_BROKEN',at,old,old.episode_id,old.episode_id,double));
      return this.publish(at,'SUPPORT_BROKEN',events,[],old,old.episode_id,double,true,continuous,['SUPPORT_BROKEN',...(double?['DOUBLE_BREACH']:[])],close);
    }
    // 4. All candidates see this close; collect all confirmations before selecting once.
    const pending:Dbl5Candidate[]=[];
    for(const c of [...this.candidates].sort((a,b)=>a.seed_time-b.seed_time)){
      if(h>BigInt(c.U_ticks)){events.push(this.event('CANDIDATE_CANCELLED',at,null,null,null,false,[c.candidate_id,'HIGH_ABOVE_U']));continue;}
      if(c.top_confirmed_at===null){c.top_wait=h===BigInt(c.U_ticks)?0:c.top_wait+1;if(c.top_wait>=this.config.n)c.top_confirmed_at=at;}
       if(c.D_ticks===null||l<=BigInt(c.D_ticks)){
         if(this.config.guard_version===DBL5_RETEST_GUARD_VERSION&&(c.D_ticks===null||l<BigInt(c.D_ticks)))c.first_floor_time=at;
         c.D_ticks=String(l);c.floor_anchor_time=at;
       }
      if(c.top_confirmed_at!==null&&c.D_ticks!==null&&c.floor_anchor_time!==null&&at-c.floor_anchor_time>=this.config.n*DBL5_STEP&&BigInt(c.U_ticks)-BigInt(c.D_ticks)>=1n){
        const box:Dbl5Box={box_id:'dbl5-box-'+dbl5Hash([this.identity(),this.first_time,c.seed_time,c.origin_time,c.U_ticks,c.D_ticks,c.floor_anchor_time,c.top_confirmed_at,at]),U:dbl5TickPrice(c.U_ticks,this.tick_size!),D:dbl5TickPrice(c.D_ticks,this.tick_size!),upper_ticks:c.U_ticks,lower_ticks:c.D_ticks,tick_size:this.tick_size!,seed_time:c.seed_time,origin_time:c.origin_time,floor_anchor_time:c.floor_anchor_time,top_confirmed_at:c.top_confirmed_at,confirmed_at:at,expires_at:c.expires_at};
         if(c.first_floor_time!==undefined)box.first_floor_time=c.first_floor_time;
         confirmed.push(Object.freeze(box));this.confirmed_boxes.push(structuredClone(box));events.push(this.event('BOX_CONFIRMED',at,box,null));
      }else pending.push(c);
    }
    this.candidates=pending;
    const old=this.active,eligible=confirmed.filter(b=>!old||BigInt(b.lower_ticks)>BigInt(old.lower_ticks)||b.lower_ticks===old.lower_ticks&&b.seed_time>old.seed_time);
    eligible.sort((a,b)=>BigInt(a.lower_ticks)>BigInt(b.lower_ticks)?-1:BigInt(a.lower_ticks)<BigInt(b.lower_ticks)?1:b.seed_time-a.seed_time);
    const chosen=eligible[0];
    if(chosen){
      const type:Dbl5Selection=!old?'BASELINE':BigInt(chosen.lower_ticks)===BigInt(old.lower_ticks)?'SAME_FLOOR':BigInt(chosen.upper_ticks)>BigInt(old.upper_ticks)?'UP_STEP':'NESTED_HIGHER_FLOOR';
      if(old){this.end(at,'REPLACED');endedBox=old;}
      const episode=old?.episode_id??'dbl5-episode-'+dbl5Hash([chosen.box_id,at]);this.active=Object.freeze({...chosen,episode_id:episode,formation_type:type});primary=type;events.push(this.event(type,at,chosen,episode));
    }
    // 5. Seed after updating old candidates. The seed's own low is deliberately absent.
    if(this.context.length===this.config.n&&this.context.every(b=>h>BigInt(b.high_ticks))){
      const origin=this.context[0].at;this.candidates.push({candidate_id:'dbl5-candidate-'+dbl5Hash([this.identity(),this.first_time,at,origin,String(h)]),U_ticks:String(h),seed_time:at,origin_time:origin,top_wait:0,top_confirmed_at:null,D_ticks:null,floor_anchor_time:null,expires_at:origin+this.config.window_minutes*60000});
    }
    this.context=[...this.context,candle].slice(-this.config.n);
    return this.publish(at,primary,events,confirmed,endedBox,endedEpisode,false,true,continuous,reasons,close);
  }
}
export function computeDbl5(bars:readonly Dbl5Bar[],options:Dbl5Options){const engine=new Dbl5Engine(options),rows=bars.flatMap(b=>{const row=engine.push(b);return row?[row]:[];});return {rows,checkpoint:engine.checkpoint(),events:engine.events,confirmed_boxes:engine.confirmed_boxes,ended:engine.ended};}
export const DBL5_FIELDS=['DBL5','DBL5_upper','DBL5_available','DBL5_distance_bps','DBL5_width_bps','DBL5_age_minutes','DBL5_freshness','DBL5_event_baseline','DBL5_event_up_step','DBL5_event_nested_higher_floor','DBL5_event_same_floor','DBL5_event_support_broken','DBL5_event_support_expired','DBL5_event_data_gap'] as const;
/** 绘图专用（不进公式，DBL5_FIELDS 决定内置公式与定义身份，不能动）；防守线也走这里。 */
export const DBL5_RENDER_FIELDS=['_DBL5_guard','_DBL5_guard_trend','_DBL5_guard_broken','_DBL5_guard_segment','_DBL5_episode','_DBL5_box','_DBL5_nested','_DBL5_baseline','_DBL5_up_step','_DBL5_same_floor','_DBL5_invalid','_DBL5_warmup'] as const;
export function dbl5Numeric(row:Dbl5Row,name:string):number|null {
  if(name==='_DBL5_episode'||name==='_DBL5_box'){const id=name==='_DBL5_episode'?row.episode_id:row.box_id;return id?parseInt(dbl5Hash(id).slice(0,12),16):null;}
  if(name==='_DBL5_guard')return row.darvas_5m_guard??null;
  if(name==='_DBL5_guard_trend')return row.darvas_5m_guard==null?null:row.darvas_5m_guard_regime==='trend'?1:0;
  if(name==='_DBL5_guard_broken')return row.darvas_5m_guard_broken?1:0;
  if(name==='_DBL5_guard_segment')return row.darvas_5m_guard==null?null:row.darvas_5m_guard_segment??0;
  if(name==='_DBL5_invalid')return row.darvas_5m_status==='DATA_UNAVAILABLE'?1:0;
  if(name==='_DBL5_warmup')return row.darvas_5m_status==='WARMUP'?1:0;
  if(name==='_DBL5_baseline')return row.formation_type==='BASELINE'?1:0;
  if(name==='_DBL5_up_step')return row.formation_type==='UP_STEP'?1:0;
  if(name==='_DBL5_same_floor')return row.formation_type==='SAME_FLOOR'?1:0;
  if(name==='_DBL5_nested')return row.formation_type==='NESTED_HIGHER_FLOOR'?1:0;
  if(name.startsWith('DBL5_event_'))return row.events.some(e=>e.type===name.slice(11).toUpperCase())?1:0;
  if(name==='DBL5_available')return row.darvas_5m_available?1:0;
  const key=name==='DBL5'?'darvas_5m_lower':'darvas_5m_'+name.slice(5),value=row[key as keyof Dbl5Row];return typeof value==='number'&&Number.isFinite(value)?value:null;
}
/** Backward as-of only. A stale final record cannot be carried through an unobserved gap or beyond its expiry. */
export function dbl5AsOf(rows:readonly Dbl5Row[],time:number):Dbl5Row|null {
  let lo=0,hi=rows.length-1,index=-1;while(lo<=hi){const mid=(lo+hi)>>>1;if(rows[mid].at<=time){index=mid;lo=mid+1;}else hi=mid-1;}
  const row=rows[index];if(!row||time-row.at>=DBL5_STEP||row.expires_at!==null&&time>=row.expires_at)return null;return row;
}

export function dbl5FieldUnit(name:string):string|undefined {
 if(name==='DBL5'||name==='DBL5_upper')return '价格';if(name.endsWith('_bps'))return 'bp';if(name==='DBL5_age_minutes')return '分钟';if(name==='DBL5_freshness')return '时间衰减比例';if(name==='DBL5_available'||name.startsWith('DBL5_event_'))return '布尔';return undefined;
}
export const DBL5_OUTPUT_SCHEMA={
 darvas_5m_lower:{type:'number',unit:'价格',nullable:true},darvas_5m_upper:{type:'number',unit:'价格',nullable:true},
 darvas_5m_distance_bps:{type:'number',unit:'bp',nullable:true},darvas_5m_width_bps:{type:'number',unit:'bp',nullable:true},darvas_5m_age_minutes:{type:'number',unit:'分钟',nullable:true},darvas_5m_freshness:{type:'number',unit:'时间衰减比例',nullable:true},
 darvas_5m_available:{type:'boolean',unit:null,nullable:false,operators:['is','is_not']},darvas_5m_event:{type:'enum',unit:null,nullable:false,operators:['is','is_not']},darvas_5m_status:{type:'enum',unit:null,nullable:false,operators:['is','is_not']},
} as const;
