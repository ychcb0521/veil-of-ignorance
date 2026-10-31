import {describe,it,expect} from 'vitest';
import {Ati6hEngine,computeAti6h,atiComposite,ATI6H_DEFAULTS,ATI6H_COMPONENTS,type AtiInput} from '../ati6h';
const STEP=300000,HOUR=3600000;
const input=(i:number,close=102,extra:Partial<AtiInput['bar']>={},sigma=.01):AtiInput=>({bar:{openTime:i*STEP,open:close,high:close+.1,low:close-.1,close,volume:1,takerBuyVolume:.6,quoteVolume:100,takerBuyQuoteVolume:60,...extra},sigmaBefore:sigma,mbi2State:2,tickSize:.01});
export function structureFixture(){
 const data=Array.from({length:89},(_,i)=>input(i));
 data[80]=input(80,103,{open:103,high:105,low:102});
 data[81]=input(81,103,{high:104,low:102});
 data[82]=input(82,102,{high:103,low:101},.004);
 data[83]=input(83,101,{high:102,low:100});
 data[84]=input(84,102,{high:103,low:101});
 data[85]=input(85,102,{high:103,low:101.5});
 data[86]=input(86,100.5,{high:102,low:100.2});
 data[87]=input(87,102,{high:103,low:101});
 data[88]=input(88,105.3,{high:105.5,low:102});
 return data;
}
describe('ATI-6H causal market evidence',()=>{
 it('uses exactly 72 closed bars, normalized one-hour weights, and an outside return boundary only',()=>{
  const data=Array.from({length:90},(_,i)=>input(i,100+i/10));
  const out=computeAti6h(data).rows;
  expect(out[70].ATI6H_data_status).toBe('insufficient');expect(out[72].ATI6H_data_status).toBe('complete');
  const raw=Array.from({length:72},(_,i)=>2**(-(71-i)*STEP/HOUR)),sum=raw.reduce((a,b)=>a+b,0);
  expect(raw[71]/raw[59]).toBeCloseTo(2,14);expect(raw.reduce((s,a)=>s+a/sum,0)).toBeCloseTo(1,14);
  const changed=data.map((x,i)=>i<17?input(i,200,{low:1,quoteVolume:1e12,takerBuyQuoteVolume:0}):x);
  const last=computeAti6h(changed).rows.at(-1)!;
  for(const field of ['ATI6H_sC','ATI6H_sD','ATI6H_U_P','ATI6H_D_P','ATI6H_U_V','ATI6H_D_V','ATI6H_W_D'])expect(last[field]).toEqual(out.at(-1)![field]);
 });
 it('freezes support, waits for right confirmation, confirms retest later, and never resurrects a broken structure',()=>{
  const data=structureFixture(),out=computeAti6h(data).rows;
  expect(out[84].ATI6H_structure).toBeNull();
  const s=out[85].ATI6H_structure!;expect(s).not.toBeNull();expect(s.ATI6H_support_price).toBeCloseTo(100,12);
  expect(s.ATI6H_support_failure_price).toBeCloseTo(99.5012479193,9);
  expect(out[85].ATI6H_sB).toBeLessThanOrEqual(.5);expect(out[86].ATI6H_retest_status).toBe('pending');
  expect(out[86].ATI6H_events.some(e=>e.ATI6H_type==='retest_confirmed')).toBe(false);
  expect(out[87].ATI6H_events.some(e=>e.ATI6H_type==='retest_confirmed')).toBe(true);
  expect(out[87].ATI6H_best_retest_evidence).toBe(1);
  expect(out[88].ATI6H_support_failure_price).toBe(s.ATI6H_support_failure_price);
  const broken=computeAti6h([...data,input(89,102,{low:99.4,high:103}),input(90,102)]);
  expect(broken.rows[89].ATI6H_sB).toBe(0);expect(broken.rows[89].ATI6H_structure_status).toBe('broken');
  expect(broken.rows[90].ATI6H_structure).toBeNull();expect(broken.ATI6H_archive.at(-1)?.ATI6H_structure_status).toBe('broken');
 });
 it('future changes cannot alter earlier output and streaming equals batch replay',()=>{
  const data=structureFixture(),batch=computeAti6h(data).rows,engine=new Ati6hEngine();
  expect(data.map(d=>engine.push(d))).toEqual(batch);
  expect(computeAti6h([...data,input(89,999,{high:1000,low:.01})]).rows.slice(0,data.length)).toEqual(batch);
 });
 it('does not backdate a breakout that was already present at structural confirmation',()=>{
  const data=structureFixture();data[85]=input(85,106,{low:101.5,high:107});
  const row=computeAti6h(data.slice(0,86)).rows.at(-1)!;
  expect(row.ATI6H_sF).toBe(1);expect(row.ATI6H_breakout_cross_now).toBe(false);
  expect(row.ATI6H_breakout_first_observed_at).toBe(86*STEP);
 });
 it('uses the same frozen boundary for E and F, and equality does not count as a breakout',()=>{
  const data=structureFixture();const current=computeAti6h(data).rows.at(-1)!;
  expect(current.ATI6H_sF).toBe(1);expect(current.ATI6H_breakout_cross_now).toBe(true);
  expect(current.ATI6H_nearest_resistance_anchor_at).not.toBe(current.ATI6H_high_anchor_at);
  const line=current.ATI6H_breakout_price as number;const equal=computeAti6h([...data.slice(0,88),input(88,line,{high:106,low:102})]).rows.at(-1)!;
  expect(equal.ATI6H_sF).toBe(0);expect(equal.ATI6H_sE).toBe(0);
  expect(105*Math.exp(.002)).toBeCloseTo(105.2102101401,9);
  const rising=computeAti6h(Array.from({length:90},(_,i)=>input(i,100+i))).rows.at(-1)!;expect(rising.ATI6H_sF).toBe(0);
 });
 it('expires when any necessary pivot-confirmation interval leaves the window',()=>{
  const data=structureFixture();for(let i=89;i<160;i++)data.push(input(i,104));
  const {rows,ATI6H_archive}=computeAti6h(data);
  const ended=ATI6H_archive.find(s=>s.ATI6H_structure_status==='expired')!;
  expect(ended).toBeDefined();expect(ended.ATI6H_ended_at!-ended.ATI6H_high_left_at).toBe(6*HOUR);
  expect(rows.find(r=>r.ATI6H_at===ended.ATI6H_ended_at)!.ATI6H_sB).toBe(0);
 });
 it.each([.01,.08])('structure upgrades at sigma=%s never lower support or its failure boundary',sigma=>{
  const data=structureFixture();for(let i=89;i<106;i++)data.push(input(i,107));
  data[100]=input(100,115,{high:120,low:110});data[101]=input(101,110,{high:116,low:108});data[102]=input(102,107,{high:112,low:105});
  data[103]=input(103,104,{high:109,low:103});data[104]=input(104,106,{high:110,low:104});data[105]=input(105,107,{high:110,low:106},sigma);
  const out=computeAti6h(data),first=out.rows[85].ATI6H_structure!,last=out.rows.at(-1)!.ATI6H_structure!;
  if(sigma===.01){expect(last.ATI6H_structure_id).not.toBe(first.ATI6H_structure_id);expect(last.ATI6H_support_price).toBeGreaterThan(first.ATI6H_support_price);expect(last.ATI6H_support_failure_price).toBeGreaterThanOrEqual(first.ATI6H_support_failure_price);expect(out.ATI6H_archive.some(s=>s.ATI6H_structure_status==='replaced')).toBe(true);}
  else expect(last.ATI6H_structure_id).toBe(first.ATI6H_structure_id);
 });
 it('data gaps invalidate the current structure, never infer survival, and require a new full window',()=>{
  const data=structureFixture();const {rows,ATI6H_archive}=computeAti6h([...data,input(91,102)]);
  expect(rows.at(-1)!.ATI6H_data_status).toBe('insufficient');expect(rows.at(-1)!.ATI6H_reason_codes).toContain('data_gap');expect(ATI6H_archive.at(-1)!.ATI6H_structure_status).toBe('unverifiable');
 });
 it('initial evidence decays without moving prices; no touch does not create a retest',()=>{
  const data=structureFixture().slice(0,86);for(let i=86;i<91;i++)data.push(input(i,102));
  const rows=computeAti6h(data).rows;
  expect(rows.at(-1)!.ATI6H_initial_support_evidence).toBeLessThan(.5);expect(rows.at(-1)!.ATI6H_best_retest_evidence).toBe(0);
  expect(rows.at(-1)!.ATI6H_support_price).toBe(rows[85].ATI6H_support_price);
 });
 it.each([1,6,7])('retest confirmation after %i bars obeys the fixed six-bar deadline',delay=>{
  const data=structureFixture().slice(0,87);
  for(let i=87;i<=86+delay;i++)data.push(input(i,i===86+delay?102:100.5,{high:103,low:100.2}));
  const rows=computeAti6h(data).rows,events=rows.flatMap(r=>r.ATI6H_events);
  expect(events.filter(e=>e.ATI6H_type==='touch')).toHaveLength(1);
  expect(events.some(e=>e.ATI6H_type==='retest_confirmed')).toBe(delay<=6);
 });
 it('no directional returns is neutral, flat proxy volume is split equally, and no trade differs from missing trade',()=>{
  const data=Array.from({length:80},(_,i)=>input(i,102));
  const row=computeAti6h(data,{volumeMode:'bar_direction_proxy'}).rows.at(-1)!;
  expect(row.ATI6H_s_CP).toBe(.5);expect(row.ATI6H_s_CV).toBeCloseTo(.5,14);expect(row.ATI6H_sC).toBe(.5);
  const zero=computeAti6h(data.map(d=>({...d,bar:{...d.bar,quoteVolume:0,takerBuyQuoteVolume:0}}))).rows.at(-1)!;
  expect(zero.ATI6H_reason_codes).toContain('zero_volume');expect(zero.ATI6H_sC).toBeNull();
  const missing=computeAti6h(data.map(d=>({...d,bar:{...d.bar,quoteVolume:null}}))).rows.at(-1)!;
  expect(missing.ATI6H_reason_codes).toContain('missing_quote_volume');expect(missing.ATI6H_reason_codes).not.toContain('zero_volume');
 });
 it('never switches volume modes or clips invalid buy amounts into favorable evidence',()=>{
  const data=Array.from({length:80},(_,i)=>input(i));data[79].bar.takerBuyQuoteVolume=null;
  expect(computeAti6h(data).rows.at(-1)!.ATI6H_sC).toBeNull();
  expect(computeAti6h(data,{volumeMode:'bar_direction_proxy'}).rows.at(-1)!.ATI6H_sC).not.toBeNull();
  data[79].bar.takerBuyQuoteVolume=100.00000001;
  expect(computeAti6h(data).rows.at(-1)!.ATI6H_reason_codes).toContain('invalid_taker_volume');
 });
 it('a single extreme wick is not averaged away; older equal wicks decay, zero sigma still gives positive severity',()=>{
  const base=Array.from({length:90},(_,i)=>input(i,100,{high:100,low:100}));
  const at=(index:number,sigma=.01)=>computeAti6h(base.map((d,i)=>i===index?input(i,100,{high:100,low:90},sigma):d)).rows.at(-1)!;
  expect(Number(at(89).ATI6H_W_D)).toBeGreaterThan(Number(at(77).ATI6H_W_D));expect(at(89).ATI6H_sD).toBe(0);expect(Number(at(89,0).ATI6H_W_D)).toBeGreaterThan(0);
  const down=[...base.slice(0,89),input(89,90,{open:100,high:100,low:90})];const row=computeAti6h(down).rows.at(-1)!;
  expect(row.ATI6H_sD).toBe(1);expect(row.ATI6H_s_CP).toBe(0);
 });
 it('missing sigma is not zero, invalid OHLC is not repaired, and missing components leave known evidence visible',()=>{
  const data=Array.from({length:80},(_,i)=>input(i));data[79].sigmaBefore=null;
  const missing=computeAti6h(data).rows.at(-1)!;expect(missing.ATI6H).toBeNull();expect(missing.ATI6H_sA).toBe(1);expect(missing.ATI6H_sD).toBeNull();expect(missing.ATI6H_min).toBeNull();
  data[79].bar.high=1;expect(computeAti6h(data).rows.at(-1)!.ATI6H_reason_codes).toContain('invalid_ohlc_or_timestamp');
 });
 it('no resistance requires full data; A=0 still computes the other components',()=>{
  const data=Array.from({length:90},(_,i)=>({...input(i,100+i,{},.001),mbi2State:1}));
  const row=computeAti6h(data).rows.at(-1)!;expect(row.ATI6H_sA).toBe(0);expect(row.ATI6H_sC).not.toBeNull();expect(row.ATI6H_sE).toBe(1);expect(row.ATI6H_reason_codes).toContain('no_resistance_detected_in_6h');
  expect(computeAti6h(data.slice(0,20)).rows.at(-1)!.ATI6H_sE).toBeNull();
 });
 it('computes the specified C and geometric examples, null/zero priority, monotonicity and bounds',()=>{
  const inputs=Array.from({length:80},(_,i)=>input(i,100));
  const rise=2*Math.sqrt(2**(STEP/HOUR))*.01;
  inputs[78]=input(78,100*Math.exp(rise));inputs[79]=input(79,100*Math.exp(rise-.01));
  const actual=computeAti6h(inputs).rows.at(-1)!;
  expect(actual.ATI6H_s_CP).toBeCloseTo(.8,12);expect(actual.ATI6H_s_CV).toBeCloseTo(.6,12);
  expect(actual.ATI6H_sC).toBeCloseTo(.6928203230,10);
  const s={A:1,B:.8,C:.6,D:1,E:.7,F:1};expect(atiComposite(s)).toMatchObject({ATI6H_min:.6,ATI6H_shortboard:'C'});expect(atiComposite(s).ATI6H).toBeCloseTo(.8057893991,9);
  expect(atiComposite({A:1,B:1,C:1,D:1,E:1,F:1}).ATI6H).toBe(1);
  expect(atiComposite({...s,A:0}).ATI6H).toBe(0);expect(atiComposite({...s,A:0,B:null}).ATI6H).toBeNull();
  for(const k of ATI6H_COMPONENTS){const raised=atiComposite({...s,[k]:1}).ATI6H!;expect(raised).toBeGreaterThanOrEqual(atiComposite(s).ATI6H!);expect(raised).toBeGreaterThanOrEqual(.6);expect(raised).toBeLessThanOrEqual(1);}
  expect(Object.values(ATI6H_DEFAULTS.WEIGHTS).reduce((a,b)=>a+b,0)).toBeCloseTo(1,14);
 });
});
