// Shared trading types for the matching engine

export type OrderSide = "LONG" | "SHORT";
export type OrderType =
  | "MARKET"
  | "LIMIT"
  | "POST_ONLY" // 只做Maker
  | "LIMIT_TP_SL" // 限价止盈止损
  | "MARKET_TP_SL" // 市价止盈止损
  | "CONDITIONAL" // 条件委托
  | "TRAILING_STOP" // 跟踪委托
  | "TWAP" // 分时委托
  | "SCALED"; // 分段订单

export type MarginMode = "cross" | "isolated";
export type OrderStatus = "NEW" | "PENDING" | "FILLED" | "CANCELED" | "TRIGGERED" | "ACTIVE";
export type TriggerOperator = ">=" | "<=";

export interface PendingOrder {
  id: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  stopPrice: number;
  quantity: number;
  leverage: number;
  marginMode: MarginMode;
  status: OrderStatus;
  createdAt: number;

  callbackRate?: number;
  trailingExecType?: "MARKET" | "LIMIT";
  trailingLimitPrice?: number;
  peakPrice?: number;
  troughPrice?: number;
  trailingActivated?: boolean;

  twapTotalQty?: number;
  twapFilledQty?: number;
  twapInterval?: number;
  twapNextExecTime?: number;
  twapEndTime?: number;

  conditionalExecType?: "MARKET" | "LIMIT";
  conditionalLimitPrice?: number;

  /** Trigger direction locked at placement: UP = triggerPrice > currentPrice, DOWN = triggerPrice < currentPrice */
  triggerDirection?: "UP" | "DOWN";
  /** Locked comparison operator for conditional orders, derived from triggerPrice vs currentPrice at placement */
  operator?: TriggerOperator;

  parentScaledId?: string;

  /** Reduce-only flag — TP/SL orders that only close existing positions */
  reduceOnly?: boolean;
  /** Symbol of the position this TP/SL order targets */
  reduceSymbol?: string;
  /** Side of the position this TP/SL order targets (opposite of close direction) */
  reducePositionSide?: OrderSide;
}

interface TriggerRange {
  high: number;
  low: number;
}

export interface Position {
  id: string;
  side: OrderSide;
  entryPrice: number;
  quantity: number;
  leverage: number;
  marginMode: MarginMode;
  margin: number;
  /** For isolated positions: the segregated margin assigned to this position */
  isolatedMargin?: number;
  /** Simulated clock time when this position was opened */
  openTime?: number;
}

export interface TradeRecord {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType | "FUNDING";
  action: "OPEN" | "CLOSE" | "LIQUIDATION" | "FUNDING";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  leverage: number;
  pnl: number;
  fee: number;
  slippage: number;
  openTime: number;
  closeTime: number;
}

export const MAINTENANCE_MARGIN_RATE = 0.005; // 0.5%
export const LIQUIDATION_FEE_RATE = 0.005; // 0.5%
export const FUNDING_RATE = 0.0001; // 0.01% per 8h settlement

// Tiered leverage limits (based on notional value in USDT)
export const LEVERAGE_TIERS = [
  { maxNotional: 50_000, maxLeverage: 125 },
  { maxNotional: 250_000, maxLeverage: 50 },
  { maxNotional: 1_000_000, maxLeverage: 20 },
  { maxNotional: Infinity, maxLeverage: 10 },
];

/** Get max allowed leverage for a given notional value */
export function getMaxLeverageForNotional(notional: number): number {
  for (const tier of LEVERAGE_TIERS) {
    if (notional <= tier.maxNotional) return tier.maxLeverage;
  }
  return 10;
}

/** Get leverage tier info string */
export function getLeverageTierInfo(notional: number): { maxLeverage: number; tierLabel: string } {
  for (const tier of LEVERAGE_TIERS) {
    if (notional <= tier.maxNotional) {
      const label =
        tier.maxNotional === Infinity ? `> 1,000,000 USDT` : `0 - ${tier.maxNotional.toLocaleString()} USDT`;
      return { maxLeverage: tier.maxLeverage, tierLabel: label };
    }
  }
  return { maxLeverage: 10, tierLabel: "> 1,000,000 USDT" };
}

/** Lock the trigger operator at placement time using the then-current close price. */
export function getTriggerOperator(triggerPrice: number, currentPrice: number): TriggerOperator {
  return triggerPrice > currentPrice ? ">=" : "<=";
}

/** Intrabar trigger validation using kline extremes instead of latest close. */
export function isTriggerConditionMet(operator: TriggerOperator, triggerPrice: number, kline: TriggerRange): boolean {
  return operator === ">=" ? kline.high >= triggerPrice : kline.low <= triggerPrice;
}

// Funding settlement times in UTC hours
export const FUNDING_HOURS = [0, 8, 16];

/**
 * Volatility-adjusted slippage for market/taker orders.
 * Base slippage = 0.05% + notional-scaled component.
 * If kline volatility (High-Low)/Close > 2%, slippage doubles (adverse market).
 */
export function calcSlippage(
  price: number,
  notionalValue: number,
  side: OrderSide,
  klineVolatility?: { high: number; low: number; close: number },
): number {
  let slippageRate = 0.0001 + notionalValue / 5_000_000_000;
  // Volatility doubling: if kline range > 2% of close, market is adverse
  if (klineVolatility && klineVolatility.close > 0) {
    const range = (klineVolatility.high - klineVolatility.low) / klineVolatility.close;
    if (range > 0.02) slippageRate *= 2;
  }
  return side === "LONG" ? price * (1 + slippageRate) : price * (1 - slippageRate);
}

export const TAKER_FEE = 0.0004; // 0.04%
export const MAKER_FEE = 0.0002; // 0.02%

export function calcUnrealizedPnl(pos: Position, currentPrice: number): number {
  if (pos.side === "LONG") {
    return (currentPrice - pos.entryPrice) * pos.quantity;
  }
  return (pos.entryPrice - currentPrice) * pos.quantity;
}

export function calcROE(pos: Position, currentPrice: number): number {
  const pnl = calcUnrealizedPnl(pos, currentPrice);
  const effectiveMargin = pos.marginMode === "isolated" && pos.isolatedMargin != null ? pos.isolatedMargin : pos.margin;
  return effectiveMargin > 0 ? (pnl / effectiveMargin) * 100 : 0;
}

export function calcLiquidationPrice(pos: Position): number {
  const maintenanceRate = MAINTENANCE_MARGIN_RATE;
  if (pos.marginMode === "isolated" && pos.isolatedMargin != null) {
    // Isolated: liq price based on isolatedMargin
    const margin = pos.isolatedMargin;
    const notional = pos.entryPrice * pos.quantity;
    if (pos.side === "LONG") {
      // margin + unrealizedPnl = maintenanceMargin => margin + (liqPrice - entry)*qty = maintenanceRate * liqPrice * qty
      // liqPrice * qty - entry*qty + margin = maintenanceRate * liqPrice * qty
      // liqPrice * qty * (1 - maintenanceRate) = entry*qty - margin
      return (pos.entryPrice * pos.quantity - margin) / (pos.quantity * (1 - maintenanceRate));
    }
    return (pos.entryPrice * pos.quantity + margin) / (pos.quantity * (1 + maintenanceRate));
  }
  // Cross mode: approximate
  if (pos.side === "LONG") {
    return pos.entryPrice * (1 - 1 / pos.leverage + maintenanceRate);
  }
  return pos.entryPrice * (1 + 1 / pos.leverage - maintenanceRate);
}

export function calcFee(price: number, quantity: number, isMaker: boolean): number {
  return price * quantity * (isMaker ? MAKER_FEE : TAKER_FEE);
}

// Order type display info
export const ORDER_TYPE_INFO: { value: OrderType; label: string; desc: string }[] = [
  { value: "LIMIT", label: "限价单", desc: "Limit Order" },
  { value: "POST_ONLY", label: "只做Maker", desc: "Post Only" },
  { value: "MARKET", label: "市价单", desc: "Market Order" },
  { value: "LIMIT_TP_SL", label: "限价止盈止损", desc: "Limit TP/SL" },
  { value: "MARKET_TP_SL", label: "市价止盈止损", desc: "Market TP/SL" },
  { value: "CONDITIONAL", label: "条件委托", desc: "Conditional Order" },
  { value: "TRAILING_STOP", label: "跟踪委托", desc: "Trailing Stop Order" },
  { value: "TWAP", label: "分时委托", desc: "TWAP" },
  { value: "SCALED", label: "分段订单", desc: "Scaled Order" },
];

/** Get price tick size based on price magnitude */
export function getPriceStep(price: number): number {
  if (price > 10000) return 0.1;
  if (price > 1000) return 0.01;
  if (price > 100) return 0.001;
  if (price > 10) return 0.0001;
  return 0.00001;
}
