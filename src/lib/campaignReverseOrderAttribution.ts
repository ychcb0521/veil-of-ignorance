import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder } from '@/types/trading';

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

/**
 * Reverse orders protect the main exposure. They must never be presented as
 * orders belonging to a mirror-TP or hedge leg, even when legacy records share
 * a trade-record/position id with those legs.
 */
export function buildCampaignReverseOrderLegMap(
  legs: TradeJournal[],
  reverseHedgeOrders: CampaignReverseHedgeOrder[],
): Map<string, string> {
  const orderedMainLegs = legs.filter(isMainLeg).sort((a, b) => sequence(a) - sequence(b));
  const ownerLeg = orderedMainLegs.find(leg => leg.leg_role === 'main_open') ?? orderedMainLegs[0] ?? null;
  if (!ownerLeg) return new Map();
  return new Map(reverseHedgeOrders.map(order => [order.id, ownerLeg.id]));
}
