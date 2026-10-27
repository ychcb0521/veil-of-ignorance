/** 挖掘库：批量挖掘每一档的扫描与挖到的信号（数据见 lib/fish/miningLibrary，存 IndexedDB 并随账号同步）。 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FishLibraryDialog, libraryCell } from '@/components/FishLibraryDialog';
import { emptyMiningLibrary, type FishMiningLibrary, type FishMiningRecord, type FishMiningRun } from '@/lib/fish/miningLibrary';
import { loadMiningLibrary, MINING_LIBRARY_EVENT } from '@/lib/fish/miningLibraryStore';
import { fishCaughtBy, fishVisibleCatchKey } from '@/lib/fish/records';
import { formatUTC8 } from '@/lib/timeFormat';
import type { TradeSignal } from '@/lib/signalLibrary';

const date = (t: number | null | undefined) => t == null ? '—' : formatUTC8(t);
const short = (t: number) => formatUTC8(t).slice(0, 16);
const RULE_NAMES: Record<string, string> = { cbi2: 'CBI-2', state: 'S', cba: 'CBA', 'drift-speed-z': 'az', bss: 'BSS' };
const runText = (run: FishMiningRun) => run.rules.map(r => `${RULE_NAMES[r.featureId] ?? r.featureId}${r.statistic === '结果' ? '' : ` ${r.statistic.replace(/^avg_.*_2$/, 'avg₂').replace(/^avg_[^_]+$/, 'avg')}`} > ${r.threshold}`).join(run.combination === 'and' ? ' ∩ ' : ' ∪ ');
/** 实际捕到这条信号的探测算法（并集只列命中的，交集列全部）。 */
const caught = (s: TradeSignal) => fishCaughtBy(s).join(' · ');
type FishMiningRow = FishMiningRecord & { ids: string[]; catchKeys: string[] };
const reading = (s: TradeSignal) => s.fish && Number.isFinite(s.fish.average) ? String(+s.fish.average.toPrecision(4)) : '—';

export function FishMiningLibrary({ account, holdKeys, onJump, canJump }: { account?: string; holdKeys?: () => ReadonlySet<string>; onJump?: (s: TradeSignal) => void; canJump?: (s: TradeSignal) => boolean }) {
  const [library, setLibrary] = useState<FishMiningLibrary>(emptyMiningLibrary), [open, setOpen] = useState(false), [hold, setHold] = useState<ReadonlySet<string> | null>(null);
  const reload = useCallback(() => { void loadMiningLibrary(account).then(setLibrary); setHold(holdKeys?.() ?? null); }, [account, holdKeys]);
  // 打开时读；开着的时候挖到新的一档就刷新
  useEffect(() => {
    if (!open) return;
    reload();
    const refresh = (e: Event) => { if (((e as CustomEvent).detail?.owner ?? null) === (account ?? null)) reload(); };
    window.addEventListener(MINING_LIBRARY_EVENT, refresh);
    return () => window.removeEventListener(MINING_LIBRARY_EVENT, refresh);
  }, [open, reload, account]);
  const runs = useMemo(() => new Map(library.runs.map(r => [r.id, r])), [library.runs]);
  const anchors = useMemo(() => [...library.anchors].sort((a, b) => b.anchorMs - a.anchorMs || b.scannedAt - a.scannedAt), [library.anchors]);
  const anchorOf = useMemo(() => new Map(library.anchors.map(a => [a.id, new Set(a.recordIds)])), [library.anchors]);
  // 【用户要求】2026-10-27「命中算法只显示探测算法（被哪个算法捕捉到的）」：只列实际命中的算法（并集看命中编号）。
  // 同一档里标的、信号时间、命中算法都一样的记录（算法编号修过别名前后各存了一份）显示时合并为一行，保留最新那份。
  const items = useMemo(() => {
    const rows = new Map<string, FishMiningRow>();
    for (const record of library.records) {
      const key = `${record.anchorMs}|${fishVisibleCatchKey(record.signal)}`, prior = rows.get(key);
      if (!prior) rows.set(key, { ...record, ids: [record.id], catchKeys: [record.catchKey] });
      else rows.set(key, { ...(prior.updatedAt >= record.updatedAt ? prior : record), ids: [...prior.ids, record.id], catchKeys: [...prior.catchKeys, record.catchKey] });
    }
    return [...rows.values()].sort((a, b) => b.anchorMs - a.anchorMs || b.signal.timeMs - a.signal.timeMs || a.signal.symbol.localeCompare(b.signal.symbol));
  }, [library.records]);
  const inHold = useCallback((r: FishMiningRow) => !hold || r.catchKeys.some(k => hold.has(k)) || hold.has(fishVisibleCatchKey(r.signal)), [hold]);
  const multipleRuns = library.runs.length > 1;
  const options = anchors.map(a => ({ id: a.id, error: a.error, label: `${short(a.anchorMs)} 这一档 · ${a.error ? `出错${a.attempts > 1 ? `（已试 ${a.attempts} 次）` : ''}` : `扫到 ${a.found} · 新增 ${a.added}`}${multipleRuns ? ` · ${runText(runs.get(a.runId)!)}` : ''}` }));
  const match = useCallback((r: FishMiningRow, needle: string, anchorId: string) => {
    if (anchorId && !r.ids.some(id => anchorOf.get(anchorId)?.has(id))) return false;
    return !needle || r.signal.symbol.toUpperCase().includes(needle) || caught(r.signal).toUpperCase().includes(needle);
  }, [anchorOf]);
  const errors = library.anchors.filter(a => a.error).length, deleted = hold ? items.filter(r => !inHold(r)).length : 0;
  const latestRun = [...library.runs].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return <FishLibraryDialog name="挖掘库" roundLabel="档位" rounds={options} placeholder="搜索标的或命中算法…" onOpenChange={setOpen}
    description={`${items.length} 条信号 · ${library.anchors.length} 档${errors ? ` · ${errors} 档出错` : ''}${deleted ? ` · ${deleted} 条已从鱼舱删除` : ''}`}
    info={<><p>批量挖掘每扫一档（每 12 小时一档）记一次：扫到几条、新增几条、出错原因；挖到的每条信号保存当时的读数快照。</p><p>挖掘库独立于鱼舱：在鱼舱里删掉的鱼，这里仍保留并标出「已从鱼舱删除」。同一挖掘方案下同一信号只记一条。随账号保存。</p>{latestRun && <p className="text-muted-foreground">挖掘方案：{runText(latestRun)}；从 {short(latestRun.startMs)} 起</p>}</>}
    headers={['标的', '信号时间', '挖掘档位', '命中算法', '读数', '鱼舱', '入库时间']}
    items={items} match={match}
    empty={{ none: '暂无挖掘记录。开始批量挖掘后，每一档会自动保存。', unmatched: '没有匹配的挖掘记录。' }}
    row={r => {
      const held = inHold(r);
      return <tr key={r.id} className="border-t border-border/40 hover:bg-muted/20" data-testid="mining-library-row">
        <td className={`${libraryCell} font-mono`}><button type="button" className="hover:text-primary hover:underline disabled:cursor-default disabled:no-underline disabled:hover:text-inherit" disabled={!onJump || !!canJump && !canJump(r.signal)} onClick={() => onJump?.(r.signal)}>{r.signal.symbol}</button></td>
        <td className={`${libraryCell} font-mono text-muted-foreground`}>{date(r.signal.timeMs)}</td>
        <td className={`${libraryCell} font-mono text-muted-foreground`}>{short(r.anchorMs)}</td>
        <td className={`${libraryCell} max-w-64 truncate`} title={caught(r.signal)}>{caught(r.signal)}</td>
        <td className={`${libraryCell} font-mono tabular-nums`}>{reading(r.signal)}</td>
        <td className={`${libraryCell} ${held ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400'}`}>{held ? '在舱' : '已从鱼舱删除'}</td>
        <td className={`${libraryCell} font-mono text-muted-foreground`} title={date(r.firstSavedAt)}>{date(r.firstSavedAt).slice(5, 16)}</td>
      </tr>;
    }}/>;
}
