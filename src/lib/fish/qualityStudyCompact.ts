/**
 * 鱼质量总表的存储压实：字段和格式完全不变（旧版页面照样能读），只去掉会无限累积的冗余。
 *
 * 【起因】2026-11-01 实测：3857 条运行记录各自整份复制了卖出方案（约 7 KB）和探测算法（约 5 KB），
 * 实际只有 40 种方案；1640 条监测设置里 1323 条已经没有任何记录在用。两项合计六成体积，且随每轮监测线性增长——
 * 不处理，几周后总表又会大到让页面内存耗尽（见 qualityArchiveStore 的事故说明）。
 *
 * 1. 内容相同的方案、算法换成同一个对象：IndexedDB 的结构化克隆对同一对象只存一份，读回来也只有一份。
 *    这依赖本模块与全站一致的约定——研究数据只做不可变更新，从不原地修改。
 * 2. 没有任何记录引用的监测设置不再保存：设置编号由内容决定（setting-<签名哈希>），以后用到时会原样重建。
 */
import { serializeAccountBlob } from '@/lib/accountBlobCodec';
import type { FishQualityStudy, QualityGroup } from './quality';
import type { QualityCampaignRun } from './qualityCampaignArchive';
import type { QualityMonitorSetting } from './qualityMonitorLibrary';

const memo = new WeakMap<object, object>();
const byContent = new Map<string, object>();
const CONTENT_LIMIT = 500;

/** 同内容的对象返回同一个实例（首次见到的那个）。 */
function canonical<T extends object>(value: T): T {
  const hit = memo.get(value);
  if (hit) return hit as T;
  let key: string;
  try { key = serializeAccountBlob(value); } catch { return value; }
  let found = byContent.get(key);
  if (found) { byContent.delete(key); byContent.set(key, found); }
  else {
    found = value; byContent.set(key, value);
    if (byContent.size > CONTENT_LIMIT) byContent.delete(byContent.keys().next().value!);
  }
  memo.set(value, found);
  return found as T;
}
function canonicalPlan(plan: QualityGroup | undefined): QualityGroup | undefined {
  return plan && typeof plan === 'object' ? canonical(plan) : plan;
}
function canonicalGroups(groups: QualityGroup[] | undefined): QualityGroup[] | undefined {
  if (!Array.isArray(groups) || !groups.length) return groups;
  const hit = memo.get(groups);
  if (hit) return hit as QualityGroup[];
  const items = groups.map(g => g && typeof g === 'object' ? canonical(g) : g);
  const result = canonical(items.every((g, i) => g === groups[i]) ? groups : items);
  memo.set(groups, result);
  return result;
}
function compactRun(run: QualityCampaignRun): QualityCampaignRun {
  if (!run || typeof run !== 'object') return run;
  const plan = canonicalPlan(run.plan)!, detectors = canonicalGroups(run.detectors)!;
  const prior = run.priorResults?.map(p => { const pp = canonicalPlan(p.plan)!; return pp === p.plan ? p : { ...p, plan: pp }; });
  const priorChanged = !!prior && prior.some((p, i) => p !== run.priorResults![i]);
  return plan === run.plan && detectors === run.detectors && !priorChanged ? run : { ...run, plan, detectors, ...(priorChanged ? { priorResults: prior } : {}) };
}
function compactSetting(setting: QualityMonitorSetting): QualityMonitorSetting {
  const plan = canonicalPlan(setting.plan)!, detectors = canonicalGroups(setting.detectors)!;
  return plan === setting.plan && detectors === setting.detectors ? setting : { ...setting, plan, detectors };
}
const sameItems = <T,>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** 运行记录（总表或归档快照里的）共享相同的方案和算法。 */
export function compactQualityRuns<T extends { campaignRuns?: QualityCampaignRun[] }>(study: T): T {
  const runs = study.campaignRuns;
  if (!runs?.length) return study;
  const next = runs.map(compactRun);
  return sameItems(next, runs) ? study : { ...study, campaignRuns: next };
}

/** 保存前调用：方案和算法去重，并丢掉没有记录引用的监测设置。 */
export function compactQualityStudyForStorage(study: FishQualityStudy): FishQualityStudy {
  let out = compactQualityRuns(study);
  const library = out.monitorLibrary;
  if (library?.settings?.length) {
    const used = new Set(library.records.map(r => r.settingId));
    const kept = library.settings.filter(s => used.has(s.id)).map(compactSetting);
    if (!sameItems(kept, library.settings)) out = { ...out, monitorLibrary: { ...library, settings: kept } };
  }
  return out;
}

export function __resetQualityStudyCompactForTests(): void { byContent.clear(); }
