/**
 * 「渔」的算法卡片：面板与定时自动捕捞共用同一份默认配置。
 */
import type { FishCard } from '@/components/FishAlgorithmCard';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { readFishPreference, withFishDefaultThreshold, type FishPreference } from './preferences';
import { FISH_MAX_ALGORITHMS } from './shared';

export const fishCardsKey = () => `${getUserPrefix()}fish-cards.v1`;
const cleanPreference = (p: FishPreference): FishPreference => ({ ...p, constraints: [] });
// 2026-10-24 用户截图：六条规则、全部启用、并集。结果读取账号公式最后一条 avg₂。
// 【用户要求】2026-10-25「渔的默认捕捞算法中，就按照这个设置」：按鱼舱重叠分析只留五类——
// CBI-2（概率）、avg_S（持续性确认）、CBA（定价保留）、az（推力）、BSS（1 小时短线）；
// CDA（CBA 的镜像）、卖控DSP.bc 与 DSP·a（推力类重复）、S 原值（被前几类分开覆盖）不再默认。
export const FISH_DEFAULT_RULES = [
  // 【用户要求】2026-10-25「最该看重的是 CBI-2、avg_S，因此应该排在前两个」
  // 【用户要求】2026-10-27「既然同一指标 avg 比 avg₂ 好，那么把捕捞这里的默认值均改成 avg」（监测库：CBI-2 / BSS 的 avg 去掉最高两笔后仍为正，avg₂ 为负）。
  // 卡片编号不变（default-state-avg2 只是历史编号），门槛沿用；az 的「结果」按 ×100 显示，avg_az 读原值，门槛 15 → 0.15（含义不变）。
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
// v3：换成五条规则时，已有账号也重新套一次默认组合（保留留下来的那几条上调过的阈值）。
export const fishDefaultsKey = () => `${getUserPrefix()}fish-default-preset.v3`;
export const fishCombinationKey = () => `${getUserPrefix()}fish-combination.v1`;
export const readFishCombination = (): 'and' | 'or' => readPersistedStateRaw(fishCombinationKey()) === 'or' ? 'or' : 'and';

/** Upgrade the old preset once; later user edits and saved combinations survive. */
function initializeFishDefaults(available: readonly string[]): void {
  if (readPersistedStateRaw(fishDefaultsKey()) === '1') return;
  // 上一版默认组合里同一条规则（同 id、同特征值、同序列）的设置沿用；只在上一版已初始化过时沿用，更早的旧卡一律换成默认值。
  const previous = readPersistedStateRaw(`${getUserPrefix()}fish-default-preset.v2`) === '1' ? readFishCards() : [];
  const cards: FishCard[] = FISH_DEFAULT_RULES.filter(rule=>available.includes(rule.featureId)).map(rule=>({
    id: rule.id, featureId: rule.featureId, enabled: true,
    pref: previous.find(card=>card.id===rule.id&&card.featureId===rule.featureId&&card.pref.statistic===rule.statistic)?.pref
      ?? { ...cleanPreference(readFishPreference(rule.featureId)), statistic: rule.statistic,
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
    const defaultIds = new Set<string>(FISH_DEFAULT_RULES.map(rule=>rule.id));
    const used = new Set<string>();
    const existingDefaults = new Set<string>();
    const defaults = FISH_DEFAULT_RULES.filter(rule=>available.includes(rule.featureId)).map(rule=>{
      const previous = saved.find(card=>card.id===rule.id&&card.featureId===rule.featureId)
        ?? saved.find(card=>card.featureId===rule.featureId&&card.pref.statistic===rule.statistic);
      if (previous) { used.add(previous.id); existingDefaults.add(rule.id); }
      return { id: rule.id, featureId: rule.featureId, enabled: true, pref: previous?.pref ?? {
        ...cleanPreference(readFishPreference(rule.featureId)), statistic: rule.statistic,
        direction: '>', threshold: rule.threshold, lastSuggestion: undefined,
      } };
    });
    // Keep added rules when reopening; the five presets still lead in their usual order.
    const extras = saved.filter(card=>!defaultIds.has(card.id)&&!used.has(card.id)&&available.includes(card.featureId));
    // Restoring a removed preset must not displace a configured rule at the 50-card limit.
    let freeSlots = FISH_MAX_ALGORITHMS - extras.length - existingDefaults.size;
    return [...defaults.filter(card=>existingDefaults.has(card.id)||freeSlots-- > 0), ...extras].slice(0, FISH_MAX_ALGORITHMS);
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
    if (readPersistedStateRaw(avgDefaultKey) !== '1') {
      let changed = false;
      for (const c of x) {
        const rule = FISH_DEFAULT_RULES.find(r => r.id === c?.id && r.featureId === c?.featureId);
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
  const saved = readFishCards();
  // An explicitly saved set containing only a retired seller-push must not start another algorithm.
  const raw = readPersistedStateRaw(fishCardsKey());
  try { if (!saved.length && JSON.parse(raw ?? '[]')?.some((c: FishCard) => c?.featureId === 'seller-push')) return []; } catch { /* use normal defaults for malformed storage */ }
  if (saved.length && readPersistedStateRaw(fishDefaultsKey()) === '1') return saved;
  return fishDefaultCards(FISH_DEFAULT_ALGORITHMS, available);
}
