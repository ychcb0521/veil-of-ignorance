import {
  fetchCanonicalTimePriceAt,
  type CanonicalTimePrice,
} from '@/lib/canonicalTimePrice';
import {
  buildTradeRecordLookup,
  journalSimulatedCloseTime,
} from '@/lib/objectiveOperationTime';
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

function fetchCachedCanonicalTimePrice(
  symbol: string,
  currentTime: number,
  fetchPriceAt: CanonicalTimePriceFetcher,
): Promise<CanonicalTimePrice | null> {
  if (fetchPriceAt !== fetchCanonicalTimePriceAt) {
    return fetchPriceAt(symbol, currentTime).catch(() => null);
  }

  const key = `${symbol.trim().toUpperCase()}:${currentTime}`;
  const cached = canonicalPriceCache.get(key);
  if (cached) return cached;

  const request = withCanonicalPriceRequestSlot(
    () => fetchPriceAt(symbol, currentTime).catch(() => null),
  );
  canonicalPriceCache.set(key, request);
  return request;
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
 */
export async function fetchLegExitPriceCorrections(
  symbol: string,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  fetchPriceAt: CanonicalTimePriceFetcher = fetchCanonicalTimePriceAt,
): Promise<LegExitPriceCorrections> {
  if (!symbol || legs.length === 0 || tradeRecords.length === 0) return {};

  const recordLookup = buildTradeRecordLookup(tradeRecords);
  const legsByRecordId = new Map<string, TradeJournal[]>();
  for (const leg of legs) {
    if (!leg.trade_record_id) continue;
    const record = recordLookup.get(leg.trade_record_id);
    if (!record || !Number.isFinite(record.closeTime) || record.closeTime <= 0) continue;
    const linkedLegs = legsByRecordId.get(record.id) ?? [];
    linkedLegs.push(leg);
    legsByRecordId.set(record.id, linkedLegs);
  }

  const entries = await Promise.all(
    Array.from(legsByRecordId.entries()).map(async ([recordId, linkedLegs]) => {
      const record = recordLookup.get(recordId);
      if (!record) return [];
      const canonical = await fetchCachedCanonicalTimePrice(
        symbol,
        record.closeTime,
        fetchPriceAt,
      );
      const correction = buildLegExitPriceCorrection(record.exitPrice, canonical);
      return correction
        ? linkedLegs.map(leg => [leg.id, correction] as const)
        : [];
    }),
  );

  return Object.fromEntries(entries.flat());
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
  const exitPrice = exitCorrection?.exitPrice ?? rawExitPrice;

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
