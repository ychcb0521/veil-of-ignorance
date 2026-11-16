import type { UsdtProtectionOrder } from './usdtPositionControls';

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
  breakEvenPrice?: string;
  liquidationPrice?: string;
  positionInitialMargin?: string;
  isolatedWallet?: string;
  maintMargin?: string;
  notional?: string;
  leverage?: number;
  marginMode?: 'isolated' | 'cross';
  protectionOrders?: UsdtProtectionOrder[];
  protectionIssue?: string;
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

export const usdtSettlementAsset = (symbol: string) => symbol.split('_')[0].endsWith('USDC') ? 'USDC' : 'USDT';
const amountFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 });
export const usdtAmountText = (amount: number) => Number.isFinite(amount) ? amountFormat.format(amount) : '—';

/** Keep the decimal precision returned by the exchange when displaying quantities and profits. */
export function usdtPositionDecimal(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** Quote value at the price in this snapshot, including legacy executors that report quantity and price only. */
export function usdtPositionValue(quantity: string, price: string): string {
  const q = /^(\d{1,30})(?:\.(\d{1,18}))?$/.exec(quantity);
  const p = /^(\d{1,30})(?:\.(\d{1,18}))?$/.exec(price);
  if (!q || !p) return '—';
  const qa = q[2] ?? '', pa = p[2] ?? '', decimals = qa.length + pa.length;
  const product = String(BigInt(q[1] + qa) * BigInt(p[1] + pa)).padStart(decimals + 1, '0');
  return decimals ? usdtPositionDecimal(product.slice(0, -decimals) + '.' + product.slice(-decimals)) : product;
}

export function usdtPositionQuantityUnit(symbol: string): string {
  const market = symbol.split('_')[0];
  return market.slice(0, -usdtSettlementAsset(symbol).length);
}
