import {confirmedImpulse5m,IMPULSE_5M_BASELINE,IMPULSE_5M_VERSION,IMPULSE_5M_DISPLAY_NAME,type Impulse5mBar} from '@/lib/impulse5m';
import {DBL5_GUARD_PLUS_VERSION,DBL5_GUARD_PLUS_CONFIGURABLE_K_VERSION,DBL5_GUARD_PLUS_DISPLAY_NAME,IMPULSE_1115_DISPLAY_NAME,DBL5_GUARD_PLUS_PARAMS} from '@/lib/dbl5GuardPlus';
import type {ResearchBar} from '@/lib/deepRsa/window';
export const BOX_STOP_REFERENCE_VERSION='holding-box-stop-reference-v1' as const;
export const BOX_STOP_REFERENCE_LABELS={
 'impulse0':IMPULSE_5M_DISPLAY_NAME,
 'impulse1115':IMPULSE_1115_DISPLAY_NAME,
 'guard-plus1115':DBL5_GUARD_PLUS_DISPLAY_NAME,
} as const;
export type BoxStopReferenceKind=keyof typeof BOX_STOP_REFERENCE_LABELS;
export type BoxStopReference={kind:'impulse0';version:typeof IMPULSE_5M_VERSION}|
 {kind:'impulse1115'|'guard-plus1115';version:typeof DBL5_GUARD_PLUS_VERSION|typeof DBL5_GUARD_PLUS_CONFIGURABLE_K_VERSION;impulseBufferAtr?:number};
export const defaultBoxStopReference=(kind:BoxStopReferenceKind):BoxStopReference=>kind==='impulse0'
 ?{kind,version:IMPULSE_5M_VERSION}:{kind,version:DBL5_GUARD_PLUS_CONFIGURABLE_K_VERSION,impulseBufferAtr:DBL5_GUARD_PLUS_PARAMS.bufferAtr};
export const boxStopReferenceIdentity=(r:BoxStopReference)=>[r.kind,r.version,...(r.kind==='impulse0'?[]:[r.impulseBufferAtr??null])];
export function validateBoxStopReference(r:BoxStopReference|undefined){
 if(!r||!Object.prototype.hasOwnProperty.call(BOX_STOP_REFERENCE_LABELS,r.kind))throw Error('请选择可执行的急拉线 K 基准');
 if(r.kind==='impulse0'){if(r.version!==IMPULSE_5M_VERSION)throw Error('急拉线-0 版本不符');return;}
 if(r.version===DBL5_GUARD_PLUS_VERSION&&r.impulseBufferAtr===undefined)return;
 if(r.version!==DBL5_GUARD_PLUS_CONFIGURABLE_K_VERSION||!Number.isFinite(r.impulseBufferAtr)||r.impulseBufferAtr!<0||r.impulseBufferAtr!>20)throw Error('急拉线-1115 的版本与冗余参数不符（0–20 ATR）');
}
/** Same closed-candle lifecycle as impulse5mChartSeries; detection stays in the original native function. */
export function createImpulse0StopReference(){
 const history:Impulse5mBar[]=[];
 let active:{low:number;confirmedAt:number}|undefined;
 return (bar:ResearchBar)=>{
  if(bar.DBL5_closed===false){history.length=0;active=undefined;return;}
  if(![bar.open,bar.high,bar.low,bar.close].every(v=>Number.isFinite(v)&&v>0)||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close))throw Error('急拉线-0 的分钟行情无效，不能跳过缺口');
  const tip:Impulse5mBar={timestamp:bar.openTime,open:bar.open,high:bar.high,low:bar.low,close:bar.close,turnover:bar.quoteVolume,takerBuyTurnover:bar.takerBuyQuoteVolume};
  if(![tip.turnover,tip.takerBuyTurnover].every(v=>v!=null&&Number.isFinite(v)&&v>=0)||tip.takerBuyTurnover!>tip.turnover!)throw Error('急拉线-0 缺少有效的币安成交额与主动买入额，不能跳过缺口');
  const at=bar.openTime+300000;
  if(active&&(bar.low<=active.low||at-active.confirmedAt>=12*300000))active=undefined;
  if(history.length>=IMPULSE_5M_BASELINE){const hit=confirmedImpulse5m(tip,history.slice(-IMPULSE_5M_BASELINE),history.at(-IMPULSE_5M_BASELINE-1));if(hit)active=hit;}
  history.push(tip);if(history.length>IMPULSE_5M_BASELINE+1)history.shift();
  return active?{price:active.low,sourceAt:active.confirmedAt}:undefined;
 };
}
