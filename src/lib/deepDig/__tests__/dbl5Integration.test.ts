import {beforeEach,it,expect} from 'vitest';
import {DBL5_DEF,DBL5_DIMENSIONS,PRS6H_DEF,ATI6H_DEF,SBS5M_DEF,compileFeatureFormula,evaluateOnBars,computeFeatureValues,definitionKey,mergeFeatureDefs,intervalOf} from '../features';
import {computeDbl5,DBL5_FIELDS,dbl5Numeric} from '@/lib/dbl5m';
import {T,bar,sample} from '@/lib/__tests__/fixtures/dblBars';
import {compileFishProgram,evaluateFishProgram} from '@/lib/fish/algorithm';
import {qualityDefinition} from '@/lib/fish/quality';
import {collectDeepDigRun,viewForVariable,applyExclusions} from '../analysis';
import {deepDigCsv} from '../export';
import {computeEventSeries} from '../series';
import {researchChartSeries,accountResearchIndicators} from '@/lib/researchIndicators';
import {clearMarketDataCache} from '@/lib/deepRsa/marketData';
import {clearAti6hMarketCache} from '@/lib/ati6hMarketData';
import {parseBinanceKlineRow} from '@/lib/deepRsa/window';
import type {CampaignGroupReport} from '@/lib/deepRsa/report';
import type {TradeSignal} from '@/lib/signalLibrary';
beforeEach(()=>{localStorage.clear();clearMarketDataCache();clearAti6hMarketCache();});
const def={...DBL5_DEF,DBL5_initialization_start:T};
const params={...def,DBL5_symbol:'DBLUSDT',DBL5_tick_size:1};
it('registers main price and three independent units using one causal state machine',()=>{
 const old=[PRS6H_DEF,ATI6H_DEF,SBS5M_DEF].map(definitionKey),bars=sample(),core=computeDbl5(bars,{symbol:'DBLUSDT',tickSize:1,initializationStart:T,initializationId:`start:${T}:v1`}),out=evaluateOnBars(bars,compileFeatureFormula(def.formula),params);
 expect(mergeFeatureDefs([]).filter(d=>d.chartTemplate==='darvas_5m_lower')).toHaveLength(4);expect(out.DBL5_details).toEqual(core.rows);
 for(const n of DBL5_FIELDS)expect(out.vars.get(n)).toEqual(Float64Array.from(core.rows,r=>dbl5Numeric(r,n)??NaN));
 for(const d of DBL5_DIMENSIONS){expect(evaluateOnBars(bars,compileFeatureFormula(d.formula),{...params,...d}).DBL5_details.map(r=>r.darvas_5m_lower)).toEqual(core.rows.map(r=>r.darvas_5m_lower));expect(d.formula).not.toContain('DBL5_raw_value');}
 expect(intervalOf({...def,interval:'1h'})).toBe('5m');expect(accountResearchIndicators().find(i=>i.id==='DBL5').priceOverlay).toBe(true);
 expect(definitionKey({...def,DBL5_config:{n:2}})).not.toBe(definitionKey(def));expect(definitionKey({...def,DBL5_initialization_start:T+300000})).not.toBe(definitionKey(def));expect(old).toEqual([PRS6H_DEF,ATI6H_DEF,SBS5M_DEF].map(definitionKey));
});
it('fish flags can filter broken support even when the price is null; reconstruction retains native config',()=>{
 const d={...def,DBL5_config:{n:3,window_minutes:360}},plan=compileFishProgram(d,{statistic:'DBL5_event_support_broken',direction:'>',threshold:.5,constraints:[]}),out=evaluateFishProgram(sample(),plan);
 expect(out.condition.at(-1)).toBe(1);expect(out.DBL5_details.at(-1).darvas_5m_lower).toBeNull();expect(plan.unit).toBe('布尔');
 const frozen=qualityDefinition({featureId:d.id,definitionKey:definitionKey(d),scale:1,unit:'布尔',average:1,cbi2:1,startAverage:1,previousAverage:0,cutoffMs:T+18*300000,threshold:.5});expect(frozen.DBL5_config).toMatchObject({n:3,window_minutes:360});expect(frozen.DBL5_initialization_start).toBe(T);
 expect(qualityDefinition({featureId:DBL5_DEF.id,definitionKey:definitionKey(DBL5_DEF),scale:1,unit:'价格',average:1,cbi2:1,startAverage:1,previousAverage:0,cutoffMs:T,threshold:1}).chartTemplate).toBe('darvas_5m_lower');
});
it('Deep Dig windows and time curves cannot see a future full confirmation',()=>{
 const b=sample(),c=compileFeatureFormula(def.formula),window={bars:b,anchorMs:T+8*300000-1};
 const a=computeFeatureValues(window as never,c,params);expect(a.value).toBeNull();
 const curve=computeEventSeries(b,T+8*300000,c,params,['DBL5'],[-1,0]);expect(curve).toBeInstanceOf(Float64Array);expect(Number.isNaN(curve[0])).toBe(true);expect(curve[1]).toBe(100);
});
it('real chart calculation returns the same 5m values and raw decimal feed precision',()=>{
 const b=sample(),data=b.map(x=>({...x,timestamp:x.openTime,researchSymbol:'DBLUSDT',PRS6H_tick_size:1,DBL5_initialization_start:T})),item=accountResearchIndicators().find(i=>i.id==='DBL5');
 const chart=researchChartSeries(data,item,3,{fetchReference:false});expect(chart.core).toEqual(computeDbl5(b,{symbol:'DBLUSDT'}).rows.map(r=>r.darvas_5m_lower));expect(chart.components.DBL5_event_support_broken.at(-1)).toBe(1);
 const withPrefix=[...Array.from({length:4},(_,i)=>({...data[0],timestamp:T-(4-i)*300000,DBL5_initialization_start:undefined,DBL5_data_version:undefined})),...data.map(b=>({...b,DBL5_data_version:'corrected-v2'}))];expect(researchChartSeries(withPrefix,item,3,{fetchReference:false}).core.slice(4)).toEqual(chart.core);
 const minute=data.map((b,i)=>({...b,timestamp:T+i*60000}));expect(researchChartSeries(minute,item,3,{fetchReference:false}).core.every(v=>v===null)).toBe(true);
 const raw=parseBinanceKlineRow([T,'123456789012345678.91','123456789012345678.92','123456789012345678.90','123456789012345678.91',1,T+299999,1,1,.5,.5,0]);expect(raw.DBL5_prices.high).toBe('123456789012345678.92');
});
it('rejects pooled absolute price before network access',async()=>{
 await expect(collectDeepDigRun({rows:[]} as CampaignGroupReport,{...def,source:'signals',positive:'s>=3',control:'s<3'},{signals:['AUSDT','BUSDT'].map((symbol,i)=>({id:String(i),symbol,timeMs:T+18*300000,quality:5}) as TradeSignal),fetchFn:async()=>{throw Error('must not fetch');},backgroundCap:0})).rejects.toThrow('单一品种');
});
it('full research pipeline retains break/null, exact confirmation times, checkpoint and CSV/JSON',async()=>{
 const original=sample(),anchor=T+18*300000,bars=[...Array.from({length:600},(_,i)=>({...bar(0,95,94),openTime:T-(600-i)*300000})),...original,...Array.from({length:288},(_,i)=>bar(19+i,109,108))];
 const fetchFn=async(input:RequestInfo|URL)=>{const u=new URL(String(input));if(u.pathname.endsWith('/exchangeInfo'))return new Response(JSON.stringify({symbols:[{symbol:'DBLUSDT',filters:[{filterType:'PRICE_FILTER',tickSize:'1'}]}]}));const a=Number(u.searchParams.get('startTime')),z=Number(u.searchParams.get('endTime')),limit=Number(u.searchParams.get('limit'));return new Response(JSON.stringify(bars.filter(b=>b.openTime>=a&&b.openTime<=z).slice(0,limit).map(b=>[b.openTime,String(b.open),String(b.high),String(b.low),String(b.close),100,b.openTime+299999,10000,20,60,6000,0])));};
 const run=await collectDeepDigRun({rows:[]} as CampaignGroupReport,{...def,DBL5_research_symbol:'DBLUSDT',source:'signals',positive:'s>=3',control:'s<3'},{signals:[{id:'dbl-integration',symbol:'DBLUSDT',timeMs:anchor,quality:5},{id:'ignored',symbol:'OTHERUSDT',timeMs:anchor,quality:5}] as TradeSignal[],fetchFn,backgroundCap:0});
 expect(run.data.rows).toHaveLength(1);const row=run.data.rows[0],window=run.series.DBL5_windows[row.id];expect(row.DBL5_details).toMatchObject({darvas_5m_lower:null,darvas_5m_event:'SUPPORT_BROKEN',at:anchor});expect(window.rows.map(r=>r.darvas_5m_lower)).toEqual(computeDbl5(original,{symbol:'DBLUSDT'}).rows.map(r=>r.darvas_5m_lower));
 expect(window.rows[7].confirmed_at).toBe(T+8*300000);expect(run.data.DBL5_diagnostics[row.id]).toMatchObject({available:10,missing:8,event_counts:{SUPPORT_BROKEN:1}});expect(deepDigCsv(run.data)).toContain('SUPPORT_BROKEN');expect(deepDigCsv(run.data)).toContain('DBL5_checkpoint');expect(JSON.parse(JSON.stringify(run)).data.rows[0].DBL5_details.darvas_5m_lower).toBeNull();expect(viewForVariable(run.data,'DBL5_event_support_broken').definition.unit).toBe('布尔');expect(applyExclusions(run.data,[row.id]).rows).toEqual([]);
},30000);

it('does not carry a price across an unobserved 5m gap, even with a coarse research sampling grid',()=>{
 const b=sample().slice(0,8),c=compileFeatureFormula(def.formula);expect(computeFeatureValues({bars:b,anchorMs:T+9*300000} as never,c,params).value).toBeNull();
 const coarse={...params,researchWindowHours:undefined,avgHours:24};const curve=computeEventSeries(b,T+9*300000,c,coarse,['DBL5'],[0]);expect(Number.isNaN(curve[0])).toBe(true);
});
