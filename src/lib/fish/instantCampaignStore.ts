import { supabase } from '@/integrations/supabase/client';
import { INSTANT_CAMPAIGN_HEADER } from '@/lib/authGateway';
import { runAccountSyncRequest } from '@/lib/accountSyncTransport';
import { isInstantCampaignId } from '@/lib/campaignSections';
import { SCREENED_CDA_LIMIT } from './screenedCda';
import { readFishPreferences, readFishPreferencesWithPrefix, updateFishPreference } from './fishPreferencesDb';
import type { InstantCampaignInput, InstantCampaignSnapshot } from './instantCampaign';

export const INSTANT_CAMPAIGN_EVENT = 'veil-instant-campaign-saved';
const KEY = 'idb:instant-campaign-v1/';
// Bound the prefix on a letter so common collations that ignore punctuation still order it correctly.
const KEY_START = KEY + 'fish-instant-';
const KEY_END = KEY + 'fish-instanu';
const CLOUD_READ_MS = 30_000;
const localPrefix = (owner: string) => KEY + encodeURIComponent(owner) + '/';
const table = () => supabase.from('user_sim_state' as never);
type Saved = { input: InstantCampaignInput; snapshot?: InstantCampaignSnapshot; synced?: true };

function publish(owner: string) {
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
    channel.onmessage = event => { if (event.data === owner) refresh(); };
  } catch { /* Same-tab saves still notify the list. */ }
  return () => {
    window.removeEventListener(INSTANT_CAMPAIGN_EVENT, listener);
    channel?.close();
  };
}

export async function readInstantCampaignJobs(owner: string): Promise<Saved[]> {
  return readFishPreferencesWithPrefix<Saved>(localPrefix(owner));
}

export function saveInstantCampaignInput(owner: string, input: InstantCampaignInput): Promise<Saved> {
  return updateFishPreference<Saved>(localPrefix(owner) + input.id, previous => previous ?? { input });
}

export async function saveInstantCampaignSnapshot(owner: string, snapshot: InstantCampaignSnapshot): Promise<InstantCampaignSnapshot> {
  const saved = await updateFishPreference<Saved>(localPrefix(owner) + snapshot.id, previous =>
    previous?.snapshot ? previous : { input: snapshot, snapshot });
  publish(owner);
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
    || !value.recordId || !Number.isSafeInteger(value.buyAt) || value.buyAt <= 0 || !Number.isSafeInteger(value.sell?.at) || value.sell.at <= value.buyAt
    || !Number.isFinite(value.sell.value) || value.sell.value >= SCREENED_CDA_LIMIT || !Array.isArray(value.detectors)
    || ![value.entryPrice, value.exitPrice, value.recordedAt].every(n => Number.isFinite(n) && n > 0)) return;
  if (value.version === 2 && ![value.marginUsdt, value.leverage, value.marginUsdt * value.leverage]
    .every(n => Number.isFinite(n) && n > 0)) return;
  return value;
}

async function cacheRemote(owner: string, snapshot: InstantCampaignSnapshot, notify = true) {
  let changed = false;
  await updateFishPreference<Saved>(localPrefix(owner) + snapshot.id, previous => {
    changed = JSON.stringify(previous?.snapshot) !== JSON.stringify(snapshot);
    return previous?.synced && !changed ? previous : { input: snapshot, snapshot, synced: true };
  });
  if (changed && notify) publish(owner);
}

export async function readLocalInstantCampaignSnapshots(owner: string) {
  return (await readInstantCampaignJobs(owner)).flatMap(job => job.snapshot ? [job.snapshot] : []);
}

export async function listInstantCampaignSnapshots(owner: string, signal?: AbortSignal) {
  let warning: string | undefined;
  const snapshots = new Map<string, InstantCampaignSnapshot>();
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
        try { await cacheRemote(owner, snapshot, false); }
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

export async function loadInstantCampaignSnapshot(owner: string, id: string) {
  const [saved] = await readFishPreferences<Saved>([localPrefix(owner) + id]);
  if (saved?.snapshot && saved.synced) return saved.snapshot;
  const { data, error } = await table().select('key,value').eq('user_id', owner).eq('key', KEY + id)
    .setHeader(INSTANT_CAMPAIGN_HEADER, '1').abortSignal(AbortSignal.timeout(CLOUD_READ_MS)).maybeSingle();
  const remote = decodeSnapshot(data);
  if (remote) { await cacheRemote(owner, remote); return remote; }
  if (saved?.snapshot?.id === id) return saved.snapshot;
  throw Error(error ? '即时交易云端记录暂时无法读取' : '这场即时交易记录不存在');
}
