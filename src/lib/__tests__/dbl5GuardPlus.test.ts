import {describe,expect,it} from 'vitest';
import {computeDbl5} from '../dbl5m';
import {DBL5_GUARD_PLUS_CONFIGURABLE_K_VERSION,DBL5_GUARD_PLUS_VERSION,Dbl5GuardPlusEngine,IMPULSE_1115_CONFIGURABLE_K_VERSION,IMPULSE_1115_POSITION_VERSION} from '../dbl5GuardPlus';
import {compileFeatureFormula,DBL5_DEF,DBL5_GUARD_PLUS_DEF,evaluateOnBars} from '../deepDig/features';
import {createStructureAdditionReader,defaultStructureAddition,structureAdditionK,type StructureAdditionRule} from '../fish/qualityAdditionStructure';
import {findCalculatorAdditions} from '../fish/qualityAdditionCalculator';
import {HOLDING_LEDGER_ADDITION_VERSION} from '../fish/qualityHoldingLedger';
import {currentUsdtFollowCampaign,type UsdtFollowCampaign} from '../fish/usdtFollow';
import type {FishReconstructionLoader} from '../fish/reconstruction';
import {defaultQualityAddition,validateQualityAddition,type QualityAdditionFill} from '../fish/qualityAddition';
import type {TradeSignal} from '../signalLibrary';
import {bar,impulse,START,STEP,TICK,warm} from './fixtures/dbl5GuardPlusBars';
import type {Dbl5Bar} from '../dbl5m';

const options={symbol:'TESTUSDT',tickSize:TICK,initializationStart:START};
const replay=(bars:readonly Dbl5Bar[])=>{
 const engine=new Dbl5GuardPlusEngine(options);
 return bars.flatMap(bar=>{const row=engine.push(bar);return row?[row]:[];});
};
const events=(bars:readonly Dbl5Bar[])=>replay(bars).flatMap(row=>row.plus.early_impulse_event?[row.plus.early_impulse_event]:[]);

describe('DBL-5防守线+急拉-1115',()=>{
 it('preserves exact native output and checkpoint when calculating both versions',()=>{
  const bars=[...warm(),impulse(),bar(21,101.4,102,101.2,101.9),bar(22,101.9,102,98,98.1)];
  const old=computeDbl5(bars,options),both=replay(bars);
  expect(both.map(row=>row.base)).toEqual(old.rows);
  const oldFormula=evaluateOnBars(bars,compileFeatureFormula(DBL5_DEF.formula),DBL5_DEF);
  const newFormula=evaluateOnBars(bars,compileFeatureFormula(DBL5_GUARD_PLUS_DEF.formula+'\nLegacy = DBL5_raw_value'),DBL5_GUARD_PLUS_DEF);
  expect(newFormula.DBL5_details).toEqual(oldFormula.DBL5_details);
  expect(newFormula.DBL5_checkpoint).toEqual(oldFormula.DBL5_checkpoint);
  expect(Array.from(newFormula.vars.get('Legacy') as Float64Array)).toEqual(Array.from(oldFormula.last as Float64Array));
  expect(newFormula.DBL5P_details?.at(-1)?.guard_plus_value).toBeNull();
  expect(newFormula.DBL5P_checkpoint?.algorithm_version).toBe(DBL5_GUARD_PLUS_VERSION);
 });
 it('matches the hand-calculated example, first available at the close',()=>{
  const engine=new Dbl5GuardPlusEngine(options);
  warm().forEach(row=>engine.push(row));
  const frozen=engine.checkpoint();
  // Explicit hand-calculated setup for the arithmetic assertion, independent of fixture warm-up.
  frozen.base.guard!.atr=100;
  frozen.base.guard!.line=9800;
  frozen.state.history.at(-1)!.atr=100;
  frozen.state.phase!.atr=100;
  const resumed=new Dbl5GuardPlusEngine({...options,checkpoint:frozen});
  expect(resumed.push({...impulse(),DBL5_closed:false})).toBeNull();
  const hit=resumed.push(impulse())!.plus;
  expect(hit).toMatchObject({guard_plus_value:99.45,base_guard_value:98,impulse_guard_value:99.45,phase_state:'EARLY',line_raised_by_impulse:true});
  expect(hit.early_impulse_event).toMatchObject({bars:1,frozen_atr:1,detected_at:START+21*STEP,available_at:START+21*STEP,impulse_origin_low:99.95,net_displacement_atr_at_detection:1.4});
  expect(hit.early_impulse_event?.body_efficiency_at_detection).toBeCloseTo(1.4/1.55);
  expect(hit.early_impulse_event?.advance_retention_at_detection).toBeCloseTo(1.4/1.5);
  const next=resumed.push(bar(21,101.4,102.1,101.35,102))!.plus;
  expect(next.early_impulse_event).toBeNull();
  expect(next.impulse_guard_value).toBe(99.45);
  expect(next.active_impulse).toEqual(hit.early_impulse_event);
 });
 it('keeps v1 outputs when no override is supplied and binds v2 checkpoints to the exact impulse buffer',()=>{
  const adjustable=new Dbl5GuardPlusEngine({...options,impulseBufferAtr:.25});
  const prefix=warm().map(row=>adjustable.push(row));
  expect(prefix.map(row=>row?.base)).toEqual(replay(warm()).map(row=>row.base));
  const checkpoint=adjustable.checkpoint();
  expect(checkpoint).toMatchObject({algorithm_version:DBL5_GUARD_PLUS_CONFIGURABLE_K_VERSION,effective_parameters:{bufferAtr:.25}});
  expect(()=>new Dbl5GuardPlusEngine({...options,checkpoint})).toThrow('检查点');
  expect(()=>new Dbl5GuardPlusEngine({...options,checkpoint,impulseBufferAtr:.75})).toThrow('检查点');
  const resumed=new Dbl5GuardPlusEngine({...options,checkpoint,impulseBufferAtr:.25});
  const actual=adjustable.push(impulse())!;
  expect(resumed.push(impulse())).toEqual(actual);
  expect(actual.plus.impulse_guard_value).toBeGreaterThan(events([...warm(),impulse()])[0].impulse_guard_value);
 });
 it('rejects steady bodies, recurring up gaps, pure jumps and high-volume upper wicks',()=>{
  const steady=(gap:number)=>Array.from({length:50},(_,i)=>{
   const open=Number((100+i*.5+gap).toFixed(2)),close=100+(i+1)*.5;
   return bar(i,open,close+.1,open-.1,close);
  });
  expect(events(steady(0))).toEqual([]);
  expect(events(steady(.12))).toEqual([]);
  expect(events([...warm(),bar(20,101.4,101.6,101.35,101.45)])).toEqual([]);
  expect(events([...warm(),bar(20,100,102.6,99.95,101.4,20000)])).toEqual([]);
 });
 it('recognizes multiple windows and never requires volume or a rising base',()=>{
  const two=events([...warm(),bar(20,100,100.86,99.78,100.7),bar(21,100.7,101.8,100.68,101.75)]);
  expect(two).toHaveLength(1);
  expect(two[0]).toMatchObject({bars:2,start_time:START+20*STEP});
  const three=events([...warm(),bar(20,100,100.9,99.82,100.63),bar(21,100.63,101.45,100.56,101.26),bar(22,101.26,102.3,101.24,102.28)]);
  expect(three).toHaveLength(1);
  expect(three[0].bars).toBe(3);
  const noVolume=replay([...warm(),impulse(20)].map(row=>({...row,volume:NaN}))).at(-1)!;
  expect(noVolume.base.darvas_5m_guard_regime).toBe('range');
  expect(noVolume.plus.early_impulse_event).toMatchObject({volume_basis:null,relative_volume_at_detection:null});
 });
 it('freezes WATCH until the fixed window breaks out or ends',()=>{
  const head=warm();
  // Tall high in the first member of the reference window, before the two-candle consolidation.
  head[17]=bar(17,100,101.6,99.95,100);
  const watching=bar(20,100,101.57,99.95,101.45);
  const failed=bar(21,101.45,101.58,101.33,101.5);
  const watchingRows=replay([...head,watching,failed]);
  expect(watchingRows.at(-2)?.plus.phase_state).toBe('WATCH');
  expect(watchingRows.at(-2)?.plus.impulse_guard_value).toBeNull();
  const next=bar(21,101.45,101.91,101.43,101.88);
  const hit=events([...head,watching,next])[0];
  expect(hit).toMatchObject({bars:2,start_time:START+20*STEP,detected_at:START+22*STEP});
  const late=replay([...head,watching,failed,bar(22,101.5,101.59,101.33,101.51)]).at(-1)!.plus;
  expect(late.phase_state).toBe('LATE');
 });
 it('locks overextension even though a shorter candle can meet the movement thresholds',()=>{
  const bars=[...warm(),bar(20,100,101.37,99.95,101.25),bar(21,101.25,103.05,101.24,103),
   bar(22,103,103.02,101.97,102),bar(23,102,103.38,101.99,103.34)];
  const rows=replay(bars);
  expect(rows[20].plus.phase_state).toBe('EARLY');
  expect(rows.slice(21).every(row=>row.plus.early_impulse_event===null)).toBe(true);
  const blocked=replay([...warm(),bar(20,100,103.7,99.95,103.45),bar(21,103.45,103.5,101.44,101.5),bar(22,101.5,103,101.4,102.95)]);
  expect(blocked[20].plus.phase_state).toBe('OVEREXTENDED');
  expect(blocked.slice(20).every(row=>row.plus.early_impulse_event===null)).toBe(true);
 });
 it('records wick, equality, strict break, and begins a separate fallback segment',()=>{
  const atHit=replay([...warm(),impulse()]).at(-1)!.plus;
  const k=atHit.impulse_guard_value!;
  const rows=replay([...warm(),impulse(),
   bar(21,101.4,101.45,k-.05,k+.05),
   bar(22,k+.05,k+.1,k-.05,k),
   bar(23,k,k+.05,k-.1,k-.05),
   bar(24,k-.05,k+.3,k-.1,k+.25),
  ].map(row=>({...row,high:Number(row.high.toFixed(2)),low:Number(row.low.toFixed(2)),open:Number(row.open.toFixed(2)),close:Number(row.close.toFixed(2))})));
  expect(rows[21].plus).toMatchObject({wick_penetration:true,impulse_active:true});
  expect(rows[22].plus).toMatchObject({impulse_guard_value:k,impulse_broken_event:null});
  expect(rows[23].plus).toMatchObject({phase_state:'BROKEN',guard_plus_value:null,impulse_active:false,early_impulse_event:null,ended_segment:{reason:'IMPULSE_BROKEN'}});
  expect(rows[24].plus.guard_plus_value).toBe(rows[24].base.darvas_5m_guard);
  expect(rows[24].plus.segment_id).not.toBe(rows[22].plus.segment_id);
 });
 it('keeps a hidden impulse alive independently of a higher range baseline and records a simultaneous expiry as a break',()=>{
  const seed=new Dbl5GuardPlusEngine(options);
  warm().forEach(row=>seed.push(row));
  const checkpoint=seed.checkpoint();
  checkpoint.base.guard!.line=10010;
  const engine=new Dbl5GuardPlusEngine({...options,checkpoint});
  const issued=engine.push(impulse())!.plus;
  expect(issued.guard_source).toBe('BASE');
  expect(issued.line_raised_by_impulse).toBe(false);
  const saved=engine.checkpoint(),closingAt=START+22*STEP;
  saved.state.active!.expires_at=closingAt;
  const replayed=new Dbl5GuardPlusEngine({...options,checkpoint:saved});
  const point=replayed.push(bar(21,101.4,101.5,99.2,99.3))!;
  expect(point.base.darvas_5m_guard_broken).toBe(false);
  expect(point.plus).toMatchObject({guard_plus_value:null,base_guard_value:100.1,impulse_expired_event:null,ended_segment:{reason:'IMPULSE_BROKEN'}});
  expect(point.plus.impulse_broken_event?.impulse_id).toBe(issued.impulse_id);
 });
 it('allows a second event only after two post-lock candles and does not lower or renew an older impulse',()=>{
  const bars=[...warm(),impulse(),bar(21,101.4,101.45,100.5,100.55),
   bar(22,100.55,100.61,100.52,100.55),bar(23,100.55,100.62,100.51,100.55),
   bar(24,100.55,102.2,99.55,102.15)];
  const initial=replay(bars.slice(0,-1));
  expect(initial[21].plus.phase_changed).toBe(false);
  expect(initial[23].plus.phase_changed).toBe(true);
  expect(initial[23].plus.active_impulse?.expires_at).toBe(initial[20].plus.active_impulse?.expires_at);
  // After the pause, a separate valid surge triggers with a higher low, so it can replace the old line.
  const second=replay([...bars.slice(0,-1),bar(24,100.55,102.2,100.5,102.15)]).at(-1)!.plus;
  expect(second.early_impulse_event?.impulse_id).not.toBe(initial[20].plus.impulse_id);
  expect(second.early_impulse_event).not.toBeNull();

  // Resume a valid phase with an existing higher line to isolate the no-lower-replacement branch.
  const engine=new Dbl5GuardPlusEngine(options);
  bars.slice(0,-1).forEach(row=>engine.push(row));
  const state=engine.checkpoint();
  state.state.active!.impulse_guard_value=100.6;
  const lower=new Dbl5GuardPlusEngine({...options,checkpoint:state}).push(bar(24,100.55,102.2,100.5,102.15))!.plus;
  expect(lower.early_impulse_event?.impulse_guard_value).toBeLessThan(100.6);
  expect(lower.active_impulse?.expires_at).toBe(initial[20].plus.active_impulse?.expires_at);
  expect(lower.impulse_guard_value).toBe(100.6);
  expect(lower.line_raised_by_impulse).toBe(false);
 });
 it('resumes the same checkpoint and rejects revised input until replayed',()=>{
  const initial=[...warm(),impulse()],tail=[bar(21,101.4,102,101.2,101.8),bar(23,101.7,102,101.1,101.8)];
  const engine=new Dbl5GuardPlusEngine(options);
  initial.forEach(row=>engine.push(row));
  const checkpoint=JSON.parse(JSON.stringify(engine.checkpoint()));
  const restored=new Dbl5GuardPlusEngine({...options,checkpoint});
  expect(restored.push(impulse())).toBeNull();
  expect(()=>restored.push({...impulse(),volume:50})).toThrow('成交量变化');
  expect(()=>restored.push(bar(19,100,100.5,99.5,100))).toThrow('乱序');
  expect(tail.map(row=>restored.push(row))).toEqual(replay([...initial,...tail]).slice(-2));
  expect(restored.checkpoint().state.lastRow).toMatchObject({reason:'DATA_GAP',impulse_active:false});
  expect(replay([...initial,...tail]).slice(0,initial.length)).toEqual(replay(initial));
  expect(()=>new Dbl5GuardPlusEngine({...options,dataVersion:'revised',checkpoint})).toThrow();
 });
 it('routes the first detection into the existing addition reader and deduplicates a saved fill',async()=>{
  const bars=[...warm(),impulse(),bar(21,101.4,102,101.3,101.9),bar(22,101.9,102.4,101.9,102.35)];
  const entry=START+19*STEP,end=START+23*STEP;
  const market:FishReconstructionLoader=async(_row,from,to)=>bars.filter(b=>b.openTime>=from&&b.openTime<to);
  const load=Object.assign(market,{turingInitialization:{version:'turing-origin-v1' as const,startMs:START}});
  const rule:StructureAdditionRule={...defaultStructureAddition('dbl5'),kSource:'guard',guardPlusVersion:DBL5_GUARD_PLUS_VERSION,buffer:1};
  const make=(liveAt?:number)=>createStructureAdditionReader({row:{symbol:'TESTUSDT'} as TradeSignal,entry,end,load,signal:new AbortController().signal,liveAt});
  const reader=make(),hit=await reader(rule,entry,end,[]);
  expect(hit?.at).toBe(START+21*STEP);
  expect(hit?.structureEvidence).toMatchObject({event:'IMPULSE_EARLY',guardCloses:1,buffer:0});
  expect(structureAdditionK(hit!.structureEvidence!,4)?.k).toBe(hit!.structureEvidence!.guardPlus!.impulse_guard_value);
  expect(await reader(rule,entry,end,[hit as QualityAdditionFill])).toBeUndefined();
  expect(await make(START+22*STEP)(rule,entry,end,[])).toBeUndefined();
  expect(await make(START+21*STEP+1_000)(rule,entry,end,[])).toMatchObject({at:START+21*STEP});
 });
 it('runs the actual holding ledger with the same frozen K in either lane and on resume',async()=>{
  const bars=[...warm(),impulse(),bar(21,101.4,102,101.3,101.9),bar(22,101.9,102.4,101.9,102.35)];
  const entry=START+19*STEP,end=START+23*STEP,at=START+21*STEP,minute=60_000;
  const prices=Array.from({length:(end-entry)/minute},(_,i)=>{
   const openTime=entry+i*minute,p=openTime<at?99:101.4;
   return {openTime,open:p,high:p,low:p,close:p,volume:1,takerBuyVolume:null};
  });
  const market:FishReconstructionLoader=async(_row,from,to,plan)=>(plan.step===STEP?bars:prices).filter(b=>b.openTime>=from&&b.openTime<to);
  const load=Object.assign(market,{turingInitialization:{version:'turing-origin-v1' as const,startMs:START}});
  const rule:StructureAdditionRule={...defaultStructureAddition('dbl5'),kSource:'guard',guardPlusVersion:DBL5_GUARD_PLUS_VERSION,buffer:2};
  const options={row:{symbol:'TESTUSDT',timeMs:end} as TradeSignal,entry,end,entryPrice:99,notional:99,load,prices,
   maxRounds:1,since:entry,signal:new AbortController().signal,repeat:false,candidates:[],previous:[],positionVersion:HOLDING_LEDGER_ADDITION_VERSION};
  const main=await findCalculatorAdditions({...options,structure:rule});
  expect(main.fills).toHaveLength(1);
  const first=main.fills[0],k=first.structureEvidence!.guardPlus!.impulse_guard_value!;
  expect(first).toMatchObject({at,price:101.4,ledger:{costBefore:99},sizing:{support:k},structureEvidence:{event:'IMPULSE_EARLY'}});
  expect(first.quantity).toBeCloseTo((k-99)/(101.4-k));
  const attack=await findCalculatorAdditions({...options,roundRules:[{candidates:[],unavailable:'fixture',alternative:{candidates:[],structure:rule}}]});
  expect(attack.fills).toHaveLength(1);
  expect(attack.fills[0]).toMatchObject({lane:'attack',at,sizing:{support:k}});
  const resumed=await findCalculatorAdditions({...options,structure:rule,previous:main.fills,since:at+minute,prices:prices.filter(bar=>bar.openTime>=at+minute)});
  expect(resumed.fills).toEqual(main.fills);
  const independent={version:IMPULSE_1115_POSITION_VERSION,skipNative:true} as const;
  const split=await findCalculatorAdditions({...options,impulse1115Position:independent});
  expect(split.fills).toHaveLength(1);
  expect(split.fills[0]).toMatchObject({at,price:101.4,sizing:{support:k},structureEvidence:{
   algorithmVersion:IMPULSE_1115_POSITION_VERSION,event:'IMPULSE_EARLY',guardCloses:1,buffer:0,
  }});
  const splitAttack=await findCalculatorAdditions({...options,roundRules:[{candidates:[],unavailable:'fixture',alternative:{candidates:[],impulse1115Position:independent}}]});
  expect(splitAttack.fills[0]).toMatchObject({lane:'attack',at,sizing:{support:k}});
  const configurable={version:IMPULSE_1115_CONFIGURABLE_K_VERSION,bufferAtr:.25,skipNative:true} as const;
  const early=split.fills[0].structureEvidence!.guardPlus!.early_impulse_event!;
  const adjustedK=Math.floor((early.impulse_origin_low-.25*early.frozen_atr)*100)/100;
  const customizedCombo:StructureAdditionRule={...rule,guardPlusVersion:DBL5_GUARD_PLUS_CONFIGURABLE_K_VERSION,guardPlusImpulseBufferAtr:.25};
  const comboMain=await findCalculatorAdditions({...options,structure:customizedCombo});
  expect(comboMain.fills).toHaveLength(1);
  expect(comboMain.fills[0]).toMatchObject({at,sizing:{support:adjustedK},structureEvidence:{
   algorithmVersion:DBL5_GUARD_PLUS_CONFIGURABLE_K_VERSION,event:'IMPULSE_EARLY',
   guardPlus:{guard_source:'IMPULSE',effective_parameters:{bufferAtr:.25}},
  }});
  const comboAttack=await findCalculatorAdditions({...options,roundRules:[{candidates:[],unavailable:'fixture',
   alternative:{candidates:[],structure:customizedCombo}}]});
  expect(comboAttack.fills[0]).toMatchObject({lane:'attack',at,sizing:{support:adjustedK}});
  const adjustable=await findCalculatorAdditions({...options,impulse1115Position:configurable});
  expect(adjustable.fills[0]).toMatchObject({at,sizing:{support:adjustedK},structureEvidence:{
   algorithmVersion:IMPULSE_1115_CONFIGURABLE_K_VERSION,basePrice:early.impulse_origin_low,buffer:.25,k:adjustedK,
   parameters:{referenceAtr:early.frozen_atr},
  }});
  expect(adjustable.fills[0].quantity).toBeCloseTo((adjustedK-99)/(101.4-adjustedK));
  const adjustableAttack=await findCalculatorAdditions({...options,roundRules:[{candidates:[],unavailable:'fixture',alternative:{candidates:[],impulse1115Position:configurable}}]});
  expect(adjustableAttack.fills[0]).toMatchObject({lane:'attack',at,sizing:{support:adjustedK}});
  const parallel={version:IMPULSE_1115_CONFIGURABLE_K_VERSION,bufferAtr:.25} as const;
  expect(adjustedK).not.toBe(k);
  expect(()=>validateQualityAddition({...defaultQualityAddition(),enabled:true,source:'structure',structure:rule,impulse1115Position:parallel})).not.toThrow();
  const simultaneous=await findCalculatorAdditions({...options,structure:rule,impulse1115Position:parallel,maxRounds:2,repeat:true});
  expect(simultaneous.fills).toEqual(main.fills);
  const simultaneousAttack=await findCalculatorAdditions({...options,roundRules:[{candidates:[],unavailable:'fixture',
   alternative:{candidates:[],structure:rule,impulse1115Position:parallel}}]});
  expect(simultaneousAttack.fills).toEqual(attack.fills);
  const widened=await findCalculatorAdditions({...options,impulse1115Position:{...configurable,minDistancePct:2}});
  expect(widened.fills[0].structureEvidence).toMatchObject({k:99.37,widenedFrom:adjustedK,minDistancePct:2});
  const calm=async(_row:TradeSignal,from:number,to:number)=>[...warm(),bar(20,100,100.2,99.95,100)].filter(row=>row.openTime>=from&&row.openTime<to);
  const notAnImpulse=createStructureAdditionReader({...options,load:Object.assign(calm,{turingInitialization:{version:'turing-origin-v1' as const,startMs:START}})});
  const native=await notAnImpulse({...defaultStructureAddition(),trigger:'confirm',kSource:'guard'},entry,at,[]);
  expect(native).toMatchObject({at:START+20*STEP});
  const defense=await notAnImpulse({...customizedCombo,trigger:'confirm',buffer:0},entry,at,[]);
  expect(defense).toMatchObject({at:native?.at,structureEvidence:{
   event:native?.structureEvidence?.event,basePrice:native?.structureEvidence?.basePrice,
   algorithmVersion:DBL5_GUARD_PLUS_CONFIGURABLE_K_VERSION,guardPlus:{guard_source:'BASE'},
  }});
  expect(await notAnImpulse.impulse1115(entry,at,[])).toBeUndefined();
 });
 it('gates real forwarding on the executor capability and the exact next close',()=>{
  const early=events([...warm(),impulse()])[0];
  const campaign:UsdtFollowCampaign={id:'fish-instant-fixture',source:{symbol:'TESTUSDT'},admittedAt:START,notional:10,leverage:5,
   requiresGuardPlus:true,actions:[{id:'open',action:'open',at:START},{id:'add-'+early.impulse_id,action:'add',at:early.detected_at,notional:2,impulseFreshUntil:early.fresh_until}]};
  expect(currentUsdtFollowCampaign(campaign,false,early.detected_at+2)).toBeUndefined();
  expect(currentUsdtFollowCampaign(campaign,true,early.fresh_until-1)?.actions).toEqual(campaign.actions);
  expect(currentUsdtFollowCampaign(campaign,true,early.fresh_until)?.actions).toEqual([campaign.actions[0]]);
 });
});
