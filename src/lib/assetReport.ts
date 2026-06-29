import { formatUTC8 } from '@/lib/timeFormat';
import type { DailyPnL, DailyPnLDetail, DailyTradePnLRecord } from '@/types/assets';
import type { TradeRecord } from '@/types/trading';

export type AssetReportRange = '7d' | '30d' | '90d' | 'all';

export function tradeRecordOperationTime(record: TradeRecord): number | null {
  const time = record.closedRealAt;
  return Number.isFinite(time) && time != null && time > 0 ? time : null;
}

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
