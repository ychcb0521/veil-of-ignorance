import {resolveLegExecution} from '@/lib/campaignLegExecution';
import { describe, expect, it } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import { evaluateQualitySample, qualityResultKey, type QualityGroup, type QualitySample } from '@/lib/fish/quality';
import { defaultQualityMirror, mirrorWeightedReturn, validateQualityMirror } from '@/lib/fish/qualityMirror';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { FishReconstructionLoader } from '@/lib/fish/reconstruction';
import { buildQualityCampaignData } from '@/lib/fish/qualityCampaigns';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { qualitySellKey } from '@/lib/fish/qualityCampaignArchive';
const M=60_000,T=Date.UTC(2026,9,28),signal=()=>new AbortController().signal;
const bar=(t:number,open=100,high=open,low=open,close=open):ResearchBar=>({openTime:t,open,high,low,close,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50,refClose:100});
const sample:QualitySample={id:'a',enteredAt:T,basis:'capture',importedAt:T,groups:[],source:{id:'a',symbol:'AAAUSDT',timeMs:T,timeLabel:'',fallbackZone:''}};
function group():QualityGroup {
 const def={id:'mirror',name:'test',short:'test',formula:'raw = C',scale:1,unit:'',definition:'',positive:'1',control:'0',interval:'5m' as const};
 return {id:'g',label:'test',metric:'raw',execution:'intrabar-1m',snapshot:{featureId:def.id,definitionKey:definitionKey(def),statistic:'raw',interval:'5m',scale:1,threshold:0,direction:'>',average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:T},mirrorTakeProfit:defaultQualityMirror()};
}
const loader=(minute:(t:number)=>ResearchBar):FishReconstructionLoader=>async(_row,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>{
 const t=a+i*p.step;if(p.step===M)return minute(t);
 const minutes=Array.from({length:p.step/M},(_,j)=>minute(t+j*M));
 return {...minutes[0],openTime:t,high:Math.max(...minutes.map(b=>b.high)),low:Math.min(...minutes.map(b=>b.low)),close:minutes.at(-1)!.close};
});
const run=(g:QualityGroup,path:FishReconstructionLoader,minutes=4,prior?:Awaited<ReturnType<typeof evaluateQualitySample>>)=>evaluateQualitySample(sample,g,0,T+minutes*M,path,signal(),prior);
describe('mirror take profit',()=>{
 it('defaults to 5/50, validates both percentages and keeps disabled historic keys unchanged',()=>{
  expect(defaultQualityMirror()).toEqual({enabled:true,gainPct:5,sellPct:50});
  for(const gainPct of [0,-1,Infinity,NaN])expect(()=>validateQualityMirror({enabled:true,gainPct,sellPct:50})).toThrow();
  for(const sellPct of [0,-1,101,Infinity,NaN])expect(()=>validateQualityMirror({enabled:true,gainPct:5,sellPct})).toThrow();
  const g=group(),old={...g,mirrorTakeProfit:undefined};
  expect(qualityResultKey(sample,old,0)).toBe(qualityResultKey(sample,{...g,mirrorTakeProfit:{...g.mirrorTakeProfit!,enabled:false}},0));
  expect(qualityResultKey(sample,g,0)).not.toBe(qualityResultKey(sample,{...g,mirrorTakeProfit:{enabled:true,gainPct:10,sellPct:50}},0));
  expect(qualitySellKey(g)).not.toBe(qualitySellKey({...g,mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:25}}));
 });
 it('sells original coin quantity once at the limit and weights remaining valuation, with exact resume parity',async()=>{
  const g=group(),path=loader(t=>t===T?bar(t,100,105,99,104):bar(t,110,120,109,110));
  const first=await run(g,path,1),whole=await run(g,path),resumed=await run(g,path,4,first);
  expect(first).toMatchObject({status:'open',entryPrice:100,mirrorFill:{at:T,price:105,fraction:.5},remainingFraction:.5,realizedPnl:expect.closeTo(2.5),returnPct:expect.closeTo(4.5)});
  expect(whole.returnPct).toBeCloseTo(7.5);expect(resumed).toEqual(whole);
  expect(await run(g,path,4,whole)).toEqual(whole);
 });
 it('closes only the remaining coins on an ordinary sell and exports two campaign fills with matching total PnL',async()=>{
  const g={...group(),rule:{metric:'raw',direction:'<' as const,threshold:95}},path=loader(t=>t<T?bar(t):t===T?bar(t,100,106,100,104):t===T+M?bar(t,104,104,90,90):bar(t,90));
  const result=await run(g,path);
  expect(result).toMatchObject({status:'closed',endTime:T+2*M,endPrice:90,remainingFraction:0,returnPct:expect.closeTo(-2.5),realizedPnl:expect.closeTo(-2.5)});
  const full=buildQualityCampaignData('owner',{sample,plan:g,result,detectors:[],observeHours:0,firstEvaluatedAt:T},'sell');
  expect(full.tradeRecords.map(r=>[r.quantity,r.exitPrice])).toEqual([[.5,105],[.5,90]]);
  expect(full.campaign.actual_evolution.map(e=>e.event_type)).toEqual(['main_opened','main_partial_closed','main_fully_closed']);
  expect(computeCampaignRealizedPnl(full.campaign,full.legs,full.tradeRecords,{}).total).toBeCloseTo(-2.5);
 });
 it('fully exits at 100%, excludes the rest of the exit candle, and never sells twice',async()=>{
  const g={...group(),mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:100}},path=loader(t=>t===T?bar(t,100,110,1,100):bar(t,999));
  const r=await run(g,path);
  expect(r).toMatchObject({status:'closed',endTime:T,endPrice:105,returnPct:expect.closeTo(5),remainingFraction:0,peakPct:expect.closeTo(5),adversePct:0,exitSnapshot:{cause:{kind:'mirror-take-profit'}}});
  const full=buildQualityCampaignData('owner',{sample,plan:g,result:r,detectors:[],observeHours:0,firstEvaluatedAt:T},'sell');
  expect(full.tradeRecords).toHaveLength(1);expect(full.campaign.actual_evolution).toHaveLength(2);
 });
 it('honors stops before an ambiguous intraminute profit but settles an already observable opening profit first',async()=>{
  const g={...group(),holdingVetoes:[{id:'s',label:'静态回撤',kind:'static-drawdown' as const,direction:'>=' as const,threshold:5,enabled:true}]};
  const stopped=await run(g,loader(t=>t===T?bar(t,100,110,90,100):bar(t)));
  expect(stopped).toMatchObject({status:'closed',endPrice:95,returnPct:expect.closeTo(-5)});expect(stopped.mirrorFill).toBeUndefined();
  const gap=await run(g,loader(t=>t===T?bar(t):bar(t,108,110,90,100)));
  expect(gap).toMatchObject({status:'closed',endPrice:95,mirrorFill:{at:T+M,price:108,atOpen:true},returnPct:expect.closeTo(1.5)});
 });
 it('leaves below-threshold holdings intact and does not trigger before entry',async()=>{
  const r=await run(group(),loader(t=>t<T?bar(t,120):bar(t,100,104)));
  expect(r).toMatchObject({status:'open',returnPct:0});expect(r.mirrorFill).toBeUndefined();
  expect(mirrorWeightedReturn(100,110,{at:T,price:105,fraction:.25,gainPct:5,atOpen:false})).toBeCloseTo(8.75);
 });
});

it('carries mirror sales through a pending ordinary exit and request boundaries without selling again',async()=>{
 const g={...group(),rule:{metric:'raw',direction:'<' as const,threshold:95}},path=loader(t=>t===T+499*M?bar(t,100,106,100,104):t===T+500*M?bar(t,104,104,90,90):t===T+501*M?bar(t,92):bar(t));
 const partial=await run(g,path,500),pending=await run(g,path,501,partial);
 expect(partial.mirrorFill?.at).toBe(T+499*M);expect(pending.pendingExit?.at).toBe(T+501*M);
 const resumed=await run(g,path,503,pending),whole=await run(g,path,503);
 expect(resumed).toEqual(whole);expect(whole.returnPct).toBeCloseTo(-1.5);
});
it('rejects missing price observations instead of inventing a profitable fill',async()=>{
 const r=await run(group(),loader(t=>({...bar(t),high:NaN})));
 expect(r).toMatchObject({status:'error',reason:expect.stringContaining('缺少有效的分钟价格')});expect(r.mirrorFill).toBeUndefined();
});

it('records realized partial profit in an active campaign without turning the remaining position into a full close',async()=>{
 const plan=group(),result=await run(plan,loader(t=>t===T?bar(t,100,106,100,104):bar(t,110)));
 const full=buildQualityCampaignData('owner',{sample,plan,result,detectors:[],observeHours:0,firstEvaluatedAt:T},'sell');
 expect(full.campaign.status).toBe('active');expect(full.campaign.closed_at).toBeNull();expect(full.tradeRecords).toHaveLength(1);
 expect(computeCampaignRealizedPnl(full.campaign,full.legs,full.tradeRecords,{}).total).toBeCloseTo(2.5);
 expect(resolveLegExecution(full.legs[0],full.tradeRecords[0])).toMatchObject({entryPrice:100,exitPrice:null,closeTime:null});
});

it('rejects missing prices on the remaining position after an earlier partial sale',async()=>{
 const r=await run(group(),loader(t=>t===T?bar(t,100,106,100,104):({...bar(t),close:NaN})));
 expect(r.status).toBe('error');expect(r.reason).toContain('缺少有效的分钟价格');
});
