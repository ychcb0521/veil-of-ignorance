/** Opt-in ATI adapter. Exchange tick size is never inferred from displayed decimal places. */
import type {FetchFn} from './deepRsa/marketData';
import {assertBinancePublicAllowed,noteBinanceRateLimit} from './binanceRateLimit';
import { readTuringCupTickSize } from './turingCupMarketData';
import { isTuringCupSymbol } from './turingCupSymbol';
import { getUserPrefix } from './userStoragePrefix';
let cache:Promise<Map<string,number>>|null=null;
let resolved:Map<string,number>|null=null,version=0,retryAt=0;
const listeners=new Set<()=>void>();
export const ati6hMarketVersion=()=>version;
export const subscribeAti6hMarketData=(fn:()=>void)=>{listeners.add(fn);return ()=>{listeners.delete(fn);};};
const offline = new Map<string, { value: number | null; retryAt: number }>();
const offlineKey = (symbol: string) => getUserPrefix() + symbol;
export const peekAti6hTickSize = (symbol: string) => isTuringCupSymbol(symbol)
  ? offline.get(offlineKey(symbol))?.value ?? null : resolved?.get(symbol) ?? null;
export function requestAti6hTickSize(symbol: string) {
  if (isTuringCupSymbol(symbol)) {
    const key = offlineKey(symbol), entry = offline.get(key);
    if (entry?.value || (entry?.retryAt ?? 0) > Date.now()) return;
    const pending = { value: null, retryAt: Date.now() + 30_000 };
    offline.set(key, pending);
    void readTuringCupTickSize(symbol).then(value => {
      if (!value || offline.get(key) !== pending) return;
      offline.set(key, { value, retryAt: Infinity });
      version++;
      for (const fn of listeners) fn();
    }).catch(() => { /* retry after cooldown */ });
  } else if (!resolved && Date.now() >= retryAt) {
    retryAt = Date.now() + 30_000;
    void ati6hTickSize(symbol);
  }
}

export async function ati6hTickSize(symbol:string,fetchFn:FetchFn=fetch as unknown as FetchFn,signal?:AbortSignal):Promise<number|null>{
 if (isTuringCupSymbol(symbol)) return readTuringCupTickSize(symbol, signal);
 if(!cache)cache=(async()=>{
  assertBinancePublicAllowed();
  const response=await fetchFn('https://fapi.binance.com/fapi/v1/exchangeInfo',{signal});
  if(!response.ok){if(response.status===429||response.status===418)noteBinanceRateLimit(response);throw Error('ATI6H tick_size 获取失败');}
  const data=await response.json() as {symbols?:{symbol:string;filters?:{filterType:string;tickSize?:string}[]}[]};
  if(!Array.isArray(data.symbols))throw Error('ATI6H 交易所精度响应无效');
  resolved=new Map(data.symbols.flatMap(s=>{const tick=Number(s.filters?.find(f=>f.filterType==='PRICE_FILTER')?.tickSize);return Number.isFinite(tick)&&tick>0?[[s.symbol,tick] as [string,number]]:[];}));
  version++;for(const fn of listeners)fn();return resolved;
 })().catch(error=>{cache=null;throw error;});
 try{return (await cache).get(symbol)??null;}catch(error){if(signal?.aborted)throw error;return null;}
}
export function clearAti6hMarketCache(){cache=null;resolved=null;offline.clear();retryAt=0;version++;}
