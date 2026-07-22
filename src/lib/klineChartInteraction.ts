/**
 * KlineCharts v9 registers mousemove and wheel listeners lazily from mouseenter.
 * When an asynchronously loaded chart appears underneath a stationary pointer,
 * the browser does not emit that mouseenter and the chart remains inert until
 * the pointer leaves and re-enters. Prime the library's event root once so the
 * first real pointer movement is handled immediately.
 */
export const primeKlineChartPointerInteraction = (host: HTMLElement): boolean => {
  const chartEventRoot = host.firstElementChild;
  const view = host.ownerDocument.defaultView;
  if (!(chartEventRoot instanceof HTMLElement) || !view) return false;

  const bounds = chartEventRoot.getBoundingClientRect();
  chartEventRoot.dispatchEvent(new view.MouseEvent("mouseenter", {
    bubbles: false,
    cancelable: false,
    clientX: bounds.left + bounds.width / 2,
    clientY: bounds.top + bounds.height / 2,
  }));
  return true;
};
