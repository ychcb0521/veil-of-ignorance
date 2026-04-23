import type { OrderSide, PendingOrder } from '@/types/trading';

interface ConditionalTriggerDecision {
  currentPriceNum: number;
  triggerPriceNum: number;
  triggered: boolean;
}

interface ConditionalTriggerRange {
  high: number;
  low: number;
}

type LegacyConditionalOrder = PendingOrder & {
  direction?: string;
  triggerPrice?: number | string;
  side?: PendingOrder['side'] | 'BUY' | 'SELL' | 'buy' | 'sell' | 'long' | 'short';
  type?: PendingOrder['type'] | string;
  status?: PendingOrder['status'] | string;
};

function normalizeConditionalDirection(direction?: string): OrderSide | null {
  const normalized = direction?.toUpperCase();

  if (normalized === 'LONG' || normalized === 'BUY') return 'LONG';
  if (normalized === 'SHORT' || normalized === 'SELL') return 'SHORT';

  return null;
}

function getLegacyConditionalOrder(order: PendingOrder): LegacyConditionalOrder {
  return order as LegacyConditionalOrder;
}

export function resolveConditionalOrderSide(order: PendingOrder): OrderSide | null {
  const legacyOrder = getLegacyConditionalOrder(order);
  return normalizeConditionalDirection(legacyOrder.direction ?? legacyOrder.side);
}

export function resolveConditionalTriggerPrice(order: PendingOrder): number {
  const legacyOrder = getLegacyConditionalOrder(order);
  return Number(legacyOrder.triggerPrice ?? legacyOrder.stopPrice);
}

export function isConditionalPendingOrder(order: PendingOrder): boolean {
  const legacyOrder = getLegacyConditionalOrder(order);
  return String(legacyOrder.type ?? '').toUpperCase() === 'CONDITIONAL'
    && String(legacyOrder.status ?? '').toUpperCase() === 'PENDING';
}

export function getConditionalTriggerDecisionForPrices(
  side: OrderSide,
  latestPrice: number,
  triggerPrice: number,
): ConditionalTriggerDecision | null {
  const currentPriceNum = Number(latestPrice);
  const triggerPriceNum = Number(triggerPrice);

  if (!Number.isFinite(currentPriceNum) || !Number.isFinite(triggerPriceNum)) {
    return null;
  }

  const triggered = side === 'LONG'
    ? currentPriceNum >= triggerPriceNum
    : currentPriceNum <= triggerPriceNum;

  return {
    currentPriceNum,
    triggerPriceNum,
    triggered,
  };
}

export function getConditionalTriggerDecisionForRange(
  side: OrderSide,
  triggerPrice: number,
  range: ConditionalTriggerRange,
): ConditionalTriggerDecision | null {
  const highNum = Number(range.high);
  const lowNum = Number(range.low);
  const triggerPriceNum = Number(triggerPrice);

  if (!Number.isFinite(highNum) || !Number.isFinite(lowNum) || !Number.isFinite(triggerPriceNum)) {
    return null;
  }

  const triggered = side === 'LONG'
    ? highNum >= triggerPriceNum
    : lowNum <= triggerPriceNum;

  return {
    currentPriceNum: side === 'LONG' ? highNum : lowNum,
    triggerPriceNum,
    triggered,
  };
}

export function shouldRejectImmediateConditionalPlacement(
  side: OrderSide,
  latestPrice: number,
  triggerPrice: number,
): boolean {
  return getConditionalTriggerDecisionForPrices(side, latestPrice, triggerPrice)?.triggered ?? false;
}

export function getConditionalTriggerDecision(
  order: PendingOrder,
  chartCurrentPrice: number,
): ConditionalTriggerDecision | null {
  if (!isConditionalPendingOrder(order)) return null;

  const normalizedSide = resolveConditionalOrderSide(order);
  const triggerPrice = resolveConditionalTriggerPrice(order);

  if (!normalizedSide) return null;

  return getConditionalTriggerDecisionForPrices(normalizedSide, chartCurrentPrice, triggerPrice);
}

export function getConditionalTriggerDecisionFromRange(
  order: PendingOrder,
  range: ConditionalTriggerRange,
): ConditionalTriggerDecision | null {
  if (!isConditionalPendingOrder(order)) return null;

  const triggerPrice = resolveConditionalTriggerPrice(order);
  const highNum = Number(range.high);
  const lowNum = Number(range.low);

  if (!Number.isFinite(highNum) || !Number.isFinite(lowNum) || !Number.isFinite(triggerPrice)) {
    return null;
  }

  // ===== AUTHORITATIVE PATH: explicit operator / triggerDirection =====
  // For reduce-only TP/SL orders, `order.side` is the *closing* side (opposite of position),
  // which inverts the natural side-based trigger logic. The placement code (handlePlaceTpSl)
  // sets `operator` and `triggerDirection` to encode the correct quadrant per
  // (positionSide × TP/SL). Honor these whenever present — they are the ground truth.
  const op = (order as any).operator as '>=' | '<=' | undefined;
  const dir = order.triggerDirection as 'UP' | 'DOWN' | undefined;
  const useUp = op === '>=' || dir === 'UP';
  const useDown = op === '<=' || dir === 'DOWN';

  if (useUp || useDown) {
    const triggered = useUp ? highNum >= triggerPrice : lowNum <= triggerPrice;
    if (order.reduceOnly && order.reduceKind) {
      // Debug breadcrumb for TP/SL audits — silent in production logs unless triggered or near-miss
      const posSide = (order as any).reducePositionSide ?? 'N/A';
      // eslint-disable-next-line no-console
      console.log(
        `[TP/SL Check] kind=${order.reduceKind} posSide=${posSide} dir=${useUp ? 'UP' : 'DOWN'} ` +
          `low=${lowNum} high=${highNum} trigger=${triggerPrice} fired=${triggered}`,
      );
    }
    return {
      currentPriceNum: useUp ? highNum : lowNum,
      triggerPriceNum: triggerPrice,
      triggered,
    };
  }

  // ===== FALLBACK: legacy side-based decision (open-side conditional orders only) =====
  const normalizedSide = resolveConditionalOrderSide(order);
  if (!normalizedSide) return null;
  return getConditionalTriggerDecisionForRange(normalizedSide, triggerPrice, range);
}