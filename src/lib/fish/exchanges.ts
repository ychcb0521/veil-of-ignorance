/** Only audited sources can be selected. Unsupported venues never fall back to estimated taker data. */
export type FishExchange = 'binance' | 'okx' | 'bybit' | 'bitget' | 'gate' | 'kucoin' | 'mexc';
export const EXCHANGE_PRIORITY: readonly FishExchange[] = ['binance', 'okx', 'bybit', 'bitget', 'gate', 'kucoin', 'mexc'];
export const EXCHANGE_NAMES: Record<FishExchange, string> = { binance: '币安', okx: 'OKX', bybit: 'Bybit', bitget: 'Bitget', gate: 'Gate', kucoin: 'KuCoin 合约', mexc: 'MEXC 合约' };
export const AUDITED_EXCHANGES: readonly FishExchange[] = ['binance', 'okx', 'bitget', 'gate'];
export interface FishMarket { symbol: string; instrument: string; base: string; multiplier: number; }
/** Explicit denomination aliases; never strip arbitrary leading digits (1INCH is a coin). */
export function fishBase(base: string): string {
  const upper = base.toUpperCase().replace(/[-_/]/g, '');
  const alias: Record<string, string> = { XBT: 'BTC', KPEPE: 'PEPE', KBONK: 'BONK', KSHIB: 'SHIB' };
  return alias[upper] ?? upper.replace(/^(1000000|10000|1000)(?=[A-Z])/, '');
}
export function selectFishMarkets(exchange: FishExchange, universes: Partial<Record<FishExchange, readonly FishMarket[]>>, includeDuplicates: boolean): FishMarket[] {
  const own = universes[exchange] ?? [];
  if (includeDuplicates) return [...own];
  const earlier = new Set(EXCHANGE_PRIORITY.slice(0, EXCHANGE_PRIORITY.indexOf(exchange)).flatMap(e => (universes[e] ?? []).map(m => fishBase(m.base))));
  return own.filter(m => !earlier.has(fishBase(m.base)));
}
