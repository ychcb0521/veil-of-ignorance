export type UsdtDeskOrderType = 'limit' | 'market' | 'conditional';
export type UsdtDeskTimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTX';
export type UsdtDeskOrderSpec =
  | { type: 'limit'; price: string; timeInForce: UsdtDeskTimeInForce }
  | { type: 'market'; slippage?: number }
  | { type: 'conditional'; triggerPrice: string };

export interface UsdtDeskQuote {
  symbol: string;
  ask: string;
  bid: string;
  mark: string;
  available: string;
  leverage: number;
  priceTick: string;
  orderStep: string;
  marketStep: string;
  maxQuantity: string;
  maxNotional: string;
}
export interface UsdtDeskOpenRequest {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  quantity: string;
  order: UsdtDeskOrderSpec;
}
