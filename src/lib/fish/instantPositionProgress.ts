import { readFishPreferences } from './fishPreferencesDb';
import type { InstantManualExecution } from './instantManualExecution';
import type { QualityResult } from './quality';
import type { ScreenedCdaTrigger, ScreenedPriceProgress } from './screenedCda';

export const SCREENED_POSITION_KEY = 'veil.fish-cda-tracking.v1:';
export const instantManualCheckpointKey = (checkpointKey: string) => 'instant-manual-v1:' + checkpointKey;
export interface InstantPositionProgress {
  monitorResult?: QualityResult;
  alert?: ScreenedCdaTrigger;
  risk?: ScreenedPriceProgress;
  manual?: InstantManualExecution;
}

export async function readInstantPositionProgress(owner: string, recordIds: readonly string[]) {
  const keys = recordIds.map(id => SCREENED_POSITION_KEY + encodeURIComponent(owner) + ':' + encodeURIComponent(id));
  const stored = await readFishPreferences<InstantPositionProgress>([...keys, ...keys.map(instantManualCheckpointKey)]);
  return keys.map((key, index) => {
    const value = stored[keys.length + index] ?? stored[index];
    if (value) return value;
    try { return JSON.parse(localStorage.getItem(key) ?? 'null') as InstantPositionProgress | null; }
    catch { return null; }
  });
}
