import { qualityComparisonRows, qualityResultKey, type FishQualityStudy, type QualityGroup, type QualityResult, type QualitySample } from './quality';
import { activeHoldingVetoes, holdingVetoIdentity } from './qualityVeto';
import { shortFishHash } from './algorithm';

export interface QualityCampaignRun {
  sample: QualitySample;
  plan: QualityGroup;
  detectors: QualityGroup[];
  result: QualityResult;
  observeHours: number;
  firstEvaluatedAt: number;
  /** Set only when the user fixes this sell plan for detector comparisons. */
  detectionAt?: number;
  /** Replaced rows remain available as an audit trail; normal lists resolve to the replacement. */
  supersededBy?: string;
  repair?: { batchId: string; status: 'pending' | 'verified' | 'failed'; checkedAt?: number; error?: string; beforeReturnPct?: number; beforeEndTime?: number };
  priorResults?: { at: number; plan: QualityGroup; result: QualityResult }[];
}
export const isCurrentQualityRun = (run: QualityCampaignRun) => !run.supersededBy && (!run.repair || run.repair.status === 'verified');
export const qualitySellKey = (plan: QualityGroup) => JSON.stringify([plan.id, plan.rule ?? null, plan.snapshot.definitionKey, plan.snapshot.interval, plan.snapshot.scale,...(plan.execution === 'intrabar-1m' ? ['intrabar-1m-v1'] : []),...(holdingVetoIdentity(plan.holdingVetoes).length ? [['holding-veto-v2',holdingVetoIdentity(plan.holdingVetoes)]] : [])]);
export const qualityRuleLabel = (plan: QualityGroup) => `${plan.label} ${plan.rule ? `${plan.rule.direction} ${plan.rule.threshold}` : '待设门槛'}${activeHoldingVetoes(plan.holdingVetoes).length ? ` · 否决：${activeHoldingVetoes(plan.holdingVetoes).map(v=>`${v.label} ${v.direction} ${v.threshold}${v.kind==='indicator'?'':'%'}`).join(' 或 ')}` : ''}`;
export const qualityFormulaVersion = (plan: QualityGroup) => shortFishHash(JSON.stringify([plan.snapshot.definitionKey, plan.snapshot.interval, plan.rule?.metric ?? plan.metric]));
export const qualityVersionedRuleLabel = (plan: QualityGroup) => `${qualityRuleLabel(plan)} · ${plan.execution === 'intrabar-1m' ? '盘中达标 · 1m复原' : '收盘确认'} · ${plan.definitionSource === 'account' ? '账号公式' : '历史公式'} ${qualityFormulaVersion(plan)}`;
const rowIndexes = new WeakMap<QualitySample[], Map<string, QualitySample>>();
const frozenPlans = new WeakMap<QualityGroup, { key: string; plan: QualityGroup }>();
function freezePlan(plan: QualityGroup): QualityGroup {
  const key = qualitySellKey(plan), previous = frozenPlans.get(plan);
  if (previous?.key === key) return previous.plan;
  const copy = structuredClone(plan); frozenPlans.set(plan, { key, plan: copy }); return copy;
}
/** 能打开战役的交易：已卖出或持有中（只登记了买入、还没设门槛的不算）。 */
export const hasQualityCampaign = (result: QualityResult) => (result.status === 'closed' || result.status === 'open') && hasQualityEntry(result);
export const hasQualityEntry = (result: QualityResult) => ['closed', 'open', 'waiting'].includes(result.status)
  && Number.isFinite(result.entryTime) && result.entryTime! > 0 && Number.isFinite(result.entryPrice) && result.entryPrice! > 0
  && (result.status !== 'closed' || Number.isFinite(result.endTime) && result.endTime! >= result.entryTime! && Number.isFinite(result.endPrice) && result.endPrice! > 0 && Number.isFinite(result.pnl));

/** One archive per signal/sell-rule fingerprint. A later threshold cannot rewrite an earlier trial. */
export function archiveQualityResult(study: FishQualityStudy, result: QualityResult, legacy = false): FishQualityStudy {
  if (!hasQualityEntry(result)) return study;
  let index = rowIndexes.get(study.samples);
  if (!index) { index = new Map(qualityComparisonRows(study).map(row => [row.id, row])); rowIndexes.set(study.samples, index); }
  const sample = index.get(result.sampleId);
  const plan = (study.sellPlans ?? study.groups).find(group => group.id === result.groupId);
  // 没设门槛的卖出方案只是登记了买入，不是一场试验，不存成战役
  if (!sample || !plan?.rule || !hasQualityCampaign(result) || qualityResultKey(sample, plan, study.observeHours) !== result.key) return study;
  const prior = study.campaignRuns?.find(run => run.result.key === result.key);
  const selected = new Set(study.selectedRowIds ?? []);
  const selectedDetectors = legacy ? sample.groups : sample.groups.filter(id => selected.has(sample.id) || selected.has(`${sample.id}/detector/${id}`));
  const ids = new Set([...(prior?.detectors.map(d => d.id) ?? []), ...selectedDetectors]);
  const detectors = study.groups.filter(group => ids.has(group.id));
  // Keep the trade's display identity. The source fish and its large reconstruction snapshots already live in samples/groups.
  const { id, symbol, timeMs, timeLabel, fallbackZone, quality, exchange, market } = sample.source;
  const frozenSample = prior?.sample ?? { ...sample, groups: [...sample.groups], readings: undefined, source: { id, symbol, timeMs, timeLabel, fallbackZone, quality, exchange, market } };
  const run: QualityCampaignRun = {
    ...prior,
    sample: frozenSample, plan: freezePlan(plan), detectors: detectors.map(freezePlan), result: structuredClone(result),
    observeHours: study.observeHours, firstEvaluatedAt: prior?.firstEvaluatedAt ?? result.evaluatedAt,
    detectionAt: prior?.detectionAt ?? (study.selectedSellId === plan.id && detectors.length ? result.evaluatedAt : undefined),
  };
  return { ...study, campaignRuns: [...(study.campaignRuns ?? []).filter(item => item.result.key !== result.key), run] };
}
/** Adopt pre-existing evaluated results without rerunning market data. */
export function archiveQualityStudy(study: FishQualityStudy): FishQualityStudy {
  // 清掉早先存进来的「待设门槛」记录（没有卖出规则，只登记了买入）
  const kept = study.campaignRuns?.filter(run => run.repair || run.plan.rule && hasQualityCampaign(run.result));
  if (kept && kept.length !== study.campaignRuns!.length) study = { ...study, campaignRuns: kept };
  const keys = new Set(study.campaignRuns?.map(run => run.result.key));
  let next = study;
  for (const result of study.results) if (!keys.has(result.key)) next = archiveQualityResult(next, result, true);
  return next;
}
export function markQualityDetection(study: FishQualityStudy, planId: string): FishQualityStudy {
  const next = archiveQualityStudy(study), plan = next.sellPlans?.find(p => p.id === planId && p.rule);
  if (!plan) return study;
  return { ...next, selectedSellId: planId, campaignRuns: next.campaignRuns?.map(run =>
    run.detectors.length && qualitySellKey(run.plan) === qualitySellKey(plan) && run.observeHours === next.observeHours
      ? { ...run, detectionAt: run.detectionAt ?? Date.now() } : run) };
}
