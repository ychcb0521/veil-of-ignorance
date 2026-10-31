import {describe,it,expect} from 'vitest';
import {Prs6hEngine,computePrs6h,prsGeometric,prsParameters,prsAccountAdmission,PRS6H_ID,type PrsBar,type PrsRow,type PrsCheckpoint} from '../prs6h';
import {STEP,prsBar,prsPositive} from '../deepDig/__tests__/fixtures/prsBars';
describe('PRS6H causal fixed structures',()=>{
 it('completes baseline → higher shallow platform → independent touch/recovery → two closes → one market event',()=>{
  const out=prsPositive();
  expect(out.baseline?.PRS6H_state).toBe('BASELINE_ONLY');expect(out.baseline?.PRS6H_event).toBeNull();
  const ready=out.rows.find(r=>r.PRS6H_event)!;
  expect(ready).toBeDefined();expect(ready.PRS6H).toBeGreaterThanOrEqual(70);expect(ready.PRS6H_market_ready).toBe(true);
  const s=ready.PRS6H_structure!;expect(s.previous?.structure_id).not.toBe(s.structure_id);expect(s.support).toBeGreaterThan(s.previous!.support);expect(s.invalidation).toBeGreaterThan(s.previous!.invalidation);
  expect(s.test_started_at!).toBeGreaterThan(s.frozen_at);expect(s.breakout_confirmed_at!-s.test_completed_at!).toBeGreaterThanOrEqual(2*STEP);
  expect(out.rows.filter(r=>r.PRS6H_event)).toHaveLength(1);
  const retry=out.engine.push(out.bars.at(-1)!)!;expect(retry.PRS6H_event).toBeNull();
  expect(out.engine.push(prsBar(out.bars.length,out.bars.at(-1)!.close+.02))!.PRS6H_event).toBeNull();
 });
 it('batch, streaming and JSON checkpoint recovery are identical and never change the past when future bars are appended',()=>{
  const {bars,rows}=prsPositive(),all=computePrs6h(bars,{symbol:'TESTUSDT'});
  expect(all.rows).toEqual(rows);
  const split=bars.length-3,first=computePrs6h(bars.slice(0,split),{symbol:'TESTUSDT'}),restored=new Prs6hEngine({symbol:'TESTUSDT',checkpoint:JSON.parse(JSON.stringify(first.checkpoint))});
  expect(bars.slice(split).map(b=>restored.push(b))).toEqual(rows.slice(split));
  const future=computePrs6h([...bars,prsBar(bars.length,1000,1,1001)],{symbol:'TESTUSDT'});expect(future.rows.slice(0,bars.length)).toEqual(rows);
  expect(()=>new Prs6hEngine({symbol:'OTHER',checkpoint:first.checkpoint})).toThrow(/不一致/);
 });
 it('formation lows do not count as later tests and coordinates are immutable while valid',()=>{
  const {rows}=prsPositive(),frozen=rows.find(r=>r.PRS6H_state==='FROZEN')!;
  expect(frozen.PRS6H_structure!.test_started_at).toBeNull();expect(frozen.PRS6H_S).toBeNull();expect(frozen.PRS6H).toBe(0);
  for(const row of rows.filter(r=>r.PRS6H_structure?.structure_id===frozen.PRS6H_structure!.structure_id))for(const key of ['support','upper','scale0','band','invalidation','formed_from','formed_to','frozen_at'] as const)expect(row.PRS6H_structure![key]).toBe(frozen.PRS6H_structure![key]);
 });
 it('a same-bar break below K and strong recovery remains INVALID, including stored reference invalidation',()=>{
  const {bars,rows}=prsPositive(),at=rows.findIndex(r=>r.PRS6H_state==='FROZEN'),engine=new Prs6hEngine({symbol:'TESTUSDT'});bars.slice(0,at+1).forEach(b=>engine.push(b));const s=rows[at].PRS6H_structure!;
  const row=engine.push(prsBar(at+1,s.upper+1,s.invalidation,s.upper+1.1))!;
  expect(row.PRS6H_state).toBe('INVALID');expect(row.PRS6H_event).toBeNull();expect(row.PRS6H_structure!.invalidation).toBe(s.invalidation);
  expect(engine.push(prsBar(at+2,s.upper+2))!.PRS6H_structure).toBeNull();
 });
 it('two closes below fixed support invalidate before any later recovery',()=>{
  const {bars,rows}=prsPositive(),at=rows.findIndex(r=>r.PRS6H_state==='FROZEN'),engine=new Prs6hEngine({symbol:'TESTUSDT'});bars.slice(0,at+1).forEach(b=>engine.push(b));const s=rows[at].PRS6H_structure!,c=s.support-.01,low=Math.max(s.invalidation+.01,c-.01);
  engine.push(prsBar(at+1,c,low,c+.03));const row=engine.push(prsBar(at+2,c,low,c+.03))!;expect(row.PRS6H_state).toBe('INVALID');
 });
 it('zero quote activity cannot create or verify a structure; flat D and zero denominators remain unknown',()=>{
  const bars=Array.from({length:125},(_,i)=>prsBar(i,100,99.9,100.1,0));const row=computePrs6h(bars).rows.at(-1)!;
  expect(row.PRS6H_D).toBeNull();expect(row.PRS6H_V).toBeNull();expect(row.PRS6H).toBeNull();expect(row.PRS6H_market_ready).toBe(false);
  const missing=bars.map(b=>({...b,quoteVolume:null}));expect(computePrs6h(missing).rows.at(-1)!.PRS6H).toBeNull();
 });
 it('wick and body shock veto lasts the entire two-hour window, independent of quick recovery',()=>{
  const {bars,rows}=prsPositive(),at=rows.findIndex(r=>r.PRS6H_state==='FROZEN'),engine=new Prs6hEngine({symbol:'TESTUSDT'});bars.slice(0,at+1).forEach(b=>engine.push(b));const scale=rows[at].PRS6H_debug.scale_before as number,c=bars[at].close;
  const row=engine.push(prsBar(at+1,c,c-4*scale,c+.05))!;expect(row.PRS6H_gates.spike).toBe(false);expect(row.PRS6H_debug.spike_wait_ms).toBe(2*3600000);
  const next=engine.push(prsBar(at+2,c+.01))!;expect(next.PRS6H_gates.spike).toBe(false);
 });
 it('closed cutoff excludes forming updates and gaps invalidate references rather than assuming survival',()=>{
  const {bars}=prsPositive(),at=bars.at(-1)!.openTime+STEP;
  const result=computePrs6h([...bars,prsBar(bars.length,999,1,1000)],{symbol:'TESTUSDT',asOf:at});expect(result.rows).toEqual(computePrs6h(bars,{symbol:'TESTUSDT'}).rows);
  const engine=new Prs6hEngine({symbol:'TESTUSDT',checkpoint:result.checkpoint});const row=engine.push(prsBar(bars.length+1,110))!;expect(row.PRS6H_state).toBe('DATA_UNAVAILABLE');expect(row.PRS6H).toBeNull();
 });
 it('zero evidence is exact, missing components do not redistribute weights, and strict core minima cannot be compensated',()=>{
  const parts={T:1,S:1,D:1,B:1,V:1};expect(prsGeometric(parts)).toBe(100);expect(prsGeometric({...parts,V:0})).toBe(0);expect(prsGeometric({...parts,V:null})).toBeNull();
  const ready=prsPositive().rows.find(r=>r.PRS6H_event)!;expect(ready).toBeDefined();
  const highFloor=computePrs6h(prsPositive().bars,{symbol:'TESTUSDT',config:{coreMin:{T:.35,S:.65,D:.60,B:1}}});expect(highFloor.rows.every(r=>r.PRS6H_market_ready===false)).toBe(true);
  expect(()=>prsParameters({weights:{T:1,S:1,D:1,B:1,V:1}})).toThrow();
  expect(prsAccountAdmission(ready.PRS6H_event,{}).allowed).toBe(false);expect(prsAccountAdmission(ready.PRS6H_event,{positionEligible:true,riskBudgetPassed:true,latestExecutionChecksPassed:true}).allowed).toBe(true);
 });
 it('volume modes and data versions isolate checkpoints and structure identities',()=>{
  const {bars}=prsPositive(),a=computePrs6h(bars,{symbol:'TESTUSDT'}),b=computePrs6h(bars,{symbol:'TESTUSDT',config:{volumeMode:'flow'}});
  expect(a.checkpoint.config_hash).not.toBe(b.checkpoint.config_hash);expect(a.checkpoint.feature_id).toBe(PRS6H_ID);
  expect(()=>new Prs6hEngine({symbol:'TESTUSDT',config:{volumeMode:'flow'},checkpoint:a.checkpoint})).toThrow();
 });
});
