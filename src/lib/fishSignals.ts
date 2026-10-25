import { archiveFishForNextRound, collapseVisibleFish, mergeFishSignals, fishCatchKey, fishDedupKey, fishVisibleKey } from '@/lib/fish/records';
import { applyFishTombstones, mergeFishTombstones, normalizeFishTombstones, type FishTombstones } from '@/lib/fish/tombstones';
import { type TradeSignal } from '@/lib/signalLibrary';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { queueSimStatePush } from '@/lib/simStateSync';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { formatUTC8 } from '@/lib/timeFormat';
import { saveFishLibraryBackup, mergeFishLibraryBackups, type FishLibraryBackup } from '@/lib/fish/libraryStore';
export const FISH_STORAGE_KEY = 'veil.fishSignals.v1';
/** 用户手动删除的鱼（键 → 删除时刻），跨设备合并，防止别处的旧副本把删掉的鱼带回来。 */
export const FISH_DELETED_KEY = 'veil.fishDeleted.v1';
const cacheRevisionKey = (owner: string | null) => `veil.fish.cacheRevision.v1:${owner ?? 'anonymous'}`;
const liveRevisions = new Map<string | null, number>();
function fishRevision(owner: string | null): number {
  const cached = Number(readPersistedStateRaw(cacheRevisionKey(owner)) ?? 0);
  return Math.max(liveRevisions.get(owner) ?? 0, Number.isFinite(cached) ? cached : 0);
}
function nextFishRevision(owner: string | null): number {
  const at = Math.max(Date.now(), fishRevision(owner) + 1);
  liveRevisions.set(owner, at); return at;
}
export function loadFishTombstones(): FishTombstones {
  try { return normalizeFishTombstones(JSON.parse(readPersistedStateRaw(FISH_DELETED_KEY) ?? '{}')); } catch { return {}; }
}
/** 记下这几条鱼被用户删除了（只有手动删除才记；切换交集 / 并集、调严阈值撤掉的不算删除）。 */
export function recordFishDeletion(signals: readonly TradeSignal[], userId: string | null, now = Date.now()): void {
  if (!signals.length) return;
  const next = mergeFishTombstones(loadFishTombstones(), Object.fromEntries(signals.flatMap(s => { const t = Math.max(now, (s.caughtAt ?? 0) + 1); return [[fishDedupKey(s), t], [`v|${fishVisibleKey(s)}`, t]]; })));
  writePersistedStateRaw(FISH_DELETED_KEY, JSON.stringify(next));
  void saveFishLibraryBackup(userId, { signals: loadFishSignals(), tombstones: next, updatedAt: nextFishRevision(userId) });
  if (userId) queueSimStatePush(userId, 'fish_deleted_v1', next);
}
export function loadFishSignals(): TradeSignal[] {
  try {
    const raw = JSON.parse(readPersistedStateRaw(FISH_STORAGE_KEY) ?? '[]');
    if(!Array.isArray(raw))return [];
    const valid=raw.filter((s):s is TradeSignal=>s&&typeof s.id==='string'&&typeof s.symbol==='string'&&Number.isFinite(s.timeMs)&&typeof s.timeLabel==='string'&&typeof s.fallbackZone==='string');
    const migrated=collapseVisibleFish(applyFishTombstones(mergeFishSignals([],valid),loadFishTombstones())),serialized=JSON.stringify(migrated);
    // Keep malformed original rows available for recovery; only migrate a wholly valid library in place.
    // 被删除记号压住的鱼（别的设备删的、或合并时带回来的旧副本）也在这里去掉。
    if(valid.length===raw.length&&serialized!==JSON.stringify(raw))writePersistedStateRaw(FISH_STORAGE_KEY,serialized);
    return migrated;
  } catch { return []; }
}
export function saveFishSignals(signals: TradeSignal[], userId: string | null): boolean {
  const updatedAt = nextFishRevision(userId);
  const saved = writePersistedStateRaw(FISH_STORAGE_KEY, JSON.stringify(signals));
  // A failed large-array write must never give its older on-disk cache a newer revision.
  if (saved) writePersistedStateRaw(cacheRevisionKey(userId), String(updatedAt));
  void saveFishLibraryBackup(userId, { signals, tombstones: loadFishTombstones(), updatedAt });
  if (userId) queueSimStatePush(userId, 'fish_signals_v1', signals);
  return saved;
}
/** Also mirror cloud hydration and existing local libraries, without causing a cloud push loop. */
export function backupFishSignals(signals: TradeSignal[], userId: string | null): void {
  void saveFishLibraryBackup(userId, { signals, tombstones: loadFishTombstones(), updatedAt: nextFishRevision(userId) });
}
/** Merge a delayed disk recovery with live catches; an early start must archive the recovered old round too. */
export function restoreFishSignals(backup: FishLibraryBackup | null, current: TradeSignal[], userId: string | null, archiveBefore?: number): TradeSignal[] {
  if (!backup) { backupFishSignals(current, userId); return current; }
  const tombstones = loadFishTombstones();
  // Apply deletion to the original key before creating any new archive key.
  let recovered = applyFishTombstones(backup.signals, mergeFishTombstones(tombstones, backup.tombstones));
  if (archiveBefore !== undefined) {
    const occurrence = (s: TradeSignal) => `${fishCatchKey(s)}|${s.caughtAt ?? 0}`;
    const archived = new Set(current.filter(s => s.fishArchive).map(occurrence));
    recovered = recovered.filter(s => s.fishArchive || !archived.has(occurrence(s)));
    const old = recovered.filter(s => !s.fishArchive && (s.caughtAt ?? 0) <= archiveBefore);
    const oldSet = new Set(old);
    recovered = [...recovered.filter(s => !oldSet.has(s)), ...archiveFishForNextRound(old, archiveBefore)];
  }
  const local = { signals: current, tombstones, updatedAt: fishRevision(userId) };
  const stored = { ...backup, signals: recovered };
  const value = (backup.updatedAt ?? 0) > local.updatedAt ? mergeFishLibraryBackups(stored, local) : mergeFishLibraryBackups(local, stored);
  if (JSON.stringify(value.tombstones) !== JSON.stringify(tombstones)) {
    writePersistedStateRaw(FISH_DELETED_KEY, JSON.stringify(value.tombstones));
    if (userId) queueSimStatePush(userId, 'fish_deleted_v1', value.tombstones);
  }
  if (JSON.stringify(value.signals) !== JSON.stringify(current)) saveFishSignals(value.signals, userId);
  else backupFishSignals(value.signals, userId);
  return value.signals;
}
export function fishSignalTitle(signal: TradeSignal): string {
  const r = signal.fish;
  const n = (v: number) => Number.isFinite(v) ? v.toFixed(8) : '—';
  if (!r) return 'CBI-2（旧记录，无读数快照）';
  const scale=r.scale??1;
  // 多重算法：先写合并方式与各算法结论，后面是起点那个算法的完整读数
  const multi=r.algorithms?.length?`${r.combination==='or'?`并集（满足任一）：命中算法 ${(r.hitAlgorithms??[]).join('、')}；起点=命中算法里最早的起点`:'交集（同时满足）：起点=各算法起点里最晚的'}；${r.algorithms.map((a,i)=>`算法 ${i+1} ${a.featureShort??a.featureName??''} ${a.outcome??(a.startIndex!==undefined?'hit':'')}`).join('；')}\n`:'';
  return multi+`${signal.market==='us_stock'?`美股 ${signal.underlying??signal.symbol}；`:''}${EXCHANGE_NAMES[signal.exchange ?? 'binance']}；${r.featureShort??'CBI-2'} ${r.featureName??''}；${r.H!==undefined?`avg(${r.statistic&&r.statistic!=='结果'?r.statistic:r.featureShort??'CBI-2'},${r.H}h)`:r.statistic&&r.statistic!=='结果'?r.statistic:r.featureShort??'CBI-2'}=${n(r.average*scale)} ${r.unit??''}；当前值=${n((r.value??r.cbi2)*scale)}；起点${r.H!==undefined?'均值':'读数'}=${n(r.startAverage*scale)}；前根${r.H!==undefined?'均值':'读数'}=${n(r.previousAverage*scale)}；阈值${r.direction??'>'}${r.threshold}（原值${r.thresholdRaw??r.threshold}，倍率${scale}）；周期=${r.interval??'5m'}；数据截止（UTC+8）=${formatUTC8(r.cutoffMs)}；约束=${(r.constraints??[]).map((text,i)=>`${text} [起点${r.startConstraints?.[i]??'—'} / 截止${r.cutoffConstraints?.[i]??'—'}]`).join('；')||'无'}；定义快照=${r.definitionKey??'内置 CBI-2'}；算法键=${r.algorithmKey??'旧版 CBI-2'}\n完整快照：${JSON.stringify(r,null,2)}`;
}
