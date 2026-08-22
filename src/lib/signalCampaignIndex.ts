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
import type { Position, TradeRecord } from '@/types/trading';

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

/**
 * 由成交与持仓建出「标的@日期」集合——回答「信号那天，这个标的动手了没有」。
 *
 * 同一个币种会在很多个日期出现在信号库里。只按标的判定的话，
 * 8 月做过一次 TRB，1 月那条 TRB 信号也会被标成「已交易」，
 * 而那天其实什么都没做——这个标记因此失去意义。
 *
 * 取 openTime（开仓的模拟市场时间）而不是 closeTime：信号问的是「那天有没有进场」，
 * 前一天开的仓在今天平掉，不算今天动过手。这与战役索引只登记 opened_at 是同一条规则。
 *
 * 排除资金费记录：它的 openTime 是扣费那一刻而非开仓时刻，
 * 计入会让「仅仅持仓过夜」的日子被误标成交易日。
 */
export function buildTradedDayIndex(
  tradeHistory: TradeRecord[],
  positionsMap: Record<string, Position[]>,
): Set<string> {
  const index = new Set<string>();
  for (const record of tradeHistory ?? []) {
    if (!record?.symbol) continue;
    // 只有结算记录承载「这一笔交易」；FUNDING 不是一次进场
    if (record.action !== 'CLOSE' && record.action !== 'LIQUIDATION') continue;
    const dateKey = utc8DateKey(record.openTime);
    if (!dateKey) continue;
    index.add(indexKey(record.symbol, dateKey));
  }
  for (const [symbol, positions] of Object.entries(positionsMap ?? {})) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      // 缺开仓时间就无从归日。宁可不标，也不要标到错误的日期上——
      // 这个标记的全部价值就在于它是精确的。
      const dateKey = utc8DateKey(position?.openTime as number);
      if (!dateKey) continue;
      index.add(indexKey(symbol, dateKey));
    }
  }
  return index;
}

/** 该信号所在自然日、该标的是否动过手（开过仓）。 */
export function hasTradeOnSignalDay(
  index: Set<string>,
  signal: { symbol: string; timeMs: number },
): boolean {
  const dateKey = utc8DateKey(signal.timeMs);
  if (!dateKey) return false;
  return index.has(indexKey(signal.symbol, dateKey));
}
