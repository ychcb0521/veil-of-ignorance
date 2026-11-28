import { projectUsdtCampaignLegs } from './usdtCampaignLegs';
import { campaignStatusFromRealizedPnl } from '@/lib/campaignRealizedPnl';
import type { TradeCampaign } from '@/types/journal';
import type { QualityCampaignData } from './qualityCampaignProjection';
import { linkedUsdtEntryRiskPct, usdtLiveFillMetrics } from './usdtLiveCampaignMetrics';
import { usdtLiveCampaignId, type UsdtLiveCampaign } from './usdtLiveCampaign';

export function buildUsdtLiveCampaignData(owner: string, position: UsdtLiveCampaign, liveEntryRiskPct?: number | null): QualityCampaignData {
  const id = usdtLiveCampaignId(position);
  const opened = new Date(position.openedAt).toISOString();
  const closed = position.closedAt ? new Date(position.closedAt).toISOString() : null;
  const last = position.fills.at(-1)!;
  const updated = new Date(last.at).toISOString();
  const opening = position.fills[0];
  const { openingNotional: initialNotional, realized, net } = usdtLiveFillMetrics(position);
  const source = position.followId ? '系统跟单' : position.management ? '币安手动开仓 · 策略托管' : '币安开仓';
  const campaign: TradeCampaign = {
    id, user_id: owner, campaign_code: 'BN-' + opening.id, symbol: position.symbol,
    direction: position.direction === 'long' ? 'main_long' : 'main_short',
    status: closed ? campaignStatusFromRealizedPnl({ settled: true, total: net ?? realized }, closed) : 'active',
    strategy_template: 'main_only', title: position.symbol + ' · ' + source,
    opened_at: opened, closed_at: closed, initial_main_size_usdt: position.asset === 'USDT' ? initialNotional : null, initial_leverage: null,
    final_realized_pnl: position.asset === 'USDT' ? net : null, final_r_multiple: null, peak_unrealized_pnl: null, peak_drawdown: null,
    importance_weight: 0, notes: null, deviation_notes: {}, deleted_at: null, created_at: opened, updated_at: updated,
    actual_evolution: position.fills.map((fill, index) => ({
      id: id + '-' + fill.id, timestamp: new Date(fill.at).toISOString(), recorded_at: new Date(fill.at).toISOString(),
      event_type: fill.action !== 'reduce' ? 'main_opened' : index === position.fills.length - 1 && closed ? 'main_fully_closed' : 'main_partial_closed',
      leg_role: fill.action === 'open' ? 'main_open' : null, journal_id: null, trade_record_id: null,
      pending_order_id: null, price: Number(fill.price), size_usdt: position.asset === 'USDT' ? Number(fill.price) * Number(fill.positionQuantity) : null,
      ...(fill.action !== 'reduce' ? { entry_price: Number(fill.price) } : { exit_price: Number(fill.price) }), notes: null,
    })),
    comparison: { section: 'instant', runKey: id, sellKey: 'binance-live', sellLabel: '币安实盘', detectors: [],
      valuedAt: last.at, liveUsdt: position, ...(liveEntryRiskPct !== undefined ? { liveEntryRiskPct } : {}) },
  };
  return { campaign, ...projectUsdtCampaignLegs(owner, id, position), pendingOrders: [], reverseHedgeOrders: [], foreignLiveOrders: [], unfilledOrderIds: [],
    legExitPriceCorrections: {}, timelineDiagnostics: { mode: 'exact', timelineIds: [], anchorTimelineIds: [], unstampedAnchors: 0,
      missingAnchorNodes: [], verdicts: {}, disagreements: [] } };
}

export function mergeUsdtLiveCampaignRows(rows: QualityCampaignData[]) {
  const linked = new Set(rows.flatMap(row => row.campaign.comparison?.liveUsdt?.followId ?? []));
  const byId = new Map<string, QualityCampaignData>();
  for (const row of rows) {
    const previous = byId.get(row.campaign.id);
    const current = row.campaign.comparison?.liveUsdt, prior = previous?.campaign.comparison?.liveUsdt;
    if (current && prior && (prior.closedAt && !current.closedAt || prior.fills.length > current.fills.length)) continue;
    byId.set(row.campaign.id, row);
  }
  return [...byId.values()].filter(row => !linked.has(row.campaign.id)).map(row => {
    const comparison = row.campaign.comparison;
    const live = comparison?.liveUsdt;
    if (!live?.followId) return row;
    const percent = linkedUsdtEntryRiskPct(live, row.campaign.user_id, byId.get(live.followId)?.campaign);
    return percent === undefined ? row : { ...row, campaign: { ...row.campaign, comparison: { ...comparison, liveEntryRiskPct: percent } } };
  });
}
