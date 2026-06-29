import { formatUTC8 } from '@/lib/timeFormat';
import type { DailyPnL } from '@/types/assets';
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
