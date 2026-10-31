/**
 * 「渔」的算法卡片：面板与定时自动捕捞共用同一份默认配置。
 */
import type { FishCard } from '@/components/FishAlgorithmCard';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { readFishPreference, withFishDefaultThreshold, type FishPreference } from './preferences';
import { FISH_MAX_ALGORITHMS } from './shared';
import { FISH_DEFAULT_RULES } from './defaultRules';
export { FISH_DEFAULT_RULES } from './defaultRules';

export const fishCardsKey = () => `${getUserPrefix()}fish-cards.v1`;
const cleanPreference = (p: FishPreference): FishPreference => ({ ...p, constraints: [] });
export const LEGACY_FISH_DEFAULT_RULES = [
  { id: 'first', featureId: 'cbi2', statistic: 'avg_CBI2', threshold: '0.04' },
  { id: 'default-state-avg2', featureId: 'state', statistic: 'avg_state', threshold: '0.6' },
  { id: 'default-cba', featureId: 'cba', statistic: 'avg_CBA', threshold: '8' },
  { id: 'default-drift-speed-z', featureId: 'drift-speed-z', statistic: 'avg_az', threshold: '0.15' },
  { id: 'default-bss', featureId: 'bss', statistic: 'avg_BSS', threshold: '0.12' },
] as const;
export const FISH_DEFAULT_ALGORITHMS:readonly string[]=FISH_DEFAULT_RULES.map(rule=>rule.featureId);
// v5：与挖掘共用明确命名的四项序列；仅初始化无已存卡片的账号；保存过的配置优先。
export const fishDefaultsKey = () => `${getUserPrefix()}fish-default-preset.v5`;
export const fishCombinationKey = () => `${getUserPrefix()}fish-combination.v1`;
export const readFishCombination = (): 'and' | 'or' => readPersistedStateRaw(fishCombinationKey()) === 'or' ? 'or' : 'and';

/** Initialize a new account only; never replace saved algorithms with a newer preset. */
function initializeFishDefaults(available: readonly string[]): void {
  try {
    if (Array.isArray(JSON.parse(readPersistedStateRaw(fishCardsKey()) ?? 'null'))) return;
  } catch { /* Malformed storage can fall back to the initial preset. */ }
  const cards: FishCard[] = FISH_DEFAULT_RULES.filter(rule=>available.includes(rule.featureId)).map(rule=>({
    id: rule.id, featureId: rule.featureId, enabled: true,
    pref: { ...cleanPreference(readFishPreference(rule.featureId)), statistic: rule.statistic,
      direction: '>', threshold: rule.threshold, lastSuggestion: undefined },
  }));
  writePersistedStateRaw(fishCardsKey(), JSON.stringify(cards));
  if (readPersistedStateRaw(fishCombinationKey()) === null) writePersistedStateRaw(fishCombinationKey(), 'and');
  writePersistedStateRaw(fishDefaultsKey(), '1');
}

export function fishDefaultCards(ids:readonly string[],available:readonly string[]):FishCard[]{
  if (ids.length === FISH_DEFAULT_ALGORITHMS.length && ids.every((id,i)=>id===FISH_DEFAULT_ALGORITHMS[i])) {
    initializeFishDefaults(available);
    return readFishCards().filter(card=>available.includes(card.featureId));
  }
  const saved=readFishCards();
  return ids.filter(id=>available.includes(id)).map((id,i)=>{const prev=saved.find(c=>c.featureId===id);return {id:i===0?'first':`default-${id}`,featureId:id,enabled:true,pref:prev?prev.pref:cleanPreference(readFishPreference(id))};});
}
export function readFishCards(): FishCard[] {
  try {
    const x = JSON.parse(readPersistedStateRaw(fishCardsKey()) ?? '[]');
    if (!Array.isArray(x)) return [];
    return x.filter(c => c && typeof c.id === 'string' && typeof c.featureId === 'string' && typeof c.enabled === 'boolean' && c.pref && Array.isArray(c.pref.constraints) && c.featureId !== 'seller-push').slice(0, FISH_MAX_ALGORITHMS).map(c => {
      // A different formula requires a newly calibrated threshold. Never carry DSP·b's −15 into bc.
      if (c.featureId === 'drift-speed-down-z') return { ...c, featureId: 'seller-control', pref: { statistic: '结果', direction: '<', threshold: '', constraints: [], sellerSignVersion: 1 } };
      return { ...c, pref: withFishDefaultThreshold(c.featureId, { ...c.pref, constraints: [] }, false) };
    });
  } catch { return []; }
}
/** 定时自动捕捞沿用编辑后的卡片；首次升级与打开面板使用相同默认值。 */
export function loadFishCardsForScan(available: readonly string[]): FishCard[] {
  // 先判断已退役的显式配置；不要因默认迁移而意外启动别的算法。
  const raw = readPersistedStateRaw(fishCardsKey());
  try {
    const previous = JSON.parse(raw ?? '[]');
    if (Array.isArray(previous) && previous.length && previous.every(c=>c?.featureId === 'seller-push')) return [];
  } catch { /* use normal defaults for malformed storage */ }
  return fishDefaultCards(FISH_DEFAULT_ALGORITHMS, available);
}
