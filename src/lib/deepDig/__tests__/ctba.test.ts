import {readFileSync,writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {computeCtbaSeries,CTBA_DEFAULTS,ctbaFormula,validateCtba} from '@/lib/ctba';
import {CTBA_DEF,compileFeatureFormula,evaluateOnBars,computeFeatureValues,featureWindowMs,definitionKey,mergeFeatureDefs} from '../features';
import {createFormulaEvaluationCache} from '../formula';
import {extractWindow} from '@/lib/deepRsa/window';
import {mbiBars} from './fixtures/mbiBars';
import {qualityFilterChoices,makeQualityBuyFilter} from '@/lib/fish/qualityFilters';
import {qualityDefinition} from '@/lib/fish/quality';
import {collectDeepDigRun,snapshotOf} from '../analysis';
import {deepDigCsv} from '../export';
import {makeData} from './fixtures';
import {runInference} from '../commands';
import type {CampaignGroupReport} from '@/lib/deepRsa/report';
import type {TradeSignal} from '@/lib/signalLibrary';
import {chartFeatureSeries} from '@/lib/featureSource';
import type {KLineData} from 'klinecharts';
const params={...CTBA_DEFAULTS,N:4,f:1,s:2,m:3};
function input(n=50){
 const C=Float64Array.from({length:n},(_,i)=>100*Math.exp(.001*i+.005*Math.sin(i)));
 return {C,H:Float64Array.from(C,()=>110),L:Float64Array.from(C,()=>90),E:C.slice(),B:Float64Array.from(C,()=>60),S:Float64Array.from(C,()=>40),time:Float64Array.from(C,(_,i)=>i*300000)};
}
it('position uses prior N highs/lows, permits breakouts and handles a flat range',()=>{
 for(const [price,want] of [[100,0],[110,1],[90,-1],[120,2],[80,-2]]){
  const b=input();b.C[49]=price;b.H[49]=100000;b.L[49]=1;
  expect(computeCtbaSeries(b,params).T[49]).toBe(want);
 }
 const b=input();b.H.fill(100);b.L.fill(100);expect(computeCtbaSeries(b,params).T[49]).toBe(0);
});
it('EMA is span-based on true log VWAP; M uses sample standard deviation of m log returns',()=>{
 const b=input(),out=computeCtbaSeries(b,params);let fast=Math.log(b.E[0]),slow=fast;
 for(let i=1;i<b.E.length;i++){fast=2/(params.f+1)*Math.log(b.E[i])+(1-2/(params.f+1))*fast;slow=2/(params.s+1)*Math.log(b.E[i])+(1-2/(params.s+1))*slow;}
 const r=[47,48,49].map(i=>Math.log(b.E[i]/b.E[i-1])),mean=r.reduce((a,x)=>a+x,0)/3,sd=Math.sqrt(r.reduce((a,x)=>a+(x-mean)**2,0)/2);
 expect(out.M[49]).toBe((fast-slow)/(sd+params.epsilon));
 const old=out.M[49];b.C.fill(1);expect(computeCtbaSeries(b,params).M[49]).toBe(old);
 for(const direction of [1,-1]){const trend=input();trend.E=Float64Array.from(trend.E,(_,i)=>100*Math.exp(direction*.01*i));expect(Math.sign(computeCtbaSeries(trend,params).M[49])).toBe(direction);}
});
it('flow uses directional amounts, exact exponential weights, lambda zero and missing flags',()=>{
 for(const [buy,sell,want] of [[100,0,1],[0,100,-1],[50,50,0],[0,0,0]]){
  const b=input();b.B.fill(buy);b.S.fill(sell);const out=computeCtbaSeries(b,params);
  expect(out.F[49]).toBeCloseTo(want,12);expect(out.noTrade[49]).toBe(buy+sell===0?1:0);
 }
 const b=input();b.B.fill(0);b.S.fill(100);b.B[49]=100;b.S[49]=0;
 const w=[0,1,2,3].map(i=>Math.exp(-params.lambda*i));expect(computeCtbaSeries(b,params).F[49]).toBeCloseTo(100*(w[0]-w[1]-w[2]-w[3])/(100*w.reduce((a,x)=>a+x,0)+params.epsilon),12);
 expect(computeCtbaSeries(b,{...params,lambda:0}).F[49]).toBeCloseTo(-.5,12);
 b.B[48]=NaN;expect(computeCtbaSeries(b,params).F[49]).toBeNaN();
});
it('composition retains nested tanh and exact weights; validates config',()=>{
 const out=computeCtbaSeries(input(),params),i=49;
 expect(out.CTBA[i]).toBe(100*Math.tanh(.35*Math.tanh(out.T[i])+.4*Math.tanh(out.M[i])+.25*out.F[i]));
 expect(Math.abs(out.CTBA[i])).toBeLessThan(100);
 for(const p of [{...params,f:3,s:2},{...params,m:1},{...params,lambda:-1},{...params,epsilon:0},{...params,alpha:.5}])expect(()=>validateCtba(p)).toThrow();
});
it('warmup, invalid VWAP, gaps and future-prefix equality',()=>{
 const b=input(900),full=computeCtbaSeries(b);
 expect(Array.from(full.CTBA.slice(0,576)).every(Number.isNaN)).toBe(true);
 const prefix=Object.fromEntries(Object.entries(b).map(([k,v])=>[k,v.slice(0,700)])) as typeof b;
 expect(computeCtbaSeries(prefix).CTBA).toEqual(full.CTBA.slice(0,700));
 b.E[899]=NaN;expect(computeCtbaSeries(b).CTBA[899]).toBeNaN();
 b.time[898]+=1;expect(computeCtbaSeries(b).CTBA[899]).toBeNaN();
});
it('shared formula, cache updates, snapshots and exports include components',()=>{
 const bars=mbiBars(1500),compiled=compileFeatureFormula(CTBA_DEF.formula),cache=createFormulaEvaluationCache();
 evaluateOnBars(bars.slice(0,1300),compiled,CTBA_DEF,cache);
 const incremental=evaluateOnBars(bars,compiled,CTBA_DEF,cache),batch=evaluateOnBars(bars,compiled,CTBA_DEF);
 for(const name of ['CTBA','T','M','F','no_trade','data_complete'])expect(incremental.vars.get(name)).toEqual(batch.vars.get(name));
 expect(mergeFeatureDefs([]).some(d=>d.id==='ctba')).toBe(true);
 expect(qualityFilterChoices([CTBA_DEF]).map(c=>c.metric)).toEqual(expect.arrayContaining(['CTBA','T','M','F']));
 const def={...CTBA_DEF,formula:ctbaFormula({...CTBA_DEFAULTS,N:100})};
 expect(definitionKey(def)).not.toBe(definitionKey(CTBA_DEF));
 const filter=makeQualityBuyFilter('ctba:CTBA','>',20,true,[def]);expect(qualityDefinition(filter.snapshot).formula.startsWith(def.formula.split('\n').map(l=>l.replace(/#.*$/,'').trimEnd()).filter(Boolean).join('\n'))).toBe(true);
 const anchor=1500*300000,w=extractWindow(bars,anchor,featureWindowMs(CTBA_DEF)),values=computeFeatureValues(w,compiled,CTBA_DEF);
 expect(values.value).not.toBeNull();const data=makeData();data.definition=snapshotOf(CTBA_DEF);data.rows=[{...data.rows[1],v:values.value,vars:values.vars}];expect(deepDigCsv(data)).toContain('CTBA');expect(deepDigCsv(data)).toContain('data_complete');expect(JSON.parse(JSON.stringify(data)).rows[0].vars).toEqual(values.vars);
 const sample=makeData();sample.definition=snapshotOf(CTBA_DEF);sample.rows=sample.rows.map((r,i)=>({...r,v:Math.sin(i),vars:{T:Math.cos(i),M:Math.sin(i),F:.2,CTBA:Math.sin(i)}}));
 expect(runInference(sample,'ttest(X, 实验组, 对照组)\nregress(endRet ~ T + M + F)').blocks).toHaveLength(2);
});
it('collection stores all 576 pre-anchor candles in the existing series record',async()=>{
 const anchor=Date.UTC(2026,3,15)+120000,start=Math.floor(anchor/300000)*300000-2000*300000,bars=mbiBars(2600).map(b=>({...b,openTime:b.openTime+start}));
 const fetchFn=async(url:string)=>{const u=new URL(url),from=Number(u.searchParams.get('startTime')),to=Number(u.searchParams.get('endTime')),limit=Number(u.searchParams.get('limit'));return {ok:true,status:200,json:async()=>bars.filter(b=>b.openTime>=from&&b.openTime<=to).slice(0,limit).map(b=>[b.openTime,b.open,b.high,b.low,b.close,b.volume,b.openTime+299999,b.quoteVolume,1,0,b.takerBuyQuoteVolume,0])};};
 const result=await collectDeepDigRun({rows:[]} as unknown as CampaignGroupReport,{...CTBA_DEF,source:'signals',positive:'s >= 3',control:'s < 3'},{signals:[{id:'ctba-signal',symbol:'CTBATESTUSDT',timeMs:anchor,quality:5} as TradeSignal],fetchFn,backgroundCap:0});
 const dense=Object.values(result.series.anchorWindows!)[0];
 expect(dense.values.CTBA).toHaveLength(576);expect(Array.from(dense.values.CTBA).every(Number.isFinite)).toBe(true);
 expect(dense.startMs).toBe(Math.floor(anchor/300000)*300000-48*3600000);
 console.info('CTBA integration',JSON.stringify({windowBars:featureWindowMs(CTBA_DEF)/300000,vector:576,CTBA:result.data.rows[0].v,components:result.data.rows[0].vars}));
});

it('native chart matches the shared core, recovers after missing candles and masks forming bars',()=>{
 const bars=mbiBars(1500),k:KLineData[]=bars.map(b=>({timestamp:b.openTime,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,turnover:b.quoteVolume!,takerBuyTurnover:b.takerBuyQuoteVolume!}));
 const expected=evaluateOnBars(bars,compileFeatureFormula(CTBA_DEF.formula),CTBA_DEF).vars.get('CTBA') as Float64Array;
 expect(chartFeatureSeries(k,'ctba',CTBA_DEFAULTS.N)!.core.at(-1)).toBe(expected.at(-1));
 const gap=k.filter((_,i)=>i!==1);expect(chartFeatureSeries(gap,'ctba',CTBA_DEFAULTS.N)!.core.at(-1)).not.toBeNull();
 const forming=k.map((b,i)=>({...b,cba2Closed:i!==k.length-1}));expect(chartFeatureSeries(forming,'ctba',CTBA_DEFAULTS.N)!.core.at(-1)).toBeNull();
 expect(chartFeatureSeries(k.map(b=>({...b,timestamp:b.timestamp*3})),'ctba',CTBA_DEFAULTS.N)).toBeNull();
});

it.skipIf(!process.env.CTBA_REAL_INPUT)('real historical signal sample',async()=>{
 const input=JSON.parse(readFileSync(process.env.CTBA_REAL_INPUT!,'utf8')) as {metadata:{anchorMs:number;symbol:string;timeLabel:string};bars:ReturnType<typeof mbiBars>};
 const anchor=input.metadata.anchorMs;
 const fetchFn=async(url:string)=>{const u=new URL(url),a=Number(u.searchParams.get('startTime')),z=Number(u.searchParams.get('endTime')),limit=Number(u.searchParams.get('limit'));return {ok:true,status:200,json:async()=>input.bars.filter(b=>b.openTime>=a&&b.openTime<=z).slice(0,limit).map(b=>[b.openTime,b.open,b.high,b.low,b.close,b.volume,b.openTime+299999,b.quoteVolume,1,b.takerBuyVolume,b.takerBuyQuoteVolume,0])};};
 const result=await collectDeepDigRun({rows:[]} as unknown as CampaignGroupReport,{...CTBA_DEF,source:'signals',positive:'s >= 3',control:'s < 3'},{signals:[{id:'ctba-real',symbol:input.metadata.symbol,timeMs:anchor,quality:5} as TradeSignal],fetchFn,backgroundCap:0});
 expect(result.data.rows).toHaveLength(1);expect(result.data.rows[0].v).not.toBeNull();
 const dense=Object.values(result.series.anchorWindows!)[0];expect(Array.from(dense.values.CTBA).every(Number.isFinite)).toBe(true);
 console.info('CTBA real',JSON.stringify({symbol:input.metadata.symbol,time:input.metadata.timeLabel,values:result.data.rows[0].vars}));
 if(process.env.CTBA_REAL_OUTPUT)writeFileSync(process.env.CTBA_REAL_OUTPUT,JSON.stringify({...result,metadata:input.metadata},(_k,v)=>v instanceof Float64Array||v instanceof Float32Array?Array.from(v):v,2));
});
