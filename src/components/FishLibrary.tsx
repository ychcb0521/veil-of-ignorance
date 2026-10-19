import {fishAlgorithmShort,migrateFishSignal} from '@/lib/fish/records';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { ChevronDown, Database, Sparkles } from 'lucide-react';
import { normalizeSignalQuality, signalMonthKey, sortSignalsBy, type SignalSortKey } from '@/lib/signalLibrary';
import { fishSignalTitle } from '@/lib/fishSignals';
import { SignalLibraryHeader } from '@/components/SignalLibraryHeader';
import { SignalLibraryList } from '@/components/SignalLibraryList';

type SignalLibraryListProps = ComponentProps<typeof SignalLibraryList>;
interface Props extends Pick<SignalLibraryListProps, 'tradedDayIndex' | 'campaignDayIndex' | 'jumpingSignalId' | 'onJump' | 'onDelete' | 'onRate'> {
  signals: SignalLibraryListProps['rows'];
  /** 一条（id）或一批（ids）加入信号库。 */
  onAdd: (target?: string | readonly string[]) => void;
  /** 列表名：「新鱼」或「鱼」。 */
  title?: string;
  testId?: string;
  defaultOpen?: boolean;
  emptyText?: string;
  /** 紧跟在上一个列表下面：不再画分隔线。 */
  bare?: boolean;
}
/** The catch stays inside 渔. Use the same table, columns, sorting and rating behavior as 信号库. */
export const FishLibrary = memo(function FishLibrary(p: Props) {
  const title = p.title ?? '鱼';
  const testId = p.testId ?? 'fish-library';
  const [open, setOpen] = useState(!!p.defaultOpen);
  // 新一轮捕到鱼时自动展开（只在从无到有时，之后用户收起就不再抢）
  const hadRows = useRef(p.signals.length > 0);
  useEffect(() => { if (p.defaultOpen && !hadRows.current && p.signals.length > 0) setOpen(true); hadRows.current = p.signals.length > 0; }, [p.defaultOpen, p.signals.length]);
  const [algorithm,setAlgorithm]=useState('');
  const algorithms=useMemo(()=>[...new Map(p.signals.map(s=>{const m=migrateFishSignal(s),r=m.fish!;if(r.algorithms?.length)return [r.algorithmKey!,fishAlgorithmShort(m)] as const;return [r.algorithmKey!,`${r.featureShort}${r.statistic&&r.statistic!=='结果'?` [${r.statistic}]`:''} · ${r.H!==undefined?`avg ${r.H}h `:''}${r.direction} ${r.threshold}${r.constraints?.length?` · ${r.constraints.length}条约束`:''}`] as const;}))],[p.signals]);
  useEffect(()=>{if(algorithm&&!algorithms.some(([key])=>key===algorithm))setAlgorithm('');},[algorithm,algorithms]);
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState('');
  const [sortKey, setSortKey] = useState<SignalSortKey>('symbol');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const resetKey = `${sortKey}|${sortDir}|${month}|${algorithm}|${query.trim().toUpperCase()}`;
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
    return sortSignalsBy(basis, sortKey, sortDir).map(s => actual.get(s.id)!).filter(s => (!algorithm||migrateFishSignal(s).fish!.algorithmKey===algorithm) && (!month || signalMonthKey(s.timeMs) === month) && (!q || s.symbol.toUpperCase().includes(q)));
  }, [p.signals, frozen, resetKey, query, month, sortKey, sortDir, algorithm]);
  const toggleSort = (key: SignalSortKey) => {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'symbol' ? 'asc' : 'desc'); }
  };
  return <div className={'min-w-0'} data-testid={testId}>
    <button type="button" aria-expanded={open} aria-controls={`${testId}-panel`} onClick={() => setOpen(o => !o)} className="grid h-8 w-32 grid-cols-[0.75rem_1fr_auto_0.75rem] items-center gap-2 rounded-md px-2 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
      {p.title === '新鱼' ? <Sparkles className="h-3 w-3" /> : <Database className="h-3 w-3" />}<span>{title}</span>
      <span className="rounded bg-primary/15 px-1.5 font-mono text-[10px] text-primary">{p.signals.length}</span>
      <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div id={`${testId}-panel`} data-testid={`${testId}-panel`} className="mt-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <select aria-label={`${title}的月份`} title="按月份定位信号（选中某个月会自动按时间旧→新排列）" className="input-dark h-[22px] shrink-0 px-1.5 py-0.5 font-mono text-[11px]" value={month} onChange={e => { setMonth(e.target.value); if (e.target.value) { setSortKey('time'); setSortDir('asc'); } }}>
          <option value="">全部月份（{p.signals.length}）</option>
          {months.map(([key, count]) => <option key={key} value={key}>{key}（{count}）</option>)}
        </select>
        <select aria-label={`${title}的算法`} className="input-dark h-[22px] max-w-full sm:max-w-60 px-1.5 py-0.5 text-[11px] leading-4" value={algorithm} onChange={e=>setAlgorithm(e.target.value)}><option value="">全部算法</option>{algorithms.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
        <input aria-label={`筛选${title}信号`} placeholder="筛选标的…" value={query} onChange={e => setQuery(e.target.value)} className="input-dark min-w-[8rem] flex-1 px-1.5 py-0.5 text-[11px] leading-4" />

      </div>
      {rows.length ? <div className="min-w-0 overflow-x-auto rounded border border-border/60"><div className="min-w-[44rem]">
        <SignalLibraryHeader sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
        <SignalLibraryList rows={rows} resetKey={`fish:${resetKey}`} tradedDayIndex={p.tradedDayIndex} campaignDayIndex={p.campaignDayIndex} jumpingSignalId={p.jumpingSignalId} onJump={p.onJump} onDelete={p.onDelete} onRate={onRate} onAdd={p.onAdd} rowTitle={fishSignalTitle} rowAlgorithm={fishAlgorithmShort} nested />
      </div></div> : <div className="rounded border border-dashed border-border/60 px-3 py-4 text-center text-[10px] text-muted-foreground">{p.signals.length ? '没有匹配的标的。' : p.emptyText ?? '暂无信号。'}</div>}
    </div>}
  </div>;
});
