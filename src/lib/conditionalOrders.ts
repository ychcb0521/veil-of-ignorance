import type { OrderSide, PendingOrder } from '@/types/trading';

interface ConditionalTriggerDecision {
  currentPriceNum: number;
  triggerPriceNum: number;
  triggered: boolean;
}

export function isConditionalPendingOrder(order: PendingOrder): boolean {
  return order.type === 'CONDITIONAL' && order.status === 'PENDING';
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

  return getConditionalTriggerDecisionForPrices(order.side, chartCurrentPrice, order.stopPrice);
}