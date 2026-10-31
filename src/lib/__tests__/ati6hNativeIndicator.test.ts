import {beforeEach,expect,it,vi} from 'vitest';
import {ATI6H_DEF,compileFeatureFormula,evaluateOnBars} from '../deepDig/features';
import {CUSTOM_RESEARCH_INDICATORS,researchChartSeries,researchChartFormula,researchKcName} from '../researchIndicators';
import {chartFeatureHistoryBars} from '../featureSource';
import {CUSTOM_INDICATOR_MAP,INDICATOR_COMPANIONS,registerCustomIndicators} from '../customIndicators';
import {INDICATOR_CATALOG} from '@/components/IndicatorMenu';
import {CUSTOM_INDICATOR_GROUPS} from '../customIndicatorGroups';
import {mbiBars} from '../deepDig/__tests__/fixtures/mbiBars';
import {ati6hTickSize,peekAti6hTickSize,subscribeAti6hMarketData,clearAti6hMarketCache} from '../ati6hMarketData';
beforeEach(()=>{localStorage.clear();clearAti6hMarketCache();});
it('is a real custom indicator like CDA, listed in the menu and native map, with three independently selectable panes',()=>{
 const item=CUSTOM_RESEARCH_INDICATORS.find(i=>i.id==='ATI6H')!;
 expect(item).toMatchObject({featureId:'ati6h',core:'ATI6H',min:0,max:1,marketEvidence:true});
 expect(CUSTOM_INDICATOR_MAP.ATI6H).toBe(researchKcName('ATI6H'));expect(INDICATOR_COMPANIONS.ATI6H).toHaveLength(2);
 expect(INDICATOR_CATALOG.find(i=>i.id==='ATI6H')?.category).toBe('custom');expect(CUSTOM_INDICATOR_GROUPS.some(g=>(g.ids as readonly string[]).includes('ATI6H'))).toBe(true);
 expect(researchChartFormula(item,ATI6H_DEF.formula)).toContain('avg_ATI6H_2');
});
it.each([[5,'5m'],[15,'15m'],[60,'1h']] as const)('native chart at %i minutes matches Deep Dig exactly and excludes forming bars', (minutes,interval)=>{
 const item=CUSTOM_RESEARCH_INDICATORS.find(i=>i.id==='ATI6H')!,bars=mbiBars(420,minutes*60000).map(b=>({...b,ATI6H_tick_size:.001}));
 const data=bars.map(b=>({timestamp:b.openTime,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,turnover:b.quoteVolume,takerBuyTurnover:b.takerBuyQuoteVolume,ATI6H_tick_size:.001}));
 const out=researchChartSeries(data,item,1,{fetchReference:false});
 const expected=evaluateOnBars(bars,compileFeatureFormula(ATI6H_DEF.formula),{...ATI6H_DEF,interval});
 const values=(name:string)=>Array.from(expected.vars.get(name) as Float64Array,v=>Number.isFinite(v)?v:null);
 expect(out.core).toEqual(values('ATI6H'));expect(out.components?.ATI6H_sC).toEqual(values('ATI6H_sC'));expect(out.avg.some(v=>v!==null)).toBe(true);expect(out.avg2.some(v=>v!==null)).toBe(true);
 expect(chartFeatureHistoryBars('ati6h',1,ATI6H_DEF.formula,minutes)).toBe(Math.ceil(6*60/minutes)+125+2);
 const live=data.map((b,i)=>({...b,cba2Closed:i!==data.length-1})),forming=researchChartSeries(live,item,1,{fetchReference:false});
 expect(forming.core.at(-1)).toBeNull();expect(forming.components?.ATI6H_sA.at(-1)).toBeNull();expect(forming.core.slice(0,-1)).toEqual(out.core.slice(0,-1));
});
it('metadata arrival triggers indicator refresh and never invents a price tick',async()=>{
 const refresh=vi.fn(),stop=subscribeAti6hMarketData(refresh);expect(peekAti6hTickSize('TESTUSDT')).toBeNull();
 const tick=await ati6hTickSize('TESTUSDT',async()=>({ok:true,status:200,json:async()=>({symbols:[{symbol:'TESTUSDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.005'}]}]})}));
 expect(tick).toBe(.005);expect(peekAti6hTickSize('TESTUSDT')).toBe(.005);expect(peekAti6hTickSize('UNKNOWN')).toBeNull();expect(refresh).toHaveBeenCalledTimes(1);stop();
});
