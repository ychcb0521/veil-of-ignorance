import type { Chart } from 'klinecharts';

const CANDLE_PANE = 'candle_pane';
const DEFAULT_INDICATOR_HEIGHT = 80;

/**
 * KLineCharts 9.8.12 can drop its pixel-resize callback when another paint is
 * already queued. CSS then stretches an old bitmap after a pane height change.
 * Run after native paints settle and retry its own pixel-ratio handler only
 * for canvases whose bitmap still disagrees with their displayed dimensions.
 */
export function synchronizeChartPaneCanvases(chart: Chart): void {
  type NativeCanvas = {
    _element?: HTMLCanvasElement;
    _mediaQueryListener?: () => void;
  };
  type NativeWidget = { _mainCanvas?: NativeCanvas; _overlayCanvas?: NativeCanvas };
  const panes = (chart as unknown as { _drawPanes?: Array<{ _mainWidget?: NativeWidget; _yAxisWidget?: NativeWidget }> })._drawPanes;
  for (const pane of panes ?? []) {
    for (const widget of [pane._mainWidget, pane._yAxisWidget]) {
      for (const canvas of [widget?._mainCanvas, widget?._overlayCanvas]) {
        const element = canvas?._element;
        if (!element || !element.clientWidth || !element.clientHeight) continue;
        const ratio = element.ownerDocument.defaultView?.devicePixelRatio ?? 1;
        if (Math.abs(element.width - Math.round(element.clientWidth * ratio)) > 1
          || Math.abs(element.height - Math.round(element.clientHeight * ratio)) > 1) {
          canvas?._mediaQueryListener?.();
        }
      }
    }
  }
}

/** Keep preferred splitter sizes separate from sizes compressed by the viewport. */
export function createChartPaneLayout() {
  const preferredHeights = new Map<string, number>();
  const indicatorIds = (ids: Iterable<string | null>) => [...new Set(ids)]
    .filter((id): id is string => !!id && id !== CANDLE_PANE && id !== 'x_axis_pane');

  return {
    remember(chart: Chart, ids: Iterable<string | null>) {
      for (const id of indicatorIds(ids)) {
        const height = chart.getSize(id)?.height;
        if (height && height > 0) preferredHeights.set(id, height);
      }
    },
    apply(chart: Chart, hostHeight: number, ids: Iterable<string | null>) {
      if (!(hostHeight > 0) || typeof chart.setPaneOptions !== 'function') return;
      const panes = indicatorIds(ids);
      for (const id of preferredHeights.keys()) {
        if (!panes.includes(id)) preferredHeights.delete(id);
      }
      const axisHeight = chart.getSize('x_axis_pane')?.height ?? 24;
      const separatorHeight = chart.getStyles().separator.size;
      const available = Math.max(0, Math.floor(hostHeight - axisHeight - panes.length * separatorHeight));
      if (!available) return;

      // Native resize gives candles only what remains after every indicator.
      // Its candle minHeight alone does not reserve space during a resize.
      const candleReserve = Math.ceil(Math.max(available * 0.55, Math.min(180, available * 0.75)));
      chart.setPaneOptions({ id: CANDLE_PANE, minHeight: Math.min(180, candleReserve) });
      const preferences = panes.map(id => preferredHeights.get(id) ?? DEFAULT_INDICATOR_HEIGHT);
      const total = preferences.reduce((sum, height) => sum + height, 0);
      const scale = total ? Math.min(1, (available - candleReserve) / total) : 1;
      panes.forEach((id, index) => {
        const height = Math.max(1, Math.floor(preferences[index] * scale));
        // Reduce the library's default 30px minimum as well in small split views.
        chart.setPaneOptions({ id, height, minHeight: Math.min(30, height) });
      });
    },
  };
}
