import { describe, expect, it } from 'vitest';
import { welchTTest } from '@/lib/deepRsa/deepDive';
import { DEFAULT_COMMANDS, runInference } from '@/lib/deepDig/commands';
import {
  applyExclusions, dataSupportsInference, deepDigRules, describeGroup, exclusionKey, groupOf,
} from '@/lib/deepDig/analysis';
import { driftEvents, makeData } from './fixtures';

describe('【用户要求】Deep dig：描述统计与推断统计分开运行', { timeout: 60_000 }, () => {
  it('分组与描述：战役按标签分实验组 / 对照组 / 其他，随机时点单列；描述含标准差', () => {
    expect(groupOf({ kind: 'event', label: 'positive' })).toBe('positive');
    expect(groupOf({ kind: 'event', label: null })).toBe('other');
    expect(groupOf({ kind: 'background', label: null })).toBe('background');
    const s = describeGroup('positive', [3, 1, 2, -1]);
    expect(s).toMatchObject({ n: 4, mean: 1.25, median: 1.5, min: -1, max: 3, sharePositive: 0.75 });
  });

  it('描述统计的明细行带特征值、波动率、24h 结果、战役 id 与时段', () => {
    const events = driftEvents(240, -1e-4);
    const data = makeData(events);
    expect(data.rows).toHaveLength(240);
    expect(data.rows[1]).toMatchObject({ id: 'e1', memberIds: ['c1'], v: events[1].featuresByH[6].deep_dig_x, vol: events[1].featuresByH[6].vol_w });
    expect(new Set(data.rows.map(x => x.period))).toEqual(new Set(['discovery', 'confirmation', 'embargo']));
    expect(dataSupportsInference(data)).toBe(true);
    expect(dataSupportsInference({ rows: data.rows.map(({ vol: _vol, ...r }) => r) })).toBe(false);
  });

  it('推断统计只用描述统计的数据：t 检验（显示单位）与直接算一致；记下用的是哪份数据与命令', () => {
    const events = driftEvents(240, -1e-4);
    const data = makeData(events);
    const inf = runInference(data, DEFAULT_COMMANDS);
    const t = inf.blocks.find(b => b.kind === 'ttest');
    const scale = data.definition.scale;
    const pos = events.filter(e => e.label === 'positive').map(e => (e.featuresByH[6].deep_dig_x as number) * scale);
    const ctl = events.filter(e => e.label === 'control').map(e => (e.featuresByH[6].deep_dig_x as number) * scale);
    expect(t?.kind === 'ttest' && t.result.p).toBeCloseTo(welchTTest(pos, ctl).p, 10);
    expect(inf.dataFinishedAt).toBe(1);
    expect(inf.commands).toBe(DEFAULT_COMMANDS);
  });

  it('【用户要求】整行删减：删掉的行不进分组描述与推断统计', () => {
    const data = makeData();
    const drop = data.rows.filter(r => r.group === 'positive').slice(0, 3).map(r => r.id);
    const cut = applyExclusions(data, drop);
    expect(cut.rows).toHaveLength(data.rows.length - 3);
    expect(cut.groups.find(g => g.group === 'positive')!.n).toBe(data.groups.find(g => g.group === 'positive')!.n - 3);
    const t = runInference(cut, 'ttest(X, 实验组, 对照组)').blocks[0];
    expect(t.kind === 'ttest' && t.result.nA).toBe(cut.groups.find(g => g.group === 'positive')!.n);
    expect(exclusionKey(data, [...drop, 'not-a-row'])).toBe([...drop].sort().join(','));
    expect(applyExclusions(data, [])).toBe(data);
  });

  it('规律提取的默认文字：描述统计就能出前几条，推断统计跑完再补上检验结论', () => {
    const data = makeData();
    const only = deepDigRules(data, null);
    expect(only[0]).toContain('实验组更低');
    expect(only.some(l => l.startsWith('推断统计还没运行'))).toBe(true);
    const full = deepDigRules(data, runInference(data, `${DEFAULT_COMMANDS}\nregress(endRet ~ X + vol)\nanova(X, 实验组, 对照组, 随机)`));
    expect(full.some(l => l.startsWith('多元线性回归'))).toBe(true);
    expect(full.some(l => l.startsWith('方差分析'))).toBe(true);
    expect(full.find(l => l.startsWith('t 检验'))).toContain('差异显著');
    expect(full.find(l => l.startsWith('做法'))).toMatch(/≤ .*对照组中位数/);
    expect(full.at(-1)).toMatch(/^局限.*看过三项结果/);
    const higher = deepDigRules(makeData(driftEvents(240, 1e-4)), null);
    expect(higher[0]).toContain('实验组更高');
  });
});
