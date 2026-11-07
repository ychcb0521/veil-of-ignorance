import type { QualityGroup } from './quality';
import { planVersionChanges, qualityPlanVersions } from './qualityPlanVersions';
import { validateQualityRouter } from './qualityPlanRouter';

/** Detach complete frozen branches. Never rebuild them from current account formulas. */
export function splitQualityBranches(source:QualityGroup,ids:{structure:string;attack:string},labels?:{structure:string;attack:string}):[QualityGroup,QualityGroup] {
  if(!source.router)throw Error('请选择包含结构分支和进攻分支的组合方案');
  validateQualityRouter(source.router);
  if(planVersionChanges(source).length)throw Error('原组合的冻结版本与当前代码不一致，不能用新版本代替原参数拆分');
  if(!ids.structure||!ids.attack||ids.structure===ids.attack||ids.structure===source.id||ids.attack===source.id)throw Error('拆分后的方案须使用不同的新编号');
  return (['structure','attack'] as const).map(branch=>{
    const plan=structuredClone(source.router![branch]);
    plan.id=ids[branch];plan.label=labels?.[branch]??`${source.label} · ${branch==='structure'?'结构型':'进攻型'}`;
    // Wrapper-level historical filters/initialization apply to both standalone experiments.
    if(source.buyFilters!==undefined)plan.buyFilters=structuredClone(source.buyFilters);
    if(source.initialization!==undefined&&plan.initialization===undefined)plan.initialization=source.initialization;
    delete plan.router;
    const prefix=branch+':';
    const frozen=source.frozenVersions?.filter(v=>v.key.startsWith(prefix)).map(v=>({...v,key:v.key.slice(prefix.length),part:v.part.replace(/^(结构分支|进攻分支) · /,'')}));
    plan.frozenVersions=plan.frozenVersions??(frozen?.length?frozen:qualityPlanVersions(plan));
    if(source.initialization&&!plan.frozenVersions.some(v=>v.key==='initialization')){
      const initialization=source.frozenVersions?.find(v=>v.key==='initialization');
      if(initialization)plan.frozenVersions.unshift({...initialization});
    }
    if(planVersionChanges(plan).length)throw Error('分支冻结版本不完整，无法保证原参数；已停止拆分');
    return plan;
  }) as [QualityGroup,QualityGroup];
}
