import type { TradeSignal } from './signalLibrary';
/** Classification is explicit metadata (or the user's [美股] marker), never a symbol-name heuristic. */
export const US_STOCK_UNSUPPORTED = '美股：暂不支持取行情';
export function stockCode(s: Pick<TradeSignal, 'symbol' | 'underlying'>): string {
  return (s.underlying || s.symbol.replace(/USDT$/i, '')).trim().toUpperCase();
}
