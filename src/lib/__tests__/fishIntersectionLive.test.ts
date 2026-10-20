// 【用户要求】2026-10-20「交集这里还是有问题，单个算法都能捕捉到同一个标的，但是合并到一起却捕捉不到…彻底解决问题」
import {it,expect,vi} from 'vitest';
import {FishScanner} from '@/lib/fishScanner';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {intervalMs} from '@/lib/deepRsa/marketData';
import type {FishDataAdapter} from '@/lib/fish/adapters';
const cut=Date.UTC(2026,9,19,3);
const def={...CBI2_DEF,id:'price',short:'P',formula:'P = C\nM = avg(C,0.25)\nC',scale:1,unit:''};
const a={statistic:'结果',direction:'>' as const,threshold:100,constraints:[]};
const b={...a,statistic:'M',threshold:100.5};
const market=(s:string)=>({symbol:s,instrument:s,base:s.replace('USDT',''),multiplier:1});
const coins=['AAAUSDT','BBBUSDT','CCCUSDT','DDDUSDT'];
function adapter(onCandles?:(symbol:string)=>Promise<void>|void):FishDataAdapter{return {exchange:'binance',list:vi.fn(async()=>coins.map(market)),btc:()=>market('BTCUSDT'),taker:vi.fn(async(_m,x)=>x),candles:vi.fn(async(m,c,_s,q)=>{await onCandles?.(m.symbol);return Array.from({length:q.count},(_,i)=>{const t=c-(q.count-i)*intervalMs(q.interval),close=t<cut-5*300000?99:101;return {openTime:t,open:close,close,high:close+1,low:close-1,volume:10,quoteVolume:1000,takerBuyQuoteVolume:600,takerBuyVolume:null};});})};}
const clock=vi.fn(async()=>new Response(JSON.stringify({serverTime:cut+600000}))) as unknown as typeof fetch;
const inputs=[{feature:def,algorithm:a},{feature:def,algorithm:b}];
it('一个币的各算法结论到齐就当场出交集信号（不等全部扫完），命中数实时更新',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});const seen:string[]=[];const hits:number[]=[];
 const scan=new FishScanner(clock,undefined,undefined,{binance:adapter(async s=>{if(s==='DDDUSDT')await gate;})}).scan({algorithms:inputs,anchorMs:cut,includeDuplicates:true,signal:new AbortController().signal,onProgress:p=>hits.push(p.counts.hit),onSignal:s=>seen.push(s.symbol)});
 await vi.waitFor(()=>expect(seen.length).toBe(3));expect(hits.some(h=>h>0)).toBe(true);
 release();const out=await scan;expect(seen.sort()).toEqual(coins);expect(out.counts.hit).toBe(4);
});
it('中途取消：已经到齐的币照样保留（以前取消就一条都没有）',async()=>{
 const c=new AbortController();const seen:string[]=[];
 const out=await new FishScanner(clock,undefined,undefined,{binance:adapter(async s=>{if(s==='DDDUSDT'){c.abort();await new Promise(r=>setTimeout(r,5));}})}).scan({algorithms:inputs,anchorMs:cut,includeDuplicates:true,signal:c.signal,onProgress:()=>{},onSignal:s=>seen.push(s.symbol)});
 expect(out.status).toBe('cancelled');expect(seen.length).toBeGreaterThan(0);expect(seen).not.toContain('DDDUSDT');
});
