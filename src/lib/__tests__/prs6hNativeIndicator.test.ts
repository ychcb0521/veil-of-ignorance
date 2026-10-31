import {it,expect} from 'vitest';
import {PRS6H_DEF,compileFeatureFormula,evaluateOnBars} from '../deepDig/features';
import {CUSTOM_RESEARCH_INDICATORS,researchChartSeries,researchKcName} from '../researchIndicators';
import {CUSTOM_INDICATOR_MAP,INDICATOR_COMPANIONS} from '../customIndicators';
import {INDICATOR_CATALOG} from '@/components/IndicatorMenu';
import {prsPositive} from '../deepDig/__tests__/fixtures/prsBars';
it('is a selectable native indicator like CDA with its own 0–100 pane',()=>{
 const item=CUSTOM_RESEARCH_INDICATORS.find(i=>i.id==='PRS6H')!;expect(item).toMatchObject({featureId:'prs_intraday_add_evidence_6h',core:'PRS6H',marketEvidence:true,min:0,max:100});
 expect(CUSTOM_INDICATOR_MAP.PRS6H).toBe(researchKcName('PRS6H'));expect(INDICATOR_COMPANIONS.PRS6H).toHaveLength(2);expect(INDICATOR_CATALOG.some(i=>i.id==='PRS6H')).toBe(true);
});
it('native chart, Deep Dig and closed-bar core match without reclassifying the forming bar as invalid history',()=>{
 const item=CUSTOM_RESEARCH_INDICATORS.find(i=>i.id==='PRS6H')!,{bars}=prsPositive(),data=bars.map(b=>({timestamp:b.openTime,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,turnover:b.quoteVolume,PRS6H_tick_size:.01,researchSymbol:'TESTUSDT'}));
 const native=researchChartSeries(data,item,.5,{fetchReference:false}),out=evaluateOnBars(bars,compileFeatureFormula(PRS6H_DEF.formula),{...PRS6H_DEF,PRS6H_symbol:'TESTUSDT'});
 expect(native.core).toEqual(Array.from(out.vars.get('PRS6H') as Float64Array,v=>Number.isFinite(v)?v:null));expect(native.core.at(-1)).toBeGreaterThanOrEqual(70);expect(native.avg.some(v=>v!==null)).toBe(true);
 const live=data.map((b,i)=>({...b,cba2Closed:i!==data.length-1})),forming=researchChartSeries(live,item,.5,{fetchReference:false});expect(forming.core.at(-1)).toBeNull();expect(forming.core.slice(0,-1)).toEqual(native.core.slice(0,-1));
});

it('quote evidence survives an absent taker column without changing the legacy amount-pair contract',async()=>{
 const {klineAmountFields,chartAmountFields}=await import('@/hooks/useBinanceData'),parsed=klineAmountFields([0,1,2,1,1,1,0,100]);
 expect(parsed.quoteVolume).toBeUndefined();expect(parsed.takerBuyQuoteVolume).toBeUndefined();expect(parsed.ATI6H_quoteVolume).toBe(100);expect(chartAmountFields(parsed)).toEqual({ATI6H_quoteVolume:100});
});
