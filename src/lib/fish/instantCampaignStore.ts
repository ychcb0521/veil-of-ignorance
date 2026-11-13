import { supabase } from '@/integrations/supabase/client';
import { runAccountSyncRequest } from '@/lib/accountSyncTransport';
import { isInstantCampaignId } from '@/lib/campaignSections';
import { SCREENED_CDA_LIMIT } from './screenedCda';
import { readFishPreferences, readFishPreferencesWithPrefix, updateFishPreference } from './fishPreferencesDb';
import type { InstantCampaignInput, InstantCampaignSnapshot } from './instantCampaign';

export const INSTANT_CAMPAIGN_EVENT = 'veil-instant-campaign-saved';
const KEY = 'idb:instant-campaign-v1/';
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
  } as never, { onConflict: 'user_id,key', ignoreDuplicates: true }), { current: () => !signal.aborted });
  if (!result || signal.aborted) return;
  if (result.error) throw Error(result.error.message);
  // Concurrent browsers may have finished the same record. Always adopt the
  // immutable winner that the unique account/key row actually stored.
  const { data, error } = await table().select('key,value').eq('user_id', owner).eq('key', key)
    .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(12_000)])).single();
  if (error) throw Error(error.message);
  const saved = decodeSnapshot(data);
  if (!saved) throw Error('即时交易云端记录无法核验');
  await cacheRemote(owner, saved);
}

function decodeSnapshot(row: unknown): InstantCampaignSnapshot | undefined {
  const { key, value } = (row ?? {}) as { key?: string; value?: InstantCampaignSnapshot };
  if (!value || value.version !== 1 || key !== KEY + value.id || !isInstantCampaignId(value.id) || !value.source?.symbol
    || !value.recordId || !Number.isSafeInteger(value.buyAt) || value.buyAt <= 0 || !Number.isSafeInteger(value.sell?.at) || value.sell.at <= value.buyAt
    || !Number.isFinite(value.sell.value) || value.sell.value >= SCREENED_CDA_LIMIT || !Array.isArray(value.detectors)
    || ![value.entryPrice, value.exitPrice, value.recordedAt].every(n => Number.isFinite(n) && n > 0)) return;
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

export async function listInstantCampaignSnapshots(owner: string, signal?: AbortSignal) {
  let warning: string | undefined;
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000);
  try {
    const pageSize = 250;
    for (let offset = 0; ; offset += pageSize) {
      const query = table().select('key,value').eq('user_id', owner).like('key', KEY + '%')
        .order('key').range(offset, offset + pageSize - 1);
      const { data, error } = await query.abortSignal(requestSignal);
      if (error) throw Error(error.message);
      for (const row of data ?? []) {
        const snapshot = decodeSnapshot(row);
        if (!snapshot) {
          warning = '有即时交易云端记录无法读取，已显示其余存档。';
          continue;
        }
        await cacheRemote(owner, snapshot, false);
      }
      if (!data || data.length < pageSize) break;
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    warning = '即时交易的云端记录暂未读完，已显示本机存档。';
  }
  const jobs = await readInstantCampaignJobs(owner);
  const snapshots = jobs.flatMap(job => job.snapshot ? [job.snapshot] : []);
  return { snapshots, warning };
}

export async function loadInstantCampaignSnapshot(owner: string, id: string) {
  const [saved] = await readFishPreferences<Saved>([localPrefix(owner) + id]);
  if (saved?.snapshot && saved.synced) return saved.snapshot;
  const { data, error } = await table().select('key,value').eq('user_id', owner).eq('key', KEY + id)
    .abortSignal(AbortSignal.timeout(12_000)).maybeSingle();
  const remote = decodeSnapshot(data);
  if (remote) { await cacheRemote(owner, remote); return remote; }
  if (saved?.snapshot?.id === id) return saved.snapshot;
  throw Error(error ? '即时交易云端记录暂时无法读取' : '这场即时交易记录不存在');
}
