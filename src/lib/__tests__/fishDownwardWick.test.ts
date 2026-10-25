import { beforeEach, expect, it, vi } from 'vitest';
import { checkFishDownwardWick, DEFAULT_FISH_DOWNWARD_WICK as rule, findFishDownwardWick, fishWickCount, readFishDownwardWick, saveFishDownwardWick } from '@/lib/fish/downwardWick';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { FishScanner, deriveFishRound } from '@/lib/fishScanner';
import { CBI2_DEF } from '@/lib/deepDig/features';
import { compileFishProgram } from '@/lib/fish/algorithm';
import { intervalMs } from '@/lib/deepRsa/marketData';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { FishDataAdapter } from '@/lib/fish/adapters';
import type { FishCombinationRound } from '@/lib/fishScanner';

const STEP=300000, cut=Date.UTC(2026,9,23,10), signal=new AbortController().signal;
const bars=():ResearchBar[]=>Array.from({length:fishWickCount(rule)},(_,i)=>({openTime:cut-(fishWickCount(rule)-i)*STEP,open:100,close:100,high:101,low:99,volume:100,quoteVolume:1e6,takerBuyVolume:null}));
const wick=(b:ResearchBar)=>({...b,open:100,close:101,high:102,low:92});
beforeEach(()=>{localStorage.clear();});
it('default enabled, configurable and saved per account; malformed storage falls back',()=>{
 expect(readFishDownwardWick()).toEqual(rule);saveFishDownwardWick({enabled:false,hours:48,atrMultiple:1.5});expect(readFishDownwardWick()).toEqual({enabled:false,hours:48,atrMultiple:1.5});
 localStorage.setItem('sb-test-auth-token',JSON.stringify({user:{id:'other'}}));expect(readFishDownwardWick()).toEqual(rule);
});
it('ordinary bars, small long-tailed dojis and upper wicks pass; a large lower wick fails',()=>{
 const b=bars();expect(findFishDownwardWick(b,cut,rule)).toBeNull();
 b[b.length-2]={...b.at(-2)!,open:100,close:100,high:100,low:99};expect(findFishDownwardWick(b,cut,rule)).toBeNull();
 b[b.length-2]={...b.at(-2)!,open:100,close:101,high:108,low:99};expect(findFishDownwardWick(b,cut,rule)).toBeNull();
 b[b.length-2]=wick(b.at(-2)!);expect(findFishDownwardWick(b,cut,rule)).toMatchObject({openTime:cut-2*STEP,drop:8,atr:2});
});
it('rejects a large red body and a deep excursion even when the old lower-wick ratios fail',()=>{
 const b=bars();
 b[b.length-1]={...b.at(-1)!,open:100,close:92,high:101,low:91};
 expect(findFishDownwardWick(b,cut,rule)).toMatchObject({drop:9,atr:2});
 b[b.length-1]={...wick(b.at(-1)!),high:110};
 expect(findFishDownwardWick(b,cut,rule)).toMatchObject({drop:8,atr:2});
});
it('uses strictly greater than 3 ATR, excluding the current candle from ATR',()=>{
 const b=bars();b[b.length-1]={...b.at(-1)!,open:100,close:94,high:101,low:94};
 expect(findFishDownwardWick(b,cut,rule)).toBeNull();
 b[b.length-1].low=93.999;
 expect(findFishDownwardWick(b,cut,rule)).toMatchObject({atr:2});
 b[b.length-1].low=50;
 expect(findFishDownwardWick(b,cut,rule)).toMatchObject({drop:50,atr:2});
});
it('compares each candle with its own preceding ATR, never with the latest ATR',()=>{
 const b=bars(),index=b.length-20;b[index]=wick(b[index]);
 for(let i=index+1;i<b.length;i++)b[i]={...b[i],high:110,low:99};
 expect(findFishDownwardWick(b,cut,rule)).toMatchObject({openTime:b[index].openTime,drop:8,atr:2});
 const volatile=bars();
 for(let i=volatile.length-15;i<volatile.length-1;i++)volatile[i]={...volatile[i],high:105,low:95};
 volatile[volatile.length-1]=wick(volatile.at(-1)!);
 expect(findFishDownwardWick(volatile,cut,rule)).toBeNull();
});
it('window includes its first closed bar, excludes earlier, current and future bars',()=>{
 const b=bars();b[14]=wick(b[14]);expect(findFishDownwardWick(b,cut,rule)).toBeNull();
 b[15]=wick(b[15]);expect(findFishDownwardWick(b,cut,rule)?.openTime).toBe(cut-48*3600000);
 const plain=bars();expect(findFishDownwardWick([...plain,wick({...plain[0],openTime:cut}),wick({...plain[0],openTime:cut+STEP})],cut,rule)).toBeNull();
});
it('missing/duplicate bars and invalid prices stop the check instead of passing the coin',()=>{
 const b=bars();expect(()=>findFishDownwardWick(b.slice(1),cut,rule)).toThrow();
 expect(()=>findFishDownwardWick([...b.slice(0,-1),b.at(-2)!],cut,rule)).toThrow();
 b[20].low=NaN;expect(()=>findFishDownwardWick(b,cut,rule)).toThrow('OHLC');
});

const coin=(base:string)=>({symbol:`${base}USDT`,instrument:`${base}USDT`,base,multiplier:1});
const feature={...CBI2_DEF,id:'wick-test',formula:'C',scale:1,unit:''};
const algorithm={direction:'>' as const,threshold:100,constraints:[]};
function fixture(missing=false,crashHours=0){
 const adapter:FishDataAdapter={exchange:'binance',list:vi.fn(async()=>[coin('OK'),coin('WICK')]),btc:()=>coin('BTC'),taker:vi.fn(async(_m,b)=>b),candles:vi.fn(async(m,end,_s,q)=>{
  const step=intervalMs(q!.interval);const data:ResearchBar[]=Array.from({length:q!.count},(_,i)=>{const openTime=end-(q!.count-i)*step,close=openTime<cut-5*step?99:101;return {openTime,open:close,close,high:close+1,low:close-1,volume:10,quoteVolume:1e6,takerBuyVolume:null};});
  if(m.base==='WICK'&&q!.interval==='5m'){const at=data.findIndex(b=>b.openTime===cut-(crashHours?crashHours*3600000:2*STEP));if(at>=0)data[at]={...data[at],open:100,close:92,high:101,low:91};}
  return missing&&q!.interval==='5m'?data.slice(1):data;
 })};
 const scanner=new FishScanner(async()=>new Response(JSON.stringify({serverTime:cut+STEP})),undefined,undefined,{binance:adapter});
 return {scanner,adapter};
}
it('single, AND and OR reject the coin; completion count and stricter re-filter cannot revive it',async()=>{
 for(const combination of [undefined,'and','or'] as const){
  const {scanner}=fixture(),hits:string[]=[],members=new Map(),rounds:FishCombinationRound[]=[];
  const p=await scanner.scan({feature,algorithm,anchorMs:cut,includeDuplicates:true,downwardWick:{...rule},...(combination?{algorithms:[{feature,algorithm},{feature,algorithm:{...algorithm,threshold:100.5}}],combination}:{}),signal,onProgress:()=>{},onSignal:s=>hits.push(s.symbol),onResult:(k,r)=>members.set(k,r),onRound:r=>rounds.push(r)});
  expect(hits).toEqual(['OKUSDT']);expect(p.wickSkipped).toBe(1);expect(p.done).toBe(p.total);expect(p.status).toBe('complete');
  if(!combination)expect(members.get('binance|crypto|WICKUSDT')).toEqual({outcome:'wick'});
  const round=rounds.at(-1)!;const strict=deriveFishRound(round,round.plans.map(p=>compileFishProgram(p.def,{...p.settings,threshold:100.8})))!;
  expect(strict.results.get('binance|crypto|WICKUSDT')!.get(0)?.outcome).toBe('wick');
 }
});
it('diagnose shares the rejection rule, and disabling the gate retains former behavior',async()=>{
 const {scanner,adapter}=fixture();const d=await scanner.diagnose({symbol:'WICK',feature,algorithm,anchorMs:cut,downwardWick:{...rule},signal});
 expect(d.outcome).toBe('skipped');expect(d.lines.join(' ')).toContain('向下大插针');
 expect((await scanner.diagnose({symbol:'WICK',feature,algorithm,anchorMs:cut,downwardWick:{...rule,enabled:false},signal})).outcome).toBe('hit');
 vi.mocked(adapter.candles).mockClear();await checkFishDownwardWick(adapter,coin('WICK'),cut,{...rule,enabled:false},signal);expect(adapter.candles).not.toHaveBeenCalled();
});
it('different algorithm periods still inspect the same closed 5m window and share its fetch',async()=>{
 const {scanner,adapter}=fixture(),hits:string[]=[];
 const hourly={...feature,id:'hourly',interval:'1h' as const};
 const p=await scanner.scan({anchorMs:cut,algorithms:[{feature:hourly,algorithm},{feature:{...hourly,id:'hourly2'},algorithm}],combination:'or',downwardWick:{...rule},includeDuplicates:true,signal,onProgress:()=>{},onSignal:s=>hits.push(s.symbol)});
 expect(p.status).toBe('complete');expect(hits).toEqual(['OKUSDT']);
 expect(vi.mocked(adapter.candles).mock.calls.filter(c=>c[3]?.interval==='5m')).toHaveLength(2);
});
it('5m price history unavailable for an hourly algorithm prevents admission and explains why',async()=>{
 const {scanner}=fixture(true),hourly={...feature,interval:'1h' as const};
 const d=await scanner.diagnose({symbol:'WICK',feature:hourly,algorithm,anchorMs:cut,downwardWick:{...rule},signal});
 expect(d.outcome).toBe('history');expect(d.lines.join(' ')).toContain('向下大插针检查失败');
 const hits:string[]=[];const p=await scanner.scan({feature:hourly,algorithm,anchorMs:cut,downwardWick:{...rule},includeDuplicates:true,signal,onProgress:()=>{},onSignal:s=>hits.push(s.symbol)});
 expect(hits).toHaveLength(0);expect(p.history).toBe(2);
});
it('a longer window than the algorithm history is fetched in full even with multiple 5m algorithms',async()=>{
 const {scanner}=fixture(),hits:string[]=[];
 const p=await scanner.scan({anchorMs:cut,algorithms:[{feature,algorithm},{feature:{...feature,id:'same-5m'},algorithm}],combination:'or',downwardWick:{...rule,hours:72},includeDuplicates:true,signal,onProgress:()=>{},onSignal:s=>hits.push(s.symbol)});
 expect(p.status).toBe('complete');expect(p.counts.readings).toBe(0);expect(p.history).toBe(0);expect(p.wickSkipped).toBe(1);expect(hits).toEqual(['OKUSDT']);
});

it('relaxed default keeps medium wicks that the original 2 ATR proposal would exclude',()=>{
 const b=bars();b[b.length-1]={...b.at(-1)!,open:100,close:101,high:102,low:95};
 expect(rule.atrMultiple).toBe(3);expect(findFishDownwardWick(b,cut,rule)).toBeNull();
 expect(findFishDownwardWick(b,cut,{...rule,atrMultiple:2})).not.toBeNull();
});

it('single, AND and OR reject a body-only crash 30h before cutoff',async()=>{
 for(const combination of [undefined,'and','or'] as const){
  const {scanner}=fixture(false,30),hits:string[]=[];
  const settings={feature,algorithm,anchorMs:cut,includeDuplicates:true,downwardWick:readFishDownwardWick(),signal,onProgress:()=>{},onSignal:(s:any)=>hits.push(s.symbol)};
  const p=await scanner.scan({...settings,...(combination?{algorithms:[{feature,algorithm},{feature,algorithm}],combination}:{})});
  expect(p.wickSkipped).toBe(1);expect(hits).toEqual(['OKUSDT']);
 }
});
it('upgrades the old 24h default once and retains later manual choices and account isolation',()=>{
 const prefix=getUserPrefix();
 localStorage.setItem(prefix+'fish-downward-wick.v1',JSON.stringify({enabled:true,hours:24,atrMultiple:3}));
 expect(readFishDownwardWick()).toEqual({enabled:true,hours:48,atrMultiple:3});
 saveFishDownwardWick({enabled:true,hours:24,atrMultiple:3});
 expect(readFishDownwardWick().hours).toBe(24);
 localStorage.setItem('sb-test-auth-token',JSON.stringify({user:{id:'second'}}));
 expect(readFishDownwardWick().hours).toBe(48);
 expect(JSON.parse(localStorage.getItem(prefix+'fish-downward-wick.v1')!).hours).toBe(24);
});
it.each([
 {enabled:false,hours:24,atrMultiple:3},
 {enabled:true,hours:72,atrMultiple:3},
 {enabled:true,hours:24,atrMultiple:1.5},
])('retains customized legacy filter settings %j',(setting)=>{
 localStorage.setItem(getUserPrefix()+'fish-downward-wick.v1',JSON.stringify(setting));
 expect(readFishDownwardWick()).toEqual(setting);
});
it('malformed settings fall back to the 48h / 3 ATR default',()=>{
 localStorage.setItem(getUserPrefix()+'fish-downward-wick.v2','malformed');
 expect(readFishDownwardWick()).toEqual({enabled:true,hours:48,atrMultiple:3});
});
