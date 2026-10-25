/**
 * 「鱼」只要没删就一直留着：多台设备 / 多个窗口之间按内容合并，删除靠「删除记号」传播。
 * 【用户要求】2026-10-20「渔部分的鱼只要没删除，就一直保留。我发现有的鱼突然就没了」。
 *
 * 根因：鱼列表以前整键同步、后推者胜——另一个浏览器（例如 Lovable 编辑器预览，它有自己的一份本地数据）
 * 里只有 30 条鱼，在那边捕一次就把 30 条推上云端，主站下次加载时整份覆盖本地的 162 条。
 * 现在：
 *   - 同步时两份鱼列表取并集（同一条鱼按 fishDedupKey 合并，本地的评分优先），谁也抹不掉谁；
 *   - 用户手动删除时记一笔「删除记号」（这条鱼的键 + 删除时刻），记号也跨设备合并；
 *   - 记号只压住删除时刻之前捕到的那条（caughtAt ≤ 删除时刻）；之后重新捕到同一条，照常留下。
 */
import type { TradeSignal } from '@/lib/signalLibrary';
import { collapseVisibleFish, fishDedupKey, fishVisibleKey, mergeFishSignals, migrateFishSignal, withoutArchivedFreshCopies } from './records';

/** 鱼的键 → 删除时刻（ms）。 */
export type FishTombstones = Record<string, number>;
/** 记号最多留这么多条（按删除时刻保留最新的），一条只有几十字节。 */
const LIMIT = 5000;

export function normalizeFishTombstones(raw: unknown): FishTombstones {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]) && e[1] > 0);
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, LIMIT));
}
/** 两份记号合并：同一条取更晚的删除时刻。 */
export function mergeFishTombstones(a: unknown, b: unknown): FishTombstones {
  const x = normalizeFishTombstones(a), y = normalizeFishTombstones(b), out: FishTombstones = { ...x };
  for (const [k, t] of Object.entries(y)) out[k] = Math.max(out[k] ?? 0, t);
  return normalizeFishTombstones(out);
}
/** 去掉被删除记号压住的鱼（删除时刻不早于这条鱼的捕获时刻）。没有捕获时刻的老记录视为很早以前捕到的。 */
export function applyFishTombstones(list: readonly TradeSignal[], tombstones: FishTombstones): TradeSignal[] {
  if (!Object.keys(tombstones).length) return [...list];
  // 也按「整行显示的内容」记（v| 开头）：删掉一条后，别处键不同、显示相同的旧副本也带不回来
  return list.filter(s => { const t = Math.max(tombstones[fishDedupKey(s)] ?? 0, tombstones[`v|${fishVisibleKey(s)}`] ?? 0); return !t || t < (s.caughtAt ?? 0); });
}
const asList = (v: unknown): TradeSignal[] => Array.isArray(v) ? v.filter((s): s is TradeSignal => !!s && typeof s.id === 'string' && typeof s.symbol === 'string' && Number.isFinite(s.timeMs) && typeof s.timeLabel === 'string' && typeof s.fallbackZone === 'string') : [];
/** 两份鱼列表取并集（本地在前：同一条鱼的评分以本地为准，读数取较新的那次捕获），再按删除记号去掉删过的。 */
export function mergeFishLists(local: unknown, remote: unknown, tombstones: FishTombstones = {}): TradeSignal[] {
  let l = asList(local).map(migrateFishSignal), r = asList(remote).map(migrateFishSignal);
  const retained = new Set(withoutArchivedFreshCopies([...l, ...r]));
  l = l.filter(s => retained.has(s)); r = r.filter(s => retained.has(s));
  const newer = new Map<string, TradeSignal>();
  for (const s of [...l, ...r]) { const k = fishDedupKey(s), prev = newer.get(k); if (!prev || (s.caughtAt ?? 0) > (prev.caughtAt ?? 0)) newer.set(k, s); }
  const merged = mergeFishSignals(l, r).map(s => {
    const best = newer.get(fishDedupKey(s));
    return best && best !== s ? { ...s, ...best, quality: s.quality ?? best.quality, freshCatch: s.freshCatch || best.freshCatch || undefined } : s;
  });
  return collapseVisibleFish(applyFishTombstones(merged, tombstones));
}
