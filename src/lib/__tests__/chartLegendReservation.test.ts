import { describe, expect, it } from 'vitest';
import { legendReservedRight, LEGEND_TOOLBAR_GAP } from '@/lib/chartLegendReservation';

/** 实测自复现页：容器 900 宽、左内缩 34、工具栏 right-12。 */
const MAIN_WIDTH = 824;
const TOOLBAR_LEFT = 616.7;

describe('图例给工具栏预留的宽度', () => {
  it('【回归】图例可用宽度必须停在工具栏左边缘之前', () => {
    // 这是整条修复的判据：可用宽度 + 空隙 ≤ 工具栏左边缘。
    const reserved = legendReservedRight({ mainWidth: MAIN_WIDTH, toolbarLeft: TOOLBAR_LEFT });
    const usable = MAIN_WIDTH - reserved;
    expect(usable).toBeLessThanOrEqual(TOOLBAR_LEFT - LEGEND_TOOLBAR_GAP + 1e-9);
    expect(usable).toBeCloseTo(608.7, 6);   // 与浏览器里实测到的一致
  });

  it('工具栏变宽（加一个指标标签）时预留跟着变大', () => {
    const narrow = legendReservedRight({ mainWidth: MAIN_WIDTH, toolbarLeft: 616.7 });
    const wide = legendReservedRight({ mainWidth: MAIN_WIDTH, toolbarLeft: 540 });
    expect(wide).toBeGreaterThan(narrow);
    expect(MAIN_WIDTH - wide).toBeLessThanOrEqual(540 - LEGEND_TOOLBAR_GAP + 1e-9);
  });

  it('【判据】工具栏宽到离谱时保底——七个字段各占一行比重叠更糟', () => {
    const reserved = legendReservedRight({ mainWidth: 400, toolbarLeft: 30 });
    expect(400 - reserved).toBe(160);        // 至少留得下一个字段
    expect(reserved).toBeGreaterThan(0);
  });

  it('绘图区比保底还窄时不产出负数', () => {
    expect(legendReservedRight({ mainWidth: 100, toolbarLeft: 10 })).toBe(0);
  });

  it('工具栏在绘图区右侧之外时不预留——本来就不会重叠', () => {
    expect(legendReservedRight({ mainWidth: 824, toolbarLeft: 900 })).toBe(0);
  });

  it('尺寸未就绪（首帧 / 未挂载）时返回 0，不写入 NaN', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(legendReservedRight({ mainWidth: bad, toolbarLeft: 600 })).toBe(0);
      expect(legendReservedRight({ mainWidth: 824, toolbarLeft: bad })).toBe(0);
    }
  });
});
