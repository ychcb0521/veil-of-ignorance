/**
 * K 线图上的对照币（BTCUSDT）收盘价：CBI-2 的动量要剔除 BTC。
 * 【用户要求】2026-10-18。指标计算是同步的：算的时候先用手上有的（没有的那根记空 → 公式里不剔除），
 * 同时按图上的时间段、周期去取一次；取到后版本号 +1、通知图表重算（CandlestickChart 订阅）。
 * 同一时间段只取一次；回放往后推时多取一截（往后 500 根，不超过现在），不必每推一根就取一次。
 */
import { fetchResearchKlines, intervalMs as intervalMsOf, RESEARCH_INTERVALS, type ResearchInterval } from '@/lib/deepRsa/marketData';
import type { ResearchBar } from '@/lib/deepRsa/window';
import { isTuringCupSymbol, turingCupSymbol } from '@/lib/turingCupSymbol';
import { getUserPrefix } from '@/lib/userStoragePrefix';

export const REFERENCE_SYMBOL = 'BTCUSDT';
type SeriesKey = number | string;
const seriesKey = (interval: number, symbol: string) => isTuringCupSymbol(symbol) ? `${getUserPrefix()}turing:${interval}` : interval;
const closes = new Map<SeriesKey, Map<number, number>>();
const covered = new Map<SeriesKey, [number, number][]>();
const inflight = new Set<string>();
const failed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

export const btcReferenceVersion = () => version;
export function subscribeBtcReference(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 把一批 BTC K 线记下来（取到之后、测试里也用）。 */
export function ingestBtcBars(intervalMs: number, bars: readonly Pick<ResearchBar, 'openTime' | 'close'>[], range?: [number, number]): void {
  storeBtcBars(intervalMs, bars, range);
}

function storeBtcBars(key: SeriesKey, bars: readonly Pick<ResearchBar, 'openTime' | 'close'>[], range?: [number, number]) {
  let m = closes.get(key);
  if (!m) { m = new Map(); closes.set(key, m); }
  for (const b of bars) if (Number.isFinite(b.close)) m.set(b.openTime, b.close);
  if (range) covered.set(key, [...(covered.get(key) ?? []), range]);
  version++;
  for (const fn of listeners) fn();
}

/** 这些开盘时间上的 BTC 收盘价（没有的记 null）。 */
export function btcClosesAt(times: readonly number[], intervalMs: number, chartSymbol = ''): (number | null)[] {
  const m = closes.get(seriesKey(intervalMs, chartSymbol));
  return times.map(t => m?.get(t) ?? null);
}

const isCovered = (key: SeriesKey, from: number, to: number) => (covered.get(key) ?? []).some(([a, b]) => a <= from && b >= to);

/** 图上这段时间（[from, to)，这个周期）的 BTC 还没取过就去取；不支持的周期、取过失败的段不再取。 */
export function requestBtcReference(from: number, to: number, intervalMs: number, fetchFn?: Parameters<typeof fetchResearchKlines>[3], chartSymbol = ''): void {
  const series = seriesKey(intervalMs, chartSymbol);
  const interval = RESEARCH_INTERVALS.find(i => intervalMsOf(i) === intervalMs) as ResearchInterval | undefined;
  if (!interval || !(to > from) || isCovered(series, from, to)) return;
  // 往后多取 500 根（回放往后推时不用每根都取），但不超过现在
  const end = Math.min(to + 500 * intervalMs, Math.ceil(Date.now() / intervalMs) * intervalMs + intervalMs);
  const key = `${series}|${from}|${end}`;
  if (inflight.has(key) || failed.has(key)) return;
  inflight.add(key);
  const reference = isTuringCupSymbol(chartSymbol) ? turingCupSymbol(REFERENCE_SYMBOL) : REFERENCE_SYMBOL;
  fetchResearchKlines(reference, from, Math.max(end, to), fetchFn, undefined, interval)
    .then(bars => storeBtcBars(series, bars, [from, Math.max(end, to)]))
    .catch(() => { failed.add(key); })
    .finally(() => { inflight.delete(key); });
}

/** 测试用：清空。 */
export function resetBtcReference(): void {
  closes.clear(); covered.clear(); inflight.clear(); failed.clear(); version = 0;
}
