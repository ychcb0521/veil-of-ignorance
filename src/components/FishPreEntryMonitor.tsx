import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Filter, Pause, RotateCcw, Settings2 } from 'lucide-react';
import { FishLibraryDialog, libraryCell } from './FishLibraryDialog';
import { qualitySettingsAction, qualitySplitPrimaryAction, qualitySplitPauseAction, qualitySplitMenuAction } from './FishQualityModule';
import { Popover, PopoverTrigger } from './ui/popover';
import { FishPopoverContent as PopoverContent } from './FishPopoverContent';
import { formatUTC8 } from '@/lib/timeFormat';
import { preEntrySignal, type PreEntryStatus } from '@/lib/fish/preEntryMonitor';
import type { FishQualityState } from '@/hooks/useFishQuality';
import type { TradeSignal } from '@/lib/signalLibrary';

const STATUS: Record<PreEntryStatus, string> = { queued: '待监测', scanning: '监测中', paused: '已暂停', matched: '已满足', unmatched: '未满足', warming: '历史不足·待预热', error: '缺数据' };
export function FishPreEntryMonitor({ state, selectedCount, filtersOn, onSelected, onJump, renderConditions, legacyActions }: {
  state: FishQualityState; selectedCount: number; filtersOn: boolean; onSelected: () => void; onJump?: (signal: TradeSignal) => void;
  renderConditions?: (close: () => void) => ReactNode; legacyActions?: ReactNode;
}) {
  const monitor = state.preEntry;
  const [hours, setHours] = useState('0'), [selected, setSelected] = useState<string[]>([]), [message, setMessage] = useState('');
  const [menuOpen, setMenuOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false);
  const rounds = useMemo(() => new Map(monitor?.library.rounds.map(r => [r.id, r]) ?? []), [monitor?.library.rounds]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  if (!monitor) return null;
  const latestRound = [...monitor.library.rounds].sort((a, b) => a.startedAt - b.startedAt).at(-1);
  const resumable = latestRound?.state === 'paused' ? latestRound : undefined;
  const records = [...monitor.library.records].sort((a, b) => b.updatedAt - a.updatedAt);
  const canStart = monitor.ready && state.ready && selectedCount > 0 && filtersOn && !!hours.trim();
  return <div className="contents" data-testid="pre-entry-controls">
    <div role="group" aria-label="筛选运行" className="inline-flex h-6 shrink-0 items-stretch">
      {monitor.running ? <button type="button" className={qualitySplitPauseAction} onClick={monitor.pause}><Pause aria-hidden className="h-3 w-3"/>暂停筛选</button>
        : <button type="button" className={qualitySplitPrimaryAction} disabled={resumable ? !monitor.ready || !state.ready : !canStart}
          title={resumable ? '继续上轮：沿用已冻结的信号和条件，从暂停处继续筛选' : !filtersOn ? '先设置并启用买前条件' : !selectedCount ? '当前筛选下没有已勾选的信号' : `对已勾选的 ${selectedCount} 条信号向后筛选，首次满足全部条件时保存到入选库`}
          onClick={() => void (resumable ? monitor.resume(resumable.id) : monitor.start(Number(hours)))}><Filter aria-hidden className="h-3 w-3"/>开始筛选</button>}
      <Popover open={menuOpen} onOpenChange={setMenuOpen}><PopoverTrigger asChild><button type="button" aria-label="开始筛选的其他方式" disabled={!monitor.ready || !state.ready}
        className={`${qualitySplitMenuAction} ${monitor.running ? 'border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground' : 'border-primary/25 bg-primary/10 text-primary hover:border-primary/45 hover:bg-primary/20'}`}><ChevronDown aria-hidden className="h-3 w-3"/></button></PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1"><button type="button" disabled={!canStart} className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-muted disabled:opacity-40" onClick={() => { setMenuOpen(false); void monitor.restart(Number(hours)); }}>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium"><RotateCcw aria-hidden className="h-3 w-3"/>从头重新筛选</span><span className="text-[10px] leading-relaxed text-muted-foreground">保留历史轮次，按当前勾选和条件重新开始{monitor.running ? '；先停止当前批次' : ''}。</span></button>
          {legacyActions && <div className="mt-1 flex flex-wrap items-center gap-1 border-t border-border/40 pt-1">{legacyActions}</div>}
        </PopoverContent>
      </Popover>
    </div>
    <Popover open={settingsOpen} onOpenChange={setSettingsOpen}><PopoverTrigger asChild><button type="button" className={`${qualitySettingsAction} ${filtersOn ? 'text-foreground' : ''}`} aria-label="买入过滤条件" title="设置买前筛选条件与时长"><Settings2 aria-hidden className="h-3 w-3"/>条件设置</button></PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="w-[34rem] max-w-[calc(100vw-2rem)] max-h-[min(85dvh,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain pb-0">
        <label className="mb-2 flex items-center gap-2 text-[11px]">筛选时长<input aria-label="筛选时长（小时）" type="number" min="0" max="8784" className="h-6 w-20 rounded border border-border/60 bg-background px-1" value={hours} onChange={e => setHours(e.target.value)}/><span>小时 · 0 表示到可用行情末尾</span></label>
        {renderConditions?.(() => setSettingsOpen(false))}
      </PopoverContent>
    </Popover>
    <FishLibraryDialog name="入选库" roundLabel="轮次" placeholder="搜索标的、条件或状态…"
      description={`${records.filter(r => r.status === 'matched').length} 条满足 · ${records.length} 条记录 · ${rounds.size} 轮`}
      info={<><p>每轮保存当时启用的条件和原始信号。命中时间由已收盘 K 线确认；读数时间逐项列出。条件全部满足才生成可用入场节点。</p><p>勾选已满足的记录，点击“在组合表中勾选”，再运行持仓监测。不会覆盖原始信号或改写旧战役。</p></>}
      rounds={[...rounds.values()].reverse().map(r => ({ id: r.id, label: `${formatUTC8(r.startedAt)} · ${r.state === 'running' ? '运行中' : r.state === 'paused' ? '已暂停' : '已完成'}` }))}
      headers={['标的', '原信号 / 监测起点', '监测条件', '状态与原因', '扫描到', '首次满足时间', '命中读数', '操作']}
      items={records} match={(r, needle, roundId) => (!roundId || r.roundId === roundId) && (!needle || `${r.sample.source.symbol} ${STATUS[r.status]} ${r.detail ?? ''} ${rounds.get(r.roundId)?.filters.map(f => f.label).join(' ')}`.toUpperCase().includes(needle))}
      selection={{ selected: selectedSet, select: setSelected, action: () => {
        const count = state.selectPreEntryRecords?.(selected) ?? 0;
        if (!count) { setMessage('请至少选择一条“已满足”的记录'); return false; }
        setMessage(''); onSelected(); return true;
      } }} detail={message ? <p role="alert" className="text-xs text-destructive">{message}</p> : undefined}
      empty={{ none: '暂无入选记录。设置条件、勾选信号后开始筛选。', unmatched: '没有匹配的记录。' }}
      row={(r, onCheck) => <tr key={r.id} data-testid="pre-entry-library-row" className="border-t border-border/40">
        <td className={libraryCell}><input type="checkbox" aria-label={`选择入选记录 ${r.sample.source.symbol} ${r.id}`} checked={selectedSet.has(r.id)} onChange={e => onCheck?.(e.target.checked, (e.nativeEvent as MouseEvent).shiftKey)}/></td>
        <td className={`${libraryCell} font-mono`}>{r.sample.source.symbol}</td>
        <td className={`${libraryCell} text-muted-foreground`}>{formatUTC8(r.sample.source.timeMs)}<br/>{formatUTC8(r.startTime)}</td>
        <td className={`${libraryCell} max-w-80 whitespace-normal`}>{rounds.get(r.roundId)?.filters.map(f => <p key={f.id} title={f.snapshot.definitionKey}>{f.label} {f.direction} {f.threshold} · {f.snapshot.interval}</p>)}</td>
        <td className={`${libraryCell} max-w-80 whitespace-normal`}><span className={r.status === 'matched' ? 'text-emerald-600' : r.status === 'error' ? 'text-destructive' : ''}>{STATUS[r.status]}</span><p className="text-[10px] text-muted-foreground">{r.detail}</p></td>
        <td className={libraryCell}>{formatUTC8(Math.min(r.cursor, r.endTime ?? r.cursor))}</td>
        <td className={libraryCell}>{r.matchedAt ? formatUTC8(r.matchedAt) : '—'}</td>
        <td className={libraryCell}>{r.readings.map((reading, i) => <p key={reading.key}>{rounds.get(r.roundId)?.filters[i]?.label}: {reading.value == null ? '—' : +reading.value.toPrecision(6)}{reading.at && <span className="ml-1 text-[10px] text-muted-foreground">{formatUTC8(reading.at)}</span>}</p>)}</td>
        <td className={libraryCell}>{r.status === 'matched' && onJump && <button type="button" className="text-primary" onClick={() => { const signal = preEntrySignal(r); if (signal) onJump(signal); }}>K 线</button>}
          {rounds.get(r.roundId)?.state === 'paused' && <button type="button" disabled={monitor.running} className="text-primary disabled:opacity-40" onClick={() => void monitor.resume(r.roundId)}>继续本轮</button>}</td>
      </tr>}/>
    {!monitor.ready && !monitor.error && <span role="status" className="text-[10px] text-muted-foreground">正在读取入选库…</span>}
    {monitor.progress && <span role="status" className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground"><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${monitor.running ? 'animate-pulse bg-primary' : 'bg-muted-foreground/50'}`}/>{monitor.running ? '筛选中' : resumable ? '已暂停' : '筛选完成'} {monitor.progress.done}/{monitor.progress.total} {monitor.running && monitor.progress.current}</span>}
    {!monitor.running && resumable && !monitor.progress && <span role="status" className="text-[10px] text-muted-foreground">已暂停 · 点击“开始筛选”继续上轮</span>}
    {monitor.error && <span role="alert" className="text-[10px] text-destructive">{monitor.error}{!monitor.ready && <button type="button" className="ml-1 underline" onClick={monitor.retry}>重试读取</button>}</span>}
  </div>;
}
