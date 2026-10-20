import {it,expect,vi} from 'vitest';
import {FishScanner} from '@/lib/fishScanner';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {AUDITED_EXCHANGES,type FishExchange} from '@/lib/fish/exchanges';
import type {FishDataAdapter} from '@/lib/fish/adapters';
import type {TradeSignal} from '@/lib/signalLibrary';
const cut=Date.UTC(2026,9,20,7),step=300000;
const feature={...CBI2_DEF,id:'scope-close',formula:'C',scale:1};
const algorithm={direction:'>' as const,threshold:100,constraints:[]};
function fixture(){
 const adapters=Object.fromEntries(AUDITED_EXCHANGES.map(exchange=>{
  const coin={symbol:'COINUSDT',instrument:'COINUSDT',base:'COIN',multiplier:1};
  const stock={...coin,symbol:'AAPLUSDT',instrument:'AAPLUSDT',base:'AAPL',market:'us_stock' as const,underlying:'AAPL'};
  return [exchange,{exchange,list:vi.fn(async()=>[coin,...(['binance','bitget'].includes(exchange)?[stock]:[])]),btc:()=>({...coin,symbol:'BTCUSDT'}),taker:vi.fn(async(_m,b)=>b),candles:vi.fn(async(_m,end,_s,q)=>Array.from({length:q.count},(_,i)=>({openTime:end-(q.count-i)*step,open:99,close:i<q.count-5?99:101,high:102,low:98,volume:10,quoteVolume:1000,takerBuyQuoteVolume:500,takerBuyVolume:5})))}];
 })) as Partial<Record<FishExchange,FishDataAdapter>>;
 return {adapters,scanner:new FishScanner(async()=>new Response(JSON.stringify({serverTime:cut+step})),undefined,undefined,adapters)};
}
it.each([false,true])('只捕捞勾选来源，股票必须明确选择（多算法=%s）',async(multiple)=>{
 for(const selection of [{},{exchanges:['bitget'] as FishExchange[]},{exchanges:['binance','bitget'] as FishExchange[],includeUsStocks:true},{exchanges:['binance','bitget'] as FishExchange[],includeUsStocks:false}]){
  const f=fixture(),found:TradeSignal[]=[],signal=new AbortController().signal;
  const settings={...selection,feature,algorithm,includeDuplicates:true,...(multiple?{algorithms:[{feature,algorithm},{feature,algorithm:{...algorithm,threshold:100.5}}]}:{})};
  const result=await f.scanner.scan({...settings,signal,onProgress:()=>{},onSignal:s=>found.push(s)});
  const chosen=selection.exchanges??['binance'];
  expect(Object.keys(result.venues!)).toEqual(chosen);expect(result.counts.hit).toBe(chosen.length*(selection.includeUsStocks?2:1));
  expect(found.every(s=>chosen.includes(s.exchange??'binance'))).toBe(true);
  expect(found.filter(s=>s.market==='us_stock')).toHaveLength(selection.includeUsStocks?chosen.length:0);
  for(const exchange of AUDITED_EXCHANGES)if(!chosen.includes(exchange))expect(f.adapters[exchange].candles).not.toHaveBeenCalled();
  if(!selection.includeUsStocks)for(const exchange of chosen)expect(vi.mocked(f.adapters[exchange].candles).mock.calls.some(c=>c[0].market==='us_stock')).toBe(false);
  expect(await f.scanner.estimateMarkets(settings,signal)).toBe(chosen.length*(selection.includeUsStocks?2:1));
 }
});
