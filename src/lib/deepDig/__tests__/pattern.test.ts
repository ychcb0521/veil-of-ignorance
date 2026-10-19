import { describe, expect, it } from 'vitest';
import type { DeepDigRow } from '@/lib/deepDig/analysis';
import { beijingClock, compileRowFilter, describeRows, quantileBins, rowFilterValues, sharedHistogram, splitByFilter } from '@/lib/deepDig/pattern';

const T0 = Date.parse('2026-10-19T00:00:00Z'); // 北京时间 周一 08:00
const row = (id: string, v: number | null, extra: Partial<DeepDigRow> = {}): DeepDigRow => ({
  id, symbol: 'AUSDT', anchorMs: T0, group: 'control', memberIds: [], v, vars: { a: v, b: v == null ? null : -v },
  vol: 0.01, endRet: 0, maxUp: 0, maxDown: 0, period: 'discovery', ...extra,
});

describe('【用户要求】2026-10-19 Deep dig 总体模式识别：计算', () => {
  it('条件：留空不过滤；写错给中文错误；用到 24h 结果时标出（只能事后描述）', () => {
    expect(compileRowFilter('  ', ['a'])).toEqual({ filter: null, error: null });
    expect(compileRowFilter('zz > 1', ['a']).error).toContain('不认识「zz」');
    expect(compileRowFilter('a > 0 and hour >= 20', ['a']).filter?.usesOutcome).toBe(false);
    expect(compileRowFilter('a > 0 and maxUp > 0.05', ['a']).filter?.usesOutcome).toBe(true);
  });

  it('时刻按北京时间：小时 0–23，星期 1 = 周一 … 7 = 周日', () => {
    expect(beijingClock(T0)).toEqual({ hour: 8, weekday: 1 });
    expect(beijingClock(T0 - 9 * 3_600_000)).toEqual({ hour: 23, weekday: 7 });
  });

  it('按条件分成满足 / 不满足 / 读数缺失（缺失两边都不算）；没有条件全部算满足', () => {
    const rows = [row('p', 2), row('f', -1), row('m', null), row('late', 5, { anchorMs: T0 + 13 * 3_600_000 })];
    const { filter } = compileRowFilter('a > 0 and hour < 20', ['a', 'b']);
    const s = splitByFilter(rows, filter, r => rowFilterValues(r, 'a'));
    expect(s.pass.map(r => r.id)).toEqual(['p']);
    expect(s.fail.map(r => r.id)).toEqual(['f', 'late']); // late 是北京时间 21 点
    expect(s.missing.map(r => r.id)).toEqual(['m']);
    expect(splitByFilter(rows, null, r => rowFilterValues(r, 'a')).pass).toHaveLength(4);
    // 只用到 hour 时，读数缺失的行照样能判断
    const { filter: byHour } = compileRowFilter('hour >= 20', ['a']);
    expect(splitByFilter(rows, byHour, r => rowFilterValues(r, 'a')).missing).toHaveLength(0);
  });

  it('汇总：读数描述 + 24h 期末平均、上涨占比、最大涨中位数', () => {
    const s = describeRows([row('1', 1, { endRet: 0.02, maxUp: 0.1 }), row('2', 3, { endRet: -0.01, maxUp: 0.3 }), row('3', null, { endRet: 0.05, maxUp: 0.2 })]);
    expect(s.n).toBe(2);
    expect(s.mean).toBe(2);
    expect(s.endRetMean).toBeCloseTo(0.02, 10);
    expect(s.upShare).toBeCloseTo(2 / 3, 10);
    expect(s.maxUpMedian).toBeCloseTo(0.2, 10);
  });

  it('直方图：共用分箱、各组占比之和为 1、两端以外压在边上的箱里、范围含 0', () => {
    const a = Array.from({ length: 100 }, (_, i) => i + 1);
    const h = sharedHistogram([a, [1000, 50]], 10)!;
    expect(h.lo).toBe(0);
    expect(h.shares.every(s => Math.abs(s.reduce((x, y) => x + y, 0) - 1) < 1e-12)).toBe(true);
    expect(h.shares[1][9]).toBe(0.5); // 1000 压进最后一格
    expect(sharedHistogram([[1]])).toBeNull();
  });

  it('五档：按读数从低到高、每档人数相同；读数缺失不进；不足 5 行为空', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`r${i}`, 10 - i, { endRet: (10 - i) / 100 }));
    const bins = quantileBins([...rows, row('x', null)]);
    expect(bins.map(b => b.n)).toEqual([2, 2, 2, 2, 2]);
    expect(bins.map(b => [b.lo, b.hi])).toEqual([[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]]);
    expect(bins[4].endRetMean).toBeCloseTo(0.095, 10);
    expect(quantileBins(rows.slice(0, 4))).toEqual([]);
  });
});
