import {binanceStockMarket,bitgetStockMarket} from './stockMetadata';
import {nativeFishInterval,fishBarLabel} from './periods';
import { intervalMs, type ResearchInterval } from '@/lib/deepRsa/marketData';
import type { ResearchBar } from '@/lib/deepRsa/window';
import { parseBinanceKlineRow } from '@/lib/deepRsa/window';
import { FISH_STEP, FISH_BARS, FishError, FishWeightBudget, FishRequestPool, validateFishBars } from './shared';
import { EXCHANGE_NAMES, AUDITED_EXCHANGES, type FishExchange, type FishMarket } from './exchanges';

/** [from, cut) 里按 step 对齐、缓存里没有的时间点，合并成连续区间 [start, stop)。 */
export function fishMissingRanges(have: readonly number[], from: number, cut: number, step: number): [number, number][] {
  const set = new Set(have), out: [number, number][] = [];
  let start: number | null = null;
  for (let t = from; t < cut; t += step) {
    if (!set.has(t)) { if (start === null) start = t; }
    else if (start !== null) { out.push([start, t]); start = null; }
  }
  if (start !== null) out.push([start, cut]);
  return out;
}
export type FishRequest = (path: string, weight: number, signal: AbortSignal) => Promise<unknown>;
const finite = (x: unknown) => x !== null && x !== '' && Number.isFinite(Number(x));
const num = (x: unknown) => finite(x) ? Number(x) : NaN;
const abort = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('已取消', 'AbortError'); };
function bar(openTime: unknown, o: unknown, h: unknown, l: unknown, c: unknown, volume: unknown, quote: unknown): ResearchBar {
  const b = { openTime: num(openTime), open: num(o), high: num(h), low: num(l), close: num(c), volume: num(volume), quoteVolume: num(quote), takerBuyVolume: null };
  if (Object.values(b).some(v => typeof v === 'number' && !Number.isFinite(v)) || b.open <= 0 || b.close <= 0 || b.low <= 0 || b.high < Math.max(b.open,b.close,b.low) || b.low > Math.min(b.open,b.close) || b.volume < 0 || b.quoteVolume < 0) throw new FishError('K线关键读数无效', 'readings');
  return b;
}
export function parseOkxCandle(row: unknown, multiplier: number): ResearchBar | null {
  if (!Array.isArray(row) || row[8] !== '1') return null;
  return bar(row[0],row[1],row[2],row[3],row[4],num(row[5])*multiplier,row[7]);
}
export function parseGateCandle(row: any, multiplier: number): ResearchBar {
  return bar(num(row.t)*1000,row.o,row.h,row.l,row.c,num(row.v)*multiplier,row.sum);
}
export function parseBitgetCandle(row: unknown): ResearchBar {
  if(!Array.isArray(row))throw new FishError('Bitget K线响应无效','readings');
  return bar(row[0],row[1],row[2],row[3],row[4],row[5],row[6]);
}
export interface TakerTrade { id: string; timeMs: number; buy: boolean; volume: number; quote: number; }
export function parseOkxTrade(row: any, multiplier: number): TakerTrade {
  const volume = num(row.sz)*multiplier, price = num(row.px);
  if (!/^\d+$/.test(row.tradeId) || !['buy','sell'].includes(row.side) || !finite(row.ts) || !(volume>0) || !(price>0)) throw new FishError('主动成交读数不全','readings');
  return { id: row.tradeId, timeMs: num(row.ts), buy: row.side==='buy', volume, quote: volume*price };
}
export function parseBitgetTrade(row:any):TakerTrade {
  return parseOkxTrade({tradeId:row.tradeId,ts:row.ts,side:String(row.side).toLowerCase(),sz:row.size,px:row.price},1);
}
export function parseGateTrade(row: any, multiplier: number): TakerTrade {
  const size = num(row.size), price = num(row.price);
  // REST create_time is seconds (including fractional seconds); ignore the inconsistently named create_time_ms.
  if ((typeof row.id === 'number' && !Number.isSafeInteger(row.id)) || !/^\d+$/.test(String(row.id)) || !finite(row.create_time) || !size || !Number.isFinite(size) || !(price>0)) throw new FishError('主动成交读数不全','readings');
  const volume = Math.abs(size)*multiplier;
  return { id: String(row.id), timeMs: num(row.create_time)*1000, buy: size>0, volume, quote: volume*price };
}
export function joinFishTaker(bars: readonly ResearchBar[], trades: readonly TakerTrade[]): ResearchBar[] {
  const sums = new Map<number,{ buy: number; sell: number; buyBase: number; base: number }>();
  const seen = new Set<string>();
  for (const t of trades) {
    if (seen.has(t.id)) continue; seen.add(t.id);
    const time = Math.floor(t.timeMs/FISH_STEP)*FISH_STEP;
    const x = sums.get(time) ?? { buy:0,sell:0,buyBase:0,base:0 };
    if (t.buy) { x.buy+=t.quote; x.buyBase+=t.volume; } else x.sell+=t.quote;
    x.base+=t.volume; sums.set(time,x);
  }
  return applySums(bars,sums);
}
function applySums(bars: readonly ResearchBar[], sums: Map<number,{buy:number;sell:number;buyBase:number;base:number}>): ResearchBar[] {
  return bars.map(b => {
    const x = sums.get(b.openTime) ?? {buy:0,sell:0,buyBase:0,base:0};
    // Missing trades are NOT zero-filled: every candle must reconcile its quote and base turnover.
    const q = b.quoteVolume;
    if (q == null || Math.abs(x.buy+x.sell-q)>Math.max(1e-6,Math.abs(q)*1e-8) || Math.abs(x.base-b.volume)>Math.max(1e-10,Math.abs(b.volume)*1e-8)) throw new FishError(`主动买卖额与K线成交额不一致或缺根 @ ${b.openTime}：B+S=${x.buy+x.sell}，Q=${q}；逐笔币量=${x.base}，K线币量=${b.volume}（缺成交或对账超差）`,'readings');
    return {...b,takerBuyQuoteVolume:x.buy,takerBuyVolume:x.buyBase};
  });
}
export interface FishBarQuery { interval: ResearchInterval; count: number }
export interface FishDataAdapter {
  readonly exchange: FishExchange;
  list(signal: AbortSignal): Promise<FishMarket[]>;
  btc(): FishMarket;
  candles(market: FishMarket, cut: number, signal: AbortSignal, query?: FishBarQuery): Promise<ResearchBar[]>;
  taker(market: FishMarket, bars: ResearchBar[], signal: AbortSignal, query?: FishBarQuery): Promise<ResearchBar[]>;
}
export class FishAdapter implements FishDataAdapter {
  private cache = new Map<string,ResearchBar[]>();
  private remember(key:string,bars:ResearchBar[]):void {
    const byTime=new Map((this.cache.get(key)??[]).map(b=>[b.openTime,b]));for(const b of bars)byTime.set(b.openTime,b);
    let rows=[...byTime.values()];const cap=Math.max(5000,bars.length,this.cache.get(key)?.length??0),cut=bars.at(-1)?.openTime??0;
    if(rows.length>cap)rows.sort((a,b)=>Math.abs(a.openTime-cut)-Math.abs(b.openTime-cut)).splice(cap);
    rows.sort((a,b)=>a.openTime-b.openTime);this.cache.set(key,rows);
  }
  private markets: FishMarket[] = [];
  constructor(readonly exchange: FishExchange, readonly request: FishRequest) {}
  async list(signal: AbortSignal): Promise<FishMarket[]> {
    let markets: FishMarket[];
    if (this.exchange==='binance') {
      const j:any=await this.request('exchangeInfo',1,signal);
      if (!Array.isArray(j.symbols)) throw new FishError('交易标的列表无效','failed');
      markets=j.symbols.filter((s:any)=>binanceStockMarket(s)!==null&&s.quoteAsset==='USDT'&&s.status==='TRADING').map((s:any)=>({symbol:s.symbol,instrument:s.symbol,base:s.baseAsset??s.symbol.replace(/USDT$/,''),multiplier:1,...(binanceStockMarket(s)==='us_stock'?{market:'us_stock' as const,underlying:s.baseAsset}:{})}));
    } else if (this.exchange==='okx') {
      const j:any=await this.request('public/instruments?instType=SWAP',1,signal);
      if(j.code!=='0'||!Array.isArray(j.data)) throw new FishError('OKX合约列表无效','failed');
      markets=j.data.filter((s:any)=>(!s.instCategory||s.instCategory==='1')&&s.settleCcy==='USDT'&&s.ctType==='linear'&&s.state==='live'&&s.instId.endsWith('-USDT-SWAP')&&s.ctValCcy===s.instId.split('-')[0]).map((s:any)=>({symbol:s.instId.replace('-USDT-SWAP','USDT'),instrument:s.instId,base:s.instId.split('-')[0],multiplier:num(s.ctVal)*num(s.ctMult||1)}));
    } else if (this.exchange==='bitget') {
      const j:any=await this.request('contracts?productType=USDT-FUTURES',1,signal);
      if(j.code!=='00000'||!Array.isArray(j.data))throw new FishError('Bitget合约列表无效','failed');
      const v:any=await this.request('instruments?category=USDT-FUTURES',1,signal);
      if(v.code!=='00000'||!Array.isArray(v.data))throw new FishError('Bitget资产分类元数据无效，无法确认美股范围','failed');
      const metadata=new Map<string,any>(v.data.map((m:any)=>[m.symbol,m]));
      markets=j.data.filter((s:any)=>s.quoteCoin==='USDT'&&s.symbolStatus==='normal'&&s.symbolType==='perpetual'&&bitgetStockMarket(s,metadata.get(s.symbol))!==null).map((s:any)=>({symbol:s.symbol,instrument:s.symbol,base:s.baseCoin,multiplier:1,...(bitgetStockMarket(s,metadata.get(s.symbol))==='us_stock'?{market:'us_stock' as const,underlying:metadata.get(s.symbol).baseCoin??s.baseCoin}:{})}));
    } else if (this.exchange==='gate') {
      const j:any=await this.request('contracts',1,signal);
      if(!Array.isArray(j)) throw new FishError('Gate合约列表无效','failed');
      markets=j.filter((s:any)=>(!s.contract_type)&&s.name?.endsWith('_USDT')&&s.type==='direct'&&s.in_delisting===false&&s.status==='trading').map((s:any)=>({symbol:s.name.replace('_',''),instrument:s.name,base:s.name.replace(/_USDT$/,''),multiplier:num(s.quanto_multiplier)}));
    } else throw new FishError('该交易所尚未通过数据核实','failed');
    if(markets.some(m=>!m.symbol||!m.base||!(m.multiplier>0)||(m.market==='us_stock'&&!m.underlying))) throw new FishError('合约面值无效','readings');
    this.markets=[...new Map(markets.map(m=>[m.instrument,m])).values()].sort((a,b)=>a.symbol.localeCompare(b.symbol));
    return this.markets;
  }
  btc(): FishMarket {
    const m=this.markets.find(m=>m.market!=='us_stock'&&m.instrument===({binance:'BTCUSDT',okx:'BTC-USDT-SWAP',bitget:'BTCUSDT',gate:'BTC_USDT'} as Partial<Record<FishExchange,string>>)[this.exchange]);
    if(!m) throw new FishError('BTC永续合约不存在','gap'); return m;
  }
  async candles(market: FishMarket, cut: number, signal: AbortSignal, query: FishBarQuery = {interval:'5m',count:FISH_BARS}): Promise<ResearchBar[]> {
    const step=intervalMs(query.interval), cacheKey=`${market.instrument}|${query.interval}`;
    const from=cut-query.count*step,native=nativeFishInterval(this.exchange,query.interval);
    if(native!==query.interval){
      const ratio=step/intervalMs(native),raw=await this.candles(market,cut,signal,{interval:native,count:query.count*ratio});
      const prior=new Map((this.cache.get(cacheKey)??[]).map(b=>[b.openTime,b]));
      const grouped:ResearchBar[]=[];
      for(let i=0;i<raw.length;i+=ratio){const group=raw.slice(i,i+ratio),first=group[0],last=group.at(-1)!;const previous=prior.get(first.openTime);
        grouped.push(previous??{openTime:first.openTime,open:first.open,close:last.close,high:Math.max(...group.map(b=>b.high)),low:Math.min(...group.map(b=>b.low)),volume:group.reduce((v,b)=>v+b.volume,0),quoteVolume:group.reduce((v,b)=>v+(b.quoteVolume??NaN),0),takerBuyVolume:null});
      }
      validateFishBars(grouped,cut,query.count,step);this.remember(cacheKey,grouped);return grouped;
    }
    const collected=(this.cache.get(cacheKey)??[]).filter(b=>b.openTime>=from&&b.openTime<cut);
    // 补齐窗口里所有缺的时间段，不只是头尾：缓存是多次扫描（不同截止时刻）拼起来的，
    // 两段之间会留洞。之前只补头尾，洞没补 → 整个币被当成「缺口」跳过（2026-10-19 用户反馈原来捕到的现在捕不到）。
    const ranges=fishMissingRanges(collected.map(b=>b.openTime),from,cut,step);
    for(const [start,stop] of ranges) {
      if(this.exchange==='okx'||this.exchange==='bitget') {
        let cursor=stop;
        while(cursor>start) {
          const path=this.exchange==='okx'?`market/history-candles?instId=${market.instrument}&bar=${fishBarLabel(this.exchange,query.interval)}&after=${cursor}&limit=100`:`history-candles?symbol=${market.instrument}&productType=USDT-FUTURES&granularity=${fishBarLabel(this.exchange,query.interval)}&endTime=${cursor}&limit=200`;
          const j:any=await this.request(path,1,signal);
          if(j.code!==(this.exchange==='okx'?'0':'00000')||!Array.isArray(j.data)) throw new FishError('K线响应无效','failed');
          const parsed=j.data.map((r:unknown)=>this.exchange==='okx'?parseOkxCandle(r,market.multiplier):parseBitgetCandle(r)).filter((b:ResearchBar|null):b is ResearchBar=>!!b&&b.openTime<cursor&&b.openTime+step<=cut);
          if(!parsed.length) break;

          for(const b of parsed) if(b.openTime>=start) collected.push(b);
          const next=Math.min(...parsed.map((b:ResearchBar)=>b.openTime));
          if(next>=cursor) throw new FishError('K线翻页没有推进','gap'); cursor=next;
        }
      } else {
        let cursor=start;
        while(cursor<stop) {
          const end=Math.min(stop,cursor+(1000)*step);
          const path=this.exchange==='binance'?`klines?symbol=${market.instrument}&interval=${query.interval}&startTime=${cursor}&endTime=${end-1}&limit=1000`:`candlesticks?contract=${market.instrument}&interval=${query.interval}&from=${cursor/1000}&to=${(end-step)/1000}`;

          const j=await this.request(path,this.exchange==='binance'?5:1,signal);
          if(!Array.isArray(j)) throw new FishError('K线响应无效','failed');
          for(const r of j) { const b=this.exchange==='binance'?parseBinanceKlineRow(r):parseGateCandle(r,market.multiplier); if(!b) throw new FishError('K线读数无效','readings'); if(b.openTime>=cursor&&b.openTime<end&&b.openTime+step<=cut) collected.push(b); }
          cursor=end;
        }
      }
    }
    abort(signal); collected.sort((a,b)=>a.openTime-b.openTime);
    const unique=[...new Map(collected.map(b=>[b.openTime,b])).values()];
    validateFishBars(unique,cut,query.count,step); this.remember(cacheKey,unique); return unique;
  }
  async taker(market:FishMarket,bars:ResearchBar[],signal:AbortSignal,query: FishBarQuery = {interval:'5m',count:FISH_BARS}):Promise<ResearchBar[]> {
    const step=intervalMs(query.interval);
    if(this.exchange==='binance') return bars;
    const missing=bars.filter(b=>b.takerBuyQuoteVolume==null);
    if(!missing.length) return bars;
    const begin=missing[0].openTime, end=missing[missing.length-1].openTime+step;
    const sums=new Map<number,{buy:number;sell:number;buyBase:number;base:number}>();
    // Public time queries are bounded; preserve the final fractional second within each chunk.
    for(let from=begin;from<end;from+=7*86400000){
    const to=Math.min(end,from+7*86400000);
    let cursor=String(to), previousId:bigint|null=null, offset=0;
    for(;;) {
      abort(signal);
      const path=this.exchange==='okx'?`market/history-trades?instId=${market.instrument}&type=${previousId===null?2:1}&after=${cursor}&limit=100`:this.exchange==='bitget'?`fills-history?symbol=${market.instrument}&productType=USDT-FUTURES&startTime=${from}&endTime=${to}&limit=1000${previousId===null?'':`&idLessThan=${cursor}`}`:`trades?contract=${market.instrument}&from=${from/1000}&to=${to/1000}&limit=1000&offset=${offset}`;
      const j:any=await this.request(path,1,signal), raw=this.exchange==='gate'?j:j.data;
      if((this.exchange!=='gate'&&j.code!==(this.exchange==='okx'?'0':'00000'))||!Array.isArray(raw)) throw new FishError('历史主动成交请求无效','failed');
      if(!raw.length) break;
      const trades:TakerTrade[]=raw.map((r:any)=>this.exchange==='okx'?parseOkxTrade(r,market.multiplier):this.exchange==='bitget'?parseBitgetTrade(r):parseGateTrade(r,market.multiplier));
      const nextId=trades.reduce((min,t)=>BigInt(t.id)<min?BigInt(t.id):min,BigInt(trades[0].id));
      if(previousId!==null&&nextId>=previousId) throw new FishError('主动成交翻页没有推进','readings');
      const seen=new Set<string>();
      for(const t of trades) {
        if(seen.has(t.id)||(previousId!==null&&BigInt(t.id)>=previousId)) continue; seen.add(t.id);
        if(t.timeMs<from||t.timeMs>=to) continue;
        const time=Math.floor(t.timeMs/step)*step, x=sums.get(time)??{buy:0,sell:0,buyBase:0,base:0};
        if(t.buy){x.buy+=t.quote;x.buyBase+=t.volume;}else x.sell+=t.quote;
        x.base+=t.volume;sums.set(time,x);
      }
      previousId=nextId;cursor=String(nextId);offset+=raw.length;
      if(this.exchange==='okx'?trades.some(t=>t.timeMs<from):raw.length<1000) break;
    }
    }
    const filled=applySums(missing,sums), ready=new Map(filled.map(b=>[b.openTime,b]));
    const result=bars.map(b=>ready.get(b.openTime)??b);this.remember(`${market.instrument}|${query.interval}`,result);return result;
  }
}
/** Each venue owns a rolling budget. A direct network failure can switch to its fixed read-only proxy once. */
export function fishTransport(exchange:FishExchange,fetcher:typeof fetch,budget:FishWeightBudget,pool=new FishRequestPool()):FishRequest {
  if(!AUDITED_EXCHANGES.includes(exchange))throw new FishError('该交易所尚未通过数据核实','failed');
  let useProxy=false;
  const proxyUrl=(path:string)=>`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fish-market-proxy?${new URLSearchParams({exchange,path})}`;
  const context=(path:string,message:string,status?:number)=>new FishError(`${EXCHANGE_NAMES[exchange]} · ${path} · ${message}`,status===418?'banned':'failed',{path,status});
  const explain=(body:any)=>{
    const text=String(body?.message??body?.msg??body?.error??'');
    if(/10000/.test(text)&&/candlestick/i.test(text))return '历史K线超过最近10000根的保留范围';
    if(/too (many|long)|exceed|maximum.*points/i.test(text))return '查询区间或数量超出接口限制';
    if(/too old|history|90 days|3 months/i.test(text))return '查询时间超出可用历史范围';
    if(/parameter|param/i.test(text))return '接口参数无效';
    if(/[一-鿿]/.test(text))return text.slice(0,240);
    return body?.label?`上游错误代码 ${body.label}`:body?.code?`上游业务代码 ${body.code}`:'上游请求未成功（可检查代理是否已随站点发布）';
  };
  async function read(url:string,path:string,weight:number,signal:AbortSignal):Promise<unknown>{
    const result=await pool.run(async()=>{
      abort(signal);const wait=budget.tryTake(weight);if(wait)return {wait};
      const response=await fetcher.call(globalThis,url,{signal});
      if(response.status===429){const retry=Number(response.headers.get('Retry-After')??60);budget.pauseUntil(Date.now()+(Number.isFinite(retry)?Math.max(60000,retry*1000):60000));}
      let body:unknown;
      try{body=await response.json();}catch{if(!response.ok)throw context(path,`HTTP ${response.status}：上游请求失败`,response.status);throw context(path,'HTTP 200：响应不是有效 JSON',response.status);}
      if(!response.ok)throw context(path,`HTTP ${response.status}：${response.status===418?'访问受限，本交易所中止':response.status===429?'请求过于频繁，已暂停本交易所后续请求':explain(body)}`,response.status);
      const j=body as any;
      if((exchange==='okx'&&j?.code!==undefined&&j.code!=='0')||(exchange==='bitget'&&j?.code!==undefined&&j.code!=='00000')||(exchange==='gate'&&j?.label))throw context(path,`HTTP ${response.status}：${explain(j)}`,response.status);
      return {data:body};
    },signal);
    if('data' in result)return result.data;
    await budget.wait(result.wait,signal);return read(url,path,weight,signal);
  }
  return async(path,weight,signal)=>{
    const wasProxy=useProxy;
    const url=exchange==='binance'?`https://fapi.binance.com/fapi/v1/${path}`:wasProxy?proxyUrl(path):exchange==='bitget'?`https://api.bitget.com/${path.startsWith('instruments?')?'api/v3/market/':'api/v2/mix/market/'}${path}`:exchange==='gate'?`https://api.gateio.ws/api/v4/futures/usdt/${path}`:`https://www.okx.com/api/v5/${path}`;
    try{return await read(url,path,weight,signal);}
    catch(error){
      if(signal.aborted||!(error instanceof TypeError))throw error;
      if(exchange==='binance'||wasProxy)throw context(path,'浏览器拦截（网络 / 跨域）'+(wasProxy?'；只读代理也未能连接，请检查是否已发布':''));
      useProxy=true;
      try{return await read(proxyUrl(path),path,weight,signal);}
      catch(proxyError){if(signal.aborted||!(proxyError instanceof TypeError))throw proxyError;throw context(path,'浏览器拦截（网络 / 跨域）；只读代理也未能连接，请检查是否已发布');}
    }
  };
}
