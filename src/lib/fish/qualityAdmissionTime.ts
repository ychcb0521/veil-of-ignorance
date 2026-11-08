import type {TradeSignal} from '../signalLibrary';
import type {QualitySample} from './quality';

/** Holding-only input: the original sample still anchors mining and pre-entry scans. */
export interface QualityMonitorEntry {
  at: number | null;
  records: string[];
  error?: string;
}
export const qualityMonitorEntryAt = (sample: QualitySample): number | null =>
  sample.monitorEntry ? sample.monitorEntry.at : sample.enteredAt;
export function qualityMonitoringSample(sample: QualitySample): QualitySample {
  const enteredAt = qualityMonitorEntryAt(sample);
  return sample.monitorEntry ? {...sample, enteredAt, basis: enteredAt == null ? 'missing' : 'signal'} : sample;
}
/** New matches carry an explicit admission timestamp; legacy matches used timeMs for that value. */
export function qualityLibraryEntryAt(source:TradeSignal):number|null {
  const match=source.preEntryMonitor;
  const at=match&&'matchedAt' in match?match.matchedAt:source.timeMs;
  return typeof at==='number'&&Number.isFinite(at)&&at>0?at:null;
}
/** The original signal time remains provenance; it never replaces a matched entry time. */
export const qualitySignalTime=(source:TradeSignal)=>source.preEntryMonitor?.sourceTime??source.timeMs;
