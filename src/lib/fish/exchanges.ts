/** Only audited sources can be selected. Unsupported venues never fall back to estimated taker data. */
export type FishExchange = 'binance' | 'okx' | 'bybit' | 'bitget' | 'gate' | 'kucoin' | 'mexc';
export const EXCHANGE_PRIORITY: readonly FishExchange[] = ['binance', 'okx', 'bybit', 'bitget', 'gate', 'kucoin', 'mexc'];
export const EXCHANGE_NAMES: Record<FishExchange, string> = { binance: '币安', okx: 'OKX', bybit: 'Bybit', bitget: 'Bitget', gate: 'Gate', kucoin: 'KuCoin 合约', mexc: 'MEXC 合约' };
export const AUDITED_EXCHANGES: readonly FishExchange[] = ['binance', 'okx', 'bitget', 'gate'];
export const US_STOCK_EXCHANGES: readonly FishExchange[] = ['binance', 'bitget'];
export interface FishMarket { tickSize?:number; symbol: string; instrument: string; base: string; multiplier: number; market?: 'us_stock'; underlying?: string; }
export const fishMarketKey = (m: FishMarket): string => m.market === 'us_stock' ? `us:${(m.underlying || m.base).toUpperCase()}` : `crypto:${fishBase(m.base)}`;
/** Explicit denomination aliases; never strip arbitrary leading digits (1INCH is a coin). */
export function fishBase(base: string): string {
  const upper = base.toUpperCase().replace(/[-_/]/g, '');
  const alias: Record<string, string> = { XBT: 'BTC', KPEPE: 'PEPE', KBONK: 'BONK', KSHIB: 'SHIB' };
  return alias[upper] ?? upper.replace(/^(1000000|10000|1000)(?=[A-Z])/, '');
}
/**
 * 稳定币（锚定美元 / 欧元等法币）：价格几乎不动，没有短线交易价值，捕捞时整体排除。
 * 【用户要求】2026-10-20「算法捕捉的标的要排除那些没有短线交易价值的稳定币，比如 USDT、USDC 等等」。
 * 只按基础币名精确匹配（如 USDCUSDT 的 USDC）；脱锚后变成普通波动币的（如 USTC）不在其列，黄金代币（PAXG、XAUT）也不算稳定币。
 */
export const FISH_STABLECOINS: ReadonlySet<string> = new Set([
  'USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'PAX', 'USDE', 'USDD', 'PYUSD', 'USD1', 'RLUSD', 'USDS', 'USDX', 'USDB', 'USDF', 'USD0', 'BFUSD',
  'FRAX', 'FRXUSD', 'LUSD', 'GUSD', 'SUSD', 'XUSD', 'GHO', 'CRVUSD', 'MIM', 'DOLA', 'USDJ', 'USDM', 'USDA', 'USDG', 'USDQ', 'AUSD', 'EUSD',
  'EUR', 'EURC', 'EURI', 'AEUR', 'EURT', 'EURS',
]);
export const isFishStablecoin = (base: string): boolean => FISH_STABLECOINS.has(fishBase(base));
export function selectFishMarkets(exchange: FishExchange, universes: Partial<Record<FishExchange, readonly FishMarket[]>>, includeDuplicates: boolean): FishMarket[] {
  const own = (universes[exchange] ?? []).filter(m => m.market === 'us_stock' || !isFishStablecoin(m.base));
  if (includeDuplicates) return own;
  const earlier = new Set(EXCHANGE_PRIORITY.slice(0, EXCHANGE_PRIORITY.indexOf(exchange)).flatMap(e => (universes[e] ?? []).map(m => fishMarketKey(m))));
  return own.filter(m => !earlier.has(fishMarketKey(m)));
}
