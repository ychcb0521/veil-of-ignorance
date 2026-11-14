import type { QualityGroup, QualityResult, QualitySample } from './quality';
import { shortFishHash } from './algorithm';
import { qualityAdditionConditions, type QualityAdditionRule } from './qualityAddition';

export const QUALITY_ROUTER_VERSION = 'second-structural-addition-state-router-v1';
/**
 * 【用户要求】2026-11-05 版本 2：分流提前到第一次结构加仓成交时。1081 信号回放（510 场跑完）里 v1 只有 12 场走到第二次结构加仓、3 场进了进攻分支；
 * 直线拉升的币（45 场峰值 ≥ 15%，中位 72 分钟到 +15%）最多只形成一个箱体，第二次结构加仓等不到。旧版本号与已存方案照旧按第二次分流计算，结果逐位不变。
 */
export const QUALITY_ROUTER_FIRST_VERSION = 'first-structural-addition-state-router-v1';
/**
 * 【用户要求】2026-11-05 版本 3「进攻策略和保守策略灵活切换，每次加仓前的节点都是分流点」：afterAdditions＝0。
 * 不再一次选定分支：每一轮里结构分支（保守）与进攻分支这一次的加仓规则同时等候，先满足者成交，同一分钟先结构；
 * 两条分支除各轮加仓条件外必须完全相同，运行时合成一套方案（保守轮＝结构分支各轮，进攻备选＝进攻分支各轮，见 mergedRacePlan）。
 * threshold 在这里是进攻分支各次状态 S 门槛的下限（保存时校验），不是运行时的分流读数。
 */
export const QUALITY_ROUTER_RACE_VERSION = 'per-round-structure-attack-race-v1';
/**
 * 【用户要求】2026-11-06 版本 4「结构开局 · 进攻接力」：每轮分流加一道闸门 attackFromRound——进攻分支从第 n 次加仓起才参与竞速，前 n−1 次只走结构分支。
 * 依据同一批 89 个信号的两份回放（鱼质量-20261105225743 / 225757）：v3 里进攻先手成交的 7 场只有 1 场更好（JELLYJELLY 10-03 +7.5），
 * RAVE 被进攻抢在首个箱体之前加仓，首轮倍数 3.1× 取代箱体的 8.0×，全场 9,825 → 3,720；RED / PHA / DASH 本无加仓的小赢（+12 / +5 / +3）被进攻首加变成碰 K 归零。
 * 平衡公式 新增币数＝(Q×(K−S)+P)÷(T−K)：箱体 K 贴着 T（T−K≈0.1–0.3 ATR）倍数 8–26×，进攻 K＝T−1.5ATR 只有 1–3×，开局只能交给箱体。
 * attackFromRound 缺省 1（＝v3 原样，版本号不变）；大于 1 时用新版本号，旧 v3 方案逐位不变。
 */
export const QUALITY_ROUTER_RACE_FROM_VERSION = 'per-round-structure-attack-race-from-v1';
export type QualityRouterVersion = typeof QUALITY_ROUTER_VERSION | typeof QUALITY_ROUTER_FIRST_VERSION | typeof QUALITY_ROUTER_RACE_VERSION | typeof QUALITY_ROUTER_RACE_FROM_VERSION;
export interface QualityPlanRouter {
  version: QualityRouterVersion; afterAdditions: 0 | 1 | 2; threshold: number;
  /** 每轮分流：进攻分支从第几次加仓起参与竞速（1 或缺省＝每一次都参与）。一次选定的分流方式不用。 */
  attackFromRound?: number;
  structure: QualityGroup; attack: QualityGroup;
}
/** 进攻分支从第几次加仓起参与竞速（缺省 1）。 */
export const raceAttackFromRound = (r: Pick<QualityPlanRouter, 'attackFromRound'>) => r.attackFromRound ?? 1;
/** 分流方式对应的版本号（0＝每轮分流，1 / 2＝第 n 次结构加仓时一次选定）；版本号与次数必须成对，否则方案无效。每轮分流带闸门（进攻从第 2 次及之后起）用单独的版本号。 */
export const routerVersionFor = (afterAdditions: 0 | 1 | 2, attackFromRound = 1): QualityRouterVersion => afterAdditions === 0 ? (attackFromRound > 1 ? QUALITY_ROUTER_RACE_FROM_VERSION : QUALITY_ROUTER_RACE_VERSION) : afterAdditions === 1 ? QUALITY_ROUTER_FIRST_VERSION : QUALITY_ROUTER_VERSION;
export const isRaceRouter = (r: Pick<QualityPlanRouter, 'afterAdditions'>) => r.afterAdditions === 0;
/** 逐轮条件的字段（编辑器把第一轮同时写在加仓顶层）；每轮分流时这些字段两条分支各自独立，其余加仓设置必须相同。 */
export const RACE_ROUND_KEYS = ['source', 'structure', 'stricterPct', 'condition', 'conditions', 'prerequisites', 'indicatorIncrease', 'minGainPct', 'entryBufferAtr', 'supportOffsetAtr', 'entryDistanceAtr', 'gainBasis', 'entryVetoes', 'detectorPrerequisite', 'rounds', 'maxRounds', 'alternativeRounds', 'attackFromRound'] as const;
export function raceSharedAddition(a?: QualityAdditionRule): Partial<QualityAdditionRule> | undefined {
  if (!a) return a;
  const rest: Record<string, unknown> = { ...a };
  for (const k of RACE_ROUND_KEYS) delete rest[k];
  return rest as Partial<QualityAdditionRule>;
}
/** 每轮分流运行时的那一套方案：结构分支加上「进攻备选＝进攻分支各轮」。 */
export function mergedRacePlan(r: QualityPlanRouter): QualityGroup {
  const from = raceAttackFromRound(r);
  return { ...r.structure, addition: { ...r.structure.addition!, alternativeRounds: structuredClone(r.attack.addition!.rounds!), ...(from > 1 ? { attackFromRound: from } : {}) } };
}
/** 每轮分流的闸门文字：进攻从第 n 次加仓起参与（n＝1 时为空）。 */
export const raceFromText = (r: Pick<QualityPlanRouter, 'attackFromRound'>) => raceAttackFromRound(r) > 1 ? `前 ${raceAttackFromRound(r) - 1} 次只走结构分支，进攻分支从第 ${raceAttackFromRound(r)} 次加仓起参与竞速；` : '';
/** 版本清单 / 模板摘要 / 试验编号里的分流说明（旧两种分流方式的文字逐位不变）。 */
export const routerVersionSummary = (r: Pick<QualityPlanRouter, 'afterAdditions' | 'threshold' | 'attackFromRound'>) => isRaceRouter(r)
  ? `${raceFromText(r)}每一次加仓前都分流：结构分支与进攻分支这一次的加仓规则同时等候，先满足者成交（同一分钟先结构）；进攻分支各次状态 S 门槛不低于 ${r.threshold}`
  : `第${routerOrdinal(r)}次结构加仓时，已收盘状态 S > ${r.threshold} 切进攻，否则本场保持结构分支；只选择一次`;
export const routerTemplateSummary = (r: Pick<QualityPlanRouter, 'afterAdditions' | 'threshold' | 'attackFromRound'>) => isRaceRouter(r)
  ? `每轮分流${raceAttackFromRound(r) > 1 ? `（进攻从第 ${raceAttackFromRound(r)} 次起）` : ''} · 结构 / 进攻这一次的规则同时等候、先满足者成交 · 进攻 S ≥ ${r.threshold} · 版本冻结`
  : `${routerPrefixText(r)}结构加仓 · 第${routerOrdinal(r)}次已收盘 S > ${r.threshold} 后走进攻，否则保持结构 · 一次选择 · 版本冻结`;
export const routerRuleLabel = (r: Pick<QualityPlanRouter, 'afterAdditions' | 'threshold' | 'attackFromRound'>) => isRaceRouter(r)
  ? `每轮分流（进攻 S ≥ ${r.threshold}${raceAttackFromRound(r) > 1 ? `，第 ${raceAttackFromRound(r)} 次起` : ''}）`
  : `第${routerOrdinal(r)}次结构加仓 S > ${r.threshold} 切进攻，否则结构`;
/** 文案：分流发生在第「一 / 二」次结构加仓，之后从第「二 / 三」次起走分支，公共前缀是「第一次 / 前两次」加仓。 */
export const routerOrdinal = (r: Pick<QualityPlanRouter, 'afterAdditions'>) => r.afterAdditions === 1 ? '一' : '二';
export const routerNextOrdinal = (r: Pick<QualityPlanRouter, 'afterAdditions'>) => r.afterAdditions === 1 ? '二' : '三';
export const routerPrefixText = (r: Pick<QualityPlanRouter, 'afterAdditions'>) => r.afterAdditions === 1 ? '第一次' : '前两次';
export interface QualityRouteDecision { branch: 'structure' | 'attack' | 'race'; at?: number; reading?: number; threshold: number }
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
  const n = r.afterAdditions, from = raceAttackFromRound(r);
  if (canonicalRouterJson(r.structure?.advantage) !== canonicalRouterJson(r.attack?.advantage)) throw Error('两个分支的优势筛选与退出灵敏度设置须一致');
  if (n !== 0 && r.attackFromRound != null) throw Error('「进攻从第几次起」只用于每轮分流');
  if (!Number.isInteger(from) || from < 1 || from > 100) throw Error('进攻分支参与竞速的起始次数须为 1 至 100 的整数');
  if ((n !== 0 && n !== 1 && n !== 2) || r.version !== routerVersionFor(n, from) || !Number.isFinite(r.threshold) || r.threshold < 0 || r.threshold > 1) throw Error('条件分支版本或门槛无效');
  if (!r.structure || !r.attack || r.structure.router || r.attack.router || r.structure.engine || r.attack.engine) throw Error('条件分支必须是两套独立的当前引擎方案');
  if (n === 0) {
    for (const p of [r.structure, r.attack]) if (!p.addition?.enabled || p.addition.quantityMode !== 'calculator' || !p.addition.rounds?.length || p.addition.alternativeRounds?.length || p.addition.attackFromRound != null) throw Error('每轮分流的两条分支都须启用逐轮独立条件、按平衡公式定量的加仓');
    if (r.attack.addition!.rounds!.length > r.structure.addition!.rounds!.length) throw Error('进攻分支的加仓轮数不能多于结构分支');
    if (from > r.attack.addition!.rounds!.length) throw Error(`进攻分支只有 ${r.attack.addition!.rounds!.length} 次加仓，不能从第 ${from} 次起参与`);
    const shared = (p: QualityGroup) => canonicalRouterJson([p.rule,p.snapshot,p.combo,p.execution,p.vetoFill,p.holdingVetoes,p.payoffRiskVersion,p.mirrorTakeProfit,p.vetoStages,p.vetoStageMode,p.vetoPeakBasis,p.sellStages,raceSharedAddition(p.addition)]);
    if (shared(r.structure) !== shared(r.attack)) throw Error('每轮分流的两个分支除各轮加仓条件外，初始持仓、退出条件、加仓通用设置与加仓后切换必须完全相同');
    r.attack.addition!.rounds!.forEach((round, i) => { const t = round.source === 'custom' ? qualityAdditionConditions(round)[0] : undefined; if (t?.metric === 'state' && (t.direction !== '>' || t.threshold < r.threshold)) throw Error(`进攻分支第 ${i + 1} 次加仓的状态 S 门槛须不低于分支门槛 ${r.threshold}`); });
    return;
  }
  for(const p of [r.structure,r.attack])if(!p.addition?.rounds||p.addition.rounds.length<n||p.addition.rounds.slice(0,n).some(a=>a.source!=='structure'))throw Error(`条件分支的${routerPrefixText(r)}必须使用结构加仓`);
  const prefix = (p: QualityGroup) => canonicalRouterJson([p.rule,p.snapshot,p.combo,p.execution,p.vetoFill,p.holdingVetoes,p.payoffRiskVersion,p.mirrorTakeProfit,p.addition?.rounds?.slice(0,n),p.vetoStages?.filter(s=>s.afterAdditions<=n),p.vetoStageMode,p.vetoPeakBasis]);
  if (prefix(r.structure) !== prefix(r.attack)) throw Error(`两个分支的${routerPrefixText(r)}加仓、初始持仓与退出条件必须完全相同`);
}
/** The existing causal replay evaluates each branch; only a closed-bar observation selects it.
 * A matching executed prefix is required, so a discarded branch cannot change earlier trades.
 */
export async function evaluateQualityRouter(r: QualityPlanRouter, run: (plan: QualityGroup, previous?: QualityResult) => Promise<QualityResult>, keyOf: (p: QualityGroup) => string, previous?: QualityResult): Promise<QualityResult> {
  validateQualityRouter(r);
  if (isRaceRouter(r)) {
    // 每轮分流：一套合成方案跑完全程，各次成交记录 lane 写明走的是哪一边；没有一次性的分支选择
    const merged = mergedRacePlan(r);
    const result = await run(merged, previous?.status === 'open' ? { ...previous, key: keyOf(merged) } : undefined);
    return result.status === 'error' || result.status === 'waiting' ? result : { ...result, routeDecision: { branch: 'race', threshold: r.threshold } };
  }
  const decided = previous?.routeDecision;
  if (decided?.at && previous?.status === 'open' && decided.branch !== 'race') {
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
  if (!plan.router) return plan;
  const branch = isRaceRouter(plan.router) ? mergedRacePlan(plan.router) : plan.router[result.routeDecision?.branch === 'attack' ? 'attack' : 'structure'];
  return plan.positionManagement ? { ...branch, positionManagement: plan.positionManagement } : branch;
}
