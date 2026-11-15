export type UsdtMirrorSide = 'BOTH' | 'LONG' | 'SHORT';

export interface UsdtMirrorPosition {
  symbol: string;
  positionSide: UsdtMirrorSide;
  direction: 'long' | 'short';
  quantity: string;
  entryPrice: string;
  markPrice: string;
  unrealizedPnl: string;
  updatedAt: number;
}

export interface UsdtMirrorFill {
  id: string;
  orderId: string;
  at: number;
  side: 'BUY' | 'SELL';
  price: string;
  quantity: string;
  positionQuantity: string;
  action: 'open' | 'add' | 'reduce';
}

export interface UsdtMirrorHistory {
  openedAt?: number;
  fills: UsdtMirrorFill[];
  issue?: string;
}

export interface UsdtMirrorSnapshot {
  observedAt: number;
  positions: UsdtMirrorPosition[];
}

export const usdtMirrorKey = (position: Pick<UsdtMirrorPosition, 'symbol' | 'positionSide'>) => position.symbol + ':' + position.positionSide;
export const usdtMirrorRevision = (position: UsdtMirrorPosition) =>
  JSON.stringify([usdtMirrorKey(position), position.quantity, position.direction, position.entryPrice, position.updatedAt]);
