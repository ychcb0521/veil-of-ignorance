import {pruneMiningDeletions,mergeSourceDeletions} from './libraryDeletion';
/**
 * 挖掘库：批量挖掘每一档的扫描记录与挖到的信号，独立于鱼舱保存（在鱼舱里删掉鱼，挖掘库里仍在，并标出「已从鱼舱删除」）。
 * 【用户要求】2026-10-27「批量挖掘、买前过滤、持仓监测的逻辑和运行是独立的，因此需要有各自的数据库」。
 *
 *   挖掘方案（run）= 冻结的默认算法与阈值 + 捕捞范围 + 起点与档距；方案相同的多次挖掘共用一个；
 *   档（anchor）   = 一次扫描：扫到几条、新增几条、出错原因（出错原地重试，次数累加）；
 *   记录（record） = 挖到的一条信号（同一方案下同一信号合并为一条），保存当时的读数快照（去掉逐点曲线）。
 * 体积可能上 MB，存 IndexedDB 并跟账号同步（见 miningLibraryStore），不进 localStorage。
 */
import { shortFishHash } from './algorithm';
import { fishCatchKey } from './records';
import { mergeLibraryRecords, type LibraryRecordBase } from './libraryRounds';
import type { FishMiningRule, FishMiningState } from './miningState';
import type { TradeSignal } from '@/lib/signalLibrary';

export interface FishMiningRun {
  id: string; signature: string; rules: FishMiningRule[]; selection?: FishMiningState['selection'];
  /** 旧记录未填写时仍按原来的并集解释。 */
  combination?: 'and' | 'or';
  startMs: number; stepMs: number; firstAt: number; updatedAt: number;
}
export interface FishMiningAnchor {
  id: string; runId: string; anchorMs: number; scannedAt: number; updatedAt: number;
  /** 这一档扫到的信号数（含之前档已挖过、这次不再收的）与新入库的条数。出错的档两者都为 0。 */
  found: number; added: number; recordIds: string[];
  error?: string; attempts: number;
}
export interface FishMiningRecord extends LibraryRecordBase { runId: string; anchorMs: number; catchKey: string; signal: TradeSignal }
export interface FishMiningLibrary { deletedRecords?:Record<string,number>; version: 1; runs: FishMiningRun[]; anchors: FishMiningAnchor[]; records: FishMiningRecord[]; adoptedHold?: boolean }

export const emptyMiningLibrary = (): FishMiningLibrary => ({ version: 1, runs: [], anchors: [], records: [] });
export function normalizeMiningLibrary(x: unknown): FishMiningLibrary {
  const v = x as Partial<FishMiningLibrary> | null;
  if (!v || v.version !== 1 || !Array.isArray(v.runs) || !Array.isArray(v.anchors) || !Array.isArray(v.records)) return emptyMiningLibrary();
  return pruneMiningDeletions({ version: 1, runs: v.runs, anchors: v.anchors, records: v.records, deletedRecords:v.deletedRecords, ...(v.adoptedHold ? { adoptedHold: true } : {}) });
}

/** 去掉逐点曲线（trace）与「新鱼」标记：库里只留判断所需的读数快照。 */
export function compactMinedSignal(s: TradeSignal): TradeSignal {
  const { freshCatch: _fresh, ...rest } = s;
  if (!rest.fish) return rest;
  const { trace: _trace, ...fish } = rest.fish;
  return { ...rest, fish: { ...fish, ...(fish.algorithms ? { algorithms: fish.algorithms.map(({ trace: _t, ...a }) => a) } : {}) } };
}
const runSignature = (s: Pick<FishMiningState, 'rules' | 'selection' | 'startMs' | 'stepMs'>) => JSON.stringify([
  [...s.rules].map(r => [r.featureId, r.statistic, r.threshold]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  s.selection ? [[...s.selection.exchanges].sort(), !!s.selection.includeDuplicates, !!s.selection.includeUsStocks] : null, s.startMs, s.stepMs,
]);
function withRun(library: FishMiningLibrary, state: FishMiningState, at: number, combination: 'and'|'or' = 'and'): { library: FishMiningLibrary; run: FishMiningRun } {
  // Keep legacy union signatures stable and never merge an intersection into a union run.
  const signature = runSignature(state) + (combination === 'and' ? '|and' : ''), existing = library.runs.find(r => r.signature === signature);
  if (existing) {
    const run = { ...existing, updatedAt: Math.max(existing.updatedAt, at) };
    return { run, library: { ...library, runs: library.runs.map(r => r.id === run.id ? run : r) } };
  }
  const run: FishMiningRun = { id: `mine-run-${shortFishHash(signature)}`, signature, combination, rules: structuredClone(state.rules), ...(state.selection ? { selection: structuredClone(state.selection) } : {}),
    startMs: state.startMs, stepMs: state.stepMs, firstAt: at, updatedAt: at };
  return { run, library: { ...library, runs: [...library.runs, run] } };
}
const recordId = (runId: string, catchKey: string) => `${runId}|${catchKey}`;
const anchorId = (runId: string, anchorMs: number) => `${runId}|${anchorMs}`;

/** 一档扫完：记下扫描结果和新挖到的信号。found = 这一档扫到的全部信号数，added = 真正入舱的那些。 */
export function recordMinedAnchor(input: FishMiningLibrary, state: FishMiningState, anchorMs: number, found: number, added: readonly TradeSignal[], at: number, combination:'and'|'or' = 'and'): FishMiningLibrary {
  const { library, run } = withRun(input, state, at, combination);
  const records = added.map(signal => {
    const catchKey = fishCatchKey(signal);
    return { id: recordId(run.id, catchKey), runId: run.id, anchorMs, catchKey, signal: compactMinedSignal(signal), firstSavedAt: at, updatedAt: at } satisfies FishMiningRecord;
  });
  const id = anchorId(run.id, anchorMs), prior = library.anchors.find(a => a.id === id);
  const anchor: FishMiningAnchor = { id, runId: run.id, anchorMs, scannedAt: at, updatedAt: at, found, added: added.length,
    recordIds: [...new Set([...(prior?.recordIds ?? []), ...records.map(r => r.id)])], attempts: (prior?.attempts ?? 0) + 1 };
  return { ...library, anchors: [...library.anchors.filter(a => a.id !== id), anchor], records: mergeLibraryRecords(library.records, records) };
}
/** 一档出错：记下原因和重试次数；之后同一档扫成功会覆盖成正常结果（保留累计次数）。 */
export function recordMiningError(input: FishMiningLibrary, state: FishMiningState, anchorMs: number, error: string, at: number, combination: 'and'|'or' = 'and'): FishMiningLibrary {
  const { library, run } = withRun(input, state, at, combination);
  const id = anchorId(run.id, anchorMs), prior = library.anchors.find(a => a.id === id);
  if (prior && !prior.error) return library;
  const anchor: FishMiningAnchor = { id, runId: run.id, anchorMs, scannedAt: at, updatedAt: at, found: 0, added: 0, recordIds: prior?.recordIds ?? [], error, attempts: (prior?.attempts ?? 0) + 1 };
  return { ...library, anchors: [...library.anchors.filter(a => a.id !== id), anchor] };
}
/**
 * 挖掘库上线前挖到的鱼：从鱼舱里带 mined 标记的鱼补进库（只补一次）。扫到几条已无从得知，记为与新增相同。
 * 没有冻结规则（从没开始过）就不补。
 */
export function adoptMinedFish(library: FishMiningLibrary, state: FishMiningState, signals: readonly TradeSignal[], at: number): FishMiningLibrary {
  if (library.adoptedHold || !state.rules.length) return library;
  const mined = signals.filter(s => s.mined && Number.isFinite(s.mined.anchorMs));
  let next: FishMiningLibrary = { ...library, adoptedHold: true };
  if (!mined.length) return next;
  const byAnchor = new Map<string, {anchorMs:number;rules:FishMiningRule[];combination:'and'|'or';list:TradeSignal[]}>();
  for (const s of mined) {
    const snapshots=s.fish?.algorithms?.length?s.fish.algorithms:s.fish?[s.fish]:[];
    // Backfill using each historical signal's snapshot, never relabel old fish with today's preset.
    const rules=snapshots.length?snapshots.map((r,i)=>({id:`historical-${i}`,featureId:r.featureId??'cbi2',statistic:r.statistic??'结果',threshold:String(r.threshold)})):state.rules;
    const combination=s.fish?.combination??(s.fish?.algorithms?.length?'and':'or'),anchorMs=s.mined!.anchorMs,key=JSON.stringify([anchorMs,rules,combination]);
    const group=byAnchor.get(key)??{anchorMs,rules,combination,list:[]};group.list.push(s);byAnchor.set(key,group);
  }
  for (const {anchorMs,rules,combination,list} of [...byAnchor.values()].sort((a,b)=>a.anchorMs-b.anchorMs)) {
    const when = list.reduce((t, s) => Math.max(t, s.caughtAt ?? 0), 0) || at;
    const historical={...state,rules};
    const { library: withAnchor, run } = withRun(next, historical, when, combination);
    if (withAnchor.anchors.some(a => a.id === anchorId(run.id, anchorMs))) { next = withAnchor; continue; }
    next = recordMinedAnchor(withAnchor, historical, anchorMs, list.length, list, when, combination);
  }
  return next;
}
/** 两份合并（两个标签页、两台设备、本机与云端）：只增不减。 */
export function mergeMiningLibraries(a: FishMiningLibrary, b: FishMiningLibrary): FishMiningLibrary {
  const runs = new Map(a.runs.map(r => [r.id, r]));
  for (const r of b.runs) { const old = runs.get(r.id); runs.set(r.id, old ? { ...r, firstAt: Math.min(old.firstAt, r.firstAt), updatedAt: Math.max(old.updatedAt, r.updatedAt) } : r); }
  const anchors = new Map(a.anchors.map(x => [x.id, x]));
  for (const x of b.anchors) {
    const old = anchors.get(x.id);
    if (!old) { anchors.set(x.id, x); continue; }
    const newer = old.updatedAt <= x.updatedAt ? x : old;
    // 成功的扫描结果优先于出错记录；挖到的记录取并集
    const picked = !old.error && x.error ? old : !x.error && old.error ? x : newer;
    anchors.set(x.id, { ...picked, recordIds: [...new Set([...old.recordIds, ...x.recordIds])], attempts: Math.max(old.attempts, x.attempts) });
  }
  return pruneMiningDeletions({ version: 1, runs: [...runs.values()], anchors: [...anchors.values()], records: mergeLibraryRecords(a.records, b.records),deletedRecords:mergeSourceDeletions(a.deletedRecords,b.deletedRecords), ...(a.adoptedHold || b.adoptedHold ? { adoptedHold: true } : {}) });
}
