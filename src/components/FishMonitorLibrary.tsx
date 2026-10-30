import {FishLibraryDataActions} from './FishLibraryTransferContext';
import {monitorRoundStudy} from '@/lib/fish/qualityMonitorArchive';
import { focusSignalKey, qualityFocusSignals, focusSignalLabel } from '@/lib/fish/qualityFocusSignals';
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRightCircle, ArrowUpRight, ChevronDown, Database, Download } from 'lucide-react';
import { Link, useInRouterContext } from 'react-router-dom';
import { monitorCampaignUnavailable, qualityMonitorCampaignPath } from '@/lib/fish/qualityMonitorCampaign';
import { FROM_FISH_QUALITY } from '@/lib/fish/qualityReturn';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FishQualityInfo } from '@/components/FishQualityModule';
import { qualityDefinition, type FishQualityStudy } from '@/lib/fish/quality';
import { qualityRuleLabel, qualityVersionedRuleLabel } from '@/lib/fish/qualityCampaignArchive';
import { qualityMonitorRoundRecordIds, type QualityMonitorSetting } from '@/lib/fish/qualityMonitorLibrary';
import { downloadMonitorRecords, monitorAlgorithmKey, monitorBuying as buying, monitorColumns, monitorDetectorKey, monitorDetectorLabel, monitorDetectors, monitorResult, monitorStatus, monitorValue, sortMonitorRecords, type MonitorSortKey } from '@/lib/fish/qualityMonitorTable';
import { activeHoldingVetoes } from '@/lib/fish/qualityVeto';
import { formatUTC8 } from '@/lib/timeFormat';
import type { TradeSignal } from '@/lib/signalLibrary';

const action = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40';
const field = 'h-7 min-w-0 rounded-md border border-transparent bg-muted/50 px-2 text-[11px] outline-none hover:bg-muted focus-visible:border-ring/60';
const cell = 'px-2 py-1.5';
const date = (t: number | null | undefined) => t == null ? '—' : formatUTC8(t);
const pct = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
function Formula({ label, snapshot }: { label: string; snapshot: QualityMonitorSetting['plan']['snapshot'] }) {
  let formula: string; try { formula = qualityDefinition(snapshot).formula; } catch { formula = snapshot.definitionKey; }
  return <div><p className="font-medium">{label} · {snapshot.interval}</p><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-mono text-[10px]">{formula}</pre></div>;
}
export function FishMonitorLibrary({ study, onJump, canJump, onOpenCampaign,renderStudy }: { study: FishQualityStudy; onJump?: (s: TradeSignal) => void; canJump?: (s: TradeSignal) => boolean; onOpenCampaign?:()=>void;renderStudy?:(snapshot:FishQualityStudy)=>ReactNode }) {
  const router=useInRouterContext();
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [roundId, setRoundId] = useState(''), [page, setPage] = useState(0), [detailId, setDetailId] = useState('');
  const [algorithm, setAlgorithm] = useState(''), [detector, setDetector] = useState(''), [sort, setSort] = useState<MonitorSortKey>('saved'), [ascending, setAscending] = useState(false), [exportError, setExportError] = useState('');
  const [zone,setZone]=useState<'directory'|'all'|'focus'>(renderStudy?'directory':'all'),[focusKey,setFocusKey]=useState(''),[archiveId,setArchiveId]=useState('');
  const focusSignals=useMemo(()=>open?qualityFocusSignals(study):[],[open,study]);
  const focusKeys=useMemo(()=>new Set(focusSignals.map(s=>s.key)),[focusSignals]);
  const library = study.monitorLibrary;
  const settings = useMemo(() => new Map((library?.settings ?? []).map(s => [s.id, s])), [library?.settings]);
  const rounds = useMemo(() => [...(library?.rounds ?? [])].reverse().sort((a, b) => b.startedAt - a.startedAt), [library?.rounds]);
  const directory=useMemo(()=>{
    const archives=library?.archives??[],frozenRounds=new Set(archives.map(a=>a.sourceRoundId));
    return [...archives.map(a=>({id:a.id,at:a.createdAt,archive:a,round:undefined})),...rounds.filter(r=>!frozenRounds.has(r.id)).map(r=>({id:r.id,at:r.startedAt,archive:undefined,round:r}))].sort((a,b)=>b.at-a.at||b.id.localeCompare(a.id));
  },[library?.archives,rounds]);
  const selectedArchive=directory.find(a=>a.id===archiveId);
  const archiveStudy=useMemo(()=>open&&zone==='directory'&&selectedArchive?(selectedArchive.archive?selectedArchive.archive.study:monitorRoundStudy(study,selectedArchive.round!)):undefined,[open,zone,selectedArchive,study]);
  const roundNumbers = useMemo(() => new Map(rounds.filter(r => !r.legacy).reverse().map((r, i) => [r.id, i + 1])), [rounds]);
  const selectedRound = rounds.find(r => r.id === roundId);
  const scoped = useMemo(() => {
    if (!open) return [];
    const ids = selectedRound && library ? new Set(qualityMonitorRoundRecordIds(library, selectedRound)) : null;
    return (library?.records ?? []).filter(r => settings.has(r.settingId) && (!ids || ids.has(r.id)) && (zone!=='focus'||focusKeys.has(focusSignalKey(r.source))&&(!focusKey||focusSignalKey(r.source)===focusKey)));
  }, [library, selectedRound, settings, open,zone,focusKey,focusKeys]);
  const algorithms = useMemo(() => {
    const choices = new Map<string, { label: string; count: number }>();
    for (const r of scoped) { const s = settings.get(r.settingId)!, key = monitorAlgorithmKey(s); const old = choices.get(key); choices.set(key, { label: qualityVersionedRuleLabel(s.plan), count: (old?.count ?? 0) + 1 }); }
    return [...choices].sort((a, b) => a[1].label.localeCompare(b[1].label, 'zh-CN'));
  }, [scoped, settings]);
  const detectors = useMemo(() => {
    const choices = new Map<string, { label: string; count: number }>();
    for (const r of scoped) for (const g of new Map(settings.get(r.settingId)!.detectors.map(g => [monitorDetectorKey(g), g])).values()) {
      const key = monitorDetectorKey(g), old = choices.get(key); choices.set(key, { label: monitorDetectorLabel(g), count: (old?.count ?? 0) + 1 });
    }
    return [...choices].sort((a, b) => a[1].label.localeCompare(b[1].label, 'zh-CN'));
  }, [scoped, settings]);
  const records = useMemo(() => {
    const needle = query.trim().toUpperCase();
    return sortMonitorRecords(scoped.filter(r => { const s = settings.get(r.settingId)!;
      return (!algorithm || monitorAlgorithmKey(s) === algorithm) && (!detector || s.detectors.some(g => monitorDetectorKey(g) === detector))
        && (!needle || [r.source.symbol, qualityVersionedRuleLabel(s.plan), monitorDetectors(s)].some(text => text.toUpperCase().includes(needle)));
    }), settings, sort, ascending);
  }, [scoped, query, algorithm, detector, settings, sort, ascending]);
  const changeSort = (key: MonitorSortKey) => { setSort(key); setAscending(sort === key ? !ascending : ['symbol', 'market', 'algorithm', 'buying', 'vetoes', 'status', 'detectors'].includes(key)); setPage(0); };
  const download = () => { try { downloadMonitorRecords(records, settings); setExportError(''); } catch (error) { setExportError(error instanceof Error ? error.message : '导出失败'); } };
  const pages = Math.max(1, Math.ceil(records.length / 50)), currentPage = Math.min(page, pages - 1), visible = records.slice(currentPage * 50, (currentPage + 1) * 50);
  const detail = open && detailId ? library?.records.find(r => r.id === detailId) : undefined, detailSetting = detail && settings.get(detail.settingId);
  const roundState = { running: '运行中', complete: '已完成', paused: '已暂停', failed: '失败' } as const;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" className={action} aria-label="打开监测库"><Database aria-hidden className="h-3 w-3"/>监测库</button></DialogTrigger>
    <DialogContent className="flex max-h-[85dvh] w-[calc(100vw-1.5rem)] max-w-[96vw] sm:max-w-[96vw] flex-col gap-3 overflow-y-auto overscroll-contain p-4 sm:p-5">
      <DialogHeader className="shrink-0 space-y-1 text-left">
        <div className="flex flex-wrap items-center gap-1.5 pr-6"><DialogTitle className="text-sm">监测库</DialogTitle><FishLibraryDataActions scope="monitor"/><FishQualityInfo label="监测库说明"><p>每轮冻结当时的算法、公式、门槛、买前过滤与持仓否决条件，随账号保存。</p><p>每条已形成的交易均可通过标的旁的「查看战役」打开，使用该记录的历史条件与结果；未买入或缺少成交数据的记录会说明原因。</p><p>导出包含当前筛选下所有页的记录；各表头可排序，缺失数值始终排在最后。历史条件按保存时的快照展示。</p><p>同标的、同信号时间、同买入时点且条件相同的记录合并，保留最新结果；每轮仍可单独查看。旧快照缺少的条件标为未记录。</p></FishQualityInfo><button type="button" className={`${action} ml-auto`} aria-label="导出监测库数据" title="下载当前筛选下全部记录（包括其他页），顺序与表格一致；附算法、公式和过滤读数" disabled={!records.length} onClick={download}><Download aria-hidden className="h-3 w-3"/>导出数据 <span className="font-mono tabular-nums">{records.length}</span></button></div>
        <DialogDescription className="text-[11px]">{library?.records.length ?? 0} 条记录 · {roundNumbers.size} 轮监测 · {library?.archives?.length??0} 份完整归档{rounds.some(r => r.legacy) ? ' · 含历史快照' : ''}</DialogDescription>
      </DialogHeader>
      <div className="flex shrink-0 items-center gap-1 rounded-lg bg-muted/50 p-1" role="tablist" aria-label="监测库分区">
        {([...renderStudy?[['directory','时间目录'] as const]:[],['all','全部记录'],['focus','重点信号区']] as const).map(([id,label])=><button type="button" key={id} role="tab" aria-selected={zone===id} className={`rounded-md px-3 py-1.5 text-[11px] transition-colors ${zone===id?'bg-background text-foreground shadow-sm':'text-muted-foreground hover:text-foreground'}`} onClick={()=>{setZone(id);setRoundId('');setAlgorithm('');setDetector('');setFocusKey('');setQuery('');setDetailId('');setPage(0);}}>{label}{id==='focus'&&<span className="ml-1.5 font-mono text-primary">{focusSignals.length}</span>}</button>)}
      </div>
      {zone==='directory'&&renderStudy&&<div className="space-y-3" data-testid="monitor-archive-directory">
        <p className="text-[11px] text-muted-foreground">按保存时间从新到旧排列。每次“从头重新计算”前，全部现有结果与当时参数冻结保存；点开使用持仓监测同一张总表。</p>
        {!directory.length&&<p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">暂无监测归档。点击“从头重新计算”时，会先归档当前已有的运行结果。</p>}
        {directory.map(item=><div key={item.id} className="rounded-lg border border-border/60" data-testid="monitor-archive-item">
          <button type="button" className="flex w-full flex-wrap items-center gap-3 p-3 text-left text-[11px] hover:bg-muted/40" aria-label={`打开监测归档 ${item.id}`} aria-expanded={archiveId===item.id} onClick={()=>setArchiveId(archiveId===item.id?'':item.id)}><ChevronDown className={`h-3 w-3 ${archiveId===item.id?'rotate-180':''}`}/><span className="font-mono">{date(item.at)}</span><span className="font-medium">{item.archive?'重算前完整归档':item.round?.legacy?'历史记录':'监测轮次'}</span><span className="text-muted-foreground">{item.archive?`${item.archive.study.results.length} 项运行结果`:`${qualityMonitorRoundRecordIds(library!,item.round!).length} 条记录 · ${roundState[item.round!.state]}`}</span></button>
          {archiveId===item.id&&archiveStudy&&<div className="border-t" data-testid="monitor-archive-content">{!item.archive&&<p className="px-4 pt-3 text-[10px] text-muted-foreground">早期轮次仅保存记录引用，重复条件可能已更新，展示当前仍保存的版本；未保存的探测值、入场读数和反事实保持缺失。重算前完整归档则保留当时的独立快照。</p>}{renderStudy(archiveStudy)}</div>}
        </div>)}
      </div>}
      {zone!=='directory'&&<>
      {zone==='focus'&&<div className="shrink-0 space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3" data-testid="monitor-focus-zone">
        <div className="flex flex-wrap items-center gap-2 text-[11px]"><span className="font-medium">重点信号区</span><span className="text-muted-foreground">{focusSignals.length} 次信号 · {focusSignals.filter(s=>s.resonance).length} 次已核实探测共振 · 截图指定 12 次</span></div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">自动回溯全部已有记录，并持续收录同一交易所、同一标的、同一信号时间同时命中 avg_CBI2_2 与 avg_CBA_2 的事件；avg 不算 avg₂，过滤与卖出算法不参与归类。收益沿用监测库实际结果。</p>
        <div className="max-h-32 overflow-auto rounded-md border border-border/40 bg-background"><table className="w-full text-left text-[10px]"><thead className="sticky top-0 bg-muted text-muted-foreground"><tr><th className="px-2 py-1 font-medium">重点信号</th><th className="px-2 py-1 font-medium">归入依据</th><th className="px-2 py-1 font-medium">监测记录</th></tr></thead><tbody>{focusSignals.map(event=><tr key={event.key} className="border-t border-border/30" data-testid="monitor-focus-signal"><td className="px-2 py-1"><button type="button" className={`text-left hover:underline ${focusKey===event.key?'text-primary':'text-foreground'}`} onClick={()=>{setFocusKey(focusKey===event.key?'':event.key);setQuery('');setAlgorithm('');setDetector('');setRoundId('');setPage(0);setDetailId('');}}>{focusSignalLabel(event)}</button></td><td className="px-2 py-1 text-muted-foreground">{event.specified?'截图指定':''}{event.specified&&event.resonance?' · ':''}{event.resonance?'探测共振':''}</td><td className="px-2 py-1 font-mono text-muted-foreground">{event.recordIds.length?`${event.recordIds.length} 条`:event.found?'待监测':'待匹配历史记录'}</td></tr>)}</tbody></table></div>
        {focusKey&&<button type="button" className="text-[10px] text-primary hover:underline" onClick={()=>{setFocusKey('');setPage(0);}}>查看全部重点信号</button>}
      </div>}
      <div className="flex shrink-0 flex-wrap gap-1.5">
        <input aria-label="搜索监测库" className={`${field} min-w-36 flex-1`} placeholder="搜索标的或算法…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); setDetailId(''); }}/>
        <select aria-label="监测库轮次" className={`${field} max-w-full sm:max-w-80`} value={roundId} onChange={e => { setRoundId(e.target.value); setAlgorithm(''); setDetector(''); setPage(0); setDetailId(''); }}><option value="">全部轮次</option>{rounds.map(r => <option key={r.id} value={r.id}>{r.legacy ? '历史记录' : `第 ${roundNumbers.get(r.id)} 轮 · ${date(r.startedAt)}`} · {roundState[r.state]}</option>)}</select>
        <select aria-label="监测库的监测算法" className={`${field} max-w-full sm:max-w-80`} value={algorithm} onChange={e => { setAlgorithm(e.target.value); setPage(0); setDetailId(''); }}><option value="">全部监测算法</option>{algorithms.map(([key, option]) => <option key={key} value={key}>{option.label}（{option.count}）</option>)}</select>
        <select aria-label="监测库的探测算法" className={`${field} max-w-full sm:max-w-64`} value={detector} onChange={e => { setDetector(e.target.value); setPage(0); setDetailId(''); }}><option value="">全部探测算法</option>{detectors.map(([key, option]) => <option key={key} value={key}>{option.label}（{option.count}）</option>)}</select>
      </div>
      {exportError && <p role="alert" className="text-[11px] text-destructive">{exportError}</p>}
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
      <div className="max-h-[50dvh] min-h-32 shrink-0 overflow-auto overscroll-contain rounded-lg border border-border/60" data-testid="monitor-library-table">
        <table className="w-full border-separate border-spacing-0 whitespace-nowrap text-left text-[10px]">
          <thead className="sticky top-0 z-20 bg-background text-[9px] font-medium text-muted-foreground"><tr className="bg-muted/40">{monitorColumns.map(([key, label]) => <th key={key} className={`${cell} font-medium ${key === 'symbol' ? 'sticky left-0 z-30 min-w-[160px] bg-muted' : ['time', 'entered', 'saved'].includes(key) ? 'min-w-[140px]' : ['algorithm', 'buying', 'vetoes', 'detectors'].includes(key) ? 'min-w-[180px] border-l border-border/40' : ''}`} aria-sort={sort === key ? ascending ? 'ascending' : 'descending' : 'none'}><button type="button" className="text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" aria-label={`监测库按${label}排序`} onClick={() => changeSort(key)}>{label}{sort === key ? ascending ? ' ↑' : ' ↓' : ''}</button></th>)}<th className={`${cell} font-medium`} aria-label="跳转">跳转</th></tr></thead>
          <tbody>{visible.map(record => {
            const setting = settings.get(record.settingId)!, result = monitorResult(record, setting);
            const jumpDisabled = !onJump || !!canJump && !canJump(record.source);
            const unavailable=monitorCampaignUnavailable(record,setting),href=qualityMonitorCampaignPath(record.id);
            const campaignLink=unavailable?<span className="text-muted-foreground/50" title={unavailable}>—</span>:router?<Link to={href} state={FROM_FISH_QUALITY} onClick={onOpenCampaign} className="inline-flex items-center gap-0.5 text-primary hover:underline" aria-label={`查看 ${record.source.symbol} 交易战役`} title="按这条监测记录的历史条件打开交易战役">查看战役<ArrowUpRight aria-hidden className="h-3 w-3"/></Link>:<a href={href} onClick={onOpenCampaign} className="inline-flex items-center gap-0.5 text-primary hover:underline" aria-label={`查看 ${record.source.symbol} 交易战役`}>查看战役<ArrowUpRight aria-hidden className="h-3 w-3"/></a>;
            const jump = () => { setOpen(false); onJump?.(record.source); };
            return <tr key={record.id} className="group hover:bg-accent/30" data-testid="monitor-library-row">{monitorColumns.map(([key]) => {
              const value = monitorValue(record, setting, key);
              let content: ReactNode = value ?? '—';
              if (key === 'symbol') content = <div className="flex items-center justify-between gap-3"><button type="button" className="rounded-sm hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:no-underline disabled:hover:text-inherit" disabled={jumpDisabled} onClick={jump}>{record.source.symbol}</button>{campaignLink}</div>;
              else if (key === 'algorithm') content = <button type="button" className="inline-flex items-start gap-1 text-left text-primary hover:underline" title={qualityVersionedRuleLabel(setting.plan)} aria-label={`查看 ${record.source.symbol} ${qualityRuleLabel(setting.plan)} 监测条件`} onClick={() => setDetailId(detailId === record.id ? '' : record.id)}><span className="max-w-80 whitespace-normal break-words">{qualityRuleLabel(setting.plan)}<span className="mt-0.5 block text-[9px] text-muted-foreground">{qualityVersionedRuleLabel(setting.plan).slice(qualityRuleLabel(setting.plan).length + 3)}</span></span><ChevronDown aria-hidden className="mt-0.5 h-3 w-3 shrink-0"/></button>;
              else if (['buying', 'vetoes', 'detectors'].includes(key)) content = <span className="block max-w-80 whitespace-normal break-words leading-relaxed">{value}</span>;
              else if (['time', 'entered', 'saved'].includes(key)) content = date(value as number | null);
              else if (['return', 'static', 'dynamic'].includes(key)) content = key === 'return' ? pct(value as number | null) : pct(value as number | null).replace(/^\+/, '');
              else if (key === 'held') content = typeof value === 'number' ? value < 1 ? `${Math.round(value * 60)} 分钟` : value < 48 ? `${value.toFixed(1)} 小时` : `${(value / 24).toFixed(1)} 天` : '—';
              return <td key={key} className={`${cell} border-t border-border/40 ${key === 'symbol' ? 'sticky left-0 z-10 bg-background font-mono group-hover:bg-accent' : ['algorithm', 'buying', 'vetoes', 'detectors'].includes(key) ? 'border-l border-border/40' : ['time', 'entered', 'saved', 'return', 'static', 'dynamic', 'held'].includes(key) ? 'font-mono tabular-nums' : ''} ${key === 'return' && typeof value === 'number' ? value > 0 ? 'text-emerald-600 dark:text-emerald-400' : value < 0 ? 'text-destructive' : 'text-muted-foreground' : ['static', 'dynamic'].includes(key) && typeof value === 'number' && value > 0 ? 'text-destructive' : key === 'symbol' ? '' : 'text-muted-foreground'}`} title={key === 'status' ? result?.reason ?? record.filterStatus.detail : key === 'entered' ? '模拟计划买入时刻；是否买入见结果列' : undefined}>{content}</td>;
            })}<td className={`${cell} border-t border-border/40`}><button type="button" aria-label={`跳转 ${record.source.symbol}`} className="text-primary disabled:opacity-30" disabled={jumpDisabled} onClick={jump}><ArrowRightCircle aria-hidden className="h-3.5 w-3.5"/></button></td></tr>;
          })}</tbody>
        </table>
        {!records.length && <p className="px-4 py-8 text-center text-[11px] text-muted-foreground">{zone==='focus'?'重点信号已收录；当前筛选下暂无监测结果，已有和新增结果会自动汇总到这里。':library?.records.length ? '没有匹配的监测记录。' : '暂无监测记录。开始持仓监测后，每轮会自动保存。'}</p>}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>共 {records.length} 条 · {currentPage + 1} / {pages} 页<span className="ml-3 hidden sm:inline">横向滚动查看完整条件</span></span><div className="flex gap-1"><button type="button" className={action} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><button type="button" className={action} disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></div></div>
      </>}
    </DialogContent>
  </Dialog>;
}
