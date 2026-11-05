import {expect,it,vi} from 'vitest';
import {makeQualitySellPlan} from '../qualitySellPlans';
import {BUILTIN_FEATURES} from '@/lib/deepDig/features';
import {defaultStructureAddition} from '../qualityAdditionStructure';
import {evaluateQualityRouter,validateQualityRouter,QUALITY_ROUTER_VERSION,QUALITY_ROUTER_FIRST_VERSION,QUALITY_ROUTER_RACE_VERSION,routerFingerprint,equivalentRouterVersion,routerOrdinal,mergedRacePlan,routedQualityPlan,type QualityPlanRouter} from '../qualityPlanRouter';
import {makeQualityBuyFilter} from '../qualityFilters';
import {freezeQualityPlan,planVersionChanges,comparePlanVersions} from '../qualityPlanVersions';
import {qualityResultKey,newQualityStudy,type QualityGroup} from '../quality';
import {qualityPlanFromTemplate} from '../qualityPlanTemplates';
import {syncQualitySellDefinitions} from '../qualityComparison';
const base=()=>({...makeQualitySellPlan('state:state','<',.5,BUILTIN_FEATURES,undefined,'structure'),addition:{enabled:true,source:'structure' as const,quantityMode:'calculator' as const,maxRounds:2,repeat:true,stricterPct:10,structure:defaultStructureAddition(),rounds:[0,1].map(()=>({source:'structure' as const,stricterPct:10,structure:defaultStructureAddition()}))}});
const router=():QualityPlanRouter=>{const structure=base();return {version:QUALITY_ROUTER_VERSION,afterAdditions:2 as const,threshold:.9,structure,attack:{...structuredClone(structure),id:'attack'}};};
const fills=(s:number)=>[{at:600000},{at:1200000,conditions:[{at:1200000,barOpenTime:900000,metric:'state',reading:s}]}] as any;
const result=(s:number)=>({key:'x',sampleId:'s',groupId:'g',evaluatedAt:1,status:'closed' as const,additionFills:fills(s),pnl:42});
it.each([[.95,'attack',2],[.9,'structure',1],[.68,'structure',1]] as const)('routes state %s strictly once to %s',async(s,branch,calls)=>{
 const run=vi.fn(async()=>result(s));const r=await evaluateQualityRouter(router(),run,p=>p.id);expect(r.routeDecision?.branch).toBe(branch);expect(run).toHaveBeenCalledTimes(calls);
});
it('rejects missing / future readings and different prefixes',async()=>{
 const missing=result(.95);missing.additionFills[1].conditions=[];await expect(evaluateQualityRouter(router(),async()=>missing,p=>p.id)).rejects.toThrow('已收盘');
 const future=result(.95);future.additionFills[1].conditions[0].barOpenTime=1200000;await expect(evaluateQualityRouter(router(),async()=>future,p=>p.id)).rejects.toThrow('已收盘');
 const bad=router();bad.attack.rule={...bad.attack.rule!,threshold:.8};expect(()=>validateQualityRouter(bad)).toThrow('完全相同');
 const run=vi.fn().mockResolvedValueOnce(result(.95)).mockResolvedValueOnce({...result(.95),additionFills:[{at:0},...fills(.95).slice(1)]});await expect(evaluateQualityRouter(router(),run,p=>p.id)).rejects.toThrow('改变了');
});
it('resumes the already selected branch without choosing again',async()=>{
 const prior={...result(.95),status:'open' as const,routeDecision:{branch:'attack' as const,at:1200000,reading:.95,threshold:.9}};const r=router(),run=vi.fn(async()=>result(.1));await evaluateQualityRouter(r,run,p=>p.id,prior);expect(run).toHaveBeenCalledExactlyOnceWith(r.attack,expect.objectContaining({key:'attack'}));
});
it('separates identity and versions, preserves copying and account formulas',()=>{
 const p=freezeQualityPlan({...base(),router:router()} as QualityGroup);expect(planVersionChanges(p)).toEqual([]);
 const oldManifest=p.frozenVersions!.filter(e=>e.key!=='router');expect(comparePlanVersions(p.frozenVersions!,oldManifest).length).toBeGreaterThan(0);
 const copy=qualityPlanFromTemplate({id:'tpl',name:'新方案',savedAt:1,updatedAt:1,plan:p},'new');expect(copy.router).toEqual(p.router);expect(copy.router).not.toBe(p.router);
 const mutated={...p,router:{...p.router!,threshold:.8}};expect(planVersionChanges(mutated).length).toBeGreaterThan(0);
 const sample={id:'s',source:{},groups:[],enteredAt:1} as any;expect(qualityResultKey(sample,p,0)).not.toBe(qualityResultKey(sample,mutated,0));
 const study={...newQualityStudy(),sellPlans:[p]};expect(syncQualitySellDefinitions(study).sellPlans![0]).toEqual(p);
});

it('ignores JSONB field ordering but rejects actual parameter changes',()=>{
 const p=freezeQualityPlan({...base(),router:router()});
 const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;
 const restored=reorder(JSON.parse(JSON.stringify(p)));
 expect(routerFingerprint(restored.router)).toBe(routerFingerprint(p.router!));expect(planVersionChanges(restored)).toEqual([]);
 restored.router.threshold=.8;expect(planVersionChanges(restored).length).toBeGreaterThan(0);
 const prefix=QUALITY_ROUTER_VERSION+' · 参数 #';expect(equivalentRouterVersion(prefix+'1cmjlqy15r0lzq',prefix+'1er917g1rq0q7q')).toBe(true);
 expect(equivalentRouterVersion(prefix+'1cmjlqy15r0lzq',prefix+'changed')).toBe(false);
});

// 【用户要求】2026-11-05 版本 2：第一次结构加仓成交时就分流；旧版本号仍按第二次分流
it('v2 decides at the first structural addition, shares only the first round, and keeps the versions paired',async()=>{
 const structure=base();const attack={...structuredClone(structure),id:'attack'};
 attack.addition.rounds[1]={source:'custom',stricterPct:10,minGainPct:11} as any;
 const r:QualityPlanRouter={version:QUALITY_ROUTER_FIRST_VERSION,afterAdditions:1,threshold:.85,structure,attack};
 validateQualityRouter(r);expect(routerOrdinal(r)).toBe('一');
 expect(()=>validateQualityRouter({...r,version:QUALITY_ROUTER_VERSION})).toThrow('版本');
 expect(()=>validateQualityRouter({...router(),afterAdditions:1})).toThrow('版本');
 expect(()=>validateQualityRouter({...router(),attack})).toThrow('前两次必须使用结构加仓');
 const first=(s:number)=>({...result(s),additionFills:[{at:600000,conditions:[{at:600000,barOpenTime:300000,metric:'state',reading:s}]}] as any});
 for(const [s,branch,calls] of [[.9,'attack',2],[.85,'structure',1]] as const){
  const run=vi.fn(async()=>first(s));const out=await evaluateQualityRouter(r,run,p=>p.id);
  expect(out.routeDecision).toMatchObject({branch,at:600000,reading:s,threshold:.85});expect(run).toHaveBeenCalledTimes(calls);
 }
 const stale=first(.9);stale.additionFills[0].conditions[0].barOpenTime=600000;await expect(evaluateQualityRouter(r,async()=>stale,p=>p.id)).rejects.toThrow('第一次结构加仓缺少此前已收盘');
 expect((await evaluateQualityRouter(r,async()=>({...result(.9),additionFills:[]}),p=>p.id)).routeDecision?.branch).toBe('structure');
 // 同一套分支、不同分流次数＝不同参数指纹，旧方案的版本字符串不变
 expect(routerFingerprint(r)).not.toBe(routerFingerprint({...r,afterAdditions:2,version:QUALITY_ROUTER_VERSION}));
 const frozen=freezeQualityPlan({...structure,router:r} as QualityGroup);
 expect(frozen.frozenVersions!.find(e=>e.key==='router')!.version.startsWith(QUALITY_ROUTER_FIRST_VERSION+' · 参数 #')).toBe(true);
 expect(frozen.frozenVersions!.find(e=>e.key==='router')!.summary).toContain('第一次结构加仓时');
 expect(planVersionChanges(frozen)).toEqual([]);
 expect(freezeQualityPlan({...base(),router:router()} as QualityGroup).frozenVersions!.find(e=>e.key==='router')!.version.startsWith(QUALITY_ROUTER_VERSION+' · 参数 #')).toBe(true);
});

// 【用户要求】2026-11-05 版本 3 每轮分流：两条分支除各轮条件外必须相同；运行时合成一套方案，进攻分支各轮成为进攻备选
it('v3 race mode merges the attack rounds as per-round alternatives and shares everything else',async()=>{
 const structure=base();const attack={...structuredClone(structure),id:'attack'};
 const stk=(t:number)=>({source:'custom' as const,stricterPct:10,condition:makeQualityBuyFilter('state:state','>',t,true,BUILTIN_FEATURES),minGainPct:10,gainBasis:'average' as const,entryDistanceAtr:2,supportOffsetAtr:1.5});
 attack.addition.rounds=[stk(.9),stk(.9)] as any;
 const r:QualityPlanRouter={version:QUALITY_ROUTER_RACE_VERSION,afterAdditions:0,threshold:.85,structure,attack};
 validateQualityRouter(r);
 expect(()=>validateQualityRouter({...r,version:QUALITY_ROUTER_VERSION})).toThrow('版本');
 expect(()=>validateQualityRouter({...r,threshold:.95})).toThrow('不低于分支门槛');
 expect(()=>validateQualityRouter({...r,attack:{...attack,addition:{...attack.addition,maxRounds:3,rounds:[stk(.9),stk(.9),stk(.9)]} as any}})).toThrow('不能多于');
 expect(()=>validateQualityRouter({...r,attack:{...attack,mirrorTakeProfit:{enabled:true,gainPct:6,sellPct:50}}})).toThrow('完全相同');
 const merged=mergedRacePlan(r);expect(merged.addition!.rounds).toEqual(structure.addition.rounds);expect(merged.addition!.alternativeRounds).toEqual(attack.addition.rounds);
 const run=vi.fn(async()=>({...result(.5),additionFills:[{at:1,lane:'attack'},{at:2,lane:'structure'}] as any}));
 const out=await evaluateQualityRouter(r,run,p=>p.id);
 expect(run).toHaveBeenCalledTimes(1);expect((run.mock.calls[0] as unknown as [QualityGroup])[0].addition!.alternativeRounds).toEqual(attack.addition.rounds);
 expect(out.routeDecision).toEqual({branch:'race',threshold:.85});
 expect(routedQualityPlan({...structure,router:r} as QualityGroup,out).addition!.alternativeRounds).toEqual(attack.addition.rounds);
 const frozen=freezeQualityPlan({...structure,router:r} as QualityGroup);expect(planVersionChanges(frozen)).toEqual([]);
 const entry=frozen.frozenVersions!.find(e=>e.key==='router')!;
 expect(entry.version.startsWith(QUALITY_ROUTER_RACE_VERSION+' · 参数 #')).toBe(true);expect(entry.summary).toContain('每一次加仓前都分流');
 expect(routerFingerprint(r)).not.toBe(routerFingerprint({...r,threshold:.9}));
});
