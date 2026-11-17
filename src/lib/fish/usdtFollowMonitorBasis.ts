export const USDT_FOLLOW_MONITOR_BASIS = 'binance-follow-monitor-basis-v1' as const;

/** Carried rounds select rules. Only fills since this boundary belong in the new sizing ledger. */
export interface UsdtFollowMonitorBasis {
  version: typeof USDT_FOLLOW_MONITOR_BASIS;
  effectiveAt: number;
  carriedAdditions: number;
  quantity: number;
  entryPrice: number;
  realizedBefore: number;
}
