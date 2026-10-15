import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../grouping';
import type { RunEvent } from '../pipeline';
import { absDiffRdm, rsaMantel, rsaPartialMantel } from '../rsa';
import { chronologicalSplit } from '../splits';
import { ROBUSTNESS_CHECKS, runRobustness } from '../robustness';

function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

describe('偏 Mantel：剔除控制 RDM', () => {
  const rand = mulberry32(5);
  const n = 70;
  const z = Array.from({ length: n }, () => rand());
  const own = Array.from({ length: n }, () => rand());

  it('表征、目标都只由 z 决定：原始 Mantel 很强，剔除 |Δz| 后不显著', () => {
    const x = z.map(v => v + 0.02 * normal(rand));
    const y = z.map(v => 2 * v + 0.02 * normal(rand));
    const raw = rsaMantel(absDiffRdm(x), absDiffRdm(y), { permutations: 199, seed: 1 });
    const partial = rsaPartialMantel(absDiffRdm(x), absDiffRdm(y), absDiffRdm(z), { permutations: 199, seed: 1 });
    expect(raw.rho).toBeGreaterThan(0.5);
    expect(raw.p).toBeLessThan(0.01);
    expect(partial.rho).toBeLessThan(raw.rho - 0.3);
    expect(partial.p).toBeGreaterThan(0.05);
  });

  it('表征与目标共享 z 之外的信息：剔除后仍显著；同一 seed 可复现', () => {
    const x = own.map((v, i) => v + 0.3 * z[i]);
    const y = own.map((v, i) => v + 0.3 * z[i] + 0.05 * normal(rand));
    const a = rsaPartialMantel(absDiffRdm(x), absDiffRdm(y), absDiffRdm(z), { permutations: 199, seed: 2 });
    const b = rsaPartialMantel(absDiffRdm(x), absDiffRdm(y), absDiffRdm(z), { permutations: 199, seed: 2 });
    expect(a.rho).toBeGreaterThan(0.3);
    expect(a.p).toBeCloseTo(1 / 200, 9);
    expect(b).toEqual(a);
  });

  it('有缺失的事件对剔除；有效对太少返回 NaN', () => {
    const r = rsaPartialMantel(absDiffRdm([1, 2, null]), absDiffRdm([1, 2, 3]), absDiffRdm([0, 1, 2]), { permutations: 9 });
    expect(r.nPairs).toBe(1);
    expect(Number.isNaN(r.rho)).toBe(true);
  });
});

/**
 * 植入：
 *  - 「波动」表征（vol 的影子）只通过波动率与最大涨幅相关 → ① 剔除后消失、③b 最大跌幅同样相关（阴性对照报警）、③a 期末收益不相关；
 *  - 结果全由币决定的另一组（见第二个用例）→ ④ 按标的分块后消失。
 */
function events(n: number, seed: number): RunEvent[] {
  const rand = mulberry32(seed);
  const t0 = Date.parse('2025-01-01T00:00:00Z');
  return Array.from({ length: n }, (_, i) => {
    const vol = 0.005 + 0.02 * rand();
    const f = { vol_w: vol, shadow_a: vol * 3 + 0.002 * normal(rand), shadow_b: vol * 2 + 0.002 * normal(rand) };
    const maxUp = vol * 4 + 0.004 * rand();
    const kind = i % 3 === 0 ? 'background' : 'event';
    return {
      id: `e${i}`, symbol: `S${i % 20}USDT`, anchorMs: t0 + i * 8 * 3_600_000, kind,
      featuresByH: { 6: f }, label: kind === 'event' ? (i % 4 === 1 ? 'positive' : 'control') : null,
      outcome: maxUp, block: new Date(t0 + i * 8 * 3_600_000).toISOString().slice(0, 7), momentum: null,
      maxUp, maxDown: -(vol * 4 + 0.004 * rand()), endRet: 0.02 * normal(rand),
    } as RunEvent;
  });
}

describe('稳健性检验整轮（合成数据）', { timeout: 60_000 }, () => {
  const rep = { name: 'shadow', keys: ['shadow_a', 'shadow_b'] };

  it('只靠波动率的表征：原结论在 ② 只看战役时仍在，但 ① 剔除波动率后消失、③b 阴性对照报警、③a 无方向', async () => {
    const split = chronologicalSplit(events(240, 3));
    const steps: number[] = [];
    const r = await runRobustness(split, [{ representation: 'shadow', target: 'outcome', halfLifeHours: 6 }], [rep], () => 6,
      { permutations: 199, seed: 9, alpha: 0.05 }, { onStep: done => { steps.push(done); } });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].checks).toHaveLength(2 * ROBUSTNESS_CHECKS.length);
    const get = (check: string, period: string) => r.rows[0].checks.find(c => c.check === check && c.period === period)!;
    for (const period of ['discovery', 'test']) {
      expect(get('campaignOnly', period).p).toBeLessThan(0.05);
      expect(get('volPartial', period).p).toBeGreaterThan(0.05);
      expect(get('maxDown', period).p).toBeLessThan(0.05);
      expect(get('endRet', period).p).toBeGreaterThan(0.05);
    }
    expect(get('campaignOnly', 'test').nEvents).toBeLessThan(get('maxDown', 'test').nEvents);
    expect(get('symbolBlocks', 'test').movable).toBeGreaterThan(0);
    // ⑤ 标签用全部时间段：正 / 对照计数是全部事件，不是只看训练集
    expect(r.labelsAllPeriods.rsa).toHaveLength(1);
    const all = [...split.train, ...split.val, ...split.test, ...split.embargoed];
    expect(r.labelsAllPeriods.rsa[0].nPos).toBe(all.filter(e => e.label === 'positive').length);
    expect(r.labelsAllPeriods.contrast.rows.find(x => x.key === 'vol_w')!.nPos).toBe(r.labelsAllPeriods.rsa[0].nPos);
    expect(steps.at(-1)).toBe(2 * ROBUSTNESS_CHECKS.length + 1);
  });

  it('结果全由币决定（同币事件结果相同）：普通月内置换显著，按标的分块置换后不显著', async () => {
    const coin = Array.from({ length: 12 }, (_, k) => k / 12);
    const rand = mulberry32(21);
    const t0 = Date.parse('2025-01-01T00:00:00Z');
    const evs = Array.from({ length: 180 }, (_, i) => {
      const c = coin[i % 12];
      const f = { vol_w: rand(), shadow_a: c + 0.01 * normal(rand), shadow_b: c + 0.01 * normal(rand) };
      return {
        id: `c${i}`, symbol: `C${i % 12}USDT`, anchorMs: t0 + i * 8 * 3_600_000, kind: 'event', featuresByH: { 6: f }, label: null,
        outcome: c, block: new Date(t0 + i * 8 * 3_600_000).toISOString().slice(0, 7), momentum: null, maxUp: c, maxDown: -c, endRet: 0,
      } as RunEvent;
    });
    const split = chronologicalSplit(evs);
    const r = await runRobustness(split, [{ representation: 'shadow', target: 'outcome', halfLifeHours: 6 }], [rep], () => null,
      { permutations: 199, seed: 4, alpha: 0.05 });
    const get = (check: string) => r.rows[0].checks.find(c => c.check === check && c.period === 'discovery')!;
    expect(get('campaignOnly').p).toBeLessThan(0.05);
    expect(get('symbolBlocks').p).toBeGreaterThan(0.05);
    // 标签目标没有选出 h → ⑤ 用 h = 6
    expect(r.labelsAllPeriods.rsa[0].halfLifeHours).toBe(6);
  });

  it('测试集没有检验结果目标 → ① – ④ 不做，⑤ 照做', async () => {
    const split = chronologicalSplit(events(90, 5));
    const r = await runRobustness(split, [{ representation: 'shadow', target: 'label', halfLifeHours: 6 }], [rep], () => 6,
      { permutations: 19, seed: 1, alpha: 0.05 });
    expect(r.rows).toEqual([]);
    expect(r.labelsAllPeriods.rsa).toHaveLength(1);
  });
});
