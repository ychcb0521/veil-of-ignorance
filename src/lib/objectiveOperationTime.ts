import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

function safeTimeMs(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const time = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(time) && time > 0 ? time : null;
}

/** The objective wallet-clock timestamp captured when a position was closed. */
export function tradeRecordOperationTime(record: TradeRecord | null | undefined): number | null {
  return safeTimeMs(record?.closedRealAt);
}

function recordRecency(record: TradeRecord): number {
  return tradeRecordOperationTime(record) ?? safeTimeMs(record.closeTime) ?? 0;
}

/**
 * Resolve journals linked to either a close-record id or the original position id.
 * Live snapshots historically stored the position id while retroactive journals store
 * the close-record id, so both keys are required for old and new campaigns.
 */
export function buildTradeRecordLookup(records: TradeRecord[]): Map<string, TradeRecord> {
  const lookup = new Map<string, TradeRecord>();
  const latestByPosition = new Map<string, TradeRecord>();

  for (const record of records) {
    lookup.set(record.id, record);
    if (!record.positionId) continue;
    const current = latestByPosition.get(record.positionId);
    if (!current || recordRecency(record) > recordRecency(current)) {
      latestByPosition.set(record.positionId, record);
    }
  }

  for (const [positionId, record] of latestByPosition) {
    if (!lookup.has(positionId)) lookup.set(positionId, record);
  }
  return lookup;
}

export function tradeRecordsForJournals(journals: TradeJournal[], records: TradeRecord[]): TradeRecord[] {
  const refs = new Set(
    journals
      .map(journal => journal.trade_record_id)
      .filter((id): id is string => Boolean(id)),
  );
  return records.filter(record => refs.has(record.id) || Boolean(record.positionId && refs.has(record.positionId)));
}

/** Simulated/time-machine close used by chart and replay paths. */
export function journalSimulatedCloseTime(journal: TradeJournal): number | null {
  return safeTimeMs(
    journal.post_simulated_close_time
      ?? (journal.source === 'retroactive_from_record' ? journal.post_real_close_time : null),
  );
}

/** Real open-side action captured by a live pre-trade snapshot. */
export function journalOpenOperationTime(journal: TradeJournal): number | null {
  return journal.source === 'live' ? safeTimeMs(journal.pre_real_time) : null;
}

/**
 * Close-side operation time in the real, unshifted wallet clock.
 *
 * `post_real_close_time` was historically polluted for retroactive journals with the
 * simulated K-line close. Such a value is accepted only after the separate simulated
 * field exists and proves the two clocks are different. A linked TradeRecord is always
 * authoritative.
 */
export function journalCloseOperationTime(
  journal: TradeJournal,
  record?: TradeRecord | null,
): number | null {
  const recordTime = tradeRecordOperationTime(record);
  if (recordTime != null) return recordTime;

  const journalTime = safeTimeMs(journal.post_real_close_time);
  if (journalTime == null) return null;
  if (journal.source !== 'retroactive_from_record') return journalTime;

  const simulatedClose = journalSimulatedCloseTime(journal);
  if (simulatedClose == null || simulatedClose === journalTime) return null;
  return journalTime;
}

/** Latest objective operation for a leg; active live legs may use their real open action. */
export function journalOperationTime(
  journal: TradeJournal,
  record?: TradeRecord | null,
): number | null {
  const closeTime = journalCloseOperationTime(journal, record);
  if (closeTime != null) return closeTime;
  return journalOpenOperationTime(journal);
}

export function campaignOperationTime(journals: TradeJournal[], records: TradeRecord[]): number | null {
  const recordLookup = buildTradeRecordLookup(records);
  let latest: number | null = null;
  for (const journal of journals) {
    const record = journal.trade_record_id ? recordLookup.get(journal.trade_record_id) ?? null : null;
    const operationTime = journalOperationTime(journal, record);
    if (operationTime == null) continue;
    latest = latest == null ? operationTime : Math.max(latest, operationTime);
  }
  return latest;
}
