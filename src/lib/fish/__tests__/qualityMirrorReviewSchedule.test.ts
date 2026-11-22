import {expect,it} from 'vitest';
import {makeQualityHoldingVeto,makeQualityBuyFilter,parseHoldingVetoDraft,holdingVetoDraft} from '../qualityFilters';
import {MIRROR_LOSS_REVIEW_KIND as KIND,MIRROR_LOSS_THRESHOLD_VERSION as V3,MIRROR_REVIEW_SCHEDULE_VERSION as V4,mirrorLossReviewPoints,type MirrorReviewSchedule} from '../qualityMirrorLossReview';
import {freezeQualityPlan,planVersionChanges,qualityPlanVersions} from '../qualityPlanVersions';
import {evaluateQualitySample,qualityResultKey,type QualityGroup,type QualitySample} from '../quality';
import {holdingVetoIdentity,validateHoldingVeto} from '../qualityVeto';
import {instantMonitorExitDue} from '../instantMonitorExecution';
import type {FishReconstructionLoader} from '../reconstruction';
const M=60000,T=Date.UTC(2026,10,23),signal=new AbortController().signal;
const loss={version:V3,unit:'percent' as const,value:2};
const rule=(interval=.5,start=1)=>makeQualityHoldingVeto(KIND,'>=',start,true,[],100,loss,{version:V4,intervalHours:interval,endHours:12});
const def={id:'p',name:'价格',short:'价格',definition:'',formula:'raw=C',interval:'1m' as const,scale:1,unit:'',positive:'1',control:'0'};
const snapshot=makeQualityBuyFilter('p:raw','<',0,true,[def]).snapshot;
const plan=(interval=.5):QualityGroup=>({id:'p',label:'简化设置',metric:'raw',snapshot,vetoFill:'stop',holdingVetoes:[rule(interval)]});
const sample:QualitySample={id:'s',enteredAt:T,groups:[],basis:'signal',importedAt:T,source:{id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''}};
it('uses selected start and cadence through the preserved 12-hour horizon',()=>{
 expect(mirrorLossReviewPoints(T,1,1).map(t=>(t-T)/(60*M))).toEqual(Array.from({length:12},(_,i)=>i+1));
 expect(mirrorLossReviewPoints(T,2,.25).slice(0,3)).toEqual([T+120*M,T+135*M,T+150*M]);
 expect(mirrorLossReviewPoints(T,1,2).map(t=>(t-T)/(60*M))).toEqual([1,3,5,7,9,11]);
 expect(mirrorLossReviewPoints(T,1/60,1/60)).toHaveLength(720);
});
it.each([[.25,75],[.5,90],[1,120]])('changes execution timing for a %s-hour interval',async(interval,exitMinute)=>{
 const load:FishReconstructionLoader=async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>{const at=a+i*p.step,price=at>=T+69*M?97:101;return {openTime:at,open:at===T?100:price,high:at===T?100:price,low:Math.min(100,price),close:price,volume:1,takerBuyVolume:.5};});
 const r=await evaluateQualitySample(sample,plan(interval),0,T+(exitMinute+1)*M,load,signal,undefined,100);
 expect(r.status,r.reason).toBe('closed');expect(r.endTime).toBe(T+exitMinute*M);expect(r.exitSnapshot?.cause?.mirrorDeadlineVersion).toBe(V4);
 const due=await evaluateQualitySample(sample,plan(interval),0,T+exitMinute*M,load,signal,undefined,100);expect(instantMonitorExitDue(due)).toBe(true);
});
it.each([0,-1,NaN,Infinity,1/120,13])('rejects invalid interval %s',interval=>{expect(()=>rule(interval)).toThrow(/判断间隔/);});
it('preserves precision and rejects unknown versions or silent legacy conversion',()=>{
 const saved=[rule(.25123456789,.5123456789)],before=structuredClone(saved);expect(parseHoldingVetoDraft(holdingVetoDraft(saved),[])).toEqual(saved);expect(saved).toEqual(before);
 expect(()=>validateHoldingVeto({...saved[0],mirrorReviewSchedule:{...saved[0].mirrorReviewSchedule!,version:'future-v5' as typeof V4}})).toThrow(/执行版本/);
 expect(()=>validateHoldingVeto({...saved[0],mirrorDeadlineVersion:V3})).toThrow(/不能自动/);
 const draft=holdingVetoDraft(saved);draft[0].reviewSchedule!.intervalHours='';expect(()=>parseHoldingVetoDraft(draft,[])).toThrow(/判断间隔/);
 expect(()=>validateHoldingVeto({...saved[0],mirrorReviewSchedule:{...saved[0].mirrorReviewSchedule!,endHours:13} as unknown as MirrorReviewSchedule})).toThrow(/截止/);
});
it('freezes interval changes independently while saved v3 data and manifests remain unchanged',()=>{
 const legacy=freezeQualityPlan({...plan(),holdingVetoes:[makeQualityHoldingVeto(KIND,'>=',1,true,[],100,loss)]}),before=structuredClone(legacy);
 const current=freezeQualityPlan(plan()),changed=structuredClone(current);changed.holdingVetoes![0].mirrorReviewSchedule!.intervalHours=1;
 expect(planVersionChanges(current)).toEqual([]);expect(planVersionChanges(changed).some(v=>v.key==='hard-stop-mirror-loss-review')).toBe(true);
 expect(qualityResultKey(sample,current,0)).not.toBe(qualityResultKey(sample,changed,0));expect(holdingVetoIdentity(current.holdingVetoes)).not.toEqual(holdingVetoIdentity(changed.holdingVetoes));
 expect(current.frozenVersions?.find(v=>v.key==='hard-stop-mirror-loss-review')?.version).toContain(V4);expect(qualityPlanVersions(legacy)).toEqual(before.frozenVersions);expect(planVersionChanges(legacy)).toEqual([]);expect(legacy).toEqual(before);
});
