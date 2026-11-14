import { formatUTC8 } from '@/lib/timeFormat';
import { signalDedupKey } from '@/lib/signalLibrary';
import { shortFishHash } from './algorithm';
import { qualitySignalTime } from './qualityAdmissionTime';
import { readQualityMetricAt } from './qualityEntry';
import { DBL5_DEF, definitionKey } from '../deepDig/features';
import { dbl5GuardVersion, dbl5Parameters } from '../dbl5m';
import { createGuardDistanceReader, guardDistanceSignalChoice } from './qualityGuardDistance';
import { qualityDefinition } from './quality';
import type { FishQualityStudy, QualityBuyFilter, QualityFilterReading, QualityRunOptions, QualitySample } from './quality';
import type { FishReconstructionLoader } from './reconstruction';
import { withTuringInitialization } from './qualityInitialization';

export type QualitySignalMetric = Pick<QualityBuyFilter, 'id' | 'label' | 'metric' | 'snapshot' | 'initialization'>;
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
export const signalReadingKey = (row: QualitySample, metric: QualitySignalMetric) =>
  'signal-read-v1:' + shortFishHash(JSON.stringify([signalDedupKey({...row.source,timeMs:qualitySignalTime(row.source)}),metric.id, ...(metric.initialization ? [metric.initialization] : [])]));

export function signalReadingCell(row: QualitySample, metric: QualitySignalMetric, readings: ReadonlyMap<string, QualityFilterReading>) {
  const reading = readings.get(signalReadingKey(row,metric));
  const value = reading && !reading.error && Number.isFinite(reading.value) ? reading.value! : null;
  const status = value !== null ? '' : reading?.error ? '缺数据' : '待计算';
  const detail = [`信号时间 ${formatUTC8(qualitySignalTime(row.source))}`, reading?.at ? `读数截至 ${formatUTC8(reading.at)}` : '',
    value !== null ? String(value) + (metric.snapshot.unit === 'ATR' ? ' ATR' : '') : reading?.error ?? status].filter(Boolean).join('\n');
  const text = value === null ? status : metric.snapshot.unit === 'ATR' ? `${value > 0 ? '+' : ''}${Number(value.toPrecision(6))} ATR` : String(value);
  return {value,status,detail,text};
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
      const availableStart = metric.initialization ? await options.marketStart?.(row.source.symbol) : undefined;
      const initialized: FishReconstructionLoader = metric.initialization
        ? withTuringInitialization(load, row.source.symbol, availableStart ?? NaN) : load;
      const guard = guardDistanceSignalChoice(metric.snapshot.featureId, metric.metric);
      if (guard) {
        if (!Number.isFinite(time) || time <= 0) throw Error('缺少有效信号时间');
        if (Math.floor(time / 60_000) > Math.floor(now / 60_000)) throw Error('信号时刻尚未到达，不能提前读取');
        const saved = qualityDefinition(metric.snapshot).DBL5_config;
        if (!saved || dbl5GuardVersion(saved) !== guard.version || definitionKey({...DBL5_DEF, DBL5_config:saved}) !== metric.snapshot.definitionKey) {
          throw Error('防守线距离的冻结版本或参数不符，请保留原读数');
        }
        const guardStart = metric.initialization ? availableStart : await options.marketStart?.(row.source.symbol);
        const read = createGuardDistanceReader(dbl5Parameters(saved), {row:{...row.source,timeMs:now},start:time,load:initialized,signal}, guardStart);
        const result = await read(time);
        reading = 'pending' in result ? {key,error:result.pending}
          : Number.isFinite(result.multiple) ? {key,value:result.multiple,at:result.at} : {key,error:'ATR 倍数无有效读数'};
      } else {
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
