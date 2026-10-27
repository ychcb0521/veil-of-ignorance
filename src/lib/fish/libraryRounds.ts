/**
 * 挖掘库 / 过滤库共用的「轮次」与记录合并规则（监测库在 qualityMonitorLibrary 里有同样的一份）。
 *
 * 轮次只存与上一轮的差异：base = 上一轮，added / removed = 这一轮多出 / 少了的记录；
 * 没有 base 的轮（第一轮、旧数据）存完整 recordIds。轮次一经开始就不再改动记录清单，差异链因此稳定。
 * 【2026-10-27 审查】每轮存完整清单会线性膨胀（1178 条 × 2 套方案每轮约 0.23 MB），每 400 ms 保存一次时页面明显变卡。
 */
export type LibraryRoundState = 'running' | 'complete' | 'paused' | 'failed';
export interface LibraryRound {
  id: string; startedAt: number; updatedAt: number; finishedAt?: number; state: LibraryRoundState;
  recordIds?: string[]; base?: string; added?: string[]; removed?: string[]; error?: string;
}
export interface LibraryRecordBase { id: string; firstSavedAt: number; updatedAt: number }

/** 还原某一轮的完整记录编号（沿差异链回溯）。基准缺失时只算本轮新增的部分，不抛错。 */
export function libraryRoundRecordIds(rounds: readonly LibraryRound[], round: LibraryRound, cache = new Map<string, string[]>()): string[] {
  const byId = new Map(rounds.map(r => [r.id, r])), chain: LibraryRound[] = [], seen = new Set<string>();
  let cursor: LibraryRound | undefined = round;
  while (cursor && !cache.has(cursor.id) && !seen.has(cursor.id)) {
    seen.add(cursor.id); chain.push(cursor);
    cursor = cursor.recordIds || !cursor.base ? undefined : byId.get(cursor.base);
  }
  let ids = cursor && cache.has(cursor.id) ? cache.get(cursor.id)! : [];
  for (const r of chain.reverse()) {
    if (r.recordIds) ids = r.recordIds;
    else {
      const removed = new Set(r.removed ?? []), next = ids.filter(id => !removed.has(id)), have = new Set(next);
      for (const id of r.added ?? []) if (!have.has(id)) { next.push(id); have.add(id); }
      ids = next;
    }
    cache.set(r.id, ids);
  }
  return ids;
}

/** 新一轮：相对开始时间最晚的那轮存差异；差异比完整清单还大时存完整清单。 */
export function newLibraryRound(rounds: readonly LibraryRound[], id: string, at: number, ids: readonly string[]): LibraryRound {
  const unique = [...new Set(ids)];
  const previous = rounds.reduce<LibraryRound | undefined>((latest, r) => !latest || r.startedAt >= latest.startedAt ? r : latest, undefined);
  const base: LibraryRound = { id, startedAt: at, updatedAt: at, state: 'running' };
  if (!previous) return { ...base, recordIds: unique };
  const before = libraryRoundRecordIds(rounds, previous), prior = new Set(before), now = new Set(unique);
  const added = unique.filter(x => !prior.has(x)), removed = before.filter(x => !now.has(x));
  return added.length + removed.length >= unique.length ? { ...base, recordIds: unique } : { ...base, base: previous.id, added, removed };
}

export function finishLibraryRound(rounds: readonly LibraryRound[], id: string, state: Exclude<LibraryRoundState, 'running'>, at: number, error?: string): LibraryRound[] {
  return rounds.map(r => r.id === id ? { ...r, state, updatedAt: at, finishedAt: at, ...(error ? { error } : {}) } : r);
}

/** 打开时还挂着「运行中」的轮次不可能还在跑（页面关过）：改成已暂停，保留已存的记录。 */
export function recoverLibraryRounds(rounds: readonly LibraryRound[], at: number): LibraryRound[] {
  return rounds.some(r => r.state === 'running') ? rounds.map(r => r.state === 'running' ? { ...r, state: 'paused', updatedAt: at, finishedAt: at } : r) : [...rounds];
}

/** 两份合并（两个标签页、两台设备）：只增不减，同一条取更新的那份。 */
export function mergeLibraryRecords<T extends LibraryRecordBase>(a: readonly T[] = [], b: readonly T[] = []): T[] {
  const map = new Map(a.map(r => [r.id, r]));
  for (const r of b) { const old = map.get(r.id); if (!old || old.updatedAt <= r.updatedAt) map.set(r.id, old ? { ...r, firstSavedAt: Math.min(old.firstSavedAt, r.firstSavedAt) } : r); }
  return [...map.values()];
}
export function mergeLibraryRounds(a: readonly LibraryRound[] = [], b: readonly LibraryRound[] = []): LibraryRound[] {
  const map = new Map(a.map(r => [r.id, r]));
  for (const r of b) { const old = map.get(r.id); if (!old || old.updatedAt < r.updatedAt || old.updatedAt === r.updatedAt && (r.state !== 'running' || old.state === 'running')) map.set(r.id, r); }
  return [...map.values()];
}

/** 记录的身份：交易所、市场、标的、信号时间（不看信号编号和显示文案）。 */
export const librarySignalIdentity = (s: { exchange?: string; market?: string; underlying?: string; symbol: string; timeMs: number }) =>
  [s.exchange ?? 'binance', s.market ?? 'crypto', s.underlying ?? '', s.symbol.toUpperCase(), s.timeMs];
