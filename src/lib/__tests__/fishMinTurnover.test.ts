// 【用户要求】2026-10-20「渔部分，鱼的最低交易量标准是 1h 内不得低于 100w USDT，且 12h 内不得低于 800w USDT」
import {it,expect,vi} from 'vitest';
import {FishScanner} from '@/lib/fishScanner';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {intervalMs} from '@/lib/deepRsa/marketData';
import {fishTurnoverWithin,fishTurnoverCheck,describeTurnoverMiss,FISH_TURNOVER_FLOORS} from '@/lib/fish/shared';
import type {FishDataAdapter} from '@/lib/fish/adapters';
import type {FishMarket} from '@/lib/fish/exchanges';
const cut=Date.UTC(2026,3,9,15),STEP=300000,HOUR=3600000;
const m=(base:string):FishMarket=>({symbol:`${base}USDT`,instrument:`${base}USDT`,base,multiplier:1});
// 每根 5m 成交额：最后 1 小时（12 根）与之前分开设。
// OK：1h 120 万、12h 120+11×90=1110 万 → 达标；LOW1H：1h 60 万、12h 很高 → 1h 不够；LOW12H：1h 120 万、12h 120+11×50=670 万 → 12h 不够
const vol:Record<string,{last:number;before:number}>={OK:{last:1e5,before:75000},LOW1H:{last:5e4,before:5e5},LOW12H:{last:1e5,before:41667}};
const adapter=():FishDataAdapter=>({exchange:'binance',list:vi.fn(async()=>[...Object.keys(vol).map(m),m('BTC')]),btc:()=>m('BTC'),taker:vi.fn(async(_m,b)=>b),candles:vi.fn(async(mk,c,_s,q)=>Array.from({length:q!.count},(_,i)=>{const t=c-(q!.count-i)*intervalMs(q!.interval),close=t<c-5*STEP?99:101,v=vol[mk.base];return {openTime:t,open:close,close,high:close+1,low:close-1,volume:10,quoteVolume:v?(t>=c-HOUR?v.last:v.before):1e7,takerBuyQuoteVolume:600,takerBuyVolume:null};}))});
const fetcher=vi.fn(async()=>new Response(JSON.stringify({serverTime:cut+600000}))) as unknown as typeof fetch;
const def={...CBI2_DEF,id:'p',short:'P',formula:'C',scale:1,unit:''},a={direction:'>' as const,threshold:100,constraints:[]};
const scan=async(extra:object)=>{const hits:any[]=[],res=new Map<string,any>();const p=await new FishScanner(fetcher,undefined,undefined,{binance:adapter()}).scan({feature:def,algorithm:a,anchorMs:cut,includeDuplicates:true,signal:new AbortController().signal,onProgress:()=>{},onSignal:s=>hits.push(s.symbol),onResult:(k,r)=>res.set(k,r),...extra});return {p,hits:hits.filter(h=>h!=='BTCUSDT').sort(),res};};
it('门槛是 1h ≥ 100 万且 12h ≥ 800 万',()=>{expect(FISH_TURNOVER_FLOORS).toEqual([{hours:1,min:1e6},{hours:12,min:8e6}]);});
it('N 小时成交额 = 截止前 N 小时的 K 线之和；周期长于窗口时按比例折算；缺一根返回 null',()=>{
 const bars=Array.from({length:300},(_,i)=>({openTime:cut-(300-i)*STEP,quoteVolume:1} as any));
 expect(fishTurnoverWithin(bars,cut,1,STEP)).toBe(12);expect(fishTurnoverWithin(bars,cut,12,STEP)).toBe(144);
 const fourHour=[{openTime:cut-8*HOUR,quoteVolume:400},{openTime:cut-4*HOUR,quoteVolume:800}] as any;
 expect(fishTurnoverWithin(fourHour,cut,1,4*HOUR)).toBe(200);expect(fishTurnoverWithin(fourHour,cut,6,4*HOUR)).toBe(1000);
 expect(fishTurnoverWithin([...bars.slice(0,-1),{openTime:cut-STEP,quoteVolume:null} as any],cut,1,STEP)).toBeNull();
 const checks=fishTurnoverCheck(bars.map((b:any)=>({...b,quoteVolume:5e4})),cut,STEP,FISH_TURNOVER_FLOORS)!;
 expect(checks.map(c=>c.ok)).toEqual([false,false]);expect(describeTurnoverMiss(checks)).toBe('1h 成交额 60 万 < 100 万，12h 成交额 720 万 < 800 万');
});
it('任一条不够就跳过、不判定、成不了鱼；两条都够才判定；不设门槛时照旧',async()=>{
 expect((await scan({})).hits).toEqual(['LOW12HUSDT','LOW1HUSDT','OKUSDT']);
 const gated=await scan({turnoverFloors:FISH_TURNOVER_FLOORS});
 expect(gated.hits).toEqual(['OKUSDT']);expect(gated.p.thin).toBe(2);expect(gated.p.done).toBe(gated.p.total);
 expect(gated.res.get('binance|crypto|LOW1HUSDT')).toEqual({outcome:'thin'});expect(gated.res.get('binance|crypto|LOW12HUSDT')).toEqual({outcome:'thin'});
});
it('交集 / 并集都不出不达标的币；查单个币写明哪一条没达标',async()=>{
 const b={...a,threshold:100.5};
 for(const combination of ['and','or'] as const){const r=await scan({algorithms:[{feature:def,algorithm:a},{feature:def,algorithm:b}],combination,turnoverFloors:FISH_TURNOVER_FLOORS});expect(r.hits).toEqual(['OKUSDT']);}
 const d=await new FishScanner(fetcher,undefined,undefined,{binance:adapter()}).diagnose({symbol:'LOW12H',feature:def,algorithm:a,anchorMs:cut,turnoverFloors:FISH_TURNOVER_FLOORS,signal:new AbortController().signal});
 expect(d.outcome).toBe('skipped');expect(d.lines.at(-1)).toContain('12h 成交额');expect(d.lines.at(-1)).toContain('< 800 万');expect(d.lines.at(-1)).not.toContain('1h 成交额 120');
});
