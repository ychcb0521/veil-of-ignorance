import { FISH_ACCOUNT_SETTINGS_KEY, readFishAccountSettings } from './accountSettings';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { FishDataAdapter } from './adapters';
import type { FishExchange, FishMarket } from './exchanges';
import { FISH_STEP, FishError, validateFishBars } from './shared';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { formatUTC8 } from '@/lib/timeFormat';

export interface FishDownwardWick { enabled: boolean; hours: number; atrMultiple: number }
const LEGACY_WICK_HOURS = [6, 12, 24, 48, 72];
const LEGACY_WICK_MULTIPLES = [1, 1.5, 2, 3];
export const FISH_WICK_SETTINGS_KEY = 'fish-wick-settings.v1';
export const MAX_FISH_WICK_HOURS = 72;
export const DEFAULT_FISH_DOWNWARD_WICK: Readonly<FishDownwardWick> = { enabled: true, hours: 48, atrMultiple: 3 };
/** Count only full 5m candles. Tolerance removes binary rounding at exact boundaries. */
export const fishWickWindowBars = (hours: number) => Math.floor(hours * 12 + 1e-9);
export function fishWickDuration(hours: number) {
  const minutes = hours * 60;
  return !Number.isInteger(hours) && Math.abs(minutes - Math.round(minutes)) < 1e-9 ? `${Math.round(minutes)} 分钟` : `${hours} 小时`;
}
export function validateFishDownwardWick(rule: FishDownwardWick): FishDownwardWick {
  if (typeof rule.enabled !== 'boolean') throw new FishError('插针过滤开关无效', 'readings');
  if (!Number.isFinite(rule.hours) || fishWickWindowBars(rule.hours) < 1 || rule.hours > MAX_FISH_WICK_HOURS) {
    throw new FishError('回看时长须在 5 分钟到 72 小时之间', 'readings');
  }
  if (!Number.isFinite(rule.atrMultiple) || rule.atrMultiple <= 0) throw new FishError('插针幅度须为大于 0 的 ATR 倍数', 'readings');
  return rule;
}

/** Legacy aggregate and local keys keep their original schema for old clients. */
export function readLegacyFishDownwardWick(prefix = getUserPrefix()): FishDownwardWick {
  const saved = readFishAccountSettings(prefix + FISH_ACCOUNT_SETTINGS_KEY);
  if (saved) return {...saved.downwardWick};
  const key = prefix + 'fish-downward-wick.v2';
  try {
    const current = readPersistedStateRaw(key);
    const x = JSON.parse(current ?? readPersistedStateRaw(prefix + 'fish-downward-wick.v1') ?? 'null');
    if (x && typeof x.enabled === 'boolean' && LEGACY_WICK_HOURS.includes(x.hours) && LEGACY_WICK_MULTIPLES.includes(x.atrMultiple)) {
      // Upgrade the former 24h / 3 ATR default once; retain deliberately customized settings.
      const value = { enabled: x.enabled, hours: current === null && x.enabled && x.hours === 24 && x.atrMultiple === 3 ? 48 : x.hours, atrMultiple: x.atrMultiple };
      if (current === null) writePersistedStateRaw(key, JSON.stringify(value));
      return value;
    }
  } catch { /* Missing or malformed storage uses the visible defaults. */ }
  return { ...DEFAULT_FISH_DOWNWARD_WICK };
}

export function readFishDownwardWick(prefix = getUserPrefix()): FishDownwardWick {
  try {
    const value = JSON.parse(readPersistedStateRaw(prefix + FISH_WICK_SETTINGS_KEY) ?? 'null');
    if (value) return validateFishDownwardWick(value);
  } catch { /* An invalid override never prevents recovery of the previous settings. */ }
  return readLegacyFishDownwardWick(prefix);
}

export function saveFishDownwardWick(value: FishDownwardWick, prefix = getUserPrefix()): boolean {
  return writePersistedStateRaw(prefix + FISH_WICK_SETTINGS_KEY, JSON.stringify(validateFishDownwardWick(value)));
}
export type FishWickCandle = Pick<ResearchBar, 'openTime' | 'open' | 'high' | 'low' | 'close'>;
export interface FishWickHit extends FishWickCandle { drop: number; atr: number; candles: FishWickCandle[] }
/** Frozen evidence from the actual venue and rule used in this round. Not a tradable signal. */
export interface FishWickRejection extends FishWickHit {
  symbol: string; exchange: FishExchange; market?: 'us_stock'; underlying?: string; binanceSymbol?: string | null;
  cutoffMs: number; rule: FishDownwardWick;
}
export const fishWickCount = (rule: FishDownwardWick) => fishWickWindowBars(validateFishDownwardWick(rule).hours) + 15;
/** Fixed closed 5m bars. Downward excursion includes the body: open - low.
 * ATR is the mean TR of the preceding 14 bars, excluding the candidate and all later bars. */
export function findFishDownwardWick(bars: readonly ResearchBar[], cutoffMs: number, rule: FishDownwardWick): FishWickHit | null {
  const count = fishWickCount(rule), sample = bars.filter(b => b.openTime >= cutoffMs - count * FISH_STEP && b.openTime < cutoffMs);
  validateFishBars(sample, cutoffMs, count, FISH_STEP);
  const tr = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const b = sample[i];
    if (![b.open,b.high,b.low,b.close].every(Number.isFinite) || b.low <= 0 || b.low > Math.min(b.open,b.close) || b.high < Math.max(b.open,b.close)) throw new FishError('向下大插针过滤：OHLC 读数无效', 'readings');
    if (i) tr[i] = Math.max(b.high-b.low, Math.abs(b.high-sample[i-1].close), Math.abs(b.low-sample[i-1].close));
  }
  for (let i = 15; i < count; i++) {
    const b = sample[i], drop = b.open-b.low;
    const atr = tr.subarray(i-14,i).reduce((sum,x)=>sum+x,0)/14;
    if (drop > atr*rule.atrMultiple) return {
      openTime:b.openTime, open:b.open, high:b.high, low:b.low, close:b.close, drop, atr,
      candles:sample.slice(Math.max(0,i-15),i+16).map(({openTime,open,high,low,close})=>({openTime,open,high,low,close})),
    };
  }
  return null;
}
export function describeFishWick(hit: FishWickHit, rule: FishDownwardWick): string {
  return `近 ${rule.hours}h 出现向下大插针（5m · ${formatUTC8(hit.openTime)}）：开盘至最低价跌幅 ${hit.drop.toPrecision(6)} > 此前 ATR(14) ${hit.atr.toPrecision(6)} × ${rule.atrMultiple}，已过滤，不入库`;
}
/** Use already fetched 5m history when sufficient; otherwise load only this price gate's fixed window. */
export async function checkFishDownwardWick(adapter: FishDataAdapter, market: FishMarket, anchorMs: number, rule: FishDownwardWick | undefined, signal: AbortSignal, existing?: { bars: readonly ResearchBar[]; step: number }): Promise<FishWickHit | null> {
  if (!rule?.enabled) return null;
  const cut = Math.floor(anchorMs/FISH_STEP)*FISH_STEP, count = fishWickCount(rule);
  const bars = existing?.step === FISH_STEP && existing.bars[0]?.openTime <= cut-count*FISH_STEP && existing.bars.at(-1)!.openTime === cut-FISH_STEP
    ? existing.bars : await adapter.candles(market,cut,signal,{interval:'5m',count});
  return findFishDownwardWick(bars,cut,rule);
}
