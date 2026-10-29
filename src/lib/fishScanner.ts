import { fishProgramForLookback, limitFishLookback } from '@/lib/fish/lookback';
import { checkFishDownwardWick, describeFishWick, fishWickCount, type FishDownwardWick, type FishWickRejection } from '@/lib/fish/downwardWick';
import { saveFishRound, summarizeFishRound, type FishRoundRow } from '@/lib/fish/roundSummary';
import { fishCombinationKey, combineFishResults, sharedFishAdapters, type FishMemberResult, type FishAlgorithmInput, type FishCombination } from '@/lib/fish/intersection';
import {collectFishSuggestion,type FishSuggestionOptions,type FishSampleRow} from '@/lib/fish/suggestions';
import {collectSignalTurnover,TURNOVER_BARS,TURNOVER_STEP,type SignalTurnoverOptions} from '@/lib/signalTurnover';
import {collectFishReconstruction,type FishReconstructionOptions} from '@/lib/fish/reconstruction';
import {createFishReconstructionLoader} from '@/lib/fish/reconstructionLoader';
import { fishRetentionReason } from '@/lib/fish/retention';
import { intervalOf, definitionKey } from '@/lib/deepDig/features';
import { CBI2_DEF, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { compileFishProgram, evaluateFishProgram, classifyFishProgram, FISH_STATE_HOLD_TEXT, type FishAlgorithmSettings, type FishSnapshot, type FishProgram } from '@/lib/fish/algorithm';
import { validateFishBars, fishTurnoverCheck, describeTurnoverMiss, FISH_MAX_ALGORITHMS, type FishTurnoverFloor } from '@/lib/fish/shared';
import { fishSignalTurnoverOk, fishTail, fishTightenable, placeFishSignal, tightenFishResult, type FishPlace } from '@/lib/fish/refilter';
import { fishStatisticName, fishRuleText } from '@/lib/fishRule';

/** Legacy CBI-2 helpers remain for saved-record and transport compatibility. */
import { CBI2_FORMULA, compileFeatureFormula, evaluateOnBars } from '@/lib/deepDig/features';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import { FISH_STEP, FISH_FIRST_USABLE, FISH_THRESHOLD, FishWeightBudget, FishError, FishRequestPool, fishDelay } from '@/lib/fish/shared';
export { FISH_STEP, FISH_BARS, FISH_FIRST_USABLE, FISH_THRESHOLD, FishWeightBudget, FishError, fishDelay, validateFishBars } from '@/lib/fish/shared';
export interface FishScanSettings { /** Signal starts within this many hours before the frozen anchor; omitted = legacy unrestricted capture. */ lookbackHours?: number; downwardWick?: FishDownwardWick; /** 成交额门槛：截止前各时长的 USDT 成交额下限，任一条不够就跳过、不判定；不填不限。 */ turnoverFloors?: readonly FishTurnoverFloor[]; anchorMs?: number; threshold?: number; exchanges?: FishExchange[]; includeDuplicates?: boolean; includeUsStocks?: boolean; feature?: DeepDigFeatureDef; algorithm?: FishAlgorithmSettings; algorithms?: FishAlgorithmInput[]; /** 多重算法：and 交集（缺省）/ or 并集 */ combination?: FishCombination; /** 保留所有卡的独立结果，勾选只控制本轮显示。 */ retainMembers?: boolean; displayAlgorithmKeys?: string[]; }
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
export type FishOutcome = 'hit' | 'below' | 'unknown' | 'gap' | 'readings' | 'failed' | 'outside';
export interface FishProgress {
  /** One rejection per venue/market/instrument, even when several algorithms reject it. */
  wickDetails?: FishWickRejection[];
  lookbackHours?:number;
  /** 本轮跳过了某家但扫描仍在继续时的说明（如 BTC 参考取不到），淡色显示。 */
  notice?: string;
  algorithmHits?: number[];
  markets?: Partial<Record<'crypto'|'us_stock', FishProgress>>;
  venues?: Partial<Record<FishExchange, FishProgress>>; cutoffMs: number | null; anchorMs?: number | null; threshold?: number; total: number; done: number; current: string;
  counts: Record<Exclude<FishOutcome,'outside'>, number> & {outside?:number}; status: 'running' | 'complete' | 'cancelled' | 'aborted' | 'skipped'; error?: string; history?: number; /** 截止前 24 小时成交额低于下限、跳过不判定的币数。 */ thin?: number; wickSkipped?: number; skippedReason?: string; failures?: {failed: {symbol:string;reason:string}[];readings: {symbol:string;reason:string}[]}; blocked?: number; constraintBlocked?: number[]; rule?: string; bars?: number; constraintTexts?: string[];

}
export const initialFishProgress = (): FishProgress => ({ cutoffMs: null, anchorMs: null, threshold: FISH_THRESHOLD, total: 0, done: 0, current: '', counts: { hit: 0, below: 0, unknown: 0, gap: 0, readings: 0, failed: 0, outside: 0 }, status: 'running' });
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
import { collectFishQuality, type QualityRunOptions } from '@/lib/fish/quality';
import { collectQualityRepair } from '@/lib/fish/qualityRepair';
import { AUDITED_EXCHANGES, US_STOCK_EXCHANGES, EXCHANGE_PRIORITY, EXCHANGE_NAMES, fishBase, isFishStablecoin, selectFishMarkets, type FishExchange, type FishMarket } from '@/lib/fish/exchanges';

export interface FishDiagnosis { outcome: 'outside' | 'hit' | 'below' | 'blocked' | 'unknown' | 'readings' | 'history' | 'gap' | 'failed' | 'skipped' | 'not_found'; cutoffMs?: number; lines: string[]; member?: FishMemberResult }
/**
 * 多重算法一轮的逐币结论：扫完后交给页面保存，切换「交集 / 并集」时直接用它重新合并，不用重扫。
 * 【用户要求】2026-10-20「并集这里捕捉完之后，我希望当我点击交集的时候，可以灵活切换到交集的结果」。
 */
/** 信号库里的一条（标的 + 交易所 + 是否美股）对应到那家的合约；币安按名字直接取，其它家查合约列表（每家只拉一次）。 */
async function sampleMarket(row:FishSampleRow,exchange:FishExchange,adapter:FishDataAdapter,lists:Map<FishExchange,Promise<FishMarket[]>>,signal:AbortSignal):Promise<FishMarket>{
  if(exchange==='binance'&&row.market!=='us_stock')return {symbol:row.symbol,instrument:row.symbol,base:row.symbol.replace(/USDT$/,''),multiplier:1};
  let list=lists.get(exchange);if(!list){list=adapter.list(signal);lists.set(exchange,list);list.catch(()=>lists.delete(exchange));}
  const markets=await list,code=(row.underlying||row.symbol.replace(/USDT$/,'')).toUpperCase();
  const market=markets.find(m=>m.symbol===row.symbol&&(row.market==='us_stock')===(m.market==='us_stock'))
    ??(row.market==='us_stock'?markets.find(m=>m.market==='us_stock'&&(m.underlying||m.base).toUpperCase()===code):undefined);
  if(!market)throw new FishError(`${EXCHANGE_NAMES[exchange]}现在没有 ${row.symbol} 这个合约`,'skipped');
  return market;
}
export interface FishCombinationRound { lookbackHours?:number; plans: FishProgram[]; results: Map<string, Map<number, FishMemberResult>>; anchorMs: number; complete: boolean; memberHits: number[] }
/** Definition changes must not reuse readings from an older formula. */
export const fishSelectionKey = (p: FishProgram): string => JSON.stringify([p.algorithmKey,definitionKey(p.def),p.scale,p.unit]);
export function selectFishRound(round: FishCombinationRound, keys: readonly string[]): FishCombinationRound | null {
  const available = round.plans.map((_,i)=>i), indices:number[]=[];
  for(const key of keys){const at=available.findIndex(i=>fishSelectionKey(round.plans[i])===key||round.plans[i].algorithmKey===key);if(at<0)return null;indices.push(available.splice(at,1)[0]);}
  return {...round,plans:indices.map(i=>round.plans[i]),memberHits:indices.map(i=>round.memberHits[i]),results:new Map([...round.results].map(([key,members])=>[key,new Map(indices.flatMap((i,j)=>members.has(i)?[[j,members.get(i)!] as const]:[]))]))};
}
/**
 * 按当前卡片的算法取本轮结果：设置没变的直接用；只把阈值往严里调了的，用留下的读数当场重判（refilter.ts）。
 * 有一张卡既对不上、也不能由本轮算出（换了特征值 / 统计量 / 方向，或阈值放宽了），返回 null。
 * 【用户要求】2026-10-20「捕捉运行完成之后，将区间值调大之后能更细致过滤，而不用再重新运行」。
 */
export function deriveFishRound(round: FishCombinationRound, targets: readonly FishProgram[]): FishCombinationRound | null {
  const used = new Set<number>(), picks: { index: number; plan: FishProgram; exact: boolean }[] = [];
  for (const target of targets) {
    const key = fishSelectionKey(target);
    let index = round.plans.findIndex((p, i) => !used.has(i) && fishSelectionKey(p) === key);
    const exact = index >= 0;
    if (!exact) index = round.plans.findIndex((p, i) => !used.has(i) && fishTightenable(p, target));
    if (index < 0) return null;
    used.add(index); picks.push({ index, plan: exact ? round.plans[index] : target, exact });
  }
  const results = new Map<string, Map<number, FishMemberResult>>(), hits = picks.map(() => 0);
  for (const [key, members] of round.results) {
    const next = new Map<number, FishMemberResult>();
    for (const [j, pick] of picks.entries()) {
      const r = members.get(pick.index);
      if (!r) continue;
      const raw = pick.exact ? r : tightenFishResult(r, pick.plan);
      const derived = raw && limitFishLookback(raw,round.anchorMs,round.lookbackHours);
      if (!derived) return null;
      if (derived.outcome === 'hit') hits[j]++;
      next.set(j, derived);
    }
    results.set(key, next);
  }
  return { ...round, plans: picks.map(p => p.plan), results, memberHits: picks.map((p, j) => p.exact ? round.memberHits[p.index] ?? hits[j] : hits[j]) };
}
/** 「捕捞过程」里单个算法这一轮的摘要（重判出来的阈值没扫过，按重判后的逐币结论补一份）。 */
export function saveFishMemberRound(round: FishCombinationRound, j: number): void {
  const plan = round.plans[j];
  if (!plan) return;
  const rows: FishRoundRow[] = [];
  for (const [key, members] of round.results) {
    const r = members.get(j);
    if (!r) continue;
    const [exchange, market, symbol] = key.split('|');
    rows.push({ symbol, exchange, market: market === 'crypto' ? undefined : market, reading: r.reading ?? NaN, outcome: r.outcome });
  }
  if (!rows.length) return;
  const cutoffMs = Math.floor(round.anchorMs / plan.step) * plan.step;
  saveFishRound(summarizeFishRound(rows, { algorithmKey: plan.algorithmKey, cutoffMs, anchorMs: round.anchorMs, direction: plan.settings.direction, threshold: plan.settings.threshold, scale: plan.scale, unit: plan.unit, partial: !round.complete }));
}
/** 按某种合并方式，把一轮的逐币结论合成鱼。并集里有算法没结论的币只在这一轮完整扫完时才合并。 */
export function combineFishRound(round: FishCombinationRound, mode: FishCombination): { signals: TradeSignal[]; counts: Record<string, number> } {
  const signals: TradeSignal[] = [], counts: Record<string, number> = {};
  if (!round.plans.length) return {signals,counts};
  for (const members of round.results.values()) {
    if (mode === 'and' && members.size !== round.plans.length) continue;
    if (mode === 'or' && members.size !== round.plans.length && !round.complete) continue;
    const r = combineFishResults(round.plans.map((_, i) => members.get(i)), round.plans, mode);
    counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    if (r.signal) signals.push(r.signal);
  }
  return { signals, counts };
}
/** 「捕捞过程」的组合摘要（多重算法）：参与判定的币数、组合命中数、各算法单独命中数。 */
export function saveFishCombinationRound(round: FishCombinationRound, mode: FishCombination): void {
  const { plans, results, anchorMs } = round;
  if(plans.length<2)return;
  const rows: FishRoundRow[] = [...results].map(([key, members]) => {
    const [exchange, market, symbol] = key.split('|');
    const r = combineFishResults(plans.map((_, i) => members.get(i)), plans, mode);
    return { symbol, exchange, market: market === 'crypto' ? undefined : market, reading: NaN, outcome: mode === 'and' && members.size !== plans.length ? 'readings' : r.outcome };
  });
  const summary = summarizeFishRound(rows, { algorithmKey: fishCombinationKey(plans, mode), cutoffMs: Math.floor(anchorMs / plans[0].step) * plans[0].step, anchorMs, direction: '>', threshold: NaN, scale: 1, unit: '', partial: !round.complete });
  saveFishRound({ ...summary, combination: mode, cutoffs: plans.map(p => Math.floor(anchorMs / p.step) * p.step), members: plans.map((p, i) => ({ algorithmKey: p.algorithmKey, hits: round.memberHits[i] ?? 0 })) });
}
/** Completed per-market decisions for one background mining attempt; transient failures are retried. */
export type FishScanCheckpoint = Map<string, Map<string, FishMemberResult>>;
type ScanOptions = FishScanSettings & {
  checkpoint?: FishScanCheckpoint;
  /** 捕捞中可改的交集 / 并集（2026-10-21「捕捞运行的过程中，我也可以灵活切换到并集」）：每判完一个币读一次当前值。 */
  combinationRef?: { current: FishCombination };
  /** 多重算法开扫时交出本轮逐币结论（Map 随扫描逐步填满），捕捞中切换组合时据此当场重排。 */
  onLiveRound?: (round: FishCombinationRound) => void;
  onRound?: (round: FishCombinationRound) => void; onResult?: (key:string,result:FishMemberResult)=>void; skipReasons?: Partial<Record<FishExchange,string>>; signal: AbortSignal; onProgress: (progress: FishProgress) => void; onSignal: (signal: TradeSignal) => void };
/** One frozen cutoff, a separate adapter/cache/rate budget for each venue, one shared classifier. */
export class FishScanner {
  async repairQuality(options: Parameters<typeof collectQualityRepair>[0]): Promise<void> {
    const response = await this.requests.get('binance')!('time',1,options.signal) as { serverTime?: number };
    if (!Number.isFinite(response.serverTime) || response.serverTime! <= 0) throw new FishError('币安服务器时间无效','failed');
    const now = response.serverTime!;
    await collectQualityRepair(options,createFishReconstructionLoader(this.adapters,async () => now),now);
  }
  private running = false;
  /** 捕捞、建议、复原、成交额统计都共用这一个取数器；正在跑时自动捕捞要等它结束。 */
  isBusy(): boolean { return this.running; }
  /** Paper quality studies share the public-data cache and request pool, without stopping live catches. */
  async quality(options: QualityRunOptions): Promise<void> {
    const response = await this.requests.get('binance')!('time', 1, options.signal) as { serverTime?: number };
    if (!Number.isFinite(response.serverTime) || response.serverTime! <= 0) throw new FishError('币安服务器时间无效', 'failed');
    const now = response.serverTime!;
    const load = createFishReconstructionLoader(this.adapters, async () => now);
    await collectFishQuality(options, load, now);
  }
  private latestServerTime = 0;
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
  /**
   * 阈值建议的取数：与捕捞同一套适配器、K 线缓存、请求池与限速。
   * 每条样本按它自己的交易所 / 市场取（币安加密币直接按名字取，下架的也能取到历史；其它家与美股按当前合约列表找到合约）；
   * 超出该家保留期、或该家现在没有这个合约的，跳过并计数。
   */
  async suggest(options:FishSuggestionOptions) {
    if(this.running)throw new Error('捕捞或建议计算正在进行');
    this.running=true;
    let clock:Promise<unknown>|undefined;
    const lists=new Map<FishExchange,Promise<FishMarket[]>>();
    try{return await collectFishSuggestion(options,async(row,cut,plan,signal)=>{
      if(cut>Math.floor(this.latestServerTime/plan.step)*plan.step||!this.latestServerTime){
        clock??=this.requests.get('binance')!('time',1,signal);
        const response=await clock as {serverTime?:number};
        if(!Number.isFinite(response.serverTime)||response.serverTime!<=0)throw new FishError('币安服务器时间无效','failed');
        this.latestServerTime=Math.max(this.latestServerTime,response.serverTime!);
        if(cut>Math.floor(this.latestServerTime/plan.step)*plan.step)throw new FishError('该时间点尚未全部收盘（晚于币安服务器时间）','readings');
      }
      const exchange:FishExchange=row.exchange??'binance',adapter=this.adapters.get(exchange);
      if(!adapter)throw new FishError(`不支持的交易所 ${exchange}`,'skipped');
      const query={interval:intervalOf(plan.def),count:plan.N};
      const retention=fishRetentionReason(exchange,cut,this.latestServerTime,plan.N,plan.step,plan.usesTaker,query.interval);
      if(retention)throw new FishError(`${EXCHANGE_NAMES[exchange]}：${retention}`,'skipped');
      const market=await sampleMarket(row,exchange,adapter,lists,signal);
      const raw=await adapter.candles(market,cut,signal,query);validateFishBars(raw,cut,plan.N,plan.step);
      const bars=plan.usesTaker?await adapter.taker(market,raw,signal,query):raw;
      if(bars.some(b=>plan.compiled.usesAmounts&&(b.quoteVolume==null||(plan.usesTaker&&b.takerBuyQuoteVolume==null))))throw new FishError('成交额读数不全','readings');
      if(!plan.compiled.usesBtc)return bars;
      // 用到 CB 时取同一家的 BTC 永续（与捕捞相同）；币安直接按名字取，其它家合约列表上面已经拉过
      const btcMarket:FishMarket=exchange==='binance'?{symbol:'BTCUSDT',instrument:'BTCUSDT',base:'BTC',multiplier:1}:adapter.btc();
      const btc=await adapter.candles(btcMarket,cut,signal,query);
      validateFishBars(btc,cut,plan.N,plan.step);const closes=new Map(btc.map(b=>[b.openTime,b.close]));
      if(btc.some(b=>!(b.close>0)))throw new FishError('BTC参考收盘价无效','readings');
      return bars.map(b=>({...b,refClose:closes.get(b.openTime)}));
    });}finally{this.running=false;}
  }
  /**
   * 信号库每个信号前 24 小时的成交额（USDT），与「建议区间」同一套按交易所取数（signalTurnover.ts）。
   * 【用户要求】2026-10-20「检查历史信号库中所有信号在当时信号出现时的成交量，汇总看区间范围，用 USDT」。
   */
  async turnover(options:SignalTurnoverOptions) {
    if(this.running)throw new Error('捕捞或建议计算正在进行');
    this.running=true;
    let clock:Promise<unknown>|undefined;
    const lists=new Map<FishExchange,Promise<FishMarket[]>>();
    try{return await collectSignalTurnover(options,async(row,cut,signal)=>{
      if(!this.latestServerTime||cut>this.latestServerTime){
        clock??=this.requests.get('binance')!('time',1,signal);
        const response=await clock as {serverTime?:number};
        if(!Number.isFinite(response.serverTime)||response.serverTime!<=0)throw new FishError('币安服务器时间无效','failed');
        this.latestServerTime=Math.max(this.latestServerTime,response.serverTime!);
        if(cut>this.latestServerTime)throw new FishError('信号时间晚于币安服务器时间','readings');
      }
      const exchange:FishExchange=row.exchange??'binance',adapter=this.adapters.get(exchange);
      if(!adapter)throw new FishError(`不支持的交易所 ${exchange}`,'skipped');
      const retention=fishRetentionReason(exchange,cut,this.latestServerTime,TURNOVER_BARS,TURNOVER_STEP,false,'5m');
      if(retention)throw new FishError(`${EXCHANGE_NAMES[exchange]}：${retention}`,'skipped');
      const market=await sampleMarket(row,exchange,adapter,lists,signal);
      return adapter.candles(market,cut,signal,{interval:'5m',count:TURNOVER_BARS,allowPartial:true});
    });}finally{this.running=false;}
  }
  /** Local historical reconstruction; no signal record is changed or saved by the scanner. */
  async reconstruct(options: FishReconstructionOptions) {
    if (this.running) throw new Error('捕捞、建议或复原计算正在进行');
    this.running = true;
    const load = createFishReconstructionLoader(this.adapters, async signal => {
      const response = await this.requests.get('binance')!('time', 1, signal) as { serverTime?: number };
      if (!Number.isFinite(response.serverTime) || response.serverTime! <= 0) throw new FishError('币安服务器时间无效', 'failed');
      this.latestServerTime = Math.max(this.latestServerTime, response.serverTime!);
      return response.serverTime!;
    });
    try { return await collectFishReconstruction(options, load); }
    finally { this.running = false; }
  }
  async estimateMarkets(settings:FishScanSettings,signal:AbortSignal):Promise<number> {
    const selected=EXCHANGE_PRIORITY.filter(e=>(settings.exchanges??['binance']).includes(e));
    const highest=Math.max(0,...selected.map(e=>EXCHANGE_PRIORITY.indexOf(e)));
    const needed=AUDITED_EXCHANGES.filter(e=>selected.includes(e)||(!settings.includeDuplicates&&EXCHANGE_PRIORITY.indexOf(e)<highest));
    const universes:Partial<Record<FishExchange,FishMarket[]>>={};
    await Promise.all(needed.map(async e=>{universes[e]=await this.adapters.get(e)!.list(signal);}));
    return selected.reduce((n,e)=>n+selectFishMarkets(e,universes,!!settings.includeDuplicates).filter(m=>settings.includeUsStocks===true||m.market!=='us_stock').length,0);
  }
  /**
   * 查单个币：用与捕捞完全相同的取数与判定，说清楚它在当前设置下为什么命中 / 没命中。
   * 【用户要求】2026-10-19「原来能捕捉到，现在却捕捉不到，啥原因？请解决」——给每个币一个可核对的答案。
   */
  async diagnose(options: { lookbackHours?: number; downwardWick?: FishDownwardWick; turnoverFloors?: readonly FishTurnoverFloor[]; symbol: string; exchange?: FishExchange; anchorMs?: number; feature?: DeepDigFeatureDef; algorithm?: FishAlgorithmSettings; algorithms?: FishAlgorithmInput[]; combination?: FishCombination; signal: AbortSignal }): Promise<FishDiagnosis> {
    // 稳定币捕捞时整体排除（selectFishMarkets），查单个币也直接说明，不再取数
    const stableBase=options.symbol.trim().toUpperCase().replace(/[-_/]?USDT$/,'');
    if(stableBase&&isFishStablecoin(stableBase))return {outcome:'skipped',lines:[`${stableBase} 是稳定币，价格几乎不动、没有短线交易价值，捕捞时整体排除，不参与判定`]};
    if(options.algorithms?.length){
      if(options.algorithms.length===1)return this.diagnose({...options,...options.algorithms[0],algorithms:undefined});
      const clock=await this.requests.get('binance')!('time',1,options.signal) as {serverTime:number};
      const anchorMs=options.anchorMs??clock.serverTime;
      const plans=options.algorithms.map(a=>fishProgramForLookback(compileFishProgram(a.feature,a.algorithm),options.lookbackHours,options.turnoverFloors));
      const shared=sharedFishAdapters(this.adapters,plans,anchorMs,undefined,options.downwardWick?.enabled?fishWickCount(options.downwardWick):0);
      const scanner=new FishScanner(async()=>new Response(JSON.stringify(clock)),undefined,undefined,shared);
      const exchange=options.exchange??'binance';
      const mode:FishCombination=options.combination??'and';
      const reasons=plans.map(p=>p.unavailable??fishRetentionReason(exchange,Math.floor(anchorMs/p.step)*p.step,clock.serverTime,p.N,p.step,p.usesTaker,intervalOf(p.def)));
      if(mode==='and'&&reasons.some(Boolean))return {outcome:'skipped',lines:[...reasons.map((reason,i)=>`算法 ${i+1}：${reason??'预检通过；因其它算法不可用，该交易所本轮跳过'}`),`交集：${EXCHANGE_NAMES[exchange]}整家跳过，不入库`]};
      if(mode==='or'&&reasons.every(Boolean))return {outcome:'skipped',lines:[...reasons.map((reason,i)=>`算法 ${i+1}：${reason}`),`并集：每个算法在${EXCHANGE_NAMES[exchange]}都不可用，整家跳过`]};
      // 并集：在这家不可用的算法按没命中算，其余照常判定
      const rows=await Promise.all(plans.map((p,i)=>reasons[i]?Promise.resolve({outcome:'skipped' as const,lines:[reasons[i]!],member:undefined}):scanner.diagnose({...options,feature:p.def,algorithm:p.settings,anchorMs,algorithms:undefined})));
      const result=combineFishResults(rows.map(r=>r.member??{outcome:r.outcome}),plans,mode);
      if(mode==='or'){
        const hit=result.signal?.fish?.hitAlgorithms??[];
        return {outcome:result.outcome as FishDiagnosis['outcome'],lines:[...rows.flatMap((r,i)=>r.lines.map(line=>`算法 ${i+1}：${line}`)),result.signal?`并集命中（算法 ${hit.join('、')}）· 起点 ${formatUTC8(result.signal.timeMs)}（命中算法里最早的起点）`:`并集：没有一个算法命中（${rows.map((r,i)=>`算法 ${i+1} ${r.outcome}`).join('；')}），不入库`]};
      }
      return {outcome:result.outcome as FishDiagnosis['outcome'],lines:[...rows.flatMap((r,i)=>r.lines.map(line=>`算法 ${i+1}：${line}`)),result.signal?`交集命中 · 起点 ${formatUTC8(result.signal.timeMs)}`:`交集：${result.outcome==='unknown'?'起点不明，不入库':`不在交集（${rows.map((r,i)=>`算法 ${i+1} ${r.outcome}`).join('；')}）`}`]};
    }
    const t = (ms: number) => formatUTC8(ms).slice(5, 16);
    const exchange = options.exchange ?? 'binance';
    const plan = fishProgramForLookback(compileFishProgram(options.feature ?? CBI2_DEF, options.algorithm ?? { direction: '>', threshold: FISH_THRESHOLD, constraints: [] }),options.lookbackHours,options.turnoverFloors);
    if (plan.unavailable) return { outcome: 'failed', lines: [plan.unavailable] };
    const query = { interval: intervalOf(plan.def), count: plan.N }, adapter = this.adapters.get(exchange)!;
    const clock = await this.requests.get('binance')!('time', 1, options.signal) as { serverTime?: number };
    if (!Number.isFinite(clock.serverTime)) return { outcome: 'failed', lines: ['币安服务器时间无效'] };
    if (options.anchorMs !== undefined && options.anchorMs > clock.serverTime!) return { outcome: 'failed', lines: ['捕捞时间不能晚于币安服务器当前时间'] };
    const cut = Math.floor((options.anchorMs ?? clock.serverTime!) / plan.step) * plan.step;
    const head = `截止 ${t(cut)} · 需要 ${plan.N} 根（从 ${t(cut - plan.N * plan.step)} 起），第 ${plan.warm} 根起读数可用（${t(cut - (plan.N - plan.warm + 1) * plan.step)} 起）`;
    const retention = fishRetentionReason(exchange, cut, clock.serverTime!, plan.N, plan.step, plan.usesTaker, query.interval);
    if (retention) return { outcome: 'skipped', cutoffMs: cut, lines: [head, `${EXCHANGE_NAMES[exchange]}：${retention}`] };
    const wanted = options.symbol.trim().toUpperCase().replace(/[\s/_-]+/g, '');
    const markets = await adapter.list(options.signal);
    const market = markets.find(m => m.symbol.toUpperCase() === wanted) ?? markets.find(m => m.symbol.toUpperCase() === `${wanted}USDT`) ?? markets.find(m => (m.underlying ?? m.base).toUpperCase() === wanted);
    if (!market) return { outcome: 'not_found', cutoffMs: cut, lines: [head, `${EXCHANGE_NAMES[exchange]}现在没有在交易的「${options.symbol.trim()}」USDT 永续合约`] };
    const name = market.market === 'us_stock' ? `${market.symbol}（美股）` : market.symbol;
    let refs = new Map<number, number>();
    if (plan.compiled.usesBtc) {
      try { const btc = await adapter.candles(adapter.btc(), cut, options.signal, query); validateFishBars(btc, cut, plan.N, plan.step); refs = new Map(btc.map(b => [b.openTime, b.close])); }
      catch (error) { return { outcome: 'failed', cutoffMs: cut, lines: [head, `BTC 参考 K 线不完整或请求失败：${error instanceof Error ? error.message : error}`] }; }
    }
    let raw: ResearchBar[];
    try { raw = await adapter.candles(market, cut, options.signal, query); validateFishBars(raw, cut, plan.N, plan.step); }
    catch (error) {
      const kind = error instanceof FishError ? error.kind : 'failed';
      return { outcome: kind === 'history' ? 'history' : kind === 'gap' ? 'gap' : 'failed', cutoffMs: cut, lines: [head, `${name}：${error instanceof Error ? error.message : error}`] };
    }
    try {
      const wick = await checkFishDownwardWick(adapter,market,options.anchorMs ?? clock.serverTime!,options.downwardWick,options.signal,{bars:raw,step:plan.step});
      if (wick) return { outcome:'skipped',cutoffMs:cut,lines:[head,`${name}：${describeFishWick(wick,options.downwardWick!)}`] };
    } catch (error) {
      if (options.signal.aborted) throw error;
      const kind = error instanceof FishError ? error.kind : 'failed';
      return { outcome:kind==='history'?'history':kind==='gap'?'gap':kind==='readings'?'readings':'failed',cutoffMs:cut,lines:[head,`${name}：向下大插针检查失败：${error instanceof Error?error.message:String(error)}`] };
    }
    let bars = raw;
    if (plan.usesTaker) {
      try { bars = await adapter.taker(market, raw, options.signal, query); }
      catch (error) { return { outcome: 'readings', cutoffMs: cut, lines: [head, `${name}：主动成交读数不全：${error instanceof Error ? error.message : error}`] }; }
    }
    bars = bars.map(b => plan.compiled.usesBtc ? { ...b, refClose: refs.get(b.openTime)! } : b);
    if (options.turnoverFloors?.length) {
      const checks = fishTurnoverCheck(bars, cut, plan.step, options.turnoverFloors);
      if (checks === null) return { outcome: 'readings', cutoffMs: cut, lines: [head, `${name}：成交额读数不全或 K 线不够覆盖 24 小时，无法判断成交额门槛`] };
      if (checks.some(c => !c.ok)) return { outcome: 'skipped', cutoffMs: cut, lines: [head, `${name}：截止前${describeTurnoverMiss(checks)} USDT，没达到成交额门槛，不判定（成不了鱼）`] };
    }
    const r = evaluateFishProgram(bars, plan), result = limitFishLookback(classifyFishProgram(market.symbol, bars, r, cut, plan),options.anchorMs??clock.serverTime!,options.lookbackHours);
    const end = bars.length - 1, first = plan.warm - 1, scale = plan.scale;
    const avgName = fishStatisticName(plan.def, plan.settings.statistic);
    const fmt = (v: number) => Number.isFinite(v) ? (v * scale).toFixed(4) : '—';
    const rule = `${plan.settings.direction} ${plan.settings.threshold}`;
    const atCut = `${avgName} 截止时 = ${fmt(r.average[end])}（要求 ${rule}${plan.stateHold?`，且（${FISH_STATE_HOLD_TEXT}）`:''}）`;
    if(result.outcome==='outside')return {outcome:'outside',member:result,cutoffMs:cut,lines:[head,`${name}：信号起点 ${t(result.snapshot!.cutoffMs-(result.snapshot!.cutoffIndex!-result.snapshot!.startIndex!)*plan.step)} 不在过去 ${options.lookbackHours} 小时内，本轮不收录`]};
    if (result.outcome === 'hit') {
      const k = result.signal!.fish!.startIndex!, signalMs = result.signal!.timeMs;
      if (options.turnoverFloors?.length) {
        const checks = fishTurnoverCheck(bars, signalMs, plan.step, options.turnoverFloors);
        if (checks === null) return { outcome: 'readings', cutoffMs: cut, lines: [head, `${name}：K 线不够覆盖信号（${t(signalMs)}）前 24 小时，无法判断成交额门槛`] };
        if (checks.some(c => !c.ok)) return { outcome: 'skipped', cutoffMs: cut, lines: [head, `${name}：${atCut}，这一轮从 ${t(signalMs)} 开始；但信号前${describeTurnoverMiss(checks)} USDT（起点之后才放量），没达到成交额门槛，成不了鱼`] };
      }
      return { outcome: 'hit', member: result, cutoffMs: cut, lines: [head, `${name}：会命中。${atCut}；这一轮从 ${t(bars[k].openTime + plan.step)} 开始（起点 ${fmt(r.average[k])}，前一根 ${fmt(r.average[k - 1])}）`] };
    }
    if (result.outcome === 'below') {
      let last = -1;
      for (let i = end; i >= first; i--) if (r.main[i] === 1) { last = i; break; }
      let peak = -Infinity, peakAt = -1;
      for (let i = first; i <= end; i++) if (Number.isFinite(r.average[i]) && (plan.settings.direction === '>' ? r.average[i] > peak : -r.average[i] > peak)) { peak = plan.settings.direction === '>' ? r.average[i] : -r.average[i]; peakAt = i; }
      return { outcome: 'below', cutoffMs: cut, lines: [head, `${name}：未达标。${atCut}`, last >= 0 ? `最近一次满足是在 ${t(bars[last].openTime + plan.step)}（之后回落；命中只认截止那一刻仍满足的）` : `可用区间里一次都没满足；区间内${plan.settings.direction === '>' ? '最高' : '最低'} ${fmt(r.average[peakAt])}（${peakAt >= 0 ? t(bars[peakAt].openTime + plan.step) : '—'}）`] };
    }
    if (result.outcome === 'blocked') {
      const failed = plan.texts.filter((_, i) => result.blockedBy?.[i]);
      return { outcome: 'blocked', cutoffMs: cut, lines: [head, `${name}：主条件满足（${atCut}），但被附加约束挡下：${failed.join('；')}`] };
    }
    if (result.outcome === 'unknown') return { outcome: 'unknown', member: result, cutoffMs: cut, lines: [head, `${name}：起点不明。${atCut}，但从可用区间开头（${t(bars[first].openTime + plan.step)}）起就一直满足，找不到这一轮的开始，按规则不入库`] };
    return { outcome: 'readings', cutoffMs: cut, lines: [head, `${name}：截止处读数不是有限数（${atCut}）`] };
  }

  private async scanIntersection(options: ScanOptions): Promise<FishProgress> {
    if(this.running)throw new Error('扫描正在进行');
    this.running=true;
    const progress={...initialFishProgress(),lookbackHours:options.lookbackHours}, states:FishProgress[]=[], results=new Map<string,Map<number,FishMemberResult>>();
    const emitted=new Set<string>();
    try {
      if(options.algorithms!.length>FISH_MAX_ALGORITHMS)throw new Error(`最多 ${FISH_MAX_ALGORITHMS} 个算法`);
      const plans=options.algorithms!.map(a=>fishProgramForLookback(compileFishProgram(a.feature,a.algorithm),options.lookbackHours,options.turnoverFloors));
      const clock=await this.requests.get('binance')!('time',1,options.signal) as {serverTime:number};
      if(!Number.isFinite(clock.serverTime)||clock.serverTime<=0)throw new Error('服务器时间无效');
      const anchorMs=options.anchorMs??clock.serverTime;
      const startMode:FishCombination=options.combination??'and',currentMode=()=>options.combinationRef?.current??startMode;
      let mode:FishCombination=currentMode();
      const selected=options.retainMembers?selectFishRound({plans,results,anchorMs,complete:false,memberHits:[],lookbackHours:options.lookbackHours},options.displayAlgorithmKeys??plans.map(fishSelectionKey))!:null;
      const displayPlans=selected?.plans??plans;
      const displayIndices=displayPlans.map(p=>plans.indexOf(p));
      const skips:Partial<Record<FishExchange,string>>={};
      for(const exchange of options.exchanges??['binance']) {
        const reasons=plans.flatMap((p,i)=>{const reason=p.unavailable??fishRetentionReason(exchange,Math.floor(anchorMs/p.step)*p.step,clock.serverTime,p.N,p.step,p.usesTaker,intervalOf(p.def));return reason?[`算法 ${i+1}：${reason}`]:[];});
        if(reasons.length)skips[exchange]=reasons.join('；');
      }
      if(!options.retainMembers&&plans.some(p=>p.unavailable)){
        progress.status='complete';progress.anchorMs=anchorMs;progress.algorithmHits=plans.map(()=>0);
        progress.venues=Object.fromEntries(Object.entries(skips).map(([exchange,reason])=>[exchange,{...initialFishProgress(),status:'skipped',skippedReason:reason}]));
        return progress;
      }
      const adapters=sharedFishAdapters(this.adapters,plans,anchorMs,options.retainMembers?(exchange,p)=>!p.unavailable&&!fishRetentionReason(exchange,Math.floor(anchorMs/p.step)*p.step,clock.serverTime,p.N,p.step,p.usesTaker,intervalOf(p.def)):undefined,options.downwardWick?.enabled?fishWickCount(options.downwardWick):0);
      const publish=()=>{
        syncMode();
        const base=states[0];if(!base)return;
        Object.assign(progress,base,{anchorMs,rule:displayPlans.map(p=>fishRuleText(p.def,p.settings.direction,p.settings.threshold,p.texts.length,p.settings.statistic)).join(mode==='or'?' 或 ':' 且 '),algorithmHits:displayIndices.map(i=>states[i]?.counts.hit??0),counts:{...base.counts,hit:emitted.size},status:'running'});
        // 各算法的币数可能不同（某家在某个算法里整家跳过）：扫完的算法按「已完成」计，进度才能走到头
        const total=Math.max(0,...states.map(p=>p?.total??0));
        progress.done=Math.min(...plans.map((_,i)=>{const st=states[i];return !st?0:st.status==='running'?st.done:total;}));
        progress.notice=[...new Set(states.flatMap(p=>p?.notice?p.notice.split('；'):[]))].join('；')||undefined;
        progress.total=total;
        progress.wickSkipped=[...results.values()].filter(m=>[...m.values()].some(r=>r.outcome==='wick')).length;
        progress.wickDetails=[...results.values()].flatMap(m=>{
          const evidence=[...m.values()].find(r=>r.outcome==='wick'&&r.wick)?.wick;
          return evidence?[evidence]:[];
        });
        options.onProgress({...progress,counts:{...progress.counts}});
      };
      // 【用户要求】2026-10-20「交集这里还是有问题…合并到一起却捕捉不到」：一个币的各算法结论到齐就当场合并、当场出信号，
      // 不再等全部扫完——中途取消或某个算法扫失败，已经到齐的币照样保留（与单算法边扫边出一致）
      const decided=new Set<string>();
      // 捕捞中改了交集 / 并集：已判完的币按新组合重算「已出信号」的集合（命中数随之更新），之后的币直接按新组合出
      const syncMode=()=>{const m=currentMode();if(m===mode)return;mode=m;emitted.clear();for(const key of decided){const r=combineFishResults(displayIndices.map(i=>results.get(key)?.get(i)),displayPlans,mode);if(r.signal)emitted.add(key);}};
      options.onLiveRound?.({plans,results,anchorMs,complete:false,memberHits:[],lookbackHours:options.lookbackHours});
      const settle=(key:string,members:Map<number,FishMemberResult>)=>{
        syncMode();
        decided.add(key);
        const result=combineFishResults(displayIndices.map(i=>members.get(i)),displayPlans,mode);
        if(displayPlans.length&&result.signal&&!emitted.has(key)){emitted.add(key);options.onSignal(result.signal);}
        return result;
      };
      await Promise.all(plans.map(async(plan,i)=>{
        const a={feature:plan.def,algorithm:plan.settings};
        const scanner=new FishScanner(async()=>new Response(JSON.stringify(clock)),undefined,this.calculate,adapters);
        states[i]=await scanner.scan({...options,...a,algorithms:undefined,anchorMs,skipReasons:options.retainMembers||mode==='or'?undefined:skips,onRound:undefined,onSignal:()=>{},onProgress:p=>{states[i]=p;publish();},onResult:(key,r)=>{
          const members=results.get(key)??new Map<number,FishMemberResult>();members.set(i,r);results.set(key,members);
          if(members.size===plans.length&&!decided.has(key)&&!options.signal.aborted){settle(key,members);publish();}
        }});
      }));
      syncMode();
      const intersectionCounts={...initialFishProgress().counts};
      for(const [key,members] of results){
        // 交集要每个算法都有结论（缺了就是那个算法这个币没取到数，不进交集）；
        // 并集里有算法没结论的币，只在正常扫完时按「缺的算没命中」合并——取消时它可能还没扫到，不下结论
        if(!decided.has(key)){
          if(mode==='and'&&members.size!==plans.length)continue;
          if(mode==='or'&&options.signal.aborted)continue;
          settle(key,members);
        }
        const result=combineFishResults(displayIndices.map(i=>members.get(i)),displayPlans,mode);
        if(result.outcome in intersectionCounts)intersectionCounts[result.outcome as FishOutcome]++;
      }
      publish();
      progress.counts={...progress.counts,hit:emitted.size,unknown:intersectionCounts.unknown,outside:intersectionCounts.outside};
      // 捕捞过程（多重算法）：组合摘要；逐币结论交给页面，切换交集 / 并集时直接重算
      const round:FishCombinationRound={plans,results,anchorMs,complete:!options.signal.aborted&&!states.some(p=>p.status!=='complete'),memberHits:plans.map((_,i)=>states[i]?.counts.hit??0),lookbackHours:options.lookbackHours};
      if(!options.signal.aborted)saveFishCombinationRound(options.retainMembers?selectFishRound(round,options.displayAlgorithmKeys??plans.map(fishSelectionKey))!:round,mode);
      options.onRound?.(round);
      progress.status=options.signal.aborted?'cancelled':states.some(p=>p.status==='aborted')?'aborted':'complete';
      progress.error=states.map(p=>p.error).filter(Boolean).join('；')||undefined;
    }catch(error){progress.status=options.signal.aborted?'cancelled':'aborted';progress.error=error instanceof Error?error.message:String(error);}
    finally{this.running=false;options.onProgress({...progress,counts:{...progress.counts}});}
    return progress;
  }

  async scan(options: ScanOptions): Promise<FishProgress> {
    if(options.algorithms?.length){
      if(options.algorithms.length===1)return this.scan({...options,...options.algorithms[0],algorithms:undefined,onSignal:options.retainMembers&&options.displayAlgorithmKeys?.length===0?()=>{}:options.onSignal});
      return this.scanIntersection(options);
    }
    if (this.running) throw new Error('扫描正在进行');
    const { anchorMs, includeDuplicates = false, includeUsStocks = false } = options;
    let plan:FishProgram;
    try {plan=fishProgramForLookback(compileFishProgram(options.feature??CBI2_DEF,options.algorithm??{direction:'>',threshold:options.threshold??FISH_THRESHOLD,constraints:[]}),options.lookbackHours,options.turnoverFloors);if(plan.unavailable)throw new Error(plan.unavailable);}
    catch(error){const p={...initialFishProgress(),status:'aborted' as const,error:error instanceof Error?error.message:String(error)};options.onProgress(p);return p;}
    const threshold=plan.settings.threshold, query={interval: intervalOf(plan.def),count:plan.N};
    const cacheKey = JSON.stringify([anchorMs, definitionKey(plan.def), plan.algorithmKey, options.exchanges, options.includeDuplicates, options.includeUsStocks, options.downwardWick, options.turnoverFloors, options.lookbackHours]);
    const completed = options.checkpoint?.get(cacheKey) ?? new Map<string, FishMemberResult>();
    options.checkpoint?.set(cacheKey, completed);
    const reportResult = (key: string, member: FishMemberResult) => {
      if (options.checkpoint && ['hit', 'below', 'unknown', 'blocked', 'wick', 'thin', 'history', 'outside'].includes(member.outcome)) completed.set(key, member);
      options.onResult?.(key, member);
    };
    const requested = [...(options.exchanges ?? ['binance'])];
    this.running = true;
    const controller = new AbortController(), cancel = () => controller.abort();
    options.signal.addEventListener('abort',cancel,{once:true}); if(options.signal.aborted) cancel();
    // 捕捞过程：逐币记下截止读数与结论，扫完存成本轮摘要（只存本机）
    const memberResults=new Map<string,Map<number,FishMemberResult>>();
    const roundRows:FishRoundRow[]=[];let roundCut:number|undefined,roundAnchor=0;
    const progress = initialFishProgress(); progress.threshold = threshold; progress.bars=plan.N;progress.constraintTexts=plan.texts; progress.rule=fishRuleText(plan.def,plan.settings.direction,threshold,plan.texts.length,plan.settings.statistic);
    const venues: Partial<Record<FishExchange,FishProgress>> = {};
    const publish = () => {
      for(const venue of Object.values(venues)) {
        const parts=Object.values(venue.markets??{});
        if(parts.length){
          venue.total=parts.reduce((n,x)=>n+x.total,0);venue.done=parts.reduce((n,x)=>n+x.done,0);venue.history=parts.reduce((n,x)=>n+(x.history??0),0);venue.wickSkipped=parts.reduce((n,x)=>n+(x.wickSkipped??0),0);venue.thin=parts.reduce((n,x)=>n+(x.thin??0),0);venue.blocked=parts.reduce((n,x)=>n+(x.blocked??0),0);
          venue.constraintBlocked=plan.texts.map((_,i)=>parts.reduce((n,x)=>n+(x.constraintBlocked?.[i]??0),0));venue.failures={failed:parts.flatMap(x=>x.failures?.failed??[]).slice(0,10),readings:parts.flatMap(x=>x.failures?.readings??[]).slice(0,10)};
          for(const key of Object.keys(venue.counts) as FishOutcome[])venue.counts[key]=parts.reduce((n,x)=>n+x.counts[key],0);
          if(venue.status!=='running')for(const part of parts){part.status=venue.status;part.skippedReason=venue.skippedReason;part.error??=venue.error;part.current='';}
        }
      }
      const all = Object.values(venues);
      progress.wickDetails=[...memberResults.values()].flatMap(m=>m.get(0)?.wick?[m.get(0)!.wick!]:[]);
      if(all.length) {
        progress.history=all.reduce((n,p)=>n+(p.history??0),0);
        progress.wickSkipped=all.reduce((n,p)=>n+(p.wickSkipped??0),0);
        progress.thin=all.reduce((n,p)=>n+(p.thin??0),0);
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
      this.latestServerTime=Math.max(this.latestServerTime,clock.serverTime!);
      if(anchorMs!==undefined&&anchorMs>clock.serverTime!) throw new Error('捕捞时间不能晚于币安服务器当前时间');
      const node=anchorMs??clock.serverTime!,cut=Math.floor(node/plan.step)*plan.step;
      progress.lookbackHours=options.lookbackHours;progress.anchorMs=node;progress.cutoffMs=cut;roundCut=cut;roundAnchor=node;
      for(const exchange of selected){const reason=options.skipReasons?.[exchange]??fishRetentionReason(exchange,cut,clock.serverTime!,plan.N,plan.step,plan.usesTaker,query.interval);if(reason){venues[exchange]!.status='skipped';venues[exchange]!.skippedReason=reason;}}
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
      // 产出信号前先把每家要用的 BTC 参考取齐。【用户要求】2026-10-19「这是啥原因？请解决」：
      // 某一家取不到（如 Gate 直连被拦、代理未部署）只跳过那一家并写明原因，其余交易所照常扫——不再整次中止。
      // 那一家不会拿不完整的参考去算，也就不会产出它的信号。
      const references=new Map<FishExchange,ResearchBar[]>();
      if(plan.compiled.usesBtc){
        await Promise.all(selected.filter(e=>venues[e]!.status!=='skipped').map(async exchange=>{
          const adapter=this.adapters.get(exchange)!;
          try {const btc=await adapter.candles(adapter.btc(),cut,controller.signal,query);validateFishBars(btc,cut,plan.N,plan.step);if(btc.some(b=>!(b.close>0)))throw new Error('BTC收盘价无效');references.set(exchange,btc);}
          catch(error){
            if(controller.signal.aborted)throw error;
            if(error instanceof FishError&&error.kind==='banned')throw error;
            venues[exchange]!.status='skipped';venues[exchange]!.skippedReason=`BTC参考K线不完整或请求失败，本家跳过：${error instanceof Error?error.message:error}`;
            progress.notice=[progress.notice,`${EXCHANGE_NAMES[exchange]}本轮跳过（BTC 参考价取不到）：${error instanceof Error?error.message:error}`].filter(Boolean).join('；');
          }
        }));
        publish();
        if(selected.every(e=>venues[e]!.status==='skipped'))throw new Error(selected.map(e=>`${EXCHANGE_NAMES[e]}：${venues[e]!.skippedReason}`).join('；'));
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
                const cachedKey = `${exchange}|${market.market??'crypto'}|${market.symbol}`, cached = completed.get(cachedKey);
                if (cached) {
                  if (cached.outcome === 'history') p.history = (p.history ?? 0) + 1;
                  else if (cached.outcome === 'wick') p.wickSkipped = (p.wickSkipped ?? 0) + 1;
                  else if (cached.outcome === 'thin') p.thin = (p.thin ?? 0) + 1;
                  else if (cached.outcome === 'blocked') { p.blocked = (p.blocked ?? 0) + 1; cached.blockedBy?.forEach((v, i) => p.constraintBlocked![i] += v); }
                  else p.counts[cached.outcome]++;
                  roundRows.push({ symbol: market.symbol, exchange, market: market.market, reading: cached.reading ?? NaN, outcome: cached.outcome });
                  memberResults.set(cachedKey, new Map([[0, cached]])); reportResult(cachedKey, cached);
                  if (cached.signal) options.onSignal(placeFishSignal(cached.signal, { symbol: market.symbol, exchange, ...(market.market === 'us_stock' ? { market: 'us_stock', underlying: market.underlying ?? market.base } : {}), ...(exchange !== 'binance' && market.market !== 'us_stock' ? { binanceSymbol: binanceByBase.get(fishBase(market.base)) ?? null } : {}) }, plan.algorithmKey));
                  p.done++; publish(); await fishDelay(0, local.signal); continue;
                }
                const raw=btc&&market.instrument===adapter.btc().instrument?btc:await adapter.candles(market,cut,local.signal,query);
                validateFishBars(raw,cut,plan.N,plan.step);
                stage='向下大插针检查';
                const wick=await checkFishDownwardWick(adapter,market,node,options.downwardWick,local.signal,{bars:raw,step:plan.step});
                if(wick){
                  if(local.signal.aborted)return;
                  p.wickSkipped=(p.wickSkipped??0)+1;
                  roundRows.push({symbol:market.symbol,exchange,market:market.market,reading:NaN,outcome:'wick'});
                  const evidence:FishWickRejection={...wick,symbol:market.symbol,exchange,market:market.market,underlying:market.underlying,
                    binanceSymbol:exchange==='binance'?market.symbol:binanceByBase.get(fishBase(market.base))??null,
                    cutoffMs:Math.floor(node/FISH_STEP)*FISH_STEP,rule:{...options.downwardWick!}};
                  const memberKey=`${exchange}|${market.market??'crypto'}|${market.symbol}`,member:FishMemberResult={outcome:'wick',wick:evidence};
                  memberResults.set(memberKey,new Map([[0,member]]));reportResult(memberKey,member);
                  p.done++;publish();await fishDelay(0,local.signal);continue;
                }
                stage='主动成交（trades / history-trades / fills-history）';
                const source=plan.usesTaker?await adapter.taker(market,raw,local.signal,query):raw;
                const bars=source.map(b=>plan.compiled.usesBtc?({...b,refClose:btcClose.get(b.openTime)!}):b);
                if(bars.length!==plan.N||bars.some(b=>(plan.compiled.usesAmounts&&(b.quoteVolume==null||(plan.usesTaker&&b.takerBuyQuoteVolume==null)))||(plan.compiled.usesBtc&&!(b.refClose!>0))))throw new FishError('成交额或BTC读数不全','readings');
                // 成交额门槛：截止前 1h / 12h / 24h USDT 成交额任一条不够的币跳过、不判定（成不了鱼）
                if(options.turnoverFloors?.length){
                  const checks=fishTurnoverCheck(bars,cut,plan.step,options.turnoverFloors);
                  if(checks===null)throw new FishError('成交额读数不全或 K 线不够覆盖 24 小时，无法判断成交额门槛','readings');
                  if(checks.some(c=>!c.ok)){
                    if(local.signal.aborted)return;
                    p.thin=(p.thin??0)+1;roundRows.push({symbol:market.symbol,exchange,market:market.market,reading:NaN,outcome:'thin'});
                    const memberKey=`${exchange}|${market.market??'crypto'}|${market.symbol}`,member:FishMemberResult={outcome:'thin'};memberResults.set(memberKey,new Map([[0,member]]));reportResult(memberKey,member);
                    p.done++;publish();await fishDelay(0,local.signal);continue;
                  }
                }
                stage=`${plan.def.short}计算`;
                let readings=evaluateFishProgram(bars,plan);
                // Optional numerical fixture injection used by transport tests; production always evaluates the composed program.
                if(this.calculate){const r=this.calculate(bars);const main=Float64Array.from(r.average,a=>!Number.isFinite(a)?NaN:(plan.settings.direction==='>'?a>threshold/plan.scale:a<threshold/plan.scale)?1:0);readings={...readings,value:r.cbi2,average:r.average,main,condition:main};}
                const result=limitFishLookback(classifyFishProgram(market.symbol,bars,readings,cut,plan),node,options.lookbackHours);
                if(local.signal.aborted)return;
                // 命中的币再查「信号前」成交额（截止前达标、起点前没达标 = 起点之后才放量，成不了鱼）；读数仍留着，调严阈值时起点后移可能达标
                if(result.outcome==='hit'){
                  const ok=fishSignalTurnoverOk(bars,result.signal!.timeMs,plan.step,options.turnoverFloors);
                  if(ok===null)throw new FishError('K 线不够覆盖信号前 24 小时，无法判断成交额门槛','readings');
                  if(!ok){
                    const reading=readings.average[bars.length-1];
                    p.thin=(p.thin??0)+1;roundRows.push({symbol:market.symbol,exchange,market:market.market,reading,outcome:'thin'});
                    const place:FishPlace={symbol:market.symbol,exchange,...(market.market==='us_stock'?{market:'us_stock',underlying:market.underlying??market.base}:{}),...(exchange!=='binance'&&market.market!=='us_stock'?{binanceSymbol:binanceByBase.get(fishBase(market.base))??null}:{})};
                    const member:FishMemberResult={outcome:'thin',reading},tail=fishTail(bars,readings,plan,cut,place,options.turnoverFloors);if(tail)member.tail=tail;
                    const memberKey=`${exchange}|${market.market??'crypto'}|${market.symbol}`;memberResults.set(memberKey,new Map([[0,member]]));reportResult(memberKey,member);
                    p.done++;publish();await fishDelay(0,local.signal);continue;
                  }
                }
                roundRows.push({symbol:market.symbol,exchange,market:market.market,reading:readings.average[bars.length-1],outcome:result.outcome});
                if(result.outcome==='blocked'){p.blocked=(p.blocked??0)+1;result.blockedBy?.forEach((v,i)=>p.constraintBlocked![i]+=v);}else p.counts[result.outcome]++;
                if(result.outcome==='readings'&&p.failures!.readings.length<10)p.failures!.readings.push({symbol:market.symbol,reason:`${plan.def.short}计算：截止处结果、均值或约束不是有限数`});

                const place:FishPlace={symbol:market.symbol,exchange,...(market.market==='us_stock'?{market:'us_stock',underlying:market.underlying??market.base}:{}),...(exchange!=='binance'&&market.market!=='us_stock'?{binanceSymbol:binanceByBase.get(fishBase(market.base))??null}:{})};
                if(result.signal)options.onSignal(placeFishSignal(result.signal,place,plan.algorithmKey));
                // 留下截止读数；命中 / 起点不明的币再留可用区间的读数，扫完把阈值往严里调时当场重判（refilter.ts）
                const member:FishMemberResult={...result,reading:readings.average[bars.length-1]};
                if(result.outcome==='hit'||result.outcome==='unknown'||result.outcome==='outside'){const tail=fishTail(bars,readings,plan,cut,place,options.turnoverFloors);if(tail)member.tail=tail;}
                const memberKey=`${exchange}|${market.market??'crypto'}|${market.symbol}`;
                memberResults.set(memberKey,new Map([[0,member]]));
                reportResult(memberKey,member);
              }catch(error){
                if(error instanceof FishError && (error.kind==='banned'||error.detail?.status===429)){fatal=error.message;local.abort();}
                else if(!local.signal.aborted){
                  const kind=error instanceof FishError?error.kind:'failed';
                  roundRows.push({symbol:market.symbol,exchange,market:market.market,reading:NaN,outcome:kind});
                  const memberKey=`${exchange}|${market.market??'crypto'}|${market.symbol}`,result={outcome:kind};memberResults.set(memberKey,new Map([[0,result]]));reportResult(memberKey,result);
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
      if(roundCut!==undefined)options.onRound?.({plans:[plan],results:memberResults,anchorMs:roundAnchor,complete:progress.status==='complete',memberHits:[progress.counts.hit],lookbackHours:options.lookbackHours});
      if(roundCut!==undefined&&roundRows.length&&progress.status!=='aborted')saveFishRound(summarizeFishRound(roundRows,{algorithmKey:plan.algorithmKey,cutoffMs:roundCut,anchorMs:roundAnchor,direction:plan.settings.direction,threshold:plan.settings.threshold,scale:plan.scale,unit:plan.unit,partial:progress.status!=='complete'}));
      publish();
    }
    return {...progress,counts:{...progress.counts},venues};
  }
}
