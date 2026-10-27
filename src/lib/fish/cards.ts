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
// 2026-10-27 最新截图：四条规则全部启用，交集；avg₂ 与 avg 是独立的卡片。
/** 历史五项配置：仅供旧卡迁移使用，不再用于捕捞或批量挖掘默认条件。 */
export const LEGACY_FISH_DEFAULT_RULES = [
  { id: 'first', featureId: 'cbi2', statistic: 'avg_CBI2', threshold: '0.04' },
  { id: 'default-state-avg2', featureId: 'state', statistic: 'avg_state', threshold: '0.6' },
  { id: 'default-cba', featureId: 'cba', statistic: 'avg_CBA', threshold: '8' },
  { id: 'default-drift-speed-z', featureId: 'drift-speed-z', statistic: 'avg_az', threshold: '0.15' },
  { id: 'default-bss', featureId: 'bss', statistic: 'avg_BSS', threshold: '0.12' },
] as const;
/** 换成 avg 之前五张默认卡的统计量（结果 = 公式最后一行 avg₂）。 */
const FISH_DEFAULT_AVG2_STATISTICS: Record<string, string> = { first: '结果', 'default-state-avg2': 'avg_state_2', 'default-cba': '结果', 'default-drift-speed-z': '结果', 'default-bss': '结果' };
/** 「结果」按特征值的显示倍率读数，公式变量（avg_…）读原值：从「结果」换过去时门槛要除以倍率，含义才不变。 */
const FISH_DEFAULT_RESULT_SCALE: Record<string, number> = { 'default-drift-speed-z': 100 };
const rescaleThreshold = (threshold: string, divisor: number) => { const n = Number(threshold); return divisor === 1 || !threshold.trim() || !Number.isFinite(n) ? threshold : String(+(n / divisor).toPrecision(12)); };
export const FISH_DEFAULT_ALGORITHMS:readonly string[]=FISH_DEFAULT_RULES.map(rule=>rule.featureId);
// v5：与挖掘共用明确命名的四项序列；首次替换旧设置，随后手动编辑照常保存。
export const fishDefaultsKey = () => `${getUserPrefix()}fish-default-preset.v5`;
export const fishCombinationKey = () => `${getUserPrefix()}fish-combination.v1`;
export const readFishCombination = (): 'and' | 'or' => readPersistedStateRaw(fishCombinationKey()) === 'or' ? 'or' : 'and';

/** Upgrade the old preset once; later user edits and saved combinations survive. */
function initializeFishDefaults(available: readonly string[]): void {
  if (readPersistedStateRaw(fishDefaultsKey()) === '1') return;
  // 保留升级前的捕捞设置备份，不触及公式定义、信号或研究结果。
  const backupKey = `${fishDefaultsKey()}.previous`;
  if (readPersistedStateRaw(backupKey) === null) writePersistedStateRaw(backupKey, JSON.stringify({
    cards: readPersistedStateRaw(fishCardsKey()), combination: readPersistedStateRaw(fishCombinationKey()),
  }));
  const cards: FishCard[] = FISH_DEFAULT_RULES.filter(rule=>available.includes(rule.featureId)).map(rule=>({
    id: rule.id, featureId: rule.featureId, enabled: true,
    pref: { ...cleanPreference(readFishPreference(rule.featureId)), statistic: rule.statistic,
      direction: '>', threshold: rule.threshold, lastSuggestion: undefined },
  }));
  writePersistedStateRaw(fishCardsKey(), JSON.stringify(cards));
  writePersistedStateRaw(fishCombinationKey(), 'and');
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
    // Update the saved preset once, so existing panels and automatic scans use 0.12 too.
    // Custom cards/settings and later manual edits remain user-owned.
    const bssDefaultKey = `${getUserPrefix()}fish-bss-default.v2`;
    if (readPersistedStateRaw(bssDefaultKey) !== '1') {
      const oldDefault = x.find(c => c?.id === 'default-bss' && c.featureId === 'bss'
        && c.pref?.statistic === '结果' && c.pref.direction === '>' && [0.8, 0.08].includes(Number(c.pref.threshold)));
      if (oldDefault) {
        oldDefault.pref = { ...oldDefault.pref, threshold: '0.12', lastSuggestion: undefined };
        writePersistedStateRaw(fishCardsKey(), JSON.stringify(x));
      }
      writePersistedStateRaw(bssDefaultKey, '1');
    }
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
    const stateDefaultKeyV2 = `${getUserPrefix()}fish-state-raw-default.v2`;
    if (readPersistedStateRaw(stateDefaultKeyV2) !== '1') {
      const oldDefault = x.find(c => c?.id === 'default-state-raw' && c.featureId === 'state'
        && c.pref?.statistic === 'state' && c.pref.direction === '>' && Number(c.pref.threshold) === 0.67);
      if (oldDefault) {
        oldDefault.pref = { ...oldDefault.pref, threshold: '0.7' };
        writePersistedStateRaw(fishCardsKey(), JSON.stringify(x));
      }
      writePersistedStateRaw(stateDefaultKeyV2, '1');
    }
    // 默认卡由 avg₂ 换成 avg（只换一次）：只改还停在旧默认统计量上的那几张，门槛、开关、方向与自加的卡都不动；之后手动改回 avg₂ 也不再覆盖。
    const avgDefaultKey = `${getUserPrefix()}fish-default-avg.v1`;
    if (readPersistedStateRaw(fishDefaultsKey()) !== '1' && readPersistedStateRaw(avgDefaultKey) !== '1') {
      let changed = false;
      for (const c of x) {
        const rule = LEGACY_FISH_DEFAULT_RULES.find(r => r.id === c?.id && r.featureId === c?.featureId);
        if (rule && c.pref?.statistic === FISH_DEFAULT_AVG2_STATISTICS[rule.id]) {
          const divisor = c.pref.statistic === '结果' ? FISH_DEFAULT_RESULT_SCALE[rule.id] ?? 1 : 1;
          c.pref = { ...c.pref, statistic: rule.statistic, threshold: rescaleThreshold(String(c.pref.threshold ?? ''), divisor), lastSuggestion: undefined }; changed = true;
        }
      }
      if (changed) writePersistedStateRaw(fishCardsKey(), JSON.stringify(x));
      writePersistedStateRaw(avgDefaultKey, '1');
    }
    return x.filter(c => c && typeof c.id === 'string' && typeof c.featureId === 'string' && typeof c.enabled === 'boolean' && c.pref && Array.isArray(c.pref.constraints) && c.featureId !== 'seller-push').slice(0, FISH_MAX_ALGORITHMS).map(c => {
      // A different formula requires a newly calibrated threshold. Never carry DSP·b's −15 into bc.
      if (c.featureId === 'drift-speed-down-z') return { ...c, featureId: 'seller-control', pref: { statistic: '结果', direction: '<', threshold: '', constraints: [], sellerSignVersion: 1 } };
      return { ...c, pref: withFishDefaultThreshold(c.featureId, { ...c.pref, constraints: [] }) };
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
