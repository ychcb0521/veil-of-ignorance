import { definitionKey, intervalOf, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { type FishAlgorithmSettings, type FishProgram, type FishSnapshot } from './algorithm';
import type { TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import type { FishDataAdapter } from './adapters';
import type { FishExchange } from './exchanges';
import type { ResearchBar } from '@/lib/deepRsa/window';
export interface FishAlgorithmInput { feature: DeepDigFeatureDef; algorithm: FishAlgorithmSettings }
import type { FishTail } from './refilter';
import type { FishWickRejection } from './downwardWick';
/** reading = 截止那根的读数；tail = 命中 / 起点不明的币可用区间的读数（阈值往严里调时据此重判，见 refilter.ts）。 */
export interface FishMemberResult { outcome: string; signal?: TradeSignal; snapshot?: FishSnapshot; boundaryMs?: number; reading?: number; blockedBy?: number[]; tail?: FishTail; wick?: FishWickRejection }
/** 多重算法怎么合：and = 交集（全部同时满足），or = 并集（满足任一即留下）。 */
export type FishCombination = 'and' | 'or';
/** 组合键：交集沿用原来的「键 & 键」；并集写成「any(键 & 键)」，两种口径的记录各自去重、互不覆盖。与卡片顺序无关。 */
export const fishCombinationKey=(plans: readonly Pick<FishProgram,'algorithmKey'>[],mode:FishCombination='and')=>{const keys=plans.map(p=>p.algorithmKey).sort().join('&');return mode==='or'?`any(${keys})`:keys;};
const identityOf=(s:TradeSignal)=>s.market==='us_stock'?`us-${s.exchange??'binance'}-${s.underlying??s.symbol}`:`${s.exchange&&s.exchange!=='binance'?s.exchange+'-':''}${s.symbol}`;
/**
 * 并集：各算法独立判定，只要有一个算法命中（与单独扫描它时一样：截止满足、起点已知）就留下。
 * 【用户要求】2026-10-19「多重选择除了交集，再增加一种并集（即，只要符合其中一个算法的，都留下）」。
 * 信号时间 = 命中的算法里最早的那个起点（它从那一刻起连续满足到截止）；起点不明的算法不算命中（与单算法规则一致），只记进快照。
 * rows 里缺的位置（该算法这个币没有结果）按没命中算。
 */
export function unionFishResults(rows: readonly (FishMemberResult|undefined)[], plans: readonly FishProgram[]): FishMemberResult {
  const present=rows.filter((r):r is FishMemberResult=>!!r);
  if(plans.length===1)return present[0]??{outcome:'unknown'};
  const hitIndex=rows.flatMap((r,i)=>r?.outcome==='hit'&&r.signal?[i]:[]);
  if(!hitIndex.length){
    // 都没命中：报一个最说明问题的结论（有起点不明的算报起点不明，否则取第一个算法的结论）
    return {outcome:present.some(r=>r.outcome==='unknown')?'unknown':present[0]?.outcome??'unknown'};
  }
  const hits=hitIndex.map(i=>rows[i]!.signal!),start=Math.min(...hits.map(s=>s.timeMs));
  const source=hits.find(s=>s.timeMs===start)!,key=fishCombinationKey(plans,'or');
  return {outcome:'hit',signal:{...source,id:`fish-${identityOf(source)}-${start}-${encodeURIComponent(key)}`,timeMs:start,timeLabel:formatUTC8(start),
    fish:{...source.fish!,algorithmKey:key,combination:'or',unionStart:start,hitAlgorithms:hitIndex.map(i=>i+1),algorithms:rows.map((r,i)=>r?.signal?.fish??r?.snapshot??({featureId:plans[i].def.id,featureName:plans[i].def.name,featureShort:plans[i].def.short,algorithmKey:plans[i].algorithmKey,statistic:plans[i].settings.statistic??'结果',definitionKey:definitionKey(plans[i].def),direction:plans[i].settings.direction,threshold:plans[i].settings.threshold,interval:intervalOf(plans[i].def),scale:plans[i].scale,unit:plans[i].unit,constraintKey:plans[i].constraintKey,constraints:plans[i].texts,outcome:r?.outcome??'missing'} as FishSnapshot))}}};
}
export const combineFishResults=(rows: readonly (FishMemberResult|undefined)[],plans: readonly FishProgram[],mode:FishCombination)=>mode==='or'?unionFishResults(rows,plans):intersectFishResults(rows.map(r=>r??{outcome:'missing'}),plans);
/**
 * 交集 = 每个算法单独扫都捕到的币（全部是 hit），起点取各算法起点里最晚的那个。
 * 【用户要求】2026-10-22「交集算法之下能被捕捉到的标的，应该意味着在每个算法之下都能被捕捉到」：
 * 以前某个算法「起点不明」（从可用历史开头就一直满足）时，只要另一算法的起点更晚也算进交集——单扫那个算法却不出这条鱼。
 * 现在起点不明的算法不算命中（与单算法规则一致），交集严格是各算法命中的交集。
 */
export function intersectFishResults(rows: readonly FishMemberResult[], plans: readonly FishProgram[]): FishMemberResult {
  if(rows.length===1)return rows[0];
  const miss=rows.find(r=>r.outcome!=='hit'||!r.signal);
  if(!rows.length||miss)return {outcome:rows.find(r=>r.outcome!=='hit'&&r.outcome!=='unknown')?.outcome??'unknown'};
  const hits=rows.map(r=>r.signal!),start=Math.max(...hits.map(s=>s.timeMs));
  const source=hits.find(s=>s.timeMs===start)!,key=fishCombinationKey(plans);
  return {outcome:'hit',signal:{...source,id:`fish-${identityOf(source)}-${start}-${encodeURIComponent(key)}`,timeMs:start,timeLabel:formatUTC8(start),fish:{...source.fish!,algorithmKey:key,intersectionStart:start,algorithms:rows.map(r=>r.signal!.fish!)}}};
}
/** Request once per venue/instrument/period, then give each program exactly its own trailing N. */
export function sharedFishAdapters(adapters: Map<FishExchange,FishDataAdapter>, plans: readonly FishProgram[], anchorMs:number, eligible?: (exchange:FishExchange,p:FishProgram)=>boolean, fiveMinuteMinimum = 0): Partial<Record<FishExchange,FishDataAdapter>> {
  return Object.fromEntries([...adapters].map(([exchange,adapter])=>{
    const candles=new Map<string,Promise<ResearchBar[]>>(),takers=new Map<string,Promise<ResearchBar[]>>();let universe:ReturnType<FishDataAdapter['list']>|undefined;
    const countFor=(interval:string,minimum:number)=>Math.max(minimum,interval==='5m'?fiveMinuteMinimum:0,...plans.filter(p=>intervalOf(p.def)===interval&&(!eligible||eligible(exchange,p))).map(p=>p.N));
    return [exchange,{exchange,btc:()=>adapter.btc(),list:(signal:AbortSignal)=>universe??=adapter.list(signal),
      candles:(market,cut,signal,query)=>{
        const count=countFor(query.interval,query.count),key=`${market.instrument}|${query.interval}|${cut}`;
        if(!candles.has(key))candles.set(key,adapter.candles(market,cut,signal,{...query,count,allowPartial:true,...(plans.some(p=>p.compiled.usesPrs6h||p.compiled.usesAti6h)?{marketEvidence:true}:{})}));
        return candles.get(key)!.then(b=>b.slice(-query.count));
      },
      taker:async(market,bars,signal,query)=>{
        const count=countFor(query.interval,query.count),step=plans.find(p=>intervalOf(p.def)===query.interval)!.step,cut=Math.floor(anchorMs/step)*step,key=`${market.instrument}|${query.interval}|${cut}`;
        if(!takers.has(key))takers.set(key,(async()=>{const raw=await candles.get(key)!;return adapter.taker(market,raw,signal,{...query,count});})());
        return (await takers.get(key)!).slice(-query.count);
      }} satisfies FishDataAdapter];
  }));
}
