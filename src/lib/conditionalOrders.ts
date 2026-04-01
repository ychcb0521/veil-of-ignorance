import type { OrderSide, PendingOrder } from '@/types/trading';

interface ConditionalTriggerDecision {
  currentPriceNum: number;
  triggerPriceNum: number;
  triggered: boolean;
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