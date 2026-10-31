import {expect,it,vi} from 'vitest';
import {dbl5TickAt,DBL5_TICK_CHANGES,DBL5_MARKET_RULE_VERSION} from '../dbl5mMarketRules';
import {computeDbl5,dbl5Numeric,Dbl5Engine} from '../dbl5m';
import {DBL5_DEF,DBL5_DIMENSIONS,compileFeatureFormula,evaluateOnBars,definitionKey} from '../deepDig/features';
import {researchChartSeries,accountResearchIndicators} from '../researchIndicators';
import {sample,bar} from './fixtures/dblBars';
const cutoff=DBL5_TICK_CHANGES[0].effectiveAt;
it('uses the official historical RAVE tick before the dated change, with exact venue/source boundaries',()=>{
 expect(dbl5TickAt('RAVEUSDT',cutoff-300000,.0001)).toBe('0.00001');expect(dbl5TickAt('RAVEUSDT',cutoff,.0001)).toBe(.0001);
 expect(dbl5TickAt('RAVEUSDT',cutoff-1,.001)).toBe(.001);expect(dbl5TickAt('RAVEUSDT',cutoff-1,.0001,'custom')).toBe(.0001);expect(dbl5TickAt('BTCUSDT',cutoff-1,.1)).toBe(.1);expect(dbl5TickAt('RAVEUSDT',cutoff,null)).toBeNull();expect(definitionKey(DBL5_DEF)).toContain(DBL5_MARKET_RULE_VERSION);
});
it('reproduces the blank old replay and restores all four chart/research outputs without guessing a tick from prices',()=>{
 const start=Date.UTC(2026,3,9),bars=sample().map((b,i)=>{const price=(v:number)=>((32040+v)/100000).toFixed(5),raw={open:price(b.open),high:price(b.high),low:price(b.low),close:price(b.close)};return {...b,openTime:start+i*300000,open:Number(raw.open),high:Number(raw.high),low:Number(raw.low),close:Number(raw.close),DBL5_tick_size:.0001,DBL5_prices:raw};});
 expect(computeDbl5(bars,{symbol:'RAVEUSDT',tickSize:.0001}).rows.every(r=>r.darvas_5m_event==='DATA_INVALID')).toBe(true);
 const expected=[...Array(7).fill(null),...Array(6).fill(.3214),...Array(4).fill(.32142),null],config={...DBL5_DEF,DBL5_symbol:'RAVEUSDT',DBL5_tick_size:.0001,DBL5_initialization_start:start};
 const out=evaluateOnBars(bars,compileFeatureFormula(DBL5_DEF.formula),config);expect(out.DBL5_details.map(r=>r.darvas_5m_lower)).toEqual(expected);expect(out.DBL5_details.every(r=>r.tick_size==='0.00001')).toBe(true);expect(out.DBL5_checkpoint.tick_size).toBe('0.00001');expect(out.DBL5_details.at(-1).darvas_5m_event).toBe('SUPPORT_BROKEN');
 const data=bars.map(b=>({...b,timestamp:b.openTime,researchSymbol:'RAVEUSDT',PRS6H_tick_size:.0001,DBL5_initialization_start:start}));
 for(const d of [DBL5_DEF,...DBL5_DIMENSIONS]){const item=accountResearchIndicators().find(i=>i.featureId===d.id),chart=researchChartSeries(data,item,3,{fetchReference:false}),rows=evaluateOnBars(bars,compileFeatureFormula(d.formula),{...config,...d}).DBL5_details;expect(chart.core).toEqual(rows.map(r=>dbl5Numeric(r,d.chartCore)));}
});
it('a real tick-rule transition ends the old structure once and then allows the new regime to warm up',()=>{
 const input=[...sample().slice(0,8),{...bar(9,105,101),DBL5_tick_size:.1},{...bar(10,106,102),DBL5_tick_size:.1}],out=computeDbl5(input,{symbol:'TRANSITION',tickSize:1});
 expect(out.rows[8]).toMatchObject({darvas_5m_event:'DATA_INVALID',darvas_5m_lower:null,tick_size:'0.1',reason_codes:['TICK_RULE_CHANGED']});expect(out.rows[8].ended_box_id).toBe(out.rows[7].box_id);expect(out.rows[9]).toMatchObject({data_valid:true,darvas_5m_status:'WARMUP',darvas_5m_lower:null});
 const resumed=new Dbl5Engine({symbol:'TRANSITION',checkpoint:JSON.parse(JSON.stringify(computeDbl5(input.slice(0,9),{symbol:'TRANSITION',tickSize:1}).checkpoint))});expect(resumed.push(input[9])).toEqual(out.rows[9]);
});
