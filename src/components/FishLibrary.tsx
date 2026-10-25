import type {SignalScrollPosition} from './SignalLibraryList';
import {fishCaughtBy} from '@/lib/fish/records';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties } from 'react';
import { ChevronDown, Database, Search, Sparkles } from 'lucide-react';
// 筛选行与「渔」的输入同一套：浅底无框、圆角、统一 28px 高
const filterCls = 'h-7 w-full appearance-none rounded-md border border-transparent bg-muted/50 pl-2 pr-6 text-[11px] text-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring/60';
import { normalizeSignalQuality, signalMonthKey, sortSignalsBy, type SignalSortKey } from '@/lib/signalLibrary';
import { SignalLibraryHeader } from '@/components/SignalLibraryHeader';
import { SignalLibraryList } from '@/components/SignalLibraryList';

type SignalLibraryListProps = ComponentProps<typeof SignalLibraryList>;
interface Props extends Pick<SignalLibraryListProps, 'tradedDayIndex' | 'campaignDayIndex' | 'jumpingSignalId' | 'onJump' | 'onDelete' | 'onRate'> {
  signals: SignalLibraryListProps['rows'];
  rememberViewKey?: string;
  /** 列表名：「新鱼」或「鱼舱」。 */
  title?: string;
  testId?: string;
  defaultOpen?: boolean;
  emptyText?: string;
  /** 紧跟在上一个列表下面：不再画分隔线。 */
  bare?: boolean;
}
interface FishView { open?: boolean; algorithm?: string; query?: string; month?: string; sortKey?: SignalSortKey|'algorithm'; sortDir?: 'asc'|'desc'; scroll?: SignalScrollPosition; frozen?: {key:string;values:[string,number|null][]} }
const viewKey=(key:string)=>`veil.fish.view.v1:${key}`;
function readView(key?:string):FishView {
  try {
    const v=key?JSON.parse(sessionStorage.getItem(viewKey(key))??'{}'):{};
    if(!v||typeof v!=='object'||Array.isArray(v))return {};
    return {open:typeof v.open==='boolean'?v.open:undefined,algorithm:typeof v.algorithm==='string'?v.algorithm:'',query:typeof v.query==='string'?v.query:'',month:typeof v.month==='string'?v.month:'',
      sortKey:['time','symbol','quality','algorithm'].includes(v.sortKey)?v.sortKey:undefined,sortDir:['asc','desc'].includes(v.sortDir)?v.sortDir:undefined,
      scroll:v.scroll&&Number.isFinite(v.scroll.top)&&v.scroll.top>=0?{top:v.scroll.top,anchorId:typeof v.scroll.anchorId==='string'?v.scroll.anchorId:undefined,index:Number.isInteger(v.scroll.index)&&v.scroll.index>=0?v.scroll.index:undefined,offset:Number.isFinite(v.scroll.offset)?v.scroll.offset:0}:undefined,
      frozen:v.frozen&&typeof v.frozen.key==='string'&&Array.isArray(v.frozen.values)?{key:v.frozen.key,values:v.frozen.values.filter((x:unknown)=>Array.isArray(x)&&typeof x[0]==='string'&&(x[1]===null||Number.isFinite(x[1])))}:undefined};
  }catch{return {};}
}
/** The catch stays inside 渔. Use the same table, columns, sorting and rating behavior as 信号库. */
export const FishLibrary = memo(function FishLibrary(p: Props) {
  const title = p.title ?? '鱼舱';
  const testId = p.testId ?? 'fish-library';
  const [saved] = useState(()=>readView(p.rememberViewKey));
  const scroll = useRef<SignalScrollPosition>(saved.scroll??{top:0});
  const [open, setOpen] = useState(saved.open??!!p.defaultOpen);
  // 新一轮捕到鱼时自动展开（只在从无到有时，之后用户收起就不再抢）
  const hadRows = useRef(p.signals.length > 0);
  useEffect(() => { if (p.defaultOpen && !hadRows.current && p.signals.length > 0) setOpen(true); hadRows.current = p.signals.length > 0; }, [p.defaultOpen, p.signals.length]);
  const [algorithm,setAlgorithm]=useState(saved.algorithm??'');
  // 「算法类型」筛选：列出捕到过鱼的每个算法，选一个只看它捕到的（多算法的鱼只要含它就算）
  const algorithms=useMemo(()=>[...new Set(p.signals.flatMap(fishCaughtBy))].sort((a,b)=>a.localeCompare(b)),[p.signals]);
  // Measure all combinations, not just the virtualized viewport. Filtering keeps columns still.
  const algorithmLabels = useMemo(() => [...new Set(p.signals.map(s => fishCaughtBy(s).join(' · ')))], [p.signals]);
  const algorithmSizer = useRef<HTMLDivElement>(null);
  const [algorithmWidth, setAlgorithmWidth] = useState(160);
  useLayoutEffect(() => {
    const el = algorithmSizer.current;
    if (!el) return;
    const measure = () => setAlgorithmWidth(Math.max(160, ...Array.from(el.children, child => Math.ceil(child.getBoundingClientRect().width) + 16)));
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [algorithmLabels, open]);
  useEffect(()=>{if(algorithm&&!algorithms.includes(algorithm))setAlgorithm('');},[algorithm,algorithms]);
  const [query, setQuery] = useState(saved.query??'');
  const [month, setMonth] = useState(saved.month??'');
  // 【用户要求】2026-10-21「信号时间默认为时间越近越排在上面」
  const [sortKey, setSortKey] = useState<SignalSortKey | 'algorithm'>(saved.sortKey??'time');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(saved.sortDir??'desc');
  const resetKey = `${sortKey}|${sortDir}|${month}|${algorithm}|${query.trim().toUpperCase()}`;
  // As in 信号库, editing stars keeps the row still until the next explicit sort/filter.
  const [frozen, setFrozen] = useState<{ key: string; values: Map<string, number | null> }>({ key: saved.frozen?.key??'', values: new Map(saved.frozen?.values??[]) });
  const currentView = useRef<FishView>({});
  currentView.current = {open,algorithm,query,month,sortKey,sortDir,frozen:{key:frozen.key,values:[...frozen.values]}};
  const saveView=useCallback(()=>{if(p.rememberViewKey)try{sessionStorage.setItem(viewKey(p.rememberViewKey),JSON.stringify({...currentView.current,scroll:scroll.current}));}catch{/* View restoration never blocks navigation. */}},[p.rememberViewKey]);
  useEffect(()=>{saveView();return saveView;},[saveView,open,algorithm,query,month,sortKey,sortDir,frozen]);
  const onScrollPositionChange=useCallback((position:SignalScrollPosition)=>{scroll.current=position;saveView();},[saveView]);
  const onJump=useCallback((id:string)=>{saveView();p.onJump(id);},[p.onJump,saveView]);
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
    // 「算法类型」排序：按捕到它的算法名排，同名再按时间
    const sorted = sortKey === 'algorithm'
      ? [...basis].sort((a, b) => (fishCaughtBy(a).join(' · ').localeCompare(fishCaughtBy(b).join(' · ')) || a.timeMs - b.timeMs) * (sortDir === 'asc' ? 1 : -1))
      : sortSignalsBy(basis, sortKey, sortDir);
    return sorted.map(s => actual.get(s.id)!).filter(s => (!algorithm || fishCaughtBy(s).includes(algorithm)) && (!month || signalMonthKey(s.timeMs) === month) && (!q || s.symbol.toUpperCase().includes(q)));
  }, [p.signals, frozen, resetKey, query, month, sortKey, sortDir, algorithm]);
  const toggleSort = (key: SignalSortKey | 'algorithm') => {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'symbol' || key === 'algorithm' ? 'asc' : 'desc'); }
  };
  return <div className={'min-w-0'} data-testid={testId}>
    <button type="button" aria-expanded={open} aria-controls={`${testId}-panel`} onClick={() => setOpen(o => !o)} className="-ml-1.5 inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-left text-[11.5px] font-medium text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted">
      {p.title === '新鱼' ? <Sparkles className="h-3 w-3 text-primary/80" /> : <Database className="h-3 w-3 text-muted-foreground" />}<span>{title}</span>
      <span className={`min-w-[1.25rem] rounded px-1 text-center font-mono text-[10px] tabular-nums ${p.signals.length?'bg-primary/15 text-primary':'bg-muted text-muted-foreground'}`}>{p.signals.length}</span>
      <ChevronDown className={`h-3 w-3 text-muted-foreground/70 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div id={`${testId}-panel`} data-testid={`${testId}-panel`} className="mt-2">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="relative shrink-0"><select aria-label={`${title}的月份`} title="按月份定位信号（选中某个月会自动按时间旧→新排列）" className={`${filterCls} font-mono`} value={month} onChange={e => { setMonth(e.target.value); if (e.target.value) { setSortKey('time'); setSortDir('asc'); } }}>
          <option value="">全部月份（{p.signals.length}）</option>
          {months.map(([key, count]) => <option key={key} value={key}>{key}（{count}）</option>)}
        </select><ChevronDown aria-hidden className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" /></span>
        <span className="relative max-w-full shrink-0 sm:max-w-60"><select aria-label={`${title}的算法`} className={filterCls} value={algorithm} onChange={e=>setAlgorithm(e.target.value)}><option value="">全部算法类型</option>{algorithms.map(name=><option key={name} value={name}>{name}</option>)}</select><ChevronDown aria-hidden className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" /></span>
        <label className="relative flex min-w-[8rem] flex-1 items-center"><Search aria-hidden className="pointer-events-none absolute left-2 h-3 w-3 text-muted-foreground/60" /><input aria-label={`筛选${title}信号`} placeholder="筛选标的…" value={query} onChange={e => setQuery(e.target.value)} className="h-7 w-full rounded-md border border-transparent bg-muted/50 pl-6 pr-2 text-[11px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 hover:bg-muted focus-visible:border-ring/60 focus-visible:bg-background" /></label>

      </div>
      <div ref={algorithmSizer} aria-hidden className="pointer-events-none invisible absolute h-0 overflow-hidden font-mono text-[10px] leading-4">
        {algorithmLabels.map(label => <span key={label} className="block w-max whitespace-nowrap">{label}</span>)}
      </div>
      {rows.length ? <div className="min-w-0 overflow-x-auto rounded-lg border border-border/60"><div data-testid="fish-library-table" style={{ '--fish-algorithm-width': `${algorithmWidth}px`, minWidth: `calc(638px + var(--fish-algorithm-width))` } as CSSProperties}>
        <SignalLibraryHeader sortKey={sortKey === 'algorithm' ? undefined : sortKey} sortDir={sortDir} onSort={toggleSort} showProcess algorithmSort={{ active: sortKey === 'algorithm', onClick: () => toggleSort('algorithm') }} />
        <SignalLibraryList rows={rows} resetKey={`fish:${resetKey}`} tradedDayIndex={p.tradedDayIndex} campaignDayIndex={p.campaignDayIndex} jumpingSignalId={p.jumpingSignalId} onJump={onJump} restoreScroll={scroll.current} onScrollPositionChange={onScrollPositionChange} onDelete={p.onDelete} onRate={onRate} rowAlgorithmTypes={fishCaughtBy} nested showProcess confirmDelete />
      </div></div> : <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-[10.5px] text-muted-foreground">{p.signals.length ? '没有匹配的标的。' : p.emptyText ?? '暂无信号。'}</div>}
    </div>}
  </div>;
});
