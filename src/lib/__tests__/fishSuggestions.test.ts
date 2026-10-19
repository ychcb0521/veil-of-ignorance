import {beforeEach,it,expect,vi} from 'vitest';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {compileFishProgram,type FishProgram} from '@/lib/fish/algorithm';
import {collectFishSuggestion,fishQuantile,fishSuggestionKey,fishSignalFingerprint,readFishSuggestion,suggestedFishThreshold,mayFillFishThreshold,type FishSuggestionLoader,type FishSuggestionProgress,type FishSampleRow} from '@/lib/fish/suggestions';
import {FishError,FishWeightBudget} from '@/lib/fish/shared';
import {FishScanner} from '@/lib/fishScanner';
import type {TradeSignal} from '@/lib/signalLibrary';
const anchor=Date.UTC(2026,5,20),step=300000,signal=new AbortController().signal;
const def={...CBI2_DEF,id:'suggest-test',formula:'V = Q\nC',scale:10,unit:'点'};
const plan=compileFishProgram(def,{direction:'>',threshold:0,constraints:[{id:'b',text:'B > 5',enabled:true}]});
const row=(symbol:string,timeMs=anchor):TradeSignal=>({id:symbol+timeMs,symbol,timeMs,timeLabel:'',fallbackZone:''});
const bars=(cut:number,p:FishProgram,c=2,buy=10)=>Array.from({length:p.N},(_,i)=>({openTime:cut-(p.N-i)*p.step,open:c,close:c,high:c+1,low:c-1,volume:1,quoteVolume:100,takerBuyQuoteVolume:buy,takerBuyVolume:null}));
const run=(rows:TradeSignal[],load:FishSuggestionLoader,p=plan,onProgress:(p:FishSuggestionProgress)=>void=vi.fn())=>collectFishSuggestion({plan:p,signals:rows,signal,onProgress},load);
beforeEach(()=>localStorage.clear());
it('分位数为线性插值；方向>用P25、<用P75；空值和仍为上次建议可填，手改不覆盖',async()=>{
 expect([.25,.5,.75].map(q=>fishQuantile([4,1,3,2],q))).toEqual([1.75,2.5,3.25]);expect(fishQuantile([], .5)).toBeNull();expect(fishQuantile([-1e308,1e308],.5)).toBe(0);
 const out=await run([row('AAAUSDT'),row('BBBUSDT')],async(s,cut,p)=>bars(cut,p,s.symbol==='AAAUSDT'?1:3));expect([out.samples.p25,out.samples.p50,out.samples.p75]).toEqual([15,20,25]);expect(suggestedFishThreshold(out,'>')).toBe(15);expect(suggestedFishThreshold(out,'<')).toBe(25);expect(mayFillFishThreshold('')).toBe(true);expect(mayFillFishThreshold('15','15')).toBe(true);expect(mayFillFishThreshold('16','15')).toBe(false);
});
it('样本只使用信号之前已收盘N根，修改之后的数据不影响样本建议；随机点各用自己的截止',async()=>{
 const source=bars(anchor+8*86400000,{...plan,N:plan.N+16*288},1).map(b=>({...b,close:b.openTime<anchor?2:20}));
 const loader=vi.fn(async(_s,cut,p)=>source.filter(b=>b.openTime+p.step<=cut).slice(-p.N));
 const first=await run([row('AAAUSDT',anchor+12345)],loader);expect(first.samples.p50).toBe(20);expect(loader.mock.calls[0][1]).toBe(anchor);expect(loader.mock.calls[0][2].N).toBe(plan.N);
 localStorage.clear();source.forEach(b=>{if(b.openTime>=anchor)b.close=99999;});const second=await run([row('AAAUSDT',anchor+12345)],loader);expect(second.samples).toEqual(first.samples);
});
it('信号库全部信号都取数（外所、美股按各自来源）；缺口、历史不足、请求失败和读数不全分别计数；通过全部约束的比例用有效样本',async()=>{
 const loader=vi.fn(async({symbol:s}:FishSampleRow,cut:number,p:FishProgram)=>{if(s==='GAPUSDT')return bars(cut,p).filter((_,i)=>i!==100);if(s==='HISTUSDT')throw new FishError('历史不足','history');if(s==='REQUSDT')throw new FishError('HTTP400','failed');if(s==='NANUSDT')return bars(cut,p,NaN);return bars(cut,p,2,s==='FALSEUSDT'?0:10);});
 const out=await run([row('AAAUSDT'),row('FALSEUSDT'),row('GAPUSDT'),row('HISTUSDT'),row('REQUSDT'),row('NANUSDT'),{...row('COINUSDT'),market:'us_stock'},{...row('OTHERUSDT'),exchange:'okx'}],loader);
 expect(out.samples.n).toBe(4);expect(out.samples.skipped).toEqual({'缺口':1,'历史不足':1,'请求失败':1,'读数不全':1});expect(out.samples.constraintRatio).toBe(.75);
 expect(loader.mock.calls.find(c=>c[0].symbol==='COINUSDT')![0]).toMatchObject({market:'us_stock'});expect(loader.mock.calls.find(c=>c[0].symbol==='OTHERUSDT')![0]).toMatchObject({exchange:'okx'});expect(out.random.attempted).toBe(4);
 expect(loader.mock.calls.filter(c=>c[0].symbol==='OTHERUSDT').every(c=>c[0].exchange==='okx')).toBe(true);
});
it('约束未知单独跳过；当前结果缺失但A有限时仍接受，与捕捞同口径',async()=>{
 const unknown=compileFishProgram(def,{...plan.settings,constraints:[{id:'u',enabled:true,text:'1/0 > 0'}]});const out=await run([row('AAAUSDT')],async(_s,c,p)=>bars(c,p),unknown);expect(out.samples.skipped['读数不全']).toBe(1);expect(out.samples.n).toBe(0);
});
it('定义+序列+约束+信号集缓存命中不重取，重排不失效；改方向 / 阈值不用重算；定义、统计量或信号变化都会过期',async()=>{
 const rows=[row('AAAUSDT'),row('BBBUSDT')],loader=vi.fn(async(_s,c,p)=>bars(c,p));const first=await run(rows,loader);const calls=loader.mock.calls.length,second=await run([...rows].reverse(),loader);expect(second.cacheHit).toBe(true);expect(loader).toHaveBeenCalledTimes(calls);expect(fishSignalFingerprint(rows)).toBe(fishSignalFingerprint([...rows].reverse()));
 const changed=compileFishProgram(def,{...plan.settings,direction:'<',threshold:123});expect(readFishSuggestion(fishSuggestionKey(changed,rows))?.key).toBe(first.key);expect(readFishSuggestion(fishSuggestionKey(compileFishProgram(def,{...plan.settings,constraints:[]}),rows))).toBeNull();expect(readFishSuggestion(fishSuggestionKey(plan,[...rows,row('CCCUSDT')]))).toBeNull();expect(fishSuggestionKey(compileFishProgram({...def,formula:'C+1'},plan.settings),rows)).not.toBe(first.key);expect(fishSuggestionKey(compileFishProgram(def,{...plan.settings,statistic:'V'}),rows)).not.toBe(first.key);
});
it('固定种子、同一批币、每个有效信号一个±7天随机点；异步完成顺序不影响对照',async()=>{
 const rows=[row('AAAUSDT'),row('BBBUSDT'),row('CCCUSDT')];let phase='signals';const cuts:{symbol:string;cut:number}[]=[];const loader:FishSuggestionLoader=async({symbol},cut,p)=>{if(phase==='random')cuts.push({symbol,cut});return bars(cut,p,(cut/step)%100);};
 const first=await run(rows,loader,plan,p=>phase=p.phase);expect(cuts).toHaveLength(3);expect(cuts.every(x=>Math.abs(x.cut-anchor)<=7*86400000+step)).toBe(true);const before=[...cuts];cuts.length=0;phase='signals';localStorage.clear();const second=await run([...rows].reverse(),loader,plan,p=>phase=p.phase);expect(cuts).toEqual(before);expect(first.random).toEqual(second.random);
});
it('取消不保存未完成结果，进度可见；最多3个并发样本',async()=>{
 const c=new AbortController(),progress:FishSuggestionProgress[]=[];let active=0,max=0;const loader:FishSuggestionLoader=async(_s,cut,p)=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,1));active--;c.abort();return bars(cut,p);};
 await expect(collectFishSuggestion({plan,signals:['AAA','BBB','CCC','DDD'].map(s=>row(s+'USDT')),signal:c.signal,onProgress:p=>progress.push(p)},loader)).rejects.toMatchObject({name:'AbortError'});expect(max).toBeLessThanOrEqual(3);expect(progress.at(-1)?.status).toBe('cancelled');expect(readFishSuggestion(fishSuggestionKey(plan,['AAA','BBB','CCC','DDD'].map(s=>row(s+'USDT'))))).toBeNull();
});
it('建议和捕捞共用币安K线缓存及权重预算，不用CB不取BTC；所有请求排除样本之后数据',async()=>{
 const budget=new FishWeightBudget(),reserve=vi.spyOn(budget,'tryTake');const requests:string[]=[];
 const fetcher=vi.fn(async(url:RequestInfo|URL)=>{const u=new URL(String(url));if(u.pathname.endsWith('/time'))return new Response(JSON.stringify({serverTime:anchor+12*86400000}));requests.push(u.toString());const from=Number(u.searchParams.get('startTime')),end=Number(u.searchParams.get('endTime'));const rows=[];for(let t=from;t<=end;t+=step)rows.push([t,'2','3','1','2','50',t+step-1,'100',1,'5','10']);return new Response(JSON.stringify(rows));});
 const scanner=new FishScanner(fetcher as typeof fetch,budget);await scanner.suggest({plan,signals:[row('AAAUSDT')],signal,onProgress:()=>{}});expect(requests.every(u=>!u.includes('BTCUSDT'))).toBe(true);expect(reserve).toHaveBeenCalledWith(5);
 localStorage.clear();requests.length=0;await scanner.suggest({plan,signals:[row('AAAUSDT')],signal,onProgress:()=>{}});expect(requests).toHaveLength(0);
});
it('引用CB时用相同区间BTC，BTC缺根使样本跳过，不能拿不完整参考计算',async()=>{
 const btcPlan=compileFishProgram({...def,formula:'CB'},{...plan.settings,constraints:[]});const requests:string[]=[];
 const fetcher=vi.fn(async(url:RequestInfo|URL)=>{const u=new URL(String(url));if(u.pathname.endsWith('/time'))return new Response(JSON.stringify({serverTime:anchor+12*86400000}));requests.push(u.toString());if(u.searchParams.get('symbol')==='BTCUSDT')return new Response('[]');const from=Number(u.searchParams.get('startTime')),end=Number(u.searchParams.get('endTime')),rows=[];for(let t=from;t<=end;t+=step)rows.push([t,'2','3','1','2','50',t+step-1,'100',1,'5','10']);return new Response(JSON.stringify(rows));});
 const out=await new FishScanner(fetcher as typeof fetch).suggest({plan:btcPlan,signals:[row('AAAUSDT')],signal,onProgress:()=>{}});expect(out.samples.n).toBe(0);expect(out.samples.skipped['历史不足']).toBe(1);expect(requests.some(u=>u.includes('BTCUSDT'))).toBe(true);
});

it('HTTP418立即中止建议，不继续逐币请求、不缓存半成品',async()=>{
 const request=vi.fn(async()=>{throw new FishError('币安 HTTP418','banned');}),progress:FishSuggestionProgress[]=[];
 await expect(collectFishSuggestion({plan,signals:['AAA','BBB','CCC','DDD','EEE'].map(s=>row(s+'USDT')),signal,onProgress:p=>progress.push(p)},request)).rejects.toThrow('HTTP418');expect(request.mock.calls.length).toBeLessThanOrEqual(3);expect(progress.at(-1)?.status).toBe('aborted');
});

it('未来信号和未来随机点不取未收盘K线：以币安服务器时间校验，已缓存时钟足以确认历史闭合',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({serverTime:anchor+step/2}))),scanner=new FishScanner(fetcher as typeof fetch);
 const out=await scanner.suggest({plan,signals:[row('AAAUSDT',anchor+step)],signal,onProgress:()=>{}});expect(out.samples.n).toBe(0);expect(out.samples.skipped['读数不全']).toBe(1);expect(out.samples.failures[0].reason).toContain('尚未全部收盘');expect(fetcher).toHaveBeenCalledTimes(1);expect(readFishSuggestion(fishSuggestionKey(plan,[row('AAAUSDT',anchor+step)]))).toBeNull();
});

it('外所信号用该家适配器与合约列表取数；超出该家保留期、该家已没有此合约的跳过并计数',async()=>{
 const server=anchor+12*86400000,okx={symbol:'OOOUSDT',instrument:'OOO-USDT-SWAP',base:'OOO',multiplier:10};
 const candles=vi.fn(async(_m:any,cut:number,_s:AbortSignal,q:any)=>bars(cut,{...plan,N:q.count}));
 const adapter={exchange:'okx' as const,list:vi.fn(async()=>[okx]),btc:()=>okx,candles,taker:vi.fn(async(_m:any,b:any)=>b)};
 const scanner=new FishScanner(vi.fn(async()=>new Response(JSON.stringify({serverTime:server}))) as typeof fetch,undefined,undefined,{okx:adapter as any});
 const out=await scanner.suggest({plan,signals:[{...row('OOOUSDT'),exchange:'okx'},{...row('OOOUSDT',anchor-200*86400000),exchange:'okx'},{...row('GONEUSDT'),exchange:'okx'}],signal,onProgress:()=>{}});
 expect(out.samples.n).toBe(1);expect(candles.mock.calls[0][0]).toMatchObject({instrument:'OOO-USDT-SWAP'});expect(out.samples.skipped['超出保留期 / 已下架']).toBe(2);expect(adapter.list).toHaveBeenCalledTimes(1);
});
