import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createQualityMarketRetry} from '../fish/qualityMarketRetry';
import {fishTransport} from '../fish/adapters';
import {FishWeightBudget,FishError} from '../fish/shared';
import {BINANCE_COOLDOWN_KEY, noteBinanceRateLimit} from '../binanceRateLimit';
import {FishScanner} from '../fishScanner';
import {definitionKey} from '../deepDig/features';
import {newQualityStudy,importQualityLibrary,qualityDisplayRows,qualityRunSamples,qualityResultKey,type QualityGroup,type QualityResult} from '../fish/quality';
import {freezeQualityPlan} from '../fish/qualityPlanVersions';

const T=Date.UTC(2026,10,9),M=60000;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(T);localStorage.clear();});
afterEach(()=>{vi.useRealTimers();localStorage.clear();vi.restoreAllMocks();});
it('keeps concurrent quality reads pending through a shared full Retry-After and then retries the same requests',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:429,headers:{'Retry-After':'180'}})).mockImplementation(async()=>new Response('{"ok":true}'));
 const request=fishTransport('binance',fetcher,new FishWeightBudget()),signal=new AbortController().signal,waiting=vi.fn(),retry=createQualityMarketRetry(signal,waiting);
 const first=retry(()=>request('klines?symbol=A',5,signal));await vi.advanceTimersByTimeAsync(0);
 const second=retry(()=>request('klines?symbol=B',5,signal));await vi.advanceTimersByTimeAsync(179999);
 expect(fetcher).toHaveBeenCalledTimes(1);expect(waiting).toHaveBeenCalledWith(T+180000);
 await vi.advanceTimersByTimeAsync(1);await expect(Promise.all([first,second])).resolves.toEqual([{ok:true},{ok:true}]);
 expect(fetcher).toHaveBeenCalledTimes(3);expect(waiting.mock.calls.at(-1)).toEqual([undefined]);
 expect(fetcher.mock.calls.map(c=>String(c[0]))).toEqual(['https://fapi.binance.com/fapi/v1/klines?symbol=A','https://fapi.binance.com/fapi/v1/klines?symbol=A','https://fapi.binance.com/fapi/v1/klines?symbol=B']);
});
it('honors a cooldown extended by another tab before sending the retry',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:429})).mockImplementation(async()=>new Response('{}'));
 const signal=new AbortController().signal,request=fishTransport('binance',fetcher,new FishWeightBudget()),task=createQualityMarketRetry(signal)(()=>request('time',1,signal));
 await vi.advanceTimersByTimeAsync(30000);localStorage.setItem(BINANCE_COOLDOWN_KEY,JSON.stringify({status:429,until:T+300000}));
 await vi.advanceTimersByTimeAsync(269999);expect(fetcher).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);await task;expect(fetcher).toHaveBeenCalledTimes(2);
});
it('respects a long ban-until deadline and can pause immediately without issuing later requests',async()=>{
 const controller=new AbortController(),fetcher=vi.fn(async()=>new Response(JSON.stringify({msg:`IP banned until ${T+3600000}`}),{status:418})),waiting=vi.fn();
 const request=fishTransport('binance',fetcher,new FishWeightBudget()),task=createQualityMarketRetry(controller.signal,waiting)(()=>request('time',1,controller.signal));
 const stopped=expect(task).rejects.toMatchObject({name:'AbortError'});await vi.advanceTimersByTimeAsync(0);expect(waiting).toHaveBeenCalledWith(T+3600000);
 controller.abort();await stopped;await vi.advanceTimersByTimeAsync(3600001);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not retry real data, parameter or formula failures',async()=>{
 const read=vi.fn(async()=>{throw new FishError('读数缺失','readings');});
 await expect(createQualityMarketRetry(new AbortController().signal)(read)).rejects.toThrow('读数缺失');expect(read).toHaveBeenCalledOnce();
});

function monitorFixture(){
 const snapshot={featureId:'fixture',definitionKey:definitionKey({formula:'raw=C',positive:'1',control:'0',interval:'1m'}),statistic:'raw',interval:'1m',scale:1,threshold:0,cutoffMs:T,average:0,cbi2:0,startAverage:0,previousAverage:0};
 const plan:QualityGroup=freezeQualityPlan({id:'p',label:'冻结卖出',metric:'raw',snapshot,rule:{metric:'raw',direction:'<',threshold:200},execution:'intrabar-1m'});
 const study=importQualityLibrary(newQualityStudy(),['DONEUSDT','RETRYUSDT'].map((symbol,i)=>({id:String(i),symbol,timeMs:T,timeLabel:'',fallbackZone:''})));
 study.sellPlans=[plan];study.selectedSellId=plan.id;study.selectedRowIds=qualityDisplayRows(study).map(s=>s.id);study.observeHours=1;
 const samples=qualityRunSamples(study);
 const saved:QualityResult={key:qualityResultKey(samples[0],plan,1),sampleId:samples[0].id,groupId:'p',status:'closed',complete:true,entryTime:T,entryPrice:100,endTime:T+M,endPrice:100,returnPct:0,evaluatedAt:T+M};study.results=[saved];
 return {study,saved};
}
it('a real holding run preserves completed results, waits on 429, and completes only the unfinished row without an error result',async()=>{
 const {study,saved}=monitorFixture(),before=structuredClone(study),results:QualityResult[]=[],progress=vi.fn();let limited=false;
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
  const u=new URL(String(input));if(u.pathname.endsWith('/time'))return new Response(JSON.stringify({serverTime:T+10*M}));
  if(!limited){limited=true;return new Response('{}',{status:429,headers:{'Retry-After':'180'}});}
  const start=Number(u.searchParams.get('startTime')),end=Number(u.searchParams.get('endTime')),rows=[];
  for(let t=start;t<=end;t+=M)rows.push([t,100,101,99,100,1,t+M-1,100,1,.5,50,0]);
  return new Response(JSON.stringify(rows));
 });
 const run=new FishScanner(fetcher).quality({study,task:'monitor',signal:new AbortController().signal,onResult:r=>results.push(r),onProgress:progress});
 await vi.advanceTimersByTimeAsync(0);expect(results).toHaveLength(0);expect(progress.mock.calls.map(([p])=>p)).toContainEqual(expect.objectContaining({waitingUntil:T+180000}));
 const requests=fetcher.mock.calls.length;await vi.advanceTimersByTimeAsync(179999);expect(fetcher).toHaveBeenCalledTimes(requests);
 await vi.advanceTimersByTimeAsync(1000);await run;
 expect(results).toHaveLength(1);expect(results[0]).toMatchObject({sampleId:qualityRunSamples(study)[1].id,status:'closed'});expect(progress.mock.calls.at(-1)![0]).toMatchObject({done:2,total:2});
 expect(fetcher.mock.calls.every(([u])=>!String(u).includes('DONEUSDT'))).toBe(true);expect(study).toEqual(before);expect(study.results[0]).toEqual(saved);
});

it('retries the same holding window after a browser connection failure and preserves existing results', async () => {
 const {study, saved}=monitorFixture();
 const results: QualityResult[]=[];
 const candleRequests: string[]=[];
 const fetcher=vi.fn(async (input: RequestInfo | URL) => {
  const url=new URL(String(input));
  if(url.pathname.endsWith('/time')) return new Response(JSON.stringify({serverTime:T+10*M}));
  candleRequests.push(String(input));
  if(candleRequests.length===1) throw new TypeError('Failed to fetch');
  const rows=[];
  const first=Number(url.searchParams.get('startTime')), last=Number(url.searchParams.get('endTime'));
  for(let t=first;t<=last;t+=M) rows.push([t,100,101,99,100,1,t+M-1,100,1,.5,50,0]);
  return new Response(JSON.stringify(rows));
 });
 const run=new FishScanner(fetcher).quality({study,task:'monitor',signal:new AbortController().signal,onResult:r=>results.push(r),onProgress:()=>{}});
 await vi.advanceTimersByTimeAsync(999);
 expect(results).toHaveLength(0);
 expect(candleRequests).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(100);
 await run;
 expect(candleRequests[1]).toBe(candleRequests[0]);
 expect(candleRequests.every(url=>!url.includes('DONEUSDT'))).toBe(true);
 expect(results).toHaveLength(1);
 expect(results[0]).toMatchObject({status:'closed'});
 expect(study.results).toEqual([saved]);
});
