/**
 * 复盘图表的统一几何与配色令牌。
 *
 * 这里的数字全部是模块常量而不是组件 props——因为「点位大小随点数缩小」正是
 * 用户看到的模糊病根（旧实现 markerMaxSize = 10 - (N-24)*0.045，N=192 时只剩 4px，
 * 其中还有 2px 是白边）。把尺寸锁死在模块里，调用方就没有再写一条缩放公式的入口。
 */

/** 点位实心半径：8px 直径是 dataviz 规范的硬下限，永不随点数变化。 */
export const MARK_R = 4;

/**
 * 表面色描边宽度。SVG 描边以路径为中心线，配合 paint-order: stroke 后
 * 可见环 = 线宽 / 2 = 2px，且画在 8px 实心之外，不会吃掉填充。
 */
export const MARK_RING_W = 4;

/** 单个点位的完整占地直径：8px 实心 + 两侧各 2px 表面环。 */
export const MARK_FOOTPRINT = MARK_R * 2 + MARK_RING_W;

/** 同一水平线上相邻两点的最小中心距：12px 占地 + 2px 表面间隙。 */
export const MIN_PITCH = MARK_FOOTPRINT + 2;

/** 命中区下限。实际宽度取 min(HIT_MIN, pitch)，避免相邻按钮互相盖住对方圆心。 */
export const HIT_MIN = 24;

/** 绘图盒内边距。纵轴刻度栏与网格线共用同一组常量，否则刻度会和网格线错位。 */
export const PLOT_INSET = { top: 12, right: 12, bottom: 28, left: 12 } as const;

/** 右侧 n= 计数栏宽度，钉在滚动区之外。 */
export const BAND_RAIL_W = 32;

/** jsdom 里没有 ResizeObserver、任何盒子都是 0×0，用一个确定的尺寸兜底。 */
export const CHART_FALLBACK_SIZE = { width: 880, height: 550 } as const;

/**
 * 允许出现在图表里的颜色角色。故意写成字面量联合类型：
 * 调用方从类型上就写不出 '#0ECB81'，配色漂移变成编译错误而不是 code review 问题。
 */
export type ChartSeriesToken =
  | 'profit'
  | 'loss'
  | 'neutral'
  | 'info'
  | 'importance';

export type ScatterMarkShape = 'circle' | 'diamond' | 'square' | 'ring';

export function seriesTokenVar(token: ChartSeriesToken) {
  return `var(--chart-${token})`;
}

export const CHART_SURFACE_VAR = 'var(--chart-surface)';
export const CHART_GRID_VAR = 'var(--chart-grid)';
export const CHART_AXIS_VAR = 'var(--chart-axis)';
export const CHART_THRESHOLD_VAR = 'var(--chart-threshold)';

/**
 * 已通过 validate_palette.js 的十六进制值，仅供契约测试锁定。
 * 改动其中任何一个都会让测试变红，强制重新跑验证器而不是凭眼睛调色。
 *
 * 琥珀色有两个身份（importance 系列色 / -1R 阈值线），但二者互斥：
 * 阈值线只在 metricKey === 'odds' 出现，importance 配色只在重要性图出现，
 * 永远不会同框，所以不构成「状态色冒充系列色」。
 */
export const CHART_PALETTE_HEX = Object.freeze({
  light: Object.freeze({
    surface: '#FCFDFE',
    profit: '#00875A',
    loss: '#DE350B',
    neutral: '#87919F',
    info: '#2B7FFF',
    importance: '#D99A00',
  }),
  dark: Object.freeze({
    surface: '#161A1E',
    profit: '#1FA97A',
    loss: '#EF5B3C',
    neutral: '#626C79',
    info: '#2B7FFF',
    importance: '#C98500',
  }),
});

/** 四种形状的真实 SVG 几何，视觉重量与 8px 圆点对齐。 */
export function markShapePath(shape: ScatterMarkShape, cx: number, cy: number) {
  if (shape === 'diamond') {
    // 旋转 45° 的正方形按外接圆看会显小，半对角线取 4.6 才与圆点等重。
    const d = 4.6;
    return `M ${cx} ${cy - d} L ${cx + d} ${cy} L ${cx} ${cy + d} L ${cx - d} ${cy} Z`;
  }
  if (shape === 'square') {
    const h = 3.5;
    return `M ${cx - h} ${cy - h} H ${cx + h} V ${cy + h} H ${cx - h} Z`;
  }
  return '';
}

/** 越界点位夹在边缘并画成朝外的三角，保留数值可读性但不谎报位置。 */
export function clampedChevronPath(cx: number, cy: number, direction: 'up' | 'down') {
  const d = 4.6;
  return direction === 'up'
    ? `M ${cx} ${cy - d} L ${cx + d} ${cy + d * 0.7} L ${cx - d} ${cy + d * 0.7} Z`
    : `M ${cx} ${cy + d} L ${cx + d} ${cy - d * 0.7} L ${cx - d} ${cy - d * 0.7} Z`;
}
