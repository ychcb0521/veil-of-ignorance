import { shortFishHash, type FishSnapshot } from './algorithm';
import type { QualityGroup, QualityBuyFilter } from './quality';
import { validateAdditionVetoes, type QualityAdditionEntryVeto } from './qualityAdditionVeto';
import { validateHoldingVeto, type QualityHoldingVeto, type QualityOperator } from './qualityVeto';
import { defaultBoxBreak, freezeBoxStop, type BoxStopRule } from './qualityBoxStop';
import { validateStructureAddition } from './qualityAdditionStructure';
import { qualityAdditionConditions, qualityAdditionPrerequisites, type QualityAdditionRoundRule } from './qualityAddition';
import { preEntryPositionOnly } from './preEntryConditions';

/**
 * 【用户要求】2026-11-08 三阶重排：必要条件提到最前（⓪），原生防守线新事件提前到 ①，加仓共用否决与卖出／硬终止合并为 ② 排除段。
 * 判定顺序变了，按 AGENTS.md 开新版本号；v5 的代码与输出不动，已存 v5 方案继续按 v5 跑。
 */
export const PRE_ENTRY_THREE_STAGE_V5 = 'pre-entry-three-stage-v5' as const;
export const PRE_ENTRY_THREE_STAGE_VERSION = 'pre-entry-three-stage-v6' as const;
export type PreEntryThreeStageVersion = typeof PRE_ENTRY_THREE_STAGE_V5 | typeof PRE_ENTRY_THREE_STAGE_VERSION;
export const PRE_ENTRY_GUARD_EVENT_VERSION = 'pre-entry-guard-event-v1' as const;
export interface EntryMarketCondition {
  id: string; label: string; metric: string; snapshot: FishSnapshot;
  enabled: boolean; direction: QualityOperator; threshold: number;
  timing: 'intrabar' | 'closed';
  originalDetector?: { constraints:string[] };
}
export type EntryMarketExpression = { condition: EntryMarketCondition } | { join: 'all' | 'any'; children: EntryMarketExpression[] };
export interface EntrySellRule {
  id: string; label: string; enabled: boolean; expression: EntryMarketExpression;
  confirmation: { samples: number; minutes: number };
  source?: { planId: string; label: string; versions: QualityGroup['frozenVersions'] };
}
export interface PreEntryThreeStage {
  version: PreEntryThreeStageVersion;
  observationBasis: 'scan-origin-v1';
  required: EntryMarketCondition[];
  detectors?: {id:string;featureId?:string;stricterPct:number;match:'all'|'any'}[];
  additionSource?: {planId:string;label:string;round:number;versions:QualityGroup['frozenVersions']};
  additionVetoes: QualityAdditionEntryVeto[];
  sellRules: EntrySellRule[];
  hardVetoes: QualityHoldingVeto[];
  guard: { version: typeof PRE_ENTRY_GUARD_EVENT_VERSION; rule: BoxStopRule };
}
export const entryCondition = (f: QualityBuyFilter, timing: EntryMarketCondition['timing'] = 'intrabar'): EntryMarketCondition => ({ ...structuredClone(f), timing });
/** 方案里的全部生效买前条件：主规则 + 启用的附加确认。 */
export function preEntryPlanFilters(plan: QualityGroup): QualityBuyFilter[] {
  if (!plan.rule || !Number.isFinite(plan.rule.threshold)) throw Error(`「${plan.label}」需要填写买入门槛`);
  return [{ id: 'primary', label: plan.label, metric: plan.rule.metric, snapshot: plan.snapshot, direction: plan.rule.direction, threshold: plan.rule.threshold, enabled: true }, ...(plan.buyFilters ?? []).filter(f => f.enabled)];
}
export const emptyPreEntryThreeStage = (): PreEntryThreeStage => ({
  version: PRE_ENTRY_THREE_STAGE_VERSION, observationBasis: 'scan-origin-v1', required: [], additionVetoes: [], sellRules: [], hardVetoes: [],
  guard: { version: PRE_ENTRY_GUARD_EVENT_VERSION, rule: defaultBoxBreak() },
});
export const expressionConditions = (e: EntryMarketExpression): EntryMarketCondition[] => 'condition' in e ? [e.condition] : e.children.flatMap(expressionConditions);
export function validateEntryCondition(c: EntryMarketCondition) {
  if (!c.id || !c.metric || !c.snapshot?.definitionKey || !c.label.trim() || !Number.isFinite(c.threshold) || !['<','>','<=','>='].includes(c.direction) || !['intrabar','closed'].includes(c.timing)) throw Error('市场条件须选择指标、方向、有限门槛及确认方式');
}
/** v5 或 v6 都是可运行版本；更早的扩展一律拒绝。 */
export function validatePreEntryThreeStage(c?: PreEntryThreeStage): asserts c is PreEntryThreeStage {
  if (!c || (c.version !== PRE_ENTRY_THREE_STAGE_VERSION && c.version !== PRE_ENTRY_THREE_STAGE_V5) || c.observationBasis !== 'scan-origin-v1' || c.guard?.version !== PRE_ENTRY_GUARD_EVENT_VERSION) throw Error('三阶筛选版本不可用，请保留原方案');
  const ids = new Set<string>();
  const unique = (id: string) => { if (!id || ids.has(id)) throw Error('三阶条件编号重复'); ids.add(id); };
  c.required.forEach(f => { unique(f.id); validateEntryCondition(f); });
  c.detectors?.forEach(d=>{unique(d.id);if(!Number.isFinite(d.stricterPct)||d.stricterPct<0||!['all','any'].includes(d.match))throw Error('原探测门槛提高幅度须为非负有限数');});
  validateAdditionVetoes(c.additionVetoes);
  const checkExpression = (e: EntryMarketExpression, depth=0) => {
    if (depth > 20) throw Error('卖出组合层级过深');
    if ('condition' in e) { unique(e.condition.id); validateEntryCondition(e.condition); return; }
    if (!['all','any'].includes(e.join) || !e.children.length) throw Error('卖出规则的且／或组合不能为空');
    e.children.forEach(child => checkExpression(child, depth+1));
  };
  c.sellRules.forEach(r => {
    unique(r.id);
    if (!r.enabled) return;
    if (!r.label.trim() || !Number.isInteger(r.confirmation.samples) || r.confirmation.samples < 1 || r.confirmation.samples > 100 || !Number.isInteger(r.confirmation.minutes) || r.confirmation.minutes < 1 || r.confirmation.minutes > 10080) throw Error('卖出确认须设置 1～100 次及有效的分钟周期');
    checkExpression(r.expression);
    if (!expressionConditions(r.expression).some(f=>f.enabled)) throw Error('完整卖出规则至少启用一项条件');
  });
  c.hardVetoes.forEach(v => { unique(v.id); if (v.enabled) { if(preEntryPositionOnly(v.kind)) throw Error('观察阶段没有实际仓位，不能启用盈亏比或几何仓位条件'); validateHoldingVeto(v); } });
  const g = c.guard.rule;
  if (g.version !== 'holding-support-break-v1' || g.confirmation !== 'guard-break' || g.update !== 'follow' || g.closes !== 1 || g.structure.algorithm !== 'dbl5' || g.structure.kSource !== 'guard' || g.structure.buffer !== 0 || g.structure.bufferUnit !== 'atr' || g.structure.guardTrendOnly) throw Error('三阶准入须读取完整原生 DBL-5 防守线更新（含实虚和下移）');
  validateStructureAddition(g.structure);
}
export function freezePreEntryThreeStage(c: PreEntryThreeStage): PreEntryThreeStage {
  validatePreEntryThreeStage(c);
  return { ...structuredClone(c), guard: {...c.guard, rule:freezeBoxStop(c.guard.rule)}, hardVetoes:c.hardVetoes.map(v=>v.boxStop?{...structuredClone(v),boxStop:freezeBoxStop(v.boxStop)}:structuredClone(v)) };
}
// New version only: JSONB object order cannot change the frozen identity. Array
// order, enabled flags, formulas, scopes and every actual parameter remain significant.
export function stableEntryJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])) : item);
}
export const threeStageFingerprint = (c: PreEntryThreeStage) => shortFishHash(stableEntryJson(freezePreEntryThreeStage(c)));

/** Explicit copy of one selected addition round. Never merge stages or invent a cost basis. */
export function copyAdditionMarketConditions(rule: QualityAdditionRoundRule) {
  if (rule.minGainPct != null || rule.entryBufferAtr != null || rule.entryDistanceAtr != null) throw Error('该轮包含实际成本线／仓位距离条件，不能原样复制到观察阶段；本次未复制');
  const conditions = rule.source === 'custom' ? qualityAdditionConditions(rule) : qualityAdditionPrerequisites(rule);
  const detectors:NonNullable<PreEntryThreeStage['detectors']>=[];
  if(rule.source==='detector')detectors.push({id:crypto.randomUUID(),stricterPct:rule.stricterPct,match:'any'});
  if(rule.source!=='custom'&&rule.detectorPrerequisite?.enabled)detectors.push({id:crypto.randomUUID(),stricterPct:rule.detectorPrerequisite.stricterPct,featureId:rule.detectorPrerequisite.featureId,match:'all'});
  return { required: conditions.map(f=>entryCondition({...f,id:crypto.randomUUID()},'closed')), additionVetoes:structuredClone(rule.entryVetoes ?? []),detectors };
}
/** Preserve the complete portable ordinary seller, reject stateful overlays as a whole. */
export function copyOrdinaryMarketSeller(p: QualityGroup): EntrySellRule {
  if (!p.rule || p.router || p.combo || p.advantage || p.engine || p.sellStages?.length) throw Error('该卖出方案包含持仓分段、动态确认或旧引擎依赖，不能完整转为观察条件；本次未复制');
  const condition: EntryMarketCondition = { id:crypto.randomUUID(), label:p.label, snapshot:structuredClone(p.snapshot), metric:p.rule.metric, direction:p.rule.direction, threshold:p.rule.threshold, enabled:true, timing:p.execution==='intrabar-1m'?'intrabar':'closed' };
  validateEntryCondition(condition);
  return { id:crypto.randomUUID(),label:p.label,enabled:true,expression:{condition},confirmation:{samples:1,minutes:1},source:{planId:p.id,label:p.label,versions:structuredClone(p.frozenVersions)} };
}
