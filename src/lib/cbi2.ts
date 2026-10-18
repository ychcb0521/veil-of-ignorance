/**
 * CBI-2 买方优势指数第 2 版（K 线图副图）：直接算 Deep dig 里的同一份公式（CBI2_FORMULA），两边天然逐根一致。
 * 【用户要求】2026-10-18 按用户笔记新增，公式、取定与原文的差别写在 src/lib/deepDig/features.ts 的 CBI2_FORMULA 旁。
 * K 线图上与其他指标同一约定：窗口按根计（所有周期一样），基线 avgh 小时按 5 分钟图计。纯函数，不读网络（BTC 由调用方给 refClose）。
 */
import { CBI2_FORMULA, compileFeatureFormula, evaluateOnBars, type CompiledFeature } from '@/lib/deepDig/features';
import { lastValue } from '@/lib/deepDig/formula';
import type { ResearchBar } from '@/lib/deepRsa/window';

export const CBI2_DEFAULTS = { baseHours: 24 } as const;

export const CBI2_DEFINITION = 'CBI-2 买方优势指数第 2 版（−1 ~ 1）= 2p − 1，p = 上涨的概率：顺势分支 L₁（主动性、买盘增减、吸收、剔除 BTC 的动量、均价偏离与漂移、收盘位置、意外度）与吸收分支 L₂（快速吸收、卖盘衰竭）按恐慌度 Ψ 混合。0 = 五五开，0.1 ≈ 55:45。';
export const CBI2_STEPS = [
  'CBI-2 = 2p − 1；p = (1 − Ψ)·σ(L₁) + Ψ·σ(L₂)，σ = logistic',
  'L₁ = g·(0.07·ẑ_F + 0.04·ẑ_ΔF + 0.07·ẑ_A + 0.07·ẑ_Mo + 0.04·ẑ_d + 0.04·ẑ_v + 0.02·ẑ_K) + 0.2·min(ẑ_U, 0)；g = 2·RV² ÷ (1 + RV²)',
  'L₂ = −0.5 + 0.35·ẑ_Af + 0.25·ẑ_Ex；Ψ = σ(4·(ln RV₂₄ − ln 2.5))·σ(2·(DD − 3))',
  'ẑ = 稳健 z 截断到 ±3：(X − 中性点) ÷ (1.4826·MAD)，F 的中性点 = 基线中位数、其余 0',
  'F 主动买卖失衡（12 根）、ΔF = F₆ − F₂₄、A / A_f 吸收（24 / 12 根，κ = 0.5）、U 意外度、Mo 剔除 BTC 的动量（m = 6）、d / v 均价偏离与漂移、K 最近 12 根的收盘位置、Ex 卖盘衰竭、DD 距 48 根最高收盘的回撤',
  '基线 = 截至上一根过去 24 小时（原文 V̄ 20 天同时段、MAD / λ₀ / s_e / ATR̄ 14 天，拿不到）；φ = 过去 1 天对 BTC 的回归斜率；BTC 取不到时不剔除',
].join('\n');

export interface Cbi2Bar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  quoteVolume?: number | null;
  takerBuyQuoteVolume?: number | null;
  /** 同开盘时间的 BTCUSDT 收盘价。 */
  refClose?: number | null;
}

export interface Cbi2Point {
  cbi2: number | null;
  p: number | null;
  psi: number | null;
  l1: number | null;
  l2: number | null;
}

let compiled: CompiledFeature | null = null;

/** 逐根算 CBI-2；baseHours = 基线回看小时（公式里的 avgh），窗口按 5 分钟图的根数。 */
export function computeCbi2(bars: readonly Cbi2Bar[], params: { baseHours?: number } = {}): Cbi2Point[] {
  compiled ??= compileFeatureFormula(CBI2_FORMULA);
  const research: ResearchBar[] = bars.map((b, i) => ({
    openTime: i * 300_000, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? Number.NaN,
    takerBuyVolume: null, quoteVolume: b.quoteVolume ?? null, takerBuyQuoteVolume: b.takerBuyQuoteVolume ?? null, refClose: b.refClose ?? null,
  }));
  const { vars } = evaluateOnBars(research, compiled, { avgHours: params.baseHours ?? CBI2_DEFAULTS.baseHours });
  const at = (name: string, i: number) => {
    const v = vars.get(name);
    if (v == null) return null;
    return typeof v === 'number' ? lastValue(v) : lastValue(v[i]);
  };
  return bars.map((_, i) => ({ cbi2: at('CBI2', i), p: at('p', i), psi: at('Psi', i), l1: at('L1', i), l2: at('L2', i) }));
}
