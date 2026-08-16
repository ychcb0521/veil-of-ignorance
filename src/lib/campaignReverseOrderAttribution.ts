import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder } from '@/types/trading';
import { pickPrimaryMainLeg } from '@/lib/campaignPrimaryMainLeg';

function sequence(leg: TradeJournal): number {
  return leg.leg_sequence ?? Number.MAX_SAFE_INTEGER;
}

function isMainLeg(leg: TradeJournal): boolean {
  return (
    leg.leg_role === 'main_open'
    || leg.leg_role === 'reentry_main'
    || Boolean(leg.leg_role?.startsWith('main_add_'))
    || (leg.order_kind === 'main' && leg.leg_role !== 'mirror_tp')
  );
}

function isHedgeLeg(leg: TradeJournal): boolean {
  return (
    leg.leg_role === 'hedge_initial_a'
    || leg.leg_role === 'hedge_initial_b'
    || leg.leg_role === 'hedge_rolling'
    || leg.leg_role === 'reentry_hedge'
    || (leg.order_kind === 'hedge' && leg.leg_role !== 'mirror_tp')
  );
}

function timeMs(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const result = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

function triggeredHedgeMatchScore(
  leg: TradeJournal,
  order: CampaignReverseHedgeOrder,
): number {
  const legTime = timeMs(leg.pre_simulated_time);
  const orderTime = timeMs(order.triggeredAt);
  const timeScore = legTime != null && orderTime != null
    ? Math.abs(legTime - orderTime)
    : Number.MAX_SAFE_INTEGER / 2;
  const legPrice = leg.pre_entry_price;
  const orderPrice = order.fillPrice ?? order.price;
  const priceScore = legPrice != null && Number.isFinite(legPrice) && Number.isFinite(orderPrice)
    ? Math.abs(legPrice - orderPrice) / Math.max(Math.abs(orderPrice), 1e-12)
    : 1;
  return timeScore + priceScore * 60_000;
}

/**
 * Pending/cancelled reverse orders protect the main exposure. Once an order
 * triggers, the resulting reverse position belongs to its corresponding hedge
 * leg. Mirror-TP legs never own reverse orders.
 */
export function buildCampaignReverseOrderLegMap(
  legs: TradeJournal[],
  reverseHedgeOrders: CampaignReverseHedgeOrder[],
): Map<string, string> {
  const orderedMainLegs = legs.filter(isMainLeg).sort((a, b) => sequence(a) - sequence(b));
  // 反向委托保护的是主力敞口，因此挂在名义金额最大的那笔主仓名下，
  // 而不是序号最小的那笔（残仓排在前面会让整列委托都归错 leg）。
  const ownerLeg = pickPrimaryMainLeg(orderedMainLegs) ?? orderedMainLegs[0] ?? null;
  const hedgeLegs = legs.filter(isHedgeLeg).sort((a, b) => sequence(a) - sequence(b));
  const result = new Map<string, string>();

  for (const order of reverseHedgeOrders) {
    if (order.status === 'triggered' && hedgeLegs.length > 0) {
      const exactHedge = order.tradeRecordId
        ? hedgeLegs.find(leg =>
          leg.trade_record_id === order.tradeRecordId
          || leg.trade_record_id === order.id
        )
        : null;
      const matchedHedge = exactHedge ?? [...hedgeLegs].sort(
        (a, b) => triggeredHedgeMatchScore(a, order) - triggeredHedgeMatchScore(b, order),
      )[0];
      if (matchedHedge) {
        result.set(order.id, matchedHedge.id);
        continue;
      }
    }
    if (ownerLeg) result.set(order.id, ownerLeg.id);
  }

  return result;
}
