import { formatUTC8 } from '@/lib/timeFormat';
import { signalDedupKey } from '@/lib/signalLibrary';
import { shortFishHash } from './algorithm';
import { qualitySignalTime } from './qualityAdmissionTime';
import { readQualityMetricAt } from './qualityEntry';
import type { QualityBuyFilter, QualityFilterReading, QualityRunOptions, QualitySample } from './quality';
import type { FishReconstructionLoader } from './reconstruction';

export type QualitySignalMetric = Pick<QualityBuyFilter, 'id' | 'label' | 'metric' | 'snapshot'>;
export interface QualitySignalReadingBatch {
  metric: QualitySignalMetric;
  rows: readonly QualitySample[];
}
export const signalReadingKey = (row: QualitySample, metric: QualitySignalMetric) =>
  'signal-read-v1:' + shortFishHash(JSON.stringify([signalDedupKey({...row.source,timeMs:qualitySignalTime(row.source)}),metric.id]));

export function signalReadingCell(row: QualitySample, metric: QualitySignalMetric, readings: ReadonlyMap<string, QualityFilterReading>) {
  const reading = readings.get(signalReadingKey(row,metric));
  const value = reading && !reading.error && Number.isFinite(reading.value) ? reading.value! : null;
  const status = value !== null ? '' : reading?.error ? '缺数据' : '待计算';
  const detail = [`信号时间 ${formatUTC8(qualitySignalTime(row.source))}`, reading?.at ? `读数截至 ${formatUTC8(reading.at)}` : '',
    value !== null ? String(value) : reading?.error ?? status].filter(Boolean).join('\n');
  return {value,status,detail};
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
      const result = await readQualityMetricAt(row.source,metric.snapshot,metric.metric,qualitySignalTime(row.source),'signal',load,now,signal,'信号');
      reading = result.initializing ? {key,error:'等待指标初始化'} : {key,value:result.value,at:result.at};
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
