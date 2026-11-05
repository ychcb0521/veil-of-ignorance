import type { QualityGroup, QualityResult, QualitySample } from './quality';
import { shortFishHash } from './algorithm';

export const QUALITY_ROUTER_VERSION = 'second-structural-addition-state-router-v1';
/**
 * 【用户要求】2026-11-05 版本 2：分流提前到第一次结构加仓成交时。1081 信号回放（510 场跑完）里 v1 只有 12 场走到第二次结构加仓、3 场进了进攻分支；
 * 直线拉升的币（45 场峰值 ≥ 15%，中位 72 分钟到 +15%）最多只形成一个箱体，第二次结构加仓等不到。旧版本号与已存方案照旧按第二次分流计算，结果逐位不变。
 */
export const QUALITY_ROUTER_FIRST_VERSION = 'first-structural-addition-state-router-v1';
export type QualityRouterVersion = typeof QUALITY_ROUTER_VERSION | typeof QUALITY_ROUTER_FIRST_VERSION;
export interface QualityPlanRouter {
  version: QualityRouterVersion; afterAdditions: 1 | 2; threshold: number;
  structure: QualityGroup; attack: QualityGroup;
}
/** 第 n 次结构加仓分流对应的版本号；版本号与次数必须成对，否则方案无效。 */
export const routerVersionFor = (afterAdditions: 1 | 2): QualityRouterVersion => afterAdditions === 1 ? QUALITY_ROUTER_FIRST_VERSION : QUALITY_ROUTER_VERSION;
/** 文案：分流发生在第「一 / 二」次结构加仓，之后从第「二 / 三」次起走分支，公共前缀是「第一次 / 前两次」加仓。 */
export const routerOrdinal = (r: Pick<QualityPlanRouter, 'afterAdditions'>) => r.afterAdditions === 1 ? '一' : '二';
export const routerNextOrdinal = (r: Pick<QualityPlanRouter, 'afterAdditions'>) => r.afterAdditions === 1 ? '二' : '三';
export const routerPrefixText = (r: Pick<QualityPlanRouter, 'afterAdditions'>) => r.afterAdditions === 1 ? '第一次' : '前两次';
export interface QualityRouteDecision { branch: 'structure' | 'attack'; at?: number; reading?: number; threshold: number }
/** JSONB may reorder object fields. Arrays retain their meaning and ordering. */
export const canonicalRouterJson=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
export const routerFingerprint = (r: QualityPlanRouter) => shortFishHash(canonicalRouterJson(r));
/** Exact, verified compatibility for the original installed candidate; never bless arbitrary edits. */
export function equivalentRouterVersion(frozen:string,current:string):boolean{
 const prefix=QUALITY_ROUTER_VERSION+' · 参数 #';
 return current===prefix+'1er917g1rq0q7q'&&[prefix+'1cmjlqy15r0lzq',prefix+'1kpvpw2rkvbiu'].includes(frozen);
}
// Plans are immutable during a run; avoid serializing both frozen branches for every table row.
const resultFingerprints=new WeakMap<QualityPlanRouter,string>();
export function routerResultFingerprint(r:QualityPlanRouter):string{
 let value=resultFingerprints.get(r);if(!value){value=routerFingerprint(r);resultFingerprints.set(r,value);}return value;
}
export function validateQualityRouter(r: QualityPlanRouter) {
  const n = r.afterAdditions;
  if ((n !== 1 && n !== 2) || r.version !== routerVersionFor(n) || !Number.isFinite(r.threshold) || r.threshold < 0 || r.threshold > 1) throw Error('条件分支版本或门槛无效');
  if (!r.structure || !r.attack || r.structure.router || r.attack.router || r.structure.engine || r.attack.engine) throw Error('条件分支必须是两套独立的当前引擎方案');
  for(const p of [r.structure,r.attack])if(!p.addition?.rounds||p.addition.rounds.length<n||p.addition.rounds.slice(0,n).some(a=>a.source!=='structure'))throw Error(`条件分支的${routerPrefixText(r)}必须使用结构加仓`);
  const prefix = (p: QualityGroup) => canonicalRouterJson([p.rule,p.snapshot,p.combo,p.execution,p.vetoFill,p.holdingVetoes,p.mirrorTakeProfit,p.addition?.rounds?.slice(0,n),p.vetoStages?.filter(s=>s.afterAdditions<=n),p.vetoStageMode,p.vetoPeakBasis]);
  if (prefix(r.structure) !== prefix(r.attack)) throw Error(`两个分支的${routerPrefixText(r)}加仓、初始持仓与退出条件必须完全相同`);
}
/** The existing causal replay evaluates each branch; only a closed-bar observation selects it.
 * A matching executed prefix is required, so a discarded branch cannot change earlier trades.
 */
export async function evaluateQualityRouter(r: QualityPlanRouter, run: (plan: QualityGroup, previous?: QualityResult) => Promise<QualityResult>, keyOf: (p: QualityGroup) => string, previous?: QualityResult): Promise<QualityResult> {
  validateQualityRouter(r);
  const decided = previous?.routeDecision;
  if (decided?.at && previous?.status === 'open') {
    const branch=r[decided.branch];
    return {...await run(branch,{...previous,key:keyOf(branch)}),routeDecision:decided};
  }
  const structure = await run(r.structure, previous?.status==='open'?{...previous,key:keyOf(r.structure)}:undefined);
  if (structure.status==='error'||structure.status==='waiting') return structure;
  const decisive=structure.additionFills?.[r.afterAdditions-1];
  if (!decisive) return {...structure,routeDecision:{branch:'structure',threshold:r.threshold}};
  const o=decisive.conditions?.find(c=>c.metric==='state');
  if (!o || !Number.isFinite(o.reading) || o.at!==decisive.at || o.barOpenTime+300000>decisive.at) throw Error(`第${routerOrdinal(r)}次结构加仓缺少此前已收盘的状态 S，未选择分支`);
  const decision:QualityRouteDecision={branch:o.reading>r.threshold?'attack':'structure',at:decisive.at,reading:o.reading,threshold:r.threshold};
  if (decision.branch==='structure') return {...structure,routeDecision:decision};
  const attack=await run(r.attack);
  if (attack.status==='error'||attack.status==='waiting') return attack;
  if (canonicalRouterJson(attack.additionFills?.slice(0,r.afterAdditions))!==canonicalRouterJson(structure.additionFills?.slice(0,r.afterAdditions))) throw Error('进攻分支改变了选择前的成交，已停止计算');
  return {...attack,routeDecision:decision};
}
export function routedQualityPlan(plan: QualityGroup, result: Pick<QualityResult,'routeDecision'>): QualityGroup {
  return plan.router ? plan.router[result.routeDecision?.branch??'structure'] : plan;
}
