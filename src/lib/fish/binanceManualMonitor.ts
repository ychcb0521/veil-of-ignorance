import type { InstantMonitorSettings } from './instantMonitorSettings';
import type { QualityResult } from './quality';
import type { QualityAdditionFill, QualityReductionFill } from './qualityAddition';
import type { QualityMirrorFill } from './qualityMirror';
import type { UsdtFollowAction, UsdtFollowStatus } from './usdtFollow';

export const BINANCE_MANUAL_MONITOR_VERSION = 'binance-manual-monitor-v1' as const;
export const MANAGED_MINUTE = 60_000;
export const MANAGED_CLOSE_GRACE = 1000;

export interface BinanceManualAnchor {
  symbol: string;
  positionSide: 'LONG' | 'BOTH';
  openedAt: number;
  openingTradeId: string;
  openingOrderId: string;
}

export interface BinanceManualPosition {
  version: typeof BINANCE_MANUAL_MONITOR_VERSION;
  anchor: BinanceManualAnchor;
  monitor: InstantMonitorSettings;
  armedAt: number;
  entryPrice: number;
  entryQuantity: number;
  revision: number;
  checkpoint?: QualityResult;
  exchangeReduction?: { at: number; quantity: number; entryPrice: number; realized: number };
  pending?: BinanceManualDecision;
}

export interface BinanceManualState {
  observedAt: number;
  positions: { position: BinanceManualPosition; status: UsdtFollowStatus }[];
}

export type BinanceManualDecision = {
  action: UsdtFollowAction;
  through: number;
  routeDecision?: QualityResult['routeDecision'];
  sellStageSwitches?: QualityResult['sellStageSwitches'];
  vetoStageSwitches?: QualityResult['vetoStageSwitches'];
} & (
  | { kind: 'add'; evidence: QualityAdditionFill }
  | { kind: 'mirror'; evidence: QualityMirrorFill }
  | { kind: 'support-reduction'; evidence: QualityReductionFill }
  | { kind: 'close'; reason: string }
);

export const binanceManualId = (anchor: BinanceManualAnchor) =>
  ['fish-instant-live', anchor.symbol, anchor.positionSide, 'long', anchor.openingTradeId, anchor.openingOrderId].join('-');
