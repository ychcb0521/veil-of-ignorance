import {it,expect} from 'vitest';
import {Prs6hEngine,computePrs6h,prsParameters,type PrsConfig,type PrsCheckpoint} from '../prs6h';
import {STEP,prsBar,prsPositive} from '../deepDig/__tests__/fixtures/prsBars';
function atState(state:string){const {bars,rows}=prsPositive(),at=rows.findIndex(r=>r.PRS6H_state===state),engine=new Prs6hEngine({symbol:'TESTUSDT'});bars.slice(0,at+1).forEach(b=>engine.push(b));return {bars,at,engine,s:rows[at].PRS6H_structure!};}
it('TESTING gives exactly three recovery bars, then terminates and frees the slot',()=>{
 const {at,engine,s}=atState('FROZEN');let row;
 for(let k=1;k<=3;k++)row=engine.push(prsBar(at+k,s.support+s.band,s.support+.1*s.band,s.support+1.5*s.band))!;
 expect(row!.PRS6H_state).toBe('TEST_FAILED');expect(engine.checkpoint().active).toBeNull();
 expect(engine.push(prsBar(at+4,s.support+2*s.band+.02))!.PRS6H_event).toBeNull();
});
it('candidate and verified-test clocks expire independently; a later test cannot refresh them',()=>{
 for(const [state,count,expected] of [['FROZEN',25,'CANDIDATE_EXPIRED'],['VERIFIED',13,'TEST_EXPIRED']] as const){
  const {at,engine,s}=atState(state);let row;
  for(let k=1;k<=count;k++)row=engine.push(prsBar(at+k,s.support+2*s.band+.02,s.support+1.5*s.band,s.upper))!;
  expect(row!.PRS6H_state).toBe(expected);expect(row!.PRS6H_event).toBeNull();expect(engine.checkpoint().active).toBeNull();
 }
});
it('reference lifetime is checked again at final breakout, without substituting the candidate itself',()=>{
 const {at,engine,s}=atState('VERIFIED'),cp=engine.checkpoint();
 cp.active!.previous!.verified_at=cp.last_time!-6*3600000+STEP;
 const restored=new Prs6hEngine({symbol:'TESTUSDT',checkpoint:cp}),line=s.upper+Math.max(.01,.1*s.scale0);
 restored.push(prsBar(at+1,line+.02,line-.01,line+.025));const row=restored.push(prsBar(at+2,line+.03,line,line+.035))!;
 expect(row.PRS6H_state).toBe('REFERENCE_EXPIRED');expect(row.PRS6H_event).toBeNull();
});
it('higher support with a lower invalidation line does not occupy the candidate slot',()=>{
 const {at,engine,s}=atState('BASELINE_ONLY');let row;
 for(let k=1;k<=24;k++)row=engine.push(prsBar(at+k,s.support+1.6,s.support+.3,s.support+3))!;
 const a=row!.PRS6H_debug.scale_before as number;
 expect(s.support+.3-.5*a).toBeLessThan(s.invalidation);
 expect(engine.checkpoint().active).toBeNull();expect(row!.PRS6H_structure).toBeNull();
});
it('price inside a known resistance band is vetoed, and a broken band re-enters immediately',()=>{
 const {at,engine,s}=atState('VERIFIED'),cp=engine.checkpoint(),line=s.upper+Math.max(.01,.1*s.scale0),center=line+.03;
 cp.obstacles.push({id:'inside',type:'pivot',pivot_time:cp.last_time!-2*STEP,known_at:cp.last_time!,center,lower:center-.1,upper:center+.1,above:2,broken_up:true});
 const restored=new Prs6hEngine({symbol:'TESTUSDT',checkpoint:cp});restored.push(prsBar(at+1,center-.01,center-.03,center+.01));const row=restored.push(prsBar(at+2,center,center-.02,center+.005))!;
 expect(row.PRS6H_gates.breakout).toBe(true);expect(row.PRS6H_gates.space).toBe(false);expect(row.PRS6H_event).toBeNull();
 expect((row.PRS6H_debug.obstacles as {id:string}[]).some(o=>o.id==='inside')).toBe(true);
});
it('a pivot becomes known only at the second right close and its band stays fixed',()=>{
 const {at,engine,s}=atState('BASELINE_ONLY'),j=at+1,c=s.support+.7;
 const first=engine.push(prsBar(j,c,c-.1,c+.8))!,second=engine.push(prsBar(j+1,c+.01,c-.08,c+.12))!,third=engine.push(prsBar(j+2,c+.02,c-.06,c+.13))!;
 const id='pivot-'+first.PRS6H_at,ob=(r:typeof third)=>(r.PRS6H_debug.obstacles as {id:string;known_at:number;lower:number;upper:number}[]).find(o=>o.id===id);
 expect(ob(first)).toBeUndefined();expect(ob(second)).toBeUndefined();expect(ob(third)?.known_at).toBe(third.PRS6H_at);
 const next=engine.push(prsBar(j+3,c+.03))!;expect(ob(next)?.lower).toBe(ob(third)?.lower);expect(ob(next)?.upper).toBe(ob(third)?.upper);
 expect(computePrs6h([prsBar(0,100)]).rows[0].PRS6H_gates.space).toBeNull();
});
it('a small body fall with no lower wick is still caught by the pre-bar shock scale',()=>{
 const {at,engine,s}=atState('FROZEN'),prior=engine.checkpoint().points.at(-1)!.bar.close,scale=engine.checkpoint().points.at(-1)!.scale!,c=prior-4*scale;
 const row=engine.push({...prsBar(at+1,c,c,c+.02),open:c,low:c})!;
 expect(row.PRS6H_debug.max_shock).toBeGreaterThanOrEqual(3);expect(row.PRS6H_gates.spike).toBe(false);
});
it('large genuine sell flow cannot replace price damage, and small sell flow cannot excuse sustained decline',()=>{
 const {bars}=prsPositive(),heavy=computePrs6h(bars.map(b=>({...b,takerBuyQuoteVolume:0})),{symbol:'TESTUSDT',config:{volumeMode:'flow'}});
 expect(heavy.rows.some(r=>r.PRS6H_event)).toBe(true);
 const falling=bars.slice(0,125).map((b,i)=>({...b,open:120-i*.1+.02,high:120-i*.1+.03,low:120-i*.1-.01,close:120-i*.1,takerBuyQuoteVolume:b.quoteVolume}));
 const row=computePrs6h(falling,{config:{volumeMode:'flow'}}).rows.at(-1)!;expect(row.PRS6H_V).toBe(1);expect(row.PRS6H_D).toBe(0);expect(row.PRS6H_market_ready).toBe(false);
 const missing=computePrs6h(bars.map((b,i)=>i===bars.length-1?{...b,takerBuyQuoteVolume:null}:b),{config:{volumeMode:'flow'}}).rows.at(-1)!;expect(missing.PRS6H_V).toBeNull();expect(missing.PRS6H).toBeNull();
});
it('mode/schema constraints reject invalid JSON configuration instead of silently changing meanings',()=>{
 expect(()=>prsParameters({volumeMode:'auto'} as unknown as PrsConfig)).toThrow();expect(()=>prsParameters([] as unknown as PrsConfig)).toThrow();expect(()=>prsParameters({spikeMinutes:0})).toThrow();
 expect(new Prs6hEngine({config:{volumeMode:'quote'}}).configHash).toBe(new Prs6hEngine().configHash);
});

it('current anomalous range never inflates its own volatility denominator and invalidation remains frozen',()=>{
 const {at,engine,s}=atState('FROZEN'),cp=engine.checkpoint(),next=prsBar(at+1,s.upper+10,s.support-10,s.upper+11),row=engine.push(next)!;
 const prior=cp.points.slice(-24),now=cp.last_time!,weights=prior.map(x=>2**(-(now-x.time)/(30*60000))),expected=prior.reduce((a,x,i)=>a+x.tr!*weights[i],0)/weights.reduce((a,b)=>a+b,0);
 expect(row.PRS6H_debug.scale_before).toBeCloseTo(expected,12);expect(row.PRS6H_structure?.invalidation).toBe(s.invalidation);expect(row.PRS6H_state).toBe('INVALID');
});

it('missing recent flow keeps the current score and data status unknown even when the latest candle has valid flow',()=>{
 const {bars}=prsPositive(),bad=bars.map((b,i)=>i===bars.length-2?{...b,takerBuyQuoteVolume:null}:b),row=computePrs6h(bad,{symbol:'TESTUSDT',config:{volumeMode:'flow'}}).rows.at(-1)!;
 expect(row.PRS6H_V).toBeNull();expect(row.PRS6H).toBeNull();expect(row.PRS6H_data_complete).toBe(false);expect(row.PRS6H_state).toBe('DATA_UNAVAILABLE');
});
