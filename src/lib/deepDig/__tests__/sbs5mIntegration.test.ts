import {beforeEach,it,expect} from 'vitest';
import {SBS5M_DEF,SBS5M_DIMENSIONS,PRS6H_DEF,ATI6H_DEF,compileFeatureFormula,evaluateOnBars,definitionKey,mergeFeatureDefs,intervalOf,featureWindowMs} from '../features';
import {computeSbs5m,SBS5M_FIELDS} from '@/lib/sbs5m';
import {sbsComplete,sbsBaseline,SBS_T,sbsBar} from '@/lib/__tests__/fixtures/sbsBars';
import {compileFishProgram,evaluateFishProgram} from '@/lib/fish/algorithm';
import {qualityDefinition} from '@/lib/fish/quality';
import {collectDeepDigRun,snapshotOf} from '../analysis';
import {deepDigCsv} from '../export';
import {computeEventSeries,seriesOffsets,seriesRangeOf} from '../series';
import {sbsStepPath} from '@/lib/sbs5mChart';
import {evaluateSbs5m} from '@/lib/sbs5mEvaluation';
import {accountResearchIndicators} from '@/lib/researchIndicators';
import {groupDeepDigFeatures} from '@/lib/customIndicatorGroups';
import type {CampaignGroupReport} from '@/lib/deepRsa/report';
import type {TradeSignal} from '@/lib/signalLibrary';
import {clearMarketDataCache} from '@/lib/deepRsa/marketData';
import {clearAti6hMarketCache} from '@/lib/ati6hMarketData';
beforeEach(()=>{localStorage.clear();clearMarketDataCache();clearAti6hMarketCache();});
it('registers four independent outputs of the same closed state machine, without changing older definitions',()=>{
 const definitions=mergeFeatureDefs([]);expect(definitions.filter(d=>d.chartTemplate==='sbs_5m')).toHaveLength(4);
 expect(groupDeepDigFeatures(definitions).find(g=>g.key==='sbs-structure')?.items).toHaveLength(4);
 const old=[definitionKey(PRS6H_DEF),definitionKey(ATI6H_DEF)],bars=sbsComplete();
 const def={...SBS5M_DEF,SBS5M_config:{active_box_max_age:5}},compiled=compileFeatureFormula(def.formula),out=evaluateOnBars(bars,compiled,{...def,SBS5M_symbol:'SBSUSDT'});
 const core=computeSbs5m(bars,{symbol:'SBSUSDT',config:def.SBS5M_config,dataSource:'binance-futures',dataVersion:'ohlcv-v1',initializationId:`window-start:${bars[0].openTime}:v1`});
 expect(out.SBS5M_details).toEqual(core.rows);expect(out.vars.get('SBS5M')).toEqual(Float64Array.from(core.rows,r=>r.support_price??NaN));
 expect(old).toEqual([definitionKey(PRS6H_DEF),definitionKey(ATI6H_DEF)]);expect(intervalOf({...def,interval:'1h'})).toBe('5m');expect(featureWindowMs({...def,SBS5M_config:{volatility_lookback_bars:500}})).toBeGreaterThan(24*3600000);
 for(const d of SBS5M_DIMENSIONS){const values=evaluateOnBars(bars,compileFeatureFormula(d.formula),{...d,SBS5M_symbol:'SBSUSDT'});expect(values.SBS5M_details.map(r=>r.support_price)).toEqual(core.rows.map(r=>r.support_price));expect(d.formula).not.toContain('SBS5M_raw_support_price');}
 expect(definitionKey(def)).not.toBe(definitionKey(SBS5M_DEF));expect(snapshotOf(def).SBS5M_config).toEqual(def.SBS5M_config);
 expect(accountResearchIndicators().find(i=>i.featureId==='sbs_5m')?.priceOverlay).toBe(true);
});
it('fish rules and frozen reconstruction retain exact SBS configuration and numeric dimensions',()=>{
 const def={...SBS5M_DIMENSIONS[0],SBS5M_config:{test_min_turnover_ratio:.3}},bars=sbsBaseline();
 const plan=compileFishProgram(def,{statistic:'结果',direction:'>',threshold:50,constraints:[]}),values=evaluateFishProgram(bars,plan);
 expect(plan.compiled.usesSbs5m).toBe(true);expect(values.SBS5M_details?.at(-1)?.support_price).toBe(100);expect(values.condition.at(-1)).toBe(1);
 const frozen=qualityDefinition({featureId:def.id,definitionKey:definitionKey(def),scale:1,unit:'分',average:90,cbi2:90,startAverage:90,previousAverage:0,cutoffMs:bars.at(-1).openTime+300000,threshold:50});
 expect(frozen.SBS5M_config.test_min_turnover_ratio).toBe(.3);expect(frozen.SBS5M_dimension).toBe('quality');
});
it('does not connect null or episode transitions, while valid replacement stays a horizontal step',()=>{
 expect(sbsStepPath([{x:0,y:100,episode:'a'},{x:1,y:100,episode:'a'},{x:2,y:104,episode:'a'},{x:3,y:null,episode:null},{x:4,y:90,episode:'b'},{x:5,y:91,episode:'c'}])).toBe('M0,100 H1 V100 H2 V104 M4,90 M5,91');
});
it('retrospective labels exclude the confirming rebound and keep missing futures null',()=>{
 const rows=computeSbs5m(sbsBaseline(),{symbol:'EVAL'}).rows,at=rows.at(-1).at;
 const missing=evaluateSbs5m(rows,[]);expect(missing.horizons[0].labels.every(l=>!l.complete&&l.max_under_support===null)).toBe(true);
 const future=[sbsBar(37,103,100.1,104),sbsBar(38,103,99.8,104),sbsBar(39,103,100.2,104)];const labels=evaluateSbs5m(rows,future).horizons[0];expect(labels.confirmed_at).toBe(at);expect(labels.labels[0].max_under_support).toBeCloseTo(.2);expect(labels.labels[0].complete).toBe(true);
});
it('blocks pooled absolute-price studies before any fetch, while normalized dimensions remain selectable',async()=>{
 const signals=['AUSDT','BUSDT'].map((symbol,i)=>({id:String(i),symbol,timeMs:SBS_T+100*300000,quality:5}) as TradeSignal);
 await expect(collectDeepDigRun({rows:[]} as unknown as CampaignGroupReport,{...SBS5M_DEF,source:'signals',positive:'s >= 3',control:'s < 3'},{signals,backgroundCap:0,fetchFn:async()=>{throw Error('must not fetch');}})).rejects.toThrow('不能混合统计');
});
it('collects native details, closed-bar series, checkpoint metadata and CSV through the real research pipeline',async()=>{
 const original=sbsComplete(),anchor=original.at(-1).openTime+300000,bars=[...Array.from({length:600},(_,i)=>({...sbsBar(0,95),openTime:SBS_T-(600-i)*300000})),...original,...Array.from({length:288},(_,i)=>sbsBar(49+i,109))];
 const fetchFn=async(input:RequestInfo|URL)=>{const url=new URL(String(input));if(url.pathname.endsWith('/exchangeInfo'))return new Response(JSON.stringify({symbols:[{symbol:'SBSINTEGRATIONUSDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.1'}]}]}));
  const from=Number(url.searchParams.get('startTime')),to=Number(url.searchParams.get('endTime'));
  return new Response(JSON.stringify(bars.filter(b=>b.openTime>=from&&b.openTime<=to).map(b=>[b.openTime,b.open,b.high,b.low,b.close,b.volume,b.openTime+299999,b.quoteVolume,20,b.takerBuyVolume,b.takerBuyQuoteVolume,0])));};
 const def={...SBS5M_DIMENSIONS[0],source:'signals' as const,positive:'s >= 3',control:'s < 3'},run=await collectDeepDigRun({rows:[]} as unknown as CampaignGroupReport,def,{signals:[{id:'sbs-integration',symbol:'SBSINTEGRATIONUSDT',timeMs:anchor,quality:5} as TradeSignal],fetchFn,backgroundCap:0});
 expect(run.data.rows[0].SBS5M_details.support_status).toBe('INVALID');expect(run.series.SBS5M_windows['sbs-integration'].rows.some(r=>r.support_price===104)).toBe(true);expect(deepDigCsv(run.data)).toContain('SBS5M_checkpoint');
 expect(run.data.rows[0].SBS5M_checkpoint.config_hash).toBeTruthy();
 const compiled=compileFeatureFormula(def.formula),offsets=seriesOffsets(seriesRangeOf(def));expect(computeEventSeries(bars,anchor,compiled,def,['SBS5M_support_quality'],offsets)).toBeInstanceOf(Float64Array);
});
