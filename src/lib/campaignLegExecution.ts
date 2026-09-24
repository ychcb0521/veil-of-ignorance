import {
  fetchCanonicalTimePriceAt,
  type CanonicalTimePrice,
} from '@/lib/canonicalTimePrice';
import {
  buildTradeRecordLookup,
  journalSimulatedCloseTime,
} from '@/lib/objectiveOperationTime';
import { isBankruptcySettlement, isLiquidationRecord } from '@/lib/liquidationRecord';
import { getPositionNotionalUsd } from '@/lib/tradingSettlement';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const PRICE_RANGE_TOLERANCE_PCT = 0.002;

export interface LegExitPriceCorrection {
  exitPrice: number;
  originalExitPrice: number;
  candleLow: number;
  candleHigh: number;
}

export type LegExitPriceCorrections = Record<string, LegExitPriceCorrection>;

/**
 * 两份校正内容是否一样。调用方据此**保留旧对象的引用**：
 * 校正是纯函数产物，重算一遍多半逐字相同，但每次都换一个新对象，
 * 就会顺着 prop 把「Legs 副本」编辑器的重置 effect 一路踢一遍——
 * 用户刚载入或手改到一半的腿会被静默冲掉。内容没变就不该有「变过」的痕迹。
 */
export function sameLegExitPriceCorrections(
  a: LegExitPriceCorrections,
  b: LegExitPriceCorrections,
): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(key => {
    const left = a[key];
    const right = b[key];
    if (!left || !right) return false;
    return left.exitPrice === right.exitPrice
      && left.originalExitPrice === right.originalExitPrice
      && left.candleLow === right.candleLow
      && left.candleHigh === right.candleHigh;
  });
}

/**
 * 平仓价校正的拉取结果，带**完整性**标记。
 *
 * 校正本身是一份纯函数的产物（腿 + 成交记录 + 不可变的历史 1 分钟 K 线），
 * 但拉 K 线这一步会失败（限流、断网）。失败与「这一分钟没有 K 线 / 平仓价本就在区间内」
 * 表面上都是「没有校正」，而只有前者是不可信的：拿它推出的状态与盈亏回写落库，
 * 等于把一次网络抖动写进数据库。complete === false 时任何**写路径**都不得采信。
 */
export interface LegExitPriceCorrectionsResult {
  corrections: LegExitPriceCorrections;
  /**
   * 每条挂着成交 id 的腿都**查到了记录、并成功拿到了 K 线结论**（有或没有校正都算）。
   * 「校验不了」≠「校验过、无需校正」：本地查不到那条成交记录时同样是 false。
   */
  complete: boolean;
  /**
   * 有 K 线请求失败（限流、断网）：这是 complete === false 里**重试能好**的那一种。
   * 另一种是本地查不到挂着的成交记录（换了浏览器、清过历史成交）——重试也不会好，
   * 只读界面只能与详情页一样按腿快照显示。只读的批量导出据此区分「报失败可重试」与「照常导出」。
   */
  fetchFailed?: boolean;
}

export interface ResolvedLegExecution {
  record: TradeRecord | null;
  openTime: number | null;
  closeTime: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  exitCorrection: LegExitPriceCorrection | null;
}

export interface TradeRecordPnlCorrection {
  recordId: string;
  originalNetPnl: number;
  correctedNetPnl: number;
  pnlDelta: number;
  originalExitPrice: number;
  correctedExitPrice: number;
}

export type CanonicalTimePriceFetcher = (
  symbol: string,
  currentTime: number,
) => Promise<CanonicalTimePrice | null>;

const MAX_CANONICAL_PRICE_REQUESTS = 6;
const canonicalPriceCache = new Map<string, Promise<CanonicalTimePrice | null>>();
const canonicalPriceQueue: Array<() => void> = [];
let canonicalPriceRequestsInFlight = 0;

async function withCanonicalPriceRequestSlot<T>(task: () => Promise<T>): Promise<T> {
  if (canonicalPriceRequestsInFlight >= MAX_CANONICAL_PRICE_REQUESTS) {
    await new Promise<void>(resolve => canonicalPriceQueue.push(resolve));
  }
  canonicalPriceRequestsInFlight += 1;
  try {
    return await task();
  } finally {
    canonicalPriceRequestsInFlight -= 1;
    canonicalPriceQueue.shift()?.();
  }
}

/** 一次 K 线拉取的结论：拿到了（含「这一分钟没有 K 线」的 null），还是根本没拿到。 */
interface CanonicalTimePriceOutcome {
  price: CanonicalTimePrice | null;
  failed: boolean;
}

function fetchCachedCanonicalTimePrice(
  symbol: string,
  currentTime: number,
  fetchPriceAt: CanonicalTimePriceFetcher,
): Promise<CanonicalTimePriceOutcome> {
  const settle = (request: Promise<CanonicalTimePrice | null>): Promise<CanonicalTimePriceOutcome> =>
    request.then(price => ({ price, failed: false }), () => ({ price: null, failed: true }));

  if (fetchPriceAt !== fetchCanonicalTimePriceAt) {
    return settle(fetchPriceAt(symbol, currentTime));
  }

  const key = `${symbol.trim().toUpperCase()}:${currentTime}`;
  const cached = canonicalPriceCache.get(key);
  if (cached) return settle(cached);

  const request = withCanonicalPriceRequestSlot(() => fetchPriceAt(symbol, currentTime));
  canonicalPriceCache.set(key, request);
  // 失败不进缓存：以前把 null 缓存住，一次限流会让整个会话都以为「没有校正」，
  // 详情页刷新多少次都拿不到真值。下一次调用重新拉。
  request.catch(() => {
    if (canonicalPriceCache.get(key) === request) canonicalPriceCache.delete(key);
  });
  return settle(request);
}

function safeTimeMs(value: number | string | null | undefined): number | null {
  if (!value) return null;
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function shouldUseCanonicalExitPrice(
  exitPrice: number | null | undefined,
  canonical: CanonicalTimePrice | null,
): canonical is CanonicalTimePrice {
  if (exitPrice == null || !Number.isFinite(exitPrice) || exitPrice <= 0 || !canonical) return false;
  if (!Number.isFinite(canonical.low) || !Number.isFinite(canonical.high) || !Number.isFinite(canonical.close)) return false;
  const low = Math.min(canonical.low, canonical.high);
  const high = Math.max(canonical.low, canonical.high);
  // The tolerance must follow the instrument's own price scale. Using `1` as
  // the floor made the tolerance 0.002 even for a 0.006 coin, silently
  // accepting price errors of tens of percent.
  const priceScale = Math.max(Math.abs(low), Math.abs(high), Math.abs(exitPrice), 1e-12);
  const tolerance = priceScale * PRICE_RANGE_TOLERANCE_PCT;
  return exitPrice < low - tolerance || exitPrice > high + tolerance;
}

export function buildLegExitPriceCorrection(
  exitPrice: number | null | undefined,
  canonical: CanonicalTimePrice | null,
): LegExitPriceCorrection | null {
  if (!shouldUseCanonicalExitPrice(exitPrice, canonical)) return null;
  return {
    exitPrice: canonical.close,
    originalExitPrice: exitPrice,
    candleLow: Math.min(canonical.low, canonical.high),
    candleHigh: Math.max(canonical.low, canonical.high),
  };
}

/**
 * Validate each closed leg against the objective 1-minute candle at its close
 * time. Results are cached by symbol/time so list and detail pages share the
 * same immutable historical check without flooding the market-data endpoint.
 *
 * 带完整性标记的版本：写路径（战役汇总自愈）只能在 complete 时采信，
 * 见 LegExitPriceCorrectionsResult。只读的界面用下面的薄封装即可。
 */
export async function fetchLegExitPriceCorrectionsResult(
  symbol: string,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  fetchPriceAt: CanonicalTimePriceFetcher = fetchCanonicalTimePriceAt,
): Promise<LegExitPriceCorrectionsResult> {
  /**
   * 只有本来就不挂成交 id 的腿（纯复盘快照）可以在没有记录时算作完整。
   * 挂着成交 id 而本地查不到那条记录（换了浏览器、云端水化没跑完、清过历史成交），
   * 它的平仓价就没法对着 K 线核验——这时的「没有校正」是不可信的，与拉 K 线失败同等对待。
   * 以前这里把 tradeRecords 为空直接当作 complete：自愈会拿腿快照算出的**未校正**合计
   * 写回库，与上一次拿齐记录时写的校正值来回翻转（closed_loss 配 +469.96 的那种行）。
   */
  const linkedLegs = legs.filter(leg => leg.trade_record_id);
  if (linkedLegs.length === 0) return { corrections: {}, complete: true, fetchFailed: false };
  if (!symbol || tradeRecords.length === 0) return { corrections: {}, complete: false, fetchFailed: false };

  const recordLookup = buildTradeRecordLookup(tradeRecords);
  const legsByRecordId = new Map<string, TradeJournal[]>();
  let unresolved = false;
  for (const leg of linkedLegs) {
    const record = recordLookup.get(leg.trade_record_id as string);
    if (!record) {
      unresolved = true;   // 查不到 = 校验不了，不是无需校正
      continue;
    }
    if (!Number.isFinite(record.closeTime) || record.closeTime <= 0) continue;
    /**
     * 破产价结算的逐仓强平不校正：它的平仓价是触发那根 K 线里的强平价，平仓时刻是那根的收线，
     * 1 分钟校验看的是收线之后那一分钟（大周期下离影线可达一小时），会把正确的强平判成异常；
     * 更糟的是按平仓价重算毛盈亏会拆掉「亏损＝保证金」的封顶。老的强平记录照常校正。
     */
    if (isBankruptcySettlement(record)) continue;
    const linkedLegs = legsByRecordId.get(record.id) ?? [];
    linkedLegs.push(leg);
    legsByRecordId.set(record.id, linkedLegs);
  }

  const entries = await Promise.all(
    Array.from(legsByRecordId.entries()).map(async ([recordId, linkedLegs]) => {
      const record = recordLookup.get(recordId);
      if (!record) return { failed: false, pairs: [] as Array<readonly [string, LegExitPriceCorrection]> };
      const outcome = await fetchCachedCanonicalTimePrice(
        symbol,
        record.closeTime,
        fetchPriceAt,
      );
      const correction = buildLegExitPriceCorrection(record.exitPrice, outcome.price);
      return {
        failed: outcome.failed,
        pairs: correction
          ? linkedLegs.map(leg => [leg.id, correction] as const)
          : [],
      };
    }),
  );

  const fetchFailed = entries.some(entry => entry.failed);
  return {
    corrections: Object.fromEntries(entries.flatMap(entry => entry.pairs)),
    complete: !unresolved && !fetchFailed,
    fetchFailed,
  };
}

/** 只读界面用的薄封装：拉不到的腿当作没有校正（与此前行为一致）。 */
export async function fetchLegExitPriceCorrections(
  symbol: string,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  fetchPriceAt: CanonicalTimePriceFetcher = fetchCanonicalTimePriceAt,
): Promise<LegExitPriceCorrections> {
  return (await fetchLegExitPriceCorrectionsResult(symbol, legs, tradeRecords, fetchPriceAt)).corrections;
}

export function resolveLegExecution(
  leg: TradeJournal,
  record: TradeRecord | null,
  exitCorrections: LegExitPriceCorrections = {},
): ResolvedLegExecution {
  const exitCorrection = exitCorrections[leg.id] ?? null;
  const openTime = record?.openTime ?? safeTimeMs(leg.pre_simulated_time);
  const closeTime = record?.closeTime ?? journalSimulatedCloseTime(leg);
  const entryPrice = record?.entryPrice ?? leg.pre_entry_price ?? null;
  const rawExitPrice = record?.exitPrice ?? leg.post_exit_price_snapshot ?? null;
  /**
   * 强平记录不做平仓价替换：它的盈亏按交易所的强平结算（buildTradeRecordPnlCorrection 不重算），
   * 显示价若换成 K 线价，这一行的「开仓价 / 平仓价 / 涨跌幅」与「盈亏」就来自两对价——
   * 全仓 BTC 多单会显示「平仓价 97200 / 涨跌幅 −2.80% / 盈亏 −4253（占名义 −8.51%）」；
   * 副本里的 cut.exit_price 也会落在一个交易所从未成交过的价上，改「仓位」一格就按它定价。
   * exitCorrection 照常返回：那一格仍标「强平异常」，K 线区间写在悬停说明里（警示，不改数）。
   */
  const exitPrice = isLiquidationRecord(record) ? rawExitPrice : (exitCorrection?.exitPrice ?? rawExitPrice);

  return {
    record,
    openTime,
    closeTime,
    entryPrice,
    exitPrice,
    exitCorrection,
  };
}

export function tradeRecordNotionalAt(record: TradeRecord, price = record.entryPrice): number {
  return getPositionNotionalUsd(record.symbol, record, price || record.entryPrice);
}

function tradeRecordGrossPnlAtExit(record: TradeRecord, exitPrice: number): number {
  if (
    !Number.isFinite(record.entryPrice)
    || record.entryPrice <= 0
    || !Number.isFinite(exitPrice)
    || exitPrice <= 0
  ) {
    return 0;
  }

  if (record.settlementMode === 'coin') {
    const contracts = Math.max(0, Number(record.contracts ?? record.quantity ?? 0));
    const contractSizeUsd = Math.max(0, Number(record.contractSizeUsd ?? 10));
    const notionalUsd = contracts * contractSizeUsd;
    if (!(notionalUsd > 0)) return 0;
    return record.side === 'LONG'
      ? notionalUsd * (exitPrice / record.entryPrice - 1)
      : notionalUsd * (1 - exitPrice / record.entryPrice);
  }

  const quantity = Math.max(0, Number(record.quantity ?? 0));
  if (!(quantity > 0)) return 0;
  return record.side === 'LONG'
    ? (exitPrice - record.entryPrice) * quantity
    : (record.entryPrice - exitPrice) * quantity;
}

/**
 * Keep the official net-P&L adjustments (fees/slippage) and replace only the
 * gross-P&L portion caused by an impossible historical exit price.
 */
export function buildTradeRecordPnlCorrection(
  record: TradeRecord,
  exitCorrection: LegExitPriceCorrection,
): TradeRecordPnlCorrection | null {
  if (!Number.isFinite(record.pnl)) return null;
  /**
   * 强平一律不按平仓价重算——交易所在强平价上把仓位收走，那一笔钱已经落定：
   *   · 逐仓（破产价结算）：净盈亏恒为 −隔离保证金，按价差重算只会拆掉封顶；
   *   · 全仓：净盈亏 = 标记盈亏 − 平仓费 − 强平费，它**没有** bankruptcy 标记，
   *     以前就从这个洞里漏下去：BTC 全仓多单实际亏 4253，按收线后那一分钟的 K 线被改成 −1653，
   *     还一路流进合计、Δb、b、R、战役状态与自愈回写的 final_realized_pnl。
   * 价确实不在那一刻的 K 线里时，仍按「强平异常」报出来（警示，不改数）。
   */
  if (isLiquidationRecord(record)) return null;
  const originalGrossPnl = tradeRecordGrossPnlAtExit(record, exitCorrection.originalExitPrice);
  const correctedGrossPnl = tradeRecordGrossPnlAtExit(record, exitCorrection.exitPrice);
  const pnlDelta = correctedGrossPnl - originalGrossPnl;
  if (!Number.isFinite(pnlDelta)) return null;

  return {
    recordId: record.id,
    originalNetPnl: Number(record.pnl),
    correctedNetPnl: Number(record.pnl) + pnlDelta,
    pnlDelta,
    originalExitPrice: exitCorrection.originalExitPrice,
    correctedExitPrice: exitCorrection.exitPrice,
  };
}
