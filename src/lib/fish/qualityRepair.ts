/** Rebuild derived comparison trades only. Original versions stay in the same account's archive. */
import { BUILTIN_FEATURES, definitionKey, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { shortFishHash } from './algorithm';
import { hasQualityExit, evaluateQualitySample, qualityResultKey, type FishQualityStudy, type QualityGroup, type QualityResult } from './quality';
import { hasQualityCampaign, type QualityCampaignRun } from './qualityCampaignArchive';
import type { FishReconstructionLoader } from './reconstruction';

const REPAIR_VERSION = 2;
export interface QualityRepairBatch {
  id: string; startedAt: number; updatedAt: number; revision: number; targetVersion: string;
  state: 'running' | 'paused' | 'complete'; targetKeys: string[]; completedKeys: string[];
  changedKeys: string[]; failures: Record<string, string>;
}
export interface QualityRepairTask {
  key: string; originals: QualityCampaignRun[]; sample: QualityCampaignRun['sample']; plan: QualityGroup;
  observeHours: number; error?: string;
}
const finiteTime = (n?: number | null): n is number => Number.isFinite(n) && n! > 0;
function targetPlan(run: QualityCampaignRun, definitions: readonly DeepDigFeatureDef[]): QualityGroup {
  const id = run.plan.snapshot.featureId;
  const def = definitions.find(d => d.id === id) ?? BUILTIN_FEATURES.find(d => d.id === id);
  if (!def) throw new Error('当前账号已无此卖出指标的定义，不能猜测替代公式');
  // Preserve the experiment's own interval, selected raw variable, threshold and horizon.
  const interval = run.plan.snapshot.interval ?? '5m';
  if (!['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d'].includes(interval)) throw new Error('原战役的指标周期无效，不能改用其他周期代替');
  return { ...run.plan, definitionSource: 'account', execution:'intrabar-1m', snapshot: { ...run.plan.snapshot,
    definitionKey: definitionKey({ ...def, interval: interval as DeepDigFeatureDef['interval'] }), featureName: def.name, featureShort: def.short,
  } };
}
export function qualityRepairTasks(study: FishQualityStudy, definitions: readonly DeepDigFeatureDef[]): QualityRepairTask[] {
  const tasks = new Map<string, QualityRepairTask>();
  for (const run of study.campaignRuns ?? []) {
    if (run.supersededBy || !hasQualityExit(run.plan)) continue;
    let plan = run.plan, error: string | undefined;
    try { plan = targetPlan(run, definitions); } catch (e) { error = (e as Error).message; }
    const enteredAt = finiteTime(run.sample.enteredAt) ? run.sample.enteredAt : finiteTime(run.result.entryTime) ? run.result.entryTime : null;
    const sample = { ...run.sample, enteredAt };
    const key = qualityResultKey(sample, plan, run.observeHours);
    const prior = tasks.get(key);
    if (prior) prior.originals.push(run);
    else tasks.set(key, { key, originals: [run], sample, plan, observeHours: run.observeHours, error });
  }
  return [...tasks.values()];
}
export function prepareQualityRepair(study: FishQualityStudy, definitions: readonly DeepDigFeatureDef[], now: number) {
  const tasks = qualityRepairTasks(study, definitions);
  const targetVersion = shortFishHash(JSON.stringify([REPAIR_VERSION, tasks.map(t => [t.key, t.error ?? null]).sort((a,b) => String(a[0]).localeCompare(String(b[0])))]));
  const previous = study.campaignRepair;
  const resume = previous?.targetVersion === targetVersion && (previous.state !== 'complete' || Object.keys(previous.failures).length > 0);
  const completed = new Set(resume ? previous.completedKeys : []);
  const remaining = tasks.filter(t => !completed.has(t.key));
  const pendingKeys = new Set(remaining.flatMap(t => t.originals.map(r => r.result.key)));
  const batch: QualityRepairBatch = resume ? { ...previous, state: 'running', updatedAt: now, revision: previous.revision + 1, failures: {} }
    : { id: `repair-${now}-${shortFishHash(targetVersion)}`, startedAt: now, updatedAt: now, revision: 1, targetVersion,
      state: 'running', targetKeys: tasks.map(t => t.key), completedKeys: [], changedKeys: [], failures: {} };
  const next = { ...study, results: study.results.filter(r => !pendingKeys.has(r.key)), campaignRepair: batch, campaignRuns: study.campaignRuns?.map(run => pendingKeys.has(run.result.key)
    ? { ...run, repair: { ...run.repair, batchId: batch.id, status: 'pending' as const, error: undefined } } : run) };
  return { study: next, tasks: remaining, batch };
}
const outcomeFields = ['status','entryTime','entryPrice','endTime','endPrice','returnPct','pnl','peakPct','adversePct','drawdownPct','uncapturedPct','heldHours','exitReading','complete'] as const;
function outcomeChanged(a: QualityResult, b: QualityResult): boolean {
  return outcomeFields.some(field => {
    const x = a[field], y = b[field];
    return typeof x === 'number' && typeof y === 'number' ? Math.abs(x-y) > 1e-9 * Math.max(1,Math.abs(x),Math.abs(y)) : x !== y;
  });
}
function reliable(result: QualityResult): boolean {
  const close = (a: number,b: number) => Math.abs(a-b) <= 1e-8 * Math.max(1,Math.abs(a),Math.abs(b));
  return hasQualityCampaign(result) && ['entryPrice','endPrice','returnPct','pnl','peakPct','adversePct','drawdownPct','uncapturedPct','heldHours'].every(k => Number.isFinite(result[k as keyof QualityResult]))
    && result.endTime! >= result.entryTime! && close(result.returnPct!,(result.endPrice!/result.entryPrice!-1)*100)
    && close(result.pnl!,result.returnPct!) && close(result.heldHours!,(result.endTime!-result.entryTime!)/3600000)
    && close(result.uncapturedPct!,result.peakPct!-result.returnPct!);
}
export function applyQualityRepair(study: FishQualityStudy, batchId: string, task: QualityRepairTask, result: QualityResult, now: number): FishQualityStudy {
  const batch = study.campaignRepair;
  if (!batch || batch.id !== batchId || batch.completedKeys.includes(task.key)) return study;
  const runs = study.campaignRuns ?? [], sourceKeys = new Set(task.originals.map(r => r.result.key));
  const error = task.error ?? (result.key !== task.key || result.sampleId !== task.sample.id || result.groupId !== task.plan.id ? '重算结果与冻结的纠错方案不匹配' : !reliable(result) ? result.status === 'error' ? result.reason ?? '行情读取失败' : '缺少可靠成交数据或成交价与收益不一致' : undefined);
  const failures = { ...batch.failures }; delete failures[task.key];
  const nextBatch = { ...batch, updatedAt: now, revision: batch.revision + 1, failures };
  if (error) {
    failures[task.key] = error;
    return { ...study, campaignRepair: nextBatch, campaignRuns: runs.map(run => sourceKeys.has(run.result.key)
      ? { ...run, repair: { batchId, status: 'failed', checkedAt: now, error } } : run) };
  }
  const changed = task.originals.some(run => run.plan.execution !== task.plan.execution || run.plan.snapshot.definitionKey !== task.plan.snapshot.definitionKey || outcomeChanged(run.result,result));
  const first = task.originals.find(run => run.result.key === task.key) ?? task.originals[0];
  const existing = runs.find(run => run.result.key === task.key) ?? first;
  const previousDifferent = task.originals.find(run => outcomeChanged(run.result,result));
  const detectorMap = new Map(task.originals.flatMap(run => run.detectors).map(d => [d.id,d]));
  const detections = task.originals.flatMap(run => run.detectionAt ? [run.detectionAt] : []);
  const revisions = [...(existing.priorResults ?? [])];
  if (existing.result.key === task.key && outcomeChanged(existing.result,result)) revisions.push({at:now,plan:existing.plan,result:existing.result});
  const canonical: QualityCampaignRun = { ...existing, sample: task.sample, plan: task.plan, result,
    observeHours: task.observeHours, firstEvaluatedAt: Math.min(...task.originals.map(run => run.firstEvaluatedAt)),
    detectors: [...detectorMap.values()], detectionAt: detections.length ? Math.min(...detections) : undefined,
    supersededBy: undefined, priorResults: revisions.length ? revisions : undefined,
    repair: { ...existing.repair, batchId, status: 'verified', checkedAt: now, error: undefined,
      beforeReturnPct: previousDifferent?.result.returnPct ?? existing.repair?.beforeReturnPct,
      beforeEndTime: previousDifferent?.result.endTime ?? existing.repair?.beforeEndTime,
    },
  };
  const campaignRuns = runs.filter(run => run.result.key !== task.key).map(run => sourceKeys.has(run.result.key)
    ? { ...run, supersededBy: task.key, repair: { batchId, status: 'verified' as const, checkedAt: now } } : run);
  campaignRuns.push(canonical);
  nextBatch.completedKeys = [...batch.completedKeys,task.key];
  nextBatch.changedKeys = changed ? [...batch.changedKeys,task.key] : batch.changedKeys;
  // Only populate the matrix when this repaired threshold/horizon is also the current experiment.
  const active = study.sellPlans?.find(p => p.id === result.groupId);
  const matchesActive = active && qualityResultKey(task.sample,active,study.observeHours) === result.key;
  const results = study.results.filter(r => !sourceKeys.has(r.key) && (!matchesActive || r.key !== result.key));
  if (matchesActive) results.push(result);
  return { ...study, campaignRuns, results, campaignRepair: nextBatch };
}
export function finishQualityRepair(study: FishQualityStudy, batchId: string, paused: boolean, now: number): FishQualityStudy {
  if (study.campaignRepair?.id !== batchId) return study;
  return { ...study, campaignRepair: { ...study.campaignRepair, state: paused ? 'paused' : 'complete', updatedAt: now, revision: study.campaignRepair.revision + 1 } };
}
/**
 * 停止纠错（【用户要求】2026-10-26「停止纠错，把已经纠错过的保留，还未纠错的就不用纠错了，继续保持原样」）。
 * 已核验的战役保留新结果；还在「待纠错」或纠错没通过的，去掉纠错标记、原结果放回比较表，照旧显示；批次记为结束，不再续跑。
 * 已经停过（没有待处理的战役、批次已结束）就原样返回同一个对象。
 */
export function stopQualityRepair(study: FishQualityStudy, now: number): FishQualityStudy {
  const batch = study.campaignRepair, runs = study.campaignRuns ?? [];
  const untouched = runs.filter(run => run.repair && run.repair.status !== 'verified' && !run.supersededBy);
  if (!untouched.length && (!batch || batch.state === 'complete')) return study;
  const keys = new Set(untouched.map(run => run.result.key)), present = new Set(study.results.map(r => r.key));
  const campaignRuns = runs.map(run => { if (!keys.has(run.result.key) || run.supersededBy) return run; const { repair: _repair, ...rest } = run; return rest; });
  const restored = untouched.filter(run => !present.has(run.result.key)).map(run => run.result);
  return { ...study, campaignRuns, results: [...study.results, ...restored],
    campaignRepair: batch && { ...batch, state: 'complete', updatedAt: now, revision: batch.revision + 1, failures: {} } };
}
/** A stale tab saving its full study cannot resurrect superseded comparisons or erase the correction log. */
export function preserveQualityRepairs(saved: FishQualityStudy | undefined, incoming: FishQualityStudy): FishQualityStudy {
  const a = saved?.campaignRepair, b = incoming.campaignRepair;
  if (!a || b && (b.startedAt > a.startedAt || b.id === a.id && b.revision >= a.revision)) return incoming;
  const protectedRuns = (saved!.campaignRuns ?? []).filter(run => run.repair?.batchId === a.id || run.supersededBy);
  const keys = new Set(protectedRuns.map(run => run.result.key));
  const protectedResults = saved!.results.filter(r => keys.has(r.key));
  return { ...incoming, campaignRepair: a,
    campaignRuns: [...(incoming.campaignRuns ?? []).filter(run => !keys.has(run.result.key)),...protectedRuns],
    results: [...incoming.results.filter(r => !keys.has(r.key)),...protectedResults],
  };
}
export async function collectQualityRepair(options: { tasks: readonly QualityRepairTask[]; signal: AbortSignal; onResult: (task: QualityRepairTask, result: QualityResult) => Promise<void> }, load: FishReconstructionLoader, now: number) {
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      if (options.signal.aborted) throw new DOMException('已暂停','AbortError');
      const task = options.tasks[cursor++]; if (!task) return;
      const result = task.error ? { key:task.key,sampleId:task.sample.id,groupId:task.plan.id,evaluatedAt:now,status:'error' as const,reason:task.error }
        : await evaluateQualitySample(task.sample,task.plan,task.observeHours,now,load,options.signal);
      if (options.signal.aborted) throw new DOMException('已暂停','AbortError');
      await options.onResult(task,result);
    }
  };
  // Each evaluation scans chronologically; concurrency only spans independent trades.
  const results = await Promise.allSettled([worker(),worker()]);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
}
