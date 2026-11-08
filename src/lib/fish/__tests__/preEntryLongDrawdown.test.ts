import {expect,it,vi} from 'vitest';
import {EntryDrawdownWindow,createEntryLongDrawdownReader} from '../preEntryLongDrawdown';
import type {ResearchBar} from '@/lib/deepRsa/window';
import type {FishReconstructionLoader} from '../reconstruction';
const M=60000,T=Date.UTC(2026,10,9),row={id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''};
const bar=(at:number,close=100,high=close,low=close):ResearchBar=>({openTime:at,open:close,close,high,low,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50});
it('rejects invalid historical prices instead of interpreting them as a drawdown reading',()=>{for(const b of [bar(T,100,NaN),bar(T,100,100,0),bar(T,100,90,100)])expect(()=>new EntryDrawdownWindow().push(b)).toThrow('价格无效');});
it('matches a chronological brute-force drawdown calculation as old peaks expire from the sliding window',()=>{
 for(const size of [1,2,7,31,100]){const queue=new EntryDrawdownWindow(),all:ResearchBar[]=[];
  for(let i=0;i<800;i++){const b=bar(T+i*M,100+(i*17%29),135+(i*13%53),70+(i*7%19));all.push(b);queue.push(b);queue.trim(T+(i-size+1)*M);const window=all.slice(-size);let peak=0,max=0;for(const x of window){peak=Math.max(peak,x.high);max=Math.max(max,(peak-x.low)/peak*100);}expect(queue.reading(b.close,'maximum')).toBeCloseTo(max,10);expect(queue.reading(b.close,'current')).toBeCloseTo((Math.max(...window.map(x=>x.high))-b.close)/Math.max(...window.map(x=>x.high))*100,10);}
 }
});
function loadWithPeak(){return vi.fn<FishReconstructionLoader>(async(_r,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{const at=from+i*p.step;return bar(at,100,at===T-2*M?200:100);}));}
it('includes peaks before the local observation start, never loads future bars, and allows recovery after the peak leaves the configured window',async()=>{
 const load=loadWithPeak(),read=createEntryLongDrawdownReader({condition:{enabled:true,hours:.1,pct:10,mode:'current'},row,load,signal:new AbortController().signal});
 const first=await read(T+M,bar(T));expect(first).toMatchObject({blocked:expect.stringContaining('50%'),reading:{value:50,met:true,role:'veto'}});expect(load.mock.calls.every(c=>c[2]<=T+M)).toBe(true);
 for(let i=1;i<4;i++)expect((await read(T+(i+1)*M,bar(T+i*M))).blocked).toBeDefined();
 expect((await read(T+5*M,bar(T+4*M))).blocked).toBeUndefined();expect(load.mock.calls).toHaveLength(1);
});
it('distinguishes recovered current drawdown from a maximum drawdown already seen in the window',async()=>{
 for(const mode of ['current','maximum'] as const){const read=createEntryLongDrawdownReader({condition:{enabled:true,hours:.1,pct:10,mode},row,load:loadWithPeak(),signal:new AbortController().signal});await read(T+M,bar(T));const recovered=await read(T+2*M,bar(T+M,200));expect(recovered.reading!.value).toBe(mode==='current'?0:50);expect(!!recovered.blocked).toBe(mode==='maximum');}
});
it('waits for a complete historical window and fails on a real gap instead of silently passing',async()=>{
 const load=loadWithPeak(),read=createEntryLongDrawdownReader({condition:{enabled:true,hours:.1,pct:10,mode:'current'},row,load,signal:new AbortController().signal,availableStart:T});expect((await read(T+M,bar(T))).pending).toContain('历史不足');expect(load).not.toHaveBeenCalled();expect((await read(T+6*M,bar(T+5*M))).pending).toBeUndefined();
 const broken=createEntryLongDrawdownReader({condition:{enabled:true,hours:.1,pct:10,mode:'maximum'},row,load:async(...args)=>(await load(...args)).filter(b=>b.openTime!==T-3*M),signal:new AbortController().signal});await expect(broken(T+M,bar(T))).rejects.toThrow();
});
it('fetches only one warmup window across hundreds of subsequent observations',async()=>{
 const load=loadWithPeak(),read=createEntryLongDrawdownReader({condition:{enabled:true,hours:24,pct:10,mode:'maximum'},row,load,signal:new AbortController().signal});for(let i=0;i<800;i++)await read(T+(i+1)*M,bar(T+i*M));expect(load.mock.calls.length).toBeLessThanOrEqual(3);
});
