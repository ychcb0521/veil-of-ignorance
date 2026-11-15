import { supabase } from '@/integrations/supabase/client';
import { INSTANT_CAMPAIGN_HEADER } from '@/lib/authGateway';
import { runAccountSyncRequest } from '@/lib/accountSyncTransport';
import { readFishPreferenceEntries, readFishPreferences, updateFishPreference } from './fishPreferencesDb';
import { publishInstantCampaigns } from './instantCampaignStore';
import { isUsdtLiveCampaignId, usdtLiveCampaignId, type UsdtLiveCampaign } from './usdtLiveCampaign';

const CLOUD = 'idb:usdt-live-campaign-v1/';
const prefix = (owner: string) => CLOUD + encodeURIComponent(owner) + '/';
const localKey = (owner: string, id: string) => prefix(owner) + id;
const CLOUD_START = CLOUD + 'fish-instant-live-';
const CLOUD_END = CLOUD + 'fish-instant-livf';
const table = () => supabase.from('user_sim_state' as never);
type Saved = { campaign: UsdtLiveCampaign; observedAt: number; synced?: true };

function decodeSaved(value: unknown): Saved | undefined {
  const saved = value as Saved | undefined;
  if (!saved || !Number.isSafeInteger(saved.observedAt) || !saved.campaign ||
    !Array.isArray(saved.campaign.fills) || saved.campaign.fills[0]?.action !== 'open') return;
  const { campaign } = saved;
  if (!isUsdtLiveCampaignId(usdtLiveCampaignId(campaign)) || !Number.isSafeInteger(campaign.openedAt) ||
    campaign.openedAt <= 0 || (campaign.closedAt !== undefined && (!Number.isSafeInteger(campaign.closedAt) ||
      campaign.closedAt < campaign.openedAt || campaign.quantity !== '0'))) return;
  return saved;
}

export const readUsdtCampaigns = async (owner: string, include?: (saved: Saved) => boolean) =>
  (await readFishPreferenceEntries<Saved>(prefix(owner), include)).map(([, saved]) => saved);

async function saveUsdtCampaign(owner: string, incoming: Saved, notify = true) {
  const key = localKey(owner, usdtLiveCampaignId(incoming.campaign));
  let changed = false;
  const saved = await updateFishPreference<Saved>(key, previous => {
    let next = incoming;
    if (previous) {
      const { campaign: candidate } = incoming;
      const { campaign: existing } = previous;
      if (existing.closedAt && !candidate.closedAt || existing.fills.length > candidate.fills.length ||
        (!!existing.closedAt === !!candidate.closedAt && existing.fills.length === candidate.fills.length &&
          previous.observedAt > incoming.observedAt && (!candidate.followId || candidate.followId === existing.followId))) return previous;
      const followId = candidate.followId ?? existing.followId;
      if (existing.followId === followId && JSON.stringify(existing) === JSON.stringify(candidate)) {
        return incoming.synced && !previous.synced ? { ...previous, synced: true } : previous;
      }
      const management = candidate.management ?? existing.management;
      next = { ...incoming, campaign: { ...candidate, ...(followId ? { followId } : {}), ...(management ? { management } : {}) } };
      if (incoming.synced && (followId !== candidate.followId || management !== candidate.management)) next.synced = undefined;
    }
    changed = true;
    return next;
  });
  if (changed && notify) publishInstantCampaigns(owner);
  return saved;
}

export async function saveUsdtCampaignBatch(owner: string, campaigns: readonly UsdtLiveCampaign[], observedAt: number) {
  for (const campaign of campaigns) {
    const row = decodeSaved({ campaign, observedAt });
    if (!row) throw Error('币安实盘战役回报无效');
    await saveUsdtCampaign(owner, row);
  }
}

export async function syncClosedUsdtCampaigns(owner: string, signal: AbortSignal) {
  if (!navigator.onLine || signal.aborted) return;
  for (const row of await readUsdtCampaigns(owner, saved => !!saved.campaign.closedAt && !saved.synced)) {
    if (signal.aborted) return;
    const key = CLOUD + usdtLiveCampaignId(row.campaign);
    const result = await runAccountSyncRequest(() => table().upsert({
      user_id: owner, key, value: row, updated_at: new Date(row.observedAt).toISOString(),
    } as never, { onConflict: 'user_id,key' }).setHeader(INSTANT_CAMPAIGN_HEADER, '1'), { current: () => !signal.aborted });
    if (!result || signal.aborted) return;
    if (result.error) throw Error(result.error.message);
    await updateFishPreference<Saved>(localKey(owner, usdtLiveCampaignId(row.campaign)), previous =>
      previous?.observedAt === row.observedAt ? { ...previous, synced: true } : previous ?? { ...row, synced: true });
  }
}

function readCloud(owner: string, signal?: AbortSignal) {
  return table().select('key,value').eq('user_id', owner).setHeader(INSTANT_CAMPAIGN_HEADER, '1')
    .abortSignal(signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000));
}

export async function loadUsdtCampaign(owner: string, id: string, signal?: AbortSignal) {
  const [local] = await readFishPreferences<Saved>([localKey(owner, id)]).catch(() => [] as Saved[]);
  if (local) return local.campaign;
  const { data, error } = await readCloud(owner, signal).eq('key', CLOUD + id).maybeSingle();
  if (error) throw Error('币安实盘战役暂时无法读取');
  const decoded = decodeSaved((data as { value?: unknown } | undefined)?.value);
  if (!decoded || usdtLiveCampaignId(decoded.campaign) !== id) throw Error('找不到这场币安实盘战役');
  await saveUsdtCampaign(owner, { ...decoded, synced: true }, false).catch(() => undefined);
  return decoded.campaign;
}

export async function listCloudUsdtCampaigns(owner: string, signal?: AbortSignal) {
  const campaigns: UsdtLiveCampaign[] = [];
  let after: string | undefined;
  for (;;) {
    const query = readCloud(owner, signal).lt('key', CLOUD_END).order('key').limit(250);
    const { data, error } = await (after ? query.gt('key', after) : query.gte('key', CLOUD_START));
    if (error) throw Error('币安实盘战役云端暂未读完');
    const rows = (data ?? []) as { key: string; value: unknown }[];
    for (const row of rows) {
      const decoded = decodeSaved(row.value);
      if (!decoded?.campaign.closedAt || row.key !== CLOUD + usdtLiveCampaignId(decoded.campaign)) continue;
      campaigns.push(decoded.campaign);
      await saveUsdtCampaign(owner, { ...decoded, synced: true }, false).catch(() => undefined);
    }
    if (rows.length < 250) return campaigns;
    const key = rows.at(-1)?.key;
    if (!key || key === after) throw Error('币安实盘战役分页失效');
    after = key;
  }
}
