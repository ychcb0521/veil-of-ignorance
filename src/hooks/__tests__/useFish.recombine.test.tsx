// 【用户要求】2026-10-20「并集这里捕捉完之后，我希望当我点击交集的时候，可以灵活切换到交集的结果。另外，无论是交集和并集，只要有结果出现就在新鱼部分马上呈现出来」
import {beforeEach,it,expect,vi} from 'vitest';
import {act,renderHook,waitFor} from '@testing-library/react';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {compileFishProgram} from '@/lib/fish/algorithm';
import {intervalMs} from '@/lib/deepRsa/marketData';
import type {FishDataAdapter} from '@/lib/fish/adapters';
const cut=Date.UTC(2026,9,19,3);
const market=(s:string)=>({symbol:s,instrument:s,base:s.replace('USDT',''),multiplier:1});
// AAA：两个算法都命中；EEE：只有算法 1 命中（M 到不了 100.5）；ZZZ：都不命中
let gate:Promise<void>|null=null;
const level:Record<string,number>={AAAUSDT:101,EEEUSDT:100.4,ZZZUSDT:99};
function adapter():FishDataAdapter{return {exchange:'binance',list:vi.fn(async()=>Object.keys(level).map(market)),btc:()=>market('BTCUSDT'),taker:vi.fn(async(_m,x)=>x),candles:vi.fn(async(m,c,_s,q)=>{if(m.symbol==='ZZZUSDT'&&gate)await gate;return Array.from({length:q.count},(_,i)=>{const t=c-(q.count-i)*intervalMs(q.interval),close=t<cut-5*300000?99:level[m.symbol];return {openTime:t,open:close,close,high:close+1,low:close-1,volume:10,quoteVolume:1000,takerBuyQuoteVolume:600,takerBuyVolume:null};});})};}
vi.mock('@/lib/fishScanner',async original=>{const real=await original<typeof import('@/lib/fishScanner')>();return {...real,FishScanner:class{scan(o:any){return new real.FishScanner(async()=>new Response(JSON.stringify({serverTime:cut+600000})),undefined,undefined,{binance:adapter()}).scan(o);}}};});
const {useFish}=await import('@/hooks/useFish');
const {FISH_STORAGE_KEY}=await import('@/lib/fishSignals');
const def={...CBI2_DEF,id:'price',short:'P',formula:'P = C\nM = avg(C,0.25)\nC',scale:1,unit:''};
const a={statistic:'结果',direction:'>' as const,threshold:100,constraints:[]},b={...a,statistic:'M',threshold:100.5};
const keys=[compileFishProgram(def,a).algorithmKey,compileFishProgram(def,b).algorithmKey];
const old={id:'old',symbol:'OLDUSDT',timeMs:1,timeLabel:'',fallbackZone:'',quality:3,fish:{average:1,cbi2:1,startAverage:1,previousAverage:0,threshold:1,cutoffMs:1,algorithmKey:'old-key'}};
beforeEach(()=>{localStorage.clear();localStorage.setItem(FISH_STORAGE_KEY,JSON.stringify([old]));gate=null;});
it('并集扫完点「交集」：新鱼直接换成交集结果（不重扫），再切回并集也一样；原有的鱼不受影响',async()=>{
 const {result}=renderHook(()=>useFish(undefined));
 await act(async()=>{await result.current.start({algorithms:[{feature:def,algorithm:a},{feature:def,algorithm:b}],combination:'or',anchorMs:cut,includeDuplicates:true});});
 const fresh=()=>result.current.signals.filter(s=>s.freshCatch).map(s=>s.symbol).sort();
 expect(fresh()).toEqual(['AAAUSDT','EEEUSDT']);expect(result.current.progress?.counts.hit).toBe(2);
 let ok=false;act(()=>{ok=result.current.recombine('and',keys);});expect(ok).toBe(true);
 expect(fresh()).toEqual(['AAAUSDT']);expect(result.current.progress?.counts.hit).toBe(1);expect(result.current.progress?.rule).toContain(' 且 ');
 expect(result.current.signals.filter(s=>s.fish?.combination==='or')).toHaveLength(0);
 act(()=>{result.current.recombine('or',keys);});expect(fresh()).toEqual(['AAAUSDT','EEEUSDT']);expect(result.current.progress?.rule).toContain(' 或 ');
 expect(result.current.signals.find(s=>s.symbol==='OLDUSDT')).toMatchObject({quality:3});expect(result.current.signals.find(s=>s.symbol==='OLDUSDT')?.freshCatch).toBeUndefined();
 // 算法设置变了：不切换
 act(()=>{ok=result.current.recombine('and',[keys[0]]);});expect(ok).toBe(false);expect(fresh()).toEqual(['AAAUSDT','EEEUSDT']);
});
it('交集 / 并集的结果边扫边进「新鱼」，不等全部扫完',async()=>{
 let release!:()=>void;gate=new Promise<void>(r=>{release=r;});
 const {result}=renderHook(()=>useFish(undefined));let run!:Promise<void>;
 act(()=>{run=result.current.start({algorithms:[{feature:def,algorithm:a},{feature:def,algorithm:b}],combination:'and',anchorMs:cut,includeDuplicates:true});});
 // ZZZ 还卡着没扫完，AAA 已经出现在新鱼里
 await waitFor(()=>expect(result.current.signals.filter(s=>s.freshCatch).map(s=>s.symbol)).toEqual(['AAAUSDT']));
 expect(result.current.progress?.status).toBe('running');
 await act(async()=>{release();await run;});expect(result.current.progress?.status).toBe('complete');
});
