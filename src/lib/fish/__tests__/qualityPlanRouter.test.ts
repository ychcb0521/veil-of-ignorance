import {expect,it,vi} from 'vitest';
import {makeQualitySellPlan} from '../qualitySellPlans';
import {BUILTIN_FEATURES} from '@/lib/deepDig/features';
import {defaultStructureAddition} from '../qualityAdditionStructure';
import {evaluateQualityRouter,validateQualityRouter,QUALITY_ROUTER_VERSION,routerFingerprint,equivalentRouterVersion,type QualityPlanRouter} from '../qualityPlanRouter';
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
