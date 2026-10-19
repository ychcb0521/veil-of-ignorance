import { fishRetentionReason } from '@/lib/fish/retention';
import { intervalOf } from '@/lib/deepDig/features';
import { CBI2_DEF, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { compileFishProgram, evaluateFishProgram, classifyFishProgram, type FishAlgorithmSettings, type FishSnapshot, type FishProgram } from '@/lib/fish/algorithm';
import { validateFishBars } from '@/lib/fish/shared';
import { fishRuleText } from '@/lib/fishRule';

/** Legacy CBI-2 helpers remain for saved-record and transport compatibility. */
import { CBI2_FORMULA, compileFeatureFormula, evaluateOnBars } from '@/lib/deepDig/features';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import { FISH_STEP, FISH_FIRST_USABLE, FISH_THRESHOLD, FishWeightBudget, FishError, FishRequestPool, fishDelay } from '@/lib/fish/shared';
export { FISH_STEP, FISH_BARS, FISH_FIRST_USABLE, FISH_THRESHOLD, FishWeightBudget, FishError, fishDelay, validateFishBars } from '@/lib/fish/shared';
export interface FishScanSettings { anchorMs?: number; threshold?: number; exchanges?: FishExchange[]; includeDuplicates?: boolean; includeUsStocks?: boolean; feature?: DeepDigFeatureDef; algorithm?: FishAlgorithmSettings; }
/** Explicit UTC+8 parsing; independent of the browser's local timezone. */
export function parseFishSettings(time: string, value: string): FishScanSettings {
  const threshold = value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(threshold)) throw new Error('阈值请输入有限数字');
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
export type FishReading = FishSnapshot;
export type FishOutcome = 'hit' | 'below' | 'unknown' | 'gap' | 'readings' | 'failed';
export interface FishProgress {
  markets?: Partial<Record<'crypto'|'us_stock', FishProgress>>;
  venues?: Partial<Record<FishExchange, FishProgress>>; cutoffMs: number | null; anchorMs?: number | null; threshold?: number; total: number; done: number; current: string;
  counts: Record<FishOutcome, number>; status: 'running' | 'complete' | 'cancelled' | 'aborted' | 'skipped'; error?: string; history?: number; skippedReason?: string; failures?: {failed: {symbol:string;reason:string}[];readings: {symbol:string;reason:string}[]}; blocked?: number; constraintBlocked?: number[]; rule?: string; bars?: number; constraintTexts?: string[];

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
import { AUDITED_EXCHANGES, US_STOCK_EXCHANGES, EXCHANGE_PRIORITY, EXCHANGE_NAMES, fishBase, selectFishMarkets, type FishExchange, type FishMarket } from '@/lib/fish/exchanges';

type ScanOptions = FishScanSettings & { signal: AbortSignal; onProgress: (progress: FishProgress) => void; onSignal: (signal: TradeSignal) => void };
/** One frozen cutoff, a separate adapter/cache/rate budget for each venue, one shared classifier. */
export class FishScanner {
  private running = false;
  private pool = new FishRequestPool();
  readonly budget: FishWeightBudget;
  private adapters = new Map<FishExchange, FishDataAdapter>();
  private requests = new Map<FishExchange, ReturnType<typeof fishTransport>>();
  constructor(private request: typeof fetch = fetch, budget = new FishWeightBudget(), private calculate?: typeof calculateFishReadings, provided: Partial<Record<FishExchange, FishDataAdapter>> = {}) {
    this.budget = budget;
    for (const exchange of AUDITED_EXCHANGES) {
      const pool = exchange === 'binance' ? budget : new FishWeightBudget(Date.now, fishDelay, exchange === 'gate' ? 200 : exchange === 'bitget' ? 10 : 20, exchange === 'gate' ? 10000 : exchange === 'bitget' ? 1000 : 2000);
      const transport = fishTransport(exchange, request, pool, this.pool);
      this.requests.set(exchange, transport); this.adapters.set(exchange, provided[exchange] ?? new FishAdapter(exchange, transport));
    }
  }
  async estimateMarkets(settings:FishScanSettings,signal:AbortSignal):Promise<number> {
    const selected=EXCHANGE_PRIORITY.filter(e=>(settings.exchanges??['binance']).includes(e));
    const highest=Math.max(0,...selected.map(e=>EXCHANGE_PRIORITY.indexOf(e)));
    const needed=AUDITED_EXCHANGES.filter(e=>selected.includes(e)||(!settings.includeDuplicates&&EXCHANGE_PRIORITY.indexOf(e)<highest));
    const universes:Partial<Record<FishExchange,FishMarket[]>>={};
    await Promise.all(needed.map(async e=>{universes[e]=await this.adapters.get(e)!.list(signal);}));
    return selected.reduce((n,e)=>n+selectFishMarkets(e,universes,!!settings.includeDuplicates).filter(m=>settings.includeUsStocks!==false||m.market!=='us_stock').length,0);
  }
  async scan(options: ScanOptions): Promise<FishProgress> {
    if (this.running) throw new Error('扫描正在进行');
    const { anchorMs, includeDuplicates = false, includeUsStocks = true } = options;
    let plan:FishProgram;
    try {plan=compileFishProgram(options.feature??CBI2_DEF,options.algorithm??{H:24,direction:'>',threshold:options.threshold??FISH_THRESHOLD,constraints:[]});if(plan.unavailable)throw new Error(plan.unavailable);}
    catch(error){const p={...initialFishProgress(),status:'aborted' as const,error:error instanceof Error?error.message:String(error)};options.onProgress(p);return p;}
    const threshold=plan.settings.threshold, query={interval: intervalOf(plan.def),count:plan.N};
    const requested = [...(options.exchanges ?? ['binance'])];
    this.running = true;
    const controller = new AbortController(), cancel = () => controller.abort();
    options.signal.addEventListener('abort',cancel,{once:true}); if(options.signal.aborted) cancel();
    const progress = initialFishProgress(); progress.threshold = threshold; progress.bars=plan.N;progress.constraintTexts=plan.texts; progress.rule=fishRuleText(plan.def,plan.settings.H,plan.settings.direction,threshold,plan.texts.length);
    const venues: Partial<Record<FishExchange,FishProgress>> = {};
    const publish = () => {
      for(const venue of Object.values(venues)) {
        const parts=Object.values(venue.markets??{});
        if(parts.length){
          venue.total=parts.reduce((n,x)=>n+x.total,0);venue.done=parts.reduce((n,x)=>n+x.done,0);venue.history=parts.reduce((n,x)=>n+(x.history??0),0);venue.blocked=parts.reduce((n,x)=>n+(x.blocked??0),0);
          venue.constraintBlocked=plan.texts.map((_,i)=>parts.reduce((n,x)=>n+(x.constraintBlocked?.[i]??0),0));venue.failures={failed:parts.flatMap(x=>x.failures?.failed??[]).slice(0,10),readings:parts.flatMap(x=>x.failures?.readings??[]).slice(0,10)};
          for(const key of Object.keys(venue.counts) as FishOutcome[])venue.counts[key]=parts.reduce((n,x)=>n+x.counts[key],0);
          if(venue.status!=='running')for(const part of parts){part.status=venue.status;part.skippedReason=venue.skippedReason;part.error??=venue.error;part.current='';}
        }
      }
      const all = Object.values(venues);
      if(all.length) {
        progress.history=all.reduce((n,p)=>n+(p.history??0),0);
        progress.total=all.reduce((n,p)=>n+p.total,0);progress.done=all.reduce((n,p)=>n+p.done,0);
        progress.blocked=all.reduce((n,p)=>n+(p.blocked??0),0);
        for(const key of Object.keys(progress.counts) as FishOutcome[]) progress.counts[key]=all.reduce((n,p)=>n+p.counts[key],0);
      }
      const clone=(p:FishProgress):FishProgress=>({...p,counts:{...p.counts},constraintBlocked:p.constraintBlocked?[...p.constraintBlocked]:undefined,failures:p.failures?{failed:[...p.failures.failed],readings:[...p.failures.readings]}:undefined,markets:p.markets?Object.fromEntries(Object.entries(p.markets).map(([k,v])=>[k,clone(v)])):undefined});
      const snapshots = Object.fromEntries(Object.entries(venues).map(([e,p])=>[e,clone(p)]));
      options.onProgress({...progress,counts:{...progress.counts},venues:snapshots});
    };
    try {
      if(!Number.isFinite(threshold)) throw new Error('阈值请输入有限数字');
      if(anchorMs!==undefined&&(!Number.isFinite(anchorMs)||anchorMs<=0)) throw new Error('捕捞时间无效');
      if(!requested.length||requested.some(e=>!AUDITED_EXCHANGES.includes(e))) throw new Error('请选择已通过核实的交易所');
      const selected=EXCHANGE_PRIORITY.filter(e=>requested.includes(e));
      for(const e of selected){const part=():FishProgress=>({...initialFishProgress(),threshold,history:0,blocked:0,constraintBlocked:plan.texts.map(()=>0),failures:{failed:[],readings:[]}});venues[e]={...part(),markets:{crypto:part(),...(includeUsStocks&&US_STOCK_EXCHANGES.includes(e)?{us_stock:part()}:{})}};}

      publish();
      const clock=await this.requests.get('binance')!('time',1,controller.signal) as {serverTime?:number};
      if(!Number.isFinite(clock.serverTime)||clock.serverTime!<=0) throw new Error('服务器时间无效');
      if(anchorMs!==undefined&&anchorMs>clock.serverTime!) throw new Error('捕捞时间不能晚于币安服务器当前时间');
      const node=anchorMs??clock.serverTime!,cut=Math.floor(node/plan.step)*plan.step;
      progress.anchorMs=node;progress.cutoffMs=cut;
      for(const exchange of selected){const reason=fishRetentionReason(exchange,cut,clock.serverTime!,plan.N,plan.step,plan.usesTaker,query.interval);if(reason){venues[exchange]!.status='skipped';venues[exchange]!.skippedReason=reason;}}
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
      const binanceByBase=new Map((universes.binance??[]).filter(m=>m.market!=='us_stock').map(m=>[fishBase(m.base),m.symbol]));
      // Preflight every required BTC interval before emitting any signal. A reference gap aborts the entire run.
      const references=new Map<FishExchange,ResearchBar[]>();
      if(plan.compiled.usesBtc){
        await Promise.all(selected.filter(e=>venues[e]!.status!=='skipped').map(async exchange=>{
          const adapter=this.adapters.get(exchange)!;
          try {const btc=await adapter.candles(adapter.btc(),cut,controller.signal,query);validateFishBars(btc,cut,plan.N,plan.step);if(btc.some(b=>!(b.close>0)))throw new Error('BTC收盘价无效');references.set(exchange,btc);}
          catch(error){throw new Error(`${EXCHANGE_NAMES[exchange]} BTC参考K线不完整或请求失败，整次扫描中止：${error instanceof Error?error.message:error}`);}
        }));
      }
      const runVenue=async(exchange:FishExchange)=>{
        const p=venues[exchange]!,adapter=this.adapters.get(exchange)!;
        if(p.status==='skipped'){publish();return;}
        const local=new AbortController(); const stop=()=>local.abort(); controller.signal.addEventListener('abort',stop,{once:true}); if(controller.signal.aborted)stop();
        try {
          const missing=needed.find(e=>errors[e]&&(e===exchange||(!includeDuplicates&&EXCHANGE_PRIORITY.indexOf(e)<EXCHANGE_PRIORITY.indexOf(exchange))));
          if(missing) throw new Error(`${EXCHANGE_NAMES[missing]}标的表获取失败，无法确定优先级：${errors[missing]}`);
          const markets=selectFishMarkets(exchange,universes,includeDuplicates).filter(m=>includeUsStocks||m.market!=='us_stock');for(const [kind,part] of Object.entries(p.markets!))part.total=markets.filter(m=>(m.market??'crypto')===kind).length;publish();
          const btc=references.get(exchange);
          const btcClose=new Map((btc??[]).map(b=>[b.openTime,b.close]));
          let next=0,fatal:string|undefined;
          const worker=async()=>{
            while(!local.signal.aborted){
              const index=next++;if(index>=markets.length)return;const market=markets[index],p=venues[exchange]!.markets![market.market??'crypto']!;let stage='K线（candlesticks / history-candles）';p.current=market.symbol;progress.current=market.symbol;publish();
              try{
                const raw=btc&&market.instrument===adapter.btc().instrument?btc:await adapter.candles(market,cut,local.signal,query);
                validateFishBars(raw,cut,plan.N,plan.step);
                stage='主动成交（trades / history-trades / fills-history）';
                const source=plan.usesTaker?await adapter.taker(market,raw,local.signal,query):raw;
                const bars=source.map(b=>plan.compiled.usesBtc?({...b,refClose:btcClose.get(b.openTime)!}):b);
                if(bars.length!==plan.N||bars.some(b=>(plan.compiled.usesAmounts&&(b.quoteVolume==null||(plan.usesTaker&&b.takerBuyQuoteVolume==null)))||(plan.compiled.usesBtc&&!(b.refClose!>0))))throw new FishError('成交额或BTC读数不全','readings');
                stage=`${plan.def.short}计算`;
                let readings=evaluateFishProgram(bars,plan);
                // Optional numerical fixture injection used by transport tests; production always evaluates the composed program.
                if(this.calculate){const r=this.calculate(bars);const main=Float64Array.from(r.average,a=>!Number.isFinite(a)?NaN:(plan.settings.direction==='>'?a>threshold/plan.def.scale:a<threshold/plan.def.scale)?1:0);readings={...readings,value:r.cbi2,average:r.average,main,condition:main};}
                const result=classifyFishProgram(market.symbol,bars,readings,cut,plan);
                if(local.signal.aborted)return;
                if(result.outcome==='blocked'){p.blocked=(p.blocked??0)+1;result.blockedBy?.forEach((v,i)=>p.constraintBlocked![i]+=v);}else p.counts[result.outcome]++;
                if(result.outcome==='readings'&&p.failures!.readings.length<10)p.failures!.readings.push({symbol:market.symbol,reason:`${plan.def.short}计算：截止处结果、均值或约束不是有限数`});

                if(result.signal){
                  const signal=result.signal;
                  if(market.market==='us_stock'){signal.market='us_stock';signal.underlying=market.underlying??market.base;signal.exchange=exchange;signal.binanceSymbol=null;signal.id=`fish-us-${exchange}-${signal.underlying}-${signal.timeMs}-${encodeURIComponent(plan.algorithmKey)}`;}
                  else if(exchange!=='binance'){signal.id=`fish-${exchange}-${market.symbol}-${signal.timeMs}-${encodeURIComponent(plan.algorithmKey)}`;signal.exchange=exchange;signal.binanceSymbol=binanceByBase.get(fishBase(market.base))??null;}
                  options.onSignal(signal);
                }
              }catch(error){
                if(error instanceof FishError && error.kind==='banned'){fatal=error.message;local.abort();}
                else if(!local.signal.aborted){
                  const kind=error instanceof FishError?error.kind:'failed';
                  if(kind==='history')p.history=(p.history??0)+1;
                  else if(kind!=='banned'){
                    p.counts[kind]++;
                    if((kind==='failed'||kind==='readings')&&p.failures![kind].length<10){
                      const reason=error instanceof TypeError?'浏览器拦截（网络 / 跨域）':error instanceof Error?error.message:String(error);
                      p.failures![kind].push({symbol:market.symbol,reason:`${stage}：${reason.replace(/Failed to fetch/gi,'浏览器拦截（网络 / 跨域）')}`});
                    }
                  }
                }

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
      progress.status=controller.signal.aborted?(options.signal.aborted?'cancelled':'aborted'):Object.values(venues).every(p=>p.status==='aborted')?'aborted':'complete';
      if(progress.status==='aborted')progress.error??=Object.values(venues).map(p=>p.error).filter(Boolean).join('；');
    }catch(error){progress.status=options.signal.aborted?'cancelled':'aborted';if(!options.signal.aborted)progress.error=error instanceof Error?error.message:String(error);controller.abort();}
    finally{
      options.signal.removeEventListener('abort',cancel);this.running=false;progress.current='';
      for(const p of Object.values(venues))if(p.status==='running'){p.status=progress.status==='cancelled'?'cancelled':'aborted';p.error??=progress.error;}
      publish();
    }
    return {...progress,counts:{...progress.counts},venues};
  }
}
