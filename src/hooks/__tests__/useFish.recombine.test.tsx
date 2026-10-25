// 【用户要求】2026-10-20「并集这里捕捉完之后，我希望当我点击交集的时候，可以灵活切换到交集的结果。另外，无论是交集和并集，只要有结果出现就在新鱼部分马上呈现出来」
import {beforeEach,it,expect,vi} from 'vitest';
import {act,renderHook,waitFor} from '@testing-library/react';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {compileFishProgram} from '@/lib/fish/algorithm';
import {intervalMs} from '@/lib/deepRsa/marketData';
import type {FishDataAdapter} from '@/lib/fish/adapters';
vi.mock('@/lib/simStateSync',()=>({queueSimStatePush:vi.fn()}));
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
it('恢复旧规则的结果时提示重捕，保留已有鱼，也不允许用旧结果重排新规则',async()=>{
 sessions.set(undefined,{needsRescan:'捕捞规则已更新，请重新捕捞',progress:null});
 const {result}=renderHook(()=>useFish(undefined));
 await waitFor(()=>expect(result.current.progress?.notice).toContain('请重新捕捞'));
 expect(result.current.hasRound).toBe(false);
 expect(result.current.progress?.status).toBe('complete');
 expect(result.current.signals).toHaveLength(1);
 expect(result.current.signals[0]).toMatchObject({symbol:'OLDUSDT',timeMs:1,quality:3,fish:{threshold:1,average:1}});
 let reused=true;act(()=>{reused=result.current.recombine('and',keys);});
 expect(reused).toBe(false);expect(candleRequests).toBe(0);
});
it('并集扫完点「交集」：新鱼直接换成交集结果（不重扫），再切回并集也一样；原有的鱼不受影响；切换下来的鱼留在「鱼」里不丢',async()=>{
 const {result}=renderHook(()=>useFish(undefined));
 await act(async()=>{await result.current.start({algorithms:[{feature:def,algorithm:a},{feature:def,algorithm:b}],combination:'or',anchorMs:cut,includeDuplicates:true});});
 const fresh=()=>result.current.signals.filter(s=>s.freshCatch).map(s=>s.symbol).sort();
 expect(fresh()).toEqual(['AAAUSDT','EEEUSDT']);expect(result.current.progress?.counts.hit).toBe(2);
 let ok=false;act(()=>{ok=result.current.recombine('and',keys);});expect(ok).toBe(true);
 expect(fresh()).toEqual(['AAAUSDT']);expect(result.current.progress?.counts.hit).toBe(1);expect(result.current.progress?.rule).toContain(' 且 ');
 // 【用户要求】2026-10-21「鱼那里的数据只要没删除，就一直要保存」：并集口径的两条移进「鱼」，不再从列表拿掉
 const union=()=>result.current.signals.filter(s=>s.fish?.combination==='or');
 expect(union().map(s=>s.symbol).sort()).toEqual(['AAAUSDT','EEEUSDT']);expect(union().every(s=>!s.freshCatch)).toBe(true);
 act(()=>{result.current.recombine('or',keys);});expect(fresh()).toEqual(['AAAUSDT','EEEUSDT']);expect(result.current.progress?.rule).toContain(' 或 ');
 expect(result.current.signals.find(s=>s.symbol==='OLDUSDT')).toMatchObject({quality:3});expect(result.current.signals.find(s=>s.symbol==='OLDUSDT')?.freshCatch).toBeUndefined();
 // 子集与空集都能切换；无法识别的设置保留当前结果。
 act(()=>{ok=result.current.recombine('and',[keys[0]]);});expect(ok).toBe(true);expect(fresh()).toEqual(['AAAUSDT','EEEUSDT']);
 expect(result.current.signals.find(s=>s.freshCatch)?.fish?.algorithmKey).toBe(keys[0]);
 act(()=>{result.current.recombine('or',[]);});expect(fresh()).toEqual([]);expect(result.current.progress?.counts.hit).toBe(0);
 // 切空了也不丢：AAA、EEE 都还在「鱼」里（显示完全相同的副本合并成一条，2026-10-21）
 for(const sym of ['AAAUSDT','EEEUSDT'])expect(result.current.signals.some(s=>s.symbol===sym&&!s.freshCatch)).toBe(true);
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
 expect(result.current.signals.find(s=>s.symbol==='OLDUSDT')).toBeUndefined();expect(Object.keys(loadFishTombstones())).toHaveLength(2); // 算法键 + 整行显示内容（v|）各一笔
});

// 【用户要求】2026-10-21「新鱼只要有更新，都发一次邮件，无论是手动还是自动模式」：每轮结束都交出新鱼列表（变没变由邮件那边比对上一封）；切换组合不交
it('每轮捕捞结束交出这一轮新进列表的鱼和整张新鱼列表；切换交集 / 并集不交',async()=>{
 const onCaught=vi.fn();
 const {result}=renderHook(()=>useFish(undefined,{onCaught}));
 await act(async()=>{await result.current.start({algorithms:[{feature:def,algorithm:a},{feature:def,algorithm:b}],combination:'or',anchorMs:cut,includeDuplicates:true});});
 expect(onCaught).toHaveBeenCalledTimes(1);expect(onCaught.mock.calls[0][0].map((s:any)=>s.symbol).sort()).toEqual(['AAAUSDT','EEEUSDT']);expect(onCaught.mock.calls[0][1].map((s:any)=>s.symbol).sort()).toEqual(['AAAUSDT','EEEUSDT']);
 act(()=>{result.current.recombine('and',keys);});expect(onCaught).toHaveBeenCalledTimes(1);
 // 第二轮：切到交集时并集口径的 AAA、EEE 留在「鱼」里，这轮再捕到不算新进列表；新鱼列表照样交出
 await act(async()=>{await result.current.start({algorithms:[{feature:def,algorithm:a},{feature:def,algorithm:b}],combination:'or',anchorMs:cut,includeDuplicates:true});});
 expect(onCaught).toHaveBeenCalledTimes(2);expect(onCaught.mock.calls[1][0].map((s:any)=>s.symbol).sort()).toEqual(['AAAUSDT','EEEUSDT']);expect(onCaught.mock.calls[1][1].map((s:any)=>s.symbol).sort()).toEqual(['AAAUSDT','EEEUSDT']);
 // 第三轮：没有新进列表的，但新鱼列表照样交出（列表和上一封一样时邮件那边不发）
 await act(async()=>{await result.current.start({algorithms:[{feature:def,algorithm:a},{feature:def,algorithm:b}],combination:'or',anchorMs:cut,includeDuplicates:true});});
 expect(onCaught).toHaveBeenCalledTimes(3);expect(onCaught.mock.calls[2][0].map((s:any)=>s.symbol).sort()).toEqual(['AAAUSDT','EEEUSDT']);expect(onCaught.mock.calls[2][1].map((s:any)=>s.symbol).sort()).toEqual(['AAAUSDT','EEEUSDT']);
});
// 【用户要求】2026-10-21「我希望发邮件时，默认为并集里的鱼」
it('面板选交集时新鱼只有交集结果，邮件那张表仍是本轮并集',async()=>{
 const onCaught=vi.fn();
 const {result}=renderHook(()=>useFish(undefined,{onCaught}));
 await act(async()=>{await result.current.start({algorithms:[{feature:def,algorithm:a},{feature:def,algorithm:b}],combination:'and',anchorMs:cut,includeDuplicates:true});});
 expect(result.current.signals.filter(s=>s.freshCatch).map(s=>s.symbol)).toEqual(['AAAUSDT']);
 expect(onCaught).toHaveBeenCalledTimes(1);expect(onCaught.mock.calls[0][1].map((s:any)=>s.symbol).sort()).toEqual(['AAAUSDT','EEEUSDT']);
 expect(onCaught.mock.calls[0][1].every((s:any)=>s.fish.combination==='or')).toBe(true);
 expect(result.current.unionFish().map(s=>s.symbol).sort()).toEqual(['AAAUSDT','EEEUSDT']);
});
// 【用户要求】2026-10-21「我希望捕捞运行的过程中，我也可以灵活切换到并集」
it('捕捞中切换交集 / 并集：已判完的当场重排，之后的按新组合出，扫完以最后选的为准；切下来的鱼留在「鱼」里',async()=>{
 let release!:()=>void;gate=new Promise<void>(r=>{release=r;});
 const {result}=renderHook(()=>useFish(undefined));let run!:Promise<void>;
 const keysNow=keys;
 act(()=>{run=result.current.start({algorithms:[{feature:def,algorithm:a},{feature:def,algorithm:b}],combination:'and',anchorMs:cut,includeDuplicates:true,retainMembers:true,displayAlgorithmKeys:keysNow});});
 const fresh=()=>result.current.signals.filter(s=>s.freshCatch).map(s=>s.symbol).sort();
 await waitFor(()=>expect(fresh()).toEqual(['AAAUSDT']));expect(result.current.progress?.status).toBe('running');
 let ok=false;act(()=>{ok=result.current.switchLive('or');});expect(ok).toBe(true);
 expect(fresh()).toEqual(['AAAUSDT','EEEUSDT']);expect(result.current.progress?.rule).toContain(' 或 ');expect(result.current.progress?.counts.hit).toBe(2);
 act(()=>{result.current.switchLive('and');});expect(fresh()).toEqual(['AAAUSDT']);
 expect(result.current.signals.some(s=>s.symbol==='EEEUSDT'&&!s.freshCatch)).toBe(true);
 act(()=>{result.current.switchLive('or');});
 await act(async()=>{release();await run;});
 expect(result.current.progress?.status).toBe('complete');expect(fresh()).toEqual(['AAAUSDT','EEEUSDT']);expect(result.current.progress?.rule).toContain(' 或 ');
 // 没在捕捞时不处理（交给 recombine）
 expect(result.current.switchLive('and')).toBe(false);
});

it('每轮开始先把全部新鱼入舱；鱼舱相同行跨轮只留最近一次，刷新后仍保留',async()=>{
 const {loadFishSignals}=await import('@/lib/fishSignals');
 const view=renderHook(()=>useFish(undefined));
 const opts={feature:def,algorithm:a,anchorMs:cut,includeDuplicates:true};
 await act(async()=>{await view.result.current.start(opts);});
 const first=view.result.current.signals.filter(s=>s.freshCatch);
 expect(first.map(s=>s.symbol).sort()).toEqual(['AAAUSDT','EEEUSDT']);
 act(()=>{view.result.current.commit(view.result.current.signals.map(s=>s.symbol==='AAAUSDT'?{...s,quality:5}:s));});
 await act(async()=>{await view.result.current.start(opts);});
 for(const symbol of ['AAAUSDT','EEEUSDT']){
   expect(view.result.current.signals.filter(s=>s.symbol===symbol)).toHaveLength(2);
   expect(view.result.current.signals.filter(s=>s.symbol===symbol&&!s.freshCatch)).toHaveLength(1);
 }
 await act(async()=>{await view.result.current.start(opts);});
 for(const symbol of ['AAAUSDT','EEEUSDT']){
   const rows=view.result.current.signals.filter(s=>s.symbol===symbol);
   expect(rows).toHaveLength(2);expect(rows.filter(s=>s.fishArchive)).toHaveLength(1);
   expect(new Set(rows.map(s=>s.id)).size).toBe(2);
   expect(rows.every(s=>s.fish?.average===first.find(f=>f.symbol===symbol)?.fish?.average)).toBe(true);
 }
 expect(view.result.current.signals.filter(s=>s.symbol==='AAAUSDT').every(s=>s.quality===5)).toBe(true);
 const saved=loadFishSignals();expect(saved).toHaveLength(view.result.current.signals.length);
 view.unmount();const restored=renderHook(()=>useFish(undefined));
 await waitFor(()=>expect(restored.result.current.hasRound).toBe(true));
 expect(restored.result.current.signals).toHaveLength(saved.length);
 expect(restored.result.current.signals.filter(s=>s.fishArchive)).toHaveLength(3);
});
it('新一轮失败或取消时，上一轮的新鱼已经在取数前入舱并持久化',async()=>{
 const {loadFishSignals}=await import('@/lib/fishSignals');
 const {result}=renderHook(()=>useFish(undefined));
 await act(async()=>{await result.current.start({feature:def,algorithm:a,anchorMs:cut,includeDuplicates:true});});
 const previous=result.current.signals.filter(s=>s.freshCatch).map(s=>s.symbol).sort();
 let release!:()=>void;gate=new Promise<void>(r=>{release=r;});
 let run!:Promise<void>;
 act(()=>{run=result.current.start({feature:def,algorithm:{...a,threshold:1000},anchorMs:cut,includeDuplicates:true});});
 await waitFor(()=>expect(result.current.progress?.status).toBe('running'));
 expect(loadFishSignals().filter(s=>s.fishArchive&&previous.includes(s.symbol)).map(s=>s.symbol).sort()).toEqual(previous);
 act(()=>result.current.cancel());await act(async()=>{release();await run;});
 expect(result.current.signals.filter(s=>s.freshCatch)).toHaveLength(0);
 expect(loadFishSignals().filter(s=>previous.includes(s.symbol)).map(s=>s.symbol).sort()).toEqual(previous);
 await act(async()=>{await result.current.start({feature:def,algorithm:{...a,threshold:NaN},anchorMs:cut});});
 expect(loadFishSignals().filter(s=>previous.includes(s.symbol))).toHaveLength(previous.length);
});
it('localStorage 写满时立即入舱，仍然发起并完成新一轮捕捞',async()=>{
 const storage=await import('@/lib/fishSignals');
 const persisted=await import('@/lib/persistedStateStorage');
 const {result}=renderHook(()=>useFish(undefined));
 await act(async()=>{await result.current.start({feature:def,algorithm:a,anchorMs:cut,includeDuplicates:true});});
 const previous=result.current.signals.filter(s=>s.freshCatch),requests=candleRequests;
 const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('full','QuotaExceededError');});
 let release!:()=>void;gate=new Promise<void>(r=>{release=r;});let run!:Promise<void>;
 try {
  act(()=>{run=result.current.start({feature:def,algorithm:a,anchorMs:cut,includeDuplicates:true});});
  // Before any market response, every previous fresh catch is already in the cabin.
  for(const fish of previous)expect(result.current.signals.some(s=>s.fishArchive&&s.symbol===fish.symbol&&!s.freshCatch)).toBe(true);
  await waitFor(()=>expect(candleRequests).toBeGreaterThan(requests));
  expect(result.current.progress?.status).toBe('running');expect(result.current.progress?.error).toBeFalsy();
  await act(async()=>{release();await run;});
  expect(result.current.progress?.status).toBe('complete');
  expect(result.current.signals.filter(s=>s.freshCatch)).toHaveLength(previous.length);
  for(const fish of previous)expect(result.current.signals.some(s=>s.fishArchive&&s.symbol===fish.symbol)).toBe(true);
  expect(storage.loadFishSignals()).toEqual(result.current.signals);
 } finally {write.mockRestore();persisted.clearPersistedStateMemoryForTests();}
});
it('启动不等待旧鱼舱恢复；迟到的旧鱼入舱，正在捕捞的新鱼仍留在本轮',async()=>{
 const store=await import('@/lib/fish/libraryStore');
 let recover!:(value:import('@/lib/fish/libraryStore').FishLibraryBackup)=>void;
 const load=vi.spyOn(store,'loadFishLibraryBackup').mockImplementationOnce(()=>new Promise(r=>{recover=r;}));
 let release!:()=>void;gate=new Promise<void>(r=>{release=r;});
 const {result}=renderHook(()=>useFish('alice'));let run!:Promise<void>;
 try {
  act(()=>{run=result.current.start({feature:def,algorithm:a,anchorMs:cut,includeDuplicates:true});});
  await waitFor(()=>expect(result.current.signals.some(s=>s.freshCatch)).toBe(true));
  const fresh=result.current.signals.filter(s=>s.freshCatch).map(s=>s.symbol).sort();
  await act(async()=>recover({signals:[{...old,freshCatch:true},{...old,id:'late',symbol:'LATEUSDT',freshCatch:true,caughtAt:100}],tombstones:{}}));
  expect(result.current.progress?.status).toBe('running');
  expect(result.current.signals.filter(s=>s.freshCatch).map(s=>s.symbol).sort()).toEqual(fresh);
  expect(result.current.signals.filter(s=>s.symbol==='OLDUSDT')).toHaveLength(1);
  expect(result.current.signals.find(s=>s.symbol==='LATEUSDT')).toMatchObject({fishArchive:{at:expect.any(Number)}});
  await act(async()=>{release();await run;});expect(result.current.progress?.status).toBe('complete');
 } finally {load.mockRestore();}
});
it('切换账号后忽略上个账号迟到的鱼舱恢复',async()=>{
 const store=await import('@/lib/fish/libraryStore');
 let recover!:(value:import('@/lib/fish/libraryStore').FishLibraryBackup)=>void;
 const load=vi.spyOn(store,'loadFishLibraryBackup').mockImplementationOnce(()=>new Promise(r=>{recover=r;}));
 const view=renderHook(({owner})=>useFish(owner),{initialProps:{owner:'alice'}});
 try {
  view.rerender({owner:'bob'});await act(async()=>{});
  await act(async()=>recover({signals:[{...old,id:'alice-only',symbol:'ALICEUSDT'}],tombstones:{}}));
  expect(view.result.current.signals.some(s=>s.symbol==='ALICEUSDT')).toBe(false);
  expect(JSON.parse(localStorage.getItem(FISH_STORAGE_KEY)??'[]').some((s:any)=>s.symbol==='ALICEUSDT')).toBe(false);
 } finally {load.mockRestore();}
});
