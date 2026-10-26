/**
 * 从「鱼质量」点进交易战役后，返回时回到鱼质量原来的位置。
 * 【用户要求】2026-10-26「如果交易战役是从鱼质量那里点进去的，那么返回的时候，也要返回到鱼质量的对应的开始的位置」
 *
 * 点链接时记下鱼质量的界面状态（分页、筛选、排序、表格滚动）与外面各层的滚动位置，连同当时那条浏览记录的 key，
 * 存在本标签页（sessionStorage）。回到**同一条浏览记录**时（战役页左上角返回或浏览器后退）才恢复一次：
 * 交易页据此自动展开「渔」，鱼质量按记下的状态打开并滚回原处。从别处另开一次交易页（新的浏览记录）不受影响。
 */
export interface QualityReturnUi {
  open: boolean; query: string; month: string; algorithm: string; origin: '' | 'fish' | 'library';
  phase: 'sell' | 'detect'; showStats: boolean; closedOnly: boolean;
  sort: string; ascending: boolean; distributionMetric: string; statSort: { key: string; asc: boolean } | null;
  tableTop: number;
}
export interface QualityReturnSnapshot {
  at: number;
  /** 离开时那条浏览记录（react-router 写在 history.state 里的 key）。 */
  entry: string | null;
  ui: QualityReturnUi;
  /** 鱼质量外面各层祖先的 scrollTop，从直接父元素往上直到 <html>。 */
  scroll: number[];
}
export const QUALITY_RETURN_KEY = 'veil.fishQualityReturn.v1';
const MAX_AGE_MS = 6 * 3_600_000;
/** 交给战役详情页的导航状态：带着它的，返回按钮退回上一条浏览记录。 */
export const FROM_FISH_QUALITY = { fromFishQuality: true } as const;

export function currentHistoryEntry(): string | null {
  try {
    const state = window.history.state as { key?: unknown; idx?: unknown } | null;
    return typeof state?.key === 'string' ? state.key : typeof state?.idx === 'number' ? `idx:${state.idx}` : null;
  } catch { return null; }
}
/** 从某个元素往上，记下每一层祖先的 scrollTop。 */
export function ancestorScrolls(node: HTMLElement | null): number[] {
  const out: number[] = [];
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) out.push(el.scrollTop);
  return out;
}
export function applyAncestorScrolls(node: HTMLElement | null, scroll: readonly number[]): boolean {
  let i = 0, settled = true;
  for (let el = node?.parentElement ?? null; el && i < scroll.length; el = el.parentElement, i += 1) {
    if (Math.abs(el.scrollTop - scroll[i]) > 1) { el.scrollTop = scroll[i]; if (Math.abs(el.scrollTop - scroll[i]) > 1) settled = false; }
  }
  return settled;
}
export function saveQualityReturn(snapshot: Omit<QualityReturnSnapshot, 'at' | 'entry'>, now = Date.now()): void {
  try { sessionStorage.setItem(QUALITY_RETURN_KEY, JSON.stringify({ ...snapshot, at: now, entry: currentHistoryEntry() })); } catch { /* 记不住只是返回时回到交易页顶部 */ }
}
let pending: QualityReturnSnapshot | null = null;
/**
 * 交易页打开时调用：回到了离开时那条浏览记录、且记录不太旧，就取出（只用一次）并返回 true。
 * 可重复调用（StrictMode 下初始化函数会跑两次）。
 */
export function armQualityReturn(now = Date.now()): boolean {
  if (pending) return true;
  try {
    const raw = sessionStorage.getItem(QUALITY_RETURN_KEY);
    if (!raw) return false;
    const snap = JSON.parse(raw) as QualityReturnSnapshot;
    const entry = currentHistoryEntry();
    if (entry == null || snap.entry !== entry) return false;
    sessionStorage.removeItem(QUALITY_RETURN_KEY);
    if (!snap.ui || !Array.isArray(snap.scroll) || !(now - snap.at < MAX_AGE_MS)) return false;
    pending = snap;
    return true;
  } catch { return false; }
}
export const pendingQualityReturn = (): QualityReturnSnapshot | null => pending;
export function finishQualityReturn(): void { pending = null; }
