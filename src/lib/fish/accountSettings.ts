import type { FishCard } from '@/components/FishAlgorithmCard';
import type { FishScanSelection } from './scanPlan';
import type { FishDownwardWick } from './downwardWick';
import type { FishAutoMode } from './autoScan';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw } from '@/lib/persistedStateStorage';

// One atomic account value: an old page writing legacy local keys cannot erase it.
export const FISH_ACCOUNT_SETTINGS_KEY = 'fish-account-settings.v1';
export interface FishAccountSettings {
  version: 1;
  cards: FishCard[];
  combination: 'and' | 'or';
  lookbackHours: number;
  downwardWick: FishDownwardWick;
  selection: FishScanSelection;
  auto?: { mode: FishAutoMode; hours: number };
}
export function readFishAccountSettings(fullKey = getUserPrefix() + FISH_ACCOUNT_SETTINGS_KEY): FishAccountSettings | null {
  try {
    const value = JSON.parse(readPersistedStateRaw(fullKey) ?? 'null');
    if (value?.version !== 1 || !Array.isArray(value.cards) || !value.cards.length
      || !value.cards.every((card: FishCard) => typeof card?.id === 'string' && typeof card.featureId === 'string'
        && typeof card.enabled === 'boolean' && typeof card.pref?.threshold === 'string'
        && ['>', '<'].includes(card.pref.direction) && Array.isArray(card.pref.constraints))
      || !['and', 'or'].includes(value.combination)
      || !Number.isFinite(value.lookbackHours) || value.lookbackHours <= 0 || value.lookbackHours > 8784
      || typeof value.downwardWick?.enabled !== 'boolean' || ![6,12,24,48,72].includes(value.downwardWick.hours)
      || ![1,1.5,2,3].includes(value.downwardWick.atrMultiple)
      || !Array.isArray(value.selection?.exchanges) || typeof value.selection.includeDuplicates !== 'boolean'
      || (value.auto && (!['manual','auto'].includes(value.auto.mode) || ![0.5,1,2,4,8,16,32,64].includes(value.auto.hours)))) return null;
    return value;
  } catch { return null; }
}
