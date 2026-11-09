import {expect,it} from 'vitest';
import {createVetoHistoryReader} from '../qualityVetoHistory';
import {ADDITION_VETO_DEFAULTS,additionVetoIdentity,type QualityAdditionEntryVeto} from '../qualityAdditionVeto';
import {freezeQualityPlan,planVersionChanges} from '../qualityPlanVersions';
import {emptyPreEntryThreeStage} from '../preEntryThreeStage';
import {parseAdditionVetoDraft,vetoDraftOf} from '../qualityEntryVetoDraft';
import type {QualityGroup} from '../quality';
import type {FishReconstructionLoader} from '../reconstruction';
const M=60000,F=5*M,T=Date.UTC(2026,10,9),row={id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''};
const stall:QualityAdditionEntryVeto={...ADDITION_VETO_DEFAULTS['stall-turn'],enabled:true},pullback:QualityAdditionEntryVeto={...ADDITION_VETO_DEFAULTS['pullback-new-high'],enabled:true};
const candle=(at:number,close:number,high=close)=>({openTime:at,open:close,high,low:close,close,volume:1,takerBuyVolume:.5});
const read=(rules:QualityAdditionEntryVeto[],load:FishReconstructionLoader)=>createVetoHistoryReader({rules,load,row,entry:T,signal:new AbortController().signal});
it('keeps stall and sharp-pullback switches independent and preserves every explicit setting on roundtrip',()=>{
 for(const rules of [[stall],[pullback],[stall,pullback]])expect(parseAdditionVetoDraft(vetoDraftOf(rules))).toEqual(rules);
 expect(parseAdditionVetoDraft(vetoDraftOf())).toEqual([]);
 expect(additionVetoIdentity([stall])).not.toEqual(additionVetoIdentity([pullback]));
});
it('sharp pullback alone blocks without any rising/stalling pattern or ATR, preserving a lock beyond its window for late holding candidates',async()=>{
 const load:FishReconstructionLoader=async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>{expect(p.step).toBe(F);const at=a+i*p.step;return candle(at,at<T-F?100:at<T+8*60*M?96:101,at===T-F?100:at<T-F?100:at<T+8*60*M?96:101);});
 const rules=[{...pullback,historyHours:1/12}],continuous=read(rules,load);
 expect((await read([stall],load)(T)).hit).toBeUndefined();expect((await continuous(T)).hit?.kind).toBe('pullback-new-high');
 const late=await continuous(T+7*60*M);expect(late.hit?.kind).toBe('pullback-new-high');expect(await read(rules,load)(T+7*60*M)).toEqual(late);
 expect((await continuous(T+8*60*M+4*M)).hit?.kind).toBe('pullback-new-high');expect((await continuous(T+8*60*M+F)).hit).toBeUndefined();
});
it('stall alone can veto a small reversal below the independently selected sharp-pullback threshold',async()=>{
 const seq=[101,102,103,104,105,106,107,108,109,110,111,112,112,112,112,111,110],price=(i:number)=>i < -17?100:i<0?seq[i+17]:i===0?111:112;
 const load:FishReconstructionLoader=async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>{const at=a+i*p.step,k=(at-T)/F,open=price(k-1),close=price(k);return {...candle(at,close,Math.max(open,close)),open,low:Math.min(open,close)};});
 expect((await read([pullback],load)(T)).hit).toBeUndefined();const s=read([stall],load);expect((await s(T)).hit?.kind).toBe('stall-turn');expect((await s(T+9*M)).hit?.kind).toBe('stall-turn');expect((await s(T+10*M)).hit).toBeUndefined();
});
it('freezes independent canonical versions, accepts JSONB key reordering, and rejects actual parameter changes',()=>{
 const p=freezeQualityPlan({id:'p',label:'共享否决',snapshot:{},preEntryThreeStage:{...emptyPreEntryThreeStage(),additionVetoes:[stall,pullback]}} as QualityGroup),before=JSON.stringify(p);
 expect(p.frozenVersions!.filter(v=>v.key.startsWith('shared-')).map(v=>v.key)).toEqual(['shared-stall-turn','shared-pullback-new-high']);
 const reverse=(x:unknown):unknown=>Array.isArray(x)?x.map(reverse):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).reverse().map(([k,v])=>[k,reverse(v)])):x;
 expect(planVersionChanges(reverse(p) as QualityGroup)).toEqual([]);
 for(const [index,key] of [[0,'riseMinutes'],[0,'historyHours'],[1,'pct']] as const){const changed=structuredClone(p);changed.preEntryThreeStage!.additionVetoes[index][key]!+=5;expect(planVersionChanges(changed).length).toBeGreaterThan(0);}
 expect(JSON.stringify(p)).toBe(before);
});
