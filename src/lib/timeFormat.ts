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
