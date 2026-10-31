/** MBI2 uses price alone. Never use a span EMA or standardise z by its own variance. */

export const MBI2_Z0 = 1.25;
export const MBI2_TOOLTIP = 'MBI2：独立价格递推，按小时换算 n；0为均衡，穿过±缓冲带开始试探，越过确认阈值后保持确认，直到穿过对侧缓冲带。只用已收盘价格，预热和缺失保持为空。';

export const MBI2_BAND = 0.2;
export const MBI2_CONFIRM = 0.8;
export const MBI2_T_HOURS = 25 * 5 / 60;
export const MBI2_KEYS = ['MBI2','avg_MBI2_2','MBI2_state','MBI2_lead_h','MBI2_confirm_h'] as const;
export const MBI2_BEAR_KEYS=['MBI2_bear','avg_MBI2_bear_2','MBI2_bear_state','MBI2_bear_lead_h','MBI2_bear_confirm_h'] as const;
export const mbi2KeysOf=(def:{chartCore?:string})=>def.chartCore==='MBI2_bear'?MBI2_BEAR_KEYS:MBI2_KEYS;
export const MBI2_LABELS: Readonly<Record<string,string>> = {
  MBI2_bear:'MBI2·卖方',avg_MBI2_bear_2:'avg_MBI2_bear_2',MBI2_bear_state:'MBI2 卖方状态',MBI2_bear_lead_h:'MBI2 卖方本轮持续小时',MBI2_bear_confirm_h:'MBI2 卖方确认持续小时',
  MBI2:'MBI2',avg_MBI2_2:'avg_MBI2_2',MBI2_state:'MBI2 状态',MBI2_lead_h:'MBI2 本轮持续小时',MBI2_confirm_h:'MBI2 确认持续小时',
};
export interface Mbi2Params { MBI2_T_HOURS?:number; MBI2_Z0?:number; MBI2_BAND?:number; MBI2_CONFIRM?:number }
/** Undefined means the documented per-timeframe default n=25; an explicit hour value stays fixed across timeframes. */
export const mbi2HoursOf = (p:Mbi2Params={},minutes=5) => p.MBI2_T_HOURS ?? 25*minutes/60;
export const mbi2NOf = (p:Mbi2Params={},minutes=5) => Math.max(5,Math.round(mbi2HoursOf(p,minutes)*60/minutes));
export const mbi2Z0Of = (p:Mbi2Params={}) => p.MBI2_Z0 ?? MBI2_Z0;
export const mbi2BandOf = (p:Mbi2Params={}) => p.MBI2_BAND ?? MBI2_BAND;
export const mbi2ConfirmOf = (p:Mbi2Params={}) => p.MBI2_CONFIRM ?? MBI2_CONFIRM;
export function validateMbi2Params(p:Mbi2Params={},minutes=5) {
  if(!Number.isFinite(minutes)||minutes<=0||!Number.isFinite(mbi2HoursOf(p,minutes))||mbi2HoursOf(p,minutes)<=0)throw Error('MBI2_T_HOURS 和周期分钟数必须大于0');
  if(!Number.isSafeInteger(mbi2NOf(p,minutes)))throw Error('MBI2 派生 n 超出有效范围');
  if(mbi2Z0Of(p)!==1.25)throw Error('MBI2_Z0 固定为1.25');
  if(!Number.isFinite(mbi2BandOf(p))||!Number.isFinite(mbi2ConfirmOf(p))||mbi2BandOf(p)<0||mbi2BandOf(p)>=mbi2ConfirmOf(p)||mbi2ConfirmOf(p)>=1)throw Error('MBI2 要求 0 ≤ BAND < CONFIRM < 1');
}
function validateCore(n:number,z0:number) {
  if(!Number.isSafeInteger(n)||n<1||!Number.isFinite(z0)||z0<=0)throw Error('MBI2 核心参数无效');
}

/**
 * Ascending, closed candles only; callers own the anchor/close-time cut.
 * The seed uses the first n returns, all inside the hidden 5n warmup.
 * Invalid prices stay missing: never carry a close forward or add a zero return.
 * warmup=false is solely for verifying the published recurrence, not production.
 */
export function computeMbi2Core(closes: ArrayLike<number>, n = 25, z0 = 1.25, options: { warmup?: boolean } = {}) {
  validateCore(n, z0);
  const z = new Float64Array(closes.length).fill(NaN);
  const mbi = new Float64Array(closes.length).fill(NaN);
  // Read-only adapter: same-period single-log-return RMS, before the current update.
  const sigmaBefore = new Float64Array(closes.length).fill(NaN);
  const alpha = 1 / n, kappa = 1 / Math.sqrt(alpha * (2 - alpha));
  const x = Float64Array.from(closes, c => c > 0 && Number.isFinite(c) ? Math.log(c) : NaN);
  const first = x.findIndex(Number.isFinite);
  if (first < 0) return { z, mbi, sigmaBefore, kappa, initialVariance: null };
  let seed = 0, count = 0, seedEnd = first;
  for (let k = first + 1; k < x.length && count < n; k++) {
    if (Number.isFinite(x[k]) && Number.isFinite(x[k - 1])) {
      seed += (x[k] - x[k - 1]) ** 2;
      count++;
      seedEnd = k;
    }
  }
  if (count < n) return { z, mbi, sigmaBefore, kappa, initialVariance: null };
  const initialVariance = seed / n;
  let M = x[first], S = initialVariance;
  const warmupEnd = Math.max(first + 5 * n, seedEnd + 1);
  for (let t = first + 1; t < x.length; t++) {
    if (!Number.isFinite(x[t])) continue;
    const hasReturn = Number.isFinite(x[t - 1]);
    // Calculate with M(t-1), S(t-1), before either state is updated.
    if (hasReturn && (options.warmup === false || t >= warmupEnd)) {
      sigmaBefore[t] = Math.sqrt(S);
      z[t] = S > 0 ? (x[t] - M) / (kappa * Math.sqrt(S)) : 0;
      mbi[t] = Math.tanh(z[t] / z0);
    }
    M = (1 - alpha) * M + alpha * x[t];
    if (hasReturn) {
      const r = x[t] - x[t - 1];
      S = (1 - alpha) * S + alpha * r * r;
    }
  }
  return { z, mbi, sigmaBefore, kappa, initialVariance };
}

/** Strict hysteresis on closed bars; a data gap interrupts a run instead of inventing elapsed signals. */
export function mbi2States(values:ArrayLike<number>,minutes=5,p:Mbi2Params={},times?:ArrayLike<number>) {
  validateMbi2Params(p,minutes);
  const length=values.length,blank=()=>new Float64Array(length).fill(NaN);
  const state=blank(),lead=blank(),confirm=blank(),buyStarts=blank(),buyConfirms=blank();
  const band=mbi2BandOf(p),threshold=mbi2ConfirmOf(p),step=minutes*60000;
  let side=0,started=-1,confirmed=-1;
  for(let i=0;i<length;i++){
    const value=values[i],time=times?.[i]??i*step;
    if(!Number.isFinite(value)||!Number.isFinite(time)){side=0;started=confirmed=-1;continue;}
    if(i>0&&times&&time-times[i-1]!==step){side=0;started=confirmed=-1;}
    buyStarts[i]=buyConfirms[i]=0;
    if(value>band){
      if(side<=0){side=1;started=i;confirmed=-1;buyStarts[i]=1;}
      if(value>threshold&&side!==2){side=2;confirmed=i;buyConfirms[i]=1;}
    }else if(value< -band){
      if(side>=0){side=-1;started=i;confirmed=-1;}
      if(value< -threshold&&side!==-2){side=-2;confirmed=i;}
    }
    const elapsed=(start:number)=>start<0?0:Math.min(48,(time-(times?.[start]??start*step))/3600000);
    state[i]=side;lead[i]=side===0?0:elapsed(started);confirm[i]=Math.abs(side)===2?elapsed(confirmed):0;
  }
  return {state,lead,confirm,buyStarts,buyConfirms};
}
export function computeMbi2(closes:ArrayLike<number>,p:Mbi2Params={},minutes=5,options:{warmup?:boolean;times?:ArrayLike<number>}={}) {
  validateMbi2Params(p,minutes);
  const n=mbi2NOf(p,minutes),raw=computeMbi2Core(closes,n,mbi2Z0Of(p),options);
  return {...raw,n,...mbi2States(raw.mbi,minutes,p,options.times)};
}
export function mbi2StateLabel(value:number|null|undefined):string {
  return value==null||!Number.isFinite(value)?'—':({'2':'买方确认','1':'买方试探','0':'均衡','-1':'卖方试探','-2':'卖方确认'}[String(value)]??'—');
}

export function mbi2MinutesOf(times:ArrayLike<number>):number {
  const gaps:number[]=[];for(let i=Math.max(1,times.length-64);i<times.length;i++){const d=times[i]-times[i-1];if(d>0&&Number.isFinite(d))gaps.push(d/60000);}
  gaps.sort((a,b)=>a-b);return gaps[Math.floor(gaps.length/2)]??5;
}
