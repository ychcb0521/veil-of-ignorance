import type {TradeSignal} from '../signalLibrary';
/** New matches carry an explicit admission timestamp; legacy matches used timeMs for that value. */
export function qualityLibraryEntryAt(source:TradeSignal):number|null {
  const match=source.preEntryMonitor;
  const at=match&&'matchedAt' in match?match.matchedAt:source.timeMs;
  return typeof at==='number'&&Number.isFinite(at)&&at>0?at:null;
}
/** The original signal time remains provenance; it never replaces a matched entry time. */
export const qualitySignalTime=(source:TradeSignal)=>source.preEntryMonitor?.sourceTime??source.timeMs;
