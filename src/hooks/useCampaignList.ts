import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { getCampaignListCache, type CampaignListLocalInputs } from '@/lib/campaignListCache';

/** 窗口焦点 / 可见 / 联网触发的远端核对最多每分钟一次：切个窗口回来不该重读整张表。 */
export const CAMPAIGN_LIST_FOCUS_REFRESH_MS = 60_000;
/** 本地成交 / 委托变化的合并窗口：静默 300 ms 后核对；时间机器连续改动时最迟 1.5 s 也核对一次。 */
export const CAMPAIGN_LIST_LOCAL_DEBOUNCE_MS = 300;
export const CAMPAIGN_LIST_LOCAL_MAX_WAIT_MS = 1_500;

const LOCAL_STORAGE_KEYS = ['trade_history', 'orders_map', 'cancelled_orders', 'filled_orders', 'positions_map'];
const REMOTE_STORAGE_KEYS = ['trade_campaigns', 'trade_campaign_preferences', 'trade_campaign_deviation_notes'];

/**
 * 稳定用户 id 而非 auth.user 对象：刷新 token 不重启加载。
 * inputs 是交易上下文里已经在内存中的那几份引用：核对直接用它们，不再解析本地存储里的几 MB 成交记录；
 * 它们的引用变了才触发本地核对，实时行情 priceMap 不参与。
 */
export function useCampaignList(userId: string | undefined, inputs: CampaignListLocalInputs) {
  const cache = useMemo(() => getCampaignListCache(userId ?? ''), [userId]);
  const snapshot = useSyncExternalStore(cache.subscribe, cache.getSnapshot);
  const { tradeHistory, ordersMap, filledOrders, positionsMap } = inputs;
  const previousInputs = useRef([cache, tradeHistory, ordersMap, filledOrders, positionsMap]);
  const firstPendingChangeAt = useRef<number | null>(null);

  useEffect(() => {
    if (!userId) return;
    // 进页面 / 详情返回：核对一次远端（详情页可能改了腿或评价；只读变了的行）；已有完整图时是后台静默核对。
    void cache.refresh('remote', { local: { tradeHistory, ordersMap, filledOrders, positionsMap } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let queued: 'remote' | 'local' | null = null;
    const flush = () => {
      const kind = queued;
      queued = null;
      if (kind) void cache.refresh(kind);
    };
    const schedule = (kind: 'remote' | 'local') => {
      queued = queued === 'remote' ? 'remote' : kind;
      clearTimeout(timer);
      timer = setTimeout(flush, 150);
    };
    // 焦点 / 可见 / 联网：远端可能被别处改过，但最多一分钟一次；不足一分钟只做本地核对（没有网络）。
    const onFocus = () => {
      void cache.refresh('remote', { maxAgeMs: CAMPAIGN_LIST_FOCUS_REFRESH_MS });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    // 别的标签页写了本地存储：战役 / 日记的键重读远端；成交 / 委托的键只做本地核对——
    // 本标签页的交易状态不跟别的标签页走（usePersistedState 不监听 storage），列表也只跟本标签页的内存数据，
    // 这次核对能看到的只有撤单快照（它不在内存里，仍从本地存储读）。
    const onStorage = (event: StorageEvent) => {
      if (event.key == null || event.key === 'journal_local_mirror_v1'
        || REMOTE_STORAGE_KEYS.some(key => event.key === `sim_${userId}_${key}`)) {
        schedule('remote');
      } else if (LOCAL_STORAGE_KEYS.some(key => event.key === `sim_${userId}_${key}`)) {
        schedule('local');
      }
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
      // 只退订 UI。取数/计算继续，详情返回时可直接接上已有结果。
    };
    // 挂载时带上当时的内存数据即可；之后的变化由下面的 effect 逐次交给缓存
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, userId]);

  useEffect(() => {
    // 成交/委托变化触发本地核对（沿用上次远端数据、不碰网络），实时行情 priceMap 不参与，避免每个 tick 重载。
    const next = [cache, tradeHistory, ordersMap, filledOrders, positionsMap];
    const changed = previousInputs.current[0] === cache
      && next.some((value, index) => value !== previousInputs.current[index]);
    previousInputs.current = next;
    if (!changed) return;
    const at = Date.now();
    if (firstPendingChangeAt.current === null) firstPendingChangeAt.current = at;
    // 时间机器跑起来时引用每根 K 线都在变：静默一会儿就核对，连着变也最迟 MAX_WAIT 核对一次。
    const wait = Math.max(0, Math.min(
      CAMPAIGN_LIST_LOCAL_DEBOUNCE_MS,
      firstPendingChangeAt.current + CAMPAIGN_LIST_LOCAL_MAX_WAIT_MS - at,
    ));
    const timer = setTimeout(() => {
      firstPendingChangeAt.current = null;
      void cache.refresh('local', { local: { tradeHistory, ordersMap, filledOrders, positionsMap } });
    }, wait);
    return () => clearTimeout(timer);
  }, [cache, tradeHistory, ordersMap, filledOrders, positionsMap]);

  const retry = useMemo(() => () => { void cache.refresh('remote'); }, [cache]);
  return { ...snapshot, setRows: cache.setRows, retry, beginMutation: cache.beginMutation };
}
