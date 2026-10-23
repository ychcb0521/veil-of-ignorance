import{expect,it,vi}from'vitest';
const fake=vi.hoisted(()=>({worker:undefined as any,messages:[]as any[],history:[0,300000,600000].map(timestamp=>({timestamp,open:1,high:2,low:1,close:1,volume:10,turnover:10,takerBuyTurnover:5}))}));
vi.mock('../researchChartHistory',()=>({chartPrehistory:()=>fake.history,researchHistoryVersion:()=>0}));
vi.mock('../btcReference',()=>({requestBtcReference:vi.fn(),btcReferenceVersion:()=>0,btcClosesAt:(times:number[])=>times.map(()=>100)}));
import{enableChartComputation}from'../chartComputeClient';import{researchChartSeries,CUSTOM_RESEARCH_INDICATORS,invalidateResearchChartData}from'../researchIndicators';
it('keeps hidden warmup aligned when a new candle arrives before worker results',()=>{
 vi.stubGlobal('requestAnimationFrame',()=>1);vi.stubGlobal('Worker',class{onmessage:any;onerror:any;terminate(){}constructor(){fake.worker=this}postMessage(m:any){fake.messages.push(m)}});
 const data=[900000,1200000].map(timestamp=>({timestamp,open:1,high:2,low:1,close:1,volume:10,turnover:10,takerBuyTurnover:5}));const spec=CUSTOM_RESEARCH_INDICATORS.find(x=>x.id==='STATE')!;enableChartComputation(data);
 expect(researchChartSeries(data,spec,24).core).toEqual([null,null]);const job=fake.messages[0];
 fake.worker.onmessage({data:{id:job.id,first:0,last:1200000,vars:{state:Float64Array.from([.1,.2,.3,.4,.5])},packet:job.packet}});
 expect(researchChartSeries(data,spec,24).core).toEqual([.4,.5]);data.push({...data[0],timestamp:1500000});invalidateResearchChartData(data);
 expect(researchChartSeries(data,spec,24).core).toEqual([.4,.5]); // never prepend .3 from the hidden warmup
 vi.unstubAllGlobals();
});
