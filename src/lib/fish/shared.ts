import type { ResearchBar } from '@/lib/deepRsa/window';
export const FISH_STEP = 300_000;
export const FISH_BARS = 2000;
export const FISH_FIRST_USABLE = 1454;
export const FISH_THRESHOLD = 0.3;
export class FishError extends Error { constructor(message: string, readonly kind: 'gap' | 'readings' | 'failed' | 'banned' | 'history' | 'skipped', readonly detail?: { path?: string; status?: number }) { super(message); } }
const check = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('已取消', 'AbortError'); };
export function fishDelay(ms: number, signal: AbortSignal): Promise<void> {
  check(signal);
  // 后台标签页里浏览器会把 setTimeout 拖到最多一分钟一次，逐币让出一次（ms = 0）就会让定时自动捕捞慢上几十倍；
  // 这时改用 MessageChannel 让出（不受计时器节流），真正需要等的（ms > 0，如请求配额）照旧用计时器。
  if (ms <= 0 && typeof document !== 'undefined' && document.hidden && typeof MessageChannel !== 'undefined') {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => { channel.port1.close(); if (signal.aborted) reject(new DOMException('已取消', 'AbortError')); else resolve(); };
      channel.port2.postMessage(null);
    });
  }
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
/** Rolling 60s budget, serialized reservations; retained between scans. Includes failed HTTP requests. */
export class FishWeightBudget {
  private events: { at: number; weight: number }[] = [];
  private tail: Promise<void> = Promise.resolve();
  private cooldown = 0;
  constructor(private now = Date.now, private sleep = fishDelay, private limit = 1200, private windowMs = 60_000) {}
  pauseUntil(time: number) { this.cooldown = Math.max(this.cooldown, time); }
  /** Atomically reserve at actual dispatch time; positive return means wait without occupying a network slot. */
  tryTake(weight:number):number {
    if(!(weight>0)||weight>this.limit)throw new Error('Invalid request weight');
    const now=this.now();this.events=this.events.filter(e=>now-e.at<this.windowMs);
    const used=this.events.reduce((sum,e)=>sum+e.weight,0);
    const wait=Math.max(this.cooldown-now,used+weight>this.limit?this.events[0].at+this.windowMs-now:0);
    if(wait<=0){this.events.push({at:now,weight});return 0;}return wait;
  }
  wait(ms:number,signal:AbortSignal){return this.sleep(ms,signal);}
  take(weight: number, signal: AbortSignal): Promise<void> {
    const run=this.tail.catch(()=>{}).then(async()=>{
      for(;;){check(signal);const wait=this.tryTake(weight);if(!wait)return;await this.wait(wait,signal);}
    });
    this.tail=run;return run;
  }
}
export function validateFishBars(bars: readonly ResearchBar[], cutoffMs: number, count = FISH_BARS, step = FISH_STEP): void {
  const from=cutoffMs-count*step;
  if(!bars.length)throw new FishError(`当时没有K线，或可取历史不足${count}根`,'history');
  // Missing only the beginning is different from holes inside an existing price history.
  const first=bars[0].openTime;
  if(first>from&&bars.every((b,i)=>b.openTime===first+i*step)&&bars.at(-1)!.openTime===cutoffMs-step)throw new FishError(`最早K线晚于所需起点：当时未上市 / 历史不足${count}根`,'history');
  if(bars.length!==count||bars.some((b,i)=>b.openTime!==from+i*step))throw new FishError('K线中间缺根、末尾缺根或时间点重复','gap');

}

/** Shared network cap, without sharing any exchange's request-weight counter. */
export class FishRequestPool {
  private active=0;
  private waiters: (()=>void)[]=[];
  async run<T>(task:()=>Promise<T>,signal:AbortSignal):Promise<T>{
    check(signal);
    while(this.active>=3){
      await new Promise<void>((resolve,reject)=>{
        const ready=()=>{signal.removeEventListener('abort',stop);resolve();};
        const stop=()=>{this.waiters=this.waiters.filter(x=>x!==ready);reject(new DOMException('已取消','AbortError'));};
        this.waiters.push(ready);signal.addEventListener('abort',stop,{once:true});
      });
      check(signal);
    }
    this.active++;
    try{return await task();}finally{this.active--;this.waiters.shift()?.();}
  }
}

/**
 * 「鱼」的最低成交额：截止前 1 小时的 USDT 成交额不得低于 100 万、12 小时不得低于 800 万、24 小时不得低于 1000 万；三条都满足才判定，否则直接跳过、成不了鱼。
 * 【用户要求】2026-10-20「鱼的最低交易量标准是 24h 内不得低于 1000w USDT」→「1h 内不得低于 100w，且 12h 内不得低于 800w」→「要同时 24 小时内不低于 1000 万」。
 */
export interface FishTurnoverFloor { hours: number; min: number }
export const FISH_TURNOVER_FLOORS: readonly FishTurnoverFloor[] = [{ hours: 1, min: 1_000_000 }, { hours: 12, min: 8_000_000 }, { hours: 24, min: 10_000_000 }];
/**
 * 截止前 hours 小时的 USDT 成交额：K 线落在 [截止 − hours, 截止) 里的成交额之和。
 * K 线周期不超过 1 小时时窗口正好落在 K 线边界上，是精确值；周期更长（如 4h 的算法看 1 小时）时，跨窗口那根按时间比例折算。
 * 有一根缺成交额、或所给 K 线不够覆盖这段时长（如 1 分钟周期的算法只取了不到 24 小时），返回 null——不拿少算的成交额去误判。
 */
export function fishTurnoverWithin(bars: readonly ResearchBar[], cutoffMs: number, hours: number, step: number): number | null {
  const from = cutoffMs - hours * 3_600_000;
  if (!bars.length || bars[0].openTime > from) return null;
  let sum = 0;
  for (const b of bars) {
    const overlap = Math.min(b.openTime + step, cutoffMs) - Math.max(b.openTime, from);
    if (overlap <= 0) continue;
    if (b.quoteVolume == null || !Number.isFinite(b.quoteVolume)) return null;
    sum += overlap >= step ? b.quoteVolume : b.quoteVolume * overlap / step;
  }
  return sum;
}
/** 逐条检查成交额门槛；读数不全或 K 线不够覆盖返回 null，否则返回各条的读数与是否达标。 */
export function fishTurnoverCheck(bars: readonly ResearchBar[], cutoffMs: number, step: number, floors: readonly FishTurnoverFloor[]): { hours: number; min: number; value: number; ok: boolean }[] | null {
  const out = [];
  for (const f of floors) { const value = fishTurnoverWithin(bars, cutoffMs, f.hours, step); if (value === null) return null; out.push({ ...f, value, ok: value >= f.min }); }
  return out;
}
export const formatTurnoverWan = (v: number) => `${Number((v / 1e4).toPrecision(4))} 万`;
/** 没达标的那几条，写成「1h 成交额 58 万 < 100 万」。 */
export const describeTurnoverMiss = (checks: readonly { hours: number; min: number; value: number; ok: boolean }[]) => checks.filter(c => !c.ok).map(c => `${c.hours}h 成交额 ${formatTurnoverWan(c.value)} < ${formatTurnoverWan(c.min)}`).join('，');
