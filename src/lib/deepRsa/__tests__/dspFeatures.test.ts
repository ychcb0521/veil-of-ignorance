import { describe, expect, it } from 'vitest';
import { computeDsp } from '@/lib/dynamicSchellingPoint';
import { computeDspFeatures } from '../dspFeatures';
import { mulberry32 } from '../grouping';
import { BAR_MS, extractWindow, type ResearchBar } from '../window';

const ANCHOR = Date.parse('2026-04-12T05:05:00Z');

function bars(n = 576, opts: { amountsEvery?: number; seed?: number } = {}): ResearchBar[] {
  const rand = mulberry32(opts.seed ?? 3);
  let p = 1;
  return Array.from({ length: n }, (_, i) => {
    const open = p;
    p *= Math.exp(0.004 * (rand() - 0.48));
    const q = 1e5 * (0.5 + rand());
    const hasAmounts = opts.amountsEvery == null || i % opts.amountsEvery !== 0;
    return {
      openTime: ANCHOR - (n - i) * BAR_MS, open, high: Math.max(open, p) * 1.001, low: Math.min(open, p) * 0.999, close: p,
      volume: q / p, takerBuyVolume: null,
      quoteVolume: hasAmounts ? q : null, takerBuyQuoteVolume: hasAmounts ? q * rand() : null,
    };
  });
}

describe('第 7 步 · 进场时的 DSP 读数', () => {
  it('与主图指标同一个 computeDsp：取观察窗最后一根的 V、A 与 ln(C ÷ DSP)', () => {
    const b = bars();
    const f = computeDspFeatures(extractWindow(b, ANCHOR), 6);
    const pts = computeDsp(b.map(x => ({ time: x.openTime, close: x.close, quoteVolume: x.quoteVolume, takerBuyQuoteVolume: x.takerBuyQuoteVolume })), { halfLifeHours: 6 }, BAR_MS);
    const last = pts.at(-1)!;
    expect(f.dsp_v).toBeCloseTo(last.v!, 15);
    expect(f.dsp_a).toBeCloseTo(last.a!, 12);
    expect(f.dsp_gap).toBeCloseTo(Math.log(b.at(-1)!.close / last.dsp!), 12);
  });

  it('不看未来：t₀ 之后的 K 线不影响读数', () => {
    const b = bars();
    const future = Array.from({ length: 50 }, (_, i) => ({ ...b.at(-1)!, openTime: ANCHOR + i * BAR_MS, close: 999, quoteVolume: 1e9, takerBuyQuoteVolume: 1e9 }));
    expect(computeDspFeatures(extractWindow([...b, ...future], ANCHOR), 6)).toEqual(computeDspFeatures(extractWindow(b, ANCHOR), 6));
  });

  it('半衰期越短，V 对最近的变化越敏感；不同 h 给出不同读数', () => {
    const w = extractWindow(bars(), ANCHOR);
    expect(computeDspFeatures(w, 2).dsp_v).not.toBeCloseTo(computeDspFeatures(w, 12).dsp_v!, 12);
    // A 是单根读数，与 h 无关
    expect(computeDspFeatures(w, 2).dsp_a).toBe(computeDspFeatures(w, 12).dsp_a);
  });

  it('带金额的 K 线不到 95% → 三项都缺失（不拿币数凑）；95% 以上照算', () => {
    expect(computeDspFeatures(extractWindow(bars(576, { amountsEvery: 10 }), ANCHOR), 6)).toEqual({ dsp_v: null, dsp_a: null, dsp_gap: null });
    expect(computeDspFeatures(extractWindow(bars(576, { amountsEvery: 50 }), ANCHOR), 6).dsp_v).not.toBeNull();
    expect(computeDspFeatures(extractWindow([], ANCHOR), 6)).toEqual({ dsp_v: null, dsp_a: null, dsp_gap: null });
  });
});
