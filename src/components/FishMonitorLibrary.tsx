import { useMemo, useState } from 'react';
import { ChevronDown, Database } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FishQualityInfo } from '@/components/FishQualityModule';
import { qualityDefinition, qualityDrawdownPct, type FishQualityStudy, type QualityResult } from '@/lib/fish/quality';
import { qualityRuleLabel } from '@/lib/fish/qualityCampaignArchive';
import { qualityMonitorRoundRecordIds, type QualityMonitorRecord, type QualityMonitorSetting } from '@/lib/fish/qualityMonitorLibrary';
import { activeHoldingVetoes } from '@/lib/fish/qualityVeto';
import { formatUTC8 } from '@/lib/timeFormat';
import type { TradeSignal } from '@/lib/signalLibrary';

const action = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40';
const field = 'h-8 min-w-0 rounded-md border border-border/60 bg-muted/30 px-2 text-[11px] outline-none focus-visible:border-ring';
const date = (t: number | null | undefined) => t == null ? '—' : formatUTC8(t);
const pct = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const buying = (s: QualityMonitorSetting) => s.plan.buyFilters?.length ? s.plan.buyFilters.map(f => `${f.label} ${f.direction} ${f.threshold}`).join(' 且 ') : s.filtersKnown ? '无买前条件' : '历史条件未记录';
const resultVisible = (record: QualityMonitorRecord, setting: QualityMonitorSetting) => !setting.filtersKnown || ['none', 'pass'].includes(record.filterStatus.state);
function status(record: QualityMonitorRecord, setting: QualityMonitorSetting): string {
  if (setting.filtersKnown) {
    if (record.filterStatus.state === 'fail') return '未买入';
    if (record.filterStatus.state === 'error') return '过滤缺数据';
    if (record.filterStatus.state === 'pending') return '待过滤';
  }
  return record.result?.status === 'closed' ? '已卖出' : record.result?.status === 'open' ? '持有中' : record.result?.status === 'error' ? '缺数据' : record.result?.entryPrice ? '待设卖出' : '待评估';
}
function Formula({ label, snapshot }: { label: string; snapshot: QualityMonitorSetting['plan']['snapshot'] }) {
  let formula: string; try { formula = qualityDefinition(snapshot).formula; } catch { formula = snapshot.definitionKey; }
  return <div><p className="font-medium">{label} · {snapshot.interval}</p><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-mono text-[10px]">{formula}</pre></div>;
}
export function FishMonitorLibrary({ study, onJump, canJump }: { study: FishQualityStudy; onJump?: (s: TradeSignal) => void; canJump?: (s: TradeSignal) => boolean }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [roundId, setRoundId] = useState(''), [page, setPage] = useState(0), [detailId, setDetailId] = useState('');
  const library = study.monitorLibrary;
  const settings = useMemo(() => new Map((library?.settings ?? []).map(s => [s.id, s])), [library?.settings]);
  const rounds = useMemo(() => [...(library?.rounds ?? [])].reverse().sort((a, b) => b.startedAt - a.startedAt), [library?.rounds]);
  const roundNumbers = useMemo(() => new Map(rounds.filter(r => !r.legacy).reverse().map((r, i) => [r.id, i + 1])), [rounds]);
  const selectedRound = rounds.find(r => r.id === roundId);
  const records = useMemo(() => {
    if (!open) return [];
    const ids = selectedRound && library ? new Set(qualityMonitorRoundRecordIds(library, selectedRound)) : null, needle = query.trim().toUpperCase();
    return [...(library?.records ?? [])].filter(r => settings.has(r.settingId) && (!ids || ids.has(r.id)) && (!needle || r.source.symbol.toUpperCase().includes(needle) || qualityRuleLabel(settings.get(r.settingId)!.plan).toUpperCase().includes(needle)))
      .sort((a, b) => b.updatedAt - a.updatedAt || b.source.timeMs - a.source.timeMs || a.source.symbol.localeCompare(b.source.symbol));
  }, [library?.records, selectedRound, query, settings, open]);
  const pages = Math.max(1, Math.ceil(records.length / 50)), currentPage = Math.min(page, pages - 1), visible = records.slice(currentPage * 50, (currentPage + 1) * 50);
  const detail = open && detailId ? library?.records.find(r => r.id === detailId) : undefined, detailSetting = detail && settings.get(detail.settingId);
  const roundState = { running: '运行中', complete: '已完成', paused: '已暂停', failed: '失败' } as const;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" className={action} aria-label="打开监测库"><Database aria-hidden className="h-3 w-3"/>监测库</button></DialogTrigger>
    <DialogContent className="flex max-h-[85vh] w-[calc(100vw-1.5rem)] max-w-6xl flex-col gap-3 overflow-hidden p-4 sm:p-5">
      <DialogHeader className="shrink-0 space-y-1 text-left">
        <div className="flex items-center gap-1.5"><DialogTitle className="text-sm">监测库</DialogTitle><FishQualityInfo label="监测库说明"><p>每轮冻结当时的算法、公式、门槛、买前过滤与持仓否决条件，随账号保存。</p><p>同标的、同信号时间、同买入时点且条件相同的记录合并，保留最新结果；每轮仍可单独查看。旧快照缺少的条件标为未记录。</p></FishQualityInfo></div>
        <DialogDescription className="text-[11px]">{library?.records.length ?? 0} 条记录 · {roundNumbers.size} 轮监测{rounds.some(r => r.legacy) ? ' · 含历史快照' : ''}</DialogDescription>
      </DialogHeader>
      <div className="flex shrink-0 flex-wrap gap-2">
        <input aria-label="搜索监测库" className={`${field} min-w-36 flex-1`} placeholder="搜索标的或监测算法…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}/>
        <select aria-label="监测库轮次" className={`${field} max-w-full sm:max-w-80`} value={roundId} onChange={e => { setRoundId(e.target.value); setPage(0); setDetailId(''); }}><option value="">全部轮次</option>{rounds.map(r => <option key={r.id} value={r.id}>{r.legacy ? '历史记录' : `第 ${roundNumbers.get(r.id)} 轮 · ${date(r.startedAt)}`} · {roundState[r.state]}</option>)}</select>
      </div>
      {selectedRound?.error && <p role="status" className="shrink-0 text-[11px] text-destructive">{selectedRound.error}</p>}
      {detail && detailSetting && <div className="max-h-60 shrink-0 space-y-2 overflow-auto rounded-md border border-border/60 bg-muted/20 p-3 text-[11px]" data-testid="monitor-library-details">
        <div className="flex justify-between gap-2"><p className="font-medium">{detail.source.symbol} · {qualityRuleLabel(detailSetting.plan)}</p><button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setDetailId('')}>收起条件</button></div>
        <p>买前过滤：{buying(detailSetting)}{!detailSetting.filtersKnown && detailSetting.plan.buyFilters?.length ? '（旧快照未保存完整判断读数）' : ''}</p>
        <p>持仓否决：{activeHoldingVetoes(detailSetting.plan.holdingVetoes).map(v => `${v.label} ${v.direction} ${v.threshold}${v.kind === 'indicator' ? '' : '%'}`).join(' 或 ') || '无'}</p>
        <p>探测算法：{!detailSetting.detectorsKnown ? '历史算法未记录' : detailSetting.detectors.map(g => `${g.label} ${g.snapshot.direction ?? '>'} ${g.snapshot.threshold}`).join('；') || '无探测算法'}</p>
        <p>买入时刻：{date(detail.enteredAt)} · {detailSetting.observeHours === 0 ? '持续至卖出' : `观察 ${detailSetting.observeHours} 小时`}</p>
        <p>模拟金额：{detailSetting.notional} USDT · {detailSetting.leverage} 倍</p>
        {detail.filterStatus.detail && <p className="text-muted-foreground">{detail.filterStatus.detail}</p>}
        {detail.result?.reason && <p className="text-muted-foreground">{detail.result.reason}</p>}
        <details><summary className="cursor-pointer text-primary">公式快照</summary><div className="mt-2 space-y-3"><Formula label={detailSetting.plan.label} snapshot={detailSetting.plan.snapshot}/>{detailSetting.plan.buyFilters?.map(f => <Formula key={f.id} label={`买前过滤 · ${f.label}`} snapshot={f.snapshot}/>)}{activeHoldingVetoes(detailSetting.plan.holdingVetoes).filter(v => v.snapshot).map(v => <Formula key={v.id} label={`持仓否决 · ${v.label}`} snapshot={v.snapshot!}/>)}{detailSetting.detectors.map(g => <Formula key={g.id} label={`探测 · ${g.label}`} snapshot={g.snapshot}/>)}</div></details>
      </div>}
      <div className="min-h-0 overflow-auto rounded-md border border-border/60" data-testid="monitor-library-table">
        <table className="w-full whitespace-nowrap text-left text-[11px]"><thead className="sticky top-0 bg-background text-[10px] text-muted-foreground"><tr className="bg-muted/40">{['标的', '信号时间', '监测算法', '买前过滤', '结果', '收益', '静态回撤', '动态回撤', '保存时间'].map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>{visible.map(record => { const setting = settings.get(record.settingId)!, result: QualityResult | undefined = resultVisible(record, setting) ? record.result : undefined; return <tr key={record.id} className="border-t border-border/40 hover:bg-muted/20" data-testid="monitor-library-row">
            <td className="px-3 py-2 font-mono"><button type="button" className="hover:text-primary hover:underline disabled:cursor-default disabled:no-underline disabled:hover:text-inherit" disabled={!onJump || !!canJump && !canJump(record.source)} onClick={() => { setOpen(false); onJump?.(record.source); }}>{record.source.symbol}</button></td>
            <td className="px-3 py-2 font-mono text-muted-foreground" title={`买入时刻：${date(record.enteredAt)}`}>{date(record.source.timeMs)}</td>
            <td className="px-3 py-2"><button type="button" className="inline-flex max-w-56 items-center gap-1 text-primary hover:underline" title={qualityRuleLabel(setting.plan)} aria-label={`查看 ${record.source.symbol} ${qualityRuleLabel(setting.plan)} 监测条件`} onClick={() => setDetailId(detailId === record.id ? '' : record.id)}><span className="truncate">{qualityRuleLabel(setting.plan)}</span><ChevronDown aria-hidden className="h-3 w-3 shrink-0"/></button></td>
            <td className="max-w-52 truncate px-3 py-2 text-muted-foreground" title={buying(setting)}>{buying(setting)}</td>
            <td className="px-3 py-2 text-muted-foreground">{status(record, setting)}</td>
            <td className={`px-3 py-2 font-mono ${result?.returnPct! > 0 ? 'text-emerald-600' : result?.returnPct! < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{pct(result?.returnPct)}</td>
            <td className="px-3 py-2 font-mono">{pct(qualityDrawdownPct(result, 'static')).replace(/^\+/, '')}</td><td className="px-3 py-2 font-mono">{pct(qualityDrawdownPct(result, 'dynamic')).replace(/^\+/, '')}</td>
            <td className="px-3 py-2 font-mono text-muted-foreground" title={date(record.updatedAt)}>{date(record.updatedAt).slice(5, 16)}</td>
          </tr>; })}</tbody>
        </table>
        {!records.length && <p className="px-4 py-8 text-center text-[11px] text-muted-foreground">{library?.records.length ? '没有匹配的监测记录。' : '暂无监测记录。开始持仓监测后，每轮会自动保存。'}</p>}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>共 {records.length} 条 · {currentPage + 1} / {pages} 页</span><div className="flex gap-1"><button type="button" className={action} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><button type="button" className={action} disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></div></div>
    </DialogContent>
  </Dialog>;
}
