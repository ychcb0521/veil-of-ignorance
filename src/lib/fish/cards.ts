/**
 * 「渔」的算法卡片：本机保存的卡片、默认四个算法。面板与定时自动捕捞共用（面板没打开时自动捕捞也要读到同一份）。
 */
import type { FishCard } from '@/components/FishAlgorithmCard';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw } from '@/lib/persistedStateStorage';
import { readFishPreference, withFishDefaultThreshold, type FishPreference } from './preferences';

export const fishCardsKey = () => `${getUserPrefix()}fish-cards.v1`;
const cleanPreference = (p: FishPreference): FishPreference => ({ ...p, constraints: [] });
/**
 * 默认的四个算法与顺序：CBI-2 → DSP·a → CBA → BSS。
 * 【用户要求】2026-10-20「我希望渔默认为这四个算法，每次点开始都默认为这四个算法和顺序」：
 * 每次打开「渔」都排成这四张卡、按这个顺序、全部勾选；各卡沿用这个算法上次的阈值 / 统计量 / 方向（没有就用默认门槛）。
 * 会话中临时增删、停用的卡，下次打开恢复成这四个。Deep dig 里删掉了的算法跳过。
 */
export const FISH_DEFAULT_ALGORITHMS:readonly string[]=['cbi2','drift-speed-z','cba','bss'];
export function fishDefaultCards(ids:readonly string[],available:readonly string[]):FishCard[]{
  const saved=readFishCards();
  return ids.filter(id=>available.includes(id)).map((id,i)=>{const prev=saved.find(c=>c.featureId===id);return {id:i===0?'first':`default-${id}`,featureId:id,enabled:true,pref:prev?prev.pref:cleanPreference(readFishPreference(id))};});
}
export function readFishCards(): FishCard[] {
  try {
    const x = JSON.parse(readPersistedStateRaw(fishCardsKey()) ?? '[]');
    if (!Array.isArray(x)) return [];
    return x.filter(c => c && typeof c.id === 'string' && typeof c.featureId === 'string' && typeof c.enabled === 'boolean' && c.pref && Array.isArray(c.pref.constraints) && c.featureId !== 'seller-push').slice(0, 6).map(c => {
      // A different formula requires a newly calibrated threshold. Never carry DSP·b's −15 into bc.
      if (c.featureId === 'drift-speed-down-z') return { ...c, featureId: 'seller-control', pref: { statistic: '结果', direction: '<', threshold: '', constraints: [], sellerSignVersion: 1 } };
      return { ...c, pref: withFishDefaultThreshold(c.featureId, { ...c.pref, constraints: [] }) };
    });
  } catch { return []; }
}
/** 定时自动捕捞要用的卡片：本机保存的那份；从没保存过就按默认四个算法。 */
export function loadFishCardsForScan(available: readonly string[]): FishCard[] {
  const saved = readFishCards();
  // An explicitly saved set containing only a retired seller-push must not start another algorithm.
  const raw = readPersistedStateRaw(fishCardsKey());
  if (saved.length) return saved;
  try { if (JSON.parse(raw ?? '[]')?.some((c: FishCard) => c?.featureId === 'seller-push')) return []; } catch { /* use normal defaults for malformed storage */ }
  return fishDefaultCards(FISH_DEFAULT_ALGORITHMS, available);
}
