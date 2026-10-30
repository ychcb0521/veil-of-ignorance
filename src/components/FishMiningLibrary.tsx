import {useFishBulkDelete} from './FishBulkDeletion';
import { miningLibraryConditions, libraryConditionSearch } from '@/lib/fish/libraryConditions';
import { FishLibraryCondition, libraryReading } from '@/components/FishLibraryConditions';
/** 挖掘库：批量挖掘每一档的扫描与挖到的信号（数据见 lib/fish/miningLibrary，存 IndexedDB 并随账号同步）。 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FishLibraryDialog, libraryCell } from '@/components/FishLibraryDialog';
import { emptyMiningLibrary, type FishMiningLibrary, type FishMiningRecord, type FishMiningRun } from '@/lib/fish/miningLibrary';
import { loadMiningLibrary, MINING_LIBRARY_EVENT } from '@/lib/fish/miningLibraryStore';
import { fishVisibleCatchKey } from '@/lib/fish/records';
import { formatUTC8 } from '@/lib/timeFormat';
import type { TradeSignal } from '@/lib/signalLibrary';

const date = (t: number | null | undefined) => t == null ? '—' : formatUTC8(t);
const short = (t: number) => formatUTC8(t).slice(0, 16);
const RULE_NAMES: Record<string, string> = { cbi2: 'CBI-2', state: 'S', cba: 'CBA', 'drift-speed': 'DSP·a', 'drift-speed-z': 'az', bss: 'BSS' };
const runText = (run: FishMiningRun) => run.rules.map(r => `${RULE_NAMES[r.featureId] ?? r.featureId} · ${r.statistic} > ${r.threshold}`).join(run.combination === 'and' ? ' ∩ ' : ' ∪ ');
/** 实际捕到这条信号的探测算法（并集只列命中的，交集列全部）。 */

type FishMiningRow = FishMiningRecord & { ids: string[]; catchKeys: string[] };


export function FishMiningLibrary({ account, holdKeys, onJump, canJump }: { account?: string; holdKeys?: () => ReadonlySet<string>; onJump?: (s: TradeSignal) => void; canJump?: (s: TradeSignal) => boolean }) {
  const bulk=useFishBulkDelete(),[selected,setSelected]=useState<Set<string>>(()=>new Set());
  const [library, setLibrary] = useState<FishMiningLibrary>(emptyMiningLibrary), [open, setOpen] = useState(false);
  const reload = useCallback(() => { void loadMiningLibrary(account).then(setLibrary); }, [account]);
  // 打开时读；开着的时候挖到新的一档就刷新
  useEffect(() => {
    if (!open) return;
    reload();
    const refresh = (e: Event) => { if (((e as CustomEvent).detail?.owner ?? null) === (account ?? null)) reload(); };
    window.addEventListener(MINING_LIBRARY_EVENT, refresh);
    return () => window.removeEventListener(MINING_LIBRARY_EVENT, refresh);
  }, [open, reload, account]);
  const runs = useMemo(() => new Map(library.runs.map(r => [r.id, r])), [library.runs]);
  const evidence=useMemo(()=>new Map(library.records.map(r=>[r.id,miningLibraryConditions(r,runs.get(r.runId))])),[library.records,runs]);
  const anchors = useMemo(() => [...library.anchors].sort((a, b) => b.anchorMs - a.anchorMs || b.scannedAt - a.scannedAt), [library.anchors]);
  const anchorOf = useMemo(() => new Map(library.anchors.map(a => [a.id, new Set(a.recordIds)])), [library.anchors]);
  // 【用户要求】2026-10-27「命中算法只显示探测算法（被哪个算法捕捉到的）」：只列实际命中的算法（并集看命中编号）。
  // 同一档里标的、信号时间、完整命中条件都一样的记录（算法编号修过别名前后各存了一份）显示时合并为一行，保留最新那份。
  const items = useMemo(() => {
    const rows = new Map<string, FishMiningRow>();
    for (const record of library.records) {
      const key = `${record.anchorMs}|${fishVisibleCatchKey(record.signal)}|${evidence.get(record.id)!.identity}`, prior = rows.get(key);
      if (!prior) rows.set(key, { ...record, ids: [record.id], catchKeys: [record.catchKey] });
      else rows.set(key, { ...(prior.updatedAt >= record.updatedAt ? prior : record), ids: [...prior.ids, record.id], catchKeys: [...prior.catchKeys, record.catchKey] });
    }
    return [...rows.values()].sort((a, b) => b.anchorMs - a.anchorMs || b.signal.timeMs - a.signal.timeMs || a.signal.symbol.localeCompare(b.signal.symbol));
  }, [library.records,evidence]);
  const multipleRuns = library.runs.length > 1;
  const options = anchors.map(a => ({ id: a.id, error: a.error, label: `${short(a.anchorMs)} 这一档 · ${a.error ? `出错${a.attempts > 1 ? `（已试 ${a.attempts} 次）` : ''}` : `扫到 ${a.found} · 新增 ${a.added}`}${multipleRuns ? ` · ${runText(runs.get(a.runId)!)}` : ''}` }));
  const match = useCallback((r: FishMiningRow, needle: string, anchorId: string) => {
    if (anchorId && !r.ids.some(id => anchorOf.get(anchorId)?.has(id))) return false;
    return !needle || r.signal.symbol.toUpperCase().includes(needle) || evidence.get(r.id)!.conditions.some(c=>libraryConditionSearch(c).toUpperCase().includes(needle));
  }, [anchorOf,evidence]);
  const errors = library.anchors.filter(a => a.error).length;
  const latestRun = [...library.runs].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return <FishLibraryDialog name="挖掘库" roundLabel="档位" rounds={options} placeholder="搜索标的、具体指标或门槛…" onOpenChange={setOpen}
    description={`${items.length} 条信号 · ${library.anchors.length} 档${errors ? ` · ${errors} 档出错` : ''}`}
    info={<><p>批量挖掘每扫一档（每 12 小时一档）记一次：扫到几条、新增几条、出错原因；挖到的每条信号保存当时的读数快照。命中算法逐条显示具体序列、方向、门槛、周期与历史公式版本，可展开核对公式和参数。</p><p>挖掘库、鱼舱和信号库独立并行，均可进入过滤库与监测库。删除一个来源不影响另两个库；同标的、同信号和入场时刻的下游结果合并显示，仍有其他来源时保留。相同档位、信号及完整算法条件的重复记录合并显示；不同门槛或公式版本分别保留。随账号保存。</p>{latestRun && <p className="text-muted-foreground">挖掘方案：{runText(latestRun)}；从 {short(latestRun.startMs)} 起</p>}</>}
    headers={['标的', '信号时间', '挖掘档位', '命中算法', '读数', '入库时间']}
    items={items} match={match} selection={bulk?{key:r=>r.id,selected:new Set(items.filter(r=>selected.has(r.id)).map(r=>r.id)),toggle:()=>{},select:ids=>setSelected(s=>new Set([...s,...ids])),clear:()=>setSelected(new Set()),remove:()=>{const picked=items.filter(r=>selected.has(r.id));bulk({kind:'mining',ids:picked.flatMap(r=>r.ids),targets:picked.map(r=>({source:r.signal,entry:r.anchorMs}))});}}:undefined}
    empty={{ none: '暂无挖掘记录。开始批量挖掘后，每一档会自动保存。', unmatched: '没有匹配的挖掘记录。' }}
    row={r => {
      const saved=evidence.get(r.id)!;
      return <tr key={r.id} className="border-t border-border/40 hover:bg-muted/20" data-testid="mining-library-row">
        {bulk&&<td className={libraryCell}><input type="checkbox" aria-label={`选择挖掘记录 ${r.signal.symbol} ${r.id}`} checked={selected.has(r.id)} onChange={()=>setSelected(s=>{const n=new Set(s);if(n.has(r.id))n.delete(r.id);else n.add(r.id);return n;})}/></td>}
        <td className={`${libraryCell} font-mono`}><button type="button" className="hover:text-primary hover:underline disabled:cursor-default disabled:no-underline disabled:hover:text-inherit" disabled={!onJump || !!canJump && !canJump(r.signal)} onClick={() => onJump?.(r.signal)}>{r.signal.symbol}</button></td>
        <td className={`${libraryCell} font-mono text-muted-foreground`}>{date(r.signal.timeMs)}</td>
        <td className={`${libraryCell} font-mono text-muted-foreground`}>{short(r.anchorMs)}</td>
        <td className={`${libraryCell} min-w-[320px] max-w-[440px] align-top`}><p className="mb-1 text-[9px] text-muted-foreground">{saved.combination}</p><div className="space-y-1.5">{saved.conditions.map((c,i)=><FishLibraryCondition key={i} condition={c}/>)}</div>{saved.note&&<p className="mt-1 whitespace-normal text-[10px] text-muted-foreground">{saved.note}</p>}</td>
        <td className={`${libraryCell} min-w-[180px] align-top font-mono tabular-nums`}><p className="mb-1 font-sans text-[9px] text-muted-foreground">与左侧算法逐项对应</p><div className="space-y-1.5">{saved.conditions.map((c,i)=><div key={i} className="min-h-9"><p className="text-foreground">{c.metric} = {libraryReading(c.reading)}</p>{c.rawReading!==undefined&&c.reading===undefined?<p className="text-[9px] text-muted-foreground">原值 {libraryReading(c.rawReading)} · 显示倍率未记录</p>:<p className="text-[9px] text-muted-foreground">{c.snapshot.scale===1?'原值':`原值 × ${c.snapshot.scale??'未知'}`}</p>}</div>)}</div></td>
        <td className={`${libraryCell} font-mono text-muted-foreground`} title={date(r.firstSavedAt)}>{date(r.firstSavedAt).slice(5, 16)}</td>
      </tr>;
    }}/>;
}
