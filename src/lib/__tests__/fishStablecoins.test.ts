// 【用户要求】2026-10-20「算法捕捉的标的要排除那些没有短线交易价值的稳定币，比如 USDT、USDC 等等」
import {it,expect,vi} from 'vitest';
import {selectFishMarkets,isFishStablecoin,type FishMarket} from '@/lib/fish/exchanges';
import {FishScanner} from '@/lib/fishScanner';
import {compileFishProgram} from '@/lib/fish/algorithm';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {intervalMs} from '@/lib/deepRsa/marketData';
import type {FishDataAdapter} from '@/lib/fish/adapters';
const m=(base:string,extra:Partial<FishMarket>={}):FishMarket=>({symbol:`${base}USDT`,instrument:`${base}USDT`,base,multiplier:1,...extra});
it('稳定币按基础币名精确排除；美股、脱锚币、名字里含 USD 的普通币不受影响',()=>{
 for(const b of ['USDC','FDUSD','TUSD','USDE','USD1','RLUSD','DAI','EURC','usdc'])expect(isFishStablecoin(b)).toBe(true);
 for(const b of ['BTC','USTC','USUAL','PAXG','XAUT','SUSHI','DUSK'])expect(isFishStablecoin(b)).toBe(false);
 const universes={binance:[m('USDC'),m('BTC'),m('FDUSD'),m('USUAL'),m('USDE',{market:'us_stock',underlying:'USDE'})],okx:[m('TUSD'),m('ETH')]};
 for(const dup of [false,true]){
  expect(selectFishMarkets('binance',universes,dup).map(x=>x.base)).toEqual(['BTC','USUAL','USDE']);
  expect(selectFishMarkets('okx',universes,dup).map(x=>x.base)).toEqual(['ETH']);
 }
});
it('捕捞不取稳定币的 K 线、不算进总数；查单个币直接说明已排除',async()=>{
 const cut=Date.UTC(2026,3,9,15),bases=['AAA','USDC','FDUSD','BBB'];
 const adapter:FishDataAdapter={exchange:'binance',list:vi.fn(async()=>[...bases.map(b=>m(b)),m('BTC')]),btc:()=>m('BTC'),taker:vi.fn(async(_m,b)=>b),candles:vi.fn(async(_mk,c,_s,q)=>Array.from({length:q!.count},(_,i)=>{const t=c-(q!.count-i)*intervalMs(q!.interval),close=100;return {openTime:t,open:close,close,high:close+1,low:close-1,volume:10,quoteVolume:1000,takerBuyQuoteVolume:600,takerBuyVolume:null};}))};
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({serverTime:cut+600000}))) as unknown as typeof fetch;
 const def={...CBI2_DEF,id:'p',short:'P',formula:'C',scale:1,unit:''},algorithm={direction:'>' as const,threshold:0,constraints:[]};
 compileFishProgram(def,algorithm);
 const scanner=new FishScanner(fetcher,undefined,undefined,{binance:adapter});
 const p=await scanner.scan({feature:def,algorithm,anchorMs:cut,includeDuplicates:true,signal:new AbortController().signal,onProgress:()=>{},onSignal:()=>{}});
 const asked=(adapter.candles as any).mock.calls.map((c:any)=>c[0].base);
 expect(asked).not.toContain('USDC');expect(asked).not.toContain('FDUSD');expect(asked).toEqual(expect.arrayContaining(['AAA','BBB']));
 expect(p.total).toBe(3);
 const d=await scanner.diagnose({symbol:'usdcusdt',feature:def,algorithm,anchorMs:cut,signal:new AbortController().signal});
 expect(d.outcome).toBe('skipped');expect(d.lines[0]).toContain('USDC 是稳定币');
});
