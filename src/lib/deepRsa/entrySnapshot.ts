/**
 * 进场时的谢林偏离（单场 / 单条信号）：t₀ 前 48h 的 5m K 线 → 偏离 12h VWAP、偏离成交密集区 POC、偏离兜底价。
 *
 * 【用户要求】2026-10-15「我想可以能够看到每一场战役在进场时的具体数值（或者信号的具体数值）」。
 * 与 Deep RSA 第 3 / 6 步同一套算法（rollingVwap、weightedPoc、extractWindow），POC 用主分析的半衰期 h = 6 小时；
 * 只描述当时的盘面，不是交易信号（第 6 步没有验证它能预测方向）。纯函数，不读网络。
 */
import { rollingVwap, weightedPoc } from '@/lib/deepRsa/features';
import { decayWeights, extractWindow, type ResearchBar } from '@/lib/deepRsa/window';

export const ENTRY_SNAPSHOT_HALF_LIFE_H = 6;
/** 与 Deep RSA 的覆盖率门槛一致：低于它照样算，但界面标「覆盖不足」。 */
export const ENTRY_SNAPSHOT_MIN_COVERAGE = 0.95;

export interface EntrySnapshot {
  anchorMs: number;
  /** 进场前最后一根已收盘 5m K 线的收盘价 C_N。 */
  close: number;
  /** 那根 K 线的收盘时刻（openTime + 5m）。 */
  closeTimeMs: number;
  vwap: number | null;
  /** ln(C_N ÷ VWAP₁₂ₕ) */
  vwapDev: number | null;
  poc: number | null;
  /** ln(C_N ÷ POC)，h = 6 */
  pocDev: number | null;
  /** 观察窗覆盖率（已收盘 K 线数 ÷ 应有根数）。 */
  coverage: number;
}

const finiteOrNull = (v: number) => (Number.isFinite(v) ? v : null);

export function computeEntrySnapshot(bars: readonly ResearchBar[], anchorMs: number): EntrySnapshot | null {
  const window = extractWindow(bars, anchorMs);
  if (window.bars.length === 0) return null;
  const last = window.bars[window.bars.length - 1];
  const vwap = rollingVwap(window.bars, anchorMs);
  const poc = weightedPoc(window.bars, decayWeights(window.bars, anchorMs, ENTRY_SNAPSHOT_HALF_LIFE_H));
  return {
    anchorMs,
    close: last.close,
    closeTimeMs: last.openTime + 5 * 60_000,
    vwap,
    vwapDev: vwap != null && vwap > 0 ? finiteOrNull(Math.log(last.close / vwap)) : null,
    poc,
    pocDev: poc != null && poc > 0 ? finiteOrNull(Math.log(last.close / poc)) : null,
    coverage: window.coverage,
  };
}

/** ln(C_N ÷ 兜底价)：信号库的候选 c。 */
export function fallbackDeviation(close: number, fallbackPrice: number | null): number | null {
  return fallbackPrice != null && fallbackPrice > 0 && close > 0 ? finiteOrNull(Math.log(close / fallbackPrice)) : null;
}

/**
 * 兜底区文本 → 兜底价：开头的一个价格（「0.71」「189（无）」「2.38 触发 涨至2.907」取 2.38），
 * 开头是区间（「0.12-0.13」「0.12~0.13」）取中点；开头不是数字（纯备注）→ null。
 */
export function parseFallbackPrice(zone: string | null | undefined): number | null {
  if (!zone) return null;
  const m = /^\s*(\d+(?:\.\d+)?)(?:\s*[-~～—–至到]\s*(\d+(?:\.\d+)?))?/.exec(zone);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] != null ? Number(m[2]) : null;
  const price = b != null && b > 0 ? (a + b) / 2 : a;
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** 对数偏离 → 百分比读数（e^x − 1），带符号一位小数：0.0555 → +5.7%。 */
export function formatEntryDeviation(ln: number | null | undefined): string {
  if (ln == null || !Number.isFinite(ln)) return '—';
  const pct = (Math.exp(ln) - 1) * 100;
  const text = Math.abs(pct) >= 100 ? pct.toFixed(0) : pct.toFixed(1);
  if (Number(text) === 0) return '0.0%';
  return `${pct > 0 ? '+' : '−'}${text.replace('-', '')}%`;
}

/** 价格读数：按量级保留有效位（0.000481 / 0.1355 / 1.234 / 105.2 / 63250）。 */
export function formatEntryPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return '—';
  const abs = Math.abs(price);
  const digits = abs >= 1000 ? 1 : abs >= 1 ? 4 : Math.min(8, 3 - Math.floor(Math.log10(abs)));
  return Number(price.toFixed(digits)).toString();
}
