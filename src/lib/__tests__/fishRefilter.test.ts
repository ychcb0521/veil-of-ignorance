// 【用户要求】2026-10-20「捕捉运行完成之后，将区间值调大之后能更细致过滤，而不用再重新运行」：
// 宽阈值扫一轮后把阈值往严里调，当场重判的结果必须与按严阈值重扫逐条一致（信号 id、起点、快照、轨迹全都一样）。
import {it,expect,vi} from 'vitest';
import {FishScanner} from '@/lib/fishScanner';
import {compileFishProgram} from '@/lib/fish/algorithm';
import {intersectFishResults} from '@/lib/fish/intersection';
import {BSS_DEF,CBI2_DEF} from '@/lib/deepDig/features';
import {mulberry32} from '@/lib/deepRsa/grouping';
import type {FishDataAdapter} from '@/lib/fish/adapters';
import {FishError} from '@/lib/fish/shared';
const cut=Date.UTC(2026,3,9,15),signal=new AbortController().signal,STEP=300000;
const bssDef={...BSS_DEF,formula:`${BSS_DEF.formula}\navg_BSS = avg(BSS, 24)`};
const cbiDef={...CBI2_DEF,formula:`${CBI2_DEF.formula}\navg_CBI2 = avg(CBI2, 24)`};
const coins=Array.from({length:20},(_,i)=>({symbol:`C${i}USDT`,instrument:`C${i}USDT`,base:`C${i}`,multiplier:1}));
// 新币：只有 1800 根历史，够 BSS（1409 根）不够 CBI-2（2299 根）；取一个 BSS 会命中的币当新币
let YOUNG='';
const btc={symbol:'BTCUSDT',instrument:'BTCUSDT',base:'BTC',multiplier:1};
const series=new Map<string,any[]>();
function path(sym:string,n:number){const key=sym;if(!series.has(key)){const seed=[...sym].reduce((a,c)=>a*31+c.charCodeAt(0),7)>>>0;const rand=mulberry32(seed);let p=100;const out=[];const total=8000;for(let i=0;i<total;i++){const o=p;p*=Math.exp((rand()-0.5+0.03*Math.sin(i/300+seed))*0.01);const q=1e5*(0.3+rand());out.push({openTime:cut-(total-i)*STEP,open:o,close:p,high:Math.max(o,p)*1.002,low:Math.min(o,p)*0.998,volume:q/p,quoteVolume:q,takerBuyQuoteVolume:q*(0.3+0.4*rand()+0.15*Math.sin(i/200+seed)),takerBuyVolume:null});}series.set(key,out);}return series.get(key)!;}
function adapter():FishDataAdapter{return {exchange:'binance',list:vi.fn(async()=>[...coins,btc]),btc:()=>btc,taker:vi.fn(async(_m,b)=>b),candles:vi.fn(async(m,c,_s,q)=>{const all=path(m.symbol,q.count).filter(b=>b.openTime+STEP<=c);const have=m.symbol===YOUNG?all.slice(-1800):all;if(have.length<q.count&&!q.allowPartial)throw new FishError('当时未上市 / 历史不足','history');return have.slice(-q.count);})};}
const fetcher=vi.fn(async()=>new Response(JSON.stringify({serverTime:cut+600000}))) as unknown as typeof fetch;
import {combineFishRound,deriveFishRound,type FishCombinationRound} from '@/lib/fishScanner';
import type {FishAlgorithmSettings} from '@/lib/fish/algorithm';
async function scan(algorithms:{feature:any;algorithm:FishAlgorithmSettings}[],combination:'and'|'or'='and'){
 const hits:any[]=[];let round:FishCombinationRound|null=null;
 const options=algorithms.length===1?{...algorithms[0]}:{algorithms,combination,retainMembers:true};
 await new FishScanner(fetcher,undefined,undefined,{binance:adapter()}).scan({...options,includeDuplicates:true,anchorMs:cut,signal,onProgress:()=>{},onSignal:s=>hits.push(s),onRound:r=>{round=r;}} as any);
 return {hits,round:round!};
}
const byId=(xs:any[])=>[...xs].sort((a,b)=>a.id.localeCompare(b.id));
const set=(threshold:number,extra:Partial<FishAlgorithmSettings>={}):FishAlgorithmSettings=>({statistic:'结果',direction:'>',threshold,constraints:[],...extra});
it('单算法：调严后当场重判 = 按新阈值重扫（含约束）',async()=>{
 for(const extra of [{},{constraints:[{id:'c',text:'X > 0',enabled:true}]}]){
  const loose=await scan([{feature:cbiDef,algorithm:set(-0.05,extra)}]);
  const sizes:number[]=[];
  for(const t of [-0.05,-0.03,-0.01,0,0.01,0.03,1]){
   const fresh=await scan([{feature:cbiDef,algorithm:set(t,extra)}]);
   const derived=deriveFishRound(loose.round,[compileFishProgram(cbiDef,set(t,extra))])!;
   expect(derived).not.toBeNull();
   expect(byId(combineFishRound(derived,'and').signals)).toEqual(byId(fresh.hits));
   expect(derived.memberHits).toEqual([fresh.hits.length]);sizes.push(fresh.hits.length);
  }
  // 确实一路滤掉了币（不是空对空）
  expect(sizes[0]).toBeGreaterThan(3);expect(new Set(sizes).size).toBeGreaterThan(2);expect(sizes.at(-1)).toBe(0);
  // 放宽做不到：原来没命中的币可能冒出来，只能重扫
  expect(deriveFishRound(loose.round,[compileFishProgram(cbiDef,set(-0.06,extra))])).toBeNull();
 }
},600000);
it('多算法：各卡分别调严后，交集 / 并集都 = 按新阈值重扫；未调的卡原样复用',async()=>{
 const base=await scan([{feature:bssDef,algorithm:set(0)},{feature:cbiDef,algorithm:set(0)}],'or');
 for(const [ta,tb] of [[0.02,0],[0.02,0.03],[0,0.05]]){
  const plans=[compileFishProgram(bssDef,set(ta)),compileFishProgram(cbiDef,set(tb))];
  expect(base.hits.length).toBeGreaterThan(0);
  const derived=deriveFishRound(base.round,plans)!;
  expect(derived).not.toBeNull();
  for(const mode of ['and','or'] as const){
   const fresh=await scan([{feature:bssDef,algorithm:set(ta)},{feature:cbiDef,algorithm:set(tb)}],mode);
   expect(byId(combineFishRound(derived,mode).signals)).toEqual(byId(fresh.hits));
  }
  if(ta===0)expect(derived.plans[0]).toBe(base.round.plans[0]);
 }
 // 换方向 / 换统计量不是「调严」，不能冒用
 expect(deriveFishRound(base.round,[compileFishProgram(cbiDef,set(0.1,{direction:'<'}))])).toBeNull();
},600000);
