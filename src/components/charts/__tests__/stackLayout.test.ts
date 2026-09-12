import { describe, expect, it } from 'vitest';
import { MARK_FOOTPRINT, MIN_PITCH } from '@/lib/chartTokens';
import { columnStackLayout, stackLayout } from '../stackLayout';

const OPTS = { xMin: -2, xMax: 10, left: 12, right: 840, top: 12, plotHeight: 492 };

function pts(values: number[], prefix = 'p') {
  return values.map((x, index) => ({ id: `${prefix}${index}`, x }));
}

describe('stackLayout 频数堆叠', () => {
  it('同一 x 的 6 个点排成一列：rank 0..5、cy 逐行恰差一个步距、yPct 有限', () => {
    const result = stackLayout(pts([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]), OPTS);
    expect(result.placed.map(item => item.rank).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(result.placed.map(item => item.cx)).size).toBe(1);
    const cys = result.placed.map(item => item.cy).sort((a, b) => b - a);
    for (let i = 1; i < cys.length; i += 1) expect(cys[i - 1] - cys[i]).toBeCloseTo(result.pitchY, 6);
    expect(result.pitchY).toBe(MIN_PITCH);
    expect(result.placed.every(item => Number.isFinite(item.yPct) && item.yPct >= 0 && item.yPct <= 100)).toBe(true);
    // 最底一个点的圆心在底线上方半个步距：环的下沿正好落在 0 场网格线上。
    const baseline = OPTS.top + OPTS.plotHeight;
    expect(Math.max(...cys)).toBeCloseTo(baseline - MIN_PITCH / 2, 6);
  });

  it('档宽 ≥ 14px 且恰好铺满；同档吸附到同一档中心，相邻档中心隔一个档宽', () => {
    // 3.0 三个点同值必同档；−1 两个点同值必同档——不用相邻但可能跨档的数值。
    const result = stackLayout(pts([-1, -1, 3, 3, 3]), OPTS);
    expect(result.binPx).toBeGreaterThanOrEqual(MIN_PITCH);
    expect(result.binCount * result.binPx).toBeCloseTo(OPTS.right - OPTS.left, 6);
    const centers = [...new Set(result.placed.map(item => item.cx))].sort((a, b) => a - b);
    expect(centers).toHaveLength(2);
    // 任意两列之间的距离都是档宽的整数倍。
    const ratio = (centers[1] - centers[0]) / result.binPx;
    expect(Math.abs(ratio - Math.round(ratio))).toBeLessThan(1e-6);
    // 档宽（数值单位）= 档宽（px）× 每像素代表的 R。
    expect(result.binWidth).toBeCloseTo((result.binPx / (OPTS.right - OPTS.left)) * 12, 9);
  });

  it('整数窗口下每 1R 切整数档：−1 与 0 都是档边界，越过止损墙的亏损永远画在墙左边', () => {
    // 900px 轨道（usable 768，64px/R）曾把 −1.05R 吸附到墙右侧的档中心；现在 −1 是档边界。
    for (const right of [840, 780, 520, 255]) {
      const opts = { ...OPTS, right };
      const usable = right - OPTS.left;
      const result = stackLayout(pts([-1.05, -1.01, -0.99, -0.02, 0.02, 1.5]), opts);
      const perUnit = Math.floor(usable / 12 / MIN_PITCH);
      expect(result.binCount).toBe(12 * perUnit);
      expect(result.binPx).toBeGreaterThanOrEqual(MIN_PITCH);
      const wallPx = OPTS.left + (1 / 12) * usable;
      const zeroPx = OPTS.left + (2 / 12) * usable;
      const cxOf = (id: string) => result.placed.find(item => item.id === id)!.cx;
      expect(cxOf('p0')).toBeLessThan(wallPx);
      expect(cxOf('p1')).toBeLessThan(wallPx);
      expect(cxOf('p2')).toBeGreaterThan(wallPx);
      expect(cxOf('p3')).toBeLessThan(zeroPx);
      expect(cxOf('p4')).toBeGreaterThan(zeroPx);
    }
  });

  it('输入顺序打乱也得到同一张图：档内按 x 升序、再按 id', () => {
    const values = [0.3, -0.5, 0.31, 0.29, 0.3, -0.51, 5, 0.3];
    const a = stackLayout(pts(values), OPTS);
    const shuffled = pts(values).slice().reverse();
    const b = stackLayout(shuffled, OPTS);
    const key = (items: typeof a.placed) => [...items].sort((l, r) => l.id.localeCompare(r.id)).map(item => `${item.id}:${item.cx.toFixed(3)}:${item.cy.toFixed(3)}`);
    expect(key(b.placed)).toEqual(key(a.placed));
    const column = a.placed.filter(item => Math.abs(item.cx - a.placed.find(p => p.id === 'p0')!.cx) < 1e-6)
      .sort((l, r) => l.rank - r.rank);
    for (let i = 1; i < column.length; i += 1) {
      const prev = values[Number(column[i - 1].id.slice(1))];
      const next = values[Number(column[i].id.slice(1))];
      expect(next >= prev).toBe(true);
      if (next === prev) expect(column[i].id > column[i - 1].id).toBe(true);
    }
  });

  it('越出窗口的点贴边：左侧 clamped left、右侧 clamped right，并在边缘一档堆成一列', () => {
    const result = stackLayout(pts([-3, 12.5, 17, 38.19, 0.2]), OPTS);
    const byId = new Map(result.placed.map(item => [item.id, item]));
    expect(byId.get('p0')!.clamped).toBe('left');
    expect(byId.get('p0')!.bin).toBe(0);
    const tail = ['p1', 'p2', 'p3'].map(id => byId.get(id)!);
    expect(tail.every(item => item.clamped === 'right' && item.bin === result.binCount - 1)).toBe(true);
    expect(new Set(tail.map(item => item.cx)).size).toBe(1);
    expect(tail.map(item => item.rank).sort()).toEqual([0, 1, 2]);
    expect(byId.get('p4')!.clamped).toBeNull();
    // −1R 墙不是夹取边界：−1.61R 仍在窗口内，照常落在墙左侧。
    const beyondWall = stackLayout(pts([-1.61]), OPTS).placed[0];
    expect(beyondWall.clamped).toBeNull();
    expect(beyondWall.cx).toBeLessThan(OPTS.left + ((-1 + 2) / 12) * (OPTS.right - OPTS.left));
  });

  it('装不下时先退到 12px 行距；仍装不下则顶格合成一个三角并只报真正超出的场数', () => {
    const eight = stackLayout(pts(Array(8).fill(1)), { ...OPTS, plotHeight: 100 });
    // 8 × 14 = 112 > 100 ≥ 8 × 12：退到 12px，全部画出。
    expect(eight.pitchY).toBe(MARK_FOOTPRINT);
    expect(eight.placed).toHaveLength(8);
    expect(eight.overflow).toHaveLength(0);
    expect(eight.requiredPlotHeight).toBe(8 * MARK_FOOTPRINT);

    const twelve = stackLayout(pts(Array(12).fill(1)), { ...OPTS, plotHeight: 100 });
    expect(twelve.pitchY).toBe(MARK_FOOTPRINT);
    expect(twelve.rowsFit).toBe(8);
    // 前 7 行是真实点位，第 8 格让给三角：三角代表 12 − 7 = 5 场。
    expect(twelve.placed).toHaveLength(7);
    expect(twelve.placed.every(item => item.rank < 7)).toBe(true);
    expect(twelve.overflow).toHaveLength(1);
    expect(twelve.overflow[0].count).toBe(5);
    expect(twelve.overflow[0].ids).toHaveLength(5);
    const topSlotCy = OPTS.top + 100 - (8 - 0.5) * MARK_FOOTPRINT;
    expect(twelve.overflow[0].cy).toBeCloseTo(topSlotCy, 6);

    // 恰好装满（8 场 / 8 行）不算溢出，最顶一格是真实点位而不是三角。
    const exact = stackLayout(pts(Array(8).fill(1)), { ...OPTS, plotHeight: 96 });
    expect(exact.rowsFit).toBe(8);
    expect(exact.placed).toHaveLength(8);
    expect(exact.overflow).toHaveLength(0);
  });

  it('横向相距不足 13.5px 的两点绝不共用同一个 cy', () => {
    const values = Array.from({ length: 192 }, (_, index) => -1.6 + (index % 97) * 0.021 + (index % 7) * 0.4);
    const result = stackLayout(pts(values), OPTS);
    for (let i = 0; i < result.placed.length; i += 1) {
      for (let j = i + 1; j < result.placed.length; j += 1) {
        const a = result.placed[i];
        const b = result.placed[j];
        if (Math.abs(a.cx - b.cx) < MIN_PITCH - 0.5) {
          expect(Math.abs(a.cy - b.cy)).toBeGreaterThanOrEqual(MARK_FOOTPRINT - 1e-6);
        }
      }
    }
  });
});

const COLUMN_OPTS = {
  columns: [0, 1, 2, 3],
  left: 12,
  right: 840,
  top: 12,
  plotHeight: 492,
  referenceHeight: 492,
};

function colPts(counts: Record<number, number>) {
  return Object.entries(counts).flatMap(([value, n]) =>
    Array.from({ length: n }, (_, index) => ({ id: `c${value}-${index}`, x: Number(value) })));
}

describe('columnStackLayout 类目柱状堆叠', () => {
  it('【用户要求】每个档位堆成一根柱：柱数 = 类目数，点位一个不丢', () => {
    const result = columnStackLayout(colPts({ 0: 101, 1: 17, 2: 0, 3: 109 }), COLUMN_OPTS);
    expect(result.placed).toHaveLength(227);
    expect(result.overflow).toEqual([]);
    expect(result.columnCounts).toEqual([101, 17, 0, 109]);
    expect(result.tallest).toBe(109);
    // 四个类目各自吸附到本列，列中心互不重叠
    const centers = [0, 1, 2, 3].map(index => result.columnPx * (index + 0.5) + 12);
    for (const [index, center] of centers.entries()) {
      const inColumn = result.placed.filter(item => item.bin === index);
      for (const item of inColumn) {
        expect(Math.abs(item.cx - center)).toBeLessThanOrEqual(result.columnPx / 2);
      }
    }
  });

  it('场数多时一行并排放 perRow 个点，最高一柱正好占满参考高度', () => {
    const result = columnStackLayout(colPts({ 0: 101, 1: 17, 2: 0, 3: 109 }), COLUMN_OPTS);
    expect(result.perRow).toBeGreaterThan(1);
    const rows = Math.ceil(result.tallest / result.perRow);
    // 取的是「能装下的最小 perRow」：少放一个/行，最高一柱就超出参考高度了。
    expect(rows * MARK_FOOTPRINT).toBeLessThanOrEqual(COLUMN_OPTS.referenceHeight);
    expect(Math.ceil(result.tallest / (result.perRow - 1)) * MARK_FOOTPRINT)
      .toBeGreaterThan(COLUMN_OPTS.referenceHeight);
    // 同一行的点 cy 相同、cx 互不重叠；行与行之间恰差一个行距
    const tallestColumn = result.placed.filter(item => item.bin === 3);
    const byRow = new Map<number, number[]>();
    for (const item of tallestColumn) {
      byRow.set(item.cy, [...(byRow.get(item.cy) ?? []), item.cx]);
    }
    const rowKeys = [...byRow.keys()].sort((a, b) => b - a);
    expect(rowKeys).toHaveLength(rows);
    for (let i = 1; i < rowKeys.length; i += 1) {
      expect(rowKeys[i - 1] - rowKeys[i]).toBeCloseTo(result.pitchY, 6);
    }
    for (const xs of byRow.values()) {
      const sorted = [...xs].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(result.pitchX - 1e-6);
      }
    }
  });

  it('每行点数只看列宽与参考高度：实测图高变化不改 perRow，盒子撑高才不会自我追逐', () => {
    const points = colPts({ 0: 101, 1: 17, 2: 0, 3: 109 });
    const short = columnStackLayout(points, { ...COLUMN_OPTS, plotHeight: 200 });
    const tall = columnStackLayout(points, { ...COLUMN_OPTS, plotHeight: 900 });
    expect(short.perRow).toBe(tall.perRow);
    expect(short.requiredPlotHeight).toBe(tall.requiredPlotHeight);
  });

  it('列窄到放不下时才夹住 perRow，多出来的点合并成顶端三角而不是丢掉', () => {
    const narrow = columnStackLayout(colPts({ 0: 300 }), {
      ...COLUMN_OPTS, right: 92, plotHeight: 120, referenceHeight: 120,
    });
    const drawn = narrow.placed.length;
    const folded = narrow.overflow.reduce((sum, glyph) => sum + glyph.count, 0);
    expect(drawn + folded).toBe(300);
    expect(folded).toBeGreaterThan(0);
  });

  it('一场都没有的档位保留空柱，不让后面的档位左移', () => {
    const result = columnStackLayout(colPts({ 0: 3, 3: 2 }), COLUMN_OPTS);
    expect(result.columnCounts).toEqual([3, 0, 0, 2]);
    const lastColumn = result.placed.filter(item => item.bin === 3);
    expect(lastColumn).toHaveLength(2);
  });

  it('同样的输入重复算出同一张图（点位可重复渲染）', () => {
    const points = colPts({ 0: 9, 1: 4, 3: 7 });
    const a = columnStackLayout(points, COLUMN_OPTS);
    const b = columnStackLayout([...points].reverse(), COLUMN_OPTS);
    const key = (list: typeof a.placed) => list.map(i => `${i.id}@${i.cx},${i.cy}`).sort().join('|');
    expect(key(a.placed)).toBe(key(b.placed));
  });
});
