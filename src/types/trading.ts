// Shared trading types for the matching engine

export type OrderSide = 'LONG' | 'SHORT';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_LIMIT' | 'STOP_MARKET';
export type MarginMode = 'cross' | 'isolated';
export type OrderStatus = 'NEW' | 'FILLED' | 'CANCELED';

export interface PendingOrder {
  id: string;
  side: OrderSide;
  type: OrderType;
  price: number;          // limit price or 0 for market
  stopPrice: number;      // trigger price for stop orders, 0 if N/A
  quantity: number;
  leverage: number;
  marginMode: MarginMode;
  status: OrderStatus;
  createdAt: number;      // simulated timestamp
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
  // Simplified liquidation: when margin is consumed by loss
  // For isolated: liq when loss = margin (minus some buffer)
  const maintenanceRate = 0.004; // 0.4% maintenance margin
  if (pos.side === 'LONG') {
    return pos.entryPrice * (1 - 1 / pos.leverage + maintenanceRate);
  }
  return pos.entryPrice * (1 + 1 / pos.leverage - maintenanceRate);
}

export function calcFee(price: number, quantity: number, isMaker: boolean): number {
  return price * quantity * (isMaker ? MAKER_FEE : TAKER_FEE);
}
