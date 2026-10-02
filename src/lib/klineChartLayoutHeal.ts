/**
 * 【用户反馈】个别战役的盘面：鼠标放在主图上，十字线却画在下方的成交量 / HV 窗格里，滚轮缩放也失效；
 * 盘面尺寸一变（比如打开 DevTools）就恢复。也就是 KlineCharts 内部记的窗格布局过时了——
 * 它按内部的窗格高度把指针分到窗格，画面却还是旧布局画出来的，主图下半截被当成了副图。
 *
 * 这里在指针进入盘面时核对一次「内部布局 ↔ 实际 DOM」，对不上就让图表重新量一遍（chart.resize()）。
 * 布局一致时什么都不做；读到的是 KlineCharts v9 的私有字段，结构对不上时一律当作「无法判断」，不动图表。
 */

type PaneLike = {
  getBounding?: () => { height: number };
  _container?: { offsetHeight?: number } | null;
  _mainWidget?: { _mainCanvas?: { _element?: { clientHeight?: number } | null } | null } | null;
};

type ChartLike = {
  _drawPanes?: PaneLike[];
  /** v9 里是 Map（按上方窗格索引），老版本是数组：两种都接受。 */
  _separatorPanes?: Iterable<PaneLike> | Map<unknown, PaneLike>;
  _chartContainer?: { clientHeight?: number } | null;
};

const TOLERANCE_PX = 1.5;

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** 内部布局与 DOM 是否已经对不上；读不出来（结构不认识）时返回 false。 */
export function klineChartLayoutIsStale(chart: unknown): boolean {
  try {
    const c = chart as ChartLike;
    const drawPanes = Array.isArray(c._drawPanes) ? c._drawPanes : null;
    if (!drawPanes || drawPanes.length === 0) return false;
    let boundingSum = 0;
    for (const pane of drawPanes) {
      const bounding = pane.getBounding?.().height;
      if (!finiteNumber(bounding)) return false;
      boundingSum += bounding;
      // 窗格自己的 DOM 高度与内部高度
      const domHeight = pane._container?.offsetHeight;
      if (finiteNumber(domHeight) && Math.abs(domHeight - bounding) > TOLERANCE_PX) return true;
      // 窗格画布的高度与内部高度（画布没跟着重排时，画面是旧布局）
      const canvasHeight = pane._mainWidget?._mainCanvas?._element?.clientHeight;
      if (finiteNumber(canvasHeight) && canvasHeight > 0 && Math.abs(canvasHeight - bounding) > TOLERANCE_PX) return true;
    }
    // 各窗格（_drawPanes 已含横轴窗格）加上分隔条，应等于整个图表容器的高度
    const containerHeight = c._chartContainer?.clientHeight;
    if (finiteNumber(containerHeight) && containerHeight > 0) {
      const separatorSource = c._separatorPanes;
      const separatorList: PaneLike[] = separatorSource instanceof Map
        ? Array.from(separatorSource.values())
        : separatorSource ? Array.from(separatorSource as Iterable<PaneLike>) : [];
      const separators = separatorList.reduce((sum, pane) => {
        const height = pane.getBounding?.().height;
        return sum + (finiteNumber(height) ? height : 0);
      }, 0);
      if (Math.abs(containerHeight - (boundingSum + separators)) > TOLERANCE_PX * 2) return true;
    }
    return false;
  } catch {
    return false;
  }
}
