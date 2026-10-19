import {it,expect,vi} from 'vitest';
import {FishScanner} from '@/lib/fishScanner';
import {FishAdapter,type FishDataAdapter} from '@/lib/fish/adapters';
import {compileFishProgram} from '@/lib/fish/algorithm';
import {CBI2_DEF,type DeepDigFeatureDef} from '@/lib/deepDig/features';
import {intervalMs} from '@/lib/deepRsa/marketData';
import type {ResearchBar} from '@/lib/deepRsa/window';
const cut=Date.UTC(2026,9,19,3),signal=new AbortController().signal,def:DeepDigFeatureDef={...CBI2_DEF,id:'simple',short:'C',formula:'C',scale:1,unit:'USDT'};
const algorithm={H:1/12,direction:'>' as const,threshold:100,constraints:[]};
const aaa={symbol:'AAAUSDT',instrument:'AAAUSDT',base:'AAA',multiplier:1},btc={symbol:'BTCUSDT',instrument:'BTCUSDT',base:'BTC',multiplier:1};
function bars(count:number,step=300000,end=cut):ResearchBar[]{return Array.from({length:count},(_,i)=>({openTime:end-(count-i)*step,open:99,close:i<count-5?99:101,high:102,low:98,volume:10,quoteVolume:1000,takerBuyQuoteVolume:40,takerBuyVolume:null}));}
function setup(missing=false){const candles=vi.fn(async(m,_cut,_signal,q)=>{const rows=bars(q.count,intervalMs(q.interval),_cut);return m===btc&&missing?rows.slice(1):rows;}),taker=vi.fn(async(_m,b)=>b),adapter:FishDataAdapter={exchange:'binance',list:vi.fn(async()=>[aaa]),btc:vi.fn(()=>btc),candles,taker};const request=vi.fn(async()=>new Response(JSON.stringify({serverTime:cut+600000})));return {adapter,candles,taker,scanner:new FishScanner(request as typeof fetch,undefined,undefined,{binance:adapter})};}
it('不用BTC不取参考BTC；纯价格/成交额不拉逐笔；完整定义周期冻结截止',async()=>{
 const f=setup(),found:any[]=[];const run=await f.scanner.scan({feature:def,algorithm,signal,onProgress:()=>{},onSignal:s=>found.push(s)});expect(run.counts.hit).toBe(1);expect(f.adapter.btc).not.toHaveBeenCalled();expect(f.candles.mock.calls.map(c=>c[0].symbol)).toEqual(['AAAUSDT']);expect(f.taker).not.toHaveBeenCalled();expect(found[0].fish.featureId).toBe('simple');
 const q=setup(),volume={...def,formula:'Q'};await q.scanner.scan({feature:volume,algorithm:{...algorithm,threshold:999},signal,onProgress:()=>{},onSignal:()=>{}});expect(q.taker).not.toHaveBeenCalled();
 const h=setup(),fifteen={...def,interval:'15m' as const};const p=await h.scanner.scan({feature:fifteen,algorithm,anchorMs:cut+123456,signal,onProgress:()=>{},onSignal:()=>{}});expect(p.cutoffMs).toBe(cut);expect(h.candles.mock.calls[0][3].interval).toBe('15m');
});
it('约束引用BTC才取；BTC缺根整次中止，在任何币信号产出之前结束',async()=>{
 const f=setup(true),onSignal=vi.fn();const result=await f.scanner.scan({feature:def,algorithm:{...algorithm,constraints:[{id:'cb',text:'CB > 0',enabled:true}]},signal,onProgress:()=>{},onSignal});expect(result.status).toBe('aborted');expect(result.error).toContain('整次扫描中止');expect(f.candles).toHaveBeenCalledTimes(1);expect(f.candles.mock.calls[0][0]).toBe(btc);expect(onSignal).not.toHaveBeenCalled();
});
it('截止主条件成立但约束不成立计挡下，并为每一条截止失败约束分别计数',async()=>{
 const f=setup();const result=await f.scanner.scan({feature:def,algorithm:{...algorithm,constraints:[{id:'b',text:'B > 50',enabled:true},{id:'v',text:'X > 0',enabled:true}]},signal,onProgress:()=>{},onSignal:()=>{throw Error('不应命中');}});expect(result.blocked).toBe(1);expect(result.venues!.binance!.constraintBlocked).toEqual([1,0]);expect(result.counts.below).toBe(0);expect(f.taker).toHaveBeenCalledTimes(1);
});
it('同周期不同历史长度共用缓存，跨周期分区；缓存中的截止后K线不混入计算',async()=>{
 const calls:URL[]=[],adapter=new FishAdapter('binance',async path=>{const u=new URL(path,'https://test/');calls.push(u);const step=intervalMs(u.searchParams.get('interval') as '5m'),a=Number(u.searchParams.get('startTime')),end=Number(u.searchParams.get('endTime'));return Array.from({length:Math.floor((end-a)/step)+1},(_,i)=>[a+i*step,100,101,99,100,1,a+(i+1)*step-1,100,1,.5,50,0]);});
 await adapter.candles(aaa,cut,signal,{interval:'5m',count:3000});expect(calls).toHaveLength(3);const small=await adapter.candles(aaa,cut,signal,{interval:'5m',count:1500});expect(small).toHaveLength(1500);await adapter.candles(aaa,cut,signal,{interval:'5m',count:3000});expect(calls).toHaveLength(3);await adapter.candles(aaa,cut,signal,{interval:'15m',count:100});expect(calls).toHaveLength(4);const past=await adapter.candles(aaa,cut-2*300000,signal,{interval:'5m',count:1500});expect(past.at(-1)!.openTime+300000).toBe(cut-2*300000);expect(calls).toHaveLength(4);
});
it('Gate缺少3m原生时以连续1m聚合OHLC、币量和USDT成交额，Bitget小时参数大写且缓存复用',async()=>{
 const gate=new FishAdapter('gate',async path=>{const u=new URL(path,'https://test/');expect(u.searchParams.get('interval')).toBe('1m');const a=Number(u.searchParams.get('from')),b=Number(u.searchParams.get('to'));return Array.from({length:(b-a)/60+1},(_,i)=>({t:a+i*60,o:String(100+i),h:String(102+i),l:String(99+i),c:String(101+i),v:'1',sum:'100'}));});
 const grouped=await gate.candles({...aaa,instrument:'AAA_USDT'},cut,signal,{interval:'3m',count:10});expect(grouped).toHaveLength(10);expect(grouped[0]).toMatchObject({open:100,close:103,high:104,low:99,volume:3,quoteVolume:300});expect(grouped.at(-1)!.openTime+180000).toBe(cut);
 const requested:string[]=[],bitget=new FishAdapter('bitget',async path=>{requested.push(path);const u=new URL(path,'https://test/');expect(u.searchParams.get('granularity')).toBe('1H');const end=Number(u.searchParams.get('endTime'));return {code:'00000',data:Array.from({length:20},(_,i)=>[end-(20-i)*3600000,100,102,99,101,1,100])};});await bitget.candles(aaa,Math.floor(cut/7200000)*7200000,signal,{interval:'2h',count:10});expect(requested).toHaveLength(1);
});
