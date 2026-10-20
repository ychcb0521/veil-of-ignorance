/**
 * 信号库里每个信号出现时的成交额（USDT），以及全库汇总的区间。
 * 【用户要求】2026-10-20「检查历史信号库中所有的信号，在当时信号出现时的成交量，汇总起来看成交量的区间在什么范围。用 USDT」；
 * 口径由用户选定：信号前 24 小时成交额。
 *
 * 口径：截至信号所在那根 5 分钟 K 线之前（只用已收盘的 K 线），往前 288 根 5m K 线的 USDT 成交额之和，
 * 也就是信号那一刻盘口「24h 成交额」的读数（最多差不到 5 分钟）。上市不足 24 小时的币，按上市以来的成交额算（盘口当时显示的也是它），并在明细里标出覆盖的小时数。
 * 只存浏览器本机（按账号分区），是可重算的统计，不改信号库、不进交易状态同步。
 */
import type { ResearchBar } from '@/lib/deepRsa/window';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { formatUTC8 } from '@/lib/timeFormat';
import { normalizeSignalQuality, signalDedupKey, type TradeSignal } from '@/lib/signalLibrary';
import { FishError, fishDelay } from '@/lib/fish/shared';
import { fishSignalFingerprint, type FishSampleRow } from '@/lib/fish/suggestions';

export const TURNOVER_STEP = 5 * 60_000;
export const TURNOVER_BARS = 288;
export const TURNOVER_WINDOW_MS = TURNOVER_BARS * TURNOVER_STEP;

export interface SignalTurnoverRow {
  symbol: string; exchange?: string; market?: string; underlying?: string; timeMs: number;
  /** 统计时的评分快照；界面与导出会优先关联信号库的当前评分。 */
  quality?: number;
  /** 24 小时成交额（USDT）；取不到为 null，原因写在 reason。 */
  turnover: number | null;
  /** 实际覆盖的小时数（上市不足 24 小时时小于 24）。 */
  hours: number;
  reason?: string;
}
export interface SignalTurnoverStats { n: number; min: number; p10: number; p25: number; p50: number; p75: number; p90: number; max: number; mean: number }
export interface SignalTurnoverResult {
  version: 1; fingerprint: string; createdAt: number; total: number;
  rows: SignalTurnoverRow[];
  stats: SignalTurnoverStats | null;
  /** 上市不足 24 小时、按上市以来计的信号数。 */
  partial: number;
  /** 扫完全部信号（取消时为 false，只统计到已取到的）。 */
  complete: boolean;
}
export interface SignalTurnoverProgress { status: 'running' | 'complete' | 'cancelled' | 'aborted'; done: number; total: number; current: string }
export type SignalTurnoverLoader = (row: FishSampleRow, cut: number, signal: AbortSignal) => Promise<readonly ResearchBar[]>;
export interface SignalTurnoverOptions { signals: readonly TradeSignal[]; signal: AbortSignal; onProgress: (p: SignalTurnoverProgress) => void }

function quantile(sorted: readonly number[], q: number): number {
  const at = (sorted.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
  return lo === hi ? sorted[lo] : sorted[lo] * (1 - (at - lo)) + sorted[hi] * (at - lo);
}
export function summarizeTurnover(values: readonly number[]): SignalTurnoverStats | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return { n: sorted.length, min: sorted[0], p10: quantile(sorted, .1), p25: quantile(sorted, .25), p50: quantile(sorted, .5), p75: quantile(sorted, .75), p90: quantile(sorted, .9), max: sorted[sorted.length - 1], mean: sorted.reduce((s, v) => s + v, 0) / sorted.length };
}

/** 分布用的档位（USDT）：对数间隔，交易里常说的「几百万 / 几千万 / 上亿」。 */
export const TURNOVER_BUCKETS: readonly { label: string; from: number; to: number }[] = [
  { label: '< 100万', from: 0, to: 1e6 },
  { label: '100万–500万', from: 1e6, to: 5e6 },
  { label: '500万–1000万', from: 5e6, to: 1e7 },
  { label: '1000万–5000万', from: 1e7, to: 5e7 },
  { label: '5000万–1亿', from: 5e7, to: 1e8 },
  { label: '1亿–5亿', from: 1e8, to: 5e8 },
  { label: '5亿–10亿', from: 5e8, to: 1e9 },
  { label: '≥ 10亿', from: 1e9, to: Infinity },
];
export const bucketTurnover = (values: readonly number[]) => TURNOVER_BUCKETS.map(b => values.filter(v => v >= b.from && v < b.to).length);

/** 金额写成「万 / 亿」（USDT），三位有效数字。 */
export function formatUsdtCn(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v), sig = (x: number) => Number(x.toPrecision(3)).toString();
  if (abs >= 1e8) return `${sig(v / 1e8)} 亿`;
  if (abs >= 1e4) return `${sig(v / 1e4)} 万`;
  return sig(v);
}

/** 由一个币截止前的 5m K 线算 24 小时成交额。 */
export function turnoverFromBars(bars: readonly ResearchBar[], cut: number): { turnover: number; hours: number } {
  const window = bars.filter(b => b.openTime >= cut - TURNOVER_WINDOW_MS && b.openTime < cut);
  if (!window.length) throw new FishError('信号前 24 小时没有 K 线（当时可能还没上市）', 'history');
  if (window.some(b => b.quoteVolume == null || !Number.isFinite(b.quoteVolume))) throw new FishError('成交额读数不全', 'readings');
  const turnover = window.reduce((s, b) => s + b.quoteVolume!, 0);
  const hours = Math.min(24, (cut - window[0].openTime) / 3_600_000);
  return { turnover, hours };
}

export async function collectSignalTurnover(options: SignalTurnoverOptions, load: SignalTurnoverLoader): Promise<SignalTurnoverResult> {
  const controller = new AbortController(), signal = controller.signal;
  const cancel = () => controller.abort(); options.signal.addEventListener('abort', cancel, { once: true }); if (options.signal.aborted) cancel();
  const list = [...options.signals].sort((a, b) => signalDedupKey(a).localeCompare(signalDedupKey(b)));
  const rows: SignalTurnoverRow[] = new Array(list.length);
  const progress: SignalTurnoverProgress = { status: 'running', done: 0, total: list.length, current: '' };
  const publish = () => options.onProgress({ ...progress }); publish();
  let next = 0, fatal: unknown;
  const worker = async () => {
    for (;;) {
      if (signal.aborted) return;
      const index = next++; if (index >= list.length) return;
      const s = list[index], base = { symbol: s.symbol, exchange: s.exchange, market: s.market, underlying: s.underlying, timeMs: s.timeMs, quality: normalizeSignalQuality(s.quality) };
      progress.current = s.symbol; publish();
      if (!Number.isFinite(s.timeMs) || s.timeMs <= 0 || !/^[A-Z0-9]{1,40}USDT$/.test(s.symbol)) rows[index] = { ...base, turnover: null, hours: 0, reason: '标的或时间无效' };
      else {
        const cut = Math.floor(s.timeMs / TURNOVER_STEP) * TURNOVER_STEP;
        try { const bars = await load({ symbol: s.symbol, timeMs: s.timeMs, exchange: s.exchange, market: s.market, underlying: s.underlying }, cut, signal); if (signal.aborted) return; rows[index] = { ...base, ...turnoverFromBars(bars, cut) }; }
        catch (error) {
          if (signal.aborted) return;
          if (error instanceof FishError && error.kind === 'banned') { fatal = error; controller.abort(); return; }
          rows[index] = { ...base, turnover: null, hours: 0, reason: error instanceof TypeError ? '浏览器拦截（网络 / 跨域）' : error instanceof Error ? error.message : String(error) };
        }
      }
      progress.done++; publish(); await fishDelay(0, signal).catch(() => {});
    }
  };
  try {
    await Promise.allSettled(Array.from({ length: Math.min(3, list.length) }, worker));
    if (fatal) throw fatal;
    const done = rows.filter(Boolean), values = done.flatMap(r => r.turnover === null ? [] : [r.turnover]);
    const result: SignalTurnoverResult = { version: 1, fingerprint: fishSignalFingerprint(options.signals), createdAt: Date.now(), total: list.length, rows: done, stats: summarizeTurnover(values), partial: done.filter(r => r.turnover !== null && r.hours < 24).length, complete: !options.signal.aborted && done.length === list.length };
    progress.status = result.complete ? 'complete' : 'cancelled'; progress.current = ''; publish();
    if (done.length) saveSignalTurnover(result);
    return result;
  } catch (error) { progress.status = options.signal.aborted ? 'cancelled' : 'aborted'; progress.current = ''; publish(); throw error; }
  finally { options.signal.removeEventListener('abort', cancel); }
}

/** 旧成交额缓存也能读取当前评分；取消评分后不能回退到缓存里的旧评分。 */
export function rateTurnoverRows(rows: readonly SignalTurnoverRow[], signals?: readonly TradeSignal[]): SignalTurnoverRow[] {
  if (!signals) return rows.map(r => ({ ...r, quality: normalizeSignalQuality(r.quality) }));
  const key = (r: Pick<SignalTurnoverRow, 'exchange' | 'market' | 'symbol' | 'timeMs'>) => JSON.stringify([r.exchange ?? 'binance', r.market ?? 'crypto', r.symbol, r.timeMs]);
  const current = new Map(signals.map(s => [signalDedupKey(s), s]));
  const legacy = new Map<string, TradeSignal[]>();
  for (const s of signals) { const k = key(s); legacy.set(k, [...(legacy.get(k) ?? []), s]); }
  return rows.map(r => {
    const exact = current.get(signalDedupKey(r as Pick<TradeSignal, 'exchange' | 'symbol' | 'timeMs' | 'market' | 'underlying'>));
    const candidates = legacy.get(key(r));
    // 老版美股缓存没有 underlying；同名出现多个身份时不能猜评分归属。
    const match = r.market === 'us_stock' && !r.underlying
      ? candidates?.length === 1 ? candidates[0] : undefined
      : exact ?? (!r.underlying && candidates?.length === 1 ? candidates[0] : undefined);
    return { ...r, quality: normalizeSignalQuality(match?.quality) };
  });
}

export function turnoverRatingSummary(rows: readonly SignalTurnoverRow[]) {
  return [1, 2, 3, 4, 5].map(quality => {
    const values = rows.filter(r => r.quality === quality && r.turnover !== null && Number.isFinite(r.turnover) && r.turnover >= 0).map(r => r.turnover!);
    return { quality, count: values.length, median: summarizeTurnover(values)?.p50 ?? null };
  });
}

/** 明细 CSV（UTF-8 带 BOM，Excel 直接打开不乱码）。 */
export function signalTurnoverCsv(result: SignalTurnoverResult, signals?: readonly TradeSignal[]): string {
  const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const lines = ['标的,交易所,信号时间(UTC+8),24h成交额(USDT),覆盖小时,说明,评分', ...rateTurnoverRows(result.rows, signals).sort((a, b) => a.timeMs - b.timeMs).map(r => [r.symbol, r.exchange ?? 'binance', formatUTC8(r.timeMs), r.turnover === null ? '' : r.turnover.toFixed(2), r.turnover === null ? '' : String(Number(r.hours.toFixed(2))), r.reason ?? (r.hours < 24 && r.turnover !== null ? '上市不足24小时，按上市以来计' : ''), r.quality === undefined ? '' : String(r.quality)].map(esc).join(','))];
  return '﻿' + lines.join('\n');
}

const storageKey = () => `veil:signal-turnover:v1:${getUserPrefix()}`;
export function saveSignalTurnover(result: SignalTurnoverResult): void {
  try { localStorage.setItem(storageKey(), JSON.stringify(result)); } catch { /* 存不下只是下次要重算 */ }
}
export function readSignalTurnover(): SignalTurnoverResult | null {
  try { const x = JSON.parse(localStorage.getItem(storageKey()) ?? 'null'); return x && x.version === 1 && Array.isArray(x.rows) ? x as SignalTurnoverResult : null; } catch { return null; }
}
