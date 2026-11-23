import { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { formatUTC8 } from '@/lib/timeFormat';
import { newQualityStudy, qualityEntryIdentity, qualityRunSamples, type FishQualityStudy, type QualityGroup, type QualityProgress, type QualityRunOptions } from '@/lib/fish/quality';
import { qualityAdditionFills } from '@/lib/fish/qualityAddition';
import { qualityAdditionStopOrder } from '@/lib/fish/qualityAdditionStopOrder';
import { DEFAULT_SIGNAL_ADDITION_COUNT, validSignalAdditionCount } from '@/lib/fish/parallelUniverse';
import { loadParallelSettings, loadRegretDirectory, loadRegretHistory, saveParallelAttempt, saveParallelSettings, type RegretCandidate } from '@/lib/fish/parallelUniverseStore';
import { FishQualityModule, qualitySettingsAction, qualitySplitPrimaryAction } from './FishQualityModule';

const date = (at?: number | null) => at ? formatUTC8(at) : '—';
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

function RegretBrowser({ owner }: { owner?: string }) {
  const [candidate, selectCandidate] = useState<RegretCandidate>();
  return candidate ? <>
    <button type="button" className={qualitySettingsAction} onClick={() => selectCandidate(undefined)}>返回目录</button>
    <h3>{candidate.symbol} · {date(candidate.entryTime)}</h3>
    {candidate.signal && <p>平行宇宙 · 第 {candidate.signal.additionCount} 次加仓 · {date(candidate.signal.time)} · 买入 {candidate.signal.buyPrice} · 委托止损 {candidate.signal.stopPrice}</p>}
    <RegretPage key={candidate.id} read={before => loadRegretHistory(owner, candidate.id, before)} empty="暂无推演记录" render={attempt =>
      <details key={attempt.id} className="border-b border-border/50 py-2">
        <summary>{date(attempt.baseline.evaluatedAt)} · {attempt.plan.label} · N={attempt.additionCount} · {attempt.emitted ? '已生成信号' : attempt.proposedSignal ? '候选已有信号' : '未生成信号'}</summary>
        <p>镜像前终止标记：{attempt.marker ? `${attempt.marker.cause?.label} · ${date(attempt.marker.observedAt)} · ${attempt.baseline.reason}` : '未触发'}</p>
        <p>模拟状态：{attempt.simulation.reason} · {date(attempt.simulation.endTime)}</p>
        <ol className="list-decimal pl-5">
          {qualityAdditionFills(attempt.simulation).map((fill, index) => <li key={index}>
            {date(fill.at)} · {fill.label} · 加仓价 {fill.price} · 委托止损 {qualityAdditionStopOrder({ quality_addition_fill: fill })?.price ?? '未记录'} · 读数 {fill.reading} {fill.direction} {fill.threshold}
          </li>)}
        </ol>
      </details>}/>
  </> : <RegretPage read={before => loadRegretDirectory(owner, before)} empty="暂无候选"
    render={item => <button type="button" key={item.id} className="block w-full border-b border-border/50 py-2 text-left" onClick={() => selectCandidate(item)}>
      {item.symbol} · {date(item.entryTime)} · {item.signal ? '已生成信号' : '未生成信号'}
    </button>}/>;
}

function RegretPage<T>({ read, render, empty }: {
  read: (before?: IDBValidKey) => Promise<{ rows: T[]; next?: IDBValidKey }>;
  render: (row: T) => React.ReactNode;
  empty: string;
}) {
  const [rows, setRows] = useState<T[]>([]), [next, setNext] = useState<IDBValidKey>();
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [revision, retry] = useState(0);
  const readRef = useRef(read);
  readRef.current = read;
  const cursor = useRef<IDBValidKey>(undefined);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void readRef.current(cursor.current).then(page => {
      if (!active) return;
      setRows(previous => [...previous, ...page.rows]);
      setNext(page.next);
    }, cause => { if (active) setError(errorText(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  const more = () => { cursor.current = next; retry(value => value + 1); };
  return <div className="max-h-[55vh] overflow-y-auto text-sm" onScroll={event => {
    const list = event.currentTarget;
    if (!loading && !error && next && list.scrollHeight - list.clientHeight - list.scrollTop < 120) more();
  }}>
    {rows.map(render)}
    {loading ? <p role="status">读取中…</p> : error ? <p role="alert">{error} <button type="button" onClick={() => retry(value => value + 1)}>重试</button></p>
      : next ? <button type="button" className={qualitySettingsAction} onClick={more}>继续读取</button> : !rows.length ? <p>{empty}</p> : null}
  </div>;
}

export function FishParallelUniverse({ owner, study, plans, selectedIds, run }: {
  owner?: string;
  study: FishQualityStudy;
  plans: QualityGroup[];
  selectedIds: string[];
  run: (options: QualityRunOptions) => Promise<void>;
}) {
  const [planId, setPlanId] = useState('');
  const [count, setCount] = useState(String(DEFAULT_SIGNAL_ADDITION_COUNT));
  const [hours, setHours] = useState(String(study.observeHours));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [running, setRunning] = useState(false), [error, setError] = useState('');
  const [progress, setProgress] = useState<QualityProgress>();
  const controller = useRef<AbortController>(null);
  useEffect(() => {
    let active = true;
    void loadParallelSettings(owner).then(settings => {
      if (!active) return;
      if (settings) {
        setPlanId(settings.planId);
        setCount(String(settings.additionCount));
        setHours(String(settings.observeHours));
      }
    }, cause => { if (active) setError(errorText(cause)); }).finally(() => { if (active) setSettingsReady(true); });
    return () => { active = false; controller.current?.abort(); };
  }, [owner]);

  const plan = plans.find(item => item.id === planId) ?? (!planId ? plans[0] : undefined);
  const settings = () => {
    const additionCount = Number(count), observeHours = Number(hours);
    if (!plan) throw Error('请选择持仓监测方案');
    if (!validSignalAdditionCount(additionCount) || hours === '' || !Number.isFinite(observeHours) || observeHours < 0 || observeHours > 8784) {
      throw Error('加仓次数须为正整数，观察时长须在 0～8784 小时之间');
    }
    return { planId: plan.id, additionCount, observeHours };
  };
  const saveSettings = async () => {
    try {
      await saveParallelSettings(owner, settings());
      setError('');
      setSettingsOpen(false);
    } catch (cause) { setError(errorText(cause)); }
  };
  const start = async () => {
    if (!plan || controller.current || !selectedIds.length) return;
    const selected = qualityRunSamples({ ...study, selectedRowIds: selectedIds }).filter(row => !row.binanceEntry);
    if (!selected.length) { setError('当前范围没有已勾选的模拟候选'); return; }
    const identities = new Set(selected.map(row => qualityEntryIdentity(row.source, row.enteredAt)));
    const samples = study.samples.filter(row => !row.binanceEntry && identities.has(qualityEntryIdentity(row.source, row.enteredAt)));
    const aborter = new AbortController();
    controller.current = aborter;
    setRunning(true);
    setError('');
    setProgress({ done: 0, total: selected.length, current: '' });
    try {
      const runSettings = settings();
      const { additionCount, observeHours } = runSettings;
      await saveParallelSettings(owner, runSettings);
      aborter.signal.throwIfAborted();
      await run({
        study: { ...newQualityStudy(), samples, selectedRowIds: selected.map(row => row.id),
          sellPlans: [structuredClone(plan)], observeHours, independentFilters: true },
        task: 'monitor', mode: 'restart', signal: aborter.signal,
        onProgress: setProgress, onResult: () => {},
        parallelUniverse: { additionCount, onAttempt: attempt => saveParallelAttempt(owner, attempt) },
      });
    } catch (cause) {
      if (!aborter.signal.aborted) setError(errorText(cause));
    } finally {
      controller.current = null;
      setRunning(false);
    }
  };

  return <FishQualityModule level="submodule" title="平行宇宙" icon={Activity} testId="quality-parallel-controls"
    status={error && !settingsOpen ? <span role="alert">{error}</span> : progress && <span role="status">{progress.done}/{progress.total} {running ? progress.current : ''}</span>}>
    <button type="button" className={qualitySplitPrimaryAction} disabled={!settingsReady || !plan || !selectedIds.length || running} onClick={() => void start()}>开始推演</button>
    {running && <button type="button" className={qualitySettingsAction} onClick={() => controller.current?.abort()}>停止推演</button>}
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogTrigger asChild><button type="button" className={qualitySettingsAction} disabled={!settingsReady || running} onClick={() => setError('')}>推演设置</button></DialogTrigger>
      <DialogContent aria-describedby={undefined}><DialogHeader><DialogTitle>平行宇宙推演设置</DialogTitle></DialogHeader>
        <label className="flex flex-col gap-1">持仓监测方案
          <select className="rounded border bg-background p-2" value={plan?.id ?? ''} onChange={event => setPlanId(event.target.value)}>
            {!plan && <option value="">请选择可用方案</option>}
            {plans.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">信号触发加仓次数 N
          <input className="rounded border bg-background p-2" type="number" min={1} step={1} value={count} onChange={event => setCount(event.target.value)}/>
        </label>
        <label className="flex flex-col gap-1">观察时长（小时，0 为持续至模拟退出）
          <input className="rounded border bg-background p-2" type="number" min={0} max={8784} step="any" value={hours} onChange={event => setHours(event.target.value)}/>
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="button" className={qualitySettingsAction} onClick={() => void saveSettings()}>保存推演设置</button>
      </DialogContent>
    </Dialog>
    <Dialog>
      <DialogTrigger asChild><button type="button" className={qualitySettingsAction}>后悔库</button></DialogTrigger>
      <DialogContent aria-describedby={undefined}><DialogHeader><DialogTitle>后悔库</DialogTitle></DialogHeader><RegretBrowser owner={owner}/></DialogContent>
    </Dialog>
  </FishQualityModule>;
}
