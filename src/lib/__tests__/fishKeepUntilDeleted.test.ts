// @vitest-environment jsdom
// 【用户要求】2026-10-20「渔部分的鱼只要没删除，就一直保留。我发现有的鱼突然就没了」
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>{const upsert=vi.fn(async()=>({error:null}));const eq=vi.fn(async()=>({data:[] as any[],error:null}));const select=vi.fn(()=>({eq,not:()=>({eq})}));const from=vi.fn(()=>({upsert,select}));return {upsert,eq,select,from};});
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:mocks.from}}));
import {__resetSimStateSyncForTests,hydrateSimState} from '@/lib/simStateSync';
import {loadFishSignals,saveFishSignals,recordFishDeletion,loadFishTombstones,FISH_STORAGE_KEY,FISH_DELETED_KEY} from '@/lib/fishSignals';
import {mergeFishLists,mergeFishTombstones,applyFishTombstones} from '@/lib/fish/tombstones';
import {fishDedupKey,fishVisibleKey} from '@/lib/fish/records';
import type {TradeSignal} from '@/lib/signalLibrary';
const UID='u-1';
const fish=(i:number,extra:Partial<TradeSignal>={}):TradeSignal=>({id:`f${i}`,symbol:`C${i}USDT`,timeMs:1_700_000_000_000+i*60000,timeLabel:'x',fallbackZone:'',fish:{average:1,cbi2:1,startAverage:1,previousAverage:0,cutoffMs:1,threshold:.04,featureId:'cbi2',statistic:'结果',direction:'>',algorithmKey:'k'},...extra});
const symbols=(l:readonly TradeSignal[])=>l.map(s=>s.symbol).sort();
beforeEach(()=>{vi.useFakeTimers();localStorage.clear();__resetSimStateSyncForTests();mocks.upsert.mockClear();mocks.eq.mockReset();});
afterEach(()=>vi.useRealTimers());
it('两份鱼列表取并集：谁也抹不掉谁；同一条鱼本地评分优先、读数取较新的捕获',()=>{
 const local=[fish(1,{quality:4}),fish(2)],remote=[fish(1,{caughtAt:5,fish:{...fish(1).fish!,average:9}}),fish(3)];
 const m=mergeFishLists(local,remote);
 expect(symbols(m)).toEqual(['C1USDT','C2USDT','C3USDT']);
 const one=m.find(s=>s.symbol==='C1USDT')!;expect(one.quality).toBe(4);expect(one.fish?.average).toBe(9);
});
it('删除记号：压住删除前捕到的那条，之后重新捕到的照常保留；记号合并取更晚的',()=>{
 const a=fish(1,{caughtAt:100}),k=fishDedupKey(a);
 expect(applyFishTombstones([a],{[k]:200})).toEqual([]);
 expect(applyFishTombstones([{...a,caughtAt:300}],{[k]:200})).toHaveLength(1);
 expect(applyFishTombstones([fish(2)],{[fishDedupKey(fish(2))]:1})).toEqual([]);
 expect(mergeFishTombstones({[k]:5,x:1},{[k]:9,y:2})).toEqual({[k]:9,y:2,x:1});
 expect(mergeFishLists([a],[a,fish(2)],{[k]:200}).map(s=>s.symbol)).toEqual(['C2USDT']);
});
it('手动删除记下记号；本地读取时被记号压住的鱼不再出现（包括别处的旧副本）',()=>{
 saveFishSignals([fish(1),fish(2)],null);
 recordFishDeletion([fish(1)],UID,1000);
 // 同时按整行显示的内容记一笔（v| 开头），键不同、显示相同的副本也压住（2026-10-21）
 expect(Object.keys(loadFishTombstones()).sort()).toEqual([fishDedupKey(fish(1)),`v|${fishVisibleKey(fish(1))}`].sort());
 localStorage.setItem(FISH_STORAGE_KEY,JSON.stringify([fish(1),fish(2)]));
 expect(symbols(loadFishSignals())).toEqual(['C2USDT']);
});
it('云端水化：另一个浏览器推上来的 30 条不再整份盖掉本地的 162 条；合并结果推回云端；对方删掉的也同步删掉',async()=>{
 const local=Array.from({length:162},(_,i)=>fish(i));
 localStorage.setItem(FISH_STORAGE_KEY,JSON.stringify(local));
 const remote=[...Array.from({length:28},(_,i)=>fish(i)),fish(500),fish(501)];
 const deleted={[fishDedupKey(fish(7))]:Date.now()+1000};
 mocks.eq.mockImplementation(async()=>({data:[{key:'fish_deleted_v1',value:deleted,updated_at:'2099-01-01T00:00:00Z'},{key:'fish_signals_v1',value:remote,updated_at:'2099-01-01T00:00:00Z'}],error:null}));
 const r=await hydrateSimState(UID);expect(r.status).toBe('hydrated');
 const after=loadFishSignals();
 expect(after).toHaveLength(162+2-1);expect(after.some(s=>s.symbol==='C7USDT')).toBe(false);expect(after.some(s=>s.symbol==='C500USDT')).toBe(true);
 expect(localStorage.getItem(FISH_DELETED_KEY)).toContain(fishDedupKey(fish(7)));
 await vi.advanceTimersByTimeAsync(5000);
 const pushed=(mocks.upsert.mock.calls as any[]).map(c=>c[0]).filter(p=>p.key==='fish_signals_v1');
 expect(pushed.length).toBeGreaterThan(0);expect(pushed.at(-1).value.length).toBe(163);
});
