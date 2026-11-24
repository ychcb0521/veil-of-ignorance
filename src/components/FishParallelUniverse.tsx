import { HoldingMonitorSettings } from './FishHoldingMonitorSettings';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { useEffect, useRef, useState } from 'react';
import { Activity, ChevronDown, Filter, Pause, RotateCcw, Settings2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { formatUTC8 } from '@/lib/timeFormat';
import { newQualityStudy, qualityEntryIdentity, qualityRunSamples, type FishQualityStudy, type QualityGroup, type QualityProgress, type QualityRunOptions } from '@/lib/fish/quality';
import { DEFAULT_SIGNAL_ADDITION_COUNT, validSignalAdditionCount } from '@/lib/fish/parallelUniverse';
import { loadParallelSettings, saveParallelAttempt, saveParallelSettings } from '@/lib/fish/parallelUniverseStore';
import { FishQualityInfo, FishQualityModule, qualitySettingsAction, qualitySplitMenuAction, qualitySplitPauseAction, qualitySplitPrimaryAction } from './FishQualityModule';
import { FishConditionDialogContent, FishConditionSettings } from './FishConditionSettings';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { FishPopoverContent as PopoverContent } from './FishPopoverContent';
import { FishQualityProgress } from './FishQualityProgress';
import { FishRegretLibrary } from './FishRegretLibrary';

const date = (at?: number | null) => at ? formatUTC8(at) : '—';
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function FishParallelUniverse({ owner, study, plans, selectedIds, run, state, onTableResult, onRunningChange, trailing }: {
  onTableResult?: (result: import('@/lib/fish/parallelUniverseStore').ParallelTableResult) => void;
  onRunningChange?: (running: boolean) => void;
  trailing?: React.ReactNode;
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
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [roundOpen, setRoundOpen] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [roundRows, setRoundRows] = useState<(import('@/lib/fish/parallelUniverseStore').ParallelTableResult & {symbol:string})[]>([]);
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

  const plan = availablePlans.find(item => item.id === planId) ?? availablePlans[0];
  const settings = (nextPlans = simulationPlans) => {
    const additionCount = Number(count), observeHours = Number(hours);
    const choices = nextPlans ?? plans;
    const selected = choices.find(item => item.id === planId) ?? choices[0];
    if (!selected) throw Error('请至少保留一套模拟方案');
    if (!validSignalAdditionCount(additionCount) || hours === '' || !Number.isFinite(observeHours) || observeHours < 0 || observeHours > 8784) {
      throw Error('加仓次数须为正整数，观察时长须在 0～8784 小时之间');
    }
    return { planId: selected.id, additionCount, observeHours, plans: nextPlans };
  };
  const saveSettings = async (nextPlans?: QualityGroup[]) => {
    try {
      setError('');
      const saved = settings(nextPlans === undefined ? simulationPlans : structuredClone(nextPlans));
      setSaving(true);
      await saveParallelSettings(owner, saved);
      setSimulationPlans(saved.plans);
      setPlanId(saved.planId);
      setSettingsOpen(false);
    } catch (cause) { setError(errorText(cause)); }
    finally { setSaving(false); }
  };
  const saveSharedTemplate = state?.savePlanTemplate;
  const saveSimulationTemplate = saveSharedTemplate && ((id: string, name: string) => {
    const savedPlan = availablePlans.find(plan => plan.id === id);
    if (!settingsReady || saving || !savedPlan) throw Error('请先保存这套方案，再存为模板');
    saveSharedTemplate(id, name, savedPlan);
  });
  const canStart = settingsReady && !saving && !!plan && selectedIds.length > 0;
  const prepare = () => {
    const selected = qualityRunSamples({ ...study, selectedRowIds: selectedIds }).filter(row => !row.binanceEntry);
    if (!selected.length) throw Error('当前范围没有已勾选的模拟候选');
    const identities = new Set(selected.map(row => qualityEntryIdentity(row.source, row.enteredAt)));
    const samples = study.samples.filter(row => !row.binanceEntry && identities.has(qualityEntryIdentity(row.source, row.enteredAt)));
    const conditions = settings();
    return {
      conditions,
      round: { id: crypto.randomUUID(), startedAt: Date.now(), total: selected.length },
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
    onRunningChange?.(true);
    for (let next: Batch | undefined = first; next; next = restart.current) {
      const batch = next;
      restart.current = undefined;
      paused.current = batch;
      if (!batch.completed.size) setRoundRows([]);
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
            const result = await saveParallelAttempt(owner, attempt, batch.round);
            if (result) {
              onTableResult?.(result);
              const roundResult = { ...result, symbol: attempt.candidate.source.symbol, signal: attempt.proposedSignal };
              setRoundRows(rows => [...rows, roundResult]);
            }
            batch.completed.add(attempt.candidate.signalId ?? attempt.candidate.id);
          } },
        });
        if (batch.completed.size === ids.length) paused.current = undefined;
        else if (!aborter.signal.aborted) throw Error(`本轮仅写入 ${batch.completed.size} / ${ids.length} 项结果，可继续推演`);
      } catch (cause) {
        if (!aborter.signal.aborted) setError(errorText(cause));
        if (batch.completed.size === ids.length) paused.current = undefined;
      }
    }
    controller.current = null;
    setHistoryRevision(value => value + 1);
    setRunning(false);
    onRunningChange?.(false);
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
  return <FishQualityModule level="submodule" title="平行宇宙" icon={Activity} testId="quality-parallel-controls" trailing={trailing}
    summary={<FishQualityInfo label="平行宇宙说明"><p>用持仓监测方案推演已勾选的候选。镜像前终止只记标记，达到设置的第 N 次加仓后，将信号和触发依据记入后悔库。</p><p>暂停后继续会沿用本轮的候选和条件。所有操作均为模拟。</p></FishQualityInfo>}
    status={error && !settingsOpen ? <span role="alert">{error}</span> : !running && paused.current && <span>已暂停</span>}>
    <div role="group" aria-label="平行宇宙运行" className="inline-flex h-6 shrink-0 items-stretch">
      {running ? <button type="button" className={qualitySplitPauseAction} onClick={() => controller.current?.abort()}>
        <Pause aria-hidden className="h-3 w-3"/>暂停推演
      </button> : <button type="button" className={qualitySplitPrimaryAction} disabled={!paused.current && !canStart}
        title={paused.current ? '沿用本轮冻结的候选和条件' : '按反事实法设置推演当前已勾选的候选'}
        onClick={() => start()}>
        <Filter aria-hidden className="h-3 w-3"/>{paused.current ? '继续推演' : '开始推演'}
      </button>}
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild><button type="button" aria-label="开始推演的其他方式" disabled={!canStart && !progress && !running}
          className={`${qualitySplitMenuAction} ${running ? 'border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground' : 'border-primary/25 bg-primary/10 text-primary hover:border-primary/45 hover:bg-primary/20'}`}>
          <ChevronDown aria-hidden className="h-3 w-3"/>
        </button></PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1">
          {(running || progress) && <button type="button" className="w-full rounded px-2 py-1.5 text-left text-[11px] hover:bg-muted"
            onClick={() => { setMenuOpen(false); setRoundOpen(true); }}>本轮推演结果</button>}
          <button type="button" disabled={!canStart} className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-muted disabled:opacity-40"
            onClick={() => { setMenuOpen(false); start(true); }}>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium"><RotateCcw aria-hidden className="h-3 w-3"/>从头重新推演</span>
            <span className="text-[10px] leading-relaxed text-muted-foreground">按当前勾选和条件重新计算，保留后悔库中的历史记录。</span>
          </button>
        </PopoverContent>
      </Popover>
    </div>
    <Dialog open={settingsOpen} onOpenChange={open => { if (!saving) setSettingsOpen(open); }}>
      <DialogTrigger asChild><button type="button" className={qualitySettingsAction} aria-label="反事实法" disabled={!settingsReady || running} onClick={() => setError('')}><Settings2 aria-hidden className="h-3 w-3"/>反事实法</button></DialogTrigger>
      <FishConditionDialogContent><FishConditionSettings dialog title="反事实法" description="设置模拟方案、触发加仓次数和观察时长。">
        {saving && <p role="status" className="sticky top-0 z-10 bg-background">正在保存反事实法设置…</p>}
        {error && <p role="alert" className="sticky top-0 z-10 bg-background text-destructive">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">信号触发加仓次数 N
            <input className="rounded border bg-background p-2" type="number" min={1} step={1} value={count} onChange={event => setCount(event.target.value)}/>
          </label>
          <label className="flex flex-col gap-1">观察时长（小时，0 为持续至模拟退出）
            <input className="rounded border bg-background p-2" type="number" min={0} max={8784} step="any" value={hours} onChange={event => setHours(event.target.value)}/>
          </label>
        </div>
        {state && <HoldingMonitorSettings
          state={{...state, study:{...study,sellPlans:availablePlans}, monitorSettings:{study:{...study,sellPlans:availablePlans},ready:settingsReady && !saving},
            ready:settingsReady && !saving, setSellPlans: next => { void saveSettings(next); },
            selectSell: setPlanId,
            start: async () => {},
            instantPosition: undefined,
            savePlanTemplate:saveSimulationTemplate,deletePlanTemplate:state.deletePlanTemplate,restorePlanTemplate:state.restorePlanTemplate}}
          templateSource={state.monitorSettings?.study ?? state.study} activeId={planId || plan?.id || null} onSelect={setPlanId} done={()=>{}} selectedCount={0}/>}
        {!state && <button type="button" disabled={saving} className={qualitySettingsAction} onClick={() => void saveSettings()}>保存条件</button>}
      </FishConditionSettings></FishConditionDialogContent>
    </Dialog>
    <FishRegretLibrary key={owner ?? 'anonymous'} owner={owner} revision={historyRevision}
      templates={state?.monitorSettings?.study.planTemplates ?? study.planTemplates}/>
    {running && <FishQualityProgress testId="parallel-universe-progress" progressLabel="平行宇宙处理进度"
      label={progress?.waitingUntil ? '等待续跑' : '推演进行中'} done={progress?.done ?? 0} total={progress?.total ?? 0}
      waitingUntil={progress?.waitingUntil} hitCount={{value:roundRows.filter(row => row.signal).length,title:'本轮满足信号条件的候选数'}}
      action={{label:'查看本轮推演结果',title:'查看本轮推演结果',onClick:()=>setRoundOpen(true)}}/>}
    <Dialog open={roundOpen} onOpenChange={setRoundOpen}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>本轮推演结果</DialogTitle>
          <DialogDescription>已写入 {roundRows.length} / {progress?.total ?? 0} 条候选结果</DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-auto text-xs">
          <table className="w-full text-left">
            <thead><tr>{['标的','推演方案','推演结果','首次满足时间','推演过程'].map(label=><th key={label} className="p-2">{label}</th>)}</tr></thead>
            <tbody>{roundRows.map(row=><tr key={row.entryKey} className="border-t border-border/50">
              <td className="p-2">{row.symbol}</td><td className="p-2">{row.planLabel}</td>
              <td className="p-2">{row.signal ? '已满足' : '未满足'}</td>
              <td className="p-2">{date(row.signal?.time)}</td><td className="p-2">{row.reason}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  </FishQualityModule>;
}
