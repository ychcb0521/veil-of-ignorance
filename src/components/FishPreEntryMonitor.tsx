import { FishPreEntrySettings } from './FishPreEntrySettings';
import { preEntryPlanFilters } from '@/lib/fish/preEntryIntrabar';
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Filter, Pause, RotateCcw, Settings2 } from 'lucide-react';
import { FishLibraryDialog, libraryCell } from './FishLibraryDialog';
import { qualitySettingsAction, qualitySplitPrimaryAction, qualitySplitPauseAction, qualitySplitMenuAction } from './FishQualityModule';
import { Popover, PopoverTrigger } from './ui/popover';
import { FishPopoverContent as PopoverContent } from './FishPopoverContent';
import { formatUTC8 } from '@/lib/timeFormat';
import { preEntrySignal, preEntryRecordPending, PRE_ENTRY_ZERO_TRADE_VERSION, type PreEntryStatus, type PreEntryRound } from '@/lib/fish/preEntryMonitor';
import type { FishQualityState } from '@/hooks/useFishQuality';
import type { TradeSignal } from '@/lib/signalLibrary';
import { PRE_ENTRY_CONDITIONS_VERSION, preEntryConditionText, preEntryVetoes } from '@/lib/fish/preEntryConditions';
import { activeAdditionVetoes, additionVetoLabel } from '@/lib/fish/qualityAdditionVeto';
import { holdingVetoLabel } from '@/lib/fish/qualityVeto';

const STATUS: Record<PreEntryStatus, string> = { queued: '待监测', scanning: '监测中', paused: '已暂停', matched: '已满足', unmatched: '未满足', warming: '历史不足·待预热', error: '缺数据' };
const engineLabel = (round?: PreEntryRound) => round?.engine === PRE_ENTRY_CONDITIONS_VERSION ? '分钟筛选 v4 · 入选与否决' : round?.engine === PRE_ENTRY_ZERO_TRADE_VERSION ? '分钟筛选 v3 · 图灵杯零成交等待' : round?.engine ? '分钟筛选 v2' : '收盘筛选 v1';
export function FishPreEntryMonitor({ state, selectedCount, filtersOn, onSelected, onJump, renderConditions }: {
  state: FishQualityState; selectedCount: number; filtersOn: boolean; onSelected: () => void; onJump?: (signal: TradeSignal) => void;
  renderConditions?: (close: () => void) => ReactNode;
}) {
  const monitor = state.preEntry;
  const [selected, setSelected] = useState<string[]>([]), [message, setMessage] = useState('');
  const [menuOpen, setMenuOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false);
  const rounds = useMemo(() => new Map(monitor?.library.rounds.map(r => [r.id, r]) ?? []), [monitor?.library.rounds]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  if (!monitor) return null;
  const latestRound = [...monitor.library.rounds].sort((a, b) => a.startedAt - b.startedAt).at(-1);
  const resumable = latestRound?.state === 'paused' ? latestRound : undefined;
  const records = [...monitor.library.records].sort((a, b) => b.updatedAt - a.updatedAt);
  const latestRecords = records.filter(r => r.roundId === latestRound?.id);
  const missingCount = latestRecords.filter(r => r.status === 'error').length;
  const settledCount = latestRecords.filter(r => !preEntryRecordPending(r)).length;
  const matchedCount = latestRecords.filter(r => r.status === 'matched').length;
  const progressDone = monitor.running ? monitor.progress?.done ?? settledCount : settledCount;
  const progressTotal = latestRecords.length || monitor.progress?.total || 0;
  const progressLabel = monitor.running ? '筛选中' : resumable ? '已暂停' : '筛选完成';
  const hours = monitor.library.settings?.hours ?? 0;
  const filtersFor = (r: typeof records[number]) => { const round=rounds.get(r.roundId), plan=round?.plans?.find(p=>p.id===r.planId);return plan?preEntryPlanFilters(plan):round?.filters??[]; };
  const exclusionsFor = (r: typeof records[number]) => { const round=rounds.get(r.roundId);return round?.engine===PRE_ENTRY_CONDITIONS_VERSION?round.plans?.find(p=>p.id===r.planId)?.preEntryConditions:undefined; };
  const readingLabel = (r:typeof records[number],key:string,index:number) => (rounds.get(r.roundId)?.engine?filtersFor(r).find(f=>f.id===key):filtersFor(r)[index])?.label ?? preEntryVetoes(exclusionsFor(r)).find(v=>v.id===key)?.label ?? key;
  const canStart = monitor.ready && state.ready && selectedCount > 0 && filtersOn;
  const admitted = records.filter(r => r.status === 'matched');
  const renderLibrary = (selectedOnly: boolean) => <FishLibraryDialog name={selectedOnly ? "入选库" : "筛选记录"} roundLabel="轮次" placeholder="搜索标的、条件或状态…"
      description={selectedOnly ? `仅收录满足全部条件的标的 · ${admitted.length} 条入选记录` : `全部筛选过程 · ${records.length} 条记录 · ${rounds.size} 轮`}
      info={<><p>每轮保存当时启用的条件和原始信号。新开轮次使用分钟筛选 v4：入选条件同分钟全部满足且没有否决，才入选；图灵杯零成交等待读数恢复，真实缺口记为缺数据。旧轮次继续使用当时版本，历史结果保留。</p><p>已满足记录自动同步到组合表的“入选库”来源。勾选后再运行持仓监测。</p></>}
      rounds={[...rounds.values()].filter(round=>!selectedOnly||admitted.some(r=>r.roundId===round.id)).reverse().map(r => ({ id: r.id, label: `${formatUTC8(r.startedAt)} · ${r.state === 'running' ? '运行中' : r.state === 'paused' ? '已暂停' : '已完成'}` }))}
      headers={['标的', '原信号 / 监测起点', '监测条件', '状态与原因', '扫描到', '首次满足时间', '命中读数', '操作']}
      items={selectedOnly ? admitted : records} match={(r, needle, roundId) => (!roundId || r.roundId === roundId) && (!needle || `${r.sample.source.symbol} ${STATUS[r.status]} ${r.detail ?? ''} ${filtersFor(r).map(f => f.label).join(' ')}`.toUpperCase().includes(needle))}
      selection={selectedOnly ? { selected: selectedSet, select: setSelected, action: () => {
        const count = state.selectPreEntryRecords?.(selected) ?? 0;
        if (!count) { setMessage('请至少选择一条“已满足”的记录'); return false; }
        setMessage(''); onSelected(); return true;
      } } : undefined} detail={selectedOnly && message ? <p role="alert" className="text-xs text-destructive">{message}</p> : undefined}
      empty={{ none: selectedOnly ? '暂无入选记录。满足全部条件后才会进入入选库。' : '暂无筛选记录。', unmatched: '没有匹配的记录。' }}
      row={(r, onCheck) => <tr key={r.id} data-testid={selectedOnly ? "pre-entry-library-row" : "pre-entry-scan-row"} className="border-t border-border/40">
        {selectedOnly && <td className={libraryCell}><input type="checkbox" aria-label={`选择入选记录 ${r.sample.source.symbol} ${r.id}`} checked={selectedSet.has(r.id)} onChange={e => onCheck?.(e.target.checked, (e.nativeEvent as MouseEvent).shiftKey)}/></td>}
        <td className={`${libraryCell} font-mono`}>{r.sample.source.symbol}</td>
        <td className={`${libraryCell} text-muted-foreground`}>{formatUTC8(r.sample.source.timeMs)}<br/>{formatUTC8(r.startTime)}</td>
        <td className={`${libraryCell} max-w-80 whitespace-normal`}>{filtersFor(r).map(f => <p key={f.id} title={f.snapshot.definitionKey}>{f.label} {f.direction} {f.threshold} · {f.snapshot.interval}</p>)}{activeAdditionVetoes(exclusionsFor(r)?.entryVetoes).map(v=><p key={v.kind}>入选前否决：{additionVetoLabel(v).replace(/持仓/g,'筛选').replace(/不再加仓/g,'不入选')}</p>)}{preEntryVetoes(exclusionsFor(r)).map(v=><p key={v.id}>{v.id.startsWith('sellVetoes:')?'卖出排除':'硬性终止排除'}：{preEntryConditionText(holdingVetoLabel(v))}</p>)}<p className="text-[10px] text-muted-foreground">{engineLabel(rounds.get(r.roundId))}</p></td>
        <td className={`${libraryCell} max-w-80 whitespace-normal`}><span className={r.status === 'matched' ? 'text-emerald-600' : r.status === 'error' ? 'text-destructive' : ''}>{STATUS[r.status]}</span><p className="text-[10px] text-muted-foreground">{r.detail}</p>{r.zeroTradeWait&&<p className="text-[10px] text-muted-foreground">零成交及读数恢复期间等待 {r.zeroTradeWait.count} 个分钟观测，未判定入选；首次 {formatUTC8(r.zeroTradeWait.firstAt)}，最近 {formatUTC8(r.zeroTradeWait.lastAt)}</p>}</td>
        <td className={libraryCell}>{formatUTC8(Math.min(r.cursor, r.endTime ?? r.cursor))}</td>
        <td className={libraryCell}>{r.matchedAt ? formatUTC8(r.matchedAt) : '—'}</td>
        <td className={libraryCell}>{r.readings.map((reading, i) => <p key={reading.key}>{readingLabel(r,reading.key,i)}: {reading.value == null ? '—' : +reading.value.toPrecision(6)}{reading.at && <span className="ml-1 text-[10px] text-muted-foreground">{formatUTC8(reading.at)}</span>}</p>)}{r.lastVeto&&<p className="text-[10px] text-muted-foreground">曾被否决 {r.lastVeto.count} 个分钟观测 · 最近 {formatUTC8(r.lastVeto.at)}：{r.lastVeto.reason}</p>}</td>
        <td className={libraryCell}>{r.status === 'matched' && onJump && <button type="button" className="text-primary" onClick={() => { const signal = preEntrySignal(r); if (signal) onJump(signal); }}>K 线</button>}
          {!selectedOnly && (r.status === 'error' || rounds.get(r.roundId)?.state === 'paused') && <button type="button" disabled={monitor.running} className="text-primary disabled:opacity-40" onClick={() => void monitor.resume(r.roundId)}>{r.status === 'error' ? '重试本轮缺数据' : '继续本轮'}</button>}</td>
      </tr>}/>;
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
          {latestRound && missingCount > 0 && <button type="button" disabled={monitor.running} className="w-full rounded px-2 py-1.5 text-left text-[11px] hover:bg-muted disabled:opacity-40" onClick={() => { setMenuOpen(false); void monitor.resume(latestRound.id); }}>重试本轮缺数据（{missingCount}）</button>}
        </PopoverContent>
      </Popover>
    </div>
    <Popover open={settingsOpen} onOpenChange={setSettingsOpen}><PopoverTrigger asChild><button type="button" className={`${qualitySettingsAction} ${filtersOn ? 'text-foreground' : ''}`} aria-label="动态筛选条件" title="设置买前筛选条件与时长"><Settings2 aria-hidden className="h-3 w-3"/>条件设置</button></PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="w-[46rem] max-w-[calc(100vw-2rem)] max-h-[min(85dvh,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain pb-0">
        {renderConditions?renderConditions(()=>setSettingsOpen(false)):<FishPreEntrySettings state={state} selectedCount={selectedCount} done={()=>setSettingsOpen(false)}/>}
      </PopoverContent>
    </Popover>
    {renderLibrary(true)}
    {!!records.length && renderLibrary(false)}
    {!monitor.ready && !monitor.error && <span role="status" className="text-[10px] text-muted-foreground">正在读取入选库…</span>}
    {(monitor.progress || latestRecords.length > 0) && <span role="status" className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${monitor.running ? 'animate-pulse bg-primary' : 'bg-muted-foreground/50'}`}/>
      {progressLabel} {progressDone}/{progressTotal} {monitor.running && monitor.progress?.current}
      {!monitor.running && latestRecords.length > 0 && ` · 已满足 ${matchedCount} · 缺数据 ${missingCount}`}
    </span>}
    {!monitor.running && resumable && !monitor.progress && !latestRecords.length && <span role="status" className="text-[10px] text-muted-foreground">已暂停 · 点击“开始筛选”继续上轮</span>}
    {!monitor.running && missingCount > 0 && <span className="text-[10px] text-muted-foreground">缺数据原因见“筛选记录”<button type="button" className="ml-1 text-primary underline" onClick={()=>void monitor.resume(latestRound!.id)}>重试缺数据记录</button></span>}
    {!monitor.running && latestRound && latestRound.engine !== PRE_ENTRY_CONDITIONS_VERSION && missingCount > 0 && <span className="text-[10px] text-muted-foreground">本轮沿用{engineLabel(latestRound)}；使用入选否决与零成交等待规则请<button type="button" className="ml-1 text-primary underline disabled:opacity-40" disabled={!canStart} onClick={()=>void monitor.restart(Number(hours))}>保留旧轮次，用新版重新筛选</button></span>}
    {monitor.error && <span role="alert" className="text-[10px] text-destructive">{monitor.error}{!monitor.ready && <button type="button" className="ml-1 underline" onClick={monitor.retry}>重试读取</button>}</span>}
  </div>;
}
