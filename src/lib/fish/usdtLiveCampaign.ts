import type { UsdtMirrorFill, UsdtMirrorSide } from './usdtPositionMirror';
import type { UsdtFollowStatus } from './usdtFollow';
import type { BinanceManualPosition } from './binanceManualMonitor';

export type UsdtCampaignFill = UsdtMirrorFill & {
  realized: number;
  commission: number;
  commissionAsset: string;
};

export interface UsdtLiveCampaign {
  symbol: string;
  positionSide: UsdtMirrorSide;
  direction: 'long' | 'short';
  asset: string;
  openedAt: number;
  closedAt?: number;
  quantity: string;
  fills: UsdtCampaignFill[];
  followId?: string;
  management?: Pick<BinanceManualPosition, 'version' | 'monitor' | 'armedAt'> & {
    exitReason?: string;
    switches?: import('./instantMonitorSwitchCheckpoint').InstantMonitorSwitch[];
  };
}

export interface UsdtCampaignBatch {
  observedAt: number;
  campaigns: UsdtLiveCampaign[];
  incomplete?: boolean;
}

export const usdtLiveCampaignId = (campaign: Pick<UsdtLiveCampaign, 'symbol' | 'positionSide' | 'direction'> &
  { fills: readonly Pick<UsdtCampaignFill, 'id' | 'orderId'>[] }) =>
  ['fish-instant-live', campaign.symbol, campaign.positionSide, campaign.direction, campaign.fills[0].id, campaign.fills[0].orderId].join('-');

export const isUsdtLiveCampaignId = (id?: string) => /^fish-instant-live-[A-Z0-9_]+-(?:BOTH|LONG|SHORT)-(?:long|short)-\d+-\d+$/.test(id ?? '');

export function findUsdtCampaignFollow(campaign: UsdtLiveCampaign, statuses: readonly UsdtFollowStatus[]) {
  const opening = campaign.fills[0];
  return statuses.find(status => (status.market ?? status.symbol.replace(/\//g, '')) === campaign.symbol &&
    status.executions?.some(execution => execution.actionId === 'open' && execution.orderId === opening.orderId &&
      execution.fills.some(fill => fill.id === opening.id)));
}

export function usdtCampaignAmounts(campaign: UsdtLiveCampaign) {
  let realized = 0;
  const fees = new Map<string, number>();
  for (const fill of campaign.fills) {
    realized += fill.realized;
    fees.set(fill.commissionAsset, (fees.get(fill.commissionAsset) ?? 0) + fill.commission);
  }
  return { realized, fees, net: [...fees].every(([asset, amount]) => asset === campaign.asset || amount === 0)
    ? realized - (fees.get(campaign.asset) ?? 0) : null };
}
