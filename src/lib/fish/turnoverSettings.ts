import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw } from '@/lib/persistedStateStorage';
import { FISH_TURNOVER_FLOORS, type FishTurnoverFloor } from './shared';

export const FISH_CAPTURE_TURNOVER_KEY = 'fish-capture-turnover.v1';
export interface FishTurnoverSettings {
  enabled: boolean;
  floors: FishTurnoverFloor[];
}

export function validateFishTurnoverSettings(value: FishTurnoverSettings): FishTurnoverSettings {
  if (typeof value?.enabled !== 'boolean' || !Array.isArray(value.floors)
      || value.floors.length !== FISH_TURNOVER_FLOORS.length
      || !FISH_TURNOVER_FLOORS.every((floor, index) => value.floors[index]?.hours === floor.hours)) {
    throw new Error('成交额门槛须包含 1、12、24 小时三项');
  }
  if (value.floors.some(floor => !Number.isFinite(floor.min) || floor.min <= 0)) throw new Error('成交额门槛须填写大于 0 的数字');
  return value;
}

export function readCaptureTurnoverSettings(prefix = getUserPrefix()): FishTurnoverSettings {
  try {
    const raw = readPersistedStateRaw(prefix + FISH_CAPTURE_TURNOVER_KEY);
    if (raw) return validateFishTurnoverSettings(JSON.parse(raw));
  } catch { /* Fall back to the established capture thresholds if stored data is invalid. */ }
  return { enabled: true, floors: FISH_TURNOVER_FLOORS.map(floor => ({ ...floor })) };
}
