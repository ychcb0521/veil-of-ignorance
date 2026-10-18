import { describe, expect, it } from 'vitest';
import { applyExclusions, describeGroup, findOutliers, viewForVariable, type DeepDigData } from '@/lib/deepDig/analysis';
import { formatSeriesOffset, viewAtOffset, type DeepDigSeries } from '@/lib/deepDig/series';
import { makeData } from '@/lib/deepDig/__tests__/fixtures';

const H = 3_600_000;
const DATA = makeData();

/** 每个事件：τ = −1h、0、+1h 三点；a 在 +1h = 2 × 特征值，F 恒为 −特征值；第一行没有曲线、第二行 +1h 缺 K 线。 */
function seriesOf(data: DeepDigData): DeepDigSeries {
  const byEvent: Record<string, Float32Array> = {};
  data.rows.forEach((r, i) => {
    if (r.v == null || i === 0) return;
    byEvent[r.id] = Float32Array.from([r.v / 2, r.v, i === 1 ? Number.NaN : 2 * r.v, -r.v, -r.v, -r.v]);
  });
  return { finishedAt: data.finishedAt, offsets: [-H, 0, H], names: ['a', 'F'], result: 'a', byEvent };
}

describe('【用户要求】拖动时间序列图的竖线：分组表按选中时刻的值统计', () => {
  const series = seriesOf(DATA);

  it('进场（0）= 原来的视图（特征值本身）；其他时刻 = 曲线在那一点的值，没有曲线 / 缺 K 线记缺失，分组统计重算', () => {
    expect(viewAtOffset(DATA, series, null, 0)).toBe(viewForVariable(DATA, null));
    expect(viewAtOffset(DATA, null, null, H)).toBe(DATA);
    const at = viewAtOffset(DATA, series, null, H);
    expect(at.rows[0].v).toBeNull();
    expect(at.rows[1].v).toBeNull();
    for (const i of [2, 5, 40]) if (DATA.rows[i].v != null) expect(at.rows[i].v).toBeCloseTo(2 * DATA.rows[i].v!, 9);
    const pos = at.rows.filter(r => r.group === 'positive' && r.v != null).map(r => r.v!);
    expect(at.groups.find(g => g.group === 'positive')).toEqual(describeGroup('positive', pos));
    // 变量跟着走：F 在任一时刻 = −特征值
    const f = viewAtOffset(DATA, series, 'F', -H);
    expect(f.rows[3].v).toBeCloseTo(-DATA.rows[3].v!, 9);
    // 不在曲线上的时刻：当进场
    expect(viewAtOffset(DATA, series, null, 7 * H)).toBe(viewForVariable(DATA, null));
    expect([formatSeriesOffset(0), formatSeriesOffset(-6 * H), formatSeriesOffset(1.5 * H)]).toEqual(['进场', '−6h', '+1.5h']);
  });
});

describe('【用户要求】描述统计指出极端值（各组四分位距 1.5 倍以外），可暂时删除后统计', () => {
  it('按组判：Q3 + 1.5·IQR 以上偏高、Q1 − 1.5·IQR 以下偏低；组内不足 4 个值不判；按组、偏离从大到小排', () => {
    const vals: [string, DeepDigData['rows'][number]['group'], number][] = [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map(v => [`p${v}`, 'positive', v] as [string, 'positive', number]), ['pX', 'positive', 40], ['pY', 'positive', 30],
      ['c1', 'control', 10], ['c2', 'control', 11], ['c3', 'control', 12], ['c4', 'control', 13], ['c5', 'control', -30],
      ['o1', 'other', 1], ['o2', 'other', 1000],
    ];
    const rows = vals.map(([id, group, v]) => ({ ...DATA.rows[0], id, group, v }));
    const data = { rows, groups: (['positive', 'control', 'other', 'background'] as const).map(g => describeGroup(g, rows.filter(r => r.group === g).map(r => r.v!))) };
    const out = findOutliers(data);
    expect(out.map(o => [o.id, o.side])).toEqual([['pX', 'high'], ['pY', 'high'], ['c5', 'low']]);
    // 暂时删除之后统计重算：实验组 n 少 2，均值回到 1~8 的平均
    const full = { ...DATA, rows, groups: data.groups };
    const after = applyExclusions(full, ['pX', 'pY']);
    expect(after.groups.find(g => g.group === 'positive')).toMatchObject({ n: 8, mean: 4.5 });
  });
});
