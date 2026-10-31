import {describe,it,expect} from 'vitest';
import {computeDbl5} from '../dbl5m';
import {computeSbs5m} from '../sbs5m';
import {sample,T} from './fixtures/dblBars';
import {sbsComplete,SBS_T} from './fixtures/sbsBars';
import {defaultStructureAddition,structureAdditionSignal,structureAdditionK,validateStructureAddition,createStructureAdditionReader,type StructureAdditionRule,type StructureAdditionEvidence} from '../fish/qualityAdditionStructure';
import {findCalculatorAdditions} from '../fish/qualityAdditionCalculator';
import {additionIdentity,defaultQualityAddition,validateQualityAddition,additionEvidenceHeaders,additionEvidenceValues} from '../fish/qualityAddition';
import {evaluateQualitySample,type QualityGroup,type QualitySample} from '../fish/quality';
import {definitionKey} from '../deepDig/features';
import {buildQualityCampaignData} from '../fish/qualityCampaigns';
import type {ResearchBar} from '../deepRsa/window';
import type {FishReconstructionLoader} from '../fish/reconstruction';
const M=60000,STEP=5*M;
const row={id:'structure',symbol:'TESTUSDT',timeMs:T+400*STEP,timeLabel:'',fallbackZone:''};
const plain=(at:number,price=90):ResearchBar=>({openTime:at,open:price,high:price+1,low:price-1,close:price,volume:10,quoteVolume:1000,takerBuyVolume:5,takerBuyQuoteVolume:500,DBL5_tick_size:1,SBS5M_tick_size:.1,PRS6H_tick_size:.1});
function context(input:ResearchBar[],entry=input[0].openTime-STEP,end=input.at(-1)!.openTime+2*STEP){
 const map=new Map(input.map(b=>[b.openTime,b])),requests:{from:number;to:number;step:number}[]=[];
 const minute=(at:number)=>{if(at<input[0].openTime)return plain(at);const b=map.get(Math.floor(at/STEP)*STEP)??input.at(-1)!;return {...b,openTime:at,open:b.close,low:b.close-.1,high:b.close+.1};};
 const load:FishReconstructionLoader=async(_row,from,to,p)=>{requests.push({from,to,step:p.step});return Array.from({length:(to-from)/p.step},(_,i)=>{const at=from+i*p.step;return p.step===STEP?map.get(at)??plain(at):minute(at);});};
 const prices=Array.from({length:(end-entry)/M},(_,i)=>minute(entry+i*M));
 return {row:{...row,timeMs:end},entry,entryPrice:90,notional:100,end,since:entry,prices,previous:[],mirror:{at:entry+M,price:100,fraction:.5,atOpen:true,gainPct:(100/90-1)*100},repeat:true,candidates:[],entryBufferAtr:0,load,signal:new AbortController().signal,requests};
}
const rule=(algorithm:'dbl5'|'sbs5m'='dbl5',trigger:StructureAdditionRule['trigger']='raise')=>({...defaultStructureAddition(algorithm),trigger,buffer:0});
const dblRows=()=>computeDbl5(sample(),{symbol:row.symbol}).rows;
const evidence=()=>structureAdditionSignal(rule('dbl5','confirm'),dblRows()[7],T-24*3600000)!;

describe('native box decisions for holding additions',()=>{
 it('accepts only selected full confirmations and distinguishes raised support from baseline',()=>{
  const rows=dblRows();expect(rows.flatMap(r=>structureAdditionSignal(rule(),r,T)??[]).map(e=>[e.event,e.supportPrice])).toEqual([['UP_STEP',102]]);
  expect(rows.flatMap(r=>structureAdditionSignal(rule('dbl5','confirm'),r,T)??[]).map(e=>[e.event,e.supportPrice])).toEqual([['BASELINE',100],['UP_STEP',102]]);
  expect(structureAdditionSignal(rule(),rows[17],T)).toBeUndefined();
 });
 it('uses SBS confirmed raises and independent retests; pending formation never qualifies',()=>{
  const rows=computeSbs5m(sbsComplete(),{symbol:row.symbol,tickSize:.1}).rows;
  expect(rows.flatMap(r=>structureAdditionSignal(rule('sbs5m'),r,SBS_T)??[]).map(e=>[e.event,e.supportPrice])).toEqual([['STEP_CONFIRMED',104]]);
  expect(rows.flatMap(r=>structureAdditionSignal(rule('sbs5m','retest'),r,SBS_T)??[]).map(e=>e.event)).toEqual(['RETEST_SUCCEEDED']);
  expect(rows.slice(0,36).flatMap(r=>structureAdditionSignal(rule('sbs5m','confirm'),r,SBS_T)??[])).toEqual([]);
 });
 it('can use the frozen SBS invalidation price as the K base',()=>{
  const native=computeSbs5m(sbsComplete(),{symbol:row.symbol,tickSize:.1}).rows[45];
  const r={...rule('sbs5m'),kBasis:'invalidation' as const},e=structureAdditionSignal(r,native,SBS_T)!;
  expect(e.basePrice).toBe(native.active!.K);expect(e.nativeInvalidation).toBe(e.basePrice);expect(e.confirmedAt).toBe(e.at);
 });
 it('subtracts chosen ATR or percent redundancy and floors decimal arithmetic to the true tick',()=>{
  expect(structureAdditionK({...evidence(),buffer:.5,tickSize:'.1'},2)).toEqual({k:99,bufferPrice:1});
  expect(structureAdditionK({...evidence(),bufferUnit:'percent',buffer:1.25,tickSize:'.1'},2)).toEqual({k:98.7,bufferPrice:expect.closeTo(1.3)});
  expect(structureAdditionK({...evidence(),basePrice:.3,buffer:1,tickSize:'.1'},.1)?.k).toBe(.2);
  expect(structureAdditionK({...evidence(),buffer:999},2)).toBeUndefined();
 });
 it('validates choices, parameter snapshots and buffer bounds before saving',()=>{
  for(const change of [{buffer:-1},{buffer:NaN},{buffer:100,bufferUnit:'percent'},{trigger:'retest'},{kBasis:'invalidation'},{definition:{...rule().definition,interval:'1m'}},{definition:{...rule().definition,DBL5_config:{n:36}}}])expect(()=>validateStructureAddition({...rule(),...change} as StructureAdditionRule)).toThrow();
  expect(()=>validateStructureAddition({...rule(),buffer:0})).not.toThrow();
  expect(()=>validateQualityAddition({...defaultQualityAddition(),enabled:true,source:'structure',quantityMode:'fixed',structure:rule()})).toThrow('平衡公式');
 });
 it('changes run identity for algorithm, timing, K reference, redundancy and native parameters while retaining old identities',()=>{
  const old={...defaultQualityAddition(),enabled:true},a=additionIdentity(old);expect(a[0]).toBe('holding-add-after-half-2atr-balance-v3');
  const root={...old,source:'structure' as const,structure:rule()};const key=JSON.stringify(additionIdentity(root));
  for(const structure of [{...rule(),buffer:1},{...rule(),trigger:'confirm' as const},rule('sbs5m'),{...rule(),definition:{...rule().definition,DBL5_config:{n:2}}}])expect(JSON.stringify(additionIdentity({...root,structure}))).not.toBe(key);
 });
 it('never uses future confirmation and retains one decision per box across resume and pagination',async()=>{
  const o=context(sample()),read=createStructureAdditionReader(o),r=rule('dbl5','confirm');
  const early=await read(r,o.entry,T+8*STEP,[]);expect(early).toBeUndefined();
  const first=await read(r,o.entry,o.end,[]);expect(first).toMatchObject({at:T+8*STEP,structureEvidence:{supportPrice:100,event:'BASELINE'}});
  const fake={...first!,quantity:1,notional:100};const next=await read(r,o.entry,o.end,[fake]);expect(next).toMatchObject({at:T+14*STEP,structureEvidence:{supportPrice:102}});
  expect(await read(r,first!.at,o.end,[fake])).toEqual(next);
  const restored=await createStructureAdditionReader(o)(r,first!.at,o.end,[fake]);expect(restored).toEqual(next);
  const longer={...o,end:T+250*STEP,row:{...o.row,timeMs:T+250*STEP}};expect(await createStructureAdditionReader(longer)(r,o.entry,longer.end,[])).toEqual(first);
 });
 it('checks closed-price gain at the event itself and discards events before the mirror or last decision',async()=>{
  const o=context(sample()),read=createStructureAdditionReader(o),r=rule('dbl5','confirm');
  expect(await read(r,T+14*STEP,o.end,[])).toBeUndefined();
  expect(await read(r,o.entry,o.end,[],{referencePrice:100,thresholdPct:10})).toBeUndefined();
  const hit=await read(r,o.entry,o.end,[],{referencePrice:100,thresholdPct:2});expect(hit?.priceGate).toMatchObject({observedPrice:103,confirmedAt:T+8*STEP,referencePrice:100});
 });
 it('rejects incomplete venue precision instead of falling back to candidate or inferred support',async()=>{
  const o=context(sample()),load=o.load;o.load=async(...args)=>(await load(...args)).map(b=>({...b,DBL5_tick_size:null,PRS6H_tick_size:null,ATI6H_tick_size:null}));await expect(createStructureAdditionReader(o)(rule(),o.entry,o.end,[])).rejects.toThrow('报价精度');
 });
 it('sizes at the next minute open with the chosen K and preserves the balance equation and export evidence',async()=>{
  const o=context(sample()),r=await findCalculatorAdditions({...o,structure:{...rule(),buffer:.5},maxRounds:1});expect(r.fills).toHaveLength(1);
  const fill=r.fills[0],z=fill.sizing!;expect(fill).toMatchObject({at:T+14*STEP,price:105,structureEvidence:{event:'UP_STEP',supportPrice:102,k:z.support},sizing:{previousSupport:90}});
  expect(z.support).toBeLessThan(102);expect(z.support).toBe(102-fill.structureEvidence!.bufferPrice!);
  expect(z.coinsBefore*(z.support-z.previousSupport)+z.mirrorUsed).toBeCloseTo(fill.quantity*(fill.price-z.support));expect(z.coverageGap).toBeCloseTo(0);
  expect(additionEvidenceValues(fill)).toHaveLength(additionEvidenceHeaders.length);expect(JSON.parse(additionEvidenceValues(fill).at(-1) as string)).toEqual(fill.structureEvidence);
  const wide=await findCalculatorAdditions({...o,structure:{...rule(),buffer:1},maxRounds:1});expect(wide.fills[0].sizing!.support).toBeLessThan(z.support);expect(wide.fills[0].quantity).toBeLessThan(fill.quantity);
 });
 it('keeps an accepted structure and K fixed when resumed and does not add again from an ordinary floor touch',async()=>{
  const o=context(sample()),first=await findCalculatorAdditions({...o,end:T+15*STEP,structure:rule(),maxRounds:3}),full=await findCalculatorAdditions({...o,structure:rule(),maxRounds:3});
  expect(full.fills).toHaveLength(1);expect(full.fills).toEqual(first.fills);
  expect((await findCalculatorAdditions({...o,since:T+15*STEP,previous:first.fills,structure:rule(),maxRounds:3})).fills).toEqual(full.fills);
 });
 it('does not add on a gap below the confirmed floor or when risk budget / entry buffer is insufficient',async()=>{
  const o=context(sample()),prices=o.prices.map(b=>b.openTime===T+14*STEP?{...b,open:101}:b);
  expect((await findCalculatorAdditions({...o,prices,structure:rule()})).fills).toEqual([]);
  expect((await findCalculatorAdditions({...o,structure:{...rule(),buffer:10}})).fills).toEqual([]);
  expect((await findCalculatorAdditions({...o,structure:rule(),entryBufferAtr:100})).fills).toEqual([]);
 });
 it('uses SBS confirmed timing and its native fixed invalidation line through the same calculator',async()=>{
  const input=sbsComplete(),o=context(input),structure={...rule('sbs5m'),kBasis:'invalidation' as const};
  const result=await findCalculatorAdditions({...o,structure,maxRounds:2});expect(result.fills.map(f=>f.structureEvidence!.supportPrice)).toEqual([100,104]);
  const fill=result.fills.at(-1)!;expect(fill.structureEvidence).toMatchObject({algorithm:'sbs5m',event:'STEP_CONFIRMED',supportPrice:104,kBasis:'invalidation'});
  expect(fill.sizing!.support).toBeLessThanOrEqual(fill.structureEvidence!.nativeInvalidation!);
  expect(fill.structureEvidence!.basePrice).toBe(fill.structureEvidence!.nativeInvalidation);
  expect((await findCalculatorAdditions({...o,structure,previous:result.fills,since:fill.at+M})).fills).toEqual(result.fills);
 });
 it('activates the frozen structure K as the protective exit and preserves it on resume',async()=>{
  const o=context(sample()),initial=await findCalculatorAdditions({...o,structure:rule(),maxRounds:1}),fill=initial.fills[0],at=fill.at+M,K=fill.sizing!.support;
  const prices=o.prices.map(b=>b.openTime===at?{...b,open:K+1,high:K+2,low:K-.1}:b);
  const result=await findCalculatorAdditions({...o,prices,structure:rule(),maxRounds:1});expect(result.stop).toMatchObject({at,price:K,support:K,atOpen:false});
  const resumed=await findCalculatorAdditions({...o,prices,structure:rule(),maxRounds:1,previous:[fill],since:at});expect(resumed.stop).toEqual(result.stop);expect(resumed.fills).toEqual(result.fills);
 });
 it('does not let an invalid future candle cancel a previously available event',async()=>{
  const input=sample().map((b,i)=>i===17?{...b,DBL5_tick_size:3}:b),o=context(input);
  const hit=await createStructureAdditionReader(o)(rule('dbl5','confirm'),o.entry,o.end,[]);expect(hit?.at).toBe(T+8*STEP);
 });
 it('integrates structure decisions through evaluateQualitySample, saved campaign and personal sizing validation',async()=>{
  const o=context(sample()),def={id:'never-sell',name:'不卖',short:'不卖',definition:'',formula:'raw = C',scale:1,unit:'',positive:'1',control:'0',interval:'1m' as const};
  const snapshot={featureId:def.id,featureName:def.name,featureShort:def.short,definitionKey:definitionKey(def),statistic:'raw',interval:'1m',scale:1,threshold:0,direction:'<' as const,average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:o.entry};
  const qualitySample:QualitySample={id:'structure-run',enteredAt:o.entry,basis:'capture',importedAt:o.entry,groups:[],source:{...o.row,timeMs:o.entry,fish:snapshot}};
  const group:QualityGroup={id:'g',label:'箱体加仓',snapshot,metric:'raw',rule:{metric:'raw',direction:'<',threshold:0},mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50},addition:{...defaultQualityAddition(),enabled:true,source:'structure',structure:rule(),entryBufferAtr:0,maxRounds:1}};
  const result=await evaluateQualitySample(qualitySample,group,0,T+17*STEP,o.load,o.signal);expect(result.status).not.toBe('error');expect(result.additionFills).toHaveLength(1);
  const data=buildQualityCampaignData('owner',{sample:qualitySample,plan:group,result,detectors:[],observeHours:0,firstEvaluatedAt:o.entry},'sell');expect(data.campaign.comparison!.sellEvidence!.additionFills![0].structureEvidence).toEqual(result.additionFills![0].structureEvidence);
  const {evaluateCampaignAddSizing}=await import('../campaignAddSizingCheck');expect([...evaluateCampaignAddSizing(data).values()].every(v=>v.status==='ok')).toBe(true);
 });
});
