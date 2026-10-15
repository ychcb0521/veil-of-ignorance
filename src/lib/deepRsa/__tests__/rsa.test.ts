import { describe, expect, it } from 'vitest';
import {
  absDiffRdm, bhAdjust, categoricalRdm, euclideanRdm, fitStandardizer, holmAdjust, nearestByDistance, ranks, rsaMantel,
  runRsaPanel, selectHalfLife, spearman, standardize, type RsaEvent,
} from '@/lib/deepRsa/rsa';
import { chronologicalSplit, DEFAULT_EMBARGO_MS } from '@/lib/deepRsa/splits';
import { forwardOutcome, OUTCOME_HORIZON_MS } from '@/lib/deepRsa/outcome';
import { BAR_MS, type ResearchBar } from '@/lib/deepRsa/window';
import { mulberry32, WINDOW_MS } from '@/lib/deepRsa/grouping';

const DAY = 24 * 60 * 60_000;

describe('时间切分：不打乱，切口留隔离带', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ id: `e${i}`, anchorMs: i * DAY }));

  it('训练集全部早于验证集、验证集全部早于测试集；隔离带 = 48h + 结果期', () => {
    const s = chronologicalSplit(items);
    expect(s.embargoMs).toBe(WINDOW_MS + OUTCOME_HORIZON_MS);
    expect(Math.max(...s.train.map(e => e.anchorMs))).toBeLessThan(Math.min(...s.val.map(e => e.anchorMs)));
    expect(Math.max(...s.val.map(e => e.anchorMs))).toBeLessThan(Math.min(...s.test.map(e => e.anchorMs)));
    expect(s.train.length + s.val.length + s.test.length + s.embargoed.length).toBe(100);
  });

  it('切口后隔离带内的事件被剔出，如实计数（每天一个、隔离带 3 天 → 两处各丢 3 个）', () => {
    const s = chronologicalSplit(items);
    expect(DEFAULT_EMBARGO_MS).toBe(3 * DAY);
    expect(s.embargoed).toHaveLength(6);
    expect(s.train).toHaveLength(60);
    // 最后一个训练锚点的结果期，不会碰到第一个验证锚点的观察窗
    const lastTrain = Math.max(...s.train.map(e => e.anchorMs));
    const firstVal = Math.min(...s.val.map(e => e.anchorMs));
    expect(lastTrain + OUTCOME_HORIZON_MS).toBeLessThanOrEqual(firstVal - WINDOW_MS);
  });

  it('空输入不报错', () => {
    expect(chronologicalSplit([])).toMatchObject({ train: [], val: [], test: [], cutoffs: { val: null, test: null } });
  });
});

describe('独立未来结果：t₀ 后第一根完整 K 线开盘进场', () => {
  const t0 = Date.parse('2026-05-06T12:00:00Z');
  const bars: ResearchBar[] = Array.from({ length: 300 }, (_, i) => ({
    openTime: t0 - 10 * BAR_MS + i * BAR_MS, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1, takerBuyVolume: null,
  }));

  it('整点 t₀：进场 = t₀ 那根开盘；最高 / 最低 / 期末只取结果期内', () => {
    const o = forwardOutcome(bars, t0, 2 * 60 * 60_000)!;
    expect(o.entry).toBe(110);
    expect(o.maxUp).toBeCloseTo(Math.log((102 + 10 + 23) / 110), 12);
    expect(o.maxDown).toBeCloseTo(Math.log(109 / 110), 12);
    expect(o.endRet).toBeCloseTo(Math.log((101 + 33) / 110), 12);
    expect(o.coverage).toBe(1);
  });

  it('不整点 t₀：用下一根整点 K 线开盘，不用 t₀ 之前的价格', () => {
    expect(forwardOutcome(bars, t0 + 60_000, 60 * 60_000)!.entry).toBe(111);
  });

  it('进场那根缺失 → null，不另找价格凑', () => {
    expect(forwardOutcome(bars.filter(b => b.openTime !== t0), t0)).toBeNull();
  });
});

describe('标准化只用训练集', () => {
  it('均值 / 标准差来自训练集；常数列与有效值不足的列被弃用并列出', () => {
    const train = [{ a: 1, b: 5, c: null }, { a: 2, b: 5, c: 1 }, { a: 3, b: 5, c: null }];
    const s = fitStandardizer(train, ['a', 'b', 'c']);
    expect(s.keys).toEqual(['a']);
    expect(s.dropped).toEqual(['b', 'c']);
    expect(standardize([{ a: 4, b: 0, c: 0 }], s)).toEqual([[2]]);
  });
});

describe('RDM 与 Spearman', () => {
  it('欧氏 RDM：缺失维度按可比维度数缩放；可比维度不足 → NaN', () => {
    const rdm = euclideanRdm([[0, 0], [3, 4], [null, 1], [null, null]], 1);
    expect(rdm[0][1]).toBeCloseTo(5, 12);
    expect(rdm[0][2]).toBeCloseTo(Math.sqrt(2), 12); // 只比第 2 维：1² × 2/1
    expect(rdm[0][3]).toBeNaN();
    expect(rdm[1][0]).toBe(rdm[0][1]);
    expect(euclideanRdm([[0, 0], [null, 1]], 2)[0][1]).toBeNaN();
  });

  it('标签 RDM 同组 0、异组 1、缺失 NaN；结果 RDM = |差|', () => {
    expect(categoricalRdm(['positive', 'control', 'positive', null])).toEqual([
      [0, 1, 0, Number.NaN], [1, 0, 1, Number.NaN], [0, 1, 0, Number.NaN], [Number.NaN, Number.NaN, Number.NaN, 0],
    ]);
    expect(absDiffRdm([1, 4, null])[0][1]).toBe(3);
    expect(absDiffRdm([1, 4, null])[0][2]).toBeNaN();
  });

  it('并列取平均秩；Spearman 对单调变换不变', () => {
    expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
    expect(spearman([1, 2, 3, 4, 5], [1, 8, 27, 64, 125])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])).toBeCloseTo(-1, 12);
  });
});

/** n 个事件、两类：正样本的特征整体偏高（signal 控制信号强弱）。 */
function plant(n: number, signal: number, seed: number) {
  const random = mulberry32(seed);
  const labels = Array.from({ length: n }, (_, i) => (i % 2 ? 'positive' : 'control'));
  const z = labels.map(l => [0, 1, 2].map(() => (random() - 0.5) * 2 + (l === 'positive' ? signal : 0)));
  return { labels, z };
}

describe('Mantel 置换检验：事件对不当独立样本', () => {
  it('植入结构 → ρ > 0 且 p 很小；无结构 → p 不小', () => {
    const strong = plant(30, 2, 3);
    const r1 = rsaMantel(euclideanRdm(strong.z), categoricalRdm(strong.labels), { permutations: 499, seed: 11 });
    expect(r1.rho).toBeGreaterThan(0.2);
    expect(r1.p).toBeLessThan(0.01);
    expect(r1.nPairs).toBe(435);
    const none = plant(30, 0, 4);
    const r0 = rsaMantel(euclideanRdm(none.z), categoricalRdm(none.labels), { permutations: 499, seed: 11 });
    expect(r0.p).toBeGreaterThan(0.05);
  });

  it('同一 seed 结果可复现；p 的下限是 1 / (置换次数 + 1)', () => {
    const d = plant(20, 3, 5);
    const a = rsaMantel(euclideanRdm(d.z), categoricalRdm(d.labels), { permutations: 99, seed: 2 });
    const b = rsaMantel(euclideanRdm(d.z), categoricalRdm(d.labels), { permutations: 99, seed: 2 });
    expect(a).toEqual(b);
    expect(a.p).toBeGreaterThanOrEqual(1 / 100);
  });

  it('按块置换：标签与块完全重合时，块内打乱不改变任何东西 → p = 1', () => {
    const d = plant(20, 3, 6);
    const r = rsaMantel(euclideanRdm(d.z), categoricalRdm(d.labels), { permutations: 99, seed: 1, blocks: d.labels });
    expect(r.p).toBe(1);
  });
});

describe('多重比较校正', () => {
  it('Holm：经典例子', () => {
    expect(holmAdjust([0.01, 0.04, 0.03, 0.005])).toEqual([0.03, 0.06, 0.06, 0.02].map(v => expect.closeTo(v, 12)));
  });

  it('BH：经典例子；NaN 不计入族', () => {
    const adj = bhAdjust([0.01, 0.04, 0.03, 0.005, Number.NaN]);
    expect(adj.slice(0, 4)).toEqual([0.02, 0.04, 0.04, 0.02].map(v => expect.closeTo(v, 12)));
    expect(adj[4]).toBeNaN();
  });
});

describe('检验面板、半衰期选择、相似案例', () => {
  it('表征 × 半衰期 × 目标全部列出，Holm 在整个面板上一起校正', () => {
    const d = plant(24, 2, 9);
    const train: RsaEvent[] = d.labels.map((label, i) => ({
      id: `e${i}`,
      featuresByH: Object.fromEntries([2, 6, 12].map(h => [h, { x: d.z[i][0], y: d.z[i][1], q: d.z[i][2] * h }])),
      label,
      outcome: d.z[i][0],
    }));
    const panel = runRsaPanel(train, [{ name: 'price', keys: ['x', 'y'] }, { name: 'flow', keys: ['q'] }], [2, 6, 12], { permutations: 99, minDims: 1 });
    expect(panel).toHaveLength(2 * 3 * 2);
    const m = panel.length;
    const minP = Math.min(...panel.map(r => r.p));
    expect(Math.min(...panel.map(r => r.pHolm))).toBeCloseTo(Math.min(1, m * minP), 12);
    for (const r of panel) expect(r.pHolm).toBeGreaterThanOrEqual(r.p);
  });

  it('半衰期取验证集 ρ 最大者；并列取靠前；全 NaN 不选', () => {
    expect(selectHalfLife([{ halfLifeHours: 2, rho: 0.1 }, { halfLifeHours: 6, rho: 0.3 }, { halfLifeHours: 12, rho: 0.3 }])).toBe(6);
    expect(selectHalfLife([{ halfLifeHours: 2, rho: Number.NaN }])).toBeNull();
  });

  it('相似案例：只在候选里找，排除自身与不可比的', () => {
    const rdm = euclideanRdm([[0], [1], [5], [null]], 1);
    expect(nearestByDistance(rdm, 0, [0, 2, 1, 3], 2)).toEqual([{ index: 1, distance: 1 }, { index: 2, distance: 5 }]);
  });
});
