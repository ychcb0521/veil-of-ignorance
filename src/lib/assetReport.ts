import { formatUTC8 } from '@/lib/timeFormat';
import { tradeRecordOperationTime } from '@/lib/objectiveOperationTime';
import type { AssetSnapshot, DailyPnL, DailyPnLDetail, DailyTradePnLRecord } from '@/types/assets';
import type { TradeRecord } from '@/types/trading';

export type AssetReportRange = '7d' | '30d' | '90d' | 'all';

export interface OperationPnlSummary {
  pnl: number;
  trades: number;
}

const RANGE_MS: Record<Exclude<AssetReportRange, 'all'>, number> = {
  '7d': 7 * 86400_000,
  '30d': 30 * 86400_000,
  '90d': 90 * 86400_000,
};

export { tradeRecordOperationTime } from '@/lib/objectiveOperationTime';

export function operationDateKey(timestamp: number): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return formatUTC8(timestamp).slice(0, 10);
}

export function buildOperationDailyPnl(records: TradeRecord[]): DailyPnL[] {
  const dailyMap = new Map<string, { pnl: number; trades: number }>();
  for (const record of records) {
    const operationTime = tradeRecordOperationTime(record);
    if (operationTime == null) continue;
    const date = operationDateKey(operationTime);
    if (!date) continue;
    const prev = dailyMap.get(date) ?? { pnl: 0, trades: 0 };
    dailyMap.set(date, { pnl: prev.pnl + (record.pnl || 0), trades: prev.trades + 1 });
  }
  return Array.from(dailyMap.entries())
    .map(([date, value]) => ({ date, ...value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function pnlForOperationDate(
  dailyPnl: DailyPnL[],
  timestamp = Date.now(),
): number {
  const date = operationDateKey(timestamp);
  if (!date) return 0;
  return dailyPnl.find(item => item.date === date)?.pnl ?? 0;
}

export function buildOperationDailyPnlDetails(records: TradeRecord[]): DailyPnLDetail[] {
  const dailyMap = new Map<string, Map<string, DailyTradePnLRecord[]>>();

  for (const record of records) {
    const operationTime = tradeRecordOperationTime(record);
    if (operationTime == null) continue;
    const date = operationDateKey(operationTime);
    if (!date) continue;
    const symbol = record.symbol || 'UNKNOWN';
    const bySymbol = dailyMap.get(date) ?? new Map<string, DailyTradePnLRecord[]>();
    const rows = bySymbol.get(symbol) ?? [];
    rows.push({
      id: record.id,
      symbol,
      side: record.side,
      action: record.action,
      pnl: record.pnl || 0,
      fee: record.fee || 0,
      operationTime,
    });
    bySymbol.set(symbol, rows);
    dailyMap.set(date, bySymbol);
  }

  return Array.from(dailyMap.entries())
    .map(([date, bySymbol]) => {
      const symbols = Array.from(bySymbol.entries())
        .map(([symbol, rows]) => {
          const sortedRows = [...rows].sort((a, b) => a.operationTime - b.operationTime);
          return {
            symbol,
            pnl: sortedRows.reduce((sum, row) => sum + row.pnl, 0),
            trades: sortedRows.length,
            records: sortedRows,
          };
        })
        .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl) || a.symbol.localeCompare(b.symbol));
      return {
        date,
        pnl: symbols.reduce((sum, item) => sum + item.pnl, 0),
        trades: symbols.reduce((sum, item) => sum + item.trades, 0),
        symbols,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function buildOperationAssetHistory(
  records: TradeRecord[],
  initialCapital: number,
): AssetSnapshot[] {
  const sortedRecords = records
    .map(record => ({ record, operationTime: tradeRecordOperationTime(record) }))
    .filter((item): item is { record: TradeRecord; operationTime: number } => item.operationTime != null)
    .sort((a, b) => a.operationTime - b.operationTime || a.record.id.localeCompare(b.record.id));

  let runningBalance = initialCapital;
  return sortedRecords.map(({ record, operationTime }) => {
    runningBalance += record.pnl || 0;
    return {
      timestamp: operationTime,
      totalBalance: runningBalance,
    };
  });
}

function flattenDailyPnlRecords(details: DailyPnLDetail[]): DailyTradePnLRecord[] {
  return details.flatMap(day => day.symbols.flatMap(symbol => symbol.records));
}

function buildDailyPnlDetailsFromRecords(records: DailyTradePnLRecord[]): DailyPnLDetail[] {
  const dailyMap = new Map<string, Map<string, DailyTradePnLRecord[]>>();
  for (const record of records) {
    const date = operationDateKey(record.operationTime);
    if (!date) continue;
    const bySymbol = dailyMap.get(date) ?? new Map<string, DailyTradePnLRecord[]>();
    const rows = bySymbol.get(record.symbol) ?? [];
    rows.push(record);
    bySymbol.set(record.symbol, rows);
    dailyMap.set(date, bySymbol);
  }

  return Array.from(dailyMap.entries())
    .map(([date, bySymbol]) => {
      const symbols = Array.from(bySymbol.entries())
        .map(([symbol, rows]) => {
          const sortedRows = [...rows].sort((a, b) => a.operationTime - b.operationTime);
          return {
            symbol,
            pnl: sortedRows.reduce((sum, row) => sum + row.pnl, 0),
            trades: sortedRows.length,
            records: sortedRows,
          };
        })
        .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl) || a.symbol.localeCompare(b.symbol));
      return {
        date,
        pnl: symbols.reduce((sum, item) => sum + item.pnl, 0),
        trades: symbols.reduce((sum, item) => sum + item.trades, 0),
        symbols,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function summarizeDailyPnlRecords(records: DailyTradePnLRecord[]): OperationPnlSummary {
  return {
    pnl: records.reduce((sum, record) => sum + record.pnl, 0),
    trades: records.length,
  };
}

export function latestOperationTimeFromDetails(details: DailyPnLDetail[]): number | null {
  let latest: number | null = null;
  for (const record of flattenDailyPnlRecords(details)) {
    if (!Number.isFinite(record.operationTime) || record.operationTime <= 0) continue;
    latest = latest == null ? record.operationTime : Math.max(latest, record.operationTime);
  }
  return latest;
}

export function summarizeOperationPnlDetailsByRange(
  details: DailyPnLDetail[],
  range: AssetReportRange,
  now = latestOperationTimeFromDetails(details) ?? Date.now(),
): OperationPnlSummary {
  const records = flattenDailyPnlRecords(details)
    .filter(record => Number.isFinite(record.operationTime) && record.operationTime > 0);
  if (range === 'all') return summarizeDailyPnlRecords(records);

  const cutoff = now - RANGE_MS[range];
  return summarizeDailyPnlRecords(
    records.filter(record => record.operationTime >= cutoff && record.operationTime <= now),
  );
}

export function summarizeOperationPnlDetailsForDate(
  details: DailyPnLDetail[],
  date: string,
): OperationPnlSummary {
  const day = details.find(item => item.date === date);
  if (!day) return { pnl: 0, trades: 0 };
  return summarizeDailyPnlRecords(flattenDailyPnlRecords([day]));
}

export function filterAssetHistoryByRange(
  history: AssetSnapshot[],
  range: AssetReportRange,
): AssetSnapshot[] {
  const sortedHistory = history
    .filter(item => Number.isFinite(item.timestamp) && item.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (range === 'all' || sortedHistory.length === 0) return sortedHistory;

  const latestTimestamp = sortedHistory[sortedHistory.length - 1].timestamp;
  const cutoff = latestTimestamp - RANGE_MS[range];
  const ranged = sortedHistory.filter(item => item.timestamp >= cutoff && item.timestamp <= latestTimestamp);
  const previous = [...sortedHistory].reverse().find(item => item.timestamp < cutoff);
  if (!previous || ranged[0]?.timestamp === cutoff) return ranged;
  return [
    { timestamp: cutoff, totalBalance: previous.totalBalance },
    ...ranged,
  ];
}

export function filterOperationPnlDetailsByRange(
  details: DailyPnLDetail[],
  range: AssetReportRange,
  now = latestOperationTimeFromDetails(details) ?? Date.now(),
): DailyPnLDetail[] {
  const records = flattenDailyPnlRecords(details)
    .filter(record => Number.isFinite(record.operationTime) && record.operationTime > 0);
  if (range === 'all') return buildDailyPnlDetailsFromRecords(records);

  const cutoff = now - RANGE_MS[range];
  return buildDailyPnlDetailsFromRecords(
    records.filter(record => record.operationTime >= cutoff && record.operationTime <= now),
  );
}

export function dailyPnlFromDetails(details: DailyPnLDetail[]): DailyPnL[] {
  return details.map(({ date, pnl, trades }) => ({ date, pnl, trades }));
}

export function filterDailyPnlByRange(
  dailyPnl: DailyPnL[],
  range: AssetReportRange,
  now = Date.now(),
): DailyPnL[] {
  if (range === 'all') return dailyPnl;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const cutoffDate = operationDateKey(now - days * 86400_000);
  if (!cutoffDate) return [];
  return dailyPnl.filter(item => item.date >= cutoffDate);
}
