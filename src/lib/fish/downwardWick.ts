import type { ResearchBar } from '@/lib/deepRsa/window';
import type { FishDataAdapter } from './adapters';
import type { FishMarket } from './exchanges';
import { FISH_STEP, FishError, validateFishBars } from './shared';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { formatUTC8 } from '@/lib/timeFormat';

export interface FishDownwardWick { enabled: boolean; hours: number; atrMultiple: number }
export const FISH_WICK_HOURS = [6, 12, 24, 48, 72] as const;
export const FISH_WICK_ATR_MULTIPLES = [1, 1.5, 2, 3] as const;
export const DEFAULT_FISH_DOWNWARD_WICK: Readonly<FishDownwardWick> = { enabled: true, hours: 24, atrMultiple: 3 };
const key = () => `${getUserPrefix()}fish-downward-wick.v1`;
export function readFishDownwardWick(): FishDownwardWick {
  try {
    const x = JSON.parse(readPersistedStateRaw(key()) ?? 'null');
    if (x && typeof x.enabled === 'boolean' && FISH_WICK_HOURS.includes(x.hours) && FISH_WICK_ATR_MULTIPLES.includes(x.atrMultiple)) return { enabled: x.enabled, hours: x.hours, atrMultiple: x.atrMultiple };
  } catch { /* Missing or malformed storage uses the visible defaults. */ }
  return { ...DEFAULT_FISH_DOWNWARD_WICK };
}
export function saveFishDownwardWick(value: FishDownwardWick): void {
  writePersistedStateRaw(key(), JSON.stringify(value));
}
export interface FishWickHit { openTime: number; lower: number; body: number; range: number; atr: number }
export const fishWickCount = (rule: FishDownwardWick) => rule.hours * 12 + 15;
/** Fixed 5m bars for every algorithm. ATR is the mean TR of the preceding 14 bars, excluding the candidate wick. */
export function findFishDownwardWick(bars: readonly ResearchBar[], cutoffMs: number, rule: FishDownwardWick): FishWickHit | null {
  if (!FISH_WICK_HOURS.includes(rule.hours as typeof FISH_WICK_HOURS[number]) || !FISH_WICK_ATR_MULTIPLES.includes(rule.atrMultiple as typeof FISH_WICK_ATR_MULTIPLES[number])) throw new FishError('向下大插针过滤设置无效', 'readings');
  const count = fishWickCount(rule), sample = bars.filter(b => b.openTime >= cutoffMs - count * FISH_STEP && b.openTime < cutoffMs);
  validateFishBars(sample, cutoffMs, count, FISH_STEP);
  const tr = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const b = sample[i];
    if (![b.open,b.high,b.low,b.close].every(Number.isFinite) || b.low <= 0 || b.low > Math.min(b.open,b.close) || b.high < Math.max(b.open,b.close)) throw new FishError('向下大插针过滤：OHLC 读数无效', 'readings');
    if (i) tr[i] = Math.max(b.high-b.low, Math.abs(b.high-sample[i-1].close), Math.abs(b.low-sample[i-1].close));
  }
  for (let i = 15; i < count; i++) {
    const b = sample[i], lower = Math.min(b.open,b.close)-b.low, body = Math.abs(b.close-b.open), range = b.high-b.low;
    const atr = tr.subarray(i-14,i).reduce((sum,x)=>sum+x,0)/14;
    if (lower > 0 && lower >= body*2 && lower >= range*.5 && lower >= atr*rule.atrMultiple) return { openTime:b.openTime, lower, body, range, atr };
  }
  return null;
}
export function describeFishWick(hit: FishWickHit, rule: FishDownwardWick): string {
  return `近 ${rule.hours}h 出现向下大插针（5m · ${formatUTC8(hit.openTime)}）：下影 ≥ 实体 2 倍、占振幅 ≥ 50%、≥ 此前 ATR(14) × ${rule.atrMultiple}，已过滤，不入库`;
}
/** Use already fetched 5m history when sufficient; otherwise load only this price gate's fixed window. */
export async function checkFishDownwardWick(adapter: FishDataAdapter, market: FishMarket, anchorMs: number, rule: FishDownwardWick | undefined, signal: AbortSignal, existing?: { bars: readonly ResearchBar[]; step: number }): Promise<FishWickHit | null> {
  if (!rule?.enabled) return null;
  const cut = Math.floor(anchorMs/FISH_STEP)*FISH_STEP, count = fishWickCount(rule);
  const bars = existing?.step === FISH_STEP && existing.bars[0]?.openTime <= cut-count*FISH_STEP && existing.bars.at(-1)!.openTime === cut-FISH_STEP
    ? existing.bars : await adapter.candles(market,cut,signal,{interval:'5m',count});
  return findFishDownwardWick(bars,cut,rule);
}
