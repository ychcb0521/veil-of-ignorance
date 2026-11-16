import {registerIndicator, type IndicatorDrawParams, type KLineData} from 'klinecharts';
import {advanceChartAtr, type ChartAtrState} from '@/lib/atr';

export const CLEAN_ACCELERATION_1116_ID = 'CLEAN_ACCELERATION_1116';
export const CLEAN_ACCELERATION_1116_INDICATOR = 'CLEAN_ACCELERATION_1116_CUSTOM';
export const CLEAN_ACCELERATION_1116_NAME = '纯净加速时机线-1116';
export const CLEAN_ACCELERATION_1116_COLOR = '#0891b2';
const STEP = 5 * 60_000;
const ATR_PERIOD = 14;
const MIN_ADVANCES = 4;
const MIN_GAIN_ATR = 2;
const MIN_PACE_RATIO = 1.25;

export const CLEAN_ACCELERATION_1116_DESCRIPTION =
  `连续 ${MIN_ADVANCES} 根阳线的高点、低点和收盘价逐根抬高。末两根的收盘涨幅至少是前两根的 ${MIN_PACE_RATIO} 倍，四根总涨幅至少达到起涨前 ${MIN_GAIN_ATR} 倍 ATR(${ATR_PERIOD})。收盘后以确认 K 线的低点画线。`;

type Candle = KLineData & {cba2Closed?: boolean};
type AccelerationPosition =
  | {value: number; gainAtr: number; paceRatio: number}
  | {value?: undefined};

function validCandle({timestamp,open,high,low,close}: Candle) {
  return [timestamp,open,high,low,close].every(Number.isFinite)
    && low>0 && low<=Math.min(open,close) && high>=Math.max(open,close);
}

/** The result belongs to the confirming candle and becomes visible at its close. */
export function cleanAcceleration1116Series(bars: readonly Candle[]): AccelerationPosition[] {
  const atrByIndex: number[] = [];
  let atr: ChartAtrState | undefined;
  let consecutive = 0;
  let advances = 0;
  return bars.map((bar,index) => {
    const previous = bars[index-1];
    const next = bars[index+1];
    if (!validCandle(bar) || !(bar.cba2Closed ?? (next!=null && next.timestamp>=bar.timestamp+STEP))) {
      atr = undefined;
      consecutive = 0;
      advances = 0;
      return {};
    }
    const contiguous = consecutive>0 && bar.timestamp-previous.timestamp===STEP;
    if (!contiguous) atr = undefined;
    atr = advanceChartAtr(atr,bar,ATR_PERIOD);
    atrByIndex[index] = atr.value;
    consecutive = contiguous ? consecutive+1 : 1;

    const advancesNow = contiguous && bar.close>bar.open && bar.close>previous.close
      && bar.high>previous.high && bar.low>previous.low;
    advances = advancesNow ? advances+1 : 0;
    if (advances<MIN_ADVANCES || consecutive<ATR_PERIOD+MIN_ADVANCES) return {};

    const baseline = index-MIN_ADVANCES;
    const before = bars[baseline].close;
    const halfway = bars[baseline+MIN_ADVANCES/2].close;
    const baselineAtr = atrByIndex[baseline];
    if (!(baselineAtr>0)) return {};
    const gainAtr = (bar.close-before)/baselineAtr;
    const paceRatio = (bar.close-halfway)/(halfway-before);
    return gainAtr>=MIN_GAIN_ATR&&paceRatio>=MIN_PACE_RATIO
      ? {value:bar.low,gainAtr,paceRatio}
      : {};
  });
}

function hasNextSlot(bars: readonly Candle[], index: number) {
  const current = bars[index];
  return current!=null && bars[index+1]?.timestamp===current.timestamp+STEP;
}

function drawAccelerationLine({ctx,indicator,kLineDataList,visibleRange,xAxis,yAxis}: IndicatorDrawParams<AccelerationPosition>) {
  const rows = indicator.result;
  const from = Math.max(0,Math.floor(visibleRange.from)-2);
  const to = Math.min(rows.length,kLineDataList.length,Math.ceil(visibleRange.to)+1);
  // A normal close aligns with the next opening. Place it between visible bars if there is a gap.
  const closeX = (index: number) => {
    const next = xAxis.convertToPixel(index+1);
    return index+1===kLineDataList.length || hasNextSlot(kLineDataList,index)
      ? next : (xAxis.convertToPixel(index)+next)/2;
  };
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = CLEAN_ACCELERATION_1116_COLOR;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  for (let index=from; index<to; index++) {
    const row = rows[index];
    if (row.value==null) continue;
    const contiguous = hasNextSlot(kLineDataList,index);
    const start = closeX(index);
    const end = contiguous ? closeX(index+1) : Math.min(start+5,xAxis.convertToPixel(index+1)+1);
    const y = yAxis.convertToPixel(row.value);
    ctx.moveTo(start,y);
    ctx.lineTo(end,y);
    const next = contiguous ? rows[index+1]?.value : undefined;
    if (next!=null) {
      ctx.lineTo(end,yAxis.convertToPixel(next));
    }
  }
  ctx.stroke();
  ctx.restore();
  return true;
}

export function registerCleanAcceleration1116Chart() {
  registerIndicator<AccelerationPosition>({
    name:CLEAN_ACCELERATION_1116_INDICATOR, shortName:CLEAN_ACCELERATION_1116_NAME, calcParams:[5], precision:8,
    figures:[{key:'value',title:'确认低点: ',type:'line',styles:()=>({color:CLEAN_ACCELERATION_1116_COLOR,size:2})}],
    calc:cleanAcceleration1116Series,
    draw:drawAccelerationLine,
    createTooltipDataSource:({indicator,crosshair,defaultStyles,kLineDataList}) => {
      const index = crosshair?.dataIndex;
      const row = index==null ? indicator.result.at(-1)
        : hasNextSlot(kLineDataList,index-1) ? indicator.result[index-1] : undefined;
      const fmt = (value: number) => Number(value.toPrecision(9)).toString();
      return {
        name:CLEAN_ACCELERATION_1116_NAME, calcParamsText:' · 5m 已收盘', icons:defaultStyles.tooltip.icons,
        values: row?.value==null ? [] : [
          {title:'确认低点: ',value:{text:fmt(row.value),color:CLEAN_ACCELERATION_1116_COLOR}},
          {title:'四根涨幅: ',value:`${row.gainAtr.toFixed(2)} ATR`},
          {title:'后两根 / 前两根: ',value:`${row.paceRatio.toFixed(2)} 倍`},
        ],
      };
    },
  });
}
