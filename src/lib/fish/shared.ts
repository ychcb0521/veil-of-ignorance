import type { ResearchBar } from '@/lib/deepRsa/window';
export const FISH_STEP = 300_000;
export const FISH_BARS = 2000;
export const FISH_FIRST_USABLE = 1454;
export const FISH_THRESHOLD = 0.3;
export class FishError extends Error { constructor(message: string, readonly kind: 'gap' | 'readings' | 'failed' | 'banned' | 'history', readonly detail?: { path?: string; status?: number }) { super(message); } }
const check = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('已取消', 'AbortError'); };
export function fishDelay(ms: number, signal: AbortSignal): Promise<void> {
  check(signal);
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
export function validateFishBars(bars: readonly ResearchBar[], cutoffMs: number): void {
  const from=cutoffMs-FISH_BARS*FISH_STEP;
  if(!bars.length)throw new FishError('当时没有K线，或可取历史不足2000根','history');
  // Missing only the beginning is different from holes inside an existing price history.
  const first=bars[0].openTime;
  if(first>from&&bars.every((b,i)=>b.openTime===first+i*FISH_STEP)&&bars.at(-1)!.openTime===cutoffMs-FISH_STEP)throw new FishError('最早K线晚于所需起点：当时未上市 / 历史不足2000根','history');
  if(bars.length!==FISH_BARS||bars.some((b,i)=>b.openTime!==from+i*FISH_STEP))throw new FishError('K线中间缺根、末尾缺根或时间点重复','gap');
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
