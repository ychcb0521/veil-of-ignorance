import { intervalToMs, type KlineData } from '@/hooks/useBinanceData';
import type { TradeJournal } from '@/types/journal';

export interface NoTradeHypotheticalResult {
  pnl_24h_pct: number | null;
  pnl_7d_pct: number | null;
}

interface FetchParams {
  symbol: string;
  interval: string;
  startTime: number;
  endTime: number;
}

async function fetchKlines({
  symbol,
  interval,
  startTime,
  endTime,
}: FetchParams): Promise<KlineData[]> {
  const qs = new URLSearchParams({
    symbol,
    interval,
    limit: '1000',
    startTime: String(startTime),
    endTime: String(endTime),
  });

  const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?${qs}`);
  if (!res.ok) throw new Error(`K 线加载失败：API ${res.status}`);
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) return [];

  return raw.map((row: any[]) => ({
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

function getPriceAtOrAfterTarget(klines: KlineData[], targetMs: number): number | null {
  if (klines.length === 0) return null;
  for (let index = 0; index < klines.length; index += 1) {
    const current = klines[index];
    const nextTime = klines[index + 1]?.time ?? Number.POSITIVE_INFINITY;
    if (current.time <= targetMs && targetMs < nextTime) {
      return current.close;
    }
  }
  const next = klines.find(kline => kline.time >= targetMs);
  return next?.close ?? klines[klines.length - 1]?.close ?? null;
}

function computePnlPct(entryPrice: number, futurePrice: number, direction: 'long' | 'short') {
  const rawPct = ((futurePrice - entryPrice) / entryPrice) * 100;
  return Number((direction === 'long' ? rawPct : -rawPct).toFixed(2));
}

export async function computeHypotheticalPnl(
  journal: Pick<TradeJournal, 'journal_kind' | 'symbol' | 'pre_simulated_time' | 'no_trade_direction' | 'no_trade_would_be_entry_price'>,
  options?: {
    currentSimulatedTimeMs?: number;
    interval?: string;
  },
): Promise<NoTradeHypotheticalResult> {
  if ((journal.journal_kind ?? 'trade') !== 'no_trade') {
    return { pnl_24h_pct: null, pnl_7d_pct: null };
  }

  const direction = journal.no_trade_direction;
  const entryPrice = journal.no_trade_would_be_entry_price;
  const entryTimeMs = new Date(journal.pre_simulated_time).getTime();
  if (!direction || !entryPrice || !Number.isFinite(entryTimeMs)) {
    return { pnl_24h_pct: null, pnl_7d_pct: null };
  }

  const currentSimulatedTimeMs = options?.currentSimulatedTimeMs ?? Date.now();
  const interval = options?.interval ?? '1h';
  const intervalMs = intervalToMs(interval);
  const target24h = entryTimeMs + 24 * 60 * 60_000;
  const target7d = entryTimeMs + 7 * 24 * 60 * 60_000;
  const fetchUntil = Math.min(Math.max(target24h, target7d), currentSimulatedTimeMs);

  if (fetchUntil <= entryTimeMs) {
    return { pnl_24h_pct: null, pnl_7d_pct: null };
  }

  const klines = await fetchKlines({
    symbol: journal.symbol,
    interval,
    startTime: entryTimeMs,
    endTime: fetchUntil + intervalMs,
  });

  const price24h = target24h > currentSimulatedTimeMs ? null : getPriceAtOrAfterTarget(klines, target24h);
  const price7d = target7d > currentSimulatedTimeMs ? null : getPriceAtOrAfterTarget(klines, target7d);

  return {
    pnl_24h_pct: price24h == null ? null : computePnlPct(entryPrice, price24h, direction),
    pnl_7d_pct: price7d == null ? null : computePnlPct(entryPrice, price7d, direction),
  };
}

export interface TooHardBasketStats {
  skipCount: number;
  tradeCount: number;
  skipRate: number;
  avgPnl7d: number | null;
}

export async function computeTooHardBasketStats(
  journals: TradeJournal[],
  options?: {
    days?: number;
    currentSimulatedTimeMs?: number;
  },
): Promise<TooHardBasketStats> {
  const days = options?.days ?? 90;
  const nowMs = options?.currentSimulatedTimeMs ?? Date.now();
  const sinceMs = nowMs - days * 24 * 60 * 60_000;

  const recent = journals.filter(journal => new Date(journal.pre_simulated_time).getTime() >= sinceMs);
  const noTrade = recent.filter(journal => (journal.journal_kind ?? 'trade') === 'no_trade');
  const trade = recent.filter(journal => (journal.journal_kind ?? 'trade') === 'trade');

  const hypotheticals = await Promise.all(
    noTrade.map(journal => computeHypotheticalPnl(journal, { currentSimulatedTimeMs: nowMs })),
  );

  const matured = hypotheticals
    .map(result => result.pnl_7d_pct)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  const avgPnl7d = matured.length === 0
    ? null
    : Number((matured.reduce((sum, value) => sum + value, 0) / matured.length).toFixed(2));

  return {
    skipCount: noTrade.length,
    tradeCount: trade.length,
    skipRate: noTrade.length + trade.length === 0 ? 0 : noTrade.length / (noTrade.length + trade.length),
    avgPnl7d,
  };
}
