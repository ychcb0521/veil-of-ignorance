import { HoldingMonitorSettings } from './FishHoldingMonitorSettings';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { useEffect, useRef, useState } from 'react';
import { Activity, ChevronDown, Database, Filter, Pause, RotateCcw, Settings2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { formatUTC8 } from '@/lib/timeFormat';
import { newQualityStudy, qualityEntryIdentity, qualityRunSamples, type FishQualityStudy, type QualityGroup, type QualityProgress, type QualityRunOptions } from '@/lib/fish/quality';
import { qualityAdditionFills } from '@/lib/fish/qualityAddition';
import { qualityAdditionStopOrder } from '@/lib/fish/qualityAdditionStopOrder';
import { DEFAULT_SIGNAL_ADDITION_COUNT, validSignalAdditionCount } from '@/lib/fish/parallelUniverse';
import { loadParallelSettings, loadRegretDirectory, loadRegretHistory, saveParallelAttempt, saveParallelSettings, type RegretCandidate } from '@/lib/fish/parallelUniverseStore';
import { FishQualityInfo, FishQualityModule, qualitySettingsAction, qualitySplitMenuAction, qualitySplitPauseAction, qualitySplitPrimaryAction } from './FishQualityModule';
import { FishConditionDialogContent, FishConditionSettings } from './FishConditionSettings';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { FishPopoverContent as PopoverContent } from './FishPopoverContent';
import { FishQualityProgress } from './FishQualityProgress';
import { libraryDirectoryAction } from './FishLibraryTimeDirectory';

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

export function FishParallelUniverse({ owner, study, plans, selectedIds, run, state }: {
  state?: FishQualityState;
  owner?: string;
  study: FishQualityStudy;
  plans: QualityGroup[];
  selectedIds: string[];
  run: (options: QualityRunOptions) => Promise<void>;
}) {
  const [simulationPlans, setSimulationPlans] = useState<QualityGroup[] | undefined>();
  const availablePlans = simulationPlans ?? plans;
  const [planId, setPlanId] = useState('');
  const [count, setCount] = useState(String(DEFAULT_SIGNAL_ADDITION_COUNT));
  const [hours, setHours] = useState(String(study.observeHours));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [running, setRunning] = useState(false), [error, setError] = useState('');
  const [progress, setProgress] = useState<QualityProgress>();
  const controller = useRef<AbortController>(null);
  useEffect(() => {
    let active = true;
    void loadParallelSettings(owner).then(settings => {
      if (!active) return;
      if (settings) {
        setSimulationPlans(settings.plans);
        setPlanId(settings.planId);
        setCount(String(settings.additionCount));
        setHours(String(settings.observeHours));
      }
    }, cause => { if (active) setError(errorText(cause)); }).finally(() => { if (active) setSettingsReady(true); });
    return () => { active = false; restart.current = undefined; controller.current?.abort(); };
  }, [owner]);

  const plan = availablePlans.find(item => item.id === planId) ?? (!planId ? availablePlans[0] : undefined);
  const settings = () => {
    const additionCount = Number(count), observeHours = Number(hours);
    if (!plan) throw Error('请选择持仓监测方案');
    if (!validSignalAdditionCount(additionCount) || hours === '' || !Number.isFinite(observeHours) || observeHours < 0 || observeHours > 8784) {
      throw Error('加仓次数须为正整数，观察时长须在 0～8784 小时之间');
    }
    return { planId: plan.id, additionCount, observeHours, plans: simulationPlans };
  };
  const saveSettings = async () => {
    try {
      await saveParallelSettings(owner, settings());
      setError('');
      setSettingsOpen(false);
    } catch (cause) { setError(errorText(cause)); }
  };
  const canStart = settingsReady && !!plan && selectedIds.length > 0;
  const prepare = () => {
    const selected = qualityRunSamples({ ...study, selectedRowIds: selectedIds }).filter(row => !row.binanceEntry);
    if (!selected.length) throw Error('当前范围没有已勾选的模拟候选');
    const identities = new Set(selected.map(row => qualityEntryIdentity(row.source, row.enteredAt)));
    const samples = study.samples.filter(row => !row.binanceEntry && identities.has(qualityEntryIdentity(row.source, row.enteredAt)));
    const conditions = settings();
    return {
      conditions,
      study: { ...newQualityStudy(), samples: structuredClone(samples), selectedRowIds: selected.map(row => row.id),
        sellPlans: [structuredClone(plan!)], observeHours: conditions.observeHours, independentFilters: true } satisfies FishQualityStudy,
      completed: new Set<string>(),
      needsSave: true,
    };
  };
  type Batch = ReturnType<typeof prepare>;
  const paused = useRef<Batch>();
  const restart = useRef<Batch>();
  const execute = async (first: Batch) => {
    if (controller.current) return;
    setRunning(true);
    for (let next: Batch | undefined = first; next; next = restart.current) {
      const batch = next;
      restart.current = undefined;
      paused.current = batch;
      const aborter = new AbortController();
      controller.current = aborter;
      const ids = batch.study.selectedRowIds;
      const offset = batch.completed.size;
      setError('');
      setProgress({ done: offset, total: ids.length, current: '' });
      try {
        if (batch.needsSave) {
          await saveParallelSettings(owner, batch.conditions);
          batch.needsSave = false;
        }
        aborter.signal.throwIfAborted();
        await run({
          study: { ...batch.study, selectedRowIds: ids.filter(id => !batch.completed.has(id)) },
          task: 'monitor', mode: 'restart', signal: aborter.signal,
          onProgress: next => setProgress({ ...next, done: offset + next.done, total: ids.length }),
          onResult: () => {},
          parallelUniverse: { additionCount: batch.conditions.additionCount, onAttempt: async attempt => {
            await saveParallelAttempt(owner, attempt);
            batch.completed.add(attempt.candidate.signalId ?? attempt.candidate.id);
          } },
        });
        if (!aborter.signal.aborted || batch.completed.size === ids.length) paused.current = undefined;
      } catch (cause) {
        if (!aborter.signal.aborted) setError(errorText(cause));
        if (batch.completed.size === ids.length) paused.current = undefined;
      }
    }
    controller.current = null;
    setRunning(false);
  };
  const start = (fromBeginning = false) => {
    try {
      const batch = !fromBeginning && paused.current ? paused.current : prepare();
      if (controller.current) {
        if (fromBeginning) {
          restart.current = batch;
          controller.current.abort();
        }
        return;
      }
      void execute(batch);
    } catch (cause) { setError(errorText(cause)); }
  };
  return <FishQualityModule level="submodule" title="平行宇宙" icon={Activity} testId="quality-parallel-controls"
    summary={<FishQualityInfo label="平行宇宙说明"><p>用持仓监测方案推演已勾选的候选。镜像前终止只记标记，达到设置的第 N 次加仓后，将信号和触发依据记入后悔库。</p><p>暂停后继续会沿用本轮的候选和条件。所有操作均为模拟。</p></FishQualityInfo>}
    status={error && !settingsOpen ? <span role="alert">{error}</span> : !running && paused.current && <span>已暂停</span>}
    progress={progress && <FishQualityProgress label={running ? '推演进行中' : paused.current ? '推演已暂停' : '推演结束'}
      progressLabel="平行宇宙推演进度" done={progress.done} total={progress.total} waitingUntil={running ? progress.waitingUntil : undefined}/>}>
    <div role="group" aria-label="平行宇宙运行" className="inline-flex h-6 shrink-0 items-stretch">
      {running ? <button type="button" className={qualitySplitPauseAction} onClick={() => controller.current?.abort()}>
        <Pause aria-hidden className="h-3 w-3"/>暂停推演
      </button> : <button type="button" className={qualitySplitPrimaryAction} disabled={!paused.current && !canStart}
        title={paused.current ? '沿用本轮冻结的候选和条件' : '按反事实法设置推演当前已勾选的候选'}
        onClick={() => start()}>
        <Filter aria-hidden className="h-3 w-3"/>{paused.current ? '继续推演' : '开始推演'}
      </button>}
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild><button type="button" aria-label="开始推演的其他方式" disabled={!canStart}
          className={`${qualitySplitMenuAction} ${running ? 'border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground' : 'border-primary/25 bg-primary/10 text-primary hover:border-primary/45 hover:bg-primary/20'}`}>
          <ChevronDown aria-hidden className="h-3 w-3"/>
        </button></PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1">
          <button type="button" disabled={!canStart} className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-muted disabled:opacity-40"
            onClick={() => { setMenuOpen(false); start(true); }}>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium"><RotateCcw aria-hidden className="h-3 w-3"/>从头重新推演</span>
            <span className="text-[10px] leading-relaxed text-muted-foreground">按当前勾选和条件重新计算，保留后悔库中的历史记录。</span>
          </button>
        </PopoverContent>
      </Popover>
    </div>
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogTrigger asChild><button type="button" className={qualitySettingsAction} aria-label="反事实法" disabled={!settingsReady || running} onClick={() => setError('')}><Settings2 aria-hidden className="h-3 w-3"/>反事实法</button></DialogTrigger>
      <FishConditionDialogContent><FishConditionSettings dialog title="反事实法" description="设置模拟方案、触发加仓次数和观察时长。">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">信号触发加仓次数 N
            <input className="rounded border bg-background p-2" type="number" min={1} step={1} value={count} onChange={event => setCount(event.target.value)}/>
          </label>
          <label className="flex flex-col gap-1">观察时长（小时，0 为持续至模拟退出）
            <input className="rounded border bg-background p-2" type="number" min={0} max={8784} step="any" value={hours} onChange={event => setHours(event.target.value)}/>
          </label>
        </div>
        {state && <HoldingMonitorSettings
          state={{...state, study:{...study,sellPlans:availablePlans}, monitorSettings:{study:{...study,sellPlans:availablePlans},ready:settingsReady},
            ready:settingsReady, setSellPlans: next => {
              const copied=structuredClone(next);
              setSimulationPlans(copied);
              void saveParallelSettings(owner,{...settings(),plans:copied}).catch(cause=>setError(errorText(cause)));
            },
            savePlanTemplate:undefined,deletePlanTemplate:undefined,restorePlanTemplate:undefined}}
          activeId={plan?.id ?? null} onSelect={setPlanId} done={()=>setSettingsOpen(false)} selectedCount={selectedIds.length}/>}
        {error && <p role="alert">{error}</p>}
        <button type="button" className={qualitySettingsAction} onClick={() => void saveSettings()}>保存条件</button>
      </FishConditionSettings></FishConditionDialogContent>
    </Dialog>
    <Dialog>
      <DialogTrigger asChild><button type="button" className={libraryDirectoryAction} aria-label="打开后悔库"><Database aria-hidden className="h-3 w-3"/>后悔库</button></DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] w-[calc(100vw-1.5rem)] max-w-[96vw] sm:max-w-[96vw] flex-col gap-3 overflow-hidden p-4 sm:p-5">
        <DialogHeader className="flex-row items-center gap-1.5 space-y-0 text-left">
          <DialogTitle className="text-sm">后悔库</DialogTitle>
          <DialogDescription className="sr-only">查看候选和对应的推演历史</DialogDescription>
          <FishQualityInfo label="后悔库说明"><p>点选候选查看信号、终止标记和模拟加仓记录。重新推演会保留历史，同一候选只生成一次信号。</p></FishQualityInfo>
        </DialogHeader>
        <RegretBrowser owner={owner}/>
      </DialogContent>
    </Dialog>
  </FishQualityModule>;
}
