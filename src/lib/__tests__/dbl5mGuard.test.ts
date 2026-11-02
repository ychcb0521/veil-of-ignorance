/** 【用户要求】2026-11-02 DBL-5 防守线：分上涨 / 震荡留冗余，收盘确认跌破；箱体识别与旧定义身份不变。 */
import {describe,it,expect} from 'vitest';
import {computeDbl5,dbl5ConfigHash,DBL5_STEP,DBL5_FIELDS,type Dbl5Bar,type Dbl5Row} from '../dbl5m';
import {DBL5_DEF,compileFeatureFormula,evaluateOnBars} from '../deepDig/features';
import {researchChartSeries,accountResearchIndicators} from '../researchIndicators';
import {dbl5Numeric} from '../dbl5m';
const T=Date.UTC(2026,0,5);
/** Seeded walk: warm-up chop, a stair-step rally with shallow pullbacks, then a wide sideways range with deep wicks. */
function walk(seed=7,n=900):Dbl5Bar[]{
 let x=seed,price=10000;const rnd=()=>((x=(x*1103515245+12345)%2147483648)/2147483648);
 return Array.from({length:n},(_,i)=>{
  const phase=i<200?'chop':i<500?'trend':'range',drift=phase==='trend'?6:phase==='range'?(10000+1800-price)*.02:0;
  const open=price,close=Math.max(100,Math.round(open+drift+(rnd()-.5)*60)),wick=phase==='range'&&rnd()<.08?120:20;
  const high=Math.max(open,close)+Math.round(rnd()*20),low=Math.max(1,Math.min(open,close)-Math.round(rnd()*wick));price=close;
  return {openTime:T+i*DBL5_STEP,open,high,low,close,volume:1,quoteVolume:null,takerBuyVolume:null,takerBuyQuoteVolume:null,DBL5_closed:true,DBL5_tick_size:1};
 });
}
const run=(bars:Dbl5Bar[],config={})=>computeDbl5(bars,{symbol:'TESTUSDT',tickSize:1,config});
describe('DBL-5 防守线',()=>{
 it('keeps existing definitions and box recognition identical; guard keys only change identity when set',()=>{
  expect(dbl5ConfigHash({})).toBe(dbl5ConfigHash({timeframe:'5m',n:3,window_minutes:360}));
  expect(dbl5ConfigHash({guard_range_atr:2})).not.toBe(dbl5ConfigHash({}));
  expect(DBL5_FIELDS.some(f=>f.includes('guard'))).toBe(false);expect(DBL5_DEF.formula).not.toContain('guard');
  const bars=walk(),plain=run(bars).rows,wide=run(bars,{guard_range_atr:3}).rows;
  expect(wide.map(r=>[r.darvas_5m_lower,r.darvas_5m_event])).toEqual(plain.map(r=>[r.darvas_5m_lower,r.darvas_5m_event]));
  expect(()=>run(bars,{guard_range_atr:-1})).toThrow();expect(()=>run(bars,{guard_range_closes:0})).toThrow();
 });
 it('only breaks on closes: a wick below never counts, trend needs 1 close and range 2 consecutive closes',()=>{
  const bars=walk(),rows=run(bars).rows,close=new Map(bars.map(b=>[b.openTime+DBL5_STEP,b.close]));let breaks=0;
  rows.forEach((r,k)=>{
   if(k<2)return;const prev=rows[k-1];
   if(r.darvas_5m_guard_broken){breaks++;expect(close.get(r.at)!).toBeLessThan(prev.darvas_5m_guard!);
    if(prev.darvas_5m_guard_regime==='range'){expect(rows[k-2].darvas_5m_guard).toBe(prev.darvas_5m_guard);expect(close.get(prev.at)!).toBeLessThan(prev.darvas_5m_guard!);}}
   else if(prev.darvas_5m_guard!=null&&close.get(r.at)!>=prev.darvas_5m_guard)expect(r.darvas_5m_guard_segment).toBe(prev.darvas_5m_guard_segment);
  });
  expect(breaks).toBeGreaterThan(0);
  // 噪音容忍：箱体被影线击穿、防守线仍在
  expect(rows.some((r,k)=>r.darvas_5m_event==='SUPPORT_BROKEN'&&r.darvas_5m_guard!=null&&r.darvas_5m_guard_segment===rows[k-1].darvas_5m_guard_segment)).toBe(true);
 });
 it('trend line only rises; a range line never rises with boxes inside the range and sits a wider ATR buffer below the floor',()=>{
  const rows=run(walk()).rows;let trend=0,range=0;
  rows.forEach((r,k)=>{
   const prev=rows[k-1];if(!prev||r.darvas_5m_guard==null)return;
   if(r.darvas_5m_guard_regime==='trend')trend++;else range++;
   if(prev.darvas_5m_guard==null||prev.darvas_5m_guard_segment!==r.darvas_5m_guard_segment)return;
   if(prev.darvas_5m_guard_regime==='trend'&&r.darvas_5m_guard_regime==='trend')expect(r.darvas_5m_guard).toBeGreaterThanOrEqual(prev.darvas_5m_guard);
   if(prev.darvas_5m_guard_regime==='range'&&r.darvas_5m_guard_regime==='range')expect(r.darvas_5m_guard).toBeLessThanOrEqual(prev.darvas_5m_guard);
   if(r.darvas_5m_guard!==prev.darvas_5m_guard&&r.darvas_5m_lower!=null){const buffer=(r.darvas_5m_guard_regime==='trend'?.5:1)*r.darvas_5m_guard_atr!;expect(r.darvas_5m_guard).toBeLessThanOrEqual(r.darvas_5m_lower-buffer+1e-9);}
  });
  expect(trend).toBeGreaterThan(0);expect(range).toBeGreaterThan(0);
  const wider=run(walk(),{guard_range_atr:2}).rows,at=rows.findIndex(r=>r.darvas_5m_guard_regime==='range');
  expect(wider[at].darvas_5m_guard!).toBeLessThan(rows[at].darvas_5m_guard!);
 });
 it('resumes from any checkpoint with the same guard as a single pass',()=>{
  const bars=walk(11,600),whole=run(bars).rows,key=(r:Dbl5Row)=>[r.at,r.darvas_5m_guard,r.darvas_5m_guard_regime,r.darvas_5m_guard_broken,r.darvas_5m_guard_segment];
  for(const cut of [137,333,451]){const head=run(bars.slice(0,cut)),tail=computeDbl5(bars.slice(cut),{symbol:'TESTUSDT',tickSize:1,checkpoint:head.checkpoint});expect([...head.rows,...tail.rows].map(key)).toEqual(whole.map(key));}
 });
 it('reaches the chart as render-only components, identical to the engine rows',()=>{
  const bars=walk(3,400),start=bars[0].openTime,config={...DBL5_DEF,DBL5_symbol:'TESTUSDT',DBL5_tick_size:1,DBL5_initialization_start:start};
  const rows=evaluateOnBars(bars,compileFeatureFormula(DBL5_DEF.formula),config).DBL5_details!;
  const data=bars.map(b=>({...b,timestamp:b.openTime,researchSymbol:'TESTUSDT',PRS6H_tick_size:1,DBL5_initialization_start:start}));
  const chart=researchChartSeries(data,accountResearchIndicators().find(i=>i.id==='DBL5')!,3,{fetchReference:false});
  for(const name of ['_DBL5_guard','_DBL5_guard_trend','_DBL5_guard_segment'])expect(chart.components![name].map(v=>v??null)).toEqual(rows.map(r=>dbl5Numeric(r,name)));
  expect(rows.some(r=>r.darvas_5m_guard!=null)).toBe(true);
 });
});
