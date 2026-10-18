/**
 * K 线图上的对照币（BTCUSDT）收盘价：CBI-2 的动量要剔除 BTC。
 * 【用户要求】2026-10-18。指标计算是同步的：算的时候先用手上有的（没有的那根记空 → 公式里不剔除），
 * 同时按图上的时间段、周期去取一次；取到后版本号 +1、通知图表重算（CandlestickChart 订阅）。
 * 同一时间段只取一次；回放往后推时多取一截（往后 500 根，不超过现在），不必每推一根就取一次。
 */
import { fetchResearchKlines, intervalMs as intervalMsOf, RESEARCH_INTERVALS, type ResearchInterval } from '@/lib/deepRsa/marketData';
import type { ResearchBar } from '@/lib/deepRsa/window';

export const REFERENCE_SYMBOL = 'BTCUSDT';
const closes = new Map<number, Map<number, number>>(); // 周期（毫秒）→ 开盘时间 → 收盘价
const covered = new Map<number, [number, number][]>();
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
  let m = closes.get(intervalMs);
  if (!m) { m = new Map(); closes.set(intervalMs, m); }
  for (const b of bars) if (Number.isFinite(b.close)) m.set(b.openTime, b.close);
  if (range) covered.set(intervalMs, [...(covered.get(intervalMs) ?? []), range]);
  version++;
  for (const fn of listeners) fn();
}

/** 这些开盘时间上的 BTC 收盘价（没有的记 null）。 */
export function btcClosesAt(times: readonly number[], intervalMs: number): (number | null)[] {
  const m = closes.get(intervalMs);
  return times.map(t => m?.get(t) ?? null);
}

const isCovered = (intervalMs: number, from: number, to: number) => (covered.get(intervalMs) ?? []).some(([a, b]) => a <= from && b >= to);

/** 图上这段时间（[from, to)，这个周期）的 BTC 还没取过就去取；不支持的周期、取过失败的段不再取。 */
export function requestBtcReference(from: number, to: number, intervalMs: number, fetchFn?: Parameters<typeof fetchResearchKlines>[3]): void {
  const interval = RESEARCH_INTERVALS.find(i => intervalMsOf(i) === intervalMs) as ResearchInterval | undefined;
  if (!interval || !(to > from) || isCovered(intervalMs, from, to)) return;
  // 往后多取 500 根（回放往后推时不用每根都取），但不超过现在
  const end = Math.min(to + 500 * intervalMs, Math.ceil(Date.now() / intervalMs) * intervalMs + intervalMs);
  const key = `${intervalMs}|${from}|${end}`;
  if (inflight.has(key) || failed.has(key)) return;
  inflight.add(key);
  fetchResearchKlines(REFERENCE_SYMBOL, from, Math.max(end, to), fetchFn, undefined, interval)
    .then(bars => ingestBtcBars(intervalMs, bars, [from, Math.max(end, to)]))
    .catch(() => { failed.add(key); })
    .finally(() => { inflight.delete(key); });
}

/** 测试用：清空。 */
export function resetBtcReference(): void {
  closes.clear(); covered.clear(); inflight.clear(); failed.clear(); version = 0;
}
