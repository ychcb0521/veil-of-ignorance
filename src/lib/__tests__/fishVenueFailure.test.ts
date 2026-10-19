// 【用户要求】2026-10-19「这是啥原因？请解决」：Gate BTC 参考 K 线取不到（直连被拦、只读代理未部署 → HTTP 404 NOT_FOUND）
// 以前整次扫描中止；现在只跳过那一家并写明原因，其余交易所照常扫；代理没部署的说明要说人话，且之后恢复直连。
import {it,expect,vi} from 'vitest';
import {FishScanner} from '@/lib/fishScanner';
import {fishTransport,PROXY_MISSING,type FishDataAdapter} from '@/lib/fish/adapters';
import {FishError,FishWeightBudget} from '@/lib/fish/shared';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {intervalMs} from '@/lib/deepRsa/marketData';
const cut=Date.UTC(2026,9,19,3),signal=new AbortController().signal;
const def={...CBI2_DEF,id:'cb',short:'P',formula:'P = C + CB * 0',scale:1,unit:''};
const algorithm={direction:'>' as const,threshold:100,constraints:[]};
const bars=(c:number,q:any)=>Array.from({length:q.count},(_,i)=>{const t=c-(q.count-i)*intervalMs(q.interval),close=t<cut-5*300000?99:101;return {openTime:t,open:close,close,high:close+1,low:close-1,volume:10,quoteVolume:1000,takerBuyQuoteVolume:600,takerBuyVolume:null};});
function venue(exchange:'binance'|'gate',btcFails=false):FishDataAdapter{
 const coin={symbol:'AAAUSDT',instrument:exchange==='gate'?'AAA_USDT':'AAAUSDT',base:'AAA',multiplier:1},btc={symbol:'BTCUSDT',instrument:exchange==='gate'?'BTC_USDT':'BTCUSDT',base:'BTC',multiplier:1};
 return {exchange,list:vi.fn(async()=>[coin,btc]),btc:()=>btc,taker:vi.fn(async(_m,b)=>b),candles:vi.fn(async(m,c,_s,q)=>{if(btcFails&&m.base==='BTC')throw new FishError(`Gate · candlesticks · HTTP 404：${PROXY_MISSING}`,'failed');return bars(c,q);})};
}
it('一家的 BTC 参考取不到：只跳过那一家并写明原因，其余交易所照常扫、照常出信号',async()=>{
 const scanner=new FishScanner(vi.fn(async()=>new Response(JSON.stringify({serverTime:cut+600000}))) as typeof fetch,undefined,undefined,{binance:venue('binance'),gate:venue('gate',true)});
 const hits:any[]=[];const p=await scanner.scan({feature:def,algorithm,exchanges:['binance','gate'],includeDuplicates:true,anchorMs:cut+123456,signal,onProgress:()=>{},onSignal:s=>hits.push(s)});
 expect(p.status).toBe('complete');expect(p.error).toBeUndefined();
 expect(hits.length).toBeGreaterThan(0);expect(hits.every(h=>(h.exchange??'binance')==='binance')).toBe(true);
 expect(p.venues?.gate?.status).toBe('skipped');expect(p.venues?.gate?.skippedReason).toContain('BTC参考K线');
 expect(p.notice).toContain('Gate本轮跳过');expect(p.notice).toContain('只读代理未部署');
});
it('多算法（交集 / 并集）同样只跳过那一家，说明汇总到进度里',async()=>{
 for(const combination of ['and','or'] as const){
  const scanner=new FishScanner(vi.fn(async()=>new Response(JSON.stringify({serverTime:cut+600000}))) as typeof fetch,undefined,undefined,{binance:venue('binance'),gate:venue('gate',true)});
  const hits:any[]=[];const p=await scanner.scan({algorithms:[{feature:def,algorithm},{feature:def,algorithm:{...algorithm,threshold:100.5}}],combination,exchanges:['binance','gate'],includeDuplicates:true,anchorMs:cut+123456,signal,onProgress:()=>{},onSignal:s=>hits.push(s)});
  expect(p.status).toBe('complete');expect(hits.length).toBeGreaterThan(0);expect(hits.every(h=>(h.exchange??'binance')==='binance')).toBe(true);expect(p.notice).toContain('Gate本轮跳过');
 }
});
it('所有勾选的交易所都取不到 BTC 参考：整次中止并写出每家原因',async()=>{
 const scanner=new FishScanner(vi.fn(async()=>new Response(JSON.stringify({serverTime:cut+600000}))) as typeof fetch,undefined,undefined,{gate:venue('gate',true)});
 const p=await scanner.scan({feature:def,algorithm,exchanges:['gate'],includeDuplicates:true,anchorMs:cut+123456,signal,onProgress:()=>{},onSignal:()=>{}});
 expect(p.status).toBe('aborted');expect(p.error).toContain('Gate');
});
it('直连被拦、只读代理未部署（Supabase 404 NOT_FOUND）：报错说清楚，下一次请求恢复直连',async()=>{
 const urls:string[]=[];
 const fetcher=vi.fn(async(url:RequestInfo|URL)=>{const u=String(url);urls.push(u);if(u.includes('api.gateio.ws'))throw new TypeError('Failed to fetch');return new Response(JSON.stringify({code:'NOT_FOUND',message:'Requested function was not found'}),{status:404});});
 const request=fishTransport('gate',fetcher as typeof fetch,new FishWeightBudget());
 await expect(request('contracts',1,signal)).rejects.toThrow(PROXY_MISSING);
 expect(urls.some(u=>u.includes('fish-market-proxy'))).toBe(true);
 urls.length=0;await expect(request('contracts',1,signal)).rejects.toThrow();expect(urls[0]).toContain('api.gateio.ws');
});
