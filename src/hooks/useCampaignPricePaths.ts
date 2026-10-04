import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CampaignCardData } from '@/lib/campaignListCache';
import { computeCampaignPriceChange, campaignPriceChangeLegInputs, computeHoldingDynamicMaxDrawdownPct, computePeakPriceChangePct, resolveHoldingDynamicDrawdownEndMs } from '@/lib/campaignMainPriceChange';
import { buildCampaignKlineTimeWindow } from '@/hooks/useCampaignKlines';
import { pickCampaignComputeInterval } from '@/lib/campaignChartContentSpan';
import { intervalToMs } from '@/hooks/useBinanceData';
import { fetchReplayKlineRange } from '@/hooks/useReplayKlines';

export const CAMPAIGN_PRICE_PATH_CACHE_PREFIX = 'campaign-price-path-v3:';
const PUBLISH_MS = 2_000;
const PUBLISH_BATCH = 12;
const MEMORY_CACHE_LIMIT = 1_024;
/** A terminal "unavailable" verdict is trusted for this long within the session; then it is rechecked once. */
const TERMINAL_MEMORY_TTL_MS = 10 * 60_000;

export type CampaignPricePathTask = {
  id: string;
  fingerprint: string;
  symbol: string;
  side: 'long' | 'short' | null;
  entryPrice: number | null;
  startMs: number;
  endMs: number;
  drawdownStartMs: number;
  drawdownEndMs: number;
  interval: string;
  barMs: number;
  historical: boolean;
  unavailableReason?: string;
};
type Result = { fingerprint: string; peak: number | null; drawdown: number | null; reason?: string; savedAt?: number };
type Snapshot = {
  owner: string; taskKey: string; results: ReadonlyMap<string, Result>; retrying: ReadonlySet<string>; retryAt: number | null;
  /** The queue is parked because the browser reports no connection. */
  offline: boolean;
};
const emptySnapshot = (owner: string, taskKey: string): Snapshot => ({ owner, taskKey, results: new Map(), retrying: new Set(), retryAt: null, offline: false });
// One latest successful result per owner/campaign; reads never extend its lifetime.
const memoryCache = new Map<string, Result>();
/**
 * Session-only verdicts for closed campaigns whose history turned out to be unavailable. Without it every
 * restart (opening the chart, returning from a detail page, changing the date range) would probe them again
 * and keep the page in a "refreshing" state although nothing can change. Never persisted: a reload or
 * "重试缺失项" asks the exchange again.
 */
const terminalMemory = new Map<string, { fingerprint: string; reason: string; savedAt: number }>();
const cacheKey = (owner: string, id: string) => JSON.stringify([owner, id]);

export function clearCampaignPricePathMemoryCacheForTests() {
  memoryCache.clear();
  terminalMemory.clear();
}

/** The key follows calculation inputs, including leg edits, rather than a campaign's rating/update timestamp. */
export function buildCampaignPricePathTask(row: CampaignCardData): CampaignPricePathTask {
  const { campaign, legs, tradeRecords } = row;
  const inputs = campaignPriceChangeLegInputs(campaign, legs, tradeRecords);
  const change = computeCampaignPriceChange(inputs);
  const startMs = Date.parse(campaign.opened_at);
  const endMs = change.mainCloseTime ?? (campaign.closed_at != null ? Date.parse(campaign.closed_at) : Math.floor(Date.now() / 60_000) * 60_000);
  const window = buildCampaignKlineTimeWindow(startMs, endMs, startMs, endMs);
  const interval = pickCampaignComputeInterval({ startMs: window.fromTime, endMs: window.toTime });
  const drawdownStartMs = change.entryOpenTime ?? startMs;
  const drawdownEndMs = resolveHoldingDynamicDrawdownEndMs(inputs, change.mainCloseTime, endMs);
  const historical = change.mainCloseTime != null || campaign.closed_at != null;
  const unavailableReason = change.entryPrice == null || !(change.entryPrice > 0) || change.side == null
    ? '缺少主力开仓价格或方向'
    : !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs
      ? '持仓时间不完整'
      : undefined;
  const params = { symbol: campaign.symbol, side: change.side, entryPrice: change.entryPrice, startMs, endMs, drawdownStartMs, drawdownEndMs, interval, barMs: intervalToMs(interval), historical, unavailableReason };
  return { id: campaign.id, fingerprint: JSON.stringify(params), ...params };
}

function isReusableResult(task: CampaignPricePathTask, result: Result | undefined | null): result is Result {
  return Boolean(result && result.fingerprint === task.fingerprint && !result.reason
    && Number.isFinite(result.peak) && Number.isFinite(result.drawdown)
    && (task.historical || (typeof result.savedAt === 'number' && Number.isFinite(result.savedAt) && Date.now() - result.savedAt <= 60_000)));
}

function rememberResult(owner: string, task: CampaignPricePathTask, result: Result) {
  const key = cacheKey(owner, task.id);
  memoryCache.delete(key);
  memoryCache.set(key, result);
  if (memoryCache.size > MEMORY_CACHE_LIMIT) memoryCache.delete(memoryCache.keys().next().value!);
  terminalMemory.delete(key);
}

function rememberTerminal(owner: string, task: CampaignPricePathTask, reason: string) {
  // An ongoing campaign's window keeps moving, so its verdict is never final.
  if (!task.historical) return;
  const key = cacheKey(owner, task.id);
  terminalMemory.delete(key);
  terminalMemory.set(key, { fingerprint: task.fingerprint, reason, savedAt: Date.now() });
  if (terminalMemory.size > MEMORY_CACHE_LIMIT) terminalMemory.delete(terminalMemory.keys().next().value!);
}

function readTerminal(owner: string, task: CampaignPricePathTask): Result | null {
  const entry = terminalMemory.get(cacheKey(owner, task.id));
  if (!entry || !task.historical || entry.fingerprint !== task.fingerprint) return null;
  if (Date.now() - entry.savedAt > TERMINAL_MEMORY_TTL_MS) return null;
  return { fingerprint: task.fingerprint, peak: null, drawdown: null, reason: entry.reason };
}

function readCache(owner: string, task: CampaignPricePathTask): Result | null {
  const key = cacheKey(owner, task.id);
  const remembered = memoryCache.get(key);
  if (isReusableResult(task, remembered)) {
    rememberResult(owner, task, remembered);
    return remembered;
  }
  try {
    const raw = localStorage.getItem(`${CAMPAIGN_PRICE_PATH_CACHE_PREFIX}${owner}:${task.id}`);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!isReusableResult(task, cached)) return null;
    const result: Result = { fingerprint: task.fingerprint, peak: cached.peak, drawdown: cached.drawdown, savedAt: cached.savedAt };
    rememberResult(owner, task, result);
    return result;
  } catch { return null; } // Storage permissions/quota must never interrupt the calculation queue.
}

function saveCache(owner: string, task: CampaignPricePathTask, result: Result) {
  if (!isReusableResult(task, result)) return;
  rememberResult(owner, task, result);
  try {
    localStorage.setItem(`${CAMPAIGN_PRICE_PATH_CACHE_PREFIX}${owner}:${task.id}`, JSON.stringify(result));
  } catch { /* Successful in-memory results are still usable when persistence is unavailable. */ }
}

function restoreResults(owner: string, tasks: readonly CampaignPricePathTask[], previous?: Snapshot) {
  const results = new Map<string, Result>();
  for (const task of tasks) {
    const before = previous?.owner === owner ? previous.results.get(task.id) : undefined;
    // A value this hook instance already shows stays as long as its inputs are unchanged; the 60 s lifetime of
    // an ongoing campaign only governs reuse across mounts (readCache). Closing and reopening the chart must
    // not drop and refetch it.
    const kept = before && before.fingerprint === task.fingerprint && !before.reason ? before : readCache(owner, task);
    if (kept) results.set(task.id, kept);
    else if (task.unavailableReason) results.set(task.id, { fingerprint: task.fingerprint, peak: null, drawdown: null, reason: task.unavailableReason });
    else {
      const terminal = readTerminal(owner, task);
      if (terminal) results.set(task.id, terminal);
    }
  }
  return results;
}

/** Retries temporary failures until completion; a single failed campaign never ends the remaining scan. */
export function useCampaignPricePathTasks(tasks: readonly CampaignPricePathTask[], owner: string, enabled: boolean) {
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  // Reordering, rating changes and stable refreshes must not restart an in-flight request.
  const taskKey = JSON.stringify(tasks.map(task => [task.id, task.fingerprint]).sort((a, b) => a[0].localeCompare(b[0])));
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    ...emptySnapshot(owner, taskKey), results: restoreResults(owner, tasks),
  }));
  const snapshotRef = useRef(snapshot);
  const [retryKey, setRetryKey] = useState(0);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  /** "重试缺失项": forget the unavailable verdicts of the current tasks, then run the queue again. */
  const retry = useCallback(() => {
    for (const task of tasksRef.current) terminalMemory.delete(cacheKey(ownerRef.current, task.id));
    setRetryKey(value => value + 1);
  }, []);
  // Rows may arrive after mount or return after filtering. Hydrate the new scope
  // during that render, while the existing effect still owns the calculation queue.
  const cachedSnapshot = useMemo<Snapshot>(() => ({
    ...emptySnapshot(owner, taskKey), results: restoreResults(owner, tasksRef.current, snapshotRef.current),
  }), [owner, taskKey]);
  const visibleSnapshot = snapshot.owner === owner && snapshot.taskKey === taskKey ? snapshot : cachedSnapshot;

  useEffect(() => {
    const requested = tasksRef.current;
    const results = restoreResults(owner, requested, snapshotRef.current);
    const controller = new AbortController();
    let cancelled = false;
    let dirty = 0;
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    let wakeTimer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    let cooldownUntil = 0;
    let offline = false;
    const pending = requested.filter(task => !results.has(task.id)).map(task => ({ task, attempts: 0, emptyResponses: 0, due: 0 }));
    const retrying = new Set<string>();
    const publish = (immediate = false) => {
      clearTimeout(publishTimer);
      publishTimer = undefined;
      if (cancelled) return;
      const next: Snapshot = { owner, taskKey, results: new Map(results), retrying: new Set(retrying), retryAt: cooldownUntil || null, offline };
      snapshotRef.current = next;
      if (immediate) setSnapshot(next);
      else startTransition(() => setSnapshot(next));
      dirty = 0;
    };
    const schedulePublish = () => {
      dirty += 1;
      if (dirty >= PUBLISH_BATCH) publish();
      else if (publishTimer == null) publishTimer = setTimeout(() => publish(), PUBLISH_MS);
    };
    const sleepUntilWork = (ms: number) => new Promise<void>(resolve => {
      wake = () => { clearTimeout(wakeTimer); wake = undefined; resolve(); };
      wakeTimer = setTimeout(() => wake?.(), Math.max(0, ms));
    });
    const onOnline = () => {
      pending.forEach(item => { item.due = 0; });
      wake?.(); // An actual server Retry-After remains in force.
    };
    publish(true);
    if (enabled) window.addEventListener('online', onOnline);

    const run = async () => {
      while (!cancelled && pending.length > 0) {
        const now = Date.now();
        if (navigator.onLine === false || cooldownUntil > now) {
          const parked = navigator.onLine === false;
          // Tell the page the queue cannot move while offline; publish only when the state flips, not every 30 s.
          if (parked !== offline) { offline = parked; publish(); }
          await sleepUntilWork(parked ? 30_000 : cooldownUntil - now);
          continue;
        }
        if (offline) { offline = false; publish(); }
        cooldownUntil = 0;
        const index = pending.findIndex(item => item.due <= now);
        if (index < 0) {
          await sleepUntilWork(Math.min(...pending.map(item => item.due)) - now);
          continue;
        }
        const [item] = pending.splice(index, 1);
        const { task } = item;
        try {
          const klines = await fetchReplayKlineRange(task.symbol, task.interval, task.startMs - task.barMs, task.endMs + task.barMs, controller.signal, { priority: 'background' });
          if (cancelled) return;
          const coversStart = klines.some(bar => bar.time <= task.startMs && bar.time + task.barMs > task.startMs);
          const coversEnd = klines.some(bar => bar.time <= task.endMs && bar.time + task.barMs >= task.endMs);
          const complete = !task.historical || (coversStart && coversEnd);
          const peak = complete ? computePeakPriceChangePct({ side: task.side, entryPrice: task.entryPrice, klines, startMs: task.startMs, endMs: task.endMs, barMs: task.barMs }) : null;
          const drawdown = complete ? computeHoldingDynamicMaxDrawdownPct({ klines, startMs: task.drawdownStartMs, endMs: task.drawdownEndMs, barMs: task.barMs }) : null;
          // An empty/incomplete historical response is checked again, never persisted as a successful value.
          if ((peak == null || drawdown == null) && ++item.emptyResponses < 3) throw new Error('历史 K 线暂不完整');
          const result: Result = { fingerprint: task.fingerprint, peak, drawdown, savedAt: Date.now(), ...(peak == null || drawdown == null ? { reason: '持仓期间缺少历史 K 线' } : {}) };
          results.set(task.id, result);
          retrying.delete(task.id);
          saveCache(owner, task, result);
          if (result.reason) rememberTerminal(owner, task, result.reason);
          schedulePublish();
        } catch (error) {
          if (cancelled || controller.signal.aborted) return;
          const failure = error as { status?: number; kind?: string; retryable?: boolean; retryAfterMs?: number; message?: string };
          const status = failure?.status ?? Number(failure?.message?.match(/^API (\d+)/)?.[1]);
          if (failure?.retryable === false || status === 400 || status === 404) {
            const reason = '历史行情不可用，请检查标的与持仓时间';
            results.set(task.id, { fingerprint: task.fingerprint, peak: null, drawdown: null, reason });
            retrying.delete(task.id);
            rememberTerminal(owner, task, reason);
          } else {
            item.attempts += 1;
            const limited = status === 418 || status === 429 || failure?.kind === 'rate-limit';
            const delay = limited
              ? Math.max(1_000, failure?.retryAfterMs ?? 120_000)
              : Math.max(failure?.retryAfterMs ?? 0, Math.min(60_000, 2_000 * 2 ** Math.min(item.attempts - 1, 5)));
            item.due = Date.now() + delay;
            pending.push(item);
            retrying.add(task.id);
            if (limited) cooldownUntil = item.due;
          }
          // Flush successes before a cooldown; never lose the tail of an unfinished batch.
          publish();
        }
        // Cached/mock responses may resolve synchronously; yield regularly for input and painting.
        if (dirty === 0 && pending.length > 0) await sleepUntilWork(0);
      }
      publish();
    };
    if (enabled) void run();
    return () => {
      // Preserve completed work atomically even when the view changes between scheduled publishes.
      snapshotRef.current = { owner, taskKey, results: new Map(results), retrying: new Set(retrying), retryAt: cooldownUntil || null, offline };
      cancelled = true;
      clearTimeout(publishTimer);
      wake?.();
      controller.abort();
      window.removeEventListener('online', onOnline);
    };
  }, [enabled, owner, taskKey, retryKey]);

  return useMemo(() => {
    const peaks = new Map<string, number | null>();
    const drawdowns = new Map<string, number | null>();
    const unavailable = new Map<string, string>();
    let retrying = 0;
    for (const task of tasks) {
      const result = visibleSnapshot.results.get(task.id);
      if (result?.fingerprint === task.fingerprint) {
        peaks.set(task.id, result.peak);
        drawdowns.set(task.id, result.drawdown);
        if (result.reason) unavailable.set(task.id, result.reason);
      } else if (visibleSnapshot.retrying.has(task.id)) retrying += 1;
    }
    const remaining = tasks.length - peaks.size;
    const offline = enabled && remaining > 0 && visibleSnapshot.offline;
    return {
      peaks, drawdowns, unavailable, retry, retrying,
      processed: peaks.size, total: tasks.length, loaded: peaks.size - unavailable.size,
      loading: enabled && peaks.size < tasks.length,
      retryAt: visibleSnapshot.retryAt,
      offline,
      /**
       * The queue cannot make progress right now: offline, in a rate-limit cooldown, or everything that is
       * left is waiting for an automatic retry. Results that already arrived are final for this round.
       */
      stalled: enabled && remaining > 0
        && (offline || visibleSnapshot.retryAt != null || (retrying > 0 && remaining <= retrying)),
    };
  }, [tasks, visibleSnapshot, enabled, retry]);
}

export function useCampaignPricePaths(rows: readonly CampaignCardData[], owner: string, enabled: boolean, rowsComplete = true) {
  const taskCache = useRef(new WeakMap<CampaignCardData, CampaignPricePathTask>());
  const tasks = useMemo(() => rowsComplete ? rows.map(row => {
    const cached = taskCache.current.get(row);
    if (cached?.historical) return cached;
    const task = buildCampaignPricePathTask(row);
    taskCache.current.set(row, task);
    return task;
  }) : [], [rows, rowsComplete]);
  return useCampaignPricePathTasks(tasks, owner, enabled);
}
