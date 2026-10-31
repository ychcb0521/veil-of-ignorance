import {describe,it,expect} from 'vitest';
import {computeSbs5m,Sbs5mEngine,sbsConfigHash,sbsParameters,sbsAverage,sbsQuality,SBS5M_STEP,type SbsOptions,type SbsBar} from '../sbs5m';
import {sbsBar,sbsFormation,sbsBaseline,sbsBreakout,sbsHigherPending,sbsComplete} from './fixtures/sbsBars';
const options:SbsOptions={symbol:'TESTUSDT',dataSource:'synthetic',dataVersion:'sbs-acceptance-v1',tickSize:.1};
const run=(bars:readonly SbsBar[],config:SbsOptions['config']={})=>computeSbs5m(bars,{...options,config});
const last=(bars:readonly SbsBar[],config:SbsOptions['config']={})=>run(bars,config).rows.at(-1)!;

describe('SBS-5M causal boxes',()=>{
 it('freezes the first qualifying box, and never uses its formation low as an independent test',()=>{
  const x=run(sbsFormation()),r=x.rows.at(-1)!;
  expect(x.events.filter(e=>e.type==='FROZEN')).toHaveLength(1);expect(r.candidate_status).toBe('FROZEN');expect(r.support_price).toBeNull();expect(r.support_quality).toBeNull();expect(r.pending?.test_started_at).toBeNull();
 });
 it('accepts a shallow independent test and records a baseline without inventing a step',()=>{
  const r=last(sbsBaseline());expect(r.support_price).toBe(100);expect(r.support_status).toBe('ACTIVE');expect(r.step_height_atr).toBeNull();expect(r.step_event_height).toBeNull();expect(r.confirmed_at).toBeGreaterThan(r.frozen_at!);expect(r.events.some(e=>e.type==='BASELINE_CONFIRMED')).toBe(true);
 });
 it('keeps every frozen boundary fixed through later candle changes',()=>{
  const engine=new Sbs5mEngine(options);sbsFormation().forEach(b=>engine.push(b));const before=structuredClone(engine.pending!);
  engine.push(sbsBar(36,101.4,100.3,103));const after=engine.pending!;
  for(const k of ['box_id','s','u','W','a0','delta','K','formation_start','formation_end','frozen_at','parent_box_id','config_hash'] as const)expect(after[k],k).toEqual(before[k]);
 });
 it('rejects narrow but one-way price drift',()=>{
  const r=run(Array.from({length:80},(_,i)=>sbsBar(i,100+i*.05,99.8+i*.05,100.2+i*.05)));
  expect(r.events.filter(e=>e.type==='FROZEN')).toEqual([]);expect(r.rows.every(x=>x.support_price===null)).toBe(true);
 });
 it('rejects an anomalous formation lower wick against its own prior scale',()=>{
  const bars=sbsFormation();bars[32]={...bars[32],low:90};expect(last(bars).pending).toBeNull();
 });
 it('terminates a pending box before any rebound can confirm it',()=>{
  const engine=new Sbs5mEngine(options);sbsFormation().forEach(b=>engine.push(b));const id=engine.pending!.box_id,K=engine.pending!.K;
  const failed=engine.push(sbsBar(36,104,K-.1,105))!;expect(failed.candidate_status).toBe('INVALID');expect(failed.support_price).toBeNull();
  const rebound=engine.push(sbsBar(37,104,103,105))!;expect(rebound.support_price).toBeNull();expect(engine.history.find(b=>b.box_id===id)?.state).toBe('INVALID');
 });
 it('permanently invalidates an active box even when that candle closes above the box top',()=>{
  const r=last(sbsComplete());expect(r.support_price).toBeNull();expect(r.support_status).toBe('INVALID');expect(r.invalidated_at).toBe(r.at);expect(r.support_quality).toBeNull();
 });
 it.each([true,false])('checks recovery before timeout on the final third test candle (recovery=%s)',recover=>{
  const bars=[...sbsFormation(),sbsBar(36,101.4,100.2,103),sbsBar(37,101.4,100.2,103),sbsBar(38,recover?103:101.4,100.2,103.2)];
  const r=last(bars);expect(r.support_price).toBe(recover?100:null);expect(r.candidate_status).toBe(recover?'CONFIRMED':'FAILED');
 });
 it('expires the candidate before recovery on the expiry candle',()=>{
  const r=last([...sbsFormation(),sbsBar(36,101.4,100.2,103),sbsBar(37,103,100.2,103.2)],{candidate_max_age:10});
  expect(r.support_price).toBeNull();expect(r.candidate_status).toBe('EXPIRED');expect(r.events.some(e=>e.type==='BASELINE_CONFIRMED')).toBe(false);
 });
 it('keeps old support when only the higher pending box breaks',()=>{
  const engine=new Sbs5mEngine(options);sbsHigherPending().forEach(b=>engine.push(b));expect(engine.pending?.parent_box_id).toBe(engine.active?.box_id);
  const old=engine.active!.s,K=engine.pending!.K;expect(K).toBeGreaterThan(engine.active!.K);
  const r=engine.push(sbsBar(45,106,K-.1,107))!;expect(r.support_price).toBe(old);expect(r.candidate_status).toBe('INVALID');expect(r.support_status).toBe('ACTIVE');
 });
 it('cancels the dependent candidate if the parent expires on its proposed confirmation candle',()=>{
  const r=last(sbsHigherPending().concat(sbsBar(45,106.8,104.2,107.2)),{active_box_max_age:.75});
  expect(r.support_status).toBe('STALE');expect(r.support_price).toBeNull();expect(r.pending).toBeNull();expect(r.events.some(e=>e.type==='STEP_CONFIRMED')).toBe(false);
 });
 it('confirms a higher box after the parent breakout, raises immediately, and resets breakout state',()=>{
  const x=run(sbsHigherPending().concat(sbsBar(45,106.8,104.2,107.2))),r=x.rows.at(-1)!,old=x.history.find(b=>b.state==='REPLACED')!;
  expect(r.support_price).toBe(104);expect(r.step_height_atr).toBeGreaterThan(0);expect(r.step_event_height).toBe(r.step_height_atr);
  expect(r.episode_id).toBe(old.episode_id);expect(r.parent_box_id).toBe(old.box_id);expect(r.active!.formation_start).toBeGreaterThan(old.breakout_at!);expect(r.breakout_at).toBeNull();expect(r.active!.above).toBe(0);
 });
 it('does not auto-raise support during a continuing rally without a horizontal new box',()=>{
  const bars=sbsBreakout();for(let i=39;i<65;i++)bars.push(sbsBar(i,106+(i-39)*.4,105.7+(i-39)*.4,106.3+(i-39)*.4));
  const x=run(bars);expect(x.rows.slice(36).every(r=>r.support_price===100)).toBe(true);expect(x.events.some(e=>e.type==='STEP_CONFIRMED')).toBe(false);
 });
 it('rejects a raised floor accompanied by a lower box top',()=>{
  const bars=sbsBreakout().concat([102.8,102,102.7,102,102.6,102.8].map((v,i)=>sbsBar(39+i,v,101,103)));
  expect(last(bars).support_price).toBe(100);expect(last(bars).pending).toBeNull();
 });
 it('rejects a candidate whose raised floor would lower the fixed invalidation reference',()=>{
  const bars=sbsBreakout().concat(sbsBar(39,106.5,104,400),[106.8,106,107,106,107,106.8].map((v,i)=>sbsBar(40+i,v,104,108)));
  const r=last(bars);expect(r.scale_before).toBeGreaterThan(12);expect(r.support_price).toBe(100);expect(r.pending).toBeNull();
 });
 it('records a retest timeout but keeps valid active support, and does not backdate late recovery',()=>{
  const bars=[...sbsBaseline(),sbsBar(37,103,102,104),sbsBar(38,101.4,100.2,103),sbsBar(39,101.4,100.2,103),sbsBar(40,101.4,100.2,103)];
  const engine=new Sbs5mEngine(options);const rows=bars.map(b=>engine.push(b)!);expect(rows.at(-1)!.support_price).toBe(100);expect(rows.at(-1)!.retest_status).toBe('FAILED');
  const before=rows.at(-1)!.last_successful_test_at;const late=engine.push(sbsBar(41,103,102,104))!;expect(late.last_successful_test_at).toBe(before);expect(late.events.some(e=>e.type==='RETEST_SUCCEEDED')).toBe(false);
  const independent=engine.push(sbsBar(42,103,100.2,104))!;expect(independent.retest_status).toBe('SUCCEEDED');expect(independent.last_successful_test_at).toBe(independent.at);
 });
 it('does not count continuous touching as repeated independent successful tests',()=>{
  const bars=sbsBaseline().concat(Array.from({length:8},(_,i)=>sbsBar(37+i,101.4,100.2,103)));
  expect(run(bars).events.filter(e=>e.type==='RETEST_SUCCEEDED')).toHaveLength(0);
 });
 it('retains maximum penetration after its candle leaves the recent evidence window',()=>{
  const engine=new Sbs5mEngine(options);sbsBaseline().forEach(b=>engine.push(b));const box=engine.active!,low=box.s-.4*box.a0;
  const hit=engine.push(sbsBar(37,103,low,104))!;expect(hit.penetration_component).toBeCloseTo(.2,10);
  let r=hit;for(let i=38;i<56;i++)r=engine.push(sbsBar(i,103,102,104))!;
  expect(r.penetration_component).toBeCloseTo(hit.penetration_component!,12);expect(r.active!.max_penetration).toBeCloseTo(.4,10);
 });
 it('does not add hold evidence from a true zero-turnover candle',()=>{
  const engine=new Sbs5mEngine(options);sbsBaseline().forEach(b=>engine.push(b));const a=engine.push(sbsBar(37,99.9,99.5,103))!,b=engine.push(sbsBar(38,103,102,104,0))!;
  expect(a.hold_fraction).toBeLessThan(1);expect(b.hold_fraction).toBeCloseTo(a.hold_fraction!,12);expect(b.data_valid).toBe(true);
 });
 it('breaks on a data gap and needs a new initialized segment rather than bridging unknown prices',()=>{
  const r=last(sbsBaseline().concat(sbsBar(38,103,102,104)));expect(r.support_price).toBeNull();expect(r.support_status).toBe('DATA_UNAVAILABLE');expect(r.reason_codes).toContain('DATA_GAP');
 });
 it('does not give missing turnover the meaning of true zero volume, and never silently switches modes',()=>{
  const bars=sbsBaseline();const missing={...bars.at(-1)!,quoteVolume:undefined};
  expect(last([...bars.slice(0,-1),missing]).support_status).toBe('DATA_UNAVAILABLE');expect(last([...bars.slice(0,-1),missing],{volume_mode:'base_times_close'}).data_valid).toBe(true);expect(sbsConfigHash()).not.toBe(sbsConfigHash({volume_mode:'base_times_close'}));
 });
 it('uses the same state transitions for batch, streaming, retries and restart checkpoints',()=>{
  const bars=sbsComplete(),batch=run(bars),engine=new Sbs5mEngine(options),a=bars.slice(0,40).map(b=>engine.push(b)!);
  const restored=new Sbs5mEngine({...options,checkpoint:engine.checkpoint()}),b=bars.slice(40).map(x=>restored.push(x)!);
  expect([...a,...b]).toEqual(batch.rows);expect(restored.events).toEqual(batch.events);expect(restored.history).toEqual(batch.history);expect(restored.push(bars.at(-1)!)).toBeNull();expect(restored.events).toEqual(batch.events);
 });
 it('does not rewrite the past after future appends or changes to an unclosed candle',()=>{
  const bars=sbsComplete(),prefix=run(bars.slice(0,37));expect(run(bars).rows.slice(0,37)).toEqual(prefix.rows);
  const a=run(bars.concat({...sbsBar(49,1,.5,5000),SBS5M_closed:false})),b=run(bars.concat({...sbsBar(49,999,1,1000),SBS5M_closed:false}));expect(a).toEqual(b);expect(a.rows).toEqual(run(bars).rows);
 });
 it('rejects incompatible checkpoint identities and includes every parameter in its hash',()=>{
  const checkpoint=run(sbsBaseline()).checkpoint;
  expect(()=>new Sbs5mEngine({...options,checkpoint,dataVersion:'revision-2'})).toThrow('不一致');expect(()=>new Sbs5mEngine({...options,checkpoint,config:{test_max_bars:2}})).toThrow('不一致');
  expect(sbsConfigHash()).not.toBe(sbsConfigHash({volatility_half_life:31}));expect(()=>sbsParameters({box_formation_bars:1})).toThrow();
 });
 it('uses actual elapsed time and returns null for a missing mean or a zero denominator',()=>{
  expect(sbsAverage([],0,1,(x:number)=>x,()=>0)).toBeNull();expect(sbsAverage([1],0,1,()=>null,()=>0)).toBeNull();expect(sbsQuality(1,0,1)).toBe(0);expect(sbsQuality(1,null,1)).toBeNull();
  expect(sbsAverage([{t:0,v:0},{t:60000,v:1}],60000,60000,x=>x.v,x=>x.t)).toBeCloseTo(2/3,12);
 });
});

it('excludes a formation wick using that candle’s prior scale even when final box width remains normal',()=>{
 const bars=sbsFormation();bars[30]={...bars[30],open:103.8,close:103.8};const x=run(bars);expect(x.rows.at(-1)!.pending).toBeNull();expect(x.rows[30].scale_before).toBeCloseTo(2,10);
});
it('does not extend the active lifetime after successful independent retests',()=>{
 const bars=sbsBaseline();for(let i=37;i<=48;i++)bars.push(sbsBar(i,103,i%2?102:100.2,104));
 const x=run(bars,{active_box_max_age:1});expect(x.events.some(e=>e.type==='RETEST_SUCCEEDED')).toBe(true);expect(x.rows.at(-1)!.support_status).toBe('STALE');expect(x.rows.at(-1)!.support_price).toBeNull();
});
it('uses a distinct new episode for a lower baseline after invalidation, with no automatic fallback',()=>{
 const bars=sbsComplete(),cut=run(bars).rows.at(-1)!;expect(cut.support_status).toBe('INVALID');
 const next=bars.concat([90.8,90,91,90,91,90.8].map((v,i)=>sbsBar(49+i,v,88,92)),sbsBar(55,90.8,88.2,91.2));const x=run(next),r=x.rows.at(-1)!;
 expect(x.rows.slice(bars.length,-1).every(v=>v.support_price===null)).toBe(true);expect(r.support_price).toBe(88);expect(r.episode_id).not.toBe(cut.episode_id);expect(r.parent_box_id).toBeNull();expect(r.step_height_atr).toBeNull();
});
