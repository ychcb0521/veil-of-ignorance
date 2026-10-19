import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { ChevronDown, Database } from 'lucide-react';
import { normalizeSignalQuality, signalMonthKey, sortSignalsBy, type SignalSortKey } from '@/lib/signalLibrary';
import { fishSignalTitle } from '@/lib/fishSignals';
import { SignalLibraryHeader } from '@/components/SignalLibraryHeader';
import { SignalLibraryList } from '@/components/SignalLibraryList';

type SignalLibraryListProps = ComponentProps<typeof SignalLibraryList>;
interface Props extends Pick<SignalLibraryListProps, 'tradedDayIndex' | 'campaignDayIndex' | 'jumpingSignalId' | 'onJump' | 'onDelete' | 'onRate'> {
  signals: SignalLibraryListProps['rows']; onAdd: (id?: string) => void;
}
/** The catch stays inside 渔. Use the same table, columns, sorting and rating behavior as 信号库. */
export const FishLibrary = memo(function FishLibrary(p: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState('');
  const [sortKey, setSortKey] = useState<SignalSortKey>('symbol');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const resetKey = `${sortKey}|${sortDir}|${month}|${query.trim().toUpperCase()}`;
  // As in 信号库, editing stars keeps the row still until the next explicit sort/filter.
  const [frozen, setFrozen] = useState<{ key: string; values: Map<string, number | null> }>({ key: '', values: new Map() });
  const latest = useRef({ signals: p.signals, resetKey, onRate: p.onRate });
  latest.current = { signals: p.signals, resetKey, onRate: p.onRate };
  useEffect(() => { if (frozen.key !== resetKey && frozen.values.size) setFrozen({ key: resetKey, values: new Map() }); }, [frozen, resetKey]);
  const onRate = useCallback((id: string, value: number) => {
    const current = latest.current;
    const previous = normalizeSignalQuality(current.signals.find(s => s.id === id)?.quality) ?? null;
    setFrozen(f => {
      const values = f.key === current.resetKey ? f.values : new Map<string, number | null>();
      return values.has(id) ? f : { key: current.resetKey, values: new Map(values).set(id, previous) };
    });
    current.onRate(id, value);
  }, []);
  const months = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of p.signals) { const key = signalMonthKey(s.timeMs); counts.set(key, (counts.get(key) ?? 0) + 1); }
    return [...counts].sort(([a], [b]) => b.localeCompare(a));
  }, [p.signals]);
  useEffect(() => { if (month && !months.some(([key]) => key === month)) setMonth(''); }, [month, months]);
  const rows = useMemo(() => {
    const actual = new Map(p.signals.map(s => [s.id, s]));
    const basis = frozen.key === resetKey ? p.signals.map(s => frozen.values.has(s.id) ? { ...s, quality: frozen.values.get(s.id) ?? undefined } : s) : p.signals;
    const q = query.trim().toUpperCase();
    return sortSignalsBy(basis, sortKey, sortDir).map(s => actual.get(s.id)!).filter(s => (!month || signalMonthKey(s.timeMs) === month) && (!q || s.symbol.toUpperCase().includes(q)));
  }, [p.signals, frozen, resetKey, query, month, sortKey, sortDir]);
  const toggleSort = (key: SignalSortKey) => {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'symbol' ? 'asc' : 'desc'); }
  };
  return <div className="border-t border-border/50 pt-2">
    <button type="button" aria-expanded={open} aria-controls="fish-library" onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 rounded border border-border/60 bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
      <Database className="h-3 w-3" /><span>鱼</span>
      <span className="rounded bg-primary/15 px-1.5 font-mono text-[10px] text-primary">{p.signals.length}</span>
      <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div id="fish-library" data-testid="fish-library-panel" className="mt-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <select aria-label="鱼的月份" title="按月份定位信号（选中某个月会自动按时间旧→新排列）" className="input-dark h-[22px] shrink-0 px-1.5 py-0.5 font-mono text-[11px]" value={month} onChange={e => { setMonth(e.target.value); if (e.target.value) { setSortKey('time'); setSortDir('asc'); } }}>
          <option value="">全部月份（{p.signals.length}）</option>
          {months.map(([key, count]) => <option key={key} value={key}>{key}（{count}）</option>)}
        </select>
        <input aria-label="筛选鱼信号" placeholder="筛选标的…" value={query} onChange={e => setQuery(e.target.value)} className="input-dark min-w-[7rem] flex-1 px-1.5 py-0.5 text-[11px] leading-4" />
        <button type="button" disabled={!p.signals.length} onClick={() => p.onAdd()} className="rounded border border-border/60 px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-40">全部加入信号库</button>
      </div>
      {rows.length ? <div className="overflow-x-auto rounded border border-border/60"><div className="min-w-[680px]">
        <SignalLibraryHeader sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
        <SignalLibraryList rows={rows} resetKey={`fish:${resetKey}`} tradedDayIndex={p.tradedDayIndex} campaignDayIndex={p.campaignDayIndex} jumpingSignalId={p.jumpingSignalId} onJump={p.onJump} onDelete={p.onDelete} onRate={onRate} onAdd={p.onAdd} rowTitle={fishSignalTitle} />
      </div></div> : <div className="rounded border border-dashed border-border/60 px-3 py-4 text-center text-[10px] text-muted-foreground">{p.signals.length ? '没有匹配的标的。' : '暂无信号，开始捕捞后会自动保存到「鱼」。'}</div>}
    </div>}
  </div>;
});
