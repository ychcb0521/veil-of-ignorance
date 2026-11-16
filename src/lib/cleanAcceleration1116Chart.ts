import {registerIndicator, type IndicatorDrawParams, type KLineData} from 'klinecharts';

export const CLEAN_ACCELERATION_1116_ID = 'CLEAN_ACCELERATION_1116';
export const CLEAN_ACCELERATION_1116_INDICATOR = 'CLEAN_ACCELERATION_1116_CUSTOM';
export const CLEAN_ACCELERATION_1116_NAME = '纯净加速时机线-1116';
export const CLEAN_ACCELERATION_1116_COLOR = '#0891b2';
export const ACCELERATION_MINUTE = 60_000;
export const ACCELERATION_DISPLAY_STEP = 5 * ACCELERATION_MINUTE;
const ATR_PERIOD = 14;
const MIN_ADVANCES = 4;
const MIN_GAIN_ATR = 2;
const MIN_PACE_RATIO = 1.25;
export const ACCELERATION_WARMUP_MINUTES = ATR_PERIOD + MIN_ADVANCES + 1;

export const CLEAN_ACCELERATION_1116_DESCRIPTION =
  `用已收盘的 1 分钟 K 线识别早期加速。连续 ${MIN_ADVANCES} 根阳线逐根抬高高点、低点和收盘价，后两根涨幅至少是前两根的 ${MIN_PACE_RATIO} 倍，四根涨幅至少达到起涨前 ${MIN_GAIN_ATR} 倍 1m ATR(${ATR_PERIOD})。在 5 分钟图上标出实际确认时点，每根 5 分钟 K 线取首次确认。`;

export interface AccelerationMinute {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}
export interface AccelerationSignal {
  at: number;
  value: number;
  gainAtr: number;
  paceRatio: number;
}
type Position = AccelerationSignal | {value?: undefined};
export interface AccelerationChartInput {
  signals: readonly AccelerationSignal[];
  through: number;
  timezone: string;
  status: 'loading' | 'ready' | 'missing' | 'error';
}

/** Reconstruct from closed minute bars. The ATR window is fixed so preloading
 * older candles cannot shift an existing confirmation. */
export function cleanAcceleration1116Signals(bars: readonly AccelerationMinute[]): AccelerationSignal[] {
  const ranges: number[] = [];
  const atrByIndex: number[] = [];
  const signals: AccelerationSignal[] = [];
  let rangeSum = 0, consecutive = 0, advances = 0;
  for (let index=0; index<bars.length; index++) {
    const bar = bars[index], previous = bars[index-1];
    if (![bar.time,bar.open,bar.high,bar.low,bar.close].every(Number.isFinite)
      || bar.low<=0 || bar.low>Math.min(bar.open,bar.close) || bar.high<Math.max(bar.open,bar.close)) {
      consecutive = 0;
      continue;
    }
    const contiguous = consecutive>0 && bar.time-previous.time===ACCELERATION_MINUTE;
    const range = contiguous
      ? Math.max(bar.high-bar.low,Math.abs(bar.high-previous.close),Math.abs(bar.low-previous.close))
      : bar.high-bar.low;
    ranges[index] = range;
    rangeSum = contiguous ? rangeSum+range : range;
    consecutive = contiguous ? consecutive+1 : 1;
    if (consecutive>ATR_PERIOD) rangeSum -= ranges[index-ATR_PERIOD];
    atrByIndex[index] = rangeSum/ATR_PERIOD;

    advances = contiguous && bar.close>bar.open && bar.close>previous.close
      && bar.high>previous.high && bar.low>previous.low ? advances+1 : 0;
    if (advances<MIN_ADVANCES || consecutive<ACCELERATION_WARMUP_MINUTES) continue;
    const baseline = index-MIN_ADVANCES;
    const before = bars[baseline].close;
    const halfway = bars[baseline+MIN_ADVANCES/2].close;
    const baselineAtr = atrByIndex[baseline];
    if (!(baselineAtr>0)) continue;
    const gainAtr = (bar.close-before)/baselineAtr;
    const paceRatio = (bar.close-halfway)/(halfway-before);
    if (gainAtr>=MIN_GAIN_ATR && paceRatio>=MIN_PACE_RATIO) {
      signals.push({at:bar.time+ACCELERATION_MINUTE,value:bar.low,gainAtr,paceRatio});
    }
  }
  return signals;
}

export function accelerationPositions(bars: readonly Pick<KLineData,'timestamp'>[], input?: AccelerationChartInput): Position[] {
  const byCandle = new Map<number,AccelerationSignal>();
  if (!input) return bars.map(()=>({}));
  for (const signal of input.signals) {
    if (signal.at>input.through) break;
    // A confirmation at the exact 5m boundary belongs to the newly opened candle.
    const open = Math.floor(signal.at/ACCELERATION_DISPLAY_STEP)*ACCELERATION_DISPLAY_STEP;
    if (!byCandle.has(open)) byCandle.set(open,signal);
  }
  return bars.map(bar=>byCandle.get(bar.timestamp)??{});
}

function drawAccelerationLine({ctx,indicator,kLineDataList,visibleRange,xAxis,yAxis}: IndicatorDrawParams<Position>) {
  const input = indicator.extendData as AccelerationChartInput | undefined;
  if (!input) return true;
  const from = Math.max(0,Math.floor(visibleRange.from)-1);
  const to = Math.min(indicator.result.length,kLineDataList.length,Math.ceil(visibleRange.to)+1);
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = CLEAN_ACCELERATION_1116_COLOR;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  for (let index=from; index<to; index++) {
    const row = indicator.result[index];
    const time = kLineDataList[index].timestamp;
    if (!('at' in row) || row.at<time || row.at>input.through || row.at>=time+ACCELERATION_DISPLAY_STEP) continue;
    const x = xAxis.convertToPixel(index);
    const width = xAxis.convertToPixel(index+1)-x;
    const start = x+width*(row.at-time)/ACCELERATION_DISPLAY_STEP;
    const next = kLineDataList[index+1]?.timestamp===time+ACCELERATION_DISPLAY_STEP ? indicator.result[index+1] : undefined;
    // Give a late-minute mark room to read at ordinary zoom. Stop by the
    // next candle's close, or sooner if it has its own confirmation.
    const end = next ? time+2*ACCELERATION_DISPLAY_STEP : time+ACCELERATION_DISPLAY_STEP;
    const nextAt = next && 'at' in next ? next.at : end;
    const stop = x+width*(Math.min(end,nextAt,input.through)-time)/ACCELERATION_DISPLAY_STEP;
    const y = yAxis.convertToPixel(row.value);
    ctx.moveTo(start,y);
    ctx.lineTo(Math.max(start+3,stop),y);
  }
  ctx.stroke();
  ctx.restore();
  return true;
}

const STATUS_TEXT = {loading:'正在读取 1m 行情',missing:'缺少 1m 行情',error:'1m 行情读取失败',ready:'此处未确认'};
export function registerCleanAcceleration1116Chart() {
  registerIndicator<Position>({
    name:CLEAN_ACCELERATION_1116_INDICATOR, shortName:CLEAN_ACCELERATION_1116_NAME, calcParams:[5], precision:8,
    figures:[{key:'value',title:'确认低点: ',type:'line',styles:()=>({color:CLEAN_ACCELERATION_1116_COLOR,size:2})}],
    calc:(bars,indicator)=>accelerationPositions(bars,indicator.extendData),
    draw:drawAccelerationLine,
    createTooltipDataSource:({indicator,crosshair,defaultStyles,kLineDataList}) => {
      const input = indicator.extendData as AccelerationChartInput | undefined;
      const index = crosshair?.dataIndex ?? kLineDataList.length-1;
      const point = indicator.result[index];
      const row = point && 'at' in point && input && point.at<=input.through ? point : undefined;
      const time = row && new Intl.DateTimeFormat('zh-CN',{timeZone:input?.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(row.at);
      return {
        name:CLEAN_ACCELERATION_1116_NAME,
        calcParamsText:row?' · 1m 确认 / 5m 标注':' · '+STATUS_TEXT[input?.status??'missing'],
        icons:defaultStyles.tooltip.icons,
        values: row ? [
          {title:'确认时刻: ',value:time!},
          {title:'确认低点: ',value:{text:Number(row.value.toPrecision(9)).toString(),color:CLEAN_ACCELERATION_1116_COLOR}},
          {title:'四根涨幅: ',value:`${row.gainAtr.toFixed(2)} ATR`},
          {title:'后两根 / 前两根: ',value:`${row.paceRatio.toFixed(2)} 倍`},
        ] : [],
      };
    },
  });
}
