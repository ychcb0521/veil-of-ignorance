import { useEffect, useMemo, useRef } from 'react';
import {
  buildCampaignMetricSeries,
  type CampaignMetricSeries,
  type CampaignMetricSeriesInput,
} from '@/lib/campaignMetricSeries';

export const UNREALIZED_CHART_SNAPSHOT_CACHE_PREFIX = 'campaign-unrealized-chart-v1:';
const MAX_MEMORY_PARTITIONS = 8;
const MAX_SAMPLES_PER_PARTITION = 2_000;
const MAX_STORED_CHARACTERS = 2_000_000;

type CompleteSample = CampaignMetricSeriesInput & { value: number; operationTime: number };
type CachedSamples = ReadonlyMap<string, CompleteSample>;
const memory = new Map<string, CachedSamples>();

export type UnrealizedChartSnapshotOptions = {
  owner: string;
  scope: 'active' | 'deleted';
  /** The current date-filtered membership, including missing/terminally unavailable rows. */
  samples: readonly CampaignMetricSeriesInput[];
  /** Only unresolved current calculations. Terminally unavailable rows must not remain here. */
  pendingIds: ReadonlySet<string>;
  ready: boolean;
  /**
   * The calculation queue cannot make progress for now (everything left is waiting for a retry or a rate-limit
   * cooldown). The whole-graph freeze is then released: rows that are already recalculated show their current
   * reading, and only the rows still waiting keep their previous point.
   */
  stalled?: boolean;
};

function isCompleteSample(value: unknown): value is CompleteSample {
  if (!value || typeof value !== 'object') return false;
  const sample = value as Partial<CompleteSample>;
  return typeof sample.campaignId === 'string' && sample.campaignId.length > 0
    && typeof sample.title === 'string' && typeof sample.symbol === 'string'
    && typeof sample.value === 'number' && Number.isFinite(sample.value)
    && typeof sample.operationTime === 'number' && Number.isFinite(sample.operationTime)
    && (sample.pnl == null || (typeof sample.pnl === 'number' && Number.isFinite(sample.pnl)))
    && (sample.payoffRatio == null || (typeof sample.payoffRatio === 'number' && Number.isFinite(sample.payoffRatio)))
    && (sample.stackBelow == null || typeof sample.stackBelow === 'boolean');
}

/** Copy only graph fields; persisted input must never inject additional properties. */
function copySample(sample: CompleteSample): CompleteSample {
  return {
    campaignId: sample.campaignId, title: sample.title, symbol: sample.symbol,
    value: sample.value, operationTime: sample.operationTime,
    ...(sample.pnl === undefined ? {} : { pnl: sample.pnl }),
    ...(sample.payoffRatio === undefined ? {} : { payoffRatio: sample.payoffRatio }),
    ...(sample.stackBelow === undefined ? {} : { stackBelow: sample.stackBelow }),
  };
}

function sameSample(left: CampaignMetricSeriesInput, right: CampaignMetricSeriesInput) {
  return left.campaignId === right.campaignId && left.title === right.title && left.symbol === right.symbol
    && Object.is(left.value, right.value) && Object.is(left.operationTime, right.operationTime)
    && Object.is(left.pnl, right.pnl) && Object.is(left.payoffRatio, right.payoffRatio)
    && left.stackBelow === right.stackBelow;
}

function remember(key: string, samples: CachedSamples) {
  memory.delete(key);
  memory.set(key, samples);
  while (memory.size > MAX_MEMORY_PARTITIONS) memory.delete(memory.keys().next().value!);
}

function readSamples(key: string): CachedSamples {
  const remembered = memory.get(key);
  if (remembered) {
    remember(key, remembered);
    return remembered;
  }
  const samples = new Map<string, CompleteSample>();
  try {
    const raw = localStorage.getItem(`${UNREALIZED_CHART_SNAPSHOT_CACHE_PREFIX}${key}`);
    if (raw && raw.length <= MAX_STORED_CHARACTERS) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && 'samples' in parsed && Array.isArray(parsed.samples)) {
        for (const sample of parsed.samples.slice(-MAX_SAMPLES_PER_PARTITION)) {
          if (isCompleteSample(sample)) samples.set(sample.campaignId, copySample(sample));
        }
      }
    }
  } catch { /* A disabled/full/corrupt browser cache cannot prevent the current graph from rendering. */ }
  remember(key, samples);
  return samples;
}

function sameSeries(left: CampaignMetricSeries, right: CampaignMetricSeries) {
  return left.excludedMissingValueCount === right.excludedMissingValueCount
    && left.excludedMissingOperationTimeCount === right.excludedMissingOperationTimeCount
    && left.points.length === right.points.length
    && left.points.every((point, index) => sameSample(point, right.points[index]));
}

/** Tests start from a cold module. Nothing else needs it: snapshots are scoped by owner and recycle-bin view. */
export function clearUnrealizedChartSnapshotMemoryForTests() {
  memory.clear();
}

/**
 * Display-only stale-while-refreshing cache. Never pass these points back to row metrics, sorting,
 * calculation progress ("已计算 x / y 场") or exports: a cached point is one whole previous reading.
 * Counts of drawn points (the chart's n, "查看散点图 N", "全选当前图 N") deliberately follow the drawn series.
 *
 * `cachedCount` is the number of drawn points that are previous readings standing in for a value that is
 * still being recalculated or is frozen with the rest of the graph; a point whose previous reading equals its
 * current one is not counted.
 */
export function useUnrealizedChartSnapshot({ owner, scope, samples, pendingIds, ready, stalled = false }: UnrealizedChartSnapshotOptions) {
  const key = JSON.stringify([owner, scope]);
  const initial = useMemo(() => owner ? readSamples(key) : new Map<string, CompleteSample>(), [key, owner]);
  const cached = useRef({ key, samples: initial });
  if (cached.current.key !== key) cached.current = { key, samples: initial };
  const previousSeries = useRef<{ key: string; series: CampaignMetricSeries } | null>(null);

  const result = useMemo(() => {
    const hasPending = ready && Boolean(owner) && samples.some(sample => pendingIds.has(sample.campaignId));
    const freezeKnown = hasPending && !stalled;
    let cachedCount = 0;
    const displaySamples = samples.map(sample => {
      if (!hasPending) return sample;
      const pending = pendingIds.has(sample.campaignId);
      // A terminal invalid result must disappear immediately, even during another row's refresh; and once the
      // queue is stalled, rows that are already recalculated stop waiting for the stuck ones.
      if (!pending && (!freezeKnown || !isCompleteSample(sample))) return sample;
      const before = cached.current.samples.get(sample.campaignId);
      // Membership comes only from current rows; a moved operation cannot reappear in its old range.
      if (!before || before.operationTime !== sample.operationTime) return sample;
      if (pending || !sameSample(before, sample)) cachedCount += 1;
      return before;
    });
    const next = buildCampaignMetricSeries(displaySamples);
    const previous = previousSeries.current;
    const series = previous?.key === key && sameSeries(previous.series, next) ? previous.series : next;
    previousSeries.current = { key, series };
    return { series, cachedCount };
  }, [key, owner, samples, pendingIds, ready, stalled]);

  useEffect(() => {
    if (!ready || !owner) return;
    const freezeKnown = !stalled && samples.some(sample => pendingIds.has(sample.campaignId));
    const next = new Map(cached.current.samples);
    let changed = false;
    for (const sample of samples) {
      // Missing or failed refreshes never overwrite the last successful complete point.
      if (pendingIds.has(sample.campaignId) || !isCompleteSample(sample)) continue;
      const before = next.get(sample.campaignId);
      // Freeze the whole known graph while it refreshes. New/moved rows can still join as ready.
      if (freezeKnown && before?.operationTime === sample.operationTime) continue;
      if (before && sameSample(before, sample)) continue;
      next.delete(sample.campaignId);
      next.set(sample.campaignId, copySample(sample));
      changed = true;
    }
    if (!changed) return;
    while (next.size > MAX_SAMPLES_PER_PARTITION) next.delete(next.keys().next().value!);
    cached.current = { key, samples: next };
    remember(key, next);
    try {
      localStorage.setItem(`${UNREALIZED_CHART_SNAPSHOT_CACHE_PREFIX}${key}`, JSON.stringify({ samples: [...next.values()] }));
    } catch { /* The memory snapshot remains available when persistence is blocked or full. */ }
  }, [key, owner, samples, pendingIds, ready, stalled]);

  return result;
}
