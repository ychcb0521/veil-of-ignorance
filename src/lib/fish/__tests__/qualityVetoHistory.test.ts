import { expect, it } from 'vitest';
import { createVetoHistoryReader } from '../qualityVetoHistory';
import { additionVetoIdentity, additionVetoLabel, validateAdditionVetoes, type QualityAdditionEntryVeto } from '../qualityAdditionVeto';
import { createPreEntryGate } from '../preEntryGate';
import { emptyPreEntryConditions } from '../preEntryConditions';
import { parseAdditionVetoDraft, vetoDraftOf } from '../qualityEntryVetoDraft';
import { withTuringInitialization } from '../qualityInitialization';
import type { FishReconstructionLoader } from '../reconstruction';
import type { ResearchBar } from '@/lib/deepRsa/window';

const M=60000,H=60*M,T=Date.UTC(2026,10,9,6),row={id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''};
const bar=(at:number):ResearchBar=>({openTime:at,open:100,high:101,low:99,close:100,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50});
function fixture(rules:QualityAdditionEntryVeto[],change:(bar:ResearchBar,step:number)=>ResearchBar=b=>b){
 let observed=T;const requests:{from:number;to:number;step:number}[]=[];
 const load:FishReconstructionLoader=async(_row,from,to,p)=>{
  expect(to).toBeLessThanOrEqual(observed);requests.push({from,to,step:p.step});
  return Array.from({length:(to-from)/p.step},(_,i)=>change(bar(from+i*p.step),p.step));
 };
 const options={rules,entry:T,row,load,signal:new AbortController().signal};
 const read=createVetoHistoryReader(options);
 return {options,requests,load,at:async(at:number)=>{observed=at;return read(at);},observe(at:number){observed=at;}};
}
it.each(['upper-wick','lower-wick','lower-spike'] as const)('scans a pre-entry %s outside the original 12-bar range and expires only outside the chosen window',async kind=>{
 const r=fixture([{kind,enabled:true,lookbackBars:12,atr:1.5,ratio:60,pct:5,historyHours:6}],(b,step)=>step===5*M&&b.openTime===T-2*H?{...b,...(kind==='upper-wick'?{high:140}:{low:60})}:b);
 expect((await r.at(T+M)).hit?.kind).toBe(kind);
 expect((await r.at(T+4*H)).hit?.kind).toBe(kind);
 expect((await r.at(T+4*H+5*M)).hit).toBeUndefined();
 expect(r.requests.some(q=>q.from<=T-6*H)).toBe(true);
});
it('uses the configured hours, does not inspect unclosed or future candles, and preserves deterministic resume',async()=>{
 const rule:QualityAdditionEntryVeto={kind:'lower-wick',enabled:true,historyHours:1,atr:1,ratio:60};
 const change=(b:ResearchBar,step:number)=>step===5*M&&[T-2*H,T].includes(b.openTime)?{...b,low:50}:b;
 const r=fixture([rule],change);expect((await r.at(T+4*M)).hit).toBeUndefined();
 const closed=await r.at(T+5*M);expect(closed.hit?.kind).toBe('lower-wick');
 const resume=fixture([rule],change);expect(await resume.at(T+5*M)).toEqual(closed);
});
it('finds pre-entry peak damage, survives retry and window expiry, and clears only on an actual recovery close',async()=>{
 const rule:QualityAdditionEntryVeto={kind:'pullback',enabled:true,pct:10,sticky:true,historyHours:6};
 const change=(b:ResearchBar,step:number)=>step===5*M&&b.openTime===T-2*H?{...b,high:150}:step===5*M&&b.openTime===T+7*H?{...b,high:151,close:150}:b;
 const r=fixture([rule],change),gate=createPreEntryGate({conditions:{...emptyPreEntryConditions(),entryVetoes:[rule]},start:T,row,load:r.load,signal:r.options.signal});
 r.observe(T+M);expect((await gate(T+M)).blocked).toContain('未收复高点锁定');
 gate.restart(T+M);r.observe(T+2*M);expect((await gate(T+2*M)).blocked).toContain('150');
 r.observe(T+7*H+4*M);const late=await gate(T+7*H+4*M);expect(late.blocked).toContain('150');
 const fresh=fixture([rule],change);expect(await fresh.at(T+7*H+4*M)).toMatchObject({hit:{reading:expect.stringContaining('150')}});
 r.observe(T+7*H+5*M);expect((await gate(T+7*H+5*M)).blocked).toBeUndefined();
});
it('sees a pre-entry fast drop while the legacy range remains unchanged',async()=>{
 const original:QualityAdditionEntryVeto={kind:'fast-drop',enabled:true,windows:[{minutes:1,pct:5}]};
 const r=fixture([{...original,historyHours:6}],b=>b.openTime===T-10*M?{...b,low:90,close:90}:b);
 expect((await r.at(T+M)).hit?.kind).toBe('fast-drop');
 const legacy=createPreEntryGate({conditions:{...emptyPreEntryConditions(),entryVetoes:[original]},start:T,row,load:r.load,signal:r.options.signal});
 expect((await legacy(T+M)).blocked).toBeUndefined();
 const fractional=fixture([{...original,historyHours:.11}]);expect(await fractional.at(T+M)).toEqual({pending:undefined});
});
it('keeps a pre-entry two-drop lock until recovery and does not count a continuous fall twice',async()=>{
 const rule:QualityAdditionEntryVeto={kind:'double-drop',enabled:true,pct:10,historyHours:6};
 const values=new Map([[T-30*M,120],[T-25*M,100],[T-20*M,115],[T-15*M,100]]);
 const r=fixture([rule],(b,step)=>step===5*M&&values.has(b.openTime)?{...b,open:values.get(b.openTime)!,high:Math.max(120,values.get(b.openTime)!),low:Math.min(99,values.get(b.openTime)!),close:values.get(b.openTime)!}:b);
 expect((await r.at(T+M)).hit).toMatchObject({kind:'double-drop',reading:expect.stringContaining('120')});
 expect((await r.at(T+7*H)).hit?.kind).toBe('double-drop');
});
it('detects volatility observed before entry even when the latest volatility is calm',async()=>{
 const r=fixture([{kind:'volatility',enabled:true,historyHours:6,ratio:1.8,er:0}],(b,step)=>step===5*M&&b.openTime===T-2*H?{...b,high:180,low:20}:b);
 expect((await r.at(T+M)).hit?.kind).toBe('volatility');
 expect((await r.at(T+7*H)).hit).toBeUndefined();
});
it('waits for a complete window with real initial-history bounds and rejects gaps rather than silently shortening history',async()=>{
 const r=fixture([{kind:'pullback',enabled:true,pct:10,historyHours:6}]);
 const read=createVetoHistoryReader({...r.options,row:{...row,symbol:'TURING:TURING 1'},load:withTuringInitialization(r.load,'TURING:TURING 1',T-H)});
 r.observe(T+M);expect((await read(T+M)).pending).toContain('完整行情不足');
 const gap=createVetoHistoryReader({...r.options,load:async(...args)=>(await r.load(...args)).slice(1)});
 await expect(gap(T+M)).rejects.toThrow();
});
it('does not invent ATR history for an early two-drop window and honors cancellation',async()=>{
 const r=fixture([{kind:'double-drop',enabled:true,atr:2,pct:10,historyHours:6}]);
 const read=createVetoHistoryReader({...r.options,row:{...row,symbol:'TURING:TURING 1'},load:withTuringInitialization(r.load,'TURING:TURING 1',T-M)});
 r.observe(T+5*M);expect((await read(T+5*M)).pending).toContain('完整行情不足');
 const aborter=new AbortController();aborter.abort();await expect(createVetoHistoryReader({...r.options,signal:aborter.signal})(T+M)).rejects.toMatchObject({name:'AbortError'});
});
it('versions history only when selected, defaults new conditions to six hours, and preserves legacy drafts and identities',()=>{
 const old:QualityAdditionEntryVeto={kind:'pullback',enabled:true,pct:10,sticky:true},before=structuredClone(old);
 const draft=vetoDraftOf([old]);expect(draft.pullback.historyHours).toBeUndefined();expect(parseAdditionVetoDraft(draft)).toEqual([old]);
 expect(vetoDraftOf()['lower-wick'].historyHours).toBe('6');
 expect(additionVetoLabel({kind:'upper-wick',enabled:true,historyHours:6})).toContain('近 72 根');
 expect(additionVetoIdentity([old])).not.toEqual(additionVetoIdentity([{...old,historyHours:6}]));expect(old).toEqual(before);
 for(const hours of [NaN,0,-1,721])expect(()=>validateAdditionVetoes([{...old,historyHours:hours}])).toThrow('历史回看');
});
