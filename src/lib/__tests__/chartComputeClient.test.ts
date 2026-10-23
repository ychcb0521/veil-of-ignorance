import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { compileFeatureFormula } from '../deepDig/features';
const fake=vi.hoisted(()=>({worker:undefined as any,messages:[] as any[],frames:[] as FrameRequestCallback[]}));
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals()});
beforeEach(()=>{vi.useFakeTimers();vi.resetModules();fake.messages=[];fake.frames=[];vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{fake.frames.push(fn);return fake.frames.length});vi.stubGlobal('Worker',class{onmessage:any;onerror:any;terminate=vi.fn();constructor(){fake.worker=this}postMessage(data:any){fake.messages.push(data)}})});
const data=()=>[{timestamp:1000,open:1,high:2,low:1,close:1,volume:10,turnover:10,takerBuyTurnover:5},{timestamp:2000,open:1,high:3,low:1,close:2,volume:10,turnover:20,takerBuyTurnover:10}];
const request=(bars:ReturnType<typeof data>,signature:string)=>({data:bars,signature,compiled:compileFeatureFormula('X=C'),params:{interval:'5m' as const},variables:['X'],core:'X',def:{id:'test',formula:'X=C',scale:1} as any});
const reply=(job:any,first:number,last:number,values:number[])=>fake.worker.onmessage({data:{id:job.id,first,last,vars:{X:Float64Array.from(values)},packet:job.packet}});
it('keeps only the latest pending snapshot and repaints without blocking price updates',async()=>{
 const c=await import('../chartComputeClient'),bars=data();c.enableChartComputation(bars);expect(c.isChartComputationEnabled(bars)).toBe(true);
 expect(c.requestChartComputation('X',request(bars,'a'))).toBeNull();bars[1].close=2.1;c.requestChartComputation('X',request(bars,'b'));bars[1].close=2.2;c.requestChartComputation('X',request(bars,'c'));expect(fake.messages).toHaveLength(1);
 reply(fake.messages[0],1000,2000,[1,2]);expect(fake.messages).toHaveLength(2);expect(new Float64Array(fake.messages[1].packet)[14]).toBe(2.2);
 expect(c.requestChartComputation('X',request(bars,'c'))?.vars.get('X')).toEqual([1,2]);expect(fake.messages).toHaveLength(2);
 reply(fake.messages[1],1000,2000,[1,2.2]);expect(c.requestChartComputation('X',request(bars,'c'))?.vars.get('X')).toEqual([1,2.2]);expect(fake.frames).toHaveLength(1);fake.frames[0](0);expect(c.chartComputationVersion()).toBe(1);vi.unstubAllGlobals();
});
it('rejects future results after a rewind and results from a replaced history window',async()=>{
 const c=await import('../chartComputeClient'),bars=data();c.enableChartComputation(bars);c.requestChartComputation('X',request(bars,'a'));bars.pop();c.requestChartComputation('X',request(bars,'rewind'));reply(fake.messages[0],1000,2000,[1,2]);expect(c.requestChartComputation('X',request(bars,'rewind'))).toBeNull();reply(fake.messages[1],1000,1000,[1]);expect(c.requestChartComputation('X',request(bars,'rewind'))?.vars.get('X')).toEqual([1]);
 bars[0]={...bars[0],timestamp:3000,close:3};c.requestChartComputation('X',request(bars,'replace'));reply(fake.messages[2],1000,1000,[1]);expect(c.requestChartComputation('X',request(bars,'replace'))).toBeNull();vi.unstubAllGlobals();
});
it('keeps static analysis synchronous and falls back safely if worker initialization fails',async()=>{
 const c=await import('../chartComputeClient'),bars=data();expect(c.isChartComputationEnabled(bars)).toBe(false);vi.stubGlobal('Worker',class{constructor(){throw Error('unavailable')}});c.enableChartComputation(bars);c.requestChartComputation('X',request(bars,'a'));expect(c.isChartComputationEnabled(bars)).toBe(false);vi.unstubAllGlobals();
});
it('sends exact suffixes only for explicit mutations and resets for history or reference corrections',async()=>{
 const c=await import('../chartComputeClient'),bars=data();const changes:[number,number][]=[[1,0]];
 const r=(revision:number,referenceVersion=0)=>({...request(bars,String(revision)+':'+referenceVersion),delta:{revision,referenceVersion,changes}});
 c.requestChartComputation('X',r(1));expect(fake.messages[0].from).toBe(0);reply(fake.messages[0],1000,2000,[1,2]);
 bars[1].close=2.5;changes.push([2,1]);c.requestChartComputation('X',r(2));expect(fake.messages[1].from).toBe(1);expect(new Float64Array(fake.messages[1].packet)[4]).toBe(2.5);reply(fake.messages[1],1000,2000,[1,2.5]);
 bars[0].close=1.5;changes.push([3,0]);c.requestChartComputation('X',r(3));expect(fake.messages[2].from).toBe(0);reply(fake.messages[2],1000,2000,[1.5,2.5]);
 c.requestChartComputation('X',r(3,1));expect(fake.messages[3].from).toBe(0);vi.unstubAllGlobals();
});

it('recovers from a worker that never returns instead of freezing the display forever', async()=>{
 const c=await import('../chartComputeClient'),bars=data(),listener=vi.fn();const unsubscribe=c.subscribeChartComputation(listener);c.enableChartComputation(bars);
 c.requestChartComputation('X',request(bars,'a'));vi.advanceTimersByTime(14999);expect(c.isChartComputationEnabled(bars)).toBe(true);
 vi.advanceTimersByTime(1);expect(c.isChartComputationEnabled(bars)).toBe(false);expect(fake.worker.terminate).toHaveBeenCalledOnce();
 fake.frames.at(-1)!(0);expect(listener).toHaveBeenCalledOnce();unsubscribe();
});
it('cancels the watchdog on completion and when the chart unsubscribes', async()=>{
 const c=await import('../chartComputeClient'),bars=data();const unsubscribe=c.subscribeChartComputation(vi.fn());c.enableChartComputation(bars);
 c.requestChartComputation('X',request(bars,'a'));reply(fake.messages[0],1000,2000,[1,2]);vi.advanceTimersByTime(20000);expect(c.isChartComputationEnabled(bars)).toBe(true);
 c.requestChartComputation('X',request(bars,'b'));unsubscribe();expect(vi.getTimerCount()).toBe(0);
});
