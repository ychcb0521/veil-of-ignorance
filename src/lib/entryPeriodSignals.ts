import type { TradeSignal } from './signalLibrary';
import { formatUTC8 } from './timeFormat';

export const ENTRY_PERIOD_SIGNALS_KEY = 'entry_period_signals_v1';
export const ENTRY_PERIOD_MARKETS = {
  crypto: 'Crypto',
  us: '美股',
  cn: 'A股',
  other: '其他',
} as const;

export type EntryPeriodMarket = keyof typeof ENTRY_PERIOD_MARKETS;
// Persisted codes remain readable by older tabs and existing account backups.
export type StoredEntryPeriodMarket = Exclude<EntryPeriodMarket, 'other'> | 'commodity' | 'indicator' | 'unknown';

export function entryPeriodMarketGroup(market: StoredEntryPeriodMarket | undefined): EntryPeriodMarket {
  return market === 'crypto' || market === 'us' || market === 'cn' ? market : 'other';
}

export function entryPeriodMarketLabel(market: StoredEntryPeriodMarket): string {
  return ENTRY_PERIOD_MARKETS[entryPeriodMarketGroup(market)];
}

export type EntryPeriodMark = '进1' | '进1(逼近)';
export type EntryPeriodMetadata = { market: StoredEntryPeriodMarket; mark: EntryPeriodMark; endTimeMs?: number };
export type EntryPeriodSignal = TradeSignal & { entryPeriod: EntryPeriodMetadata };

export function entryPeriodTime(date: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const midnight = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date) return undefined;
  return midnight + 8 * 3_600_000;
}

export function entryPeriodEndLabel(endTimeMs?: number): string {
  return endTimeMs && Number.isFinite(endTimeMs) ? formatUTC8(endTimeMs).slice(0, 16) : '';
}

const marketByName = new Map<string, StoredEntryPeriodMarket>();
const knownMarkets: Partial<Record<StoredEntryPeriodMarket, string>> = {
  crypto: 'A AAVE ADA AVAX BGB BNB BTC CRV DOGE EOS ETH FARTCOIN HYPE KAITO LDO LINK LTC ONDO PEPE PUMP SEI SOL SUI UNI VIRTUAL WLD ZEC 币市流动性',
  us: 'AAOI AAPL AMZN AXTI BABA CIRCLE COIN GLW GOOG HOOD MSFT MU NVDA PLTR SNDK SPCX TSLA',
  cn: 'MLCC PCB',
  indicator: '期权波动率',
  commodity: 'XAG 布伦特原油',
};
for (const [market, names] of Object.entries(knownMarkets)) {
  for (const name of names.split(' ')) marketByName.set(name, market as StoredEntryPeriodMarket);
}
marketByName.set('美股纳指 OTC', 'us');
marketByName.set('黄金 OTC', 'commodity');

const importMarkets = new Map<string, StoredEntryPeriodMarket>([
  ['crypto', 'crypto'], ['币圈', 'crypto'],
  ['us', 'us'], ['美股', 'us'],
  ['cn', 'cn'], ['a股', 'cn'],
  ['commodity', 'commodity'], ['商品', 'commodity'],
  ['indicator', 'indicator'], ['指标', 'indicator'],
]);

function readMarket(symbol: string, value?: string): StoredEntryPeriodMarket {
  const label = value?.trim().normalize('NFKC').toLowerCase();
  return label ? importMarkets.get(label) ?? 'unknown' : marketByName.get(symbol.toUpperCase()) ?? 'unknown';
}

export function parseEntryPeriodMark(value: string): EntryPeriodMark | undefined {
  const mark = value.trim().normalize('NFKC');
  return mark === '进1' || mark === '进1(逼近)' ? mark : undefined;
}

export function createEntryPeriodSignal(
  rawSymbol: string, date: string, mark: EntryPeriodMark, marketLabel?: string,
): EntryPeriodSignal | undefined {
  const symbol = rawSymbol.trim();
  const timeMs = entryPeriodTime(date);
  if (!symbol || timeMs === undefined) return undefined;
  const market = readMarket(symbol, marketLabel);
  const ticker = symbol.toUpperCase().replace('/', '');
  const binanceSymbol = market === 'crypto' && /^[A-Z0-9]+$/.test(ticker)
    ? ticker.endsWith('USDT') ? ticker : ticker + 'USDT'
    : null;
  return {
    id: 'entry-period:' + encodeURIComponent(symbol.normalize('NFKC').toUpperCase()) + ':' + date,
    symbol,
    timeMs,
    timeLabel: date + ' 16:00',
    fallbackZone: '',
    binanceSymbol,
    entryPeriod: { market, mark },
  };
}

export function mergeEntryPeriodSignals(existing: TradeSignal[], incoming: readonly EntryPeriodSignal[]): TradeSignal[] {
  const byId = new Map(incoming.map(signal => [signal.id, signal]));
  let changed = false;
  const updated = existing.map(signal => {
    const endTimeMs = byId.get(signal.id)?.entryPeriod.endTimeMs;
    byId.delete(signal.id);
    if (signal.entryPeriod && signal.entryPeriod.endTimeMs === undefined && endTimeMs !== undefined) {
      changed = true;
      return { ...signal, entryPeriod: { ...signal.entryPeriod, endTimeMs } };
    }
    return signal;
  });
  return changed || byId.size ? [...updated, ...byId.values()] : existing;
}
