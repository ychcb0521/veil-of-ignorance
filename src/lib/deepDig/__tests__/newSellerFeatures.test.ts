import { beforeEach, expect, it } from 'vitest';
import { MBI2_DEF, MBI2_BEAR_DEF, CTBA_12H_DEF, CTBA_12H_BEAR_DEF, BUILTIN_FEATURES, FEATURES_KEY, compileFeatureFormula, evaluateOnBars, featureWindowMs, definitionKey, mergeFeatureDefs } from '../features';
import { mbiBars } from './fixtures/mbiBars';
import { createFormulaEvaluationCache } from '../formula';
import { sellerResponse } from '@/lib/sellerResponse';
import { mbi2States, MBI2_BEAR_KEYS, mbi2NOf } from '@/lib/mbi2';
import { chartFeatureSeries, ctbaChartParameterText } from '@/lib/featureSource';
import { researchChartSeries, researchIndicatorForFeature, syncMbi2ChartHours, syncResearchIndicatorConfigs } from '@/lib/researchIndicators';
import { compileFishProgram, evaluateFishProgram } from '@/lib/fish/algorithm';
import { qualityFilterChoices, makeQualityHoldingVeto } from '@/lib/fish/qualityFilters';
import { qualityDefinition } from '@/lib/fish/quality';
import { snapshotOf, collectDeepDigRun } from '../analysis';
import { deepDigCsv, deepDigImageRows } from '../export';
import { makeData } from './fixtures';
import type { CampaignGroupReport } from '@/lib/deepRsa/report';
import type { TradeSignal } from '@/lib/signalLibrary';

const pairs = [[MBI2_DEF,MBI2_BEAR_DEF,'MBI2','MBI2_bear',1],[CTBA_12H_DEF,CTBA_12H_BEAR_DEF,'CTBA','CTBA_12H_bear',100]] as const;
const candles = (data: ReturnType<typeof mbiBars>) => data.map(b=>({timestamp:b.openTime,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,turnover:b.quoteVolume!,takerBuyTurnover:b.takerBuyQuoteVolume!}));
beforeEach(()=>localStorage.clear());

it('registers each independent seller once and preserves the corresponding buyer configuration',()=>{
  const merged=mergeFeatureDefs(mergeFeatureDefs([]));
  for(const [buyer,seller,,core] of pairs){
    expect(seller).not.toBe(buyer);expect(merged.filter(d=>d.id===seller.id)).toHaveLength(1);
    // Seller averages may require more hidden history; the measurement and visible research windows remain identical.
    expect(featureWindowMs(seller)).toBeGreaterThanOrEqual(featureWindowMs(buyer));
    expect(seller.formula).toContain(buyer.formula);
    expect(seller.researchWindowHours).toBe(buyer.researchWindowHours);
    expect(definitionKey(seller)).not.toBe(definitionKey(buyer));
    const before=structuredClone(buyer),edited=structuredClone(seller);
    edited.formula=edited.formula.replace('seller_gain = 2','seller_gain = 3');edited.MBI2_T_HOURS=12;
    expect(buyer).toEqual(before);expect(definitionKey(edited)).not.toBe(definitionKey(seller));
    expect(qualityFilterChoices([seller]).some(c=>c.key===seller.id+':'+core)).toBe(true);
    const veto=makeQualityHoldingVeto(seller.id+':'+core,'<',-.5,true,[seller]);
    const restored=qualityDefinition(veto.snapshot!),sample=mbiBars(1500);
    expect(evaluateOnBars(sample,compileFeatureFormula(restored.formula),restored).vars.get(core)).toEqual(evaluateOnBars(sample,compileFeatureFormula(seller.formula),seller).vars.get(core));
  }
  expect(mbi2NOf(MBI2_BEAR_DEF)).toBe(25);
  expect(mbi2NOf({...MBI2_BEAR_DEF,MBI2_T_HOURS:12})).toBe(144);
  expect(ctbaChartParameterText(CTBA_12H_BEAR_DEF.id,144)).toContain('EMA 8/24');
  expect(ctbaChartParameterText(CTBA_12H_BEAR_DEF.id,144)).toContain('半衰期2h');
});

it.each(pairs)('$1.id keeps signs, missing values and all windows; only negative amplitude strengthens', (buyer,seller,source,core,scale)=>{
  const bars=mbiBars(1900),run=(d:typeof buyer)=>evaluateOnBars(bars,compileFeatureFormula(d.formula),d);
  const old=run(buyer).vars.get(source) as Float64Array,actual=run(seller).vars.get(core) as Float64Array;
  let positive=0,negative=0;
  for(let i=0;i<bars.length;i++){
    if(!Number.isFinite(old[i])){expect(actual[i]).toBeNaN();continue;}
    expect(actual[i]).toBe(sellerResponse(old[i],2,scale));
    if(old[i]>0){positive++;expect(actual[i]).toBe(old[i]);}
    if(old[i]<0){negative++;expect(actual[i]).toBeLessThanOrEqual(old[i]);}
  }
  expect(positive).toBeGreaterThan(0);expect(negative).toBeGreaterThan(0);
  const flat=bars.map(b=>({...b,open:100,high:101,low:99,close:100,volume:100,quoteVolume:10000,takerBuyQuoteVolume:5000}));
  expect((evaluateOnBars(flat,compileFeatureFormula(seller.formula),seller).vars.get(core) as Float64Array).at(-1)).toBe(0);
  const prefix=evaluateOnBars(bars.slice(0,1500),compileFeatureFormula(seller.formula),seller).vars.get(core);
  expect(actual.slice(0,1500)).toEqual(prefix);
  const identity={...seller,formula:seller.formula.replace('seller_gain = 2','seller_gain = 1')};
  expect(run(identity).vars.get(core)).toEqual(old);
  expect(run(buyer).vars.get(source)).toEqual(old);
});

it.each(pairs)('$1.id has the same raw and average readings across chart, fish and incremental calculations', (buyer,seller,source,core)=>{
  const bars=mbiBars(1900),compiled=compileFeatureFormula(seller.formula),cache=createFormulaEvaluationCache();
  evaluateOnBars(bars.slice(0,1400),compiled,seller,cache);
  const inc=evaluateOnBars(bars,compiled,seller,cache),expected=evaluateOnBars(bars,compiled,seller);
  expect(inc.vars).toEqual(expected.vars);
  const plan=compileFishProgram(seller,{statistic:core,direction:'<',threshold:-.3,constraints:[]});
  expect(evaluateFishProgram(bars,plan).average).toEqual(expected.vars.get(core));
  const k=candles(bars),item=researchIndicatorForFeature(seller),actual=researchChartSeries(k,item,item.period,{fetchReference:false});
  for(const [values,name] of [[actual.core,core],[actual.avg,'avg_'+core],[actual.avg2,'avg_'+core+'_2']] as const){
    expect(values).toEqual(Array.from(expected.vars.get(name) as Float64Array,v=>Number.isFinite(v)?v:null));
  }
  const before=chartFeatureSeries(k,buyer.id,item.period)!.core.slice();
  localStorage.setItem('sim_anon_'+FEATURES_KEY,JSON.stringify([{...seller,formula:seller.formula.replace('seller_gain = 2','seller_gain = 3')}]));
  expect(chartFeatureSeries(k,seller.id,item.period)!.core).not.toEqual(actual.core);
  expect(chartFeatureSeries(k,buyer.id,item.period)!.core).toEqual(before);
  const forming=k.map((b,i)=>({...b,cba2Closed:i!==k.length-1}));
  expect(researchChartSeries(forming,item,item.period,{fetchReference:false}).core.at(-1)).toBeNull();
  expect(item.seller).toBe(true);expect(item.neutral).toBe(0);expect(item.min).toBe(-item.max);
});

it('MBI2 seller states, clocks and exports use the enhanced score with their own five output keys',()=>{
  const bars=mbiBars(1900),out=evaluateOnBars(bars,compileFeatureFormula(MBI2_BEAR_DEF.formula),MBI2_BEAR_DEF);
  const expected=mbi2States(out.vars.get('MBI2_bear') as Float64Array,5,MBI2_BEAR_DEF,Float64Array.from(bars,b=>b.openTime));
  for(const [key,values] of [['MBI2_bear_state',expected.state],['MBI2_bear_lead_h',expected.lead],['MBI2_bear_confirm_h',expected.confirm]] as const)expect(out.vars.get(key)).toEqual(values);
  const data=makeData();data.definition=snapshotOf(MBI2_BEAR_DEF);data.rows[0].vars=Object.fromEntries(MBI2_BEAR_KEYS.map((k,i)=>[k,i]));
  expect(deepDigCsv(data).split('\r\n')[0]).toContain(MBI2_BEAR_KEYS.join(','));
  expect([...new Set(deepDigImageRows(data).map(r=>r.name))]).toEqual(MBI2_BEAR_KEYS);
  const configs=[{type:'MBI2',period:25*5/60,mbi2AutoHours:true},{type:'MBI2_BEAR',period:25*5/60,mbi2AutoHours:true}];
  expect(syncMbi2ChartHours(configs,[MBI2_DEF,MBI2_BEAR_DEF],15).map(c=>c.period)).toEqual([6.25,6.25]);
  const synced=syncResearchIndicatorConfigs([{type:'MBI2_BEAR',period:25*5/60,enabled:true}],BUILTIN_FEATURES);
  expect(synced[0].type).toBe('MBI2_BEAR');
});

it('production research computes 144 independent CTBA-12H seller points with T/M/F',async()=>{
  const anchor=1800*300000,bars=mbiBars(2100);
  const fetchFn=async(url:string)=>{const u=new URL(url),a=+u.searchParams.get('startTime')!,z=+u.searchParams.get('endTime')!,limit=+u.searchParams.get('limit')!;return{ok:true,status:200,json:async()=>bars.filter(b=>b.openTime>=a&&b.openTime<=z).slice(0,limit).map(b=>[b.openTime,b.open,b.high,b.low,b.close,b.volume,b.openTime+299999,b.quoteVolume,1,0,b.takerBuyQuoteVolume,0])};};
  const def={...CTBA_12H_BEAR_DEF,source:'signals' as const,positive:'s >= 3',control:'s < 3'};
  const run=await collectDeepDigRun({rows:[]} as unknown as CampaignGroupReport,def,{signals:[{id:'seller-12h',symbol:'CTBA12HSELLERTESTUSDT',timeMs:anchor,quality:5} as TradeSignal],fetchFn,backgroundCap:0});
  const dense=Object.values(run.series.anchorWindows!)[0];
  for(const key of ['CTBA_12H_bear','T','M','F']){expect(dense.values[key]).toHaveLength(144);expect(Array.from(dense.values[key]).every(Number.isFinite)).toBe(true);}
  expect(run.data.rows[0].v).toBe(dense.values.CTBA_12H_bear.at(-1));
  expect(run.data.mbi2Evaluation).toBeUndefined();
},20000);
