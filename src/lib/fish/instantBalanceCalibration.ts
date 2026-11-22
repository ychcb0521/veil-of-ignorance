import { writeFishPreference } from './fishPreferencesDb';
import { sizeInstantEntry, type InstantPositionSettings } from './instantPositionSettings';
import { usdtLiveCampaignId, type UsdtLiveCampaign } from './usdtLiveCampaign';

export const INSTANT_SETTLED_BALANCE = 'instant-settled-balance-v1' as const;
export interface InstantBalanceCalibrationState {
  ready: boolean;
  refreshing: boolean;
  availableUsdt?: number;
  balanceObservedAt?: number;
  issue?: string;
}
const sessions = new Map<string, ReturnType<typeof createInstantBalanceCalibration>>();

/** A connection owns its balance cache; calibration never runs in the admission path. */
export function createInstantBalanceCalibration(owner: string, binding: string,
  read: (signal: AbortSignal) => Promise<string>, publish: (state: InstantBalanceCalibrationState) => void,
  persist = writeFishPreference) {
  const lifetime = new AbortController(), closed = new Set<string>();
  const key = `idb:instant-settled-balance-v1/${encodeURIComponent(owner)}/${encodeURIComponent(binding)}`;
  let state: InstantBalanceCalibrationState = { ready: false, refreshing: false };
  let revision = 0, covered = 0, busy: Promise<void> | undefined;
  let statusInitialized = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const emit = (next: InstantBalanceCalibrationState) => { state = next; if (!lifetime.signal.aborted) publish(state); };
  const pump = (): Promise<void> => {
    if (busy) return busy;
    if (lifetime.signal.aborted) return Promise.resolve();
    busy = (async () => {
      while (!lifetime.signal.aborted && covered < revision) {
        const request = revision;
        emit({ ...state, ready: false, refreshing: true, issue: undefined });
        try {
          const availableUsdt = Number(await read(lifetime.signal));
          if (lifetime.signal.aborted) return;
          if (!Number.isFinite(availableUsdt) || availableUsdt < 0) throw Error('币安可用金额无效');
          // A close during this request needs a subsequent read, not this in-flight response.
          if (request !== revision) continue;
          const balanceObservedAt = Date.now();
          await persist(key, { version: INSTANT_SETTLED_BALANCE, availableUsdt, balanceObservedAt });
          if (lifetime.signal.aborted) return;
          if (request !== revision) continue;
          covered = request;
          emit({ availableUsdt, balanceObservedAt, ready: availableUsdt > 0, refreshing: false,
            ...(availableUsdt === 0 ? { issue: '已校准可用金额为 0，暂不能新开仓' } : {}) });
        } catch (error) {
          if (lifetime.signal.aborted) return;
          emit({ ...state, ready: false, refreshing: false,
            issue: error instanceof Error ? error.message : '实盘金额校准失败，正在重试' });
          retry = setTimeout(() => { retry = undefined; void pump(); }, 5000);
          return;
        }
      }
    })().finally(() => {
      busy = undefined;
      if (!lifetime.signal.aborted && covered < revision && retry === undefined) void pump();
    });
    return busy;
  };
  const refresh = () => {
    clearTimeout(retry); retry = undefined;
    revision++;
    emit({ ...state, ready: false, refreshing: true, issue: undefined });
    return pump();
  };
  const session = {
    get state() { return state; },
    refresh,
    statuses(rows: readonly { id: string; state: string }[]) {
      let changed = false;
      for (const row of rows) {
        if (row.state !== 'closed') continue;
        const identity = 'follow:' + row.id;
        if (!closed.has(identity)) { closed.add(identity); changed = true; }
      }
      if (changed && statusInitialized) void refresh();
      statusInitialized = true;
    },
    campaigns(rows: readonly UsdtLiveCampaign[]) {
      let changed = false;
      for (const row of rows) {
        if (!Number.isSafeInteger(row.closedAt) || row.closedAt! < row.openedAt || row.quantity !== '0' || row.fills[0]?.action !== 'open') continue;
        const identity = usdtLiveCampaignId(row) + ':' + row.closedAt;
        const follow = 'follow:' + (row.followId ?? usdtLiveCampaignId(row));
        const known = closed.has(identity) || closed.has(follow);
        closed.add(identity); closed.add(follow);
        if (!known) changed = true;
      }
      if (changed) void refresh();
    },
    dispose() {
      lifetime.abort(); clearTimeout(retry);
      if (sessions.get(owner) === session) sessions.delete(owner);
    },
  };
  sessions.set(owner, session);
  return session;
}

/** New admissions synchronously freeze the latest completed calibration. Existing fills stay immutable. */
export function freezeCalibratedLivePositionBudget(owner: string, settings: InstantPositionSettings): InstantPositionSettings {
  if (settings.balanceObservedAt || settings.liveBalanceIssue) return settings;
  const session = sessions.get(owner);
  if (!session) return { ...settings, liveBalanceIssue: '币安金额尚未初始化' };
  const cached = session.state;
  if (!cached.ready || !cached.balanceObservedAt) throw Error(cached.issue ?? '实盘金额正在后台校准');
  const frozen = { ...settings, availableUsdt: cached.availableUsdt!, balanceObservedAt: cached.balanceObservedAt,
    balancePolicy: INSTANT_SETTLED_BALANCE };
  sizeInstantEntry(frozen);
  return frozen;
}
