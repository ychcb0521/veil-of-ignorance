import type {ResearchBar} from './deepRsa/window';

export const DBL5_ID='darvas_5m_lower';
export const DBL5_VERSION='dbl-5-v1';
export const DBL5_STEP=300_000;
export interface Dbl5Config {timeframe:'5m';n:number;window_minutes:number}
export const DBL5_DEFAULTS:Readonly<Dbl5Config>=Object.freeze({timeframe:'5m',n:3,window_minutes:360});
export function dbl5Parameters(input:Partial<Dbl5Config>={}):Dbl5Config {
  for(const key of Object.keys(input))if(!(key in DBL5_DEFAULTS))throw Error('DBL-5 未知参数：'+key);
  const p={...DBL5_DEFAULTS,...input},W=p.window_minutes/5;
  if(p.timeframe!=='5m'||!Number.isInteger(W)||p.window_minutes<20||p.window_minutes>10080||!Number.isInteger(p.n)||p.n<1||2*p.n+1>=W)throw Error('DBL-5 需要固定5m，窗口20–10080分钟且为5的整数倍，满足 2n+1<W（默认n为1–35）');
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
export interface Dbl5Candidate {candidate_id:string;U_ticks:string;seed_time:number;origin_time:number;top_wait:number;top_confirmed_at:number|null;D_ticks:string|null;floor_anchor_time:number|null;expires_at:number}
export interface Dbl5Box {
  box_id:string;U:number;D:number;upper_ticks:string;lower_ticks:string;tick_size:string;
  seed_time:number;origin_time:number;floor_anchor_time:number;top_confirmed_at:number;confirmed_at:number;expires_at:number;
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
}
export interface Dbl5Checkpoint {
  checkpoint_version:1;timeframe:'5m';feature_id:typeof DBL5_ID;algorithm_version:string;effective_parameters:Dbl5Config;config_hash:string;
  symbol:string;market:string;data_source:string;data_version:string;tick_size:string|null;initialization_id:string;initialization_start:number|null;first_time:number|null;
  last_time:number|null;last_signature:string|null;data_checksum:string;active:Dbl5Active|null;candidates:Dbl5Candidate[];context:Dbl5Candle[];
  confirmed_boxes:Dbl5Box[];ended:Dbl5End[];events:Dbl5Event[];last_row:Dbl5Row|null;
}
export interface Dbl5Options {symbol:string;market?:string;dataSource?:string;dataVersion?:string;tickSize?:string|number|null;config?:Partial<Dbl5Config>;asOf?:number;initializationId?:string;initializationStart?:number;checkpoint?:Dbl5Checkpoint}

/** Only this state machine implements recognition. Batch, worker, replay and restore call push. */
export class Dbl5Engine {
  readonly config:Dbl5Config;readonly config_hash:string;readonly symbol:string;readonly market:string;readonly data_source:string;readonly data_version:string;readonly initialization_id:string;readonly initialization_start:number|null;readonly asOf:number;
  tick_size:string|null;first_time:number|null=null;last_time:number|null=null;last_signature:string|null=null;data_checksum:string;
  active:Dbl5Active|null=null;candidates:Dbl5Candidate[]=[];context:Dbl5Candle[]=[];confirmed_boxes:Dbl5Box[]=[];ended:Dbl5End[]=[];events:Dbl5Event[]=[];last_row:Dbl5Row|null=null;
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
      const copy=structuredClone(c);this.first_time=copy.first_time;this.last_time=copy.last_time;this.last_signature=copy.last_signature;this.data_checksum=copy.data_checksum;this.active=copy.active;this.candidates=copy.candidates;this.context=copy.context;this.confirmed_boxes=copy.confirmed_boxes;this.ended=copy.ended;this.events=copy.events;this.last_row=copy.last_row;this.eventIds=new Set(this.events.map(e=>e.id));
    }
  }
  private identity(){return [DBL5_ID,DBL5_VERSION,this.config_hash,this.symbol,this.market,this.data_source,this.data_version,this.tick_size,this.initialization_id,this.initialization_start];}
  checkpoint():Dbl5Checkpoint {return structuredClone({checkpoint_version:1,timeframe:'5m',feature_id:DBL5_ID,algorithm_version:DBL5_VERSION,effective_parameters:this.config,config_hash:this.config_hash,symbol:this.symbol,market:this.market,data_source:this.data_source,data_version:this.data_version,tick_size:this.tick_size,initialization_id:this.initialization_id,initialization_start:this.initialization_start,first_time:this.first_time,last_time:this.last_time,last_signature:this.last_signature,data_checksum:this.data_checksum,active:this.active,candidates:this.candidates,context:this.context,confirmed_boxes:this.confirmed_boxes,ended:this.ended,events:this.events,last_row:this.last_row});}
  private event(type:Dbl5Event['type'],at:number,box:Dbl5Box|null,episode:string|null,endedEpisode:string|null=null,double=false,reasons:string[]=[]):Dbl5Event {
    const e:Dbl5Event={id:'dbl5-event-'+dbl5Hash([this.identity(),box?.box_id,type,at,episode,reasons]),type,at,box_id:box?.box_id??null,episode_id:episode,ended_box_id:['SUPPORT_BROKEN','SUPPORT_EXPIRED','DATA_GAP','DATA_INVALID'].includes(type)?box?.box_id??null:null,ended_episode_id:endedEpisode,double_breach:double,reason_codes:reasons};
    if(!this.eventIds.has(e.id)){this.eventIds.add(e.id);this.events.push(e);}return e;
  }
  private end(at:number,reason:Dbl5End['reason']){const old=this.active;if(old)this.ended.push({box:structuredClone(old),ended_at:at,reason});this.active=null;return old;}
  private publish(at:number,event:Dbl5EventType,events:Dbl5Event[],confirmed:Dbl5Box[],endedBox:Dbl5Active|null,endedEpisode:string|null,double:boolean,valid:boolean,continuous:boolean,reasons:string[],close:bigint|null):Dbl5Row {
    const a=this.active,lower=a?BigInt(a.lower_ticks):null,upper=a?BigInt(a.upper_ticks):null;
    const dist=lower!==null&&close!==null?ratio(close-lower,lower):null,width=lower!==null&&upper!==null?ratio(upper-lower,lower):null;
    const row:Dbl5Row={at,darvas_5m_lower:a?.D??null,darvas_5m_upper:a?.U??null,darvas_5m_available:!!a,darvas_5m_distance_bps:dist===null||!Number.isFinite(10000*dist)?null:10000*dist,darvas_5m_width_bps:width===null||!Number.isFinite(10000*width)?null:10000*width,darvas_5m_age_minutes:a?(at-a.confirmed_at)/60000:null,darvas_5m_freshness:a?2**(-(at-a.floor_anchor_time)/3600000):null,
      darvas_5m_event:event,darvas_5m_status:!valid?'DATA_UNAVAILABLE':a?'ACTIVE':this.context.length<this.config.n?'WARMUP':'SEARCHING',formation_type:a?.formation_type??null,
      box_id:a?.box_id??null,episode_id:a?.episode_id??null,seed_time:a?.seed_time??null,origin_time:a?.origin_time??null,floor_anchor_time:a?.floor_anchor_time??null,top_confirmed_at:a?.top_confirmed_at??null,confirmed_at:a?.confirmed_at??null,expires_at:a?.expires_at??null,
      ended_box_id:endedBox?.box_id??null,ended_episode_id:endedEpisode,double_breach:double,data_valid:valid,data_continuous:continuous,reason_codes:reasons,algorithm_version:DBL5_VERSION,config_hash:this.config_hash,effective_parameters:{...this.config},tick_size:this.tick_size,symbol:this.symbol,market:this.market,data_source:this.data_source,data_version:this.data_version,data_checksum:this.data_checksum,initialization_id:this.initialization_id,initialization_start:this.initialization_start??(this.first_time===null?null:this.first_time-DBL5_STEP),
      active:a?structuredClone(a):null,candidate_count:this.candidates.length,new_confirmations:confirmed.map(b=>({...b,selected:b.box_id===a?.box_id})),events};
    this.last_row=structuredClone(row);return row;
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
      this.tick_size=rule;candle={at,open_ticks:String(o),high_ticks:String(h),low_ticks:String(l),close_ticks:String(c)};
    }catch(error){
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
      if(c.D_ticks===null||l<=BigInt(c.D_ticks)){c.D_ticks=String(l);c.floor_anchor_time=at;}
      if(c.top_confirmed_at!==null&&c.D_ticks!==null&&c.floor_anchor_time!==null&&at-c.floor_anchor_time>=this.config.n*DBL5_STEP&&BigInt(c.U_ticks)-BigInt(c.D_ticks)>=1n){
        const box:Dbl5Box={box_id:'dbl5-box-'+dbl5Hash([this.identity(),this.first_time,c.seed_time,c.origin_time,c.U_ticks,c.D_ticks,c.floor_anchor_time,c.top_confirmed_at,at]),U:dbl5TickPrice(c.U_ticks,this.tick_size!),D:dbl5TickPrice(c.D_ticks,this.tick_size!),upper_ticks:c.U_ticks,lower_ticks:c.D_ticks,tick_size:this.tick_size!,seed_time:c.seed_time,origin_time:c.origin_time,floor_anchor_time:c.floor_anchor_time,top_confirmed_at:c.top_confirmed_at,confirmed_at:at,expires_at:c.expires_at};
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
export const DBL5_RENDER_FIELDS=['_DBL5_episode','_DBL5_box','_DBL5_nested','_DBL5_baseline','_DBL5_up_step','_DBL5_same_floor'] as const;
export function dbl5Numeric(row:Dbl5Row,name:string):number|null {
  if(name==='_DBL5_episode'||name==='_DBL5_box'){const id=name==='_DBL5_episode'?row.episode_id:row.box_id;return id?parseInt(dbl5Hash(id).slice(0,12),16):null;}
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
