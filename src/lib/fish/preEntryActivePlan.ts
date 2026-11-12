import type {QualityGroup} from './quality';
import type { PreEntrySettings } from './preEntryMonitor';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw } from '@/lib/persistedStateStorage';

export const FISH_AUTOMATIC_SCREENING_KEY = 'fish-automatic-screening.v1';

export function readAutomaticScreeningSettings(owner: string): PreEntrySettings | undefined {
  try {
    const saved = JSON.parse(readPersistedStateRaw(getUserPrefix(owner) + FISH_AUTOMATIC_SCREENING_KEY) ?? 'null');
    if (saved?.plans?.length === 1 && saved.plans[0]?.preEntryThreeStage &&
        Number.isFinite(saved.updatedAt) && Number.isFinite(saved.hours) && saved.hours > 0 && saved.hours <= 8784) return saved;
  } catch { /* A malformed local value cannot serve as a screening plan. */ }
}

/** 2026-11-08 用户已确认保存截图中选中的「三阶筛选 2」。只选择原对象，不改参数或版本。 */
export function selectedPreEntryPlan(plans:readonly QualityGroup[]=[]):QualityGroup|undefined{
  if(plans.length===1)return plans[0];
  const selected=plans.filter(p=>p.preEntryThreeStage&&p.label.trim()==='三阶筛选 2');
  return selected.length===1?selected[0]:undefined;
}

/** Applies to new runs only; old rounds and template snapshots keep their frozen duration. */
export const DEFAULT_PRE_ENTRY_HOURS=48;
export const newPreEntryHours=(saved?:number)=>saved!=null&&Number.isFinite(saved)&&saved>0&&saved<=8784?saved:DEFAULT_PRE_ENTRY_HOURS;
