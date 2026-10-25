/**
 * 「渔」的算法卡片：面板与定时自动捕捞共用同一份默认配置。
 */
import type { FishCard } from '@/components/FishAlgorithmCard';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { readFishPreference, withFishDefaultThreshold, type FishPreference } from './preferences';

export const fishCardsKey = () => `${getUserPrefix()}fish-cards.v1`;
const cleanPreference = (p: FishPreference): FishPreference => ({ ...p, constraints: [] });
// 2026-10-24 用户截图：六条规则、全部启用、并集。结果读取账号公式
// 最后一条 avg₂；两张 S 卡显式选择不同序列，不能按 featureId 合并。
export const FISH_DEFAULT_RULES = [
  { id: 'first', featureId: 'cbi2', statistic: '结果', threshold: '0.04' },
  { id: 'default-drift-speed-z', featureId: 'drift-speed-z', statistic: '结果', threshold: '15' },
  { id: 'default-cda', featureId: 'cda', statistic: '结果', threshold: '8' },
  { id: 'default-bss', featureId: 'bss', statistic: '结果', threshold: '0.8' },
  { id: 'default-state-raw', featureId: 'state', statistic: 'state', threshold: '0.67' },
  { id: 'default-state-avg2', featureId: 'state', statistic: 'avg_state_2', threshold: '0.6' },
] as const;
export const FISH_DEFAULT_ALGORITHMS:readonly string[]=FISH_DEFAULT_RULES.map(rule=>rule.featureId);
export const fishDefaultsKey = () => `${getUserPrefix()}fish-default-preset.v2`;
export const fishCombinationKey = () => `${getUserPrefix()}fish-combination.v1`;
export const readFishCombination = (): 'and' | 'or' => readPersistedStateRaw(fishCombinationKey()) === 'or' ? 'or' : 'and';

/** Upgrade the old preset once; later user edits and saved combinations survive. */
function initializeFishDefaults(available: readonly string[]): void {
  if (readPersistedStateRaw(fishDefaultsKey()) === '1') return;
  const cards: FishCard[] = FISH_DEFAULT_RULES.filter(rule=>available.includes(rule.featureId)).map(rule=>({
    id: rule.id, featureId: rule.featureId, enabled: true,
    pref: { ...cleanPreference(readFishPreference(rule.featureId)), statistic: rule.statistic,
      direction: '>', threshold: rule.threshold, lastSuggestion: undefined },
  }));
  writePersistedStateRaw(fishCardsKey(), JSON.stringify(cards));
  writePersistedStateRaw(fishCombinationKey(), 'or');
  writePersistedStateRaw(fishDefaultsKey(), '1');
}

export function fishDefaultCards(ids:readonly string[],available:readonly string[]):FishCard[]{
  if (ids.length === FISH_DEFAULT_ALGORITHMS.length && ids.every((id,i)=>id===FISH_DEFAULT_ALGORITHMS[i])) {
    initializeFishDefaults(available);
    const saved = readFishCards();
    return FISH_DEFAULT_RULES.filter(rule=>available.includes(rule.featureId)).map(rule=>{
      const previous = saved.find(card=>card.id===rule.id&&card.featureId===rule.featureId)
        ?? saved.find(card=>card.featureId===rule.featureId&&card.pref.statistic===rule.statistic);
      return { id: rule.id, featureId: rule.featureId, enabled: true, pref: previous?.pref ?? {
        ...cleanPreference(readFishPreference(rule.featureId)), statistic: rule.statistic,
        direction: '>', threshold: rule.threshold, lastSuggestion: undefined,
      } };
    });
  }
  const saved=readFishCards();
  return ids.filter(id=>available.includes(id)).map((id,i)=>{const prev=saved.find(c=>c.featureId===id);return {id:i===0?'first':`default-${id}`,featureId:id,enabled:true,pref:prev?prev.pref:cleanPreference(readFishPreference(id))};});
}
export function readFishCards(): FishCard[] {
  try {
    const x = JSON.parse(readPersistedStateRaw(fishCardsKey()) ?? '[]');
    if (!Array.isArray(x)) return [];
    // Only upgrade the old raw-S default once, for both the panel and automatic scans.
    // Preserve averages, custom cards, directions, and subsequent manual edits to 0.6.
    const stateDefaultKey = `${getUserPrefix()}fish-state-raw-default.v1`;
    if (readPersistedStateRaw(stateDefaultKey) !== '1') {
      const oldDefault = x.find(c => c?.id === 'default-state-raw' && c.featureId === 'state'
        && c.pref?.statistic === 'state' && c.pref.direction === '>' && Number(c.pref.threshold) === 0.6);
      if (oldDefault) {
        oldDefault.pref = { ...oldDefault.pref, threshold: '0.67' };
        writePersistedStateRaw(fishCardsKey(), JSON.stringify(x));
      }
      writePersistedStateRaw(stateDefaultKey, '1');
    }
    return x.filter(c => c && typeof c.id === 'string' && typeof c.featureId === 'string' && typeof c.enabled === 'boolean' && c.pref && Array.isArray(c.pref.constraints) && c.featureId !== 'seller-push').slice(0, 6).map(c => {
      // A different formula requires a newly calibrated threshold. Never carry DSP·b's −15 into bc.
      if (c.featureId === 'drift-speed-down-z') return { ...c, featureId: 'seller-control', pref: { statistic: '结果', direction: '<', threshold: '', constraints: [], sellerSignVersion: 1 } };
      return { ...c, pref: withFishDefaultThreshold(c.featureId, { ...c.pref, constraints: [] }) };
    });
  } catch { return []; }
}
/** 定时自动捕捞沿用编辑后的卡片；首次升级与打开面板使用相同默认值。 */
export function loadFishCardsForScan(available: readonly string[]): FishCard[] {
  const saved = readFishCards();
  // An explicitly saved set containing only a retired seller-push must not start another algorithm.
  const raw = readPersistedStateRaw(fishCardsKey());
  try { if (!saved.length && JSON.parse(raw ?? '[]')?.some((c: FishCard) => c?.featureId === 'seller-push')) return []; } catch { /* use normal defaults for malformed storage */ }
  if (saved.length && readPersistedStateRaw(fishDefaultsKey()) === '1') return saved;
  return fishDefaultCards(FISH_DEFAULT_ALGORITHMS, available);
}
