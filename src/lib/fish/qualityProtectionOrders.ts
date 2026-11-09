import { qualityAdditionStopOrders } from './qualityAdditionStopOrder';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder } from '@/types/trading';

export interface QualityProtectionOrder extends CampaignReverseHedgeOrder {
  protectionLabel: string;
  protectionDetail: string;
}
/** Chart-only projection of the SAME saved K/K′/F orders shown in Legs.
 * Never insert these into actual orders, short positions, PnL or risk inputs.
 * No market replay or current template is used to invent missing history. */
export function qualityProtectionOrders(campaign: TradeCampaign | null | undefined, legs: readonly TradeJournal[]): QualityProtectionOrder[] {
  if (!campaign?.comparison) return [];
  const orders = new Map<string, QualityProtectionOrder>();
  const cause = campaign.comparison.sellEvidence?.triggerCause;
  for (const leg of legs) {
    for (const stop of qualityAdditionStopOrders(leg, campaign)) {
      for (const [kind, price] of [['K', stop.price], ['F', stop.floor]] as const) {
        if (!(price! > 0) || !Number.isFinite(price) || !Number.isFinite(stop.placedAt)
          || stop.endedAt != null && (!Number.isFinite(stop.endedAt) || stop.endedAt < stop.placedAt)) continue;
        if (kind === 'F' && price === stop.price) continue;
        const id = `${campaign.id}:protection:${kind}:${stop.placedAt}:${price}`;
        const triggered = stop.status === 'triggered' && cause?.kind === 'addition-support'
          && Math.abs(cause.threshold - price!) <= Math.max(1e-12, price! * 1e-9);
        orders.set(id, {id, side:'SHORT', price:price!, createdAt:stop.placedAt,
          status:triggered?'triggered':stop.status==='pending'?'pending':'cancelled',
          triggeredAt:triggered?stop.endedAt:null, cancelledAt:stop.endedAt,
          protectionLabel:kind==='F'?'保本底线 F':stop.label,
          protectionDetail:stop.detail,
        });
      }
    }
  }
  return [...orders.values()].sort((a,b)=>a.createdAt-b.createdAt || a.id.localeCompare(b.id));
}
