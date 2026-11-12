import type {TradeSignal} from '../signalLibrary';
import type { FishQualityStudy, QualitySample } from './quality';

/** Holding-only input: the original sample still anchors mining and pre-entry scans. */
export interface QualityMonitorEntry {
  at: number | null;
  records: string[];
  error?: string;
}
export type QualityMonitorTimeBasis = 'signal' | 'screening';
export const qualityMonitorTimeLabels: Record<QualityMonitorTimeBasis, string> = {
  signal: '信号时间',
  screening: '筛选时间',
};

export function qualityRowMonitorTimeBasis(study: Pick<FishQualityStudy, 'monitorTimeBasis' | 'monitorTimeBasisByRow'>, sample: QualitySample): QualityMonitorTimeBasis | undefined {
  const rowModes = study.monitorTimeBasisByRow;
  return rowModes ? rowModes[sample.signalId ?? sample.id] : study.monitorTimeBasis;
}

const validEntryTime = (at: unknown): number | null =>
  typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null;

export function qualityMonitorEntryAt(sample: QualitySample, timeBasis?: QualityMonitorTimeBasis): number | null {
  if (timeBasis === 'signal') return validEntryTime(qualitySignalTime(sample.source));
  if (timeBasis === 'screening') {
    if (sample.source.preEntryMonitor) return qualityLibraryEntryAt(sample.source);
    return sample.monitorEntry?.error ? null : validEntryTime(sample.monitorEntry?.at);
  }
  return sample.monitorEntry ? sample.monitorEntry.at : sample.enteredAt;
}
export function qualityMonitoringSample(sample: QualitySample, timeBasis?: QualityMonitorTimeBasis): QualitySample {
  if (!timeBasis && !sample.monitorEntry) return sample;
  const enteredAt = qualityMonitorEntryAt(sample, timeBasis);
  return {
    ...sample,
    enteredAt,
    basis: enteredAt == null ? 'missing' : 'signal',
    ...(timeBasis ? { monitorEntry: undefined } : {}),
  };
}
/** New matches carry an explicit admission timestamp; legacy matches used timeMs for that value. */
export function qualityLibraryEntryAt(source:TradeSignal):number|null {
  const match=source.preEntryMonitor;
  const at=match&&'matchedAt' in match?match.matchedAt:source.timeMs;
  return validEntryTime(at);
}
/** The original signal time remains provenance; it never replaces a matched entry time. */
export const qualitySignalTime=(source:TradeSignal)=>source.preEntryMonitor?.sourceTime??source.timeMs;
