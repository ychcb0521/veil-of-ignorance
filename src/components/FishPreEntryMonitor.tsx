import { useMemo, useState } from 'react';
import { Activity, Pause, Play } from 'lucide-react';
import { FishLibraryDialog, libraryCell } from './FishLibraryDialog';
import { FishQualityInfo, qualityPrimaryAction, qualityPauseAction } from './FishQualityModule';
import { formatUTC8 } from '@/lib/timeFormat';
import { preEntrySignal, type PreEntryStatus } from '@/lib/fish/preEntryMonitor';
import type { FishQualityState } from '@/hooks/useFishQuality';
import type { TradeSignal } from '@/lib/signalLibrary';

const STATUS: Record<PreEntryStatus, string> = { queued: '待监测', scanning: '监测中', paused: '已暂停', matched: '已满足', unmatched: '未满足', warming: '历史不足·待预热', error: '缺数据' };
export function FishPreEntryMonitor({ state, selectedCount, filtersOn, onSelected, onJump }: {
  state: FishQualityState; selectedCount: number; filtersOn: boolean; onSelected: () => void; onJump?: (signal: TradeSignal) => void;
}) {
  const monitor = state.preEntry;
  const [hours, setHours] = useState('0'), [selected, setSelected] = useState<string[]>([]), [message, setMessage] = useState('');
  const rounds = useMemo(() => new Map(monitor?.library.rounds.map(r => [r.id, r]) ?? []), [monitor?.library.rounds]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  if (!monitor) return null;
  const resumable = [...monitor.library.rounds].reverse().find(r => r.state === 'paused');
  const records = [...monitor.library.records].sort((a, b) => b.updatedAt - a.updatedAt);
  return <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-border/40 pt-2" data-testid="pre-entry-controls">
    <span className="text-[11px] font-medium">动态买前监测</span>
    <FishQualityInfo label="动态买前监测说明"><p>从当前筛选中勾选的信号起点向后判断；全部启用的买前条件首次同时满足时，该标的停止扫描并保存时间节点。不同标的独立停止。</p><p>使用已收盘 K 线和原始读数，沿用条件方向与阈值。图灵杯先等待足够预热历史；缺口、缺少 BTC 等依赖会明确报错。0 小时表示扫描至本轮开始时的可用行情末尾。</p><p>每轮条件与结果独立保存在“买前监测”库。选中已满足记录，带回组合表运行持仓监测；入场时间采用命中节点，原始信号保留。</p></FishQualityInfo>
    <label className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">时长
      <input aria-label="买前监测时长（小时）" type="number" min="0" max="8784" className="h-6 w-16 rounded border border-border/60 bg-background px-1" value={hours} onChange={e => setHours(e.target.value)}/><span>小时</span>
    </label>
    {monitor.running ? <button type="button" className={`${qualityPauseAction} !w-auto`} onClick={monitor.pause}><Pause className="h-3 w-3"/>暂停买前监测</button>
      : <button type="button" className={`${qualityPrimaryAction} !w-auto`} disabled={!monitor.ready || !state.ready || !selectedCount || !filtersOn || !hours.trim()}
        onClick={() => void monitor.start(Number(hours))}><Activity className="h-3 w-3"/>开始买前监测</button>}
    {!monitor.running && resumable && <button type="button" className="inline-flex items-center gap-1 px-1 text-[10px] text-primary" onClick={() => void monitor.resume(resumable.id)}><Play className="h-3 w-3"/>继续上轮</button>}
    {!monitor.ready && !monitor.error && <span role="status" className="text-[10px] text-muted-foreground">正在读取买前监测库…</span>}
    {monitor.progress && <span role="status" className="text-[10px] text-muted-foreground">{monitor.running ? '监测中' : '已处理'} {monitor.progress.done}/{monitor.progress.total} {monitor.running && monitor.progress.current}</span>}
    {monitor.error && <span role="alert" className="text-[10px] text-destructive">{monitor.error}{!monitor.ready && <button type="button" className="ml-1 underline" onClick={monitor.retry}>重试读取</button>}</span>}
    <FishLibraryDialog name="买前监测" roundLabel="轮次" placeholder="搜索标的、条件或状态…"
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
      empty={{ none: '暂无买前监测记录。设置买前条件、勾选信号后开始监测。', unmatched: '没有匹配的记录。' }}
      row={(r, onCheck) => <tr key={r.id} data-testid="pre-entry-library-row" className="border-t border-border/40">
        <td className={libraryCell}><input type="checkbox" aria-label={`选择买前监测 ${r.sample.source.symbol} ${r.id}`} checked={selectedSet.has(r.id)} onChange={e => onCheck?.(e.target.checked, (e.nativeEvent as MouseEvent).shiftKey)}/></td>
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
  </div>;
}
