import type { TradeSignal } from './signalLibrary';

export const ENTRY_PERIOD_SIGNALS_KEY = 'entry_period_signals_v1';
export const ENTRY_PERIOD_MARKETS = {
  crypto: '币圈',
  us: '美股',
  cn: 'A股',
  commodity: '商品',
  indicator: '指标',
  unknown: '待确认',
} as const;

export type EntryPeriodMarket = keyof typeof ENTRY_PERIOD_MARKETS;
export type EntryPeriodMark = '进1' | '进1(逼近)';
export type EntryPeriodSignal = TradeSignal & { entryPeriod: { market: EntryPeriodMarket; mark: EntryPeriodMark } };

const marketByName = new Map<string, EntryPeriodMarket>();
const knownMarkets: Partial<Record<EntryPeriodMarket, string>> = {
  crypto: 'A AAVE ADA AVAX BGB BNB BTC CRV DOGE EOS ETH FARTCOIN HYPE KAITO LDO LINK LTC ONDO PEPE PUMP SEI SOL SUI UNI VIRTUAL WLD ZEC 币市流动性',
  us: 'AAOI AAPL AMZN AXTI BABA CIRCLE COIN GLW GOOG HOOD MSFT MU NVDA PLTR SNDK SPCX TSLA',
  cn: 'MLCC PCB',
  indicator: '期权波动率',
  commodity: 'XAG 布伦特原油',
};
for (const [market, names] of Object.entries(knownMarkets)) {
  for (const name of names.split(' ')) marketByName.set(name, market as EntryPeriodMarket);
}
marketByName.set('美股纳指 OTC', 'us');
marketByName.set('黄金 OTC', 'commodity');

function readMarket(symbol: string, value?: string): EntryPeriodMarket {
  const label = value?.trim();
  if (label) {
    for (const [key, name] of Object.entries(ENTRY_PERIOD_MARKETS)) {
      if (label.toLowerCase() === name.toLowerCase() || label.toLowerCase() === key) return key as EntryPeriodMarket;
    }
    return 'unknown';
  }
  return marketByName.get(symbol.toUpperCase()) ?? 'unknown';
}

export function parseEntryPeriodMark(value: string): EntryPeriodMark | undefined {
  const mark = value.trim().normalize('NFKC');
  return mark === '进1' || mark === '进1(逼近)' ? mark : undefined;
}

export function createEntryPeriodSignal(
  rawSymbol: string, date: string, mark: EntryPeriodMark, marketLabel?: string,
): EntryPeriodSignal | undefined {
  const symbol = rawSymbol.trim();
  if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const midnight = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date) return undefined;
  const market = readMarket(symbol, marketLabel);
  const ticker = symbol.toUpperCase().replace('/', '');
  const binanceSymbol = market === 'crypto' && /^[A-Z0-9]+$/.test(ticker)
    ? ticker.endsWith('USDT') ? ticker : ticker + 'USDT'
    : null;
  return {
    id: 'entry-period:' + encodeURIComponent(symbol.normalize('NFKC').toUpperCase()) + ':' + date,
    symbol,
    timeMs: midnight + 8 * 3_600_000,
    timeLabel: date + ' 16:00',
    fallbackZone: '',
    binanceSymbol,
    entryPeriod: { market, mark },
  };
}

export function mergeEntryPeriodSignals(existing: TradeSignal[], incoming: readonly EntryPeriodSignal[]): TradeSignal[] {
  const ids = new Set(existing.map(signal => signal.id));
  const additions = incoming.filter(signal => {
    if (ids.has(signal.id)) return false;
    ids.add(signal.id);
    return true;
  });
  return additions.length ? [...existing, ...additions] : existing;
}
