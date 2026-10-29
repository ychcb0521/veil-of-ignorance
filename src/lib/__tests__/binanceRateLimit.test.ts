import { FishScanner } from '@/lib/fishScanner';
import { MBI_DEF } from '@/lib/deepDig/features';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { assertBinancePublicAllowed, BINANCE_COOLDOWN_KEY, BinanceRateLimitError, noteBinanceRateLimit, publicRateLimitDeadline, readBinanceCooldown } from '@/lib/binanceRateLimit';
import { fishTransport } from '@/lib/fish/adapters';
import { FishWeightBudget } from '@/lib/fish/shared';
import { clearMarketDataCache, fetchResearchKlines } from '@/lib/deepRsa/marketData';
let now = Date.UTC(2026,9,29,11,30);
beforeEach(()=>{localStorage.clear();clearMarketDataCache();now=Date.UTC(2026,9,29,11,30);vi.spyOn(Date,'now').mockImplementation(()=>now);});
afterEach(()=>{localStorage.clear();vi.restoreAllMocks();});
it('honors full Retry-After seconds, HTTP dates and ban-until evidence without shortening a prior cooldown',()=>{
 const response=(status:number,value:string)=>({status,headers:{get:()=>value}});
 expect(publicRateLimitDeadline(response(429,'180'),undefined,now)).toBe(now+180000);
 expect(publicRateLimitDeadline(response(429,new Date(now+300000).toUTCString()),undefined,now)).toBe(now+300000);
 expect(publicRateLimitDeadline(response(418,''),{msg:`IP banned until ${now+2*86400000}`},now)).toBe(now+2*86400000);
 noteBinanceRateLimit(response(429,'600'));noteBinanceRateLimit(response(429,'60'));
 expect(readBinanceCooldown()?.until).toBe(now+600000);expect(()=>assertBinancePublicAllowed()).toThrow(BinanceRateLimitError);
});
it('shares a real 429 across independent scanners and research, makes no alternate-host request, and allows the same request after expiry',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:429,headers:{'Retry-After':'180'}})).mockImplementation(async()=>new Response(JSON.stringify({serverTime:now})));
 const request=fishTransport('binance',fetcher,new FishWeightBudget()),signal=new AbortController().signal;
 await expect(request('time',1,signal)).rejects.toMatchObject({detail:{status:429,path:'time'}});
 await expect(fishTransport('binance',fetcher,new FishWeightBudget())('time',1,signal)).rejects.toMatchObject({detail:{status:429}});
 const research=vi.fn();await expect(fetchResearchKlines('BTCUSDT',now-300000,now,research)).rejects.toMatchObject({kind:'rate_limit'});
 expect(fetcher).toHaveBeenCalledTimes(1);expect(research).not.toHaveBeenCalled();
 now+=180001;await expect(request('time',1,signal)).resolves.toEqual({serverTime:now});expect(fetcher).toHaveBeenCalledTimes(2);
});
it('research records the first rate response and stops instead of switching hosts or polling through a ban',async()=>{
 const fetcher=vi.fn(async()=>({ok:false,status:418,json:async()=>({msg:`IP banned until ${now+3600000}`})}));
 await expect(fetchResearchKlines('BTCUSDT',now-300000,now,fetcher)).rejects.toMatchObject({kind:'rate_limit'});
 expect(fetcher).toHaveBeenCalledTimes(1);expect(readBinanceCooldown()).toEqual({status:418,until:now+3600000});
});
it('observes another tab’s persisted cooldown, leaves other venues available and honors cancellation before checking limits',async()=>{
 localStorage.setItem(BINANCE_COOLDOWN_KEY,JSON.stringify({status:429,until:now+90000}));
 expect(()=>assertBinancePublicAllowed()).toThrow(/HTTP 429/);
 const fetcher=vi.fn(async()=>new Response('{}'));await fishTransport('gate',fetcher,new FishWeightBudget())('contracts',1,new AbortController().signal);expect(fetcher).toHaveBeenCalledTimes(1);
 const controller=new AbortController();controller.abort();await expect(fishTransport('binance',fetcher,new FishWeightBudget())('time',1,controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(fetcher).toHaveBeenCalledTimes(1);
});

it('aborts a rate-limited venue mid-scan, releases the busy flag and keeps the unfinished anchor retryable',async()=>{
 const signal=new AbortController().signal,market={symbol:'BTCUSDT',instrument:'BTCUSDT',base:'BTC',multiplier:1};
 const fetcher=vi.fn(async(url:string)=>url.includes('/time')?new Response(JSON.stringify({serverTime:now})):new Response('{}',{status:429,headers:{'Retry-After':'180'}}));
 const request=fishTransport('binance',fetcher,new FishWeightBudget()),candles=vi.fn(async()=>await request('klines?symbol=BTCUSDT',5,signal) as never);
 const scanner=new FishScanner(fetcher as never,undefined,undefined,{binance:{exchange:'binance',list:async()=>Array.from({length:10},(_,i)=>({...market,symbol:`COIN${i}USDT`,instrument:`COIN${i}USDT`})),btc:()=>market,candles,taker:async(_m,b)=>b}});
 const result=await scanner.scan({feature:MBI_DEF,algorithm:{statistic:'MBI',direction:'>',threshold:.5,constraints:[]},anchorMs:now,exchanges:['binance'],includeDuplicates:true,signal,onProgress:()=>{},onSignal:()=>{}});
 expect(result.status).toBe('aborted');expect(result.error).toContain('HTTP 429');expect(scanner.isBusy()).toBe(false);expect(candles.mock.calls.length).toBeLessThanOrEqual(3);expect(result.done).toBeLessThan(10);
});
