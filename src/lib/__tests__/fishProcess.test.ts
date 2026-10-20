// 【用户要求】2026-10-20「在捕捉到的信号后面加一列（捕捞过程），点开之后要能够看到凭什么击中到了信号、以及为什么能避开其他噪音」
import {beforeEach,it,expect,vi} from 'vitest';
import {summarizeFishRound,saveFishRound,readFishRound,fishRoundIdentity} from '@/lib/fish/roundSummary';
import {compileFishProgram,evaluateFishProgram,classifyFishProgram} from '@/lib/fish/algorithm';
import {FishScanner} from '@/lib/fishScanner';
import {fishCombinationKey} from '@/lib/fish/intersection';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {intervalMs} from '@/lib/deepRsa/marketData';
import type {FishDataAdapter} from '@/lib/fish/adapters';
beforeEach(()=>localStorage.clear());
const def={...CBI2_DEF,id:'price',short:'P',formula:'P = C\nM = avg(C,0.25)\nC',scale:1,unit:''};
const a={statistic:'结果',direction:'>' as const,threshold:100,constraints:[]};
it('本轮摘要：各结论计数、可读数、分位数、命中币排名与最靠前 10 个；按方向排序',()=>{
 const rows=[{symbol:'A',reading:5,outcome:'hit'},{symbol:'B',reading:9,outcome:'unknown'},{symbol:'C',reading:1,outcome:'below'},{symbol:'D',reading:NaN,outcome:'gap'},{symbol:'E',reading:3,outcome:'hit',exchange:'okx'}];
 const s=summarizeFishRound(rows,{algorithmKey:'k',cutoffMs:1,anchorMs:1,direction:'>',threshold:2,scale:1,unit:'',partial:false});
 expect(s.counts).toEqual({hit:2,unknown:1,below:1,gap:1});expect(s.total).toBe(5);expect(s.valid).toBe(4);
 expect(s.ranks[fishRoundIdentity({symbol:'A'})]).toBe(2);expect(s.ranks[fishRoundIdentity({symbol:'E',exchange:'okx'})]).toBe(3);expect(s.ranks[fishRoundIdentity({symbol:'B'})]).toBeUndefined();
 expect(s.top.map(r=>r.symbol)).toEqual(['B','A','E','C']);expect(s.quantiles).toMatchObject({min:1,max:9,p50:4});
 const down=summarizeFishRound(rows,{algorithmKey:'k',cutoffMs:1,anchorMs:1,direction:'<',threshold:2,scale:1,unit:'',partial:false});expect(down.top[0].symbol).toBe('C');
});
it('只存本机最近 40 轮；同一算法同一截止只留最新；多重算法按 cutoffs 找到',()=>{
 for(let i=0;i<45;i++)saveFishRound(summarizeFishRound([],{algorithmKey:'k',cutoffMs:i,anchorMs:i,direction:'>',threshold:0,scale:1,unit:'',partial:false}));
 expect(readFishRound('k',44)).not.toBeNull();expect(readFishRound('k',0)).toBeNull();
 saveFishRound({...summarizeFishRound([{symbol:'A',reading:1,outcome:'hit'}],{algorithmKey:'k',cutoffMs:44,anchorMs:44,direction:'>',threshold:0,scale:1,unit:'',partial:false})});expect(readFishRound('k',44)!.total).toBe(1);
 saveFishRound({...summarizeFishRound([],{algorithmKey:'combo',cutoffMs:300,anchorMs:300,direction:'>',threshold:NaN,scale:1,unit:'',partial:false}),cutoffs:[300,900]});expect(readFishRound('combo',900)).not.toBeNull();
});
it('命中快照记下轨迹（必含截止那根）、这一轮的最低读数、越线次数与保持根数',()=>{
 const plan=compileFishProgram(def,a),n=plan.N;
 const closes=Array.from({length:n},(_,i)=>i===n-60?101:i<n-40?99:i<n-30?102:101.5);
 const bars=closes.map((c,i)=>({openTime:(i+1)*300000,open:c,close:c,high:c+1,low:c-1,volume:1,quoteVolume:100,takerBuyQuoteVolume:50,takerBuyVolume:null}));
 const r=classifyFishProgram('A',bars,evaluateFishProgram(bars,plan),0,plan);expect(r.outcome).toBe('hit');const f=r.signal!.fish!;
 expect(f.aboveBars).toBe(40);expect(f.runExtreme).toBe(101.5);expect(f.crossings).toBe(2);
 expect(f.trace!.values.at(-1)).toBe(101.5);expect(f.trace!.t0+f.trace!.dt*(f.trace!.values.length-1)).toBe(bars.at(-1)!.openTime+300000);expect(f.trace!.values.length).toBeLessThanOrEqual(61);
});
const cut=Date.UTC(2026,9,19,3),signal=new AbortController().signal;
const market=(s:string)=>({symbol:s,instrument:s,base:s.replace('USDT',''),multiplier:1});
function adapter():FishDataAdapter{return {exchange:'binance',list:vi.fn(async()=>['AAAUSDT','BBBUSDT','CCCUSDT'].map(market)),btc:()=>market('BTCUSDT'),taker:vi.fn(async(_m,b)=>b),candles:vi.fn(async(m,c,_s,q)=>Array.from({length:q.count},(_,i)=>{const t=c-(q.count-i)*intervalMs(q.interval);const close=m.symbol==='AAAUSDT'?(t<cut-5*300000?99:101):m.symbol==='BBBUSDT'?101:99;return {openTime:t,open:close,close,high:close+1,low:close-1,volume:10,quoteVolume:1000,takerBuyQuoteVolume:600,takerBuyVolume:null};}))};}
const scanner=()=>new FishScanner(vi.fn(async()=>new Response(JSON.stringify({serverTime:cut+600000}))) as typeof fetch,undefined,undefined,{binance:adapter()});
it('扫完存本轮摘要：命中 / 早已高于门槛 / 未达标分别计数，命中币有排名',async()=>{
 const plan=compileFishProgram(def,a);const hits:any[]=[];
 await scanner().scan({feature:def,algorithm:a,anchorMs:cut,includeDuplicates:true,signal,onProgress:()=>{},onSignal:s=>hits.push(s)});
 const round=readFishRound(plan.algorithmKey,hits[0].fish.cutoffMs)!;
 expect(round.counts).toMatchObject({hit:1,unknown:1,below:1});expect(round.ranks[fishRoundIdentity({symbol:'AAAUSDT'})]).toBeGreaterThan(0);
});
it('多重算法另存组合摘要（组合键、各算法命中数），各算法自己的本轮摘要也在',async()=>{
 const b={...a,statistic:'M',threshold:100.5};const hits:any[]=[];
 await scanner().scan({algorithms:[{feature:def,algorithm:a},{feature:def,algorithm:b}],combination:'or',anchorMs:cut,includeDuplicates:true,signal,onProgress:()=>{},onSignal:s=>hits.push(s)});
 const plans=[compileFishProgram(def,a),compileFishProgram(def,b)];
 const combo=readFishRound(fishCombinationKey(plans,'or'),hits[0].fish.cutoffMs)!;
 expect(combo.combination).toBe('or');expect(combo.counts.hit).toBe(hits.length);expect(combo.members!.map(m=>m.algorithmKey)).toEqual(plans.map(p=>p.algorithmKey));
 for(const p of plans)expect(readFishRound(p.algorithmKey,hits[0].fish.cutoffMs)).not.toBeNull();
});
