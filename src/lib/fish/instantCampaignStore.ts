import { supabase } from '@/integrations/supabase/client';
import { INSTANT_CAMPAIGN_HEADER } from '@/lib/authGateway';
import { runAccountSyncRequest } from '@/lib/accountSyncTransport';
import { isInstantCampaignId } from '@/lib/campaignSections';
import { INSTANT_TEMPLATE_MONITOR } from './instantMonitorSettings';
import { validScreenedSale } from './screenedCda';
import { readFishPreferences, readFishPreferenceEntries, updateFishPreference } from './fishPreferencesDb';
import { laterInstantReplayEntry, screenedReplayEntry, type InstantReplayEntry } from './latestScreenedReplaySymbol';
import { validInstantMonitorClose, type InstantCampaignInput, type InstantCampaignSnapshot, type InstantPositionFill, type InstantPositionInput } from './instantCampaign';

export const INSTANT_CAMPAIGN_EVENT = 'veil-instant-campaign-saved';
const KEY = 'idb:instant-campaign-v1/';
// Bound the prefix on a letter so common collations that ignore punctuation still order it correctly.
const KEY_START = KEY + 'fish-instant-';
const KEY_END = KEY + 'fish-instanu';
const CLOUD_READ_MS = 30_000;
const localPrefix = (owner: string) => KEY + encodeURIComponent(owner) + '/';
// Earlier tabs can read their own live jobs while the template position uses a separate local queue.
const templatePrefix = (owner: string) => 'idb:instant-template-jobs-v1/' + encodeURIComponent(owner) + '/';
const localJobKey = (owner: string, input: InstantPositionInput) => (input.monitor ? templatePrefix(owner) : localPrefix(owner)) + input.id;
const table = () => supabase.from('user_sim_state' as never);
type Saved = { input: InstantPositionInput | InstantCampaignInput; opened?: InstantPositionFill; snapshot?: InstantCampaignSnapshot; synced?: true };

export function publishInstantCampaigns(owner: string) {
  openReads.delete(owner);
  window.dispatchEvent(new CustomEvent(INSTANT_CAMPAIGN_EVENT, { detail: { owner } }));
  try {
    const channel = new BroadcastChannel(INSTANT_CAMPAIGN_EVENT);
    channel.postMessage(owner);
    channel.close();
  } catch { /* Reopening the list reads IndexedDB again. */ }
}

export function subscribeInstantCampaigns(owner: string, refresh: () => void) {
  const listener = (event: Event) => { if ((event as CustomEvent).detail?.owner === owner) refresh(); };
  window.addEventListener(INSTANT_CAMPAIGN_EVENT, listener);
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(INSTANT_CAMPAIGN_EVENT);
    channel.onmessage = event => { if (event.data === owner) { openReads.delete(owner); refresh(); } };
  } catch { /* Same-tab saves still notify the list. */ }
  return () => {
    window.removeEventListener(INSTANT_CAMPAIGN_EVENT, listener);
    channel?.close();
  };
}

async function projectInstantJobs<T>(owner: string, project: (job: Saved) => T | undefined): Promise<T[]> {
  // Filter after resolving the two queue generations. A stale open copy must
  // never win over a confirmed sale, even when the caller only requests opens.
  const winners = new Map<string, { rank: number; value?: T }>();
  const collect = (job: Saved) => {
    const rank = jobRank(job);
    if (rank >= (winners.get(job.input.id)?.rank ?? -1)) {
      winners.set(job.input.id, { rank, value: project(job) });
    }
    return false;
  };
  await readFishPreferenceEntries(localPrefix(owner), collect);
  await readFishPreferenceEntries(templatePrefix(owner), collect);
  return [...winners.values()].flatMap(({ value }) => value === undefined ? [] : [value]);
}

function readInstantJobs(owner: string, include: (job: Saved) => boolean) {
  return projectInstantJobs(owner, job => include(job) ? job : undefined);
}

function jobRank(job: Saved) {
  if (job.snapshot) return job.synced ? 4 : 3;
  if ('sell' in job.input) return 2;
  return job.opened ? 1 : 0;
}

export interface InstantPositionClose {
  id: string;
  symbol: string;
  buyAt: number;
  sellAt: number;
  entryPrice?: number;
  exitPrice?: number;
}

export async function readInstantPositionLedger(owner: string) {
  const positions: InstantPositionFill[] = [];
  const history: InstantPositionClose[] = [];
  const rows = await projectInstantJobs<InstantPositionFill | InstantPositionClose>(owner, job => {
    const sale = job.snapshot ?? ('sell' in job.input ? job.input : undefined);
    if (!sale) return job.opened;
    return { id: sale.id, symbol: sale.source.symbol, buyAt: sale.buyAt, sellAt: sale.sell.at,
      entryPrice: job.snapshot?.entryPrice ?? job.opened?.entryPrice ?? sale.monitorResult?.entryPrice,
      exitPrice: job.snapshot?.exitPrice ?? sale.sell.closePrice };
  });
  for (const row of rows) {
    if ('sellAt' in row) history.push(row);
    else positions.push(row);
  }
  return { positions, history };
}

const isOpenJob = (job: Saved) => !!job.opened && !job.snapshot && !('sell' in job.input);
/** Recover active admissions with one pass through each account queue, including reserved entries awaiting a fill. */
export async function readActiveInstantRecordIds(owner: string): Promise<string[]> {
  const jobs = await readInstantJobs(owner, job => isOpenJob(job) || !job.synced && !job.opened && !('sell' in job.input));
  return [...new Set(jobs.map(job => job.input.recordId))];
}
const openReads = new Map<string, Promise<InstantPositionFill[]>>();
export function readOpenInstantPositions(owner: string): Promise<InstantPositionFill[]> {
  const existing = openReads.get(owner);
  if (existing) return existing;
  const task = readInstantJobs(owner, isOpenJob).then(jobs => jobs.map(job => job.opened!));
  openReads.set(owner, task);
  const release = () => { if (openReads.get(owner) === task) openReads.delete(owner); };
  void task.then(release, release);
  return task;
}

export function readPendingInstantCampaignJobs(owner: string, autoPositions: boolean): Promise<Saved[]> {
  return readInstantJobs(owner, job => !job.synced && ('sell' in job.input || autoPositions && !job.opened));
}

export async function saveInstantCampaignInput(owner: string, input: InstantCampaignInput): Promise<Saved> {
  const saved = await updateFishPreference<Saved>(localJobKey(owner, input), previous => {
    if (previous?.snapshot) return previous;
    if (previous && 'sell' in previous.input) {
      return previous.input.metadata || !input.metadata || previous.input.sell.at !== input.sell.at
        ? previous : { ...previous, input: { ...previous.input, metadata: input.metadata } };
    }
    return { ...previous, input };
  });
  publishInstantCampaigns(owner);
  return saved;
}

export async function saveInstantPosition(owner: string, input: InstantPositionInput, opened?: InstantPositionFill) {
  const saved = await updateFishPreference<Saved>(localJobKey(owner, input), previous => {
    if (previous?.snapshot || previous?.opened || (previous && !opened)) return previous;
    return { ...previous, input: previous?.input ?? input, ...(opened ? { opened } : {}) };
  });
  publishInstantCampaigns(owner);
  return saved;
}

export async function saveInstantCampaignSnapshot(owner: string, snapshot: InstantCampaignSnapshot): Promise<InstantCampaignSnapshot> {
  const saved = await updateFishPreference<Saved>(localJobKey(owner, snapshot), previous =>
    previous?.snapshot ? previous : { input: snapshot, snapshot });
  publishInstantCampaigns(owner);
  return saved.snapshot!;
}

export async function syncInstantCampaign(owner: string, snapshot: InstantCampaignSnapshot, signal: AbortSignal) {
  const key = KEY + snapshot.id;
  if (signal.aborted) return;
  const result = await runAccountSyncRequest(() => table().upsert({
    user_id: owner, key, value: snapshot, updated_at: new Date(snapshot.recordedAt).toISOString(),
  } as never, { onConflict: 'user_id,key', ignoreDuplicates: true }).setHeader(INSTANT_CAMPAIGN_HEADER, '1'), { current: () => !signal.aborted });
  if (!result || signal.aborted) return;
  if (result.error) throw Error(result.error.message);
  // Concurrent browsers may have finished the same record. Always adopt the
  // immutable winner that the unique account/key row actually stored.
  const { data, error } = await table().select('key,value').eq('user_id', owner).eq('key', key)
    .setHeader(INSTANT_CAMPAIGN_HEADER, '1').abortSignal(AbortSignal.any([signal, AbortSignal.timeout(CLOUD_READ_MS)])).single();
  if (error) throw Error(error.message);
  const saved = decodeSnapshot(data);
  if (!saved) throw Error('即时交易云端记录无法核验');
  await cacheRemote(owner, saved);
}

function decodeSnapshot(row: unknown): InstantCampaignSnapshot | undefined {
  const { key, value } = (row ?? {}) as { key?: string; value?: InstantCampaignSnapshot };
  if (!value || (value.version !== 1 && value.version !== 2) || key !== KEY + value.id || !isInstantCampaignId(value.id) || !value.source?.symbol
    || !value.recordId || !Number.isSafeInteger(value.buyAt) || value.buyAt <= 0 || !Number.isSafeInteger(value.sell?.at) || (value.monitor ? !validInstantMonitorClose(value) : value.sell.evidence?.version === INSTANT_TEMPLATE_MONITOR || value.sell.at <= value.buyAt)
    || !validScreenedSale(value.sell) || !Array.isArray(value.detectors)
    || ![value.entryPrice, value.exitPrice, value.recordedAt].every(n => Number.isFinite(n) && n > 0)) return;
  if (value.version === 2 && ![value.marginUsdt, value.leverage, value.marginUsdt * value.leverage]
    .every(n => Number.isFinite(n) && n > 0)) return;
  return value;
}

async function cacheRemote(owner: string, snapshot: InstantCampaignSnapshot, notify = true) {
  let changed = false;
  await updateFishPreference<Saved>(localJobKey(owner, snapshot), previous => {
    changed = JSON.stringify(previous?.snapshot) !== JSON.stringify(snapshot);
    return previous?.synced && !changed ? previous : { input: snapshot, snapshot, synced: true };
  });
  if (changed && notify) publishInstantCampaigns(owner);
  return changed;
}

/** Other devices can finish the simulation while this browser still has its opening fill. */
export async function reconcileOpenInstantPositions(owner: string, signal: AbortSignal) {
  const open = await readOpenInstantPositions(owner);
  for (let start = 0; start < open.length && !signal.aborted; start += 40) {
    const batch = new Map(open.slice(start, start + 40).map(position => [position.id, position]));
    const { data, error } = await table().select('key,value').eq('user_id', owner)
      .in('key', [...batch.keys()].map(id => KEY + id)).setHeader(INSTANT_CAMPAIGN_HEADER, '1')
      .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(CLOUD_READ_MS)]));
    if (error) throw Error(error.message);
    let changed = false;
    try {
      for (const row of data ?? []) {
        if (signal.aborted) return;
        const closed = decodeSnapshot(row);
        const position = closed && batch.get(closed.id);
        if (position && closed && closed.recordId === position.recordId && closed.buyAt === position.buyAt
          && closed.source.symbol === position.source.symbol) {
          if (await cacheRemote(owner, closed, false)) changed = true;
        }
      }
    } finally {
      if (changed) publishInstantCampaigns(owner);
    }
  }
}

export function readLocalInstantCampaignJobs(owner: string) {
  return readInstantJobs(owner, job => !!job.snapshot || !!job.opened || 'sell' in job.input);
}

export async function readLatestLocalInstantReplay(owner: string) {
  let latest: InstantReplayEntry | undefined;
  await readInstantJobs(owner, job => {
    const closed = job?.snapshot ?? (job?.input && 'sell' in job.input && (job.opened || job.input.opened) ? job.input : undefined);
    if (closed) latest = laterInstantReplayEntry(latest, screenedReplayEntry(closed.source, closed.sell.at));
    return false;
  });
  return latest;
}

export async function readLatestCloudInstantReplay(owner: string, signal: AbortSignal) {
  const { data, error } = await table().select('closedAt:value->sell->at,source:value->source')
    .eq('user_id', owner).gte('key', KEY_START).lt('key', KEY_END)
    .order('value->sell->at', { ascending: false, nullsFirst: false }).limit(16).setHeader(INSTANT_CAMPAIGN_HEADER, '1')
    .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(8000)]));
  if (error) throw Error(error.message);
  let latest: InstantReplayEntry | undefined;
  for (const row of (data ?? []) as { closedAt: number; source: InstantPositionInput['source'] }[]) {
    latest = laterInstantReplayEntry(latest, screenedReplayEntry(row.source, row.closedAt));
  }
  return latest;
}

export async function readLocalInstantCampaignSnapshots(owner: string) {
  return (await readInstantJobs(owner, job => !!job.snapshot)).map(job => job.snapshot!);
}

export async function listInstantCampaignSnapshots(owner: string, signal?: AbortSignal) {
  let warning: string | undefined;
  const snapshots = new Map<string, InstantCampaignSnapshot>();
  let cacheChanged = false;
  try {
    const pageSize = 250;
    let after: string | undefined;
    for (;;) {
      const deadline = AbortSignal.timeout(CLOUD_READ_MS);
      const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const query = table().select('key,value').eq('user_id', owner).lt('key', KEY_END)
        .order('key').limit(pageSize).setHeader(INSTANT_CAMPAIGN_HEADER, '1');
      const { data, error } = await (after ? query.gt('key', after) : query.gte('key', KEY_START)).abortSignal(requestSignal);
      if (error) throw Error(error.message);
      for (const row of data ?? []) {
        const snapshot = decodeSnapshot(row);
        if (!snapshot) {
          warning = '有即时交易云端记录无法读取，已显示其余存档。';
          continue;
        }
        snapshots.set(snapshot.id, snapshot);
        try { if (await cacheRemote(owner, snapshot, false)) cacheChanged = true; }
        catch { warning = '云端战役已读取，本机暂时无法缓存。'; }
      }
      if (!data || data.length < pageSize) break;
      const last = (data.at(-1) as { key?: string } | undefined)?.key;
      if (!last || last === after || !last.startsWith(KEY)) throw Error('即时交易分页游标无效');
      after = last;
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    warning = '即时交易云端暂未读完，可重试；已读取的战役仍可查看。';
  } finally {
    if (cacheChanged) publishInstantCampaigns(owner);
  }
  try {
    for (const local of await readLocalInstantCampaignSnapshots(owner)) {
      if (!snapshots.has(local.id)) snapshots.set(local.id, local);
    }
  } catch {
    warning ??= '即时交易的本机存档暂时无法读取。';
  }
  return { snapshots: [...snapshots.values()], warning };
}

export async function readInstantCampaignJob(owner: string, id: string) {
  const [template, legacy] = await readFishPreferences<Saved>([templatePrefix(owner) + id, localPrefix(owner) + id]);
  if (!template || !legacy) return template ?? legacy;
  return jobRank(template) >= jobRank(legacy) ? template : legacy;
}

export async function loadInstantCampaignSnapshot(owner: string, id: string, signal?: AbortSignal, local?: Saved) {
  const saved = local ?? await readInstantCampaignJob(owner, id);
  if (saved?.snapshot && saved.synced) return saved.snapshot;
  const { data, error } = await table().select('key,value').eq('user_id', owner).eq('key', KEY + id)
    .setHeader(INSTANT_CAMPAIGN_HEADER, '1').abortSignal(signal ? AbortSignal.any([signal, AbortSignal.timeout(CLOUD_READ_MS)]) : AbortSignal.timeout(CLOUD_READ_MS)).maybeSingle();
  const remote = decodeSnapshot(data);
  if (remote) { await cacheRemote(owner, remote); return remote; }
  if (saved?.snapshot?.id === id) return saved.snapshot;
  throw Error(error ? '即时交易云端记录暂时无法读取' : '这场即时交易记录不存在');
}
