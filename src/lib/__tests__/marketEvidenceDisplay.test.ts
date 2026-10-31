import {it,expect,beforeEach} from 'vitest';
import {PRS6H_DEF,ATI6H_DEF} from '../deepDig/features';
import {CUSTOM_RESEARCH_INDICATORS,researchChartSeries,researchChartFormula,researchIndicatorForFeature} from '../researchIndicators';
import {chartFeatureHistoryBars} from '../featureSource';
import {indicatorCalcParams,INDICATOR_COMPANIONS,visibleIndicatorCompanions} from '../customIndicators';
import {displayAverage} from '../avgHighlight';
import {prsPositive} from '../deepDig/__tests__/fixtures/prsBars';
beforeEach(()=>localStorage.clear());
it.each([['PRS6H',PRS6H_DEF],['ATI6H',ATI6H_DEF]] as const)('%s supports the same pane visibility and average N contract as CDA',(id,def)=>{
 const item=CUSTOM_RESEARCH_INDICATORS.find(i=>i.id===id)!,config={type:id,period:item.period,avgHours:12};
 expect(INDICATOR_COMPANIONS[id]).toHaveLength(2);expect(visibleIndicatorCompanions(config).map(p=>p.key)).toEqual([id+'#AVG2']);expect(visibleIndicatorCompanions({...config,showAverage:true})).toHaveLength(2);
 for(const level of ['AVG','AVG2'])expect(indicatorCalcParams(id+'_'+level+'_CUSTOM',config).slice(0,2)).toEqual([item.period,12]);
 const full=researchChartFormula(item,def.formula);expect(full).toContain('avg_'+item.core+'_2');expect(chartFeatureHistoryBars(def.id,item.period,full)).toBeGreaterThan(chartFeatureHistoryBars(def.id,item.period,def.formula));
 const copy=researchIndicatorForFeature({...def,id:'my-copy',builtin:false});expect(copy.marketEvidence).toBe(true);expect(copy.rawOnly).not.toBe(true);
});
it('PRS display averages match CDA averaging kernels, leave raw evidence unchanged and hide forming values',()=>{
 const {bars}=prsPositive(),item=CUSTOM_RESEARCH_INDICATORS.find(i=>i.id==='PRS6H')!,data=bars.map(b=>({timestamp:b.openTime,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,turnover:b.quoteVolume,PRS6H_tick_size:.01}));
 const a=researchChartSeries(data,item,.5,{fetchReference:false,averageHours:1}),b=researchChartSeries(data,item,.5,{fetchReference:false,averageHours:12});expect(a.core).toEqual(b.core);
 const asNullable=(x:Float64Array)=>Array.from(x,v=>Number.isFinite(v)?v:null);expect(a.avg).toEqual(asNullable(displayAverage(a.core,1,'avg')));expect(a.avg2).toEqual(asNullable(displayAverage(a.core,1,'avg2')));
 const live=data.map((b,i)=>({...b,cba2Closed:i!==data.length-1})),out=researchChartSeries(live,item,.5,{fetchReference:false,averageHours:1});expect(out.core.at(-1)).toBeNull();expect(out.avg.at(-1)).toBeNull();expect(out.avg2.at(-1)).toBeNull();
});
