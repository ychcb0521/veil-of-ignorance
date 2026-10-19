/** Manual, closed-candle CBI-2 fishing. Built-in formula only. */
import { CBI2_FORMULA, compileFeatureFormula, evaluateOnBars } from '@/lib/deepDig/features';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import { FISH_STEP, FISH_FIRST_USABLE, FISH_THRESHOLD, FishWeightBudget, FishError, FishRequestPool, fishDelay } from '@/lib/fish/shared';
export { FISH_STEP, FISH_BARS, FISH_FIRST_USABLE, FISH_THRESHOLD, FishWeightBudget, FishError, fishDelay, validateFishBars } from '@/lib/fish/shared';
export interface FishScanSettings { anchorMs?: number; threshold?: number; exchanges?: FishExchange[]; includeDuplicates?: boolean; }
/** Explicit UTC+8 parsing; independent of the browser's local timezone. */
export function parseFishSettings(time: string, value: string): FishScanSettings {
  const threshold = value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) throw new Error('阈值请输入 -1 到 1 之间的数字');
  const input = time.trim();
  if (!input) return { threshold };
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/.exec(input);
  if (!match) throw new Error('时间请输入 YYYY-MM-DD HH:mm:ss（UTC+8）');
  const normalized = `${match[1]} ${match[2]}:${match[3] ?? '00'}`;
  const anchorMs = Date.parse(`${normalized.replace(' ', 'T')}+08:00`);
  if (!Number.isFinite(anchorMs) || anchorMs <= 0 || formatUTC8(anchorMs) !== normalized) throw new Error('捕捞时间无效，请检查日期和时间');
  return { anchorMs, threshold };
}
const formula = compileFeatureFormula(`${CBI2_FORMULA}\nfishAvg = avg(CBI2, 24)`);
export interface FishReading { average: number; cbi2: number; startAverage: number; previousAverage: number; cutoffMs: number; threshold: number; }
export type FishOutcome = 'hit' | 'below' | 'unknown' | 'gap' | 'readings' | 'failed';
export interface FishProgress {
  venues?: Partial<Record<FishExchange, FishProgress>>; cutoffMs: number | null; anchorMs?: number | null; threshold?: number; total: number; done: number; current: string;
  counts: Record<FishOutcome, number>; status: 'running' | 'complete' | 'cancelled' | 'aborted'; error?: string;
}
export const initialFishProgress = (): FishProgress => ({ cutoffMs: null, anchorMs: null, threshold: FISH_THRESHOLD, total: 0, done: 0, current: '', counts: { hit: 0, below: 0, unknown: 0, gap: 0, readings: 0, failed: 0 }, status: 'running' });
export function calculateFishReadings(bars: readonly ResearchBar[]): { cbi2: Float64Array; average: Float64Array } {
  const result = evaluateOnBars(bars, formula, { interval: '5m', avgHours: 24 });
  return { cbi2: result.vars.get('CBI2') as Float64Array, average: result.last as Float64Array };
}
/** Detect the start of the CURRENT uninterrupted > threshold episode, strictly after warm-up. */
export function classifyFishReadings(symbol: string, bars: readonly ResearchBar[], cbi2: ArrayLike<number>, average: ArrayLike<number>, cutoffMs: number, threshold = FISH_THRESHOLD): { outcome: FishOutcome; signal?: TradeSignal } {
  const last = bars.length - 1;
  if (last < FISH_FIRST_USABLE || average.length !== bars.length || cbi2.length !== bars.length) return { outcome: 'readings' };
  for (let i = FISH_FIRST_USABLE - 287; i <= last; i++) if (!Number.isFinite(cbi2[i])) return { outcome: 'readings' };
  for (let i = FISH_FIRST_USABLE; i <= last; i++) if (!Number.isFinite(average[i])) return { outcome: 'readings' };
  if (!(average[last] > threshold)) return { outcome: 'below' };
  let k = last;
  while (k > FISH_FIRST_USABLE && average[k - 1] > threshold) k--;
  if (k <= FISH_FIRST_USABLE) return { outcome: 'unknown' };
  const timeMs = bars[k].openTime + FISH_STEP;
  return { outcome: 'hit', signal: {
    id: `fish-${symbol}-${timeMs}`, symbol, timeMs, timeLabel: formatUTC8(timeMs), fallbackZone: '',
    fish: { average: average[last], cbi2: cbi2[last], startAverage: average[k], previousAverage: average[k - 1], cutoffMs, threshold },
  } };
}

import { FishAdapter, fishTransport, type FishDataAdapter } from '@/lib/fish/adapters';
import { AUDITED_EXCHANGES, EXCHANGE_PRIORITY, EXCHANGE_NAMES, fishBase, selectFishMarkets, type FishExchange, type FishMarket } from '@/lib/fish/exchanges';

type ScanOptions = FishScanSettings & { signal: AbortSignal; onProgress: (progress: FishProgress) => void; onSignal: (signal: TradeSignal) => void };
/** One frozen cutoff, a separate adapter/cache/rate budget for each venue, one shared classifier. */
export class FishScanner {
  private running = false;
  private pool = new FishRequestPool();
  readonly budget: FishWeightBudget;
  private adapters = new Map<FishExchange, FishDataAdapter>();
  private requests = new Map<FishExchange, ReturnType<typeof fishTransport>>();
  constructor(private request: typeof fetch = fetch, budget = new FishWeightBudget(), private calculate = calculateFishReadings, provided: Partial<Record<FishExchange, FishDataAdapter>> = {}) {
    this.budget = budget;
    for (const exchange of AUDITED_EXCHANGES) {
      const pool = exchange === 'binance' ? budget : new FishWeightBudget(Date.now, fishDelay, exchange === 'gate' ? 200 : exchange === 'bitget' ? 10 : 20, exchange === 'gate' ? 10000 : exchange === 'bitget' ? 1000 : 2000);
      const transport = fishTransport(exchange, request, pool, this.pool);
      this.requests.set(exchange, transport); this.adapters.set(exchange, provided[exchange] ?? new FishAdapter(exchange, transport));
    }
  }
  async scan(options: ScanOptions): Promise<FishProgress> {
    if (this.running) throw new Error('扫描正在进行');
    const { anchorMs, threshold = FISH_THRESHOLD, includeDuplicates = false } = options;
    const requested = [...(options.exchanges ?? ['binance'])];
    this.running = true;
    const controller = new AbortController(), cancel = () => controller.abort();
    options.signal.addEventListener('abort',cancel,{once:true}); if(options.signal.aborted) cancel();
    const progress = initialFishProgress(); progress.threshold = threshold;
    const venues: Partial<Record<FishExchange,FishProgress>> = {};
    const publish = () => {
      const all = Object.values(venues);
      if(all.length) {
        progress.total=all.reduce((n,p)=>n+p.total,0);progress.done=all.reduce((n,p)=>n+p.done,0);
        for(const key of Object.keys(progress.counts) as FishOutcome[]) progress.counts[key]=all.reduce((n,p)=>n+p.counts[key],0);
      }
      const snapshots = Object.fromEntries(Object.entries(venues).map(([e,p])=>[e,{...p,counts:{...p.counts}}]));
      options.onProgress({...progress,counts:{...progress.counts},venues:snapshots});
    };
    try {
      if(!Number.isFinite(threshold)||threshold < -1||threshold > 1) throw new Error('阈值请输入 -1 到 1 之间的数字');
      if(anchorMs!==undefined&&(!Number.isFinite(anchorMs)||anchorMs<=0)) throw new Error('捕捞时间无效');
      if(!requested.length||requested.some(e=>!AUDITED_EXCHANGES.includes(e))) throw new Error('请选择已通过核实的交易所');
      const selected=EXCHANGE_PRIORITY.filter(e=>requested.includes(e));
      for(const e of selected) venues[e]={...initialFishProgress(),threshold};
      publish();
      const clock=await this.requests.get('binance')!('time',1,controller.signal) as {serverTime?:number};
      if(!Number.isFinite(clock.serverTime)||clock.serverTime!<=0) throw new Error('服务器时间无效');
      if(anchorMs!==undefined&&anchorMs>clock.serverTime!) throw new Error('捕捞时间不能晚于币安服务器当前时间');
      const node=anchorMs??clock.serverTime!,cut=Math.floor(node/FISH_STEP)*FISH_STEP;
      progress.anchorMs=node;progress.cutoffMs=cut;
      for(const p of Object.values(venues)){p.anchorMs=node;p.cutoffMs=cut;}
      publish();
      const highest=Math.max(...selected.map(e=>EXCHANGE_PRIORITY.indexOf(e)));
      // Always obtain Binance's universe for chart availability. Higher-priority venues own a base even when unchecked.
      const needed=AUDITED_EXCHANGES.filter(e=>e==='binance'||selected.includes(e)||(!includeDuplicates&&EXCHANGE_PRIORITY.indexOf(e)<highest));
      const universes:Partial<Record<FishExchange,FishMarket[]>>={},errors:Partial<Record<FishExchange,string>>={};
      await Promise.all(needed.map(async e=>{
        try{universes[e]=await this.adapters.get(e)!.list(controller.signal);}
        catch(error){errors[e]=error instanceof Error?error.message:String(error);}
      }));
      const binanceByBase=new Map((universes.binance??[]).map(m=>[fishBase(m.base),m.symbol]));
      const runVenue=async(exchange:FishExchange)=>{
        const p=venues[exchange]!,adapter=this.adapters.get(exchange)!;
        const local=new AbortController(); const stop=()=>local.abort(); controller.signal.addEventListener('abort',stop,{once:true}); if(controller.signal.aborted)stop();
        try {
          const missing=needed.find(e=>errors[e]&&(e===exchange||(!includeDuplicates&&EXCHANGE_PRIORITY.indexOf(e)<EXCHANGE_PRIORITY.indexOf(exchange))));
          if(missing) throw new Error(`${EXCHANGE_NAMES[missing]}标的表获取失败，无法确定优先级：${errors[missing]}`);
          const markets=selectFishMarkets(exchange,universes,includeDuplicates);p.total=markets.length;publish();
          let btc:ResearchBar[];
          try{btc=await adapter.candles(adapter.btc(),cut,local.signal);}
          catch(error){throw new Error(`BTC参考K线不完整或请求失败，本交易所中止：${error instanceof Error?error.message:error}`);}
          const btcClose=new Map(btc.map(b=>[b.openTime,b.close]));
          let next=0,fatal:string|undefined;
          const worker=async()=>{
            while(!local.signal.aborted){
              const index=next++;if(index>=markets.length)return;const market=markets[index];p.current=market.symbol;progress.current=market.symbol;publish();
              try{
                const raw=market.instrument===adapter.btc().instrument?btc:await adapter.candles(market,cut,local.signal);
                const source=await adapter.taker(market,raw,local.signal);
                const bars=source.map(b=>({...b,refClose:btcClose.get(b.openTime)!}));
                if(bars.some(b=>b.quoteVolume==null||b.takerBuyQuoteVolume==null||!(b.refClose!>0))) throw new FishError('成交额或BTC读数不全','readings');
                const readings=this.calculate(bars),result=classifyFishReadings(market.symbol,bars,readings.cbi2,readings.average,cut,threshold);
                if(local.signal.aborted)return;
                p.counts[result.outcome]++;
                if(result.signal){
                  const signal=result.signal;
                  if(exchange!=='binance'){signal.id=`fish-${exchange}-${market.symbol}-${signal.timeMs}`;signal.exchange=exchange;signal.binanceSymbol=binanceByBase.get(fishBase(market.base))??null;}
                  options.onSignal(signal);
                }
              }catch(error){
                if(error instanceof FishError && error.kind==='banned'){fatal=error.message;local.abort();}
                else if(!local.signal.aborted)p.counts[error instanceof FishError&&error.kind!=='banned'?error.kind:'failed']++;
              }
              if(local.signal.aborted)return;p.done++;publish();await fishDelay(0,local.signal);
            }
          };
          await Promise.allSettled(Array.from({length:Math.min(3,markets.length)},worker));
          p.status=fatal?'aborted':local.signal.aborted?'cancelled':'complete';if(fatal)p.error=fatal;
        }catch(error){p.status=controller.signal.aborted?'cancelled':'aborted';if(!controller.signal.aborted)p.error=error instanceof Error?error.message:String(error);}
        finally{controller.signal.removeEventListener('abort',stop);p.current='';publish();}
      };
      // Venue failures never cancel the other venues; budgets and BTC references are independent.
      await Promise.allSettled(selected.map(runVenue));
      progress.status=controller.signal.aborted?'cancelled':Object.values(venues).every(p=>p.status==='aborted')?'aborted':'complete';
      if(progress.status==='aborted')progress.error=Object.values(venues).map(p=>p.error).filter(Boolean).join('；');
    }catch(error){progress.status=options.signal.aborted?'cancelled':'aborted';if(!options.signal.aborted)progress.error=error instanceof Error?error.message:String(error);controller.abort();}
    finally{
      options.signal.removeEventListener('abort',cancel);this.running=false;progress.current='';
      for(const p of Object.values(venues))if(p.status==='running'){p.status=progress.status==='cancelled'?'cancelled':'aborted';p.error??=progress.error;}
      publish();
    }
    return {...progress,counts:{...progress.counts},venues};
  }
}
