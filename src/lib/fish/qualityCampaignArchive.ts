import {qualityMonitoringSample, qualityRowMonitorTimeBasis} from './qualityAdmissionTime';
import { qualityAdvantageIdentity } from './qualityAdvantage';
import {routerRuleLabel, routerResultFingerprint} from './qualityPlanRouter';
import {qualityVetoStagesLabel} from './qualityVetoStages';
import { isLegacyQualityPlan, LEGACY_QUALITY_ENGINE } from './qualityLegacyEngine';
import {qualityVetoStagesIdentity} from './qualityVetoStages';
import {qualitySellStagesIdentity,qualitySellStagesLabel} from './qualitySellStages';
import {qualityExitAlgorithmLabel} from './qualityStaticDrawdownSell';
import {holdingVetoLabel} from './qualityVeto';
import { additionIdentity, additionLabel, additionMirrorIdentity } from './qualityAddition';
import { mirrorIdentity, mirrorExecutionIdentity, mirrorLabel } from './qualityMirror';
import { hasQualityExit, qualityComparisonRows, qualityResultKey, qualityVetoVersion, type FishQualityStudy, type QualityGroup, type QualityResult, type QualitySample, qualityComboIdentity, qualityRuleText } from './quality';
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
export const qualitySellKey = (plan: QualityGroup) => JSON.stringify([...(qualityAdvantageIdentity(plan)?[qualityAdvantageIdentity(plan)]:[]),...(plan.router?[routerResultFingerprint(plan.router)]:[]),...(isLegacyQualityPlan(plan)?[LEGACY_QUALITY_ENGINE]:[]),...(plan.payoffRiskVersion ? [plan.payoffRiskVersion] : []),...(qualityVetoStagesIdentity(plan)?[qualityVetoStagesIdentity(plan)]:[]),...(qualitySellStagesIdentity(plan)?[qualitySellStagesIdentity(plan)]:[]),...(additionIdentity(plan.addition).length ? [additionIdentity(plan.addition)] : []),...additionMirrorIdentity(plan.addition,plan.mirrorTakeProfit),plan.id, plan.rule ?? null, plan.snapshot.definitionKey, plan.snapshot.interval, plan.snapshot.scale,...(plan.execution === 'intrabar-1m' ? ['intrabar-1m-v1'] : []),...(mirrorExecutionIdentity(plan).length ? [mirrorExecutionIdentity(plan)] : []),...(plan.combo ? [qualityComboIdentity(plan)] : []),...(mirrorIdentity(plan.mirrorTakeProfit).length ? [mirrorIdentity(plan.mirrorTakeProfit)] : []),...(holdingVetoIdentity(plan.holdingVetoes).length ? [[qualityVetoVersion(plan),holdingVetoIdentity(plan.holdingVetoes)]] : [])]);
export const qualityRuleLabel = (plan: QualityGroup) => plan.router?`${plan.label} · ${routerRuleLabel(plan.router)}`: `${qualityExitAlgorithmLabel(plan.rule,plan.label)} ${plan.combo ? qualityRuleText({...plan,sellStages:undefined}) : plan.rule ? qualityRuleText({...plan,sellStages:undefined}) : hasQualityExit(plan) ? plan.mirrorTakeProfit?.enabled ? '镜像止盈' : activeHoldingVetoes(plan.holdingVetoes).length ? '仅一票否决' : '持仓估值' : '待设卖出'}${activeHoldingVetoes(plan.holdingVetoes).length ? ` · 否决：${activeHoldingVetoes(plan.holdingVetoes).map(v=>holdingVetoLabel(v)).join(' 或 ')}` : ''}${mirrorLabel(plan.mirrorTakeProfit) ? ` · ${mirrorLabel(plan.mirrorTakeProfit)}` : ''}${additionLabel(plan.addition) ? ` · ${additionLabel(plan.addition)}` : ''}${plan.sellStages?.length?` · ${qualitySellStagesLabel(plan)}`:''}${plan.vetoStages?.length?` · 一票次数切换：${qualityVetoStagesLabel(plan)}`:''}`;
export const qualityFormulaVersion = (plan: QualityGroup) => shortFishHash(JSON.stringify([plan.snapshot.definitionKey, plan.snapshot.interval, plan.rule?.metric ?? plan.metric]));
export const qualityVersionedRuleLabel = (plan: QualityGroup) => `${qualityRuleLabel(plan)}${activeHoldingVetoes(plan.holdingVetoes).some(v => v.kind === 'static-drawdown' || v.kind === 'dynamic-drawdown') ? plan.vetoFill === 'stop' ? ' · 止损价成交' : ' · 否决次分钟开盘成交' : ''}${activeHoldingVetoes(plan.holdingVetoes).some(v => v.kind === 'drop-1m' || v.kind === 'drop-5m') ? ' · 短时跌幅收盘确认' : ''} · ${plan.execution === 'intrabar-1m' ? '盘中达标 · 1m复原' : '收盘确认'} · ${plan.definitionSource === 'account' ? '账号公式' : '历史公式'} ${qualityFormulaVersion(plan)}`;
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
function buildArchivedQualityRun(study: FishQualityStudy, result: QualityResult, legacy: boolean, findPrior: () => QualityCampaignRun | undefined): QualityCampaignRun | undefined {
  if (!hasQualityEntry(result)) return;
  let index = rowIndexes.get(study.samples);
  if (!index) { index = new Map(qualityComparisonRows(study).map(row => [row.id, row])); rowIndexes.set(study.samples, index); }
  const original = index.get(result.sampleId), sample = original && qualityMonitoringSample(original, qualityRowMonitorTimeBasis(study, original));
  const plan = (study.sellPlans ?? study.groups).find(group => group.id === result.groupId);
  // 未设置普通门槛、也没有启用否决的方案只是登记买入，不存成战役
  if (!sample || !plan || !hasQualityExit(plan) || !hasQualityCampaign(result) || qualityResultKey(sample, plan, study.observeHours) !== result.key) return;
  const prior = findPrior();
  const selected = new Set(study.selectedRowIds ?? []);
  const selectedDetectors = legacy ? sample.groups : sample.groups.filter(id => selected.has(sample.id) || selected.has(`${sample.id}/detector/${id}`));
  const ids = new Set([...(prior?.detectors.map(d => d.id) ?? []), ...selectedDetectors]);
  const detectors = study.groups.filter(group => ids.has(group.id));
  // Keep the trade's display identity. The source fish and its large reconstruction snapshots already live in samples/groups.
  const { id, symbol, timeMs, timeLabel, fallbackZone, quality, exchange, market, underlying, preEntryMonitor } = sample.source;
  const frozenSample = prior?.sample ?? { ...sample, groups: [...sample.groups], readings: undefined, source: { id, symbol, timeMs, timeLabel, fallbackZone, quality, exchange, market, underlying, preEntryMonitor } };
  return {
    ...prior,
    sample: frozenSample, plan: freezePlan(plan), detectors: detectors.map(freezePlan), result: structuredClone(result),
    observeHours: study.observeHours, firstEvaluatedAt: prior?.firstEvaluatedAt ?? result.evaluatedAt,
    detectionAt: prior?.detectionAt ?? (study.selectedSellId === plan.id && detectors.length ? result.evaluatedAt : undefined),
  };
}

export function archiveQualityResult(study: FishQualityStudy, result: QualityResult, legacy = false): FishQualityStudy {
  const run = buildArchivedQualityRun(study, result, legacy, () => study.campaignRuns?.find(item => item.result.key === result.key));
  return run ? { ...study, campaignRuns: [...(study.campaignRuns ?? []).filter(item => item.result.key !== result.key), run] } : study;
}

export const isRetainedQualityRun = (run: QualityCampaignRun) => !!run.repair || hasQualityExit(run.plan) && hasQualityCampaign(run.result);
/** Adopt pre-existing evaluated results without rerunning market data. */
export function archiveQualityStudy(study: FishQualityStudy): FishQualityStudy {
  // 清掉只登记买入的旧记录；仅启用否决也属于有效卖出试验
  const kept = study.campaignRuns?.filter(isRetainedQualityRun);
  const keys = new Set(kept?.map(run => run.result.key));
  const adopted = new Map<string, QualityCampaignRun>();
  for (const result of study.results) {
    if (keys.has(result.key)) continue;
    const run = buildArchivedQualityRun(study, result, true, () => adopted.get(result.key));
    if (!run) continue;
    adopted.delete(result.key);
    adopted.set(result.key, run);
  }
  if (!adopted.size && kept?.length === study.campaignRuns?.length) return study;
  return { ...study, campaignRuns: [...(kept ?? []), ...adopted.values()] };
}
export function markQualityDetection(study: FishQualityStudy, planId: string): FishQualityStudy {
  const next = archiveQualityStudy(study), plan = next.sellPlans?.find(p => p.id === planId && hasQualityExit(p));
  if (!plan) return study;
  return { ...next, selectedSellId: planId, campaignRuns: next.campaignRuns?.map(run =>
    run.detectors.length && qualitySellKey(run.plan) === qualitySellKey(plan) && run.observeHours === next.observeHours
      ? { ...run, detectionAt: run.detectionAt ?? Date.now() } : run) };
}
