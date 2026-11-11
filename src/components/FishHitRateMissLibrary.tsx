import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Database } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { FishHitRateResults } from './FishHitRateResults';
import { libraryDirectoryAction } from './FishLibraryTimeDirectory';
import { activeMissWindows, mergeFishActiveMisses, missSampleKey, type FishActiveMisses, type FishMissDirectory, type FishMissRound } from '@/lib/fish/hitRateMissLibrary';
import { loadFishActiveMisses, loadFishMissDirectory, loadFishMissRound, readFishActiveMisses } from '@/lib/fish/hitRateMissLibraryStore';
import type { TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';

export function FishHitRateMissLibrary({ owner, revision, activeRevision, selected, onSelect, readOnly }: {
  owner?: string | null;
  revision: number;
  activeRevision: number;
  selected: readonly TradeSignal[];
  onSelect: (samples: TradeSignal[]) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'pending' | 'history'>('pending');
  const [pending, setPending] = useState<FishActiveMisses>();
  const [pendingError, setPendingError] = useState('');
  const [directory, setDirectory] = useState<FishMissDirectory>();
  const [directoryError, setDirectoryError] = useState('');
  const [directoryRetry, setDirectoryRetry] = useState(0);
  const [roundId, setRoundId] = useState('');
  const [round, setRound] = useState<FishMissRound>();
  const [roundError, setRoundError] = useState('');
  const [roundRetry, setRoundRetry] = useState(0);
  const [draft, setDraft] = useState<ReadonlyMap<string, TradeSignal>>(new Map());

  const pendingWindows = useMemo(() => pending ? activeMissWindows(pending) : [], [pending]);
  const pendingCount = pendingWindows.reduce((count, window) => count + window.rows.length, 0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void readFishActiveMisses(owner).then(value => {
      if (active && value) setPending(previous => mergeFishActiveMisses(previous, value));
    }, () => { if (active) setPendingError('待复测记录读取失败'); });
    return () => { active = false; };
  }, [open, owner, activeRevision]);

  useEffect(() => {
    if (open && readOnly) setDraft(new Map(selected.map(sample => [missSampleKey(sample), sample])));
  }, [open, readOnly, selected]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setDirectoryError('');
    setPendingError('');
    void loadFishMissDirectory(owner, directoryRetry > 0).then(async value => {
      if (!active) return;
      setDirectory(value);
      try {
        const latest = await loadFishActiveMisses(owner, value, directoryRetry > 0);
        if (active) setPending(previous => mergeFishActiveMisses(previous, latest));
      } catch {
        if (active) setPendingError('待复测记录读取失败');
      }
    }, error => {
      if (active) setDirectoryError(error instanceof Error ? error.message : '未命中库读取失败');
    });
    return () => { active = false; };
  }, [open, owner, revision, directoryRetry]);

  useEffect(() => {
    if (!open || !roundId) return;
    let active = true;
    setRoundError('');
    void loadFishMissRound(owner, roundId, roundRetry > 0).then(value => { if (active) setRound(value); }, error => {
      if (active) setRoundError(error instanceof Error ? error.message : '未命中轮次读取失败');
    });
    return () => { active = false; };
  }, [open, owner, roundId, roundRetry]);

  function changeOpen(value: boolean) {
    if (value) {
      setDraft(new Map(selected.map(sample => [missSampleKey(sample), sample])));
      setView('pending');
    } else {
      setRound(undefined);
      setRoundId('');
    }
    setOpen(value);
  }

  function toggle(samples: readonly TradeSignal[], checked: boolean) {
    setDraft(previous => {
      const next = new Map(previous);
      for (const sample of samples) {
        const key = missSampleKey(sample);
        if (checked) next.set(key, sample);
        else next.delete(key);
      }
      return next;
    });
  }

  const selection = { checked: (sample: TradeSignal) => draft.has(missSampleKey(sample)), toggle, disabled: readOnly };

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild>
      <button type="button" className={libraryDirectoryAction}>
        <Database aria-hidden className="h-3 w-3"/>从未命中库选择标的
      </button>
    </DialogTrigger>
    <DialogContent className="flex max-h-[85dvh] w-[calc(100vw-1.5rem)] max-w-[96vw] flex-col gap-3 overflow-y-auto p-4 sm:p-5">
      <DialogHeader className="pr-6 text-left">
        <DialogTitle className="text-sm">未命中库</DialogTitle>
        <DialogDescription className="text-[11px]">每个测试窗口判定后更新待复测记录。勾选标的后按原信号时间复测。</DialogDescription>
      </DialogHeader>
      <div role="group" aria-label="未命中库视图" className="flex w-fit gap-1 rounded-md bg-muted/60 p-0.5 text-[11px]">
        <button type="button" aria-pressed={view === 'pending'} onClick={() => setView('pending')}
          className="rounded px-2 py-1.5 text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm">
          待复测{pending && <span className="ml-1 tabular-nums">{pendingCount}</span>}
        </button>
        <button type="button" aria-pressed={view === 'history'} onClick={() => setView('history')}
          className="rounded px-2 py-1.5 text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm">
          历史轮次
        </button>
      </div>
      {view === 'pending' && <>
        {(pendingError || directoryError) && <p role="alert" className="text-xs text-destructive">{pendingError || directoryError}
          <button type="button" onClick={() => setDirectoryRetry(value => value + 1)} className="ml-2 underline">重试读取</button>
        </p>}
        {pendingCount > 0
          ? <FishHitRateResults windows={pendingWindows} selection={selection}/>
          : pending ? <p className="p-3 text-xs text-muted-foreground">暂无待复测记录。</p>
            : !pendingError && !directoryError && <p role="status" className="p-3 text-xs text-muted-foreground">正在读取待复测记录…</p>}
      </>}
      {view === 'history' && <>
        {!directory && !directoryError && <p role="status" className="p-3 text-xs text-muted-foreground">正在读取未命中库…</p>}
        {directoryError && <p role="alert" className="p-3 text-xs text-destructive">{directoryError}
          <button type="button" onClick={() => setDirectoryRetry(value => value + 1)} className="ml-2 underline">重试读取</button>
        </p>}
        {directory && !directory.rounds.length && !directoryError && <p className="p-3 text-xs text-muted-foreground">暂无未命中归档。</p>}
        {directory?.rounds.map(item => {
          const expanded = roundId === item.id;
          return <section key={item.id} className="min-w-0 rounded-lg border border-border/60">
            <button type="button" aria-expanded={expanded} onClick={() => { setRoundError(''); setRound(undefined); setRoundId(expanded ? '' : item.id); }}
              className="flex w-full flex-wrap items-center gap-2 p-3 text-left text-[11px] hover:bg-muted/40">
              <ChevronDown aria-hidden className={`h-3 w-3 ${expanded ? 'rotate-180' : ''}`}/>
              <span className="font-mono">{formatUTC8(item.completedAt)}</span>
              <span className="font-medium">漏报测试</span>
              <span className="text-muted-foreground">{item.count} 条未命中 · {item.mode === 'market' ? '全市场' : '指定标的'}</span>
            </button>
            {expanded && <div className="min-w-0 border-t border-border/60 px-3 pb-3">
              {round?.id === item.id ? <>
                <p className="py-2 text-[11px] text-muted-foreground">原测试窗口：样本前 {item.window.beforeHours} 小时，后 {item.window.afterHours} 小时</p>
                <FishHitRateResults key={item.id} windows={round.windows} selection={selection}/>
              </> : roundError ? <p role="alert" className="py-2 text-xs text-destructive">{roundError}
                <button type="button" onClick={() => setRoundRetry(value => value + 1)} className="ml-2 underline">重试读取</button>
              </p> : <p role="status" className="py-2 text-xs text-muted-foreground">正在读取本轮结果…</p>}
            </div>}
          </section>;
        })}
      </>}
      <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-2 text-[11px]">
        <span className="pl-1 text-muted-foreground">{readOnly ? '测试进行中，可查看记录和判定详情。' : `已选 ${draft.size} 条测试样本`}</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => changeOpen(false)} className="rounded-md border border-border/60 px-3 py-1.5 hover:bg-muted">取消</button>
          <button type="button" disabled={readOnly || (!draft.size && !selected.length)} onClick={() => { onSelect([...draft.values()]); changeOpen(false); }}
            className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-40">
            {draft.size || !selected.length ? '使用所选样本' : '清空测试样本'}
          </button>
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
