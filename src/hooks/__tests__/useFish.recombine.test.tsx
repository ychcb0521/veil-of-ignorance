// 【用户要求】2026-10-20「并集这里捕捉完之后，我希望当我点击交集的时候，可以灵活切换到交集的结果。另外，无论是交集和并集，只要有结果出现就在新鱼部分马上呈现出来」
import {beforeEach,it,expect,vi} from 'vitest';
import {act,renderHook,waitFor} from '@testing-library/react';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {compileFishProgram} from '@/lib/fish/algorithm';
import {intervalMs} from '@/lib/deepRsa/marketData';
import type {FishDataAdapter} from '@/lib/fish/adapters';
const sessions=vi.hoisted(()=>new Map());
vi.mock('@/lib/fish/session',()=>({saveFishSession:vi.fn(async(owner,value)=>{if(value)sessions.set(owner,value);else sessions.delete(owner);}),loadFishSession:vi.fn(async(owner)=>sessions.get(owner)??null)}));
let candleRequests=0;
const cut=Date.UTC(2026,9,19,3);
const market=(s:string)=>({symbol:s,instrument:s,base:s.replace('USDT',''),multiplier:1});
// AAA：两个算法都命中；EEE：只有算法 1 命中（M 到不了 100.5）；ZZZ：都不命中
let gate:Promise<void>|null=null;
const level:Record<string,number>={AAAUSDT:101,EEEUSDT:100.4,ZZZUSDT:99};
function adapter():FishDataAdapter{return {exchange:'binance',list:vi.fn(async()=>Object.keys(level).map(market)),btc:()=>market('BTCUSDT'),taker:vi.fn(async(_m,x)=>x),candles:vi.fn(async(m,c,_s,q)=>{candleRequests++;if(m.symbol==='ZZZUSDT'&&gate)await gate;return Array.from({length:q.count},(_,i)=>{const t=c-(q.count-i)*intervalMs(q.interval),close=t<cut-5*300000?99:level[m.symbol];return {openTime:t,open:close,close,high:close+1,low:close-1,volume:10,quoteVolume:1000,takerBuyQuoteVolume:600,takerBuyVolume:null};});})};}
vi.mock('@/lib/fishScanner',async original=>{const real=await original<typeof import('@/lib/fishScanner')>();return {...real,FishScanner:class{scan(o:any){return new real.FishScanner(async()=>new Response(JSON.stringify({serverTime:cut+600000})),undefined,undefined,{binance:adapter()}).scan(o);}}};});
const {useFish}=await import('@/hooks/useFish');
const {FISH_STORAGE_KEY}=await import('@/lib/fishSignals');
const def={...CBI2_DEF,id:'price',short:'P',formula:'P = C\nM = avg(C,0.25)\nC',scale:1,unit:''};
const a={statistic:'结果',direction:'>' as const,threshold:100,constraints:[]},b={...a,statistic:'M',threshold:100.5};
const keys=[compileFishProgram(def,a).algorithmKey,compileFishProgram(def,b).algorithmKey];
const old={id:'old',symbol:'OLDUSDT',timeMs:1,timeLabel:'',fallbackZone:'',quality:3,fish:{average:1,cbi2:1,startAverage:1,previousAverage:0,threshold:1,cutoffMs:1,algorithmKey:'old-key'}};
beforeEach(()=>{sessions.clear();candleRequests=0;localStorage.clear();localStorage.setItem(FISH_STORAGE_KEY,JSON.stringify([old]));gate=null;});
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
 // 子集与空集都能切换；无法识别的设置保留当前结果。
 act(()=>{ok=result.current.recombine('and',[keys[0]]);});expect(ok).toBe(true);expect(fresh()).toEqual(['AAAUSDT','EEEUSDT']);
 expect(result.current.signals.find(s=>s.freshCatch)?.fish?.algorithmKey).toBe(keys[0]);
 act(()=>{result.current.recombine('or',[]);});expect(fresh()).toEqual([]);expect(result.current.progress?.counts.hit).toBe(0);
 act(()=>{result.current.recombine('and',keys);});expect(fresh()).toEqual(['AAAUSDT']);
 act(()=>{ok=result.current.recombine('and',['missing']);});expect(ok).toBe(false);expect(fresh()).toEqual(['AAAUSDT']);
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

it('保留未勾选算法的结果；切换组合不取数，评分和删除跨组合保留',async()=>{
 const {result}=renderHook(()=>useFish('round-owner'));
 await act(async()=>{await result.current.start({algorithms:[{feature:def,algorithm:a},{feature:def,algorithm:b}],retainMembers:true,displayAlgorithmKeys:[keys[1]],combination:'and',anchorMs:cut,includeDuplicates:true});});
 const fresh=()=>result.current.signals.filter(s=>s.freshCatch);
 expect(fresh().map(s=>s.symbol)).toEqual(['AAAUSDT']);
 act(()=>{result.current.recombine('and',[keys[0]]);});expect(fresh().map(s=>s.symbol).sort()).toEqual(['AAAUSDT','EEEUSDT']);
 const fetched=candleRequests;
 const aaa=fresh().find(s=>s.symbol==='AAAUSDT')!;
 act(()=>{result.current.commit(result.current.signals.map(s=>s.id===aaa.id?{...s,quality:5}:s));});
 act(()=>{result.current.recombine('or',keys);});
 act(()=>{result.current.recombine('and',[keys[0]]);});expect(fresh().find(s=>s.symbol==='AAAUSDT')?.quality).toBe(5);
 act(()=>{result.current.commit(result.current.signals.filter(s=>s.symbol!=='EEEUSDT'));});
 act(()=>{result.current.recombine('and',[]);});act(()=>{result.current.recombine('and',[keys[0]]);});expect(fresh().map(s=>s.symbol)).toEqual(['AAAUSDT']);expect(candleRequests).toBe(fetched);
});

it('刷新恢复完整结果池，账号隔离；下轮开始替换结果池',async()=>{
 const view=renderHook(({owner})=>useFish(owner),{initialProps:{owner:'alice'}});
 await act(async()=>{await view.result.current.start({algorithms:[{feature:def,algorithm:a},{feature:def,algorithm:b}],retainMembers:true,displayAlgorithmKeys:[keys[1]],combination:'and',anchorMs:cut,includeDuplicates:true});});
 const fetched=candleRequests;view.unmount();
 const restored=renderHook(({owner})=>useFish(owner),{initialProps:{owner:'alice'}});
 await waitFor(()=>expect(restored.result.current.hasRound).toBe(true));
 act(()=>{expect(restored.result.current.recombine('or',keys)).toBe(true);});
 expect(restored.result.current.signals.filter(s=>s.freshCatch).map(s=>s.symbol).sort()).toEqual(['AAAUSDT','EEEUSDT']);expect(candleRequests).toBe(fetched);
 restored.rerender({owner:'bob'});await act(async()=>{});expect(restored.result.current.hasRound).toBe(false);expect(restored.result.current.recombine('and',keys)).toBe(false);
 restored.rerender({owner:'alice'});await waitFor(()=>expect(restored.result.current.hasRound).toBe(true));
 await act(async()=>{await restored.result.current.start({algorithms:[{feature:def,algorithm:b}],retainMembers:true,displayAlgorithmKeys:[],anchorMs:cut,includeDuplicates:true});});
 expect(restored.result.current.progress?.counts.hit).toBe(0);expect(restored.result.current.recombine('and',[keys[0]])).toBe(false);
 act(()=>{expect(restored.result.current.recombine('and',[keys[1]])).toBe(true);});expect(restored.result.current.progress?.counts.hit).toBe(1);
});

// 【用户要求】2026-10-20「捕捉运行完成之后，将区间值调大之后能更细致过滤，而不用再重新运行」
it('扫完把阈值调严：新鱼当场过滤（不取数）；调回原阈值复原；放宽做不到、保留当前结果',async()=>{
 const {result}=renderHook(()=>useFish(undefined));
 await act(async()=>{await result.current.start({feature:def,algorithm:a,anchorMs:cut,includeDuplicates:true});});
 const fresh=()=>result.current.signals.filter(s=>s.freshCatch).map(s=>s.symbol).sort();
 expect(fresh()).toEqual(['AAAUSDT','EEEUSDT']);expect(result.current.roundPlans?.[0].settings.threshold).toBe(100);
 const fetched=candleRequests,at=(threshold:number)=>compileFishProgram(def,{...a,threshold});
 let ok=false;act(()=>{ok=result.current.recombine('and',[at(100.6).algorithmKey],[at(100.6)]);});
 expect(ok).toBe(true);expect(fresh()).toEqual(['AAAUSDT']);expect(result.current.progress?.counts.hit).toBe(1);expect(result.current.progress?.rule).toContain('100.6');
 expect(result.current.signals.find(s=>s.freshCatch)?.fish?.threshold).toBe(100.6);
 act(()=>{ok=result.current.recombine('and',[at(102).algorithmKey],[at(102)]);});expect(ok).toBe(true);expect(fresh()).toEqual([]);
 act(()=>{ok=result.current.recombine('and',[at(99).algorithmKey],[at(99)]);});expect(ok).toBe(false);expect(fresh()).toEqual([]);
 act(()=>{ok=result.current.recombine('and',[at(100).algorithmKey],[at(100)]);});expect(ok).toBe(true);expect(fresh()).toEqual(['AAAUSDT','EEEUSDT']);
 expect(candleRequests).toBe(fetched);
});

// 【用户要求】2026-10-20「渔部分的鱼只要没删除，就一直保留」
it('手动删除记删除记号；其他写入不记',async()=>{
 const {result}=renderHook(()=>useFish(undefined));
 const {loadFishTombstones}=await import('@/lib/fishSignals');
 act(()=>{result.current.commit(result.current.signals.map(s=>({...s,quality:2})));});
 expect(Object.keys(loadFishTombstones())).toEqual([]);
 const id=result.current.signals.find(s=>s.symbol==='OLDUSDT')!.id;
 act(()=>{result.current.remove(id);});
 expect(result.current.signals.find(s=>s.symbol==='OLDUSDT')).toBeUndefined();expect(Object.keys(loadFishTombstones())).toHaveLength(1);
});
