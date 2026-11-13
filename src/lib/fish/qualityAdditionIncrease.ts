import { intervalMs, type ResearchInterval } from '../deepRsa/marketData';
import { formatUTC8 } from '../timeFormat';
import type { AdditionIncreaseMetric, AdditionIncreaseObservation } from './qualityAddition';
import { readQualityMetricAt } from './qualityEntry';
import type { FishReconstructionLoader } from './reconstruction';
import type { TradeSignal } from '../signalLibrary';
import { FishError } from './shared';

type Reading = { value: number; at: number };
type Observation = { readings: AdditionIncreaseObservation[]; reason?: string };

export function createAdditionIncreaseReader(options: {row: TradeSignal; end: number; load: FishReconstructionLoader; signal: AbortSignal}) {
  const cache = new WeakMap<AdditionIncreaseMetric, {reference?: {cut: number; reading?: Reading}; current?: {cut: number; reading?: Reading}}>();
  const read = async (metric: AdditionIncreaseMetric, at: number, side: 'reference' | 'current') => {
    const step = intervalMs(metric.snapshot.interval as ResearchInterval);
    const cut = Math.floor(at / step) * step;
    const saved = cache.get(metric) ?? {};
    const cached = saved[side];
    if (cached?.cut === cut) return cached.reading;
    if (side === 'current' && saved.reference?.cut === cut) return saved.reference.reading;
    let reading: Reading | undefined;
    try {
      const result = await readQualityMetricAt(options.row, metric.snapshot, metric.metric, at, 'closed',
        options.load, options.end, options.signal, '加仓比较');
      if (!result.initializing) reading = { value: result.value, at: result.at };
    } catch (error) {
      if (options.signal.aborted || !(error instanceof FishError) || !['history', 'gap', 'readings', 'skipped'].includes(error.kind)) throw error;
    }
    saved[side] = {cut, reading};
    cache.set(metric, saved);
    return reading;
  };

  return async (metrics: readonly AdditionIncreaseMetric[], at: number, previousAt: number): Promise<Observation> => {
    const readings: AdditionIncreaseObservation[] = [];
    for (const metric of metrics) {
      const previous = await read(metric, previousAt, 'reference');
      if (!previous) return { readings, reason: `${metric.label}缺少上次成交时的已收盘读数` };
      const current = await read(metric, at, 'current');
      if (!current) return { readings, reason: `${metric.label}缺少本次候选时的已收盘读数` };
      readings.push({ label: metric.label, metric: metric.metric, at: current.at, value: current.value,
        previousAt: previous.at, previousValue: previous.value });
      if (current.value <= previous.value) {
        return { readings, reason: `${metric.label} ${current.value} ≤ ${previous.value}（基准收盘 ${formatUTC8(previous.at)}）` };
      }
    }
    return { readings };
  };
}
