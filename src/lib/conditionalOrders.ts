import type { PendingOrder } from '@/types/trading';

interface ConditionalTriggerDecision {
  currentPriceNum: number;
  triggerPriceNum: number;
  triggered: boolean;
}

export function isConditionalPendingOrder(order: PendingOrder): boolean {
  return order.type === 'CONDITIONAL' && order.status === 'PENDING';
}

export function getConditionalTriggerDecision(
  order: PendingOrder,
  chartCurrentPrice: number,
): ConditionalTriggerDecision | null {
  if (!isConditionalPendingOrder(order)) return null;

  const currentPriceNum = Number(chartCurrentPrice);
  const triggerPriceNum = Number(order.stopPrice);

  if (!Number.isFinite(currentPriceNum) || !Number.isFinite(triggerPriceNum)) {
    return null;
  }

  const triggered = order.side === 'LONG'
    ? currentPriceNum >= triggerPriceNum
    : currentPriceNum <= triggerPriceNum;

  return {
    currentPriceNum,
    triggerPriceNum,
    triggered,
  };
}