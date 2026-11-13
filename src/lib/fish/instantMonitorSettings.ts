import { readPersistedStateRaw } from '@/lib/persistedStateStorage';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { hasQualityExit, type QualityGroup } from './quality';
import type { QualityPlanTemplate } from './qualityPlanTemplates';
import { planVersionChanges } from './qualityPlanVersions';

export const FISH_INSTANT_MONITOR_KEY = 'fish-instant-monitor-settings.v1';
export const INSTANT_TEMPLATE_MONITOR = 'instant-template-monitor-v1' as const;

export interface InstantMonitorSettings {
  version: typeof INSTANT_TEMPLATE_MONITOR;
  templateId: string;
  name: string;
  plan: QualityGroup;
}

export function instantMonitorTemplateIssue(template: QualityPlanTemplate & { plan: QualityGroup }) {
  if (template.entryHours != null || template.plan.preEntryThreeStage || template.plan.preEntryConditions || !hasQualityExit(template.plan)) return '请选择持仓监测模板';
  if (template.versionsBackfilledAt || !template.plan.frozenVersions?.length || planVersionChanges(template.plan).length) return '模板缺少可核验的原执行版本';
}

export function readInstantMonitorSettings(owner: string): InstantMonitorSettings | undefined {
  try {
    const value = JSON.parse(readPersistedStateRaw(getUserPrefix(owner) + FISH_INSTANT_MONITOR_KEY) ?? 'null');
    if (value?.version === INSTANT_TEMPLATE_MONITOR && typeof value.templateId === 'string'
      && typeof value.name === 'string' && Array.isArray(value.plan?.frozenVersions)) return value;
  } catch {
    return undefined;
  }
}
