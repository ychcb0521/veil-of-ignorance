import {registerIndicator, type IndicatorDrawParams, type KLineData} from 'klinecharts';
import {DBL5_STEP} from './dbl5m';
import {accountResearchIndicators, researchChartSeries, researchKcName, type ResearchIndicator} from './researchIndicators';

const COLOR = '#a21caf';

export interface Impulse1115ChartRow {
  time: number;
  available: boolean;
  pending: boolean;
  value?: number;
  confirmedOrigin?: number;
}
const rowsBySeries = new WeakMap<ReturnType<typeof researchChartSeries>, Impulse1115ChartRow[]>();

/** Project the impulse outputs of 1115 onto their own chart, sharing its closed-bar calculation. */
export function impulse1115ChartRows(bars: KLineData[], period: number, fetchReference = true): Impulse1115ChartRow[] {
  const combined = accountResearchIndicators().find(item => item.id === 'DBL5_GUARD_PLUS')!;
  const series = researchChartSeries(bars, combined, period, {fetchReference});
  const cached = rowsBySeries.get(series);
  if (cached) return cached;
  const {DBL5P_impulse: reference, DBL5P_early: early, _DBL5P_detected_origin: origin} = series.components ?? {};
  const rows = bars.map(({timestamp}, index) => {
    const value = reference?.[index] ?? NaN;
    const low = origin?.[index] ?? NaN;
    return {
      time: timestamp,
      available: Number.isFinite(early?.[index]),
      pending: !!series.pending,
      ...(Number.isFinite(value) ? {value} : {}),
      ...(early?.[index] === 1 && Number.isFinite(low) ? {confirmedOrigin: low} : {}),
    };
  });
  rowsBySeries.set(series, rows);
  return rows;
}

function continuous(row: Impulse1115ChartRow | undefined, previous: Impulse1115ChartRow | undefined) {
  return row != null && previous != null && row.time - previous.time === DBL5_STEP;
}

export function impulse1115TooltipRow(rows: readonly Impulse1115ChartRow[], index?: number) {
  const last = rows.at(-1);
  if (index == null && last?.available) return last;
  const current = index ?? rows.length - 1;
  const previous = rows[current - 1];
  return continuous(rows[current], previous) ? previous : undefined;
}

export function registerImpulse1115Chart(item: ResearchIndicator) {
  registerIndicator<Impulse1115ChartRow>({
    name: researchKcName(item.id), shortName: item.short, calcParams: [3, 0, 0],
    figures: [{key:'value', title:'急拉参考: ', type:'line', styles:()=>({color:COLOR, size:2})}],
    calc: (bars, indicator) => impulse1115ChartRows(bars, indicator.calcParams[0]),
    draw: ({ctx, indicator, visibleRange, xAxis, yAxis}: IndicatorDrawParams<Impulse1115ChartRow>) => {
      const rows = indicator.result;
      const from = Math.max(0, Math.floor(visibleRange.from) - 2);
      const to = Math.min(rows.length, Math.ceil(visibleRange.to) + 1);
      const marks: {x: number; y: number}[] = [];
      ctx.save();
      ctx.beginPath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLOR;
      ctx.setLineDash([]);
      for (let index = from; index < to; index++) {
        const row = rows[index], previous = rows[index - 1];
        const x = xAxis.convertToPixel(index + 1);
        // Draw the previous published value only through a continuous, completed bar.
        // A new value begins at this close. Gaps and forming candles never extend the line.
        const carries = row.available && previous?.value != null && continuous(row, previous);
        if (carries) {
          const y = yAxis.convertToPixel(previous.value!);
          ctx.moveTo(xAxis.convertToPixel(index), y);
          ctx.lineTo(x, y);
        }
        if (row.value != null && (!carries || row.value !== previous.value)) {
          const y = yAxis.convertToPixel(row.value);
          ctx.moveTo(x - 1, y);
          ctx.lineTo(x + 1, y);
        }
        if (row.confirmedOrigin != null) marks.push({x, y:yAxis.convertToPixel(row.confirmedOrigin)});
      }
      ctx.stroke();
      ctx.fillStyle = COLOR;
      for (const {x,y} of marks) {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return true;
    },
    createTooltipDataSource: ({indicator, crosshair, defaultStyles}) => {
      const row = impulse1115TooltipRow(indicator.result, crosshair?.dataIndex);
      const format = (price: number) => Number(price.toPrecision(10)).toString();
      const pending = indicator.result.at(-1)?.pending;
      return {
        name: item.short,
        calcParamsText: pending ? ' · 正在准备 5m 行情' : ' · 5m 已收盘',
        icons: defaultStyles.tooltip.icons,
        values: [
          {title:'急拉参考: ',value:row?.value == null ? '—' : format(row.value)},
          ...(row?.confirmedOrigin == null ? [] : [{title:'确认起涨低点: ',value:format(row.confirmedOrigin)}]),
        ],
      };
    },
  });
}
