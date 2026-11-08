/** Independent first-match scan. Values use the existing closed-candle buy-filter calculation. */
import type { TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import { shortFishHash } from './algorithm';
import { type QualityBuyFilter, type QualityFilterReading, type QualitySample, type QualityProgress, type QualityGroup } from './quality';
import type { FishReconstructionLoader } from './reconstruction';
import { PRE_ENTRY_CONDITIONS_VERSION } from './preEntryConditions';
import { PRE_ENTRY_THREE_STAGE_VERSION, PRE_ENTRY_THREE_STAGE_V5 } from './preEntryThreeStage';

export type PreEntryStatus = 'queued' | 'scanning' | 'paused' | 'matched' | 'unmatched' | 'warming' | 'error';
export interface PreEntryRecord {
  threeStage?: import('./preEntryThreeStageScan').EntryStageEvidence;
  missedGuard?: { count:number; event:import('./preEntryGuardEvent').EntryGuardEvent; reason:string };
  lastVeto?: { at: number; reason: string; count: number };
  zeroTradeWait?: { count: number; firstAt: number; lastAt: number };
  planId?: string;
  id: string; roundId: string; sample: QualitySample; status: PreEntryStatus;
  startTime: number; cursor: number; endTime?: number; matchedAt?: number;
  readings: QualityFilterReading[]; detail?: string; updatedAt: number;
}
/** A failed record has been attempted; only unprocessed work keeps a round paused. */
export const preEntryRecordPending = (record: Pick<PreEntryRecord, 'status'>) =>
  record.status === 'queued' || record.status === 'scanning' || record.status === 'paused';
/** 历史引擎编号：实现已下线，仅用于识别和显示旧轮次。 */
export const PRE_ENTRY_INTRABAR_VERSION = 'pre-entry-intrabar-v2' as const;
export const PRE_ENTRY_ZERO_TRADE_VERSION = 'pre-entry-zero-trade-v3' as const;
export interface PreEntrySettings { updatedAt: number; plans: QualityGroup[]; hours: number }
export interface PreEntryRound {
  /** 旧引擎编号仍可能出现（历史轮次），但只有三阶的 v5 / v6 还能运行。 */
  engine?: typeof PRE_ENTRY_INTRABAR_VERSION | typeof PRE_ENTRY_ZERO_TRADE_VERSION | typeof PRE_ENTRY_CONDITIONS_VERSION | typeof PRE_ENTRY_THREE_STAGE_V5 | typeof PRE_ENTRY_THREE_STAGE_VERSION; plans?: QualityGroup[];
  id: string; startedAt: number; updatedAt: number; filters: QualityBuyFilter[];
  hours: number; state: 'running' | 'paused' | 'complete';
}
export interface PreEntryLibrary { settings?: PreEntrySettings; settingsHistory?: (PreEntrySettings & {id:string})[]; version: 1; rounds: PreEntryRound[]; records: PreEntryRecord[] }
/** Explicit version switching retains both frozen setting sets for later reuse. */
export function archivePreEntrySettings(library:PreEntryLibrary,next:PreEntrySettings):PreEntryLibrary {
  const previous=library.settings;
  if(!previous)return {...library,settings:next};
  const id='entry-settings-'+shortFishHash(JSON.stringify([previous.plans,previous.hours]));
  return {...library,settings:next,settingsHistory:[...(library.settingsHistory??[]).filter(s=>s.id!==id),{...structuredClone(previous),id}]};
}
export const emptyPreEntryLibrary = (): PreEntryLibrary => ({ version: 1, rounds: [], records: [] });
export function mergePreEntryLibraries(a: PreEntryLibrary, b: PreEntryLibrary): PreEntryLibrary {
  const merge = <T extends { id: string; updatedAt: number }>(left: T[], right: T[]) => {
    const all = new Map(left.map(item => [item.id, item]));
    for (const item of right) if (!all.has(item.id) || item.updatedAt >= all.get(item.id)!.updatedAt) all.set(item.id, item);
    return [...all.values()];
  };
  const settings = !a.settings || (b.settings?.updatedAt ?? 0) >= a.settings.updatedAt ? b.settings : a.settings;
  const history=merge(a.settingsHistory??[],b.settingsHistory??[]);
  return { version: 1, rounds: merge(a.rounds, b.rounds), records: merge(a.records, b.records), ...(settings ? {settings} : {}), ...(history.length?{settingsHistory:history}:{}) };
}
export function preEntrySignal(record: PreEntryRecord): TradeSignal | null {
  if (record.status !== 'matched' || !record.matchedAt) return null;
  const source = record.sample.source;
  return { id: `pre-entry:${record.id}`, symbol: source.symbol, exchange: source.exchange, market: source.market,
    underlying: source.underlying, binanceSymbol: source.binanceSymbol,
    timeMs: record.matchedAt, timeLabel: formatUTC8(record.matchedAt), fallbackZone: source.fallbackZone,
    preEntryMonitor: { recordId: record.id, roundId: record.roundId, sourceId: source.id, sourceTime: source.timeMs } };
}
export interface PreEntryRun {
  round: PreEntryRound; records: readonly PreEntryRecord[];
  onRecord: (record: PreEntryRecord) => void;
}
export async function collectPreEntryMonitor(
  task: PreEntryRun, load: FishReconstructionLoader, now: number, signal: AbortSignal,
  onProgress: (progress: QualityProgress) => void,
  bounds?: { start?: (symbol: string) => Promise<number | undefined>; end?: (symbol: string) => Promise<number> },
): Promise<void> {
  if (task.round.engine === PRE_ENTRY_THREE_STAGE_VERSION || task.round.engine === PRE_ENTRY_THREE_STAGE_V5) {
    const { collectPreEntryThreeStage } = await import('./preEntryThreeStageScan');
    return collectPreEntryThreeStage(task, load, now, signal, onProgress, bounds);
  }
  // 旧版筛选引擎已下线：旧轮次的结果保留只读，不再重跑，也不静默失败。
  throw new Error('旧版筛选引擎已下线，本轮结果保留只读；请用三阶方案重新筛选');
}
