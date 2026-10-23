import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fake=vi.hoisted(()=>({worker:undefined as any,messages:[] as any[],frames:[] as FrameRequestCallback[],history:[] as any[]}));
vi.mock('../researchChartHistory',()=>({chartPrehistory:()=>fake.history,researchHistoryVersion:()=>0}));
vi.mock('../btcReference',()=>({requestBtcReference:vi.fn(),btcReferenceVersion:()=>0,btcClosesAt:(times:number[])=>times.map(()=>100)}));
const bars=(times:number[])=>times.map(timestamp=>({timestamp,open:1,high:2,low:1,close:1,volume:10,turnover:10,takerBuyTurnover:5}));
beforeEach(()=>{vi.resetModules();vi.useFakeTimers();fake.messages=[];fake.frames=[];fake.history=bars([0,300000,600000]);vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{fake.frames.push(fn);return fake.frames.length});vi.stubGlobal('Worker',class{onmessage:any;onerror:any;terminate(){}constructor(){fake.worker=this}postMessage(m:any){fake.messages.push(m)}})});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals()});
const reply=(job:any,first:number,last:number,values:number[])=>fake.worker.onmessage({data:{id:job.id,first,last,vars:{state:Float64Array.from(values),avg_state:Float64Array.from(values),avg_state_2:Float64Array.from(values)},packet:job.packet}});
async function setup(){const c=await import('../chartComputeClient'),r=await import('../researchIndicators');return{...c,...r,spec:r.CUSTOM_RESEARCH_INDICATORS.find(x=>x.id==='STATE')!}}
it('keeps hidden warmup aligned and pads an uncomputed new candle with a gap',async()=>{
 const c=await setup(),data=bars([900000,1200000]);c.enableChartComputation(data);
 expect(c.researchChartSeries(data,c.spec,24).core).toEqual([null,null]);reply(fake.messages[0],0,1200000,[.1,.2,.3,.4,.5]);
 expect(c.researchChartSeries(data,c.spec,24).core).toEqual([.4,.5]);data.push({...data[0],timestamp:1500000});c.invalidateResearchChartData(data);
 expect(c.researchChartSeries(data,c.spec,24).core).toEqual([.4,.5,null]);
});
it('retains all known line values by timestamp when native prepend replaces the candle array',async()=>{
 const c=await setup(),data=bars([900000,1200000]);c.enableChartComputation(data);
 c.researchChartSeries(data,c.spec,24);reply(fake.messages[0],0,1200000,[.1,.2,.3,.4,.5]);expect(c.researchChartSeries(data,c.spec,24).avg2).toEqual([.4,.5]);
 const older=bars([600000]);c.enableChartComputation(older);const expanded=older.concat(data);fake.history=bars([0,300000]);
 const pending=c.researchChartSeries(expanded,c.spec,24);expect(pending.pending).toBe(true);expect(pending.core).toEqual([null,.4,.5]);expect(pending.avg).toEqual([null,.4,.5]);expect(pending.avg2).toEqual([null,.4,.5]);
 const job=fake.messages.at(-1);reply(job,0,1200000,[.11,.22,.33,.44,.55]);fake.frames.splice(0).forEach(fn=>fn(0));
 expect(c.researchChartSeries(expanded,c.spec,24).core).toEqual([.33,.44,.55]);
});
it('retains a displayed curve when hidden warmup is replaced while replay keeps appending',async()=>{
 const c=await setup(),data=bars([900000,1200000]);c.enableChartComputation(data);c.researchChartSeries(data,c.spec,24);reply(fake.messages[0],0,1200000,[.1,.2,.3,.4,.5]);expect(c.researchChartSeries(data,c.spec,24).core).toEqual([.4,.5]);
 fake.history=bars([-300000,0,300000,600000]);data.push(...bars([1500000]));c.invalidateResearchChartData(data);
 expect(c.researchChartSeries(data,c.spec,24).core).toEqual([.4,.5,null]);
});
it('never reuses a different chart, symbol, formula, or future candle for continuity',async()=>{
 const c=await setup(),data=bars([900000,1200000]);c.enableChartComputation(data);c.researchChartSeries(data,c.spec,24);reply(fake.messages[0],0,1200000,[.1,.2,.3,.4,.5]);expect(c.researchChartSeries(data,c.spec,24).core).toEqual([.4,.5]);
 const other=bars([900000,1200000]);c.enableChartComputation(other);expect(c.researchChartSeries(other,c.spec,24).core).toEqual([null,null]);
 expect(c.researchChartSeries(data,c.spec,12).core).toEqual([null,null]);
 const rewind=[...bars([600000]),data[0]];c.enableChartComputation(rewind);fake.history=bars([0,300000]);expect(c.researchChartSeries(rewind,c.spec,24).core).toEqual([null,.4]);
});
it('keeps curves and the worker program across a forward repair, aligning in-flight values by timestamp',async()=>{
 const c=await setup();fake.history=[];const data=bars([900000,1200000,1800000]);c.enableChartComputation(data);
 c.researchChartSeries(data,c.spec,24);reply(fake.messages[0],900000,1800000,[.4,.5,.7]);expect(c.researchChartSeries(data,c.spec,24).core).toEqual([.4,.5,.7]);
 data[2].close=2;c.invalidateResearchChartData(data);c.researchChartSeries(data,c.spec,24);const old=fake.messages.at(-1);
 const repaired=bars([900000,1200000,1500000,1800000,2100000]);c.inheritForwardResearchChartData(data,repaired);c.enableChartComputation(repaired);
 expect(c.researchChartSeries(repaired,c.spec,24).core).toEqual([.4,.5,null,.7,null]);
 reply(old,900000,1800000,[.41,.51,.71]);
 expect(c.researchChartSeries(repaired,c.spec,24).core).toEqual([.41,.51,null,.71,null]);
 const job=fake.messages.at(-1);expect(job.id).toBe(old.id);expect(job.from).toBe(0);expect(job.length).toBe(5);
 reply(job,900000,2100000,[.44,.55,.66,.77,.88]);fake.frames.splice(0).forEach(fn=>fn(0));
 expect(c.researchChartSeries(repaired,c.spec,24).core).toEqual([.44,.55,.66,.77,.88]);
});
