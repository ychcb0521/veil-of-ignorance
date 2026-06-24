import type { TimeBoundPriceLine } from '@/components/journal/ReplayCandleChart';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

const REVERSE_ORDER_RECORD_MATCH_MS = 60_000;

export function isDisplayableReverseHedgeOrder(order: CampaignReverseHedgeOrder) {
  return order.side === 'SHORT' && Number.isFinite(order.price) && order.price > 0;
}

function closeEnoughPrice(a: number, b: number) {
  return Math.abs(a - b) <= Math.max(1e-8, Math.max(Math.abs(a), Math.abs(b), 1) * 1e-6);
}

function findReverseOrderTradeRecord(order: CampaignReverseHedgeOrder, tradeRecords: TradeRecord[]) {
  if (order.tradeRecordId) {
    const byId = tradeRecords.find(record => record.id === order.tradeRecordId);
    if (byId) return byId;
  }
  const triggeredAt = order.triggeredAt ?? order.createdAt;
  return tradeRecords
    .filter(record =>
      record.side === order.side &&
      Math.abs(record.openTime - triggeredAt) <= REVERSE_ORDER_RECORD_MATCH_MS &&
      closeEnoughPrice(record.entryPrice, order.price)
    )
    .sort((a, b) => Math.abs(a.openTime - triggeredAt) - Math.abs(b.openTime - triggeredAt))[0] ?? null;
}

function dedupeReverseOrderLines(lines: TimeBoundPriceLine[]) {
  const result = new Map<string, TimeBoundPriceLine>();
  for (const line of lines) {
    if (!Number.isFinite(line.startTime) || !Number.isFinite(line.endTime) || line.endTime <= line.startTime) continue;
    const key = [
      Math.round(line.price * 1e8),
      Math.round(line.startTime / 1000),
      Math.round(line.endTime / 1000),
      line.dashed ? 'd' : 's',
      line.endMarker ?? '',
      line.title ?? '',
    ].join(':');
    if (!result.has(key)) result.set(key, line);
  }
  return Array.from(result.values()).sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
}

export function buildCampaignReverseOrderPriceLines(
  orders: CampaignReverseHedgeOrder[],
  tradeRecords: TradeRecord[],
  fallbackEnd: number,
): TimeBoundPriceLine[] {
  const segments = orders
    .filter(isDisplayableReverseHedgeOrder)
    .flatMap(order => {
      if (order.status === 'triggered') {
        const triggeredAt = order.triggeredAt ?? order.createdAt;
        const matchedRecord = findReverseOrderTradeRecord(order, tradeRecords);
        const explicitEndTime = order.cancelledAt
          ?? (matchedRecord?.closeTime && matchedRecord.closeTime > triggeredAt ? matchedRecord.closeTime : null);
        const endTime = explicitEndTime != null && explicitEndTime > triggeredAt ? explicitEndTime : fallbackEnd;
        const lines: TimeBoundPriceLine[] = [];
        if (Number.isFinite(triggeredAt) && triggeredAt > order.createdAt) {
          lines.push({
            price: order.price,
            color: '#F0B90B',
            startTime: order.createdAt,
            endTime: triggeredAt,
            dashed: true,
            endMarker: null,
            title: '委托空',
          });
        }
        if (Number.isFinite(endTime) && endTime > triggeredAt) {
          lines.push({
            price: order.price,
            color: '#F0B90B',
            startTime: Math.max(order.createdAt, triggeredAt),
            endTime,
            dashed: false,
            endMarker: null,
            title: '触发空',
          });
        }
        return lines;
      }
      return {
        price: order.price,
        color: '#F0B90B',
        startTime: order.createdAt,
        endTime: order.cancelledAt ?? fallbackEnd,
        dashed: true,
        endMarker: order.status === 'cancelled' && order.cancelledAt ? ('x' as const) : null,
        title: '委托空',
      };
    });

  return dedupeReverseOrderLines(segments);
}
