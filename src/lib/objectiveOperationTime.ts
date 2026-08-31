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
  const latestByFill = new Map<string, TradeRecord>();
  const latestByPosition = new Map<string, TradeRecord>();

  const newer = (candidate: TradeRecord, current: TradeRecord | undefined) =>
    !current || recordRecency(candidate) > recordRecency(current);

  for (const record of records) {
    lookup.set(record.id, record);
    if (record.fillId && newer(record, latestByFill.get(record.fillId))) {
      latestByFill.set(record.fillId, record);
    }
    if (!record.positionId) continue;
    /**
     * 仓位 id 必须解析到**主力那一片**,不是「最近的那一片」。
     *
     * 同向成交在持仓期合并成一个仓位(爆仓要按整仓算),平仓时按每笔成交各写一条记录,
     * 它们的 positionId 全都是存活仓位的 id、closeTime 又完全相等——
     * 于是 `recordRecency(record) > recordRecency(current)` 永远不成立,
     * 留下的是**数组里先出现的那条**。主力腿读到谁的开仓价取决于记录顺序,
     * 而预期最大亏损 L = 跌幅 × 敞口 的两个因子都从这条记录取:
     * 读到加仓那片就等于拿加仓的开仓价和数量去给主力的风险定价。
     *
     * 不变量 fills[0].id === position.id 给了确定的判据:
     * fillId 等于仓位 id 的那一片就是**合并之前的主力单**。
     */
    const current = latestByPosition.get(record.positionId);
    const isMainFill = record.fillId === record.positionId;
    const currentIsMainFill = current != null && current.fillId === current.positionId;
    if (current == null
      || (isMainFill && !currentIsMainFill)
      || (isMainFill === currentIsMainFill && newer(record, current))) {
      latestByPosition.set(record.positionId, record);
    }
  }

  // 成交 id 优先于仓位 id:加仓腿存的是这笔成交自己的 id,
  // 顺序与 claimRecordsByLeg / lookupJournalForRecord 的三级完全一致。
  for (const [fillId, record] of latestByFill) {
    if (!lookup.has(fillId)) lookup.set(fillId, record);
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
