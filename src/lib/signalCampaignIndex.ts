/**
 * 信号 ↔ 交易战役的「当日」索引。
 *
 * 信号库里每条信号是「标的 + 时刻（UTC+8 墙钟）」。想知道的是：
 * 这个账号在**该标的、该自然日**有没有开过战役。
 *
 * 日期一律按 UTC+8 折算，与 parseSignalTime 解释信号时间的口径一致——
 * 若两边用不同时区，跨零点前后的信号会错配到相邻一天。
 * 战役取 opened_at（战役开始的模拟市场时间），因为信号本身也是市场时刻，
 * 两者同处一条市场时间轴才可比。
 */
import type { TradeCampaign } from '@/types/journal';

const UTC8_OFFSET_MS = 8 * 3600_000;

/** 把 epoch 毫秒折成 UTC+8 的 YYYY-MM-DD。 */
export function utc8DateKey(timeMs: number): string | null {
  if (!Number.isFinite(timeMs)) return null;
  const d = new Date(timeMs + UTC8_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** 归一化标的：大写并去掉分隔符，让 rune/usdt、RUNE/USDT、RUNEUSDT 都能对上。 */
export function normalizeSymbolKey(symbol: string | null | undefined): string {
  return (symbol ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function indexKey(symbol: string, dateKey: string): string {
  return `${normalizeSymbolKey(symbol)}@${dateKey}`;
}

/**
 * 由战役列表建出「标的@日期」集合。一个战役可能跨日（opened_at 与 closed_at
 * 不在同一天），但信号标注问的是「当天有没有开战役」，因此只登记开仓日。
 */
export function buildCampaignDayIndex(campaigns: TradeCampaign[]): Set<string> {
  const index = new Set<string>();
  for (const campaign of campaigns) {
    if (!campaign?.symbol || !campaign.opened_at) continue;
    const openedMs = new Date(campaign.opened_at).getTime();
    const dateKey = utc8DateKey(openedMs);
    if (!dateKey) continue;
    index.add(indexKey(campaign.symbol, dateKey));
  }
  return index;
}

/** 该信号所在自然日、该标的是否有战役。 */
export function hasCampaignOnSignalDay(
  index: Set<string>,
  signal: { symbol: string; timeMs: number },
): boolean {
  const dateKey = utc8DateKey(signal.timeMs);
  if (!dateKey) return false;
  return index.has(indexKey(signal.symbol, dateKey));
}
