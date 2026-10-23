/** Hidden, symbol-isolated prehistory for chart indicator warmup. Never adds visible candles. */
import type { KLineData } from 'klinecharts';
import { fetchResearchKlines, RESEARCH_INTERVALS, intervalMs, type ResearchInterval } from '@/lib/deepRsa/marketData';

interface Entry { from: number; bars: KLineData[]; pending: boolean; retryAt: number }
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
export const researchHistoryVersion = () => version;
export function subscribeResearchHistory(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function resetResearchHistory() { entries.clear(); version++; }

export function chartPrehistory(data: KLineData[], bars: number, step: number): KLineData[] {
  const symbol = data[0]?.researchSymbol;
  const interval = RESEARCH_INTERVALS.find(i => intervalMs(i) === step) as ResearchInterval | undefined;
  if (typeof symbol !== 'string' || !interval || !data.length || !Number.isFinite(bars) || bars <= 0) return [];
  const to = data[0].timestamp, from = Math.max(0, to - Math.ceil(bars) * step);
  const key = `${symbol}|${interval}|${to}`;
  let entry = entries.get(key);
  if (!entry) {
    entry = { from: to, bars: [], pending: false, retryAt: 0 };
    entries.set(key, entry);
    // Pending requests retain their own entry; evicted results cannot notify a different chart.
    if (entries.size > 24) entries.delete(entries.keys().next().value!);
  }
  if (entry.from > from && !entry.pending && Date.now() >= entry.retryAt) {
    const current = entry;
    current.pending = true;
    fetchResearchKlines(symbol, from, to, undefined, undefined, interval).then(result => {
      if (entries.get(key) !== current) return;
      current.from = from;
      current.bars = result.filter(b => b.openTime < to).map(b => ({ timestamp: b.openTime,
        open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? Number.NaN,
        ...(b.quoteVolume != null ? { turnover: b.quoteVolume } : {}),
        ...(b.takerBuyQuoteVolume != null ? { takerBuyTurnover: b.takerBuyQuoteVolume } : {}),
      }));
      current.pending = false;
      version++;
      for (const fn of listeners) fn();
    }).catch(() => { current.pending = false; current.retryAt = Date.now() + 30_000; });
  }
  return entry.bars;
}
