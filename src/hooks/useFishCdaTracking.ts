import { watchInstantMinuteStreams } from '@/lib/fish/instantMinuteStream';
import { toast } from 'sonner';
import { instantMonitorSale, instantMonitorExitDue } from '@/lib/fish/instantMonitorExecution';
import type { QualityResult } from '@/lib/fish/quality';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FishSnapshot } from '@/lib/fish/algorithm';
import { fishEmailQuotaRetryAt, fishNotifyMissing } from '@/lib/fish/notify';
import { isAutomaticPreEntryRound, type PreEntryLibrary, type PreEntryRecord, type PreEntryRound } from '@/lib/fish/preEntryMonitor';
import { readAutomaticPreEntryCheckpoint, readAutomaticPreEntrySales } from '@/lib/fish/preEntryPersistence';
import { freezeScreenedCda, SCREENED_CDA_STEP, SCREENED_CDA_GUARD_RULE, SCREENED_PRICE_EXIT_RULE, validScreenedSale, type ScreenedPriceProgress, type ScreenedCdaGuardProgress, type ScreenedCdaTrigger } from '@/lib/fish/screenedCda';
import { readFishPreferences, readFishPreferenceEntries, updateFishPreference, writeFishPreference, writeFishPreferences } from '@/lib/fish/fishPreferencesDb';
import { markPageInstantPosition, readPageInstantCampaignCandles, readPageInstantMonitor, readPageScreenedCda } from './useFish';
import { screenedFishMailLock } from './useFishScreeningAutomation';
import { instantManualCheckpointKey, instantMonitorCheckpointKey, SCREENED_POSITION_KEY } from '@/lib/fish/instantPositionProgress';
import { instantCampaignInput, instantPositionDisplay, instantPositionInput, instantPositionValuation, type InstantPositionFill, type InstantPositionInput } from '@/lib/fish/instantCampaign';
import { instantMonitorSample, instantMonitorSize } from '@/lib/fish/instantMonitorExecution';
import type { InstantMonitorSettings } from '@/lib/fish/instantMonitorSettings';
import { rebaseInstantMonitor } from '@/lib/fish/instantMonitorSwitch';
import { isLegacyQualityPlan } from '@/lib/fish/qualityLegacyEngine';
import { publishInstantCampaigns, saveInstantCampaignInput } from '@/lib/fish/instantCampaignStore';
import { qualityAdditionFills } from '@/lib/fish/qualityAddition';
import { INSTANT_MANUAL_EXECUTION, INSTANT_MANUAL_MINUTE, applyInstantManualFill, cancelInstantProtection, instantManualTrigger, validateInstantManualLevels, type InstantManualAction, type InstantManualExecution } from '@/lib/fish/instantManualExecution';
import { readInstantPositionQuote } from '@/lib/fish/instantPositionQuote';
import { validateFishBars } from '@/lib/fish/shared';
import { formatPrice, formatSignedUSDT } from '@/lib/formatters';
import { cardCloseLotSize } from '@/lib/marketLotSize';
import { normalizePositionLimitMode } from '@/lib/positionLimitMode';
import { readPersistedStateRaw } from '@/lib/persistedStateStorage';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import type { useFishNotify } from './useFishNotify';

const POLL_MS = 2000;
const CLOSE_GRACE_MS = 1000;
type Settings = { enabledAt: number; snapshot: FishSnapshot };
export interface ScreenedFishAdmission { record: PreEntryRecord; round: PreEntryRound }
interface Checkpoint {
  after: number;
  monitorResult?: QualityResult;
  alert?: ScreenedCdaTrigger;
  progress?: ScreenedCdaGuardProgress;
  risk?: ScreenedPriceProgress;
  manual?: InstantManualExecution;
  sent?: string[];
  delivered?: true;
  nextMailAt?: number;
  failures?: number;
}
function awaitingSimulatedExit(checkpoint?: Checkpoint) {
  const result = checkpoint?.monitorResult;
  return result?.status === 'open' && !!checkpoint?.alert && result.pendingExit?.at === checkpoint.alert.at
    && instantMonitorExitDue(result);
}

export interface FishCdaTracking {
  enabled: boolean;
  active: number;
  awaitingMail: number;
  alerts: ReadonlyMap<string, ScreenedCdaTrigger>;
  admitted?: readonly ScreenedFishAdmission[];
  localSales?: readonly ScreenedFishAdmission[];
  hasPendingSaleMail?: boolean;
  campaignIssue?: string;
  managePosition?: (input: InstantPositionFill, action: InstantManualAction) => Promise<void>;
  manualPositions?: ReadonlyMap<string, InstantManualExecution>;
  mirrorFills?: ReadonlyMap<string, NonNullable<ScreenedPriceProgress['mirror']>>;
  monitorResults?: ReadonlyMap<string, QualityResult>;
  switchMonitor?: (recordId: string, monitor: InstantMonitorSettings, revision: number) => Promise<void>;
  error: string;
  saving: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
}

function readLocal<T>(key: string): T | undefined {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? undefined; }
  catch { return undefined; }
}

function initialCursor(record: PreEntryRecord, enabledAt: number) {
  const start = Math.max(record.matchedAt!, enabledAt);
  return Math.ceil(start / SCREENED_CDA_STEP) * SCREENED_CDA_STEP - SCREENED_CDA_STEP;
}

/** Opt-in watches are owned by the authenticated app, regardless of the open panel. */
export function useFishCdaTracking(owner: string | undefined, library: PreEntryLibrary | undefined, ready: boolean,
  notify: ReturnType<typeof useFishNotify>, autoPositions = false): FishCdaTracking {
  const configKey = owner ? SCREENED_POSITION_KEY + encodeURIComponent(owner) : '';
  const jobPrefix = configKey + ':';
  const [settings, setSettings] = useState<Settings>();
  const activeSettings = useMemo(() => {
    if (!autoPositions || settings) return settings;
    try { return { enabledAt: 0, snapshot: freezeScreenedCda() }; }
    catch { return undefined; }
  }, [autoPositions, settings]);
  const [saving, setSaving] = useState(!!configKey);
  const [error, setError] = useState('');
  const [savedSales, setSavedSales] = useState<{ owner: string; admitted: ScreenedFishAdmission[]; pendingMail: boolean }>();
  const [revision, setRevision] = useState(0);
  const [refreshVersion, refreshCheckpoints] = useState(0);
  const checkpoints = useRef(new Map<string, Checkpoint>());
  const readCheckpoints = useCallback(async (keys: string[]) => {
    const rows = await readFishPreferences<Checkpoint>([...keys, ...keys.map(instantManualCheckpointKey), ...keys.map(instantMonitorCheckpointKey)]);
    return keys.map((key, index) => rows[2 * keys.length + index] ?? rows[keys.length + index] ?? rows[index] ?? readLocal<Checkpoint>(key));
  }, []);
  const changes = useRef<BroadcastChannel>();
  const setEnabled = useCallback(async (enabled: boolean) => {
    if (!configKey) return;
    setSaving(true);
    try {
      const next = enabled ? { enabledAt: Date.now(), snapshot: freezeScreenedCda() } : undefined;
      await writeFishPreference(configKey, next ?? null);
      // An already open 630 tab still reads its own saved toggle.
      if (!enabled && readLocal<Settings>(configKey)) {
        try { localStorage.setItem(configKey, 'null'); } catch { /* The new toggle is already durable. */ }
      }
      setSettings(next);
      changes.current?.postMessage('settings');
      setError('');
    } catch (cause) {
      setError(cause instanceof DOMException ? 'CDA 追踪设置未能保存到浏览器数据库，请重试'
        : cause instanceof Error ? cause.message : 'CDA 追踪设置保存失败');
    } finally { setSaving(false); }
  }, [configKey]);
  const admitted = useMemo(() => {
    if (!owner || !ready || !library) return [];
    const rounds = new Map(library.rounds.filter(round => isAutomaticPreEntryRound(round) && round.state === 'complete').map(round => [round.id, round]));
    return library.records.flatMap(record => {
      const round = rounds.get(record.roundId);
      return round && record.status === 'matched' && Number.isFinite(record.matchedAt) && record.matchedAt! > 0
        ? [{ record, round }] : [];
    });
  }, [library?.records, library?.rounds, owner, ready]);
  const entries = useMemo(() => {
    if (!autoPositions) return settings ? admitted.filter(({record}) => record.updatedAt >= settings.enabledAt) : [];
    if (!owner || savedSales?.owner !== owner) return admitted;
    const present = new Set(admitted.map(({ record }) => record.id));
    const pending = savedSales.admitted.filter(({ record }) => !present.has(record.id)
      && awaitingSimulatedExit(checkpoints.current.get(jobPrefix + encodeURIComponent(record.id))));
    return pending.length ? [...admitted, ...pending] : admitted;
  }, [admitted, autoPositions, settings, owner, savedSales, jobPrefix]);
  const current = useRef({ entries, notify });
  current.current = { entries, notify };
  const wake = useRef<() => void>();
  const setPoll = useRef<(enabled: boolean) => void>();
  const manual = useRef<(input: InstantPositionFill, action: InstantManualAction) => Promise<void>>();
  const switchCurrent = useRef<NonNullable<FishCdaTracking['switchMonitor']>>();
  const switchMonitor = useCallback<NonNullable<FishCdaTracking['switchMonitor']>>(async (...args) => {
    if (!switchCurrent.current) throw Error('即时交易正在初始化，请稍后再试');
    await switchCurrent.current(...args);
  }, []);
  const managePosition = useCallback(async (input: InstantPositionFill, action: InstantManualAction) => {
    if (!manual.current) throw Error('即时交易正在初始化，请稍后再试');
    await manual.current(input, action);
  }, []);

  useEffect(() => {
    if (!configKey) return;
    let alive = true;
    const refresh = async () => {
      try {
        const [saved] = await readFishPreferences<Settings | null>([configKey]);
        if (alive) setSettings(saved === undefined ? readLocal<Settings>(configKey) : saved ?? undefined);
      } catch {
        if (alive) setError('CDA 追踪的浏览器数据库暂不可用，请重新打开页面');
      } finally { if (alive) setSaving(false); }
    };
    const refreshLegacy = (event: StorageEvent) => {
      if (event.key === configKey || event.key === null) void refresh();
      if (event.key?.startsWith(jobPrefix)) refreshCheckpoints(version => version + 1);
    };
    try {
      changes.current = new BroadcastChannel(configKey);
      changes.current.onmessage = event => {
        if (event.data === 'settings') void refresh();
        if (event.data === 'alert') refreshCheckpoints(version => version + 1);
      };
    } catch { /* The stored settings will also be read when the page opens. */ }
    window.addEventListener('storage', refreshLegacy);
    void refresh();
    return () => {
      alive = false;
      window.removeEventListener('storage', refreshLegacy);
      changes.current?.close();
      changes.current = undefined;
    };
  }, [configKey, jobPrefix]);

  useEffect(() => {
    if (!owner || typeof indexedDB === 'undefined') return;
    let active = true;
    void (async () => {
      const [stored, overridden, switched] = await Promise.all([
        readFishPreferenceEntries<Checkpoint>(jobPrefix, saved => !!saved?.alert),
        readFishPreferenceEntries<Checkpoint>(instantManualCheckpointKey(jobPrefix)),
        readFishPreferenceEntries<Checkpoint>(instantMonitorCheckpointKey(jobPrefix)),
      ]);
      const sales = new Map(stored.filter(([, saved]) => validScreenedSale(saved.alert)));
      const overrides = new Map([...overridden, ...switched]);
      for (const [suffix, saved] of overrides) {
        if (validScreenedSale(saved.alert)) sales.set(suffix, saved);
        else sales.delete(suffix);
      }
      // Existing browser checkpoints from before IndexedDB are read without rewriting.
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith(jobPrefix)) continue;
          const suffix = key.slice(jobPrefix.length);
          const saved = readLocal<Checkpoint>(key);
          if (!sales.has(suffix) && !overrides.has(suffix) && saved && validScreenedSale(saved.alert)) sales.set(suffix, saved);
        }
      } catch { /* The IndexedDB sales remain available. */ }
      if (!active || !sales.size) return;
      for (const [suffix, saved] of sales) {
        const key = jobPrefix + suffix;
        if (!checkpoints.current.get(key)?.alert || awaitingSimulatedExit(checkpoints.current.get(key)) && saved.monitorResult?.status === 'closed') checkpoints.current.set(key, saved);
      }
      const pendingMail = [...sales.values()].some(saved => !saved.delivered);
      setSavedSales(previous => ({ owner, admitted: previous?.owner === owner ? previous.admitted : [], pendingMail }));
      const ids = [...sales.keys()].flatMap(key => {
        try { return [decodeURIComponent(key)]; } catch { return []; }
      });
      const saved = await readAutomaticPreEntrySales(owner, ids);
      if (!active) return;
      setSavedSales({ owner, admitted: saved, pendingMail });
      setRevision(value => value + 1);
    })().catch(() => undefined); // Full library recovery remains available for older archives.
    return () => { active = false; };
  }, [owner, jobPrefix, refreshVersion]);

  const localSales = owner && savedSales?.owner === owner ? savedSales.admitted : undefined;

  useEffect(() => {
    if (!admitted.length) return;
    let active = true;
    const keys = admitted.map(({record}) => jobPrefix + encodeURIComponent(record.id));
    void readCheckpoints(keys).then(rows => {
      if (!active) return;
      keys.forEach((key, i) => {
        const saved = rows[i];
        const existing = checkpoints.current.get(key);
        if (saved && (!existing || awaitingSimulatedExit(existing) && saved.monitorResult?.status === 'closed' || !existing.alert && (!!saved.alert || !!saved.manual || saved.after >= existing.after))) checkpoints.current.set(key, saved);
      });
      setRevision(value => value + 1);
      wake.current?.();
    }, () => { if (active) setError('CDA 追踪进度读取失败，请重试'); });
    return () => { active = false; };
  }, [admitted, jobPrefix, refreshVersion, readCheckpoints]);

  useEffect(() => {
    const settings = activeSettings;
    if (!owner || (!settings && !autoPositions)) return;
    const lifetime = new AbortController();
    let scanning = false, mailing = false;
    const retry = new Map<string, number>();
    // Keep the input before this close only while waiting for its first traded opening price.
    const openingInputs = new Map<string, { through: number; checkpoint?: Checkpoint }>();
    const errors = new Map<string, string>();
    const limitMode = () => {
      const raw = readPersistedStateRaw(getUserPrefix(owner) + 'position_limit_mode');
      try { return normalizePositionLimitMode(JSON.parse(raw ?? 'null')); }
      catch { return normalizePositionLimitMode(null); }
    };
    const manualPending = new Set<string>();
    const intentKey = (id: string) => instantManualCheckpointKey(jobPrefix) + 'intent:' + encodeURIComponent(id);
    const hasManualIntent = (id: string) => manualPending.has(id) || (readLocal<{ until: number }>(intentKey(id))?.until ?? 0) > Date.now();
    const keyOf = (record: PreEntryRecord) => jobPrefix + encodeURIComponent(record.id);
    const read = (record: PreEntryRecord) => checkpoints.current.get(keyOf(record)) ?? readLocal<Checkpoint>(keyOf(record));
    const refresh = async (records: readonly PreEntryRecord[]) => {
      const keys = records.map(keyOf), values = await readCheckpoints(keys);
      let changed = false;
      keys.forEach((key, i) => {
        const value = values[i];
        if (value && JSON.stringify(checkpoints.current.get(key)) !== JSON.stringify(value)) {
          checkpoints.current.set(key, value);
          changed = true;
        }
      });
      if (changed) setRevision(revision => revision + 1);
    };
    const save = async (record: PreEntryRecord, value: Checkpoint) => {
      const key = keyOf(record);
      const switched = !!value.monitorResult?.instantMonitorSwitches;
      const storageKey = switched ? instantMonitorCheckpointKey(key) : value.manual ? instantManualCheckpointKey(key) : key;
      if (value.alert && value.monitorResult) {
        // Mail delivery and simulated settlement use separate locks. Keep both receipts.
        value = await updateFishPreference<Checkpoint>(storageKey, stored => {
          if (!stored?.alert || stored.alert.at !== value.alert!.at) return value;
          const result = awaitingSimulatedExit(value) && stored.monitorResult?.status === 'closed' ? stored : value;
          return { ...value, monitorResult: result.monitorResult, alert: result.alert, after: result.after,
            sent: [...new Set([...(stored.sent ?? []), ...(value.sent ?? [])])], delivered: stored.delivered || value.delivered };
        });
      } else {
        await writeFishPreference(storageKey, value);
      }
      checkpoints.current.set(key, value);
      // Keep receipts visible to a concurrently open 630 page using a legacy watch.
      if (!value.manual && !switched && readLocal<Settings>(configKey)) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* IndexedDB is the durable source. */ }
      }
      setRevision(revision => revision + 1);
    };
    const lock = (name: string, callback: () => Promise<void>) => navigator.locks
      ? navigator.locks.request(name, { ifAvailable: true }, found => found ? callback() : undefined)
      : callback();

    const send = () => {
      if (mailing || lifetime.signal.aborted) return;
      const { config } = current.current.notify;
      if (!config.enabled || fishNotifyMissing(config) || fishEmailQuotaRetryAt(config, getUserPrefix(owner))) return;
      const next = current.current.entries.find(({record}) => {
        const checkpoint = read(record);
        return checkpoint?.alert && !checkpoint.delivered && (checkpoint.nextMailAt ?? 0) <= Date.now();
      });
      if (!next) return;
      mailing = true;
      void lock(screenedFishMailLock(owner), async () => {
        const { record, round } = next;
        await refresh([record]);
        const checkpoint = read(record);
        if (lifetime.signal.aborted || !checkpoint?.alert || checkpoint.delivered || (checkpoint.nextMailAt ?? 0) > Date.now()) return;
        const live = current.current.notify;
        if (!live.config.enabled || fishNotifyMissing(live.config) || fishEmailQuotaRetryAt(live.config, getUserPrefix(owner))) return;
        const sent = new Set(checkpoint.sent);
        const recipients = live.config.emails.filter(email => !sent.has(email));
        if (!recipients.length) { await save(record, { ...checkpoint, delivered: true }); return; }
        // Keep a recovery delay for a tab that closes after requesting an email.
        const inFlight = { ...checkpoint, nextMailAt: Date.now() + 60_000 };
        await save(record, inFlight);
        const ok = await live.sendCdaAlert(record, round, checkpoint.alert, recipients, {
          signal: lifetime.signal,
          onRecipient: async email => { sent.add(email); await save(record, { ...inFlight, sent: [...sent] }); },
        });
        if (lifetime.signal.aborted) return;
        const failures = (checkpoint.failures ?? 0) + 1;
        await save(record, ok ? { ...checkpoint, delivered: true, sent: [...sent] }
          : { ...checkpoint, sent: [...sent], failures, nextMailAt: Date.now() + Math.min(60_000, 5000 * 2 ** Math.min(failures - 1, 4)) });
      }).catch(() => { if (!lifetime.signal.aborted) setError('CDA 邮件待重试'); })
        .finally(() => { mailing = false; });
    };

    // Re-read open legacy watches from their original start to recover either
    // condition already reached. Confirmed sales and delivery receipts stay as saved.
    const start = (record: PreEntryRecord) => initialCursor(record, autoPositions ? 0 : settings?.enabledAt ?? Infinity);
    const cursor = (record: PreEntryRecord, checkpoint?: Checkpoint) => !autoPositions || checkpoint?.progress?.version === SCREENED_CDA_GUARD_RULE
      ? checkpoint?.after ?? start(record) : start(record);
    const eligible = (entry: ScreenedFishAdmission, target: number) => {
      const checkpoint = read(entry.record);
      if ((checkpoint?.alert && !awaitingSimulatedExit(checkpoint)) || hasManualIntent(entry.record.id) || (retry.get(entry.record.id) ?? 0) > Date.now()) return false;
      if (checkpoint?.manual) return !!checkpoint.manual.orders && checkpoint.manual.through < target;
      if (entry.round.instantMonitor) {
        const preview = checkpoint?.monitorResult?.openingAdditionPreview;
        return (checkpoint?.after ?? Math.floor(entry.record.matchedAt! / 60_000) * 60_000) < target
          || preview?.at === target && preview.price == null && openingInputs.get(entry.record.id)?.through === target;
      }
      return !!settings && (autoPositions
          ? cursor(entry.record, checkpoint) < Math.floor(target / SCREENED_CDA_STEP) * SCREENED_CDA_STEP
            || (checkpoint?.risk?.through ?? Math.floor(entry.record.matchedAt! / 60_000) * 60_000) < target
          : cursor(entry.record, checkpoint) < target);
    };
    const checkTemplate = async ({ record, round }: ScreenedFishAdmission, target: number, checkpoint?: Checkpoint) => {
      const monitor = checkpoint?.monitorResult?.instantMonitorSwitches?.at(-1)?.to ?? round.instantMonitor!;
      const result = await readPageInstantMonitor(record.sample, monitor, record.matchedAt!, target, lifetime.signal, checkpoint?.monitorResult, undefined, round.instantPosition);
      if (lifetime.signal.aborted) throw Error('持仓监测已取消');
      if (result.status === 'error') throw Error(result.reason || '持仓监测行情待重试');
      return result;
    };
    const saveTemplate = async ({ record, round }: ScreenedFishAdmission, result: QualityResult, through: number) => {
      if (hasManualIntent(record.id)) return;
      const prior = read(record);
      const previous = prior?.monitorResult;
      if (awaitingSimulatedExit(prior) && result.status !== 'closed') return;
      const alert = instantMonitorExitDue(result) ? { ...instantMonitorSale(result), observedAt: prior?.alert?.observedAt ?? Date.now() } : undefined;
      await save(record, { ...prior, after: through, monitorResult: result, alert });
      changes.current?.postMessage('alert');
      if (alert) {
        const input = instantCampaignInput(record, round, alert, result);
        if (input) await saveInstantCampaignInput(owner, input);
        send();
      } else if (result.mirrorFill?.at !== previous?.mirrorFill?.at
        || qualityAdditionFills(result).length !== qualityAdditionFills(previous ?? {}).length
        || (result.additionReductions?.length ?? 0) !== (previous?.additionReductions?.length ?? 0)) {
        publishInstantCampaigns(owner);
      }
    };
    const saveManual = async (input: InstantPositionInput, saved: Checkpoint | undefined, state: InstantManualExecution) => {
      const key = jobPrefix + encodeURIComponent(input.recordId);
      const last = state.fills.at(-1);
      const alert: ScreenedCdaTrigger | undefined = last?.fraction === 1 ? {
        at: last.at, observedAt: Date.now(), closePrice: last.price, mirror: saved?.risk?.mirror, manual: state,
        evidence: { version: INSTANT_MANUAL_EXECUTION, reason: last.reason, priceAt: last.priceAt },
      } : undefined;
      const checkpoint = { ...saved, after: saved?.after ?? state.through, manual: state, alert };
      if (saved?.monitorResult?.instantMonitorSwitches) {
        await writeFishPreference(instantMonitorCheckpointKey(key), checkpoint);
      } else if (saved?.manual) {
        await writeFishPreference(instantManualCheckpointKey(key), checkpoint);
      } else {
        // Older tabs stop scanning upon seeing an alert. Deliberately omit the
        // sale evidence so they do not issue an email or create a false exit.
        const pausedForOldTabs: Checkpoint = { ...saved, after: checkpoint.after, alert: { at: state.startedAt }, delivered: true };
        await writeFishPreferences([[key, pausedForOldTabs], [instantManualCheckpointKey(key), checkpoint]]);
      }
      checkpoints.current.set(key, checkpoint);
      setRevision(revision => revision + 1);
      changes.current?.postMessage('alert');
      if (alert) {
        // The normal campaign pass also retries from this durable checkpoint.
        await saveInstantCampaignInput(owner, { ...input, sell: alert, monitorResult: checkpoint.monitorResult }).catch(() => undefined);
        send();
      } else if (state.fills.length !== (saved?.manual?.fills.length ?? 0)) {
        publishInstantCampaigns(owner);
      }
    };
    const scanManual = async (entry: ScreenedFishAdmission, target: number) => {
      const { record, round } = entry;
      const input = instantPositionInput(record, round);
      const saved = read(record), state = saved?.manual;
      if (!input || !saved || !state?.orders || state.through >= target) return;
      const through = Math.min(state.through + 120 * INSTANT_MANUAL_MINUTE, target);
      const bars = await readPageInstantCampaignCandles(input.source, '1m', state.through, through, lifetime.signal);
      validateFishBars(bars, through, (through - state.through) / INSTANT_MANUAL_MINUTE, INSTANT_MANUAL_MINUTE);
      if (lifetime.signal.aborted || hasManualIntent(record.id)) return;
      let next = state;
      let lastConsumed = state.through;
      const notices: (() => void)[] = [];
      const size = { ...input, ...instantMonitorSize(input.monitor, input.instantPosition), entryPrice: state.entryPrice };
      const mode = limitMode();
      for (const bar of bars) {
        if (!next.orders) break;
        lastConsumed = bar.openTime + INSTANT_MANUAL_MINUTE;
        const fill = instantManualTrigger(next.orders, bar, next.ordersAt ?? next.startedAt);
        if (!fill) continue;
        const label = fill.reason === 'take-profit' ? '止盈' : '止损';
        const held = instantPositionValuation(size, saved.monitorResult, saved.risk?.mirror, fill.price, next);
        const lot = cardCloseLotSize(input.source.symbol, [instantPositionDisplay(size, held)], fill.fraction, fill.price, 'tpsl', mode).refusal;
        if (lot) {
          next = cancelInstantProtection(next, fill.reason === 'take-profit' ? 'tp' : 'sl');
          notices.push(() => toast.error(`${label}触发时超过单笔市价上限，委托已撤销`, {
            description: `${input.source.symbol}：${lot.title}（${lot.source}）`,
          }));
          continue;
        }
        next = applyInstantManualFill(next, fill);
        notices.push(() => toast.success(`${label}已触发：${input.source.symbol} @ ${formatPrice(fill.price, input.source.symbol)}`, {
          description: `${formatSignedUSDT((held.pnl ?? 0) * fill.fraction)} USDT`,
        }));
      }
      await saveManual(input, saved, { ...next, through: lastConsumed });
      for (const notice of notices) notice();
    };
    const tick = () => {
      send();
      if (scanning || lifetime.signal.aborted || navigator.onLine === false) return;
      const step = autoPositions ? 60_000 : SCREENED_CDA_STEP;
      // Template market reads independently verify the exchange clock and the closed-bar cutoff.
      const now = Date.now();
      const templateTarget = Math.floor(now / step) * step;
      const target = Math.floor((now - CLOSE_GRACE_MS) / step) * step;
      const targetFor = (entry: ScreenedFishAdmission) => {
        const checkpoint = read(entry.record);
        if (!autoPositions || !entry.round.instantMonitor || checkpoint?.manual) return target;
        // A restored exit only needs the minute containing its scheduled opening fill.
        return awaitingSimulatedExit(checkpoint)
          ? Math.min(templateTarget, checkpoint!.alert!.at + 60_000) : templateTarget;
      };
      const due = current.current.entries.filter(entry => eligible(entry, targetFor(entry)));
      if (!due.length) return;
      scanning = true;
      let continueScan = false;
      void lock(configKey + ':scan', async () => {
        // The admission record must be durable before its first CDA evaluation.
        await refresh(due.map(entry => entry.record));
        const candidates = due.filter(entry => eligible(entry, targetFor(entry)));
        const work = await Promise.all(candidates.map(async entry => {
          const { record, round } = entry;
          const checkpoint = read(record);
          try {
            if (!checkpoint) {
              const durable = await readAutomaticPreEntryCheckpoint(owner, round.id);
              const match = durable?.records.find(saved => saved.id === record.id && saved.status === 'matched');
              if (!match || (!autoPositions && match.updatedAt < (settings?.enabledAt ?? Infinity))) {
                retry.set(record.id, Date.now() + 5000);
                return;
              }
            }
            return entry;
          } catch {
            retry.set(record.id, Date.now() + 5000);
            errors.set(record.id, record.sample.source.symbol + ' · 等待入选记录恢复');
            setError(errors.values().next().value ?? '');
            return;
          }
        }));
        if (lifetime.signal.aborted) return;
        const admitted = work.filter(entry => entry !== undefined);
        const manualEntries = admitted.filter(entry => !!read(entry.record)?.manual).sort((a, b) =>
          read(a.record)!.manual!.through - read(b.record)!.manual!.through).slice(0, 3);
        const templateQueue = admitted.filter(entry => entry.round.instantMonitor && !read(entry.record)?.manual);
        const cursorOf = (entry: ScreenedFishAdmission) => read(entry.record)?.after ?? entry.record.matchedAt!;
        // Protect the current candle's window when several historical positions also need recovery.
        templateQueue.sort((a, b) => Number(cursorOf(b) >= templateTarget - step) - Number(cursorOf(a) >= templateTarget - step)
          || cursorOf(a) - cursorOf(b));
        const templates = templateQueue.slice(0, 3);
        continueScan = templateQueue.length > templates.length;
        const legacy = admitted.filter(entry => !entry.round.instantMonitor && !read(entry.record)?.manual);
        await Promise.all([
          ...manualEntries.map(async entry => {
            try {
              await scanManual(entry, target);
              retry.delete(entry.record.id);
              if (errors.delete(entry.record.id)) setError(errors.values().next().value ?? '');
            } catch (cause) {
              if (lifetime.signal.aborted) return;
              retry.set(entry.record.id, Date.now() + 5000);
              errors.set(entry.record.id, entry.record.sample.source.symbol + ' · ' + (cause instanceof Error ? cause.message : '止盈止损行情待重试'));
              setError(errors.values().next().value ?? '');
            }
          }),
          ...templates.map(async entry => {
            const { record } = entry;
            const target = targetFor(entry);
            try {
              const stored = read(record);
              const pending = openingInputs.get(record.id);
              const repeatOpening = pending?.through === target && stored?.after === target;
              const input = repeatOpening ? pending.checkpoint : stored;
              if (!repeatOpening) openingInputs.delete(record.id);
              const result = await checkTemplate(entry, target, input);
              openingInputs.delete(record.id);
              const preview = result.openingAdditionPreview;
              if (preview?.at === target && preview.price == null) {
                openingInputs.set(record.id, { through: target, checkpoint: input });
              }
              if (repeatOpening && stored?.monitorResult) {
                if (!hasManualIntent(record.id) && preview) {
                  await save(record, { ...stored, monitorResult: { ...stored.monitorResult, openingAdditionPreview: preview, openingImpulseDecision: result.openingImpulseDecision } });
                }
                retry.set(record.id, Date.now() + POLL_MS);
                return;
              }
              if (openingInputs.has(record.id)) retry.set(record.id, Date.now() + POLL_MS);
              else if (result.status === 'waiting' || (result.status === 'open' && result.endTime! < target)) {
                retry.set(record.id, Date.now() + 5000);
              } else retry.delete(record.id);
              if (result.status === 'open' || result.status === 'closed') await saveTemplate(entry, result, result.endTime!);
              if (errors.delete(record.id)) setError(errors.values().next().value ?? '');
            } catch (cause) {
              if (lifetime.signal.aborted) return;
              retry.set(record.id, Date.now() + 5000);
              errors.set(record.id, record.sample.source.symbol + ' · ' + (cause instanceof Error ? cause.message : '持仓监测行情待重试'));
              setError(errors.values().next().value ?? '');
            }
          }),
          settings && legacy.length ? (async () => {
              const tasks = legacy.map(({ record }) => {
                const checkpoint = read(record);
                return { id: record.id, source: record.sample.source, after: cursor(record, checkpoint),
                    ...(autoPositions ? { observeAfter: record.matchedAt!, progress: checkpoint?.progress, risk: checkpoint?.risk } : {}) };
              });
              const records = new Map(legacy.map(({ record }) => [record.id, record]));
              await readPageScreenedCda(tasks, settings.snapshot, target, lifetime.signal, async (id, result, cause) => {
                if (lifetime.signal.aborted) return;
                const record = records.get(id);
                if (!record || hasManualIntent(id)) return;
                if (!result) {
                  retry.set(id, Date.now() + 5000);
                  errors.set(id, record.sample.source.symbol + ' · ' + (cause instanceof Error ? cause.message : '等待 CDA 行情'));
                  setError(errors.values().next().value ?? '');
                  return;
                }
                if (result.pendingError) {
                  retry.set(id, Date.now() + 5000);
                  errors.set(id, record.sample.source.symbol + ' · ' + result.pendingError);
                  setError(errors.values().next().value ?? '');
                } else {
                  retry.delete(id);
                  if (errors.delete(id)) setError(errors.values().next().value ?? '');
                }
                const previous = read(record);
                const hasNewRisk = !!result.risk && result.risk.through > (previous?.risk?.through ?? 0);
                if (result.trigger || hasNewRisk || result.through > cursor(record, previous)) {
                  const alert = result.trigger && { ...result.trigger, observedAt: Date.now() };
                  await save(record, { after: result.through, alert, progress: result.progress, risk: result.risk });
                  if (result.trigger) {
                    changes.current?.postMessage('alert');
                    send();
                  } else if (result.risk?.mirror && !previous?.risk?.mirror) {
                    changes.current?.postMessage('alert');
                    publishInstantCampaigns(owner);
                  }
                }
              });
          })() : undefined,
        ]);
      }).catch(cause => {
        if (!lifetime.signal.aborted) {
          for (const {record} of due) retry.set(record.id, Date.now() + 5000);
          setError(cause instanceof Error ? cause.message : 'CDA 行情待重试');
        }
      }).finally(() => {
        scanning = false;
        if (!lifetime.signal.aborted && (continueScan || Math.floor(Date.now() / step) * step > templateTarget)) tick();
      });
    };
    switchCurrent.current = async (recordId, monitor, revision) => {
      if (!autoPositions || !navigator.locks) throw Error('请在支持跨标签页并发保护的浏览器中切换');
      await navigator.locks.request(configKey + ':scan', { signal: lifetime.signal }, async () => {
        const entry = current.current.entries.find(item => item.record.id === recordId);
        if (!entry) throw Error('找不到正在持有的筛选鱼');
        const { record, round } = entry;
        if (round.liveCapturedAt != null) throw Error('该筛选鱼有实盘跟随资格，请在币安实盘持仓中管理');
        if (!round.instantMonitor || isLegacyQualityPlan(round.instantMonitor.plan)) throw Error('该持仓的原方案暂不支持接续');
        await refresh([record]);
        const saved = read(record);
        if (!saved?.monitorResult || saved.alert || saved.manual || hasManualIntent(recordId)) throw Error('持仓已卖出、等待首仓核对或正在手动管理');
        const history = saved.monitorResult.instantMonitorSwitches ?? [];
        if (history.length !== revision) throw Error('持仓方案已在别处切换，请重新选择');
        const from = history.at(-1)?.to ?? round.instantMonitor;
        if (from.templateId === monitor.templateId) throw Error('当前持仓已使用此模板');
        const closedMinute = () => Math.floor((Date.now() - CLOSE_GRACE_MS) / INSTANT_MANUAL_MINUTE) * INSTANT_MANUAL_MINUTE;
        const target = closedMinute();
        if (saved.after > target) throw Error('上一次切换等待生效，请稍后再试');
        const result = saved.after === target ? saved.monitorResult : await checkTemplate(entry, target, saved);
        if (result.status === 'closed') {
          await saveTemplate(entry, result, result.endTime!);
          throw Error('原方案已触发卖出');
        }
        if (result.endTime !== target || target !== closedMinute() || lifetime.signal.aborted || hasManualIntent(recordId)) throw Error('最新行情或手动操作等待核对，请稍后再试');
        const { marginUsdt, leverage } = instantMonitorSize(round.instantMonitor, round.instantPosition);
        const sample = instantMonitorSample(record.sample, record.matchedAt!);
        const at = Date.now();
        const next = rebaseInstantMonitor(sample, result, result.initialNotional ?? marginUsdt * leverage, from, monitor, at);
        const key = keyOf(record);
        const checkpoint = { ...saved, after: next.endTime!, monitorResult: next };
        // Old tabs see a stopped watch without sale evidence. The switched watch has its own checkpoint.
        const paused: Checkpoint = { after: checkpoint.after, alert: { at }, delivered: true };
        await writeFishPreferences([[key, paused], [instantManualCheckpointKey(key), paused], [instantMonitorCheckpointKey(key), checkpoint]]);
        checkpoints.current.set(key, checkpoint);
        setRevision(value => value + 1);
        changes.current?.postMessage('alert');
        publishInstantCampaigns(owner);
      });
      wake.current?.();
    };
    manual.current = async (input, action) => {
      if (manualPending.has(input.recordId)) throw Error('这笔仓位正在处理，请稍后再试');
      manualPending.add(input.recordId);
      const keyForIntent = intentKey(input.recordId);
      const intent = { token: crypto.randomUUID(), until: Date.now() + 60_000 };
      try { localStorage.setItem(keyForIntent, JSON.stringify(intent)); } catch { /* Same-tab intent is already visible. */ }
      const perform = async () => {
        const key = jobPrefix + encodeURIComponent(input.recordId);
        const [stored] = await readCheckpoints([key]);
        const saved = stored ?? checkpoints.current.get(key) ?? readLocal<Checkpoint>(key);
        if (validScreenedSale(saved?.alert)) throw Error('这笔仓位已经卖出');
        if (action.kind === 'cancel') {
          if (!saved?.manual?.orders) return;
          await saveManual(input, saved, cancelInstantProtection(saved.manual, action.side));
          toast.success('止盈/止损委托已撤销');
          return;
        }
        let mark: { at: number; price: number };
        try {
          mark = await readInstantPositionQuote(input.source, AbortSignal.any([lifetime.signal, AbortSignal.timeout(4000)]));
          if (mark.at < input.buyAt || Date.now() - mark.at > 20_000) throw Error('标记价格已延迟');
        } catch {
          mark = await markPageInstantPosition(input, lifetime.signal);
          if (Date.now() - mark.at > 120_000) throw Error('行情已延迟，请稍后重试');
        }
        if (lifetime.signal.aborted) throw Error('操作已取消');
        const at = Math.max(Date.now(), mark.at, input.buyAt + 1, saved?.manual?.fills.at(-1)?.at ?? 0);
        const through = Math.floor(at / INSTANT_MANUAL_MINUTE) * INSTANT_MANUAL_MINUTE;
        const state: InstantManualExecution = saved?.manual ?? {
          version: INSTANT_MANUAL_EXECUTION, startedAt: at, entryPrice: input.entryPrice, through, fills: [],
        };
        const held = instantPositionValuation(input, saved?.monitorResult, saved?.risk?.mirror, mark.price, state);
        if (!(held.remainingQuantity > 0)) throw Error('这笔仓位已经卖出');
        const display = instantPositionDisplay(input, held);
        if (action.kind === 'protect') {
          validateInstantManualLevels(action.levels, mark.price);
          const { tp, sl, percentage } = action.levels;
          for (const [label, price] of [['止盈', tp], ['止损', sl]] as const) {
            if (price == null) continue;
            const lot = cardCloseLotSize(input.source.symbol, [display], percentage / 100, price, 'tpsl', limitMode()).refusal;
            if (lot) throw Error(`${label}（${percentage}% 仓位）：${lot.title}`);
          }
          await saveManual(input, saved, { ...state, orders: action.levels, ordersAt: at, through });
          toast.success('止盈/止损委托已下达', {
            description: `TP: ${tp || '-'} / SL: ${sl || '-'} · ${percentage}% 仓位`,
          });
          return;
        }
        const { fraction } = action;
        if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) throw Error('平仓数量无效');
        const lot = action.all ? null : cardCloseLotSize(input.source.symbol, [display], fraction, mark.price, 'market-close', limitMode()).refusal;
        if (lot) throw Error(`市价平仓：${lot.title}。请分次市价平仓，或设 100% 止盈止损。`);
        const next = applyInstantManualFill({ ...state, through, ordersAt: at }, { at, priceAt: mark.at, price: mark.price, fraction, reason: 'manual' });
        await saveManual(input, saved, next);
        toast.success(`市价平仓成功，已结算盈亏：${formatSignedUSDT((held.pnl ?? 0) * fraction)} USDT`, {
          description: `${input.source.symbol} · 即时交易模拟 · ${+(fraction * 100).toPrecision(8)}% 仓位`,
        });
      };
      try {
        if (navigator.locks) await navigator.locks.request(configKey + ':scan', { signal: lifetime.signal }, perform);
        else {
          if (scanning) throw Error('正在核对自动卖出，请稍后重试');
          scanning = true;
          try { await perform(); } finally { scanning = false; }
        }
      } finally {
        try {
          if (readLocal<typeof intent>(keyForIntent)?.token === intent.token) localStorage.removeItem(keyForIntent);
        } catch { /* An abandoned intent expires automatically. */ }
        manualPending.delete(input.recordId);
        retry.delete(input.recordId);
        wake.current?.();
      }
    };
    wake.current = tick;
    let timer: number | undefined;
    let closeTimer: number | undefined;
    const scheduleClose = () => {
      const remaining = INSTANT_MANUAL_MINUTE - Date.now() % INSTANT_MANUAL_MINUTE;
      closeTimer = window.setTimeout(() => {
        scheduleClose();
        tick();
      }, remaining);
    };
    setPoll.current = enabled => {
      if (enabled && autoPositions && closeTimer === undefined) scheduleClose();
      if (!enabled && closeTimer !== undefined) {
        window.clearTimeout(closeTimer);
        closeTimer = undefined;
      }
      if (enabled && timer === undefined) timer = window.setInterval(tick, POLL_MS);
      else if (!enabled && timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
    window.addEventListener('online', tick);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    tick();
    return () => {
      lifetime.abort();
      wake.current = undefined;
      manual.current = undefined;
      switchCurrent.current = undefined;
      setPoll.current?.(false);
      setPoll.current = undefined;
      window.removeEventListener('online', tick);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [configKey, jobPrefix, owner, activeSettings, autoPositions, readCheckpoints]);

  useEffect(() => { wake.current?.(); }, [entries, notify.config]);
  const counts = useMemo(() => {
    const streamSymbols = new Set<string>();
    let active = 0, awaitingMail = 0, watching = false;
    for (const { record, round } of entries) {
      const key = jobPrefix + encodeURIComponent(record.id);
      const checkpoint = checkpoints.current.get(key) ?? readLocal<Checkpoint>(key);
      if (!checkpoint?.alert || awaitingSimulatedExit(checkpoint)) {
        active++;
        const source = record.sample.source;
        if (round.instantMonitor && checkpoint?.monitorResult?.status === 'open' && !checkpoint.manual
          && (source.exchange ?? 'binance') === 'binance' && /^[\p{L}\d]+USDT$/u.test(source.symbol)) {
          streamSymbols.add(source.symbol);
        }
        if (!checkpoint?.manual || checkpoint.manual.orders) watching = true;
      }
      if (checkpoint?.alert && !checkpoint.delivered) awaitingMail++;
    }
    return { active, awaitingMail, watching, streamSymbols: [...streamSymbols].sort().join(',') };
  }, [entries, jobPrefix, revision]);
  useEffect(() => {
    if (!autoPositions || !counts.streamSymbols || typeof WebSocket === 'undefined') return;
    const symbols = counts.streamSymbols.split(',');
    const cleanups = [];
    for (let offset = 0; offset < symbols.length; offset += 64) {
      cleanups.push(watchInstantMinuteStreams(symbols.slice(offset, offset + 64), () => wake.current?.()));
    }
    return () => cleanups.forEach(close => close());
  }, [autoPositions, owner, counts.streamSymbols]);
  const shouldPoll = counts.watching || (counts.awaitingMail > 0 && notify.config.enabled && !fishNotifyMissing(notify.config));
  useEffect(() => { setPoll.current?.(shouldPoll); }, [shouldPoll, configKey, activeSettings, autoPositions]);

  const alerts = useMemo(() => {
    const result = new Map<string, ScreenedCdaTrigger>();
    for (const { record } of [...(localSales ?? []), ...admitted]) {
      const key = jobPrefix + encodeURIComponent(record.id);
      const alert = (checkpoints.current.get(key) ?? readLocal<Checkpoint>(key))?.alert;
      if (validScreenedSale(alert)) result.set(record.id, alert);
    }
    return result;
  }, [admitted, localSales, jobPrefix, revision]);
  const mailIssue = settings && counts.awaitingMail ? !notify.config.enabled ? '邮件提醒已关闭' : fishNotifyMissing(notify.config) : '';
  const mirrorFills = useMemo(() => {
    const fills = new Map<string, NonNullable<ScreenedPriceProgress['mirror']>>();
    for (const { record } of admitted) {
      const saved = checkpoints.current.get(jobPrefix + encodeURIComponent(record.id));
      const fill = saved?.alert?.mirror ?? saved?.risk?.mirror;
      if (fill) fills.set(record.id, fill);
    }
    return fills;
  }, [admitted, jobPrefix, revision]);
  const monitorResults = useMemo(() => {
    const results = new Map<string, QualityResult>();
    for (const { record } of [...(localSales ?? []), ...admitted]) {
      const value = checkpoints.current.get(jobPrefix + encodeURIComponent(record.id))?.monitorResult;
      if (value) results.set(record.id, value);
    }
    return results;
  }, [admitted, localSales, jobPrefix, revision]);
  const manualPositions = useMemo(() => {
    const results = new Map<string, InstantManualExecution>();
    for (const { record } of admitted) {
      const value = checkpoints.current.get(jobPrefix + encodeURIComponent(record.id))?.manual;
      if (value) results.set(record.id, value);
    }
    return results;
  }, [admitted, jobPrefix, revision]);
  return { enabled: !!activeSettings, managePosition, switchMonitor, manualPositions, mirrorFills, monitorResults, saving, error: error || mailIssue || '', setEnabled, alerts, admitted, localSales, hasPendingSaleMail: !!owner && savedSales?.owner === owner && savedSales.pendingMail, active: counts.active, awaitingMail: counts.awaitingMail };
}
