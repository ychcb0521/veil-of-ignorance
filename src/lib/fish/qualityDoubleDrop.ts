/** Opt-in support-quality filter. Native box/guard outputs are not changed. */
export const DOUBLE_DROP_VERSION = 'addition-double-drop-v1';
interface Bar { openTime:number;open:number;high:number;low:number;close:number }
export interface DoubleDropRule { atr?:number;pct?:number;join?:'and'|'or' }
export interface DoubleDropState {
  peak:number; lockedPeak?:number; count:number; inDrop:boolean;
  referenceAtr?:number;firstAt?:number;secondAt?:number;previousClose?:number;lastAt?:number;
}
export const emptyDoubleDropState = ():DoubleDropState => ({peak:0,count:0,inDrop:false});
/** Called once per CLOSED 5m candle, never with its eventual future values. */
export function advanceDoubleDrop(previous:DoubleDropState,bar:Bar,atr:number,rule:DoubleDropRule):DoubleDropState {
  const at=bar.openTime+300000;
  if(previous.lastAt!=null&&bar.openTime!==previous.lastAt)throw Error('二次急跌观察区间缺少连续 5 分钟行情');
  if(![bar.open,bar.high,bar.low,bar.close].every(x=>Number.isFinite(x)&&x>0)||bar.low>Math.min(bar.open,bar.close)||bar.high<Math.max(bar.open,bar.close))throw Error('二次急跌行情无效');
  if(rule.atr!=null&&!(Number.isFinite(atr)&&atr>0))throw Error('二次急跌缺少有效的已收盘 ATR');
  let state={...previous,lastAt:at};
  // Recovery requires a close at/above the old high. An upper wick alone does
  // not clear the damage; the recovery bar cannot also count as a new fall.
  if(state.lockedPeak!=null&&bar.close>=state.lockedPeak){
    state={...emptyDoubleDropState(),peak:Math.max(bar.high,state.lockedPeak),previousClose:bar.close,lastAt:at};
    return state;
  }
  state.peak=Math.max(state.peak,bar.high);
  const reference=state.lockedPeak??state.peak,fall=Math.max(0,reference-bar.close);
  const byAtr=rule.atr!=null?fall>=rule.atr*(state.referenceAtr??atr)-Number.EPSILON*32*Math.max(reference,1):undefined;
  const byPct=rule.pct!=null?fall/reference*100>=rule.pct-1e-9:undefined;
  const dropped=byAtr!=null&&byPct!=null?(rule.join==='or'?byAtr||byPct:byAtr&&byPct):(byAtr??byPct??false);
  const falling=bar.close<(state.previousClose??bar.open);
  if(dropped&&falling&&!state.inDrop){
    state.lockedPeak??=reference;state.referenceAtr??=atr;
    state.count=Math.min(2,state.count+1);state.inDrop=true;
    if(state.count===1)state.firstAt=at;
    else state.secondAt??=at;
  }else if(!dropped&&state.previousClose!=null&&bar.close>state.previousClose){
    // A rebound must leave the configured drop zone before another crossing
    // can count. Consecutive red bars are one episode, not multiple drops.
    state.inDrop=false;
  }
  state.previousClose=bar.close;
  return state;
}
export function doubleDropState(bars:readonly Bar[],atr:readonly number[],entry:number,rule:DoubleDropRule):DoubleDropState {
  let state=emptyDoubleDropState();
  bars.forEach((bar,i)=>{if(bar.openTime>=entry)state=advanceDoubleDrop(state,bar,atr[i],rule);});
  return state;
}
