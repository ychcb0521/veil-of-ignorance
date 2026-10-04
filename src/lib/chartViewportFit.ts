/**
 * 【用户要求】散点图要在一屏里看全：图表面板滚到吸顶区正下方时，整块面板（视图切换、标题、图例、绘图盒、脚注）
 * 都在视口里。面板里只有绘图盒的高度可以让——其余部分（chrome）量出来原样扣掉。
 */

/** 面板底边与视口底边之间留的一点空，免得脚注贴着屏幕边。 */
export const CHART_FIT_MARGIN = 8;

export type ChartViewportFitInput = {
  /** window.innerHeight */
  viewportHeight: number;
  /** 面板顶边落在视口里的位置：吸顶区的下沿，或页面没滚动时面板自己的位置，取靠下的那个。 */
  panelTop: number;
  /** 面板此刻的高度（含绘图盒）。 */
  panelHeight: number;
  /** 绘图盒此刻的高度。 */
  boxHeight: number;
};

/**
 * 绘图盒最高能有多高才能让整块面板留在一屏里。量不到尺寸（未挂载、jsdom）时返回 null = 不设上限。
 * 结果可能很小甚至为负（窗口太矮）——由绘图元件自己的下限（18rem）兜住，那时宁可超出一点也不把图压扁。
 */
export function chartBoxHeightToFitViewport({ viewportHeight, panelTop, panelHeight, boxHeight }: ChartViewportFitInput): number | null {
  if (![viewportHeight, panelTop, panelHeight, boxHeight].every(Number.isFinite)) return null;
  if (!(viewportHeight > 0) || !(panelHeight > 0) || !(boxHeight > 0)) return null;
  const chrome = Math.max(0, panelHeight - boxHeight);
  return Math.floor(viewportHeight - Math.max(0, panelTop) - chrome - CHART_FIT_MARGIN);
}
