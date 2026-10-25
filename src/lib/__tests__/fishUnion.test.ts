// 【用户要求】2026-10-19「多重选择除了交集，再增加一种并集（即，只要符合其中一个算法的，都留下）」
import {it,expect,vi} from 'vitest';
import {FishScanner} from '@/lib/fishScanner';
import {compileFishProgram} from '@/lib/fish/algorithm';
import {unionFishResults,fishCombinationKey} from '@/lib/fish/intersection';
import {fishAlgorithmShort,fishDedupKey,mergeFishSignals} from '@/lib/fish/records';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {intervalMs} from '@/lib/deepRsa/marketData';
import type {FishDataAdapter} from '@/lib/fish/adapters';
const cut=Date.UTC(2026,9,19,3),signal=new AbortController().signal;
const def={...CBI2_DEF,id:'price',short:'C',formula:'P = C\nM = avg(C,0.25)\nC',scale:1,unit:'USDT'};
const a={statistic:'结果',direction:'>' as const,threshold:100,constraints:[]};
const b={...a,statistic:'M',threshold:100.5};
const never={...a,threshold:1000};
const plan=compileFishProgram(def,a),planB=compileFishProgram(def,b);
const market={symbol:'AAAUSDT',instrument:'AAAUSDT',base:'AAA',multiplier:1};
function setup(){const candles=vi.fn(async(_m:any,c:number,_s:AbortSignal,q:any)=>Array.from({length:q.count},(_,i)=>{const step=intervalMs(q.interval),t=c-(q.count-i)*step;const close=t<cut-5*300000?99:101;return {openTime:t,open:close,close,high:close+1,low:close-1,volume:10,quoteVolume:1000,takerBuyQuoteVolume:600,takerBuyVolume:null};}));const adapter:FishDataAdapter={exchange:'binance',list:vi.fn(async()=>[market]),btc:()=>({...market,symbol:'BTCUSDT',instrument:'BTCUSDT',base:'BTC'}),candles,taker:vi.fn(async(_m,b)=>b)};const scanner=new FishScanner(vi.fn(async()=>new Response(JSON.stringify({serverTime:cut+600000}))) as typeof fetch,undefined,undefined,{binance:adapter,bitget:adapter});return {scanner,candles};}
async function scan(algorithms:any[],combination?:'and'|'or',f=setup()){const hits:any[]=[];const progress=await f.scanner.scan({algorithms,combination,anchorMs:cut+123456,signal,onProgress:()=>{},onSignal:s=>hits.push(s)});return {hits,progress,f};}
const single=async(algorithm:any)=>(await scan([{feature:def,algorithm}])).hits;

it('只要一个算法命中就留下：另一个未达标时交集为空、并集保留，起点 = 该算法自己的起点',async()=>{
 const inputs=[{feature:def,algorithm:a},{feature:def,algorithm:never}];
 expect((await scan(inputs,'and')).hits).toEqual([]);
 const or=await scan(inputs,'or'),alone=await single(a);
 expect(or.hits).toHaveLength(1);expect(or.hits[0].timeMs).toBe(alone[0].timeMs);expect(or.hits[0].fish).toMatchObject({combination:'or',hitAlgorithms:[1],unionStart:alone[0].timeMs});
 expect(or.progress.counts.hit).toBe(1);expect(or.progress.algorithmHits).toEqual([1,0]);expect(or.progress.rule).toContain(' 或 ');
 expect(or.hits[0].fish.algorithms[1]).toMatchObject({featureShort:'C',statistic:'结果',definitionKey:expect.any(String),direction:'>',threshold:1000});expect(fishAlgorithmShort(or.hits[0])).toBe('C ∪ C');
});
it('都命中时只留一条，起点取命中算法里最早的那个；与分别单扫一致',async()=>{
 const x=await single(a),y=await single(b),or=await scan([{feature:def,algorithm:a},{feature:def,algorithm:b}],'or');
 expect(or.hits).toHaveLength(1);expect(or.hits[0].timeMs).toBe(Math.min(x[0].timeMs,y[0].timeMs));expect(or.hits[0].fish.hitAlgorithms).toEqual([1,2]);expect(or.hits[0].fish.algorithms).toEqual([x[0].fish,y[0].fish]);
 expect(or.f.candles).toHaveBeenCalledTimes(1);
});
it('都没命中不留；起点不明的算法不算命中（与单算法规则一致），有别的算法命中仍留下',async()=>{
 const {hits}=await scan([{feature:def,algorithm:a}]),hit={outcome:'hit',signal:hits[0]};
 expect(unionFishResults([{outcome:'below'},{outcome:'blocked'}],[plan,planB]).signal).toBeUndefined();
 expect(unionFishResults([{outcome:'unknown',boundaryMs:1},{outcome:'below'}],[plan,planB])).toEqual({outcome:'unknown'});
 expect(unionFishResults([{outcome:'unknown',boundaryMs:1},hit],[plan,planB]).signal?.timeMs).toBe(hits[0].timeMs);
 expect(unionFishResults([undefined,hit],[plan,planB]).signal?.fish?.hitAlgorithms).toEqual([2]);
});
it('并集键与顺序无关、与交集键不同；两种口径的记录互不覆盖',async()=>{
 const inputs=[{feature:def,algorithm:a},{feature:def,algorithm:b}];
 const x=await scan(inputs,'or'),y=await scan([...inputs].reverse(),'or'),and=await scan(inputs,'and');
 expect(x.hits[0].id).toBe(y.hits[0].id);expect(fishDedupKey(x.hits[0])).toBe(fishDedupKey(y.hits[0]));expect(mergeFishSignals(x.hits,y.hits)).toHaveLength(1);
 expect(x.hits[0].fish.algorithmKey).toBe(fishCombinationKey([plan,planB],'or'));expect(fishCombinationKey([plan,planB],'or')).not.toBe(fishCombinationKey([plan,planB]));
 expect(mergeFishSignals(x.hits,and.hits)).toHaveLength(2);expect(mergeFishSignals([],x.hits)[0]).toEqual(x.hits[0]);
});
it('并集里某个算法超出该家保留期：那家不整家跳过，其余算法照常扫',async()=>{
 const f=setup(),long={...def,interval:'1h' as const};
 const progress=await f.scanner.scan({exchanges:['bitget'],includeDuplicates:true,combination:'or',algorithms:[{feature:def,algorithm:a},{feature:long,algorithm:{...b,constraints:[{id:'t',text:'B > 0 and avg(C,2400)>0',enabled:true}]}}],anchorMs:cut,signal,onProgress:()=>{},onSignal:()=>{}});
 expect(progress.venues?.bitget?.status).not.toBe('skipped');expect(f.candles).toHaveBeenCalled();expect(progress.counts.hit).toBe(1);
});
it('查单个币写出各算法结论与并集结论',async()=>{
 const f=setup(),r=await f.scanner.diagnose({symbol:'AAA',anchorMs:cut,signal,combination:'or',algorithms:[{feature:def,algorithm:never},{feature:def,algorithm:a}]});
 expect(r.outcome).toBe('hit');expect(r.lines.at(-1)).toContain('并集命中（算法 2）');
 const none=await setup().scanner.diagnose({symbol:'AAA',anchorMs:cut,signal,combination:'or',algorithms:[{feature:def,algorithm:never},{feature:def,algorithm:never}]});
 expect(none.lines.at(-1)).toContain('没有一个算法命中');
});
