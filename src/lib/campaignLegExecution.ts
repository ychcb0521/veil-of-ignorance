import type { CanonicalTimePrice } from '@/lib/canonicalTimePrice';
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
  const tolerance = Math.max(1e-12, Math.max(Math.abs(low), Math.abs(high), Math.abs(exitPrice), 1) * PRICE_RANGE_TOLERANCE_PCT);
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

export function resolveLegExecution(
  leg: TradeJournal,
  record: TradeRecord | null,
  exitCorrections: LegExitPriceCorrections = {},
): ResolvedLegExecution {
  const exitCorrection = exitCorrections[leg.id] ?? null;
  const openTime = record?.openTime ?? safeTimeMs(leg.pre_simulated_time);
  const closeTime = record?.closeTime ?? safeTimeMs(leg.post_real_close_time);
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
