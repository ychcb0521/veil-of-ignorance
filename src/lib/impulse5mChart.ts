import { registerIndicator, type IndicatorDrawParams, type KLineData } from 'klinecharts';

export const IMPULSE_5M_ID = 'IMPULSE_5M';
export const IMPULSE_5M_INDICATOR = 'IMPULSE_5M_CUSTOM';
export const IMPULSE_5M_VERSION = 'impulse-low-5m-v1';
const STEP = 300_000;
const COLOR = '#a855f7';
type Candle = KLineData & { cba2Closed?: boolean; turnover?: number; takerBuyTurnover?: number };
type Point = { value?: number; confirmedAt?: number };

function median(values: number[]) {
  values.sort((a, b) => a - b);
  return (values[11] + values[12]) / 2;
}

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
    if (contiguous >= 25 && tip.turnover != null && tip.takerBuyTurnover != null && tip.turnover > 0 && tip.high > tip.low) {
      const baseline = bars.slice(index - 25, index - 1);
      const volumes = baseline.map(candle => candle.turnover ?? NaN);
      const ranges = baseline.map((candle, i) => {
        const prior = bars[index - 26 + i];
        return !prior || candle.timestamp - prior.timestamp !== STEP ? candle.high - candle.low :
          Math.max(candle.high - candle.low, Math.abs(candle.high - prior.close), Math.abs(candle.low - prior.close));
      });
      const typicalRange = median(ranges);
      const volume = median(volumes);
      const body = tip.close - tip.open;
      const width = tip.high - tip.low;
      const ceiling = Math.max(...baseline.slice(-6).map(candle => candle.high));
      const base = Math.min(...baseline.slice(-4).map(candle => candle.low));
      if (volumes.every(value => Number.isFinite(value) && value >= 0) && typicalRange > 0 && volume > 0 && base > 0 && tip.open > 0 &&
        body / tip.open >= .006 && body >= 1.45 * typicalRange && tip.close > ceiling + .1 * typicalRange &&
        body / width >= .55 && (tip.close - tip.low) / width >= .77 && tip.open / base - 1 <= .025 &&
        tip.turnover >= 1.5 * volume && tip.takerBuyTurnover / tip.turnover >= .58 && tip.takerBuyTurnover <= tip.turnover) {
        active = { low: tip.low, confirmedAt: bar.timestamp };
      }
    }
    return active ? { value: active.low, confirmedAt: active.confirmedAt } : {};
  });
}

export function registerImpulse5mChart() {
  registerIndicator<Point>({
    name: IMPULSE_5M_INDICATOR, shortName: '急拉线', precision: 8, calcParams: [5],
    figures: [{ key: 'value', title: '起涨低点: ', type: 'line', styles: () => ({ color: COLOR, size: 2 }) }],
    calc: impulse5mChartSeries,
    draw: ({ ctx, indicator, visibleRange, xAxis, yAxis }: IndicatorDrawParams<Point>) => {
      ctx.save();
      ctx.strokeStyle = COLOR;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      let previous: number | undefined;
      for (let index = Math.max(0, visibleRange.from - 1); index < Math.min(indicator.result.length, visibleRange.to + 1); index++) {
        const point = indicator.result[index];
        if (point.value == null) { previous = undefined; continue; }
        const x = xAxis.convertToPixel(index), y = yAxis.convertToPixel(point.value);
        if (point.confirmedAt === previous && previous != null) ctx.lineTo(x, y);
        else { ctx.moveTo(x, y); ctx.lineTo(x + 2, y); }
        previous = point.confirmedAt;
      }
      ctx.stroke();
      ctx.restore();
      return true;
    },
  });
}
