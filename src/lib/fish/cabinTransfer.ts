import type { TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import { EXCHANGE_PRIORITY } from './exchanges';
import { LIBRARY_FILE_LIMIT, parseLibraryJson, stringifyLibraryFile } from './libraryTransfer';
import { archiveFishForNextRound, fishVisibleKey } from './records';
import { applyFishTombstones, mergeFishLists, type FishTombstones } from './tombstones';

const FORMAT = 'veil-fish-cabin';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const time = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const str = (v: unknown) => typeof v === 'string';
const optionalString = (v: unknown) => v === undefined || str(v);
const optionalList = (v: unknown, item: (value: unknown) => boolean) => v === undefined || Array.isArray(v) && v.every(item);

function validSnapshot(v: unknown, member = false): boolean {
  if (!object(v) || (v.cutoffMs === undefined ? !member : !time(v.cutoffMs)) ||
      (v.threshold !== undefined && (typeof v.threshold !== 'number' || !Number.isFinite(v.threshold)))) return false;
  for (const key of ['featureId', 'featureShort', 'featureName', 'definitionKey', 'statistic', 'interval', 'algorithmKey']) {
    if (!optionalString(v[key])) return false;
  }
  if (v.direction !== undefined && v.direction !== '>' && v.direction !== '<') return false;
  if (!optionalList(v.constraints, str) || !optionalList(v.hitAlgorithms, n => typeof n === 'number' && Number.isInteger(n) && n > 0)) return false;
  if (v.trace !== undefined && (!object(v.trace) || !time(v.trace.t0) || !time(v.trace.dt) ||
      !Array.isArray(v.trace.values) || !v.trace.values.every(n => n === null || typeof n === 'number'))) return false;
  return member ? v.algorithms === undefined : optionalList(v.algorithms, child => validSnapshot(child, true));
}

function validRecord(v: unknown): v is TradeSignal {
  return object(v) && typeof v.id === 'string' && !!v.id.trim() && typeof v.symbol === 'string' && !!v.symbol.trim() &&
    time(v.timeMs) && str(v.timeLabel) && str(v.fallbackZone) && optionalString(v.underlying) &&
    (v.binanceSymbol === null || optionalString(v.binanceSymbol)) &&
    (v.market === undefined || v.market === 'us_stock') &&
    (v.exchange === undefined || EXCHANGE_PRIORITY.some(exchange => exchange === v.exchange)) &&
    (v.freshCatch === undefined || v.freshCatch === false) &&
    (v.caughtAt === undefined || time(v.caughtAt)) &&
    (v.cabinImportedAt === undefined || time(v.cabinImportedAt)) &&
    (v.fishArchive === undefined || object(v.fishArchive) && typeof v.fishArchive.id === 'string' && !!v.fishArchive.id && time(v.fishArchive.at)) &&
    (v.mined === undefined || object(v.mined) && time(v.mined.anchorMs) && optionalString(v.mined.roundId) &&
      (v.mined.importedAt === undefined || time(v.mined.importedAt))) &&
    (v.fish === undefined || validSnapshot(v.fish));
}

export function parseCabinFile(text: string): TradeSignal[] {
  if (new TextEncoder().encode(text).length > LIBRARY_FILE_LIMIT) throw Error('鱼舱数据包超过 128 MB');
  const value: unknown = parseLibraryJson(text);
  if (!object(value) || value.format !== FORMAT || value.version !== 1 || !time(value.exportedAt) ||
      !Array.isArray(value.records) || !value.records.every(validRecord)) {
    throw Error('鱼舱数据包格式无效，请选择「完整下载 JSON」生成的文件');
  }
  return value.records;
}

export function downloadCabinFile(records: readonly TradeSignal[], at = Date.now()) {
  // The caller uses the actual cabin view, which can include a catch already outside the active round.
  const cabin = records.map(({ freshCatch: _fresh, ...record }) => record);
  const text = stringifyLibraryFile({ format: FORMAT, version: 1, exportedAt: at, records: cabin });
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  if (blob.size > LIBRARY_FILE_LIMIT) throw Error('鱼舱数据包超过 128 MB');
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url;
  link.download = '鱼舱-完整数据-' + formatUTC8(at).replace(/\D/g, '') + '.json';
  try { link.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

export function mergeCabinImport(current: TradeSignal[], incoming: readonly TradeSignal[], marks: FishTombstones, at = Date.now()) {
  const live = applyFishTombstones(current, marks);
  const existing = new Set(live.filter(row => !row.freshCatch).map(fishVisibleKey));
  const unique = mergeFishLists([], incoming);
  const pending = unique.filter(row => !existing.has(fishVisibleKey(row)));
  // Import time authorizes this occurrence to cross an older deletion. Keep the original capture time for charts and research.
  const importedAt = Math.max(at, Object.values(marks).reduce((latest, value) => Math.max(latest, value + 1), 0));
  const additions = archiveFishForNextRound(pending, at).map(row => ({ ...row, cabinImportedAt: importedAt }));
  return { signals: additions.length ? mergeFishLists(live, additions, marks) : live,
    added: additions.length, skipped: incoming.length - additions.length };
}
