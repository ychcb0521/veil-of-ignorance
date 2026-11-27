import {shortFishHash} from './algorithm';
import { instantMonitorSize } from './instantMonitorExecution';
import { instantPositionInput } from './instantCampaign';
import { qualityAdditionFills } from './qualityAddition';
import type { FishCdaTracking, ScreenedFishAdmission } from '@/hooks/useFishCdaTracking';
import type { QualityGroup, QualityResult } from './quality';
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
    .some(rule=>!!rule.classifiedImpulsePositions?.length||!!rule.impulse1115Position||rule.source==='structure'&&!!rule.structure?.guardPlusVersion);
}

/** Only a complete, same-boundary monitor decision may enter the live action queue. */
export function openingImpulseFill(monitor?: QualityResult) {
  const decision=monitor?.openingImpulseDecision;
  if (!monitor || monitor.status!=='open' || monitor.pendingExit || decision?.version!=='binance-impulse-open-v1') return;
  const fill=decision.fill, event=fill?.structureEvidence?.guardPlus?.early_impulse_event;
  if (!event?.impulse_id || fill.at!==monitor.endTime || event.available_at!==fill.at || event.fresh_until!==fill.at+300_000 ||
      ![fill.price,fill.quantity,fill.notional].every(value=>Number.isFinite(value)&&value>0) ||
      qualityAdditionFills(monitor).some(prior=>prior.at>=fill.at || prior.structureEvidence?.guardPlus?.early_impulse_event?.impulse_id===event.impulse_id)) return;
  return fill;
}

function followCampaign({ record, round }: ScreenedFishAdmission, tracking: FishCdaTracking): UsdtFollowCampaign | undefined {
  const input = instantPositionInput(record, round);
  if (!input) return;
  const monitor = tracking.monitorResults?.get(record.id);
  const sale = tracking.alerts.get(record.id);
  const manual = sale?.manual ?? tracking.manualPositions?.get(record.id);
  const mirror = monitor?.mirrorFill ?? sale?.mirror ?? tracking.mirrorFills?.get(record.id);
  const size = instantMonitorSize(input.monitor, input.instantPosition);
  const frozen = input.monitor;
  const sizing = 'notional' in size ? size : undefined;
  let liveEntry: UsdtLiveEntry | undefined;
  if ((!input.instantPosition || input.instantPosition.balanceObservedAt) && round.instantTrading && round.liveCapturedAt !== undefined && frozen?.version === INSTANT_TEMPLATE_MONITOR &&
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
  const opening=!sale && !manual && mirror?.fraction!==1 ? openingImpulseFill(monitor) : undefined;
  const fills=qualityAdditionFills(monitor ?? {});
  for (const [index, fill] of (opening ? [...fills,opening] : fills).entries()) {
    const impulse=fill.structureEvidence?.guardPlus?.early_impulse_event,classified=fill.structureEvidence?.impulseClassification;
    actions.push({ id: classified?'add-class-'+shortFishHash(fill.structureEvidence!.eventId):impulse?'add-'+impulse.impulse_id:'add-' + (index + 1), at: fill.at, action: 'add', notional: fill.notional,
      ...(classified?{impulseFreshUntil:classified.confirmedAt+300000}:impulse?{impulseFreshUntil:impulse.fresh_until}:{}) });
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
    ...((opening || usesGuardPlus(input.monitor?.plan) || usesGuardPlus(monitor?.instantMonitorSwitches?.at(-1)?.to.plan))?{requiresGuardPlus:true}:{}),
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
