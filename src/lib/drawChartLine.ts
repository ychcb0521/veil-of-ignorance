import type { IndicatorDrawParams, IndicatorFigure } from 'klinecharts';

/** Draw a simple research line without building native figure objects per candle. */
export function drawChartLine(args: IndicatorDrawParams, figure: IndicatorFigure): boolean {
  const { ctx, indicator, visibleRange, xAxis, yAxis, defaultStyles, kLineDataList } = args;
  if (!xAxis || !visibleRange || figure.type !== 'line' || figure.attrs) return false;
  const base = indicator.styles?.lines?.[0] ?? defaultStyles.lines[0];
  if (!base || base.smooth || base.style !== 'solid') return false;
  const rows = indicator.result, key = figure.key;
  let color: string | undefined, width = 0, end = -2;
  let drawing = false;
  const flush = () => { if (drawing) ctx.stroke(); drawing = false; };
  ctx.save();
  ctx.setLineDash([]);
  for (let i = Math.max(0, visibleRange.from); i < Math.min(visibleRange.to, rows.length - 1); i++) {
    const a = rows[i]?.[key], b = rows[i+1]?.[key];
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) { flush(); end = -2; continue; }
    const style = figure.styles?.({ prev: { kLineData:kLineDataList[i-1], indicatorData:rows[i-1] }, current: { kLineData:kLineDataList[i], indicatorData:rows[i] }, next: { kLineData:kLineDataList[i+1], indicatorData:rows[i+1] } }, indicator, defaultStyles);
    const nextColor = style?.color ?? base.color, nextWidth = style?.size ?? base.size;
    const x = xAxis.convertToPixel(i), y = yAxis.convertToPixel(a);
    if (!drawing || color !== nextColor || width !== nextWidth || end !== i) {
      flush(); color = nextColor; width = nextWidth;
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x,y); drawing = true;
    }
    ctx.lineTo(xAxis.convertToPixel(i+1), yAxis.convertToPixel(b)); end = i+1;
  }
  flush(); ctx.restore(); return true;
}
