/**
 * 阈值建议：信号库里每条信号在它自己的时刻读一次所选序列，取分位数；另配同币种随机时点作对照。
 * 每条样本只用它截止前已收盘的 K 线。
 * 【用户要求】2026-10-19「阈值这里给出一个默认的建议区间（并且可以手动输入），这个默认区间应该源于大的信号库中的所有信号的统计所得」：
 * 打开「渔」就在后台算（不用点）；样本是信号库全部信号，各按自己的交易所 / 市场取数（不再只取币安加密币）。
 */
import type { TradeSignal } from '@/lib/signalLibrary';
import { signalDedupKey } from '@/lib/signalLibrary';
import type { ResearchBar } from '@/lib/deepRsa/window';
import { definitionKey } from '@/lib/deepDig/features';
import { evaluateFishProgram, shortFishHash, type FishProgram } from './algorithm';
import { FishError, fishDelay, validateFishBars } from './shared';
import { mulberry32 } from '@/lib/deepRsa/grouping';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';

export const SUGGESTION_SEED = 20261019;
export interface FishSuggestionStats {
  n: number; attempted: number; p25: number|null; p50: number|null; p75: number|null;
  constraintsPassed: number; constraintRatio: number|null; skipped: Record<string,number>;
  failures: {symbol:string;timeMs:number;reason:string}[];
}
export interface FishSuggestion {
  key: string; algorithmKey: string; definitionKey: string; fingerprint: string; featureId: string;
  statistic: string; scale: number; unit: string; createdAt: number; seed: number;
  samples: FishSuggestionStats; random: FishSuggestionStats; cacheHit?: boolean; cacheable?: boolean;
}
export interface FishSuggestionProgress {
  status: 'running'|'complete'|'cancelled'|'aborted'; phase: 'signals'|'random'; done: number; total: number; current: string;
}
/** 一个取样点：标的、时刻，以及它在哪家交易所、是不是美股（取数要按它自己的来源）。 */
export interface FishSampleRow { symbol:string; timeMs:number; exchange?:TradeSignal['exchange']; market?:TradeSignal['market']; underlying?:string }
export type FishSuggestionLoader = (row:FishSampleRow,cut:number,plan:FishProgram,signal:AbortSignal)=>Promise<readonly ResearchBar[]>;
export interface FishSuggestionOptions {
  plan: FishProgram; signals: readonly TradeSignal[]; signal: AbortSignal;
  onProgress: (p:FishSuggestionProgress)=>void;
  /** 手动刷新重新取样；后台计算仍复用完整结果。 */
  force?: boolean;
}
export const fishSignalFingerprint = (signals:readonly TradeSignal[]) => shortFishHash(JSON.stringify(signals.map(signalDedupKey).sort()));
/** 分布只取决于定义、所选序列、启用约束（决定所需根数与通过率）和样本；与方向、阈值无关，改阈值不用重算。 */
export const fishSuggestionKey = (plan:FishProgram,signals:readonly TradeSignal[]) => `${plan.def.id}|${plan.settings.statistic??'结果'}|${plan.constraintKey}|${definitionKey(plan.def)}|${fishSignalFingerprint(signals)}`;
// v2：去掉外层 avg、样本扩到全部交易所之后的口径，旧结果不再沿用
const storageKey=()=>`${getUserPrefix()}fish-threshold-suggestions.v2`;
function cachedSuggestions():FishSuggestion[] {
  try {const x=JSON.parse(readPersistedStateRaw(storageKey())??'[]');return Array.isArray(x)?x.filter(s=>s&&typeof s.key==='string'&&s.samples&&s.random):[];} catch {return [];}
}
export const readFishSuggestion = (key:string) => cachedSuggestions().find(s=>s.key===key)??null;
export const latestFishSuggestion = (id:string) => cachedSuggestions().find(s=>s.featureId===id)??null;
export function saveFishSuggestion(result:FishSuggestion):void {
  if(result.cacheable===false||result.samples.n===0)return;
  const {cacheHit:_,...record}=result;
  writePersistedStateRaw(storageKey(),JSON.stringify([record,...cachedSuggestions().filter(s=>s.key!==result.key)].slice(0,12)));
}
/** Linear interpolation, the usual inclusive sample quantile. */
export function fishQuantile(values:readonly number[],q:number):number|null {
  const a=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!a.length)return null;
  const at=(a.length-1)*q,lo=Math.floor(at),hi=Math.ceil(at);return lo===hi?a[lo]:a[lo]*(1-(at-lo))+a[hi]*(at-lo);
}
/** 自动填的阈值：> 取 P25，< 取 P75；保留 6 位有效数字，与界面上写的建议区间一致。 */
export function suggestedFishThreshold(result:FishSuggestion,direction:'>'|'<'):number|null {
  const v=direction==='>'?result.samples.p25:result.samples.p75;
  return v===null?null:Number(v.toPrecision(6));
}
export function mayFillFishThreshold(current:string,lastSuggestion?:string):boolean {
  return !current.trim()||(lastSuggestion!==undefined&&current===lastSuggestion);
}
const blank=():FishSuggestionStats=>({n:0,attempted:0,p25:null,p50:null,p75:null,constraintsPassed:0,constraintRatio:null,skipped:{},failures:[]});
const check=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('已取消','AbortError');};
const skipped=(stats:FishSuggestionStats,reason:string)=>stats.skipped[reason]=(stats.skipped[reason]??0)+1;
const finish=(stats:FishSuggestionStats,values:number[])=>{stats.n=values.length;stats.p25=fishQuantile(values,.25);stats.p50=fishQuantile(values,.5);stats.p75=fishQuantile(values,.75);stats.constraintRatio=stats.n?stats.constraintsPassed/stats.n:null;};

export async function collectFishSuggestion(options:FishSuggestionOptions,load:FishSuggestionLoader):Promise<FishSuggestion> {
  const {plan,signals,onProgress}=options,controller=new AbortController(),signal=controller.signal;
  const cancel=()=>controller.abort();options.signal.addEventListener('abort',cancel,{once:true});if(options.signal.aborted)cancel();
  if(plan.unavailable){options.signal.removeEventListener('abort',cancel);throw new Error(plan.unavailable);}
  const key=fishSuggestionKey(plan,signals),cached=readFishSuggestion(key);
  if(signal.aborted){options.signal.removeEventListener('abort',cancel);check(signal);}
  if(cached&&!options.force){onProgress({status:'complete',phase:'random',done:cached.samples.attempted+cached.random.attempted,total:cached.samples.attempted+cached.random.attempted,current:''});options.signal.removeEventListener('abort',cancel);return {...cached,cacheHit:true};}
  const result:FishSuggestion={key,algorithmKey:plan.algorithmKey,definitionKey:definitionKey(plan.def),fingerprint:fishSignalFingerprint(signals),featureId:plan.def.id,statistic:plan.settings.statistic??'结果',scale:plan.scale,unit:plan.unit,createdAt:Date.now(),seed:SUGGESTION_SEED,samples:blank(),random:blank()};
  const eligible:TradeSignal[]=[];
  for(const s of signals){if(!Number.isFinite(s.timeMs)||s.timeMs<=0||!/^[A-Z0-9]{1,40}USDT$/.test(s.symbol))skipped(result.samples,'标的或时间无效');else eligible.push(s);}
  eligible.sort((a,b)=>signalDedupKey(a).localeCompare(signalDedupKey(b)));
  const progress:FishSuggestionProgress={status:'running',phase:'signals',done:0,total:eligible.length,current:''};
  const publish=()=>onProgress({...progress});publish();
  let fatal:unknown;
  const values:number[]=[],control:number[]=[],valid:TradeSignal[]=[];
  const readings=new Map<string,Promise<{average:number;passed:boolean}>>();
  const read=(row:FishSampleRow,cut:number)=>{
    const k=`${row.exchange??'binance'}|${row.market??'crypto'}|${row.symbol}|${cut}`;let promise=readings.get(k);
    if(!promise){promise=(async()=>{
      check(signal);const bars=await load(row,cut,plan,signal);check(signal);validateFishBars(bars,cut,plan.N,plan.step);
      const r=evaluateFishProgram(bars,plan),at=bars.length-1,a=r.average[at];
      if(at<plan.warm-1||!Number.isFinite(a)||r.constraints.some(c=>!Number.isFinite(c[at])))throw new FishError('截止处均值或附加约束不是有限数','readings');
      if(!Number.isFinite(a*plan.scale))throw new FishError('换算后的均值不是有限数','readings');
      return {average:a*plan.scale,passed:r.constraints.every(c=>c[at]!==0)};
    })();readings.set(k,promise);}
    return promise;
  };
  const run=async(rows:FishSampleRow[],stats:FishSuggestionStats,output:number[],accept?:(index:number)=>void)=>{
    stats.attempted=rows.length;let next=0;
    const worker=async()=>{for(;;){check(signal);const index=next++;if(index>=rows.length)return;const row=rows[index],cut=Math.floor(row.timeMs/plan.step)*plan.step;progress.current=row.symbol;publish();
      try {const v=await read(row,cut);check(signal);output.push(v.average);if(v.passed)stats.constraintsPassed++;accept?.(index);}
      catch(error){check(signal);if(error instanceof FishError&&error.kind==='banned'){fatal=error;controller.abort();throw error;}if(!(error instanceof FishError)||error.kind==='failed'||error.message.includes('尚未全部收盘'))result.cacheable=false;const reason=error instanceof FishError?(error.kind==='gap'?'缺口':error.kind==='history'?'历史不足':error.kind==='readings'?'读数不全':error.kind==='skipped'?'超出保留期 / 已下架':'请求失败'):'请求失败';skipped(stats,reason);if(stats.failures.length<10)stats.failures.push({symbol:row.symbol,timeMs:row.timeMs,reason:error instanceof Error?error.message:String(error)});}
      progress.done++;publish();await fishDelay(0,signal);
    }};
    const pending=await Promise.allSettled(Array.from({length:Math.min(3,rows.length)},worker));const failed=pending.find((x):x is PromiseRejectedResult=>x.status==='rejected');if(failed)throw fatal??failed.reason;
  };
  try {
    await run(eligible,result.samples,values,i=>valid.push(eligible[i]));finish(result.samples,values);
    // One draw per usable signal, from the same coin and its own +/-7 day interval.
    valid.sort((a,b)=>signalDedupKey(a).localeCompare(signalDedupKey(b)));const rand=mulberry32(SUGGESTION_SEED),week=7*86400000;
    const random=valid.map(s=>({symbol:s.symbol,exchange:s.exchange,market:s.market,underlying:s.underlying,timeMs:s.timeMs-week+Math.floor(rand()*(2*week+1))}));
    progress.phase='random';progress.total=eligible.length+random.length;publish();
    await run(random,result.random,control);finish(result.random,control);check(signal);
    progress.status='complete';progress.current='';publish();saveFishSuggestion(result);return result;
  }catch(error){progress.status=options.signal.aborted?'cancelled':'aborted';progress.current='';publish();throw error;}
  finally{options.signal.removeEventListener('abort',cancel);}
}
export function fishSuggestionTitle(r:FishSuggestion):string {
  const line=(name:string,s:FishSuggestionStats)=>`${name}：n=${s.n}；取数样本=${s.attempted}；P25=${s.p25??'—'} / P50=${s.p50??'—'} / P75=${s.p75??'—'} ${r.unit||'无量纲'}；全部约束通过=${s.constraintRatio===null?'—':(s.constraintRatio*100).toFixed(1)+'%'}；跳过=${Object.entries(s.skipped).map(([k,v])=>`${k} ${v}`).join('、')||'0'}`;
  return `${line('信号样本',r.samples)}\n${line('随机对照',r.random)}\n随机种子=${r.seed}；同币种、信号前后±7天，每个有效信号抽1个点；随机点缺数据也跳过，不补造。\n统计量=${r.statistic}；显示单位=${r.unit||'无量纲'}`;
}
