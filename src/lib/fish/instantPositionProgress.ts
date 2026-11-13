import { readFishPreferences } from './fishPreferencesDb';
import type { QualityResult } from './quality';
import type { ScreenedCdaTrigger, ScreenedPriceProgress } from './screenedCda';

export const SCREENED_POSITION_KEY = 'veil.fish-cda-tracking.v1:';
export interface InstantPositionProgress {
  monitorResult?: QualityResult;
  alert?: ScreenedCdaTrigger;
  risk?: ScreenedPriceProgress;
}

export async function readInstantPositionProgress(owner: string, recordIds: readonly string[]) {
  const keys = recordIds.map(id => SCREENED_POSITION_KEY + encodeURIComponent(owner) + ':' + encodeURIComponent(id));
  const stored = await readFishPreferences<InstantPositionProgress>(keys);
  return stored.map((value, index) => {
    if (value) return value;
    try { return JSON.parse(localStorage.getItem(keys[index]) ?? 'null') as InstantPositionProgress | null; }
    catch { return null; }
  });
}
