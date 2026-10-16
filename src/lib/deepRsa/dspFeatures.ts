/**
 * Deep RSA 第 7 步：进场时的动态谢林点读数（见 docs/deep-rsa/12-dsp-test.md）。
 *
 * 观察窗 [t₀ − 48h, t₀) 的已收盘 5m K 线上从头算 DSP（DSP₀ = 窗口第一根收盘价，α = κ = 1），取最后一根：
 *   dsp_v   = Vₜ（对数 / 根）
 *   dsp_a   = Aₜ（按成交金额）
 *   dsp_gap = ln(Cₜ ÷ DSPₜ)
 * 与主图上的 DSP 指标是同一个 computeDsp。窗口里带成交额与主动买入额的 K 线不到 95% → 三项都记缺失，不拿币数凑。
 */
import { computeDsp, DSP_DEFAULTS } from '@/lib/dynamicSchellingPoint';
import { BAR_MS, type ObservationWindow } from '@/lib/deepRsa/window';

export const DSP_FEATURE_KEYS = ['dsp_v', 'dsp_a', 'dsp_gap'] as const;
export type DspFeatureKey = (typeof DSP_FEATURE_KEYS)[number];
export const DSP_MIN_AMOUNT_COVERAGE = 0.95;

const EMPTY: Record<DspFeatureKey, number | null> = { dsp_v: null, dsp_a: null, dsp_gap: null };

export function computeDspFeatures(window: ObservationWindow, halfLifeHours: number): Record<DspFeatureKey, number | null> {
  const bars = window.bars;
  if (bars.length === 0) return { ...EMPTY };
  const withAmounts = bars.filter(b => b.quoteVolume != null && b.takerBuyQuoteVolume != null).length;
  if (withAmounts < DSP_MIN_AMOUNT_COVERAGE * bars.length) return { ...EMPTY };
  const points = computeDsp(
    bars.map(b => ({ time: b.openTime, close: b.close, quoteVolume: b.quoteVolume ?? null, takerBuyQuoteVolume: b.takerBuyQuoteVolume ?? null })),
    { ...DSP_DEFAULTS, halfLifeHours },
    BAR_MS,
  );
  const last = points[points.length - 1];
  const close = bars[bars.length - 1].close;
  const gap = last.dsp != null && last.dsp > 0 && close > 0 ? Math.log(close / last.dsp) : null;
  return {
    dsp_v: last.v != null && Number.isFinite(last.v) ? last.v : null,
    dsp_a: last.a != null && Number.isFinite(last.a) ? last.a : null,
    dsp_gap: gap != null && Number.isFinite(gap) ? gap : null,
  };
}
