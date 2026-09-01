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

import { toolbarInsetRight, TOOLBAR_DEFAULT_INSET } from '@/lib/chartLegendReservation';

/** 实测：布局按钮组 `right-2`、宽约 94px；图表容器右边缘 900。 */
const WRAPPER = { top: 0, right: 900, bottom: 400 };
const CONTROLS = { top: 4, left: 798, bottom: 28 };   // 900−8−94 = 798

describe('指标工具栏躲开布局按钮组', () => {
  it('【回归】写死的 right-12（48px）不够——按钮组占到 102px', () => {
    const inset = toolbarInsetRight({ wrapper: WRAPPER, controls: CONTROLS });
    expect(inset).toBe(900 - 798 + 8);      // 110
    expect(inset).toBeGreaterThan(48);      // 原来的 right-12 会被压住
  });

  it('按钮组变宽（全屏时多出周期/速度两组）时自动跟随', () => {
    const wide = toolbarInsetRight({ wrapper: WRAPPER, controls: { ...CONTROLS, left: 600 } });
    expect(wide).toBe(308);
  });

  it('【判据】2x2 下面两张图不内缩——按钮组不在它们上方', () => {
    // 无脑内缩会白白浪费半张图的横向空间。
    const lower = { top: 410, right: 900, bottom: 800 };
    expect(toolbarInsetRight({ wrapper: lower, controls: CONTROLS })).toBe(TOOLBAR_DEFAULT_INSET);
  });

  it('按钮组整个在这张图右侧之外时不内缩', () => {
    expect(toolbarInsetRight({ wrapper: { top: 0, right: 440, bottom: 400 }, controls: CONTROLS }))
      .toBe(TOOLBAR_DEFAULT_INSET);
  });

  it('取不到按钮组 / 尺寸未就绪时退回默认内缩', () => {
    expect(toolbarInsetRight({ wrapper: WRAPPER, controls: null })).toBe(TOOLBAR_DEFAULT_INSET);
    expect(toolbarInsetRight({ wrapper: { ...WRAPPER, right: NaN }, controls: CONTROLS }))
      .toBe(TOOLBAR_DEFAULT_INSET);
  });

  it('永远不小于默认内缩', () => {
    expect(toolbarInsetRight({ wrapper: WRAPPER, controls: { ...CONTROLS, left: 899 } }))
      .toBeGreaterThanOrEqual(TOOLBAR_DEFAULT_INSET);
  });
});
