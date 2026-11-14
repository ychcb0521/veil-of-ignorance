import { campaignStatusFromRealizedPnl } from '@/lib/campaignRealizedPnl';
import type { TradeRecord } from '@/types/trading';
import type { CampaignEvent } from '@/types/journal';
import type { additionPosition } from './qualityAddition';
import type { QualityCampaignData } from './qualityCampaignProjection';
import { instantManualReason, type InstantManualExecution, type InstantManualFill } from './instantManualExecution';

type Valuation = ReturnType<typeof additionPosition>;

export function valueInstantManualFills(base: Valuation, mark: number, fills: readonly InstantManualFill[] = []) {
  if (!fills.length) return base;
  let { remainingQuantity, remainingCost, realizedPnl } = base;
  for (const fill of fills) {
    realizedPnl += (remainingQuantity * fill.price - remainingCost) * fill.fraction;
    remainingQuantity *= 1 - fill.fraction;
    remainingCost *= 1 - fill.fraction;
  }
  const remainingPnl = remainingQuantity * mark - remainingCost;
  const totalPnl = realizedPnl + remainingPnl;
  return { ...base, remainingQuantity, remainingCost, realizedPnl, remainingPnl, totalPnl,
    returnPct: totalPnl / base.totalInvested * 100 };
}

/** Attribute each later discretionary sale to the remaining coins of each actual acquisition. */
export function projectInstantManualFills(data: QualityCampaignData, manual: InstantManualExecution, base: Valuation, valuedAt: number, buyAt: number): QualityCampaignData {
  const { campaign } = data;
  const comparison = campaign.comparison!;
  const instant = comparison.instant!;
  const last = manual.fills.at(-1);
  const closed = last?.fraction === 1;
  const iso = (at: number) => new Date(at).toISOString();
  const closedAt = closed ? iso(last.at) : null;
  const held = valueInstantManualFills(base, last?.price ?? base.averageEntryPrice, manual.fills);
  const tradeRecords = [...data.tradeRecords];
  const events = campaign.actual_evolution.map(event => ({ ...event }));
  const legs = data.legs.map(leg => {
    const opening = events.find(event => event.journal_id === leg.id && event.event_type === 'main_opened');
    const { pre_entry_price: entry, pre_position_size: cost } = leg;
    if (!opening || !(entry && entry > 0 && cost && cost > 0) || !manual.fills.length) return leg;
    const positionId = leg.trade_record_id ?? leg.id + '-position';
    const previous = tradeRecords.filter(record => record.positionId === positionId || record.id === positionId);
    let remaining = Math.max(0, cost / entry - previous.reduce((sum, record) => sum + record.quantity, 0));
    if (remaining <= Number.EPSILON * Math.max(1, cost / entry)) return leg;
    opening.trade_record_id = positionId;
    let realized = previous.reduce((sum, record) => sum + record.pnl, 0);
    for (const [index, fill] of manual.fills.entries()) {
      const quantity = remaining * fill.fraction;
      const pnl = quantity * (fill.price - entry);
      const id = leg.id + '-manual-' + (index + 1);
      const reason = instantManualReason(fill.reason);
      const openTime = Date.parse(opening.timestamp);
      const record: TradeRecord = {
        id, positionId, symbol: campaign.symbol, side: 'LONG', type: 'MARKET', action: 'CLOSE',
        entryPrice: entry, exitPrice: fill.price, quantity, leverage: leg.leverage ?? campaign.initial_leverage ?? 1,
        settlementMode: 'usdt', settlementAsset: 'USDT', pnl, fee: 0, openFeeUsd: 0, openFeeRate: 0, closeFeeRate: 0, slippage: 0,
        openTime, openedRealAt: openTime, closeTime: fill.at, closedRealAt: fill.at, operationAt: fill.at, exit_reason_text: reason,
      };
      const event: CampaignEvent = {
        ...opening, id, trade_record_id: id, timestamp: iso(fill.at), recorded_at: iso(fill.at),
        event_type: fill.fraction === 1 ? 'main_fully_closed' : 'main_partial_closed',
        price: fill.price, close_time: iso(fill.at), exit_price: fill.price, size_usdt: quantity * entry,
        realized_pnl: pnl, notes: reason,
      };
      tradeRecords.push(record);
      events.push(event);
      remaining -= quantity;
      realized += pnl;
    }
    return {
      ...leg, trade_record_id: positionId, post_realized_pnl: realized,
      post_outcome: closed ? realized > 0 ? 'win' as const : realized < 0 ? 'loss' as const : 'breakeven' as const : null,
      post_simulated_close_time: closedAt, post_real_close_time: closedAt,
      post_exit_price_snapshot: closed ? last.price : null,
    };
  });
  const pnl = closed ? held.realizedPnl : null;
  return {
    ...data, legs, tradeRecords,
    campaign: {
      ...campaign, status: closed ? campaignStatusFromRealizedPnl({ settled: true, total: pnl }, closedAt) : 'active',
      closed_at: closedAt, final_realized_pnl: pnl, updated_at: iso(valuedAt),
      actual_evolution: events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)),
      comparison: {
        ...comparison, valuedAt,
        holdingMetrics: {
          ...comparison.holdingMetrics!, status: closed ? 'closed' : 'open',
          returnPct: pnl == null ? null : pnl / instant.marginUsdt * 100,
          remainingPnl: closed ? held.realizedPnl - base.realizedPnl : undefined,
        },
        sellEvidence: comparison.sellEvidence && closed ? {
          ...comparison.sellEvidence, exitReason: instantManualReason(last.reason), executedAt: last.at,
        } : comparison.sellEvidence,
        instant: {
          ...instant, manual,
          openPosition: closed ? undefined : { buyAt, quantity: held.remainingQuantity, cost: held.remainingCost, realizedPnl: held.realizedPnl },
        },
      },
    },
  };
}
