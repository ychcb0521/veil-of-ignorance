import { describe, expect, it } from 'vitest';
import { analyzeFeatureDeepDive, auc, clusterBootstrapCi, partialSpearman, permutationP, DEEP_DIVE_FEATURES, DSP_STUDY, FEATURES_STUDY } from '../deepDive';
import { mulberry32 } from '../grouping';
import type { RunEvent } from '../pipeline';

/** 正态近似（Box–Muller），确定性。 */
function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * 植入结构：
 *  - taker_imb_w → 24h 期末收益（真实的方向信息）；
 *  - 谢林偏离只通过波动率与最大涨幅相关（vol 同时推高偏离幅度与最大涨幅）——控制波动率后应消失；
 *  - 正样本的失衡偏高。
 */
function syntheticEvents(n: number, seed: number, { signal = true }: { signal?: boolean } = {}): RunEvent[] {
  const rand = mulberry32(seed);
  const t0 = Date.parse('2025-01-01T00:00:00Z');
  return Array.from({ length: n }, (_, i) => {
    const vol = 0.005 + 0.02 * rand();
    const imb = 0.2 * normal(rand);
    const shift = 0.1 * normal(rand);
    const dev = vol * 3 + 0.01 * normal(rand);
    const poc = vol * 2 + 0.01 * normal(rand);
    const endRet = (signal ? 0.15 * imb : 0) + 0.03 * normal(rand);
    const maxUp = vol * 4 + 0.005 * rand();
    const maxDown = -(vol * 4 + 0.005 * rand());
    const kind = i % 3 === 0 ? 'background' : 'event';
    const label = kind === 'background' ? null : (signal ? imb > 0.15 : rand() < 0.2) ? 'positive' : 'control';
    const features = { vol_w: vol, taker_imb_w: imb, taker_imb_shift_w: shift, vwap12_dev: dev, poc_dev_w: poc, fallback_dev: null };
    return {
      id: `e${i}`, symbol: `S${i % 25}USDT`, anchorMs: t0 + i * 6 * 3_600_000, kind,
      featuresByH: { 2: features, 6: features, 12: features }, label, outcome: maxUp,
      block: new Date(t0 + i * 6 * 3_600_000).toISOString().slice(0, 7), momentum: null,
      maxUp, maxDown, endRet,
    } as RunEvent;
  });
}

describe('Deep RSA 第 6 步 · 特征深挖的统计工具', () => {
  it('偏 Spearman 剔除共同驱动因素：x、y 都只由 z 决定时接近 0', () => {
    const rand = mulberry32(1);
    const z = Array.from({ length: 300 }, () => rand());
    const x = z.map(v => v + 0.05 * normal(rand));
    const y = z.map(v => v * 2 + 0.05 * normal(rand));
    expect(Math.abs(partialSpearman(x, y, z))).toBeLessThan(0.15);
  });

  it('AUC：完全分开为 1，完全相同为 0.5', () => {
    expect(auc([3, 4, 5], [0, 1, 2])).toBe(1);
    expect(auc([1, 1], [1, 1])).toBe(0.5);
  });

  it('置换 p 的下限是 1 / (n + 1)；无关时不显著', () => {
    const x = Array.from({ length: 100 }, (_, i) => i);
    const blocks = x.map(() => 'b');
    expect(permutationP(y => y.reduce((s, v, i) => s + v * x[i], 0), x, blocks, { permutations: 199, seed: 3, tail: 'greater' })).toBeCloseTo(1 / 200, 9);
    const rand = mulberry32(9);
    const noise = x.map(() => rand());
    const p = permutationP(y => y.reduce((s, v, i) => s + v * (x[i] - 50), 0), noise, blocks, { permutations: 199, seed: 4 });
    expect(p).toBeGreaterThan(0.05);
  });

  it('整簇重抽样区间包住真实值', () => {
    // 12 个簇，簇均值 0…11，总体均值 5.5
    const vals = Array.from({ length: 60 }, (_, i) => i % 12);
    const ci = clusterBootstrapCi(idx => idx.reduce((s, i) => s + vals[i], 0) / idx.length, vals.map((_, i) => `c${i % 12}`), { reps: 300, seed: 5 })!;
    expect(ci[0]).toBeLessThan(5.5);
    expect(ci[1]).toBeGreaterThan(5.5);
    expect(ci[1] - ci[0]).toBeGreaterThan(1);
  });
});

// 12 个检验整族 Holm：置换次数 n 时校正后最小 p = 12 / (n + 1)，199 次（0.06）永远过不了 0.05，这里用 599 次
describe('Deep RSA 第 6 步 · 一整轮分析（合成数据）', { timeout: 60_000 }, () => {
  const result = analyzeFeatureDeepDive(syntheticEvents(360, 11), { permutations: 599, bootstrap: 99 });
  const row = (feature: string, target: string) => result.association.find(r => r.feature === feature && r.target === target)!;

  it('发现集 12 个主检验整族 Holm；植入的「失衡 → 期末收益」被检出并在确认集复现', () => {
    expect(result.association).toHaveLength(12);
    expect(row('taker_imb_w', 'endRet').rho).toBeGreaterThan(0.3);
    expect(row('taker_imb_w', 'endRet').pHolm).toBeLessThan(0.05);
    const conf = result.confirmation.find(r => r.feature === 'taker_imb_w' && r.target === 'endRet')!;
    expect(conf.verdict).toBe('已验证');
    expect(conf.survivesVolControl).toBe(true);
    expect(result.conclusions.verified.map(v => `${v.feature}:${v.target}`)).toContain('taker_imb_w:endRet');
  });

  it('只靠波动率撑起来的「谢林 → 最大涨幅」：原始 ρ 很高，控制波动率后消失；最大跌幅同样「相关」（阴性对照报警）', () => {
    expect(row('vwap12_dev', 'maxUp').rho).toBeGreaterThan(0.5);
    expect(Math.abs(row('vwap12_dev', 'maxUp').rhoPartialVol)).toBeLessThan(0.2);
    expect(row('vwap12_dev', 'maxDown').rho).toBeLessThan(-0.5);
    const conf = result.confirmation.find(r => r.feature === 'vwap12_dev' && r.target === 'maxUp');
    if (conf) expect(conf.survivesVolControl).toBe(false);
  });

  it('标签：正样本失衡偏高 → AUC 明显大于 0.5；分档、子集、半衰期、交叉表齐全', () => {
    const imb = result.labels.find(r => r.feature === 'taker_imb_w')!;
    expect(imb.auc).toBeGreaterThan(0.8);
    expect(imb.pHolm).toBeLessThan(0.05);
    expect(result.quintiles).toHaveLength(DEEP_DIVE_FEATURES.length);
    expect(result.quintiles[0].bins).toHaveLength(5);
    expect(result.quintiles[0].bins.reduce((s, b) => s + b.n, 0)).toBe(360);
    expect(result.robustness.bySubset).toHaveLength(4 * 3 * 2);
    expect(result.robustness.byHalfLife).toHaveLength(3 * 3 * 3);
    expect(result.interaction).toHaveLength(4);
    expect(result.interaction.reduce((s, c) => s + c.n, 0)).toBe(360);
  });

  it('没有植入信号时，失衡 → 期末收益不被判定为已验证', () => {
    const none = analyzeFeatureDeepDive(syntheticEvents(360, 12, { signal: false }), { permutations: 599, bootstrap: 99 });
    expect(none.conclusions.verified.map(v => `${v.feature}:${v.target}`)).not.toContain('taker_imb_w:endRet');
  });
});

/**
 * 第 7 步（动态谢林点）：同一套统计、换特征清单。植入：
 *  - dsp_v → 24h 期末收益（真实的方向信息）；
 *  - dsp_gap 只通过波动率与最大涨幅相关——控制波动率后应消失，最大跌幅同样「相关」；
 *  - dsp_a 纯噪声。
 */
function syntheticDspEvents(n: number, seed: number, { signal = true }: { signal?: boolean } = {}): RunEvent[] {
  const rand = mulberry32(seed);
  const t0 = Date.parse('2025-01-01T00:00:00Z');
  return Array.from({ length: n }, (_, i) => {
    const vol = 0.005 + 0.02 * rand();
    const v = 2e-4 * normal(rand);
    const a = 0.3 * normal(rand);
    const gap = vol * 3 + 0.01 * normal(rand);
    const endRet = (signal ? 300 * v : 0) + 0.03 * normal(rand);
    const maxUp = vol * 4 + 0.005 * rand();
    const maxDown = -(vol * 4 + 0.005 * rand());
    const kind = i % 3 === 0 ? 'background' : 'event';
    const label = kind === 'background' ? null : rand() < 0.2 ? 'positive' : 'control';
    const features = { vol_w: vol, dsp_v: v, dsp_a: a, dsp_gap: gap };
    return {
      id: `d${i}`, symbol: `S${i % 25}USDT`, anchorMs: t0 + i * 6 * 3_600_000, kind,
      featuresByH: { 2: { ...features, dsp_v: v * 1.1 }, 6: features, 12: { ...features, dsp_v: v * 0.9 } }, label, outcome: maxUp,
      block: new Date(t0 + i * 6 * 3_600_000).toISOString().slice(0, 7), momentum: null,
      maxUp, maxDown, endRet,
    } as RunEvent;
  });
}

// 9 个检验整族 Holm：599 次置换时校正后最小 p = 9 / 600 = 0.015
describe('Deep RSA 第 7 步 · 动态谢林点检验（合成数据）', { timeout: 60_000 }, () => {
  const result = analyzeFeatureDeepDive(syntheticDspEvents(360, 21), { permutations: 599, bootstrap: 99, study: DSP_STUDY });
  const row = (feature: string, target: string) => result.association.find(r => r.feature === feature && r.target === target)!;

  it('3 个特征 × 3 个结果 = 9 个主检验；植入的「V → 期末收益」被检出、在确认集复现、控制波动率后仍成立', () => {
    expect(result.study).toBe('dsp');
    expect(result.association).toHaveLength(9);
    expect(row('dsp_v', 'endRet').rho).toBeGreaterThan(0.3);
    expect(row('dsp_v', 'endRet').pHolm).toBeLessThan(0.05);
    const conf = result.confirmation.find(r => r.feature === 'dsp_v' && r.target === 'endRet')!;
    expect(conf.verdict).toBe('已验证');
    expect(conf.survivesVolControl).toBe(true);
    expect(row('dsp_a', 'endRet').pHolm).toBeGreaterThan(0.05);
  });

  it('只靠波动率的偏离：控制波动率后消失，最大跌幅同样「相关」；交叉表按 偏离 × V 分四格', () => {
    expect(row('dsp_gap', 'maxUp').rho).toBeGreaterThan(0.5);
    expect(Math.abs(row('dsp_gap', 'maxUp').rhoPartialVol)).toBeLessThan(0.2);
    expect(row('dsp_gap', 'maxDown').rho).toBeLessThan(-0.5);
    expect(result.interaction).toHaveLength(4);
    expect(result.interaction.reduce((s, c) => s + c.n, 0)).toBe(360);
    // 半衰期敏感性只对加权特征（dsp_v、dsp_gap）
    expect(new Set(result.robustness.byHalfLife.map(r => r.feature))).toEqual(new Set(['dsp_v', 'dsp_gap']));
  });

  it('没有植入信号时不判定为已验证', () => {
    const none = analyzeFeatureDeepDive(syntheticDspEvents(360, 22, { signal: false }), { permutations: 599, bootstrap: 99, study: DSP_STUDY });
    expect(none.conclusions.verified.map(v => `${v.feature}:${v.target}`)).not.toContain('dsp_v:endRet');
  });

  it('默认仍是第 6 步：特征清单与交叉表不变', () => {
    expect(FEATURES_STUDY.features.map(f => f.key)).toEqual(['taker_imb_w', 'taker_imb_shift_w', 'vwap12_dev', 'poc_dev_w']);
    expect(FEATURES_STUDY.interaction.first.key).toBe('vwap12_dev');
  });
});
