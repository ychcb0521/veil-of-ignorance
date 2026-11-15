import type { FishQualityStudy, QualityGroup } from './quality';
import type { QualityFilterRoundSnapshot, QualityFilterSetting } from './qualityFilterLibrary';
import type { PreEntryRound } from './preEntryMonitor';
import { activeQualityPlanTemplates } from './qualityPlanTemplates';
import { fingerprintAccountBlob, serializeAccountBlob } from '../accountBlobCodec';

export interface QualityTemplateDirectoryGroup {
  id: string;
  title: string;
}

export const unknownTemplateGroup: QualityTemplateDirectoryGroup = {
  id: 'unknown',
  title: '历史记录 · 未记录模板',
};

function exact(value: unknown): string {
  return serializeAccountBlob(value === undefined ? null : ordered(value));
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
  }
  return value;
}

function planBody({ id: _id, label: _label, buyFilters, ...body }: QualityGroup) {
  // The monitor stores an explicit empty list after resolving the run's
  // filters. Compare that representation with a template with no plan filters.
  return exact(buyFilters?.length ? { ...body, buyFilters } : body);
}

/** Used only for display keys. Comparison with a saved template uses the full original data. */
function displayGroup(kind: string, key: string, title: string): QualityTemplateDirectoryGroup {
  return { id: kind + ':' + fingerprintAccountBlob(key), title };
}

export function createQualityTemplateDirectory(study: Pick<FishQualityStudy, 'planTemplates'>) {
  const plans = new WeakMap<QualityGroup, string>();
  const signature = (plan: QualityGroup) => {
    let key = plans.get(plan);
    if (key === undefined) {
      key = planBody(plan);
      plans.set(plan, key);
    }
    return key;
  };
  const templates = activeQualityPlanTemplates(study);
  const byPlan = new Map<string, typeof templates>();
  for (const template of templates) {
    const key = signature(template.plan);
    const bucket = byPlan.get(key);
    if (bucket) bucket.push(template);
    else byPlan.set(key, [template]);
  }
  const groupPlans = (batch: readonly QualityGroup[], screening?: PreEntryRound): QualityTemplateDirectoryGroup => {
    if (!batch.length) return unknownTemplateGroup;
    const groups = new Map<string, string>();
    for (const plan of batch) {
      const key = signature(plan);
      const exactMatches = (byPlan.get(key) ?? []).filter(template => !template.plan.staticFilter);
      const screeningMatches = exactMatches.filter(template => template.entryHours === undefined
        ? !!(template.plan.preEntryThreeStage || template.plan.preEntryConditions)
        : template.entryHours === screening?.hours);
      const matches = screening ? screeningMatches : exactMatches.filter(template =>
        !template.plan.preEntryThreeStage && !template.plan.preEntryConditions && template.entryHours === undefined);
      const match = matches.length === 1 ? matches[0] : undefined;
      groups.set(match ? 'tpl:' + match.id : key, match?.name ?? (plan.label || '历史方案'));
    }
    const title = [...groups.values()].join('、');
    return displayGroup(screening ? 'screen' : 'monitor', exact([...groups.keys()].sort()), title + (groups.size > 1 ? ' · 多方案' : ''));
  };
  const groupFilters = (settings: readonly QualityFilterSetting[], snapshot?: QualityFilterRoundSnapshot): QualityTemplateDirectoryGroup => {
    if (!settings.length) return unknownTemplateGroup;
    const conditions = settings.map(setting => setting.filters);
    const metrics = snapshot?.signalMetrics ?? [];
    const key = exact([conditions.map(exact).sort(), metrics]);
    if (snapshot && conditions.length === 1) {
      const match = templates.filter(template => template.plan.staticFilter &&
        exact(template.plan.staticFilter.filters.filter(filter => filter.enabled)) === exact(conditions[0]) &&
        exact(template.plan.staticFilter.metrics) === exact(metrics));
      if (match.length === 1) {
        return { id: 'filter:' + match[0].id, title: match[0].name };
      }
    }
    const labels = [...new Set(settings.flatMap(setting => setting.plans))];
    const names = [...new Set(conditions.flatMap(filters => filters.map(filter => filter.label + ' ' + filter.direction + ' ' + filter.threshold)))];
    const metricNames = [...new Set(metrics.map(metric => metric.label))];
    return displayGroup('filter', key, labels.join('、') || [...names, ...metricNames].slice(0,3).join('、') || '历史过滤条件');
  };
  return { groupPlans, groupFilters };
}
