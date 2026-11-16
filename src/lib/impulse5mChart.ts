import { registerIndicator, type IndicatorDrawParams, type KLineData } from 'klinecharts';
import { confirmedImpulse5m, IMPULSE_5M_DISPLAY_NAME, IMPULSE_5M_STEP as STEP } from './impulse5m';
export { IMPULSE_5M_DISPLAY_NAME, IMPULSE_5M_VERSION } from './impulse5m';

export const IMPULSE_5M_ID = 'IMPULSE_5M';
export const IMPULSE_5M_INDICATOR = 'IMPULSE_5M_CUSTOM';

export const IMPULSE_5M_LINE_COLOR = '#a855f7';
type Candle = KLineData & { cba2Closed?: boolean; turnover?: number; takerBuyTurnover?: number };
type Point = { value?: number; confirmedAt?: number };

/** The low appears from the following 5m candle, when the impulse candle is closed. */
export function impulse5mChartSeries(bars: readonly Candle[]): Point[] {
  let contiguous = 0;
  let active: { low: number; confirmedAt: number } | undefined;
  return bars.map((bar, index) => {
    const tip = bars[index - 1];
    if (!tip || bar.timestamp - tip.timestamp !== STEP || tip.cba2Closed === false) {
      contiguous = 0;
      active = undefined;
      return {};
    }
    contiguous++;
    if (active && (tip.low <= active.low || bar.timestamp - active.confirmedAt >= 12 * STEP)) active = undefined;
    if (contiguous >= 25) {
      const hit = confirmedImpulse5m(tip, bars.slice(index - 25, index - 1), bars[index - 26]);
      if (hit) active = hit;
    }
    return active ? { value: active.low, confirmedAt: active.confirmedAt } : {};
  });
}

export function drawImpulse5mReference<Row>(
  {ctx, indicator, visibleRange, xAxis, yAxis}: IndicatorDrawParams<Row>,
  pointOf: (row: Row) => Point,
) {
  ctx.save();
  ctx.strokeStyle = IMPULSE_5M_LINE_COLOR;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  let previous: number | undefined;
  for (let index = Math.max(0, visibleRange.from - 1); index < Math.min(indicator.result.length, visibleRange.to + 1); index++) {
    const point = pointOf(indicator.result[index]);
    if (point.value == null) { previous = undefined; continue; }
    const x = xAxis.convertToPixel(index), y = yAxis.convertToPixel(point.value);
    if (point.confirmedAt === previous && previous != null) ctx.lineTo(x, y);
    else { ctx.moveTo(x, y); ctx.lineTo(x + 2, y); }
    previous = point.confirmedAt;
  }
  ctx.stroke();
  ctx.restore();
}

export function registerImpulse5mChart() {
  registerIndicator<Point>({
    name: IMPULSE_5M_INDICATOR, shortName: IMPULSE_5M_DISPLAY_NAME, precision: 8, calcParams: [5],
    figures: [{ key: 'value', title: '起涨低点: ', type: 'line', styles: () => ({ color: IMPULSE_5M_LINE_COLOR, size: 2 }) }],
    calc: impulse5mChartSeries,
    draw: params => {
      drawImpulse5mReference(params, point => point);
      return true;
    },
  });
}
