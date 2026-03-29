// Shared trading types for the matching engine

export type OrderSide = 'LONG' | 'SHORT';
export type OrderType =
  | 'MARKET'
  | 'LIMIT'
  | 'POST_ONLY'          // 只做Maker
  | 'LIMIT_TP_SL'        // 限价止盈止损
  | 'MARKET_TP_SL'       // 市价止盈止损
  | 'CONDITIONAL'         // 条件委托
  | 'TRAILING_STOP'       // 跟踪委托
  | 'TWAP'                // 分时委托
  | 'SCALED';             // 分段订单

export type MarginMode = 'cross' | 'isolated';
export type OrderStatus = 'NEW' | 'FILLED' | 'CANCELED' | 'TRIGGERED' | 'ACTIVE';

export interface PendingOrder {
  id: string;
  side: OrderSide;
  type: OrderType;
  price: number;          // limit price or 0 for market
  stopPrice: number;      // trigger price for stop/TP-SL orders, 0 if N/A
  quantity: number;
  leverage: number;
  marginMode: MarginMode;
  status: OrderStatus;
  createdAt: number;      // simulated timestamp

  // === Trailing Stop fields ===
  callbackRate?: number;       // callback rate in decimal (e.g. 0.01 = 1%)
  trailingExecType?: 'MARKET' | 'LIMIT';  // execution type when triggered
  trailingLimitPrice?: number; // limit price for trailing limit execution
  peakPrice?: number;          // tracked peak for LONG trailing
  troughPrice?: number;        // tracked trough for SHORT trailing
  trailingActivated?: boolean; // whether trailing tracking has begun

  // === TWAP fields ===
  twapTotalQty?: number;       // total quantity to fill
  twapFilledQty?: number;      // quantity already filled
  twapInterval?: number;       // interval in ms between sub-orders
  twapNextExecTime?: number;   // next execution time (simulated)
  twapEndTime?: number;        // when TWAP ends

  // === Conditional order fields ===
  conditionalExecType?: 'MARKET' | 'LIMIT';
  conditionalLimitPrice?: number;

  // === Scaled order parent tracking ===
  parentScaledId?: string;     // links sub-orders to parent scaled order
}

export interface Position {
  side: OrderSide;
  entryPrice: number;
  quantity: number;
  leverage: number;
  marginMode: MarginMode;
  margin: number;
}

export interface TradeRecord {
  id: string;
  side: OrderSide;
  type: OrderType;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  leverage: number;
  pnl: number;
  fee: number;
  openTime: number;
  closeTime: number;
}

export const TAKER_FEE = 0.0004;  // 0.04%
export const MAKER_FEE = 0.0002;  // 0.02%

export function calcUnrealizedPnl(pos: Position, currentPrice: number): number {
  if (pos.side === 'LONG') {
    return (currentPrice - pos.entryPrice) * pos.quantity;
  }
  return (pos.entryPrice - currentPrice) * pos.quantity;
}

export function calcROE(pos: Position, currentPrice: number): number {
  const pnl = calcUnrealizedPnl(pos, currentPrice);
  return (pnl / pos.margin) * 100;
}

export function calcLiquidationPrice(pos: Position): number {
  const maintenanceRate = 0.004;
  if (pos.side === 'LONG') {
    return pos.entryPrice * (1 - 1 / pos.leverage + maintenanceRate);
  }
  return pos.entryPrice * (1 + 1 / pos.leverage - maintenanceRate);
}

export function calcFee(price: number, quantity: number, isMaker: boolean): number {
  return price * quantity * (isMaker ? MAKER_FEE : TAKER_FEE);
}

// Order type display info
export const ORDER_TYPE_INFO: { value: OrderType; label: string; desc: string }[] = [
  { value: 'LIMIT', label: '限价单', desc: 'Limit Order' },
  { value: 'POST_ONLY', label: '只做Maker', desc: 'Post Only' },
  { value: 'MARKET', label: '市价单', desc: 'Market Order' },
  { value: 'LIMIT_TP_SL', label: '限价止盈止损', desc: 'Limit TP/SL' },
  { value: 'MARKET_TP_SL', label: '市价止盈止损', desc: 'Market TP/SL' },
  { value: 'CONDITIONAL', label: '条件委托', desc: 'Conditional Order' },
  { value: 'TRAILING_STOP', label: '跟踪委托', desc: 'Trailing Stop Order' },
  { value: 'TWAP', label: '分时委托', desc: 'TWAP' },
  { value: 'SCALED', label: '分段订单', desc: 'Scaled Order' },
];
