/**
 * Format a timestamp (ms) as UTC+8 (Asia/Shanghai).
 * Output: "YYYY-MM-DD HH:mm:ss"
 */
export function formatUTC8(ts: number): string {
  if (!ts) return '--';
  // Offset UTC by +8 hours
  const d = new Date(ts + 8 * 3600_000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Format an ISO timestamp string as Beijing time (UTC+8).
 * Output: "YYYY-MM-DD HH:mm:ss"
 */
export function formatBeijingTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '—';
  return formatUTC8(t);
}

/**
 * Compact Beijing time for list cards (no year).
 * Output: "MM-DD HH:mm"
 */
export function formatBeijingTimeShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '—';
  return formatUTC8(t).slice(5, 16); // "MM-DD HH:mm"
}
