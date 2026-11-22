import type { UsdtMirrorPosition } from './usdtPositionMirror';
import type { UsdtDeskOrderSpec } from './usdtOrderDesk';

/** Immediate exits use an actual market order, without an IOC slippage limit. */
export const USDT_MARKET_EXIT_ORDER = { type: 'market' } as const;

export interface UsdtPositionTarget extends Pick<UsdtMirrorPosition, 'symbol' | 'positionSide' | 'direction'> {
  revision: string;
  campaignId: string;
  openedAt: number;
}

export interface UsdtProtectionOrder {
  id: string;
  kind: 'tp' | 'sl';
  triggerPrice: string;
  quantity?: string;
  workingType: 'MARK_PRICE' | 'CONTRACT_PRICE';
}

export type UsdtPositionAction =
  | { kind: 'close'; fraction: number; order?: UsdtDeskOrderSpec }
  | { kind: 'protect'; tp: number | null; sl: number | null; fraction: number }
  | { kind: 'cancel'; orderId: string }
  | { kind: 'leverage'; leverage: number }
  | { kind: 'margin'; delta: number };

export interface UsdtPositionControlRequest {
  id: string;
  target: UsdtPositionTarget;
  action: UsdtPositionAction;
}

export interface UsdtPositionControlResult {
  pending?: boolean;
  issue?: string;
  filledQuantity?: string;
}
