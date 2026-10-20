// 【用户要求】2026-10-20「单个算法各自都能捕捉到同一个标的，两个算法放在一起时却捕捉不到」：
// 交集必须与两次单独扫描逐币按交集规则合并的结果完全一致；两个都命中的币一个不少（真实 BSS / CBI-2 公式，所需根数不同）。
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
it('交集 = 两个单独扫描按交集规则逐币合并（真实 BSS / CBI-2 公式，不同 N）',async()=>{
 for(const [ta,tb] of [[0,0],[0.02,0.0]] as const){
  const a={statistic:'结果',direction:'>' as const,threshold:ta,constraints:[]},b={...a,threshold:tb};
  const pa=compileFishProgram(bssDef,a),pb=compileFishProgram(cbiDef,b);
  const single=async(feature:any,algorithm:any)=>{const res=new Map<string,any>();const hits:any[]=[];await new FishScanner(fetcher,undefined,undefined,{binance:adapter()}).scan({feature,algorithm,includeDuplicates:true,anchorMs:cut,signal,onProgress:()=>{},onSignal:s=>hits.push(s),onResult:(k,r)=>res.set(k,r)});return {res,hits};};
  YOUNG='';YOUNG=(await single(bssDef,a)).hits[0]?.symbol??'';
  const A=await single(bssDef,a),B=await single(cbiDef,b);
  expect(A.hits.some((h:any)=>h.symbol===YOUNG)).toBe(true);
  const expected=new Map<string,number>();for(const [k,ra] of A.res){const rb=B.res.get(k);if(!rb)continue;const r=intersectFishResults([ra,rb],[pa,pb]);if(r.signal)expected.set(r.signal.symbol,r.signal.timeMs);}
  const got=new Map<string,number>();await new FishScanner(fetcher,undefined,undefined,{binance:adapter()}).scan({algorithms:[{feature:bssDef,algorithm:a},{feature:cbiDef,algorithm:b}],combination:'and',includeDuplicates:true,anchorMs:cut,signal,onProgress:()=>{},onSignal:s=>got.set(s.symbol,s.timeMs)});
  const both=A.hits.filter(h=>B.hits.some(x=>x.symbol===h.symbol)).map(h=>h.symbol);
  expect(pb.N).not.toBe(pa.N);
  expect([...got].sort()).toEqual([...expected].sort());
  // 交集里的每个币，单独扫每个算法都捕到了
  for(const sym of got.keys()){expect(A.hits.some((h:any)=>h.symbol===sym)).toBe(true);expect(B.hits.some((h:any)=>h.symbol===sym)).toBe(true);}
  expect(got.has(YOUNG)).toBe(false);expect(both.length).toBeGreaterThan(0);for(const s of both)expect(got.has(s)).toBe(true);
 }
},600000);

// 【用户要求】2026-10-20「满足任一似乎也是有问题的，并未将两个算法捕捉到的信息都汇总起来，反而少了一个」
it('并集 = 两次单独扫描命中币的并集（真实 BSS / CBI-2 公式），每个币只一条、起点取较早的',async()=>{
 for(const [ta,tb] of [[0,0],[0.02,0.0]] as const){
  const a={statistic:'结果',direction:'>' as const,threshold:ta,constraints:[]},b={...a,threshold:tb};
  const single=async(feature:any,algorithm:any)=>{const hits:any[]=[];await new FishScanner(fetcher,undefined,undefined,{binance:adapter()}).scan({feature,algorithm,includeDuplicates:true,anchorMs:cut,signal,onProgress:()=>{},onSignal:s=>hits.push(s)});return hits;};
  YOUNG='';YOUNG=(await single(bssDef,a))[0]?.symbol??'';expect(YOUNG).not.toBe('');
  const A=await single(bssDef,a),B=await single(cbiDef,b);
  expect(A.some(h=>h.symbol===YOUNG)).toBe(true);expect(B.some(h=>h.symbol===YOUNG)).toBe(false);
  const expected=new Map<string,number>();for(const h of [...A,...B])expected.set(h.symbol,Math.min(expected.get(h.symbol)??Infinity,h.timeMs));
  const got:any[]=[];const p=await new FishScanner(fetcher,undefined,undefined,{binance:adapter()}).scan({algorithms:[{feature:bssDef,algorithm:a},{feature:cbiDef,algorithm:b}],combination:'or',includeDuplicates:true,anchorMs:cut,signal,onProgress:()=>{},onSignal:s=>got.push(s)});
  expect(got.some(s=>s.symbol===YOUNG)).toBe(true);
  expect(new Map(got.map(s=>[s.symbol,s.timeMs]))).toEqual(expected);expect(got.length).toBe(expected.size);expect(p.counts.hit).toBe(expected.size);
 }
},600000);
