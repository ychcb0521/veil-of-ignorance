import { expect, it, vi } from 'vitest';
import { preEntryWindowLoader } from '../preEntryWindowLoader';
import { compileFishProgram } from '../algorithm';
import type { FishReconstructionLoader } from '../reconstruction';
import { TURING_INITIALIZATION_VERSION } from '../qualityInitialization';

const M=60000,T=Date.UTC(2026,10,9),row={id:'r',symbol:'TESTUSDT',timeMs:T+48*60*M,timeLabel:'',fallbackZone:''};
const plan=(interval:'1m'|'5m')=>compileFishProgram({id:interval,name:'price',short:'p',definition:'',formula:'C',interval,scale:1,unit:'',positive:'1',control:'0'},{statistic:'结果',direction:'>',threshold:0,constraints:[]});
const bars=(from:number,to:number,step:number)=>Array.from({length:(to-from)/step},(_,i)=>({openTime:from+i*step,open:100,high:101,low:99,close:100+i,volume:1,takerBuyVolume:0.5}));

it.each(['1m','5m'] as const)('batches %s transport and exposes exactly each requested causal prefix',async interval=>{
 const p=plan(interval),base=vi.fn<FishReconstructionLoader>(async(_row,from,to,p)=>bars(from,to,p.step));
 const end=T+1200*p.step,load=preEntryWindowLoader(base,end),signal=new AbortController().signal;
 for(let i=0;i<1200;i++){
  const from=T+i*p.step,result=await load(row,from,from+p.step,p,signal);
  expect(result).toHaveLength(1);expect(result[0].openTime).toBe(from);
 }
 expect(base).toHaveBeenCalledTimes(interval==='1m'?3:12);
 expect(base.mock.calls.every(c=>c[2]<=end)).toBe(true);
});
it('does not let a future gap hide an earlier valid minute or silently pass a current gap',async()=>{
 const p=plan('1m'),gap=T+4*M;
 const base=vi.fn<FishReconstructionLoader>(async(_row,from,to,p)=>bars(from,to,p.step).filter(b=>b.openTime!==gap));
 const load=preEntryWindowLoader(base,T+20*M),signal=new AbortController().signal;
 expect((await load(row,T,T+M,p,signal)).map(b=>b.openTime)).toEqual([T]);
 expect((await load(row,T+3*M,T+4*M,p,signal)).map(b=>b.openTime)).toEqual([T+3*M]);
 await expect(load(row,T+4*M,T+5*M,p,signal)).rejects.toThrow();
});
it('keeps symbol, source time and indicator input dependencies in separate caches',async()=>{
 const p=plan('1m'),btc={...p,compiled:{...p.compiled,usesBtc:true}};
 const base=vi.fn<FishReconstructionLoader>(async(r,from,to,p)=>bars(from,to,p.step).map(b=>({...b,close:r.symbol==='OTHERUSDT'?200:100,...(p.compiled.usesBtc?{refClose:60000}:{})})));
 const load=preEntryWindowLoader(base,T+600*M),signal=new AbortController().signal;
 expect((await load(row,T,T+M,p,signal))[0].refClose).toBeUndefined();
 expect((await load(row,T,T+M,btc,signal))[0].refClose).toBe(60000);
 expect((await load({...row,symbol:'OTHERUSDT'},T,T+M,p,signal))[0].close).toBe(200);
 await load({...row,timeMs:row.timeMs+M},T,T+M,p,signal);expect(base).toHaveBeenCalledTimes(4);
});
it('honors cancellation even when the underlying read returns after being aborted',async()=>{
 const controller=new AbortController(),p=plan('1m');
 const base:FishReconstructionLoader=async(_r,from,to,p)=>{controller.abort();return bars(from,to,p.step);};
 await expect(preEntryWindowLoader(base,T+10*M)(row,T,T+M,p,controller.signal)).rejects.toMatchObject({name:'AbortError'});
});
it('retains initialization metadata and does not prefetch unsupported candle intervals',async()=>{
 const p=plan('1m'),other={...p,step:15*M};
 const base=Object.assign(vi.fn<FishReconstructionLoader>(async(_r,from,to,p)=>bars(from,to,p.step)),{
  turingInitialization:{version:TURING_INITIALIZATION_VERSION,startMs:T},
 });
 const load=preEntryWindowLoader(base,T+60*M),signal=new AbortController().signal;
 expect(load.turingInitialization).toBe(base.turingInitialization);
 await load(row,T,T+15*M,other,signal);expect(base.mock.calls[0][2]).toBe(T+15*M);
});
