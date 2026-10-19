import { mergeFishSignals } from '@/lib/fish/records';
import { type TradeSignal } from '@/lib/signalLibrary';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { queueSimStatePush } from '@/lib/simStateSync';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { formatUTC8 } from '@/lib/timeFormat';
export const FISH_STORAGE_KEY = 'veil.fishSignals.v1';
export function loadFishSignals(): TradeSignal[] {
  try {
    const raw = JSON.parse(readPersistedStateRaw(FISH_STORAGE_KEY) ?? '[]');
    if(!Array.isArray(raw))return [];
    const valid=raw.filter((s):s is TradeSignal=>s&&typeof s.id==='string'&&typeof s.symbol==='string'&&Number.isFinite(s.timeMs)&&typeof s.timeLabel==='string'&&typeof s.fallbackZone==='string');
    const migrated=mergeFishSignals([],valid),serialized=JSON.stringify(migrated);
    // Keep malformed original rows available for recovery; only migrate a wholly valid library in place.
    if(valid.length===raw.length&&serialized!==JSON.stringify(raw))writePersistedStateRaw(FISH_STORAGE_KEY,serialized);
    return migrated;
  } catch { return []; }
}
export function saveFishSignals(signals: TradeSignal[], userId: string | null): void {
  writePersistedStateRaw(FISH_STORAGE_KEY, JSON.stringify(signals));
  if (userId) queueSimStatePush(userId, 'fish_signals_v1', signals);
}
export function fishSignalTitle(signal: TradeSignal): string {
  const r = signal.fish;
  const n = (v: number) => Number.isFinite(v) ? v.toFixed(8) : '—';
  if (!r) return 'CBI-2（旧记录，无读数快照）';
  const scale=r.scale??1;
  return `${signal.market==='us_stock'?`美股 ${signal.underlying??signal.symbol}；`:''}${EXCHANGE_NAMES[signal.exchange ?? 'binance']}；${r.featureShort??'CBI-2'} ${r.featureName??''}；avg(${r.featureShort??'CBI-2'},${r.H??24}h)=${n(r.average*scale)} ${r.unit??''}；当前值=${n((r.value??r.cbi2)*scale)}；起点均值=${n(r.startAverage*scale)}；前根均值=${n(r.previousAverage*scale)}；阈值${r.direction??'>'}${r.threshold}（原值${r.thresholdRaw??r.threshold}，倍率${scale}）；周期=${r.interval??'5m'}；数据截止（UTC+8）=${formatUTC8(r.cutoffMs)}；约束=${(r.constraints??[]).map((text,i)=>`${text} [起点${r.startConstraints?.[i]??'—'} / 截止${r.cutoffConstraints?.[i]??'—'}]`).join('；')||'无'}；定义快照=${r.definitionKey??'内置 CBI-2'}；算法键=${r.algorithmKey??'旧版 CBI-2'}\n完整快照：${JSON.stringify(r,null,2)}`;
}
