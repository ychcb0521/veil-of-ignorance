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
  const fillPrice = order.fillPrice ?? order.price;
  return tradeRecords
    .filter(record =>
      record.side === order.side &&
      Math.abs(record.openTime - triggeredAt) <= REVERSE_ORDER_RECORD_MATCH_MS &&
      (closeEnoughPrice(record.entryPrice, fillPrice) || closeEnoughPrice(record.entryPrice, order.price))
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
  return Array.from(result.values()).sort((a, b) =>
    Number(Boolean(b.dashed)) - Number(Boolean(a.dashed))
    || a.startTime - b.startTime
    || a.endTime - b.endTime
  );
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

/** 对冲空单腿：对冲类角色、方向为空。 */
export function isHedgeShortLeg(leg: { leg_role?: string | null; direction?: string | null }): boolean {
  const role = leg.leg_role ?? '';
  return leg.direction === 'short' && (role.startsWith('hedge_') || role === 'reentry_hedge');
}

/** 画一条手动对冲空单所需的最少信息：已成交的开平时刻与开仓价。 */
export interface HedgeShortLegExecution {
  legId: string;
  recordId: string | null;
  openTime: number | null;
  closeTime: number | null;
  entryPrice: number | null;
}

interface TriggeredOrderMatch {
  order: CampaignReverseHedgeOrder;
  recordId: string | null;
}

/** 这条腿是不是某张被触发的委托空单开出来的——与 findReverseOrderTradeRecord 同一套口径。 */
function isOpenedByTriggeredOrder(leg: HedgeShortLegExecution, triggered: TriggeredOrderMatch[]): boolean {
  for (const { order, recordId } of triggered) {
    if (leg.recordId && (leg.recordId === recordId || leg.recordId === order.tradeRecordId)) return true;
    if (leg.openTime == null || leg.entryPrice == null) continue;
    const triggeredAt = order.triggeredAt ?? order.createdAt;
    if (Math.abs(leg.openTime - triggeredAt) > REVERSE_ORDER_RECORD_MATCH_MS) continue;
    const fillPrice = order.fillPrice ?? order.price;
    if (closeEnoughPrice(leg.entryPrice, fillPrice) || closeEnoughPrice(leg.entryPrice, order.price)) return true;
  }
  return false;
}

/**
 * 手动开的对冲空单：与被触发的委托空单同一个目的（给主仓做反向保护），只是由人按下、
 * 而不是价格走到委托价自动触发。所以画法照「触发空」——黄色实线，从开仓到平仓；
 * 价位取实际开仓价（手动单没有委托价可言），标题「手动空」。
 *
 * 由委托触发开出的对冲腿不再画，它已有自己的「触发空」。判定用全部可显示的委托：
 * 用户在盘面上隐藏某张委托，不会让它开出的那条腿冒充成手动单。
 */
export function buildManualHedgeShortPriceLines(
  legs: HedgeShortLegExecution[],
  orders: CampaignReverseHedgeOrder[],
  tradeRecords: TradeRecord[],
  fallbackEnd: number,
): TimeBoundPriceLine[] {
  const triggered: TriggeredOrderMatch[] = orders
    .filter(order => isDisplayableReverseHedgeOrder(order) && order.status === 'triggered')
    .map(order => ({ order, recordId: findReverseOrderTradeRecord(order, tradeRecords)?.id ?? null }));
  const lines: TimeBoundPriceLine[] = [];
  for (const leg of legs) {
    const { openTime, closeTime, entryPrice } = leg;
    if (openTime == null || !Number.isFinite(openTime)) continue;
    if (entryPrice == null || !Number.isFinite(entryPrice) || entryPrice <= 0) continue;
    // 平仓时刻早于开仓是坏数据：不画，也不拿战役结束去补一条错的线。
    if (closeTime != null && !(closeTime > openTime)) continue;
    if (isOpenedByTriggeredOrder(leg, triggered)) continue;
    lines.push({
      price: entryPrice,
      color: '#F0B90B',
      startTime: openTime,
      endTime: closeTime ?? fallbackEnd,
      dashed: false,
      endMarker: null,
      title: '手动空',
    });
  }
  return dedupeReverseOrderLines(lines);
}
