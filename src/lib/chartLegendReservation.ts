/**
 * 顶部 OHLC 图例要给右上角工具栏预留多宽。
 *
 * 病根：两层在抢同一条水平带。OHLC 图例由 klinecharts 画在**画布**上、从左往右排；
 * 指标/挂单/标记那排按钮是 HTML，`absolute right-12 top-0` 浮在**同一个 y**。
 * 图例宽度是**数据决定的**（成交量位数、价格精度、涨跌幅符号都会让它变长），
 * 所以任何「把间距调大一点」的修法都会在别的标的上再次重叠。
 *
 * 用 klinecharts 自己的机制：`candle.tooltip.offsetRight` 把图例的可用宽度收成
 * `bounding.width - offsetRight`，而 drawStandardTooltipLegends 在超宽时是
 * **按整个字段换行**的（x 归位、y 下移一行），不会把「量 22,352,434」切一半。
 * 于是图例撞上按钮之前先折行，短的时候又完全不占额外高度。
 *
 * 预留量必须**实测**：工具栏里的指标标签（VOL 1 ×）可增删，写死数字下次加一个指标就再次重叠。
 */

export interface LegendReservationInput {
  /**
   * klinecharts 绘图区宽度，即 `getSize(candle_pane, Main).width`。
   * **不含右侧 Y 轴**——源码里 bounding 与 yAxisBounding 是两个独立参数。
   */
  mainWidth: number;
  /**
   * 工具栏左边缘，换算到**图表容器**坐标。
   * 工具栏是相对外层定位的，而图表容器还有 `left: 34` 的内缩，两者差一个内缩量；
   * 都换算到容器坐标后相减，34px 内缩、Y 轴宽度、analysisMode 就都自动抵消了。
   */
  toolbarLeft: number;
  /** 图例与按钮之间留的空隙。 */
  gap?: number;
  /** 再宽的工具栏也要给图例留下的最小宽度。 */
  minLegendWidth?: number;
}

export const LEGEND_TOOLBAR_GAP = 8;
export const MIN_LEGEND_WIDTH = 160;

export function legendReservedRight({
  mainWidth,
  toolbarLeft,
  gap = LEGEND_TOOLBAR_GAP,
  minLegendWidth = MIN_LEGEND_WIDTH,
}: LegendReservationInput): number {
  if (!Number.isFinite(mainWidth) || !(mainWidth > 0)) return 0;
  /**
   * `toolbarLeft <= 0` 是**测量未就绪**，不是「工具栏铺满整宽」：首帧布局之前
   * 两个 getBoundingClientRect() 都是 0，相减恰好得 0。此时若照算，会预留掉
   * 几乎整个宽度、把图例压扁一帧，等下一次测量再弹回来。工具栏是右对齐且
   * max-w-[60%]，真实的左边缘不可能落在绘图区左边缘上，所以这样判是安全的。
   */
  if (!Number.isFinite(toolbarLeft) || !(toolbarLeft > 0)) return 0;

  const wanted = mainWidth - toolbarLeft + gap;
  /**
   * 上界不是可选的：工具栏比绘图区还宽时 wanted 会逼近甚至超过 mainWidth，
   * 可用宽度归零会让七个字段各占一行、糊住整个盘面——那比重叠更糟。
   * 宁可在这种极端下容忍一点重叠，也要保证图例本身还能读。
   */
  return Math.max(0, Math.min(wanted, mainWidth - minLegendWidth));
}

/**
 * 指标工具栏（指标/挂单/标记/指标标签）要距图表右边缘多远，才不被布局按钮组压住。
 *
 * 同一个病的第二次发作：布局按钮组在 MultiChartLayout 里 `absolute right-2`（距右 8px），
 * 实测宽约 94px，于是占据右侧 8~102px；而指标工具栏在 CandlestickChart 里写死
 * `right-12`（距右 48px）。48 < 102，必然重叠。
 *
 * 两个数字分处**父子两个组件**，谁也看不见谁，所以这个魔法数字从写下那天起就没对过。
 * 改成实测之后，布局按钮组增删按钮（全屏时会多出「周期」「速度」两组）也自动跟随。
 *
 * 只在**竖直方向真的重叠**时才避让：2x2 布局下只有右上角那张图会被压到，
 * 下面两张若也无脑内缩，会白白浪费半张图的横向空间。
 */
export interface ToolbarInsetInput {
  /** 该图表相对定位容器的矩形。 */
  wrapper: { top: number; right: number; bottom: number };
  /** 布局按钮组的矩形；取不到（未挂载 / 不在这张图上方）时传 null。 */
  controls: { top: number; left: number; bottom: number } | null;
  /** 工具栏与按钮组之间留的空隙。 */
  gap?: number;
  /** 不重叠时的默认内缩。 */
  fallback?: number;
}

export const TOOLBAR_CONTROLS_GAP = 8;
export const TOOLBAR_DEFAULT_INSET = 8;

export function toolbarInsetRight({
  wrapper,
  controls,
  gap = TOOLBAR_CONTROLS_GAP,
  fallback = TOOLBAR_DEFAULT_INSET,
}: ToolbarInsetInput): number {
  if (controls == null) return fallback;
  const finite = [wrapper.top, wrapper.right, wrapper.bottom, controls.top, controls.left, controls.bottom];
  if (finite.some(v => !Number.isFinite(v))) return fallback;

  // 竖直不相交 → 不在这张图上方（2x2 的下面两张），不必内缩。
  if (controls.bottom <= wrapper.top || controls.top >= wrapper.bottom) return fallback;
  // 按钮组整个在这张图右侧之外 → 也不会压到。
  if (controls.left >= wrapper.right) return fallback;

  return Math.max(fallback, wrapper.right - controls.left + gap);
}
