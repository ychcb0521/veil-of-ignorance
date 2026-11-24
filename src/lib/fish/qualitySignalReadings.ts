import {staticDblDistancePct} from './dblDistancePct';
import { formatUTC8 } from '@/lib/timeFormat';
import { signalDedupKey } from '@/lib/signalLibrary';
import { shortFishHash } from './algorithm';
import { qualitySignalTime } from './qualityAdmissionTime';
import { readQualityMetricAt } from './qualityEntry';
import { definitionKey } from '../deepDig/features';
import { dbl5GuardVersion, dbl5Parameters } from '../dbl5m';
import { createGuardDistanceReader, guardDistanceDefinition, guardDistanceSignalChoice } from './qualityGuardDistance';
import { qualityDefinition } from './quality';
import type { FishQualityStudy, QualityBuyFilter, QualityFilterReading, QualityRunOptions, QualitySample } from './quality';
import type { FishReconstructionLoader } from './reconstruction';
import { withTuringInitialization } from './qualityInitialization';

export type QualitySignalMetric = Pick<QualityBuyFilter, 'id' | 'label' | 'metric' | 'snapshot' | 'initialization'>;
export const SIGNAL_GUARD_PCT = 'signal-guard-distance-pct-v1/';
export function signalGuardPercentMetric(metric: QualitySignalMetric): QualitySignalMetric {
  if (!guardDistanceSignalChoice(metric.snapshot.featureId, metric.metric)) return metric;
  return {...metric, id:SIGNAL_GUARD_PCT+metric.id, metric:SIGNAL_GUARD_PCT+metric.metric,
    label:metric.label.replace(/（ATR）|\(ATR\)/g,'（%）'), snapshot:{...metric.snapshot,unit:'%'}};
}

export function makeSignalGuardFilter(metric: QualitySignalMetric, atr: number, threshold: number, enabled = true,
    direction: '<' | '>' = '<'): QualityBuyFilter {
  const pct = signalGuardPercentMetric(metric);
  if (!pct.metric.startsWith(SIGNAL_GUARD_PCT) || !Number.isFinite(atr) || atr < 0 ||
      !Number.isFinite(threshold) || threshold < 0) throw Error('请填写非负的冗余 ATR 和百分比门槛');
  return {...pct, id:'buy-'+shortFishHash(JSON.stringify([pct.snapshot.definitionKey,pct.metric,atr,direction,threshold])),
    signalGuardAtr:atr, threshold, direction, enabled, snapshot:{...pct.snapshot,threshold,direction}};
}

export function activeSignalMetrics(study: FishQualityStudy): QualitySignalMetric[] {
  const saved = study.independentFilters ? study.turingStaticSettings : undefined;
  return saved?.active && saved.plan.staticFilter
    ? saved.plan.staticFilter.metrics.map(metric => ({ ...metric, initialization: saved.plan.initialization }))
    : study.signalMetrics ?? [];
}
export interface QualitySignalReadingBatch {
  metric: QualitySignalMetric;
  rows: readonly QualitySample[];
}
export const signalReadingKey = (row: QualitySample, metric: QualitySignalMetric, viewRowId?: string) =>
  'signal-read-v1:' + shortFishHash(JSON.stringify([signalDedupKey({...row.source,timeMs:qualitySignalTime(row.source)}),metric.id, ...(viewRowId ? [viewRowId] : []), ...(metric.initialization ? [metric.initialization] : [])]));

export function signalReadingCell(row: QualitySample, metric: QualitySignalMetric, readings: ReadonlyMap<string, QualityFilterReading>, viewRowId?: string) {
  const reading = readings.get(signalReadingKey(row,metric,viewRowId));
  const value = reading && !reading.error && Number.isFinite(reading.value) ? reading.value! : null;
  const status = value !== null ? '' : reading?.error ? '缺数据' : '待计算';
  const detail = [`信号时间 ${formatUTC8(qualitySignalTime(row.source))}`, reading?.at ? `读数截至 ${formatUTC8(reading.at)}` : '',
    value !== null ? String(value) + (metric.snapshot.unit === 'ATR' ? ' ATR' : '') : reading?.error ?? status].filter(Boolean).join('\n');
  const text = value === null ? status : metric.metric.startsWith(SIGNAL_GUARD_PCT) ? value.toFixed(2)+'%' : metric.snapshot.unit === 'ATR' ? `${value > 0 ? '+' : ''}${Number(value.toPrecision(6))} ATR` : String(value);
  return {value,status,detail,text};
}

export async function readSignalGuardDistance(metric: QualitySignalMetric, row: QualitySample, now: number,
    load: FishReconstructionLoader, signal: AbortSignal, marketStart?: QualityRunOptions['marketStart'], atr = 0) {
  const time = qualitySignalTime(row.source);
  const pct = metric.metric.startsWith(SIGNAL_GUARD_PCT);
  const guard = guardDistanceSignalChoice(metric.snapshot.featureId, pct ? metric.metric.slice(SIGNAL_GUARD_PCT.length) : metric.metric);
  if (!guard || !Number.isFinite(atr) || atr < 0) throw Error('信号时点 DBL-5 距离参数无效');
  const guardStart = await marketStart?.(row.source.symbol);
  const initialized = metric.initialization ? withTuringInitialization(load,row.source.symbol,guardStart ?? NaN) : load;
  if (!Number.isFinite(time) || time <= 0) throw Error('缺少有效信号时间');
  if (Math.floor(time / 60_000) > Math.floor(now / 60_000)) throw Error('信号时刻尚未到达，不能提前读取');
  const saved = qualityDefinition(metric.snapshot).DBL5_config;
  if (!saved || dbl5GuardVersion(saved) !== guard.version || saved.timeframe!==guard.timeframe || definitionKey(guardDistanceDefinition(dbl5Parameters(saved))) !== metric.snapshot.definitionKey) {
    throw Error('防守线距离的冻结版本或参数不符，请保留原读数');
  }
  const read = createGuardDistanceReader(dbl5Parameters(saved), {row:{...row.source,timeMs:now},start:time,load:initialized,signal}, guardStart);
  const result = await read(time);
  if ('pending' in result) return {error:result.pending};
  const value = pct ? staticDblDistancePct(result.price,result.line,result.atr,atr) : result.multiple;
  return Number.isFinite(value) ? {value,at:result.at} : {error:'防守线距离无有效读数'};
}

export async function collectQualitySignalReadings(options: QualityRunOptions, load: FishReconstructionLoader, now: number) {
  const {signal, signalReadingBatches} = options;
  if (!signalReadingBatches?.length) throw Error('请选择信号读数算法');
  const unique = new Map<string, {metric: QualitySignalMetric; row: QualitySample}>();
  for (const {metric, rows} of signalReadingBatches) {
    for (const row of rows) unique.set(signalReadingKey(row, metric), {metric, row});
  }
  let done = 0;
  for (const [key, {metric, row}] of unique) {
    if (signal.aborted) throw new DOMException('已取消','AbortError');
    options.onProgress({done,total:unique.size,current:row.source.symbol});
    let reading: QualityFilterReading;
    try {
      const time = qualitySignalTime(row.source);
      if (metric.metric.startsWith(SIGNAL_GUARD_PCT) || guardDistanceSignalChoice(metric.snapshot.featureId,metric.metric)) {
        reading = {key,...await readSignalGuardDistance(metric,row,now,load,signal,options.marketStart)};
      } else {
        const initialized = metric.initialization
          ? withTuringInitialization(load,row.source.symbol,await options.marketStart?.(row.source.symbol) ?? NaN) : load;
        const result = await readQualityMetricAt(row.source,metric.snapshot,metric.metric,time,'signal',initialized,now,signal,'信号');
        reading = result.initializing ? {key,error:'等待指标初始化'} : {key,value:result.value,at:result.at};
      }
    } catch (error) {
      if (signal.aborted) throw new DOMException('已取消','AbortError');
      reading = {key,error:error instanceof Error ? error.message : '信号读数失败'};
    }
    if (signal.aborted) throw new DOMException('已取消','AbortError');
    options.onSignalReading?.(reading);
    done++;
  }
  options.onProgress({done,total:unique.size,current:''});
}
