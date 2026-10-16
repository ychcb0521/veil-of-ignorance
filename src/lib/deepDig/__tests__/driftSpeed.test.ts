import { describe, expect, it } from 'vitest';
import { welchTTest } from '@/lib/deepRsa/deepDive';
import { analyzeDriftSpeed, describeGroup, driftRules, groupOf, type DriftSpeedResult } from '@/lib/deepDig/driftSpeed';
import { driftEvents } from './fixtures';

const full = (events = driftEvents(240, -1e-4)): DriftSpeedResult => {
  const { split, ...a } = analyzeDriftSpeed(events, { permutations: 199, bootstrap: 49 });
  return {
    ...a, codeVersion: 'test', startedAt: 0, finishedAt: 1,
    coverage: { campaigns: 200, clusters: 160, failed: 0, lowCoverage: 0, outcomeMissing: 0, featureMissing: 0, ...split },
  };
};

describe('【用户要求】Deep dig · 漂移速度 V：只检验 V 一项', { timeout: 60_000 }, () => {
  it('分组：战役按标签分实验组 / 对照组 / 其他，随机时点单列；描述统计含标准差', () => {
    expect(groupOf({ kind: 'event', label: 'positive' })).toBe('positive');
    expect(groupOf({ kind: 'event', label: null })).toBe('other');
    expect(groupOf({ kind: 'background', label: null })).toBe('background');
    const s = describeGroup('positive', [3, 1, 2, -1]);
    expect(s).toMatchObject({ n: 4, mean: 1.25, median: 1.5, min: -1, max: 3, sharePositive: 0.75 });
    expect(s.sd).toBeCloseTo(Math.sqrt(((3 - 1.25) ** 2 + (1 - 1.25) ** 2 + (2 - 1.25) ** 2 + (-1 - 1.25) ** 2) / 3), 12);
  });

  it('明细行逐个事件带 V、24h 结果、战役 id 与所在时段；t 检验只有 V 一项、不做多重校正', () => {
    const events = driftEvents(240, -1e-4);
    const r = full(events);
    expect(r.rows).toHaveLength(240);
    expect(r.rows[1]).toMatchObject({ id: 'e1', memberIds: ['c1'], v: events[1].featuresByH[6].dsp_v });
    expect(new Set(r.rows.map(x => x.period))).toEqual(new Set(['discovery', 'confirmation', 'embargo']));
    const pos = events.filter(e => e.label === 'positive').map(e => e.featuresByH[6].dsp_v as number);
    const ctl = events.filter(e => e.label === 'control').map(e => e.featuresByH[6].dsp_v as number);
    const ref = welchTTest(pos, ctl);
    expect(r.tTest!.p).toBeCloseTo(ref.p, 12);
    expect(r.tTest!.pHolm).toBeCloseTo(ref.p, 12);
    expect(r.groups.find(g => g.group === 'positive')!.n).toBe(pos.length);
    expect(r.association.map(a => a.target)).toEqual(['endRet', 'maxUp', 'maxDown']);
    expect(r.quintiles.bins).toHaveLength(5);
  });

  it('规律提取的默认文字由结果决定：植入「实验组 V 偏低」→ 写更低、差异显著、做法用 ≤ 对照组中位数', () => {
    const lines = driftRules(full());
    expect(lines[0]).toContain('实验组更低');
    expect(lines.find(l => l.startsWith('t 检验'))).toContain('差异显著');
    expect(lines.find(l => l.startsWith('做法'))).toMatch(/≤ .*对照组中位数/);
    expect(lines.at(-1)).toMatch(/^局限/);
    const flat = driftRules(full(driftEvents(240, 1e-4)));
    expect(flat[0]).toContain('实验组更高');
    expect(flat.find(l => l.startsWith('做法'))).toContain('≥');
  });
});
