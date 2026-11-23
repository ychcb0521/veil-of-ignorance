import type { QualityGroup, QualityResult, QualitySample } from './quality';
import { qualityAdditionFills } from './qualityAddition';
import { qualityAdditionStopOrder } from './qualityAdditionStopOrder';
import { isMirrorClockExit } from './qualityMirrorLossReview';
import type { QualityTrigger } from './qualityIntrabar';

export const PARALLEL_UNIVERSE_VERSION = 'parallel-universe-v1';
export const DEFAULT_SIGNAL_ADDITION_COUNT = 2;
export const validSignalAdditionCount = (value: number) => Number.isSafeInteger(value) && value > 0;

export interface ParallelSignal {
  symbol: string;
  buyPrice: number;
  time: number;
  stopPrice: number;
  source: '平行宇宙';
  additionCount: number;
}

export interface ParallelAttempt {
  version: typeof PARALLEL_UNIVERSE_VERSION;
  id: string;
  candidate: QualitySample;
  plan: QualityGroup;
  observeHours: number;
  additionCount: number;
  baseline: QualityResult;
  simulation: QualityResult;
  marker?: NonNullable<QualityResult['exitSnapshot']>;
  proposedSignal?: ParallelSignal;
}

export const isParallelMarkerCause = (cause?: QualityTrigger['cause']) =>
  cause?.mirrorStage?.stage === 'before' || isMirrorClockExit(cause);

export async function replayParallelCandidate(
  symbol: string,
  additionCount: number,
  replay: (continueAfterMarker: boolean) => Promise<QualityResult>,
) {
  if (!validSignalAdditionCount(additionCount)) throw Error('信号触发加仓次数须为正整数');
  // Use the ordinary replay to identify the winning exit without changing precedence.
  // Only a marked candidate needs a continuation, with the exact same frozen plan.
  const baseline = await replay(false);
  const exit = baseline.exitSnapshot;
  const cause = exit?.cause;
  const marker = (baseline.status === 'closed' || baseline.pendingExit) &&
    isParallelMarkerCause(cause) ? exit : undefined;
  const simulation = marker ? await replay(true) : baseline;
  const fill = qualityAdditionFills(simulation)[additionCount - 1];
  const stop = fill && qualityAdditionStopOrder({ quality_addition_fill: fill });
  const proposedSignal: ParallelSignal | undefined = marker && fill && stop &&
    Number.isFinite(fill.at) && fill.at > 0 && Number.isFinite(fill.price) && fill.price > 0 &&
    (simulation.status === 'open' || simulation.status === 'closed') &&
    (simulation.endTime ?? 0) >= marker.observedAt
    ? { symbol, buyPrice: fill.price, time: fill.at, stopPrice: stop.price, source: '平行宇宙', additionCount }
    : undefined;
  return { baseline, simulation, marker, proposedSignal };
}
