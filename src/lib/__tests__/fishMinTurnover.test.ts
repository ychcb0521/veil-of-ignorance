// 【用户要求】2026-10-20「渔部分，鱼的最低交易量标准是 24h 内不得低于 1000w USDT」
import {it,expect,vi} from 'vitest';
import {FishScanner} from '@/lib/fishScanner';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {intervalMs} from '@/lib/deepRsa/marketData';
import {fishTurnover24h,FISH_MIN_TURNOVER} from '@/lib/fish/shared';
import type {FishDataAdapter} from '@/lib/fish/adapters';
import type {FishMarket} from '@/lib/fish/exchanges';
const cut=Date.UTC(2026,3,9,15),STEP=300000;
const m=(base:string):FishMarket=>({symbol:`${base}USDT`,instrument:`${base}USDT`,base,multiplier:1});
// BTC 每根 100 万，照常命中。每根 5m 的成交额：BIG 24h = 288 × 50000 = 1440 万；EDGE 1000.02 万（刚过线）；THIN 288 万
const perBar:Record<string,number>={BIG:50000,EDGE:34723,THIN:10000};
const adapter=():FishDataAdapter=>({exchange:'binance',list:vi.fn(async()=>[...Object.keys(perBar).map(m),m('BTC')]),btc:()=>m('BTC'),taker:vi.fn(async(_m,b)=>b),candles:vi.fn(async(mk,c,_s,q)=>Array.from({length:q!.count},(_,i)=>{const t=c-(q!.count-i)*intervalMs(q!.interval),close=t<c-5*STEP?99:101;return {openTime:t,open:close,close,high:close+1,low:close-1,volume:10,quoteVolume:perBar[mk.base]??1e6,takerBuyQuoteVolume:600,takerBuyVolume:null};}))});
const fetcher=vi.fn(async()=>new Response(JSON.stringify({serverTime:cut+600000}))) as unknown as typeof fetch;
const def={...CBI2_DEF,id:'p',short:'P',formula:'C',scale:1,unit:''},a={direction:'>' as const,threshold:100,constraints:[]};
const scan=async(extra:object)=>{const hits:any[]=[],res=new Map<string,any>();const p=await new FishScanner(fetcher,undefined,undefined,{binance:adapter()}).scan({feature:def,algorithm:a,anchorMs:cut,includeDuplicates:true,signal:new AbortController().signal,onProgress:()=>{},onSignal:s=>hits.push(s.symbol),onResult:(k,r)=>res.set(k,r),...extra});return {p,hits:hits.filter(h=>h!=='BTCUSDT').sort(),res};};
it('24h 成交额 = 截止前 24 小时的 K 线成交额之和；缺一根返回 null',()=>{
 const bars=Array.from({length:300},(_,i)=>({openTime:cut-(300-i)*STEP,quoteVolume:1} as any));
 expect(fishTurnover24h(bars,cut)).toBe(288);expect(fishTurnover24h([...bars.slice(0,-1),{openTime:cut-STEP,quoteVolume:null} as any],cut)).toBeNull();
});
it('成交额不足 1000 万的币跳过、不判定、成不了鱼；刚过 1000 万算够；不设下限时照旧',async()=>{
 const free=await scan({});expect(free.hits).toEqual(['BIGUSDT','EDGEUSDT','THINUSDT']);
 const gated=await scan({minTurnover:FISH_MIN_TURNOVER});
 expect(gated.hits).toEqual(['BIGUSDT','EDGEUSDT']);expect(gated.p.thin).toBe(1);expect(gated.p.counts.hit).toBe(3);expect(gated.p.done).toBe(gated.p.total);
 expect(gated.res.get('binance|crypto|THINUSDT')).toEqual({outcome:'thin'});
});
it('交集 / 并集：成交额不足的币在每个算法里都跳过，两种合并都不出；查单个币写明原因',async()=>{
 const b={...a,threshold:100.5};
 for(const combination of ['and','or'] as const){const r=await scan({algorithms:[{feature:def,algorithm:a},{feature:def,algorithm:b}],combination,minTurnover:FISH_MIN_TURNOVER});expect(r.hits).not.toContain('THINUSDT');expect(r.hits).toContain('BIGUSDT');}
 const d=await new FishScanner(fetcher,undefined,undefined,{binance:adapter()}).diagnose({symbol:'THIN',feature:def,algorithm:a,anchorMs:cut,minTurnover:FISH_MIN_TURNOVER,signal:new AbortController().signal});
 expect(d.outcome).toBe('skipped');expect(d.lines.at(-1)).toContain('288 万 USDT，低于 1000 万');
});
