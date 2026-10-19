import { intervalOf, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { type FishAlgorithmSettings, type FishProgram, type FishSnapshot } from './algorithm';
import type { TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import type { FishDataAdapter } from './adapters';
import type { FishExchange } from './exchanges';
import type { ResearchBar } from '@/lib/deepRsa/window';
export interface FishAlgorithmInput { feature: DeepDigFeatureDef; algorithm: FishAlgorithmSettings }
export interface FishMemberResult { outcome: string; signal?: TradeSignal; snapshot?: FishSnapshot; boundaryMs?: number }
export const fishCombinationKey=(plans: readonly Pick<FishProgram,'algorithmKey'>[])=>plans.map(p=>p.algorithmKey).sort().join('&');
export function intersectFishResults(rows: readonly FishMemberResult[], plans: readonly FishProgram[]): FishMemberResult {
  if(rows.length===1)return rows[0];
  if(!rows.length||rows.some(r=>r.outcome!=='hit'&&r.outcome!=='unknown'))return {outcome:rows.find(r=>r.outcome!=='hit'&&r.outcome!=='unknown')?.outcome??'unknown'};
  const hits=rows.flatMap(r=>r.signal?[r.signal]:[]),start=Math.max(...hits.map(s=>s.timeMs));
  if(!hits.length||rows.some(r=>r.outcome==='unknown'&&!(start>(r.boundaryMs??Infinity))))return {outcome:'unknown'};
  const source=hits.find(s=>s.timeMs===start)!,key=fishCombinationKey(plans);
  const identity=source.market==='us_stock'?`us-${source.exchange??'binance'}-${source.underlying??source.symbol}`:`${source.exchange&&source.exchange!=='binance'?source.exchange+'-':''}${source.symbol}`;
  return {outcome:'hit',signal:{...source,id:`fish-${identity}-${start}-${encodeURIComponent(key)}`,timeMs:start,timeLabel:formatUTC8(start),fish:{...source.fish!,algorithmKey:key,intersectionStart:start,algorithms:rows.map(r=>r.signal?.fish??r.snapshot!)}}};
}
/** Request once per venue/instrument/period, then give each program exactly its own trailing N. */
export function sharedFishAdapters(adapters: Map<FishExchange,FishDataAdapter>, plans: readonly FishProgram[], anchorMs:number): Partial<Record<FishExchange,FishDataAdapter>> {
  return Object.fromEntries([...adapters].map(([exchange,adapter])=>{
    const candles=new Map<string,Promise<ResearchBar[]>>(),takers=new Map<string,Promise<ResearchBar[]>>();let universe:ReturnType<FishDataAdapter['list']>|undefined;
    const countFor=(interval:string)=>Math.max(...plans.filter(p=>intervalOf(p.def)===interval).map(p=>p.N));
    return [exchange,{exchange,btc:()=>adapter.btc(),list:(signal:AbortSignal)=>universe??=adapter.list(signal),
      candles:(market,cut,signal,query)=>{
        const count=countFor(query.interval),key=`${market.instrument}|${query.interval}|${cut}`;
        if(!candles.has(key))candles.set(key,adapter.candles(market,cut,signal,{...query,count,allowPartial:true}));
        return candles.get(key)!.then(b=>b.slice(-query.count));
      },
      taker:async(market,bars,signal,query)=>{
        const count=countFor(query.interval),step=plans.find(p=>intervalOf(p.def)===query.interval)!.step,cut=Math.floor(anchorMs/step)*step,key=`${market.instrument}|${query.interval}|${cut}`;
        if(!takers.has(key))takers.set(key,(async()=>{const raw=await candles.get(key)!;return adapter.taker(market,raw,signal,{...query,count});})());
        return (await takers.get(key)!).slice(-query.count);
      }} satisfies FishDataAdapter];
  }));
}
