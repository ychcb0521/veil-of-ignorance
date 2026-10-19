import { mergeSignals, type TradeSignal } from '@/lib/signalLibrary';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { queueSimStatePush } from '@/lib/simStateSync';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { formatUTC8 } from '@/lib/timeFormat';
export const FISH_STORAGE_KEY = 'veil.fishSignals.v1';
export function loadFishSignals(): TradeSignal[] {
  try {
    const raw = JSON.parse(readPersistedStateRaw(FISH_STORAGE_KEY) ?? '[]');
    return Array.isArray(raw) ? mergeSignals([], raw.filter((s): s is TradeSignal => s && typeof s.id === 'string' && typeof s.symbol === 'string' && Number.isFinite(s.timeMs) && typeof s.timeLabel === 'string' && typeof s.fallbackZone === 'string')) : [];
  } catch { return []; }
}
export function saveFishSignals(signals: TradeSignal[], userId: string | null): void {
  writePersistedStateRaw(FISH_STORAGE_KEY, JSON.stringify(signals));
  if (userId) queueSimStatePush(userId, 'fish_signals_v1', signals);
}
export function fishSignalTitle(signal: TradeSignal): string {
  const r = signal.fish;
  const n = (v: number) => Number.isFinite(v) ? v.toFixed(8) : '—';
  return r ? `${EXCHANGE_NAMES[signal.exchange ?? 'binance']}；avg(CBI-2,24h)=${n(r.average)}；CBI-2=${n(r.cbi2)}；起点均值=${n(r.startAverage)}；前根均值=${n(r.previousAverage)}；阈值>${r.threshold}；数据截止（UTC+8）=${formatUTC8(r.cutoffMs)}` : '';
}
