import { instantMonitorSize } from './instantMonitorExecution';
import { instantPositionInput } from './instantCampaign';
import { qualityAdditionFills } from './qualityAddition';
import type { FishCdaTracking, ScreenedFishAdmission } from '@/hooks/useFishCdaTracking';
import type { QualityGroup } from './quality';
import { INSTANT_TEMPLATE_MONITOR, instantMonitorTemplateIssue } from './instantMonitorSettings';
import { isLegacyQualityPlan } from './qualityLegacyEngine';
import { validUsdtLiveEntry, type UsdtLiveEntry } from './usdtLiveEntry';
import type { UsdtFrozenMonitor } from './usdtFrozenMonitor';

export type UsdtFollowAction =
  | { id: string; at: number; action: 'open' | 'close' }
  | { id: string; at: number; action: 'add'; notional: number; impulseFreshUntil?: number }
  | { id: string; at: number; action: 'mirror' | 'support-reduction' | 'manual-reduction'; fraction: number; atOpen?: boolean };
export interface UsdtFollowCampaign {
  id: string;
  source: { symbol: string; exchange?: string; market?: string };
  admittedAt: number;
  notional: number;
  leverage: number;
  liveEntry?: UsdtLiveEntry;
  requiresGuardPlus?: true;
  frozenMonitor?: UsdtFrozenMonitor;
  actions: UsdtFollowAction[];
}
export interface UsdtFollowStatus {
  id: string;
  followMonitorTemplateId?: string;
  canSwitchFollowMonitor?: boolean;
  symbol: string;
  state: 'ignored' | 'waiting' | 'blocked' | 'tracking' | 'closed';
  market?: string;
  asset?: string;
  quantity?: number;
  entryPrice?: number;
  realizedUsdt?: number;
  feeUsdt?: number;
  feesByAsset?: Record<string, number>;
  limitUsdt?: number;
  orderId?: string;
  issue?: string;
  executions?: { actionId: string; orderId: string; side: 'BUY' | 'SELL';
    fills: { id: string; at: number; price: number; quantity: number; realized: number; commission: number; commissionAsset: string }[] }[];
}

function usesGuardPlus(plan?: QualityGroup): boolean {
  if(plan?.router)return usesGuardPlus(plan.router.structure)||usesGuardPlus(plan.router.attack);
  const addition=plan?.addition;
  return !!addition?.enabled&&[...(addition.rounds?.length?addition.rounds:[addition]),...(addition.alternativeRounds??[])]
    .some(rule=>!!rule.impulse1115Position||rule.source==='structure'&&!!rule.structure?.guardPlusVersion);
}

function followCampaign({ record, round }: ScreenedFishAdmission, tracking: FishCdaTracking): UsdtFollowCampaign | undefined {
  const input = instantPositionInput(record, round);
  if (!input) return;
  const monitor = tracking.monitorResults?.get(record.id);
  const sale = tracking.alerts.get(record.id);
  const manual = sale?.manual ?? tracking.manualPositions?.get(record.id);
  const mirror = monitor?.mirrorFill ?? sale?.mirror ?? tracking.mirrorFills?.get(record.id);
  const size = instantMonitorSize(input.monitor);
  const frozen = input.monitor, sizing = frozen?.plan.positionManagement;
  let liveEntry: UsdtLiveEntry | undefined;
  if (round.instantTrading && round.liveCapturedAt !== undefined && frozen?.version === INSTANT_TEMPLATE_MONITOR &&
    sizing && !isLegacyQualityPlan(frozen.plan)) {
    try {
      if (!instantMonitorTemplateIssue({ id: frozen.templateId, name: frozen.name, plan: frozen.plan })) {
        liveEntry = { version: 1, capturedAt: round.liveCapturedAt, templateId: frozen.templateId,
          notional: sizing.notional, leverage: sizing.leverage };
      }
    } catch { /* Invalid historical template data cannot authorize a live entry. */ }
  }
  const actions: UsdtFollowAction[] = [{ id: 'open', at: input.buyAt, action: 'open' }];
  if (mirror) actions.push({ id: 'mirror', at: mirror.at, ...(mirror.fraction === 1
    ? { action: 'close' as const } : { action: 'mirror' as const, fraction: mirror.fraction, atOpen: mirror.atOpen }) });
  for (const [index, fill] of qualityAdditionFills(monitor ?? {}).entries()) {
    const impulse=fill.structureEvidence?.guardPlus?.early_impulse_event;
    actions.push({ id: impulse?'add-'+impulse.impulse_id:'add-' + (index + 1), at: fill.at, action: 'add', notional: fill.notional,
      ...(impulse?{impulseFreshUntil:impulse.fresh_until}:{}) });
  }
  for (const [index, fill] of (monitor?.additionReductions ?? []).entries()) {
    actions.push({ id: 'support-' + (index + 1), at: fill.at, action: 'support-reduction', fraction: fill.fraction });
  }
  for (const [index, fill] of (manual?.fills ?? []).entries()) {
    actions.push({ id: 'manual-' + (index + 1), at: fill.at, ...(fill.fraction === 1
      ? { action: 'close' as const } : { action: 'manual-reduction' as const, fraction: fill.fraction }) });
  }
  if (sale && mirror?.fraction !== 1 && !manual?.fills.some(fill => fill.fraction === 1)) {
    actions.push({ id: 'close', at: sale.at, action: 'close' });
  }
  // Within a minute a support reduction precedes its successor addition.
  const priority = { open: 0, 'support-reduction': 2, add: 3, mirror: 4, 'manual-reduction': 5, close: 6 };
  const order = (action: UsdtFollowAction) => action.action === 'mirror' && action.atOpen ? 1 : priority[action.action];
  actions.sort((a, b) => a.at - b.at || order(a) - order(b));
  const campaign: UsdtFollowCampaign = { id: input.id, source: input.source, admittedAt: record.updatedAt,
    notional: 'notional' in size ? Number(size.notional) : size.marginUsdt * size.leverage, leverage: size.leverage, actions,
    ...(usesGuardPlus(input.monitor?.plan)?{requiresGuardPlus:true}:{}),
    ...(input.monitor ? { frozenMonitor: { version: 1, admission: { record, round }, checkpoint: monitor,
      manual, mirror, sale } as UsdtFrozenMonitor } : {}) };
  return validUsdtLiveEntry({ ...campaign, liveEntry }) ? { ...campaign, liveEntry } : campaign;
}

export function currentUsdtFollowCampaign(campaign:UsdtFollowCampaign, supportsGuardPlus:boolean, now:number):UsdtFollowCampaign|undefined {
  if(campaign.requiresGuardPlus&&!supportsGuardPlus)return;
  if(!campaign.requiresGuardPlus)return campaign;
  return {...campaign,actions:campaign.actions.filter(action=>action.action!=='add'||action.impulseFreshUntil===undefined||
    action.at<=now&&now<action.impulseFreshUntil)};
}

export function usdtFollowCampaigns(tracking: FishCdaTracking) {
  const campaigns = new Map<string, UsdtFollowCampaign>();
  for (const entry of [...(tracking.admitted ?? []), ...(tracking.localSales ?? [])]) {
    const campaign = followCampaign(entry, tracking);
    if (campaign) campaigns.set(campaign.id, campaign);
  }
  return [...campaigns.values()];
}
