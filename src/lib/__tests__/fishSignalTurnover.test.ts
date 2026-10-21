// 【用户要求】2026-10-21「捕捉到的一些标的存在 24 小时交易额小于 1000w USDT 的，是什么原因？请你想办法解决」
// 原因：门槛只查截止前；起点之后才放量的币，截止前达标、信号起点前不达标，回放到信号时刻盘口 24h 成交额不到 1000 万。
import {it,expect,vi} from 'vitest';
import {FishScanner} from '@/lib/fishScanner';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {intervalMs} from '@/lib/deepRsa/marketData';
import {compileFishProgram} from '@/lib/fish/algorithm';
import {tightenFishResult} from '@/lib/fish/refilter';
import {FISH_TURNOVER_FLOORS} from '@/lib/fish/shared';
import type {FishDataAdapter} from '@/lib/fish/adapters';
import type {FishMarket} from '@/lib/fish/exchanges';
const cut=Date.UTC(2026,3,9,15),STEP=300000;
const m=(base:string):FishMarket=>({symbol:`${base}USDT`,instrument:`${base}USDT`,base,multiplier:1});
// 收盘价：最后 5 根 101、最后 2 根 102，更早 99 → 阈值 100 时起点在截止前 4 根收盘处，阈值 101.5 时在截止前 1 根。
// LATE：最后 4 根每根 500 万，更早每根 1000 → 截止前三项都达标，阈值 100 的起点前 1h 只有 1.2 万。
// STEADY：每根 10 万 → 起点前、截止前都达标。
const quote:Record<string,(t:number)=>number>={LATE:t=>t>=cut-4*STEP?5e6:1000,STEADY:()=>1e5};
const adapter=():FishDataAdapter=>({exchange:'binance',list:vi.fn(async()=>[...Object.keys(quote).map(m),m('BTC')]),btc:()=>m('BTC'),taker:vi.fn(async(_m,b)=>b),
 candles:vi.fn(async(mk,c,_s,q)=>Array.from({length:q!.count},(_,i)=>{const t=c-(q!.count-i)*intervalMs(q!.interval),close=t>=c-2*STEP?102:t>=c-5*STEP?101:99;return {openTime:t,open:close,close,high:close+1,low:close-1,volume:10,quoteVolume:quote[mk.base]?.(t)??1e7,takerBuyQuoteVolume:600,takerBuyVolume:null};}))});
const fetcher=vi.fn(async()=>new Response(JSON.stringify({serverTime:cut+600000}))) as unknown as typeof fetch;
const def={...CBI2_DEF,id:'p',short:'P',formula:'C',scale:1,unit:''},a={direction:'>' as const,threshold:100,constraints:[]};
const scan=async(extra:object={})=>{const hits:any[]=[],res=new Map<string,any>();const p=await new FishScanner(fetcher,undefined,undefined,{binance:adapter()}).scan({feature:def,algorithm:a,anchorMs:cut,includeDuplicates:true,turnoverFloors:FISH_TURNOVER_FLOORS,signal:new AbortController().signal,onProgress:()=>{},onSignal:s=>hits.push(s),onResult:(k,r)=>res.set(k,r),...extra});return {p,hits:hits.filter(h=>h.symbol!=='BTCUSDT'),res};};

it('截止前达标、信号起点前不达标的币成不了鱼；两处都达标的照常成鱼',async()=>{
 const r=await scan();
 expect(r.hits.map(h=>h.symbol)).toEqual(['STEADYUSDT']);
 expect(r.hits[0].timeMs).toBe(cut-4*STEP);
 expect(r.p.thin).toBe(1);expect(r.p.done).toBe(r.p.total);
 expect(r.res.get('binance|crypto|LATEUSDT').outcome).toBe('thin');
});
it('交集、并集同样不出这条',async()=>{
 const b={...a,threshold:100.5};
 for(const combination of ['and','or'] as const){const r=await scan({algorithms:[{feature:def,algorithm:a},{feature:def,algorithm:b}],combination});expect(r.hits.map(h=>h.symbol)).toEqual(['STEADYUSDT']);}
});
it('阈值调严后起点挪到放量之后：重判时按新起点再查，达标就成鱼；不达标的仍然不成',async()=>{
 const r=await scan(),late=r.res.get('binance|crypto|LATEUSDT'),steady=r.res.get('binance|crypto|STEADYUSDT');
 expect(late.tail?.floors).toEqual(FISH_TURNOVER_FLOORS);
 const strict=compileFishProgram(def,{...a,threshold:101.5});
 const t=tightenFishResult(late,strict)!;
 expect(t.outcome).toBe('hit');expect(t.signal!.timeMs).toBe(cut-STEP);
 // 只调到 100.5：起点不动，仍不达标
 expect(tightenFishResult(late,compileFishProgram(def,{...a,threshold:100.5}))!.outcome).toBe('thin');
 expect(tightenFishResult(steady,strict)!.outcome).toBe('hit');
});
it('查单个币写明是信号前成交额不够',async()=>{
 const d=await new FishScanner(fetcher,undefined,undefined,{binance:adapter()}).diagnose({symbol:'LATE',feature:def,algorithm:a,anchorMs:cut,turnoverFloors:FISH_TURNOVER_FLOORS,signal:new AbortController().signal});
 expect(d.outcome).toBe('skipped');expect(d.lines.at(-1)).toContain('信号前1h 成交额');expect(d.lines.at(-1)).toContain('起点之后才放量');
});
