import { instantMonitorSize } from './instantMonitorExecution';
import { instantPositionInput } from './instantCampaign';
import { qualityAdditionFills } from './qualityAddition';
import type { FishCdaTracking, ScreenedFishAdmission } from '@/hooks/useFishCdaTracking';

export type UsdtFollowAction =
  | { id: string; at: number; action: 'open' | 'close' }
  | { id: string; at: number; action: 'add'; notional: number }
  | { id: string; at: number; action: 'mirror' | 'support-reduction' | 'manual-reduction'; fraction: number; atOpen?: boolean };
export interface UsdtFollowCampaign {
  id: string;
  source: { symbol: string; exchange?: string; market?: string };
  admittedAt: number;
  notional: number;
  leverage: number;
  actions: UsdtFollowAction[];
}
export interface UsdtFollowStatus {
  id: string;
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

function followCampaign({ record, round }: ScreenedFishAdmission, tracking: FishCdaTracking): UsdtFollowCampaign | undefined {
  const input = instantPositionInput(record, round);
  if (!input) return;
  const monitor = tracking.monitorResults?.get(record.id);
  const sale = tracking.alerts.get(record.id);
  const manual = sale?.manual ?? tracking.manualPositions?.get(record.id);
  const mirror = monitor?.mirrorFill ?? sale?.mirror ?? tracking.mirrorFills?.get(record.id);
  const size = instantMonitorSize(input.monitor);
  const actions: UsdtFollowAction[] = [{ id: 'open', at: input.buyAt, action: 'open' }];
  if (mirror) actions.push({ id: 'mirror', at: mirror.at, ...(mirror.fraction === 1
    ? { action: 'close' as const } : { action: 'mirror' as const, fraction: mirror.fraction, atOpen: mirror.atOpen }) });
  for (const [index, fill] of qualityAdditionFills(monitor ?? {}).entries()) {
    actions.push({ id: 'add-' + (index + 1), at: fill.at, action: 'add', notional: fill.notional });
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
  return { id: input.id, source: input.source, admittedAt: record.updatedAt,
    notional: 'notional' in size ? Number(size.notional) : size.marginUsdt * size.leverage, leverage: size.leverage, actions };
}

export function usdtFollowCampaigns(tracking: FishCdaTracking) {
  const campaigns = new Map<string, UsdtFollowCampaign>();
  for (const entry of [...(tracking.admitted ?? []), ...(tracking.localSales ?? [])]) {
    const campaign = followCampaign(entry, tracking);
    if (campaign) campaigns.set(campaign.id, campaign);
  }
  return [...campaigns.values()];
}
