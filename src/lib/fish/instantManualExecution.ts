import type { ResearchBar } from '@/lib/deepRsa/window';
import { validateTpSlLevels, type TpSlLevels } from '@/lib/tpSlOrders';

export const INSTANT_MANUAL_EXECUTION = 'instant-manual-v1' as const;
export const INSTANT_MANUAL_MINUTE = 60_000;

export interface InstantManualFill {
  reason: 'manual' | 'take-profit' | 'stop-loss';
  at: number;
  priceAt: number;
  price: number;
  fraction: number;
}

export interface InstantManualExecution {
  version: typeof INSTANT_MANUAL_EXECUTION;
  startedAt: number;
  entryPrice: number;
  through: number;
  orders?: TpSlLevels;
  ordersAt?: number;
  fills: readonly InstantManualFill[];
}

export type InstantManualAction =
  | { kind: 'close'; fraction: number; all?: boolean }
  | { kind: 'protect'; levels: TpSlLevels }
  | { kind: 'cancel'; side?: 'tp' | 'sl' };

export const instantManualReason = (reason: InstantManualFill['reason']) =>
  reason === 'take-profit' ? '手动止盈触发' : reason === 'stop-loss' ? '手动止损触发' : '手动卖出';

export function validateInstantManualLevels(levels: TpSlLevels, price: number) {
  if ([levels.tp, levels.sl].some(level => level !== null && !(Number.isFinite(level) && level > 0))) {
    throw Error('请至少输入一个有效的触发价格');
  }
  if (!Number.isFinite(levels.percentage) || levels.percentage <= 0 || levels.percentage > 100) {
    throw Error('平仓数量无效');
  }
  const error = validateTpSlLevels('LONG', levels, price);
  if (error) throw Error(error.message);
}

export function applyInstantManualFill(state: InstantManualExecution, fill: InstantManualFill): InstantManualExecution {
  const next = fill.fraction === 1 ? cancelInstantProtection(state)
    : fill.reason === 'manual' ? state
    : cancelInstantProtection(state, fill.reason === 'take-profit' ? 'tp' : 'sl');
  return { ...next, fills: [...state.fills, fill] };
}

export function cancelInstantProtection(state: InstantManualExecution, side?: 'tp' | 'sl'): InstantManualExecution {
  const orders = side && state.orders ? { ...state.orders, [side]: null } : undefined;
  return orders?.tp || orders?.sl ? { ...state, orders } : { ...state, orders: undefined, ordersAt: undefined };
}

/** The first candle can include prices from before the order. Only its close is eligible. */
export function instantManualTrigger(orders: TpSlLevels, bar: ResearchBar, armedAt: number): InstantManualFill | undefined {
  const end = bar.openTime + INSTANT_MANUAL_MINUTE;
  if (end <= armedAt) return;
  if (![bar.open, bar.high, bar.low, bar.close].every(price => Number.isFinite(price) && price > 0)) {
    throw Error('止盈止损分钟行情价格无效');
  }
  const { tp, sl, percentage } = orders;
  const fill = (reason: InstantManualFill['reason'], at: number, price: number): InstantManualFill =>
    ({ reason, at, priceAt: bar.openTime, price, fraction: percentage / 100 });
  if (bar.openTime < armedAt) {
    if (sl !== null && bar.close <= sl) return fill('stop-loss', end, bar.close);
    if (tp !== null && bar.close >= tp) return fill('take-profit', end, bar.close);
    return;
  }
  if (sl !== null && bar.open <= sl) return fill('stop-loss', bar.openTime, bar.open);
  if (tp !== null && bar.open >= tp) return fill('take-profit', bar.openTime, bar.open);
  if (sl !== null && bar.low <= sl) return fill('stop-loss', end - 1, sl);
  if (tp !== null && bar.high >= tp) return fill('take-profit', end - 1, tp);
}

export function validInstantManualSale(state: InstantManualExecution | undefined, at: number, price: number | undefined, reason: string) {
  if (state?.version !== INSTANT_MANUAL_EXECUTION || !Number.isSafeInteger(state.startedAt)
    || !Number.isFinite(state.entryPrice) || !(state.entryPrice > 0)
    || !Array.isArray(state.fills) || !state.fills.length || state.orders) return false;
  const last = state.fills.at(-1)!;
  return last.fraction === 1 && last.at === at && last.price === price && last.reason === reason
    && state.fills.every((fill, index) => ['manual', 'take-profit', 'stop-loss'].includes(fill.reason)
      && Number.isSafeInteger(fill.at) && fill.at >= (state.fills[index - 1]?.at ?? state.startedAt)
      && Number.isSafeInteger(fill.priceAt) && fill.priceAt > 0 && fill.priceAt <= fill.at
      && Number.isFinite(fill.price) && fill.price > 0
      && Number.isFinite(fill.fraction) && fill.fraction > 0 && (index + 1 === state.fills.length || fill.fraction < 1));
}
