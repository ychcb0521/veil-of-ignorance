import {mergeLibraryDirectoryEdits} from '@/lib/fish/libraryDirectoryEdits';
import {newPreEntryHours} from '@/lib/fish/preEntryActivePlan';
import {FishPreEntryProgress} from './FishPreEntryProgress';
import {FishLibraryTimeDirectory,type FishDirectoryItem,type FishDirectoryRequest} from './FishLibraryTimeDirectory';
import {FishEntryLibraryDataActions} from './FishEntryLibraryDataActions';
import {entryDirectoryStudy,downloadDirectoryTables} from '@/lib/fish/qualityLibraryDirectory';
import type {FishQualityStudy} from '@/lib/fish/quality';
import { FishPreEntrySettings } from './FishPreEntrySettings';
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Filter, Pause, RotateCcw, Settings2 } from 'lucide-react';
import { libraryCell } from './FishLibraryDialog';
import { qualitySettingsAction, qualitySplitPrimaryAction, qualitySplitPauseAction, qualitySplitMenuAction } from './FishQualityModule';
import { Popover, PopoverTrigger } from './ui/popover';
import { FishPopoverContent as PopoverContent } from './FishPopoverContent';
import { formatUTC8 } from '@/lib/timeFormat';
import { preEntrySignal, PRE_ENTRY_ZERO_TRADE_VERSION, type PreEntryStatus, type PreEntryRound } from '@/lib/fish/preEntryMonitor';
import type { FishQualityState } from '@/hooks/useFishQuality';
import type { TradeSignal } from '@/lib/signalLibrary';
import { PRE_ENTRY_CONDITIONS_VERSION, preEntryConditionText, preEntryVetoes } from '@/lib/fish/preEntryConditions';
import { activeAdditionVetoes, additionVetoLabel } from '@/lib/fish/qualityAdditionVeto';
import { holdingVetoLabel } from '@/lib/fish/qualityVeto';
import { PRE_ENTRY_THREE_STAGE_VERSION, PRE_ENTRY_THREE_STAGE_V5, expressionConditions, preEntryPlanFilters, type EntryMarketExpression } from '@/lib/fish/preEntryThreeStage';

const STATUS: Record<PreEntryStatus, string> = { queued: '待监测', scanning: '监测中', paused: '已暂停', matched: '已满足', unmatched: '未满足', warming: '历史不足·待预热', error: '缺数据' };
const engineLabel = (round?: PreEntryRound) => round?.engine === PRE_ENTRY_THREE_STAGE_VERSION ? '分钟筛选 v6 · 三阶准入（⓪必要条件 → ①防守线 → ②排除）' : round?.engine === PRE_ENTRY_THREE_STAGE_V5 ? '分钟筛选 v5 · 三阶准入' : round?.engine === PRE_ENTRY_CONDITIONS_VERSION ? '分钟筛选 v4 · 入选与否决' : round?.engine === PRE_ENTRY_ZERO_TRADE_VERSION ? '分钟筛选 v3 · 图灵杯零成交等待' : round?.engine ? '分钟筛选 v2' : '收盘筛选 v1';
const stageStatus={pass:'通过',blocked:'排除',pending:'等待'} as const;
const guardKind={first:'首次产生',rebuild:'断裂后重建',raise:'价格上移',lower:'价格下移','type-change':'实虚切换'} as const;
const expressionText=(e:EntryMarketExpression):string=>'condition' in e?`${e.condition.label} ${e.condition.direction} ${e.condition.threshold}`: '('+e.children.map(expressionText).join(e.join==='all'?' 且 ':' 或 ')+')';
export function FishPreEntryMonitor({ state, selectedCount, filtersOn, onSelected, onJump, renderConditions,renderStudy,onCopyStudy,onSetHidden,openRequest,onSelectDirectory }: {
  state: FishQualityState; selectedCount: number; filtersOn: boolean; onSelected: () => void; onJump?: (signal: TradeSignal) => void;
  openRequest?:FishDirectoryRequest;onSelectDirectory?:(id:string,s:FishQualityStudy,ids?:string[])=>Promise<boolean>;
  onSetHidden?:(id:string,hidden:boolean)=>Promise<boolean>;
  renderStudy?:(study:FishQualityStudy)=>ReactNode;onCopyStudy?:(study:FishQualityStudy)=>Promise<boolean>;
  renderConditions?: (close: () => void) => ReactNode;
}) {
  const monitor = state.preEntry;
  const [selected, setSelected] = useState<string[]>([]), [message, setMessage] = useState('');
  const [menuOpen, setMenuOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false), [resultsOpen,setResultsOpen]=useState(false);
  const rounds = useMemo(() => new Map(monitor?.library.rounds.map(r => [r.id, r]) ?? []), [monitor?.library.rounds]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  if (!monitor) return null;
  const latestRound = [...monitor.library.rounds].sort((a, b) => a.startedAt - b.startedAt).at(-1);
  const resumable = latestRound?.state === 'paused' && latestRound.hours>0 ? latestRound : undefined;
  const records = [...monitor.library.records].sort((a, b) => b.updatedAt - a.updatedAt);
  const latestRecords = records.filter(r => r.roundId === latestRound?.id);
  const missingCount = latestRecords.filter(r => r.status === 'error').length;
  const hours = newPreEntryHours(monitor.library.settings?.hours);
  const stagesFor=(r:typeof records[number])=>rounds.get(r.roundId)?.plans?.find(p=>p.id===r.planId)?.preEntryThreeStage;
  const filtersFor = (r: typeof records[number]) => { const round=rounds.get(r.roundId), plan=round?.plans?.find(p=>p.id===r.planId);return plan?.preEntryThreeStage?plan.preEntryThreeStage.required:plan?preEntryPlanFilters(plan):round?.filters??[]; };
  const exclusionsFor = (r: typeof records[number]) => { const round=rounds.get(r.roundId);return round?.engine===PRE_ENTRY_CONDITIONS_VERSION?round.plans?.find(p=>p.id===r.planId)?.preEntryConditions:undefined; };
  const readingLabel = (r:typeof records[number],key:string,index:number) => (rounds.get(r.roundId)?.engine?filtersFor(r).find(f=>f.id===key):filtersFor(r)[index])?.label ?? stagesFor(r)?.sellRules.flatMap(s=>expressionConditions(s.expression)).find(c=>c.id===key)?.label ?? stagesFor(r)?.hardVetoes.find(v=>'hard:'+v.id===key)?.label ?? r.threeStage?.readings.find(reading=>reading.id===key)?.label ?? preEntryVetoes(exclusionsFor(r)).find(v=>v.id===key)?.label ?? key;
  const canStart = monitor.ready && state.ready && selectedCount > 0 && filtersOn;
  const admitted = records.filter(r => r.status === 'matched');
  const selectedOnly=true;
  const renderEvidence=(roundId:string,close:()=>void)=><details className="m-4 text-[11px]"><summary className="cursor-pointer text-muted-foreground">入选判定详情</summary>
    <div className="my-2 flex items-center gap-2"><label><input type="checkbox" aria-label="全选当前筛选的筛选库记录" checked={admitted.filter(r=>r.roundId===roundId).every(r=>selectedSet.has(r.id))} onChange={e=>setSelected(e.target.checked?admitted.filter(r=>r.roundId===roundId).map(r=>r.id):[])}/> 全选本轮</label>
    <button type="button" className="text-primary" onClick={()=>{const count=state.selectPreEntryRecords?.(selected)??0;if(!count){setMessage('请至少选择一条“已满足”的记录');return;}setMessage('');onSelected();close();}}>在组合表中勾选</button></div>{message&&<p role="alert" className="text-xs text-destructive">{message}</p>}
    <div className="overflow-auto"><table className="w-full text-[11px]"><thead><tr>{['选择','标的','原信号 / 监测起点','监测条件','状态与原因','扫描到','首次满足时间','命中读数','操作'].map(h=><th key={h} className={libraryCell}>{h}</th>)}</tr></thead><tbody>{admitted.filter(r=>r.roundId===roundId).map(r=>{const onCheck=(checked:boolean,_shift?:boolean)=>setSelected(ids=>checked?[...new Set([...ids,r.id])]:ids.filter(id=>id!==r.id));return <tr key={r.id} data-testid={selectedOnly ? "pre-entry-library-row" : "pre-entry-scan-row"} className="border-t border-border/40">
        {selectedOnly && <td className={libraryCell}><input type="checkbox" aria-label={`选择入选记录 ${r.sample.source.symbol} ${r.id}`} checked={selectedSet.has(r.id)} onChange={e => onCheck?.(e.target.checked, (e.nativeEvent as MouseEvent).shiftKey)}/></td>}
        <td className={`${libraryCell} font-mono`}>{r.sample.source.symbol}</td>
        <td className={`${libraryCell} text-muted-foreground`}>{formatUTC8(r.sample.source.timeMs)}<br/>{formatUTC8(r.startTime)}</td>
        <td className={`${libraryCell} max-w-80 whitespace-normal`}>{filtersFor(r).map(f => <p key={f.id} title={f.snapshot.definitionKey}>{f.label} {f.direction} {f.threshold} · {f.snapshot.interval}</p>)}{activeAdditionVetoes(exclusionsFor(r)?.entryVetoes).map(v=><p key={v.kind}>入选前否决：{additionVetoLabel(v).replace(/持仓/g,'筛选').replace(/不再加仓/g,'不入选')}</p>)}{preEntryVetoes(exclusionsFor(r)).map(v=><p key={v.id}>{v.id.startsWith('sellVetoes:')?'卖出排除':'硬性终止排除'}：{preEntryConditionText(holdingVetoLabel(v))}</p>)}{stagesFor(r)&&<details className="text-[10px]"><summary>三阶冻结条件</summary><p>⓪ 必要条件：{stagesFor(r)!.required.filter(f=>f.enabled).map(f=>expressionText({condition:f})).join(' 且 ')||'未启用'}</p><p>② 加仓否决：{activeAdditionVetoes(stagesFor(r)!.additionVetoes).map(additionVetoLabel).join('；')||'未启用'}</p>{stagesFor(r)!.sellRules.filter(s=>s.enabled).map(s=><p key={s.id}>② 卖出：{expressionText(s.expression)}；每 {s.confirmation.minutes} 分钟连续 {s.confirmation.samples} 次</p>)}{stagesFor(r)!.hardVetoes.filter(v=>v.enabled).map(v=><p key={v.id}>② 硬终止：{preEntryConditionText(holdingVetoLabel(v))}</p>)}<p>① 防守线：首次／重建、上移／下移、实虚切换；同价同型延续不算。</p></details>}<p className="text-[10px] text-muted-foreground">{engineLabel(rounds.get(r.roundId))}</p></td>
        <td className={`${libraryCell} max-w-80 whitespace-normal`}><span className={r.status === 'matched' ? 'text-emerald-600' : r.status === 'error' ? 'text-destructive' : ''}>{STATUS[r.status]}</span><p className="text-[10px] text-muted-foreground">{r.detail}</p>{r.threeStage&&<details className="text-[10px]"><summary>三阶判定证据</summary>{(()=>{const ev=r.threeStage!,guard=ev.event?`${guardKind[ev.event.kind]} · ${ev.event.price} · ${ev.event.regime==='trend'?'实线':'虚线'}`:'等待新线';const rows:(readonly [string,keyof typeof stageStatus,string|undefined][]) = ev.zero
  ? [['⓪ 必要条件',ev.zero.status,ev.zero.reason],['① 防守线',ev.event?'pass':'pending',guard],['② 排除门槛',ev.second.status,ev.second.reason]]
  : [['一阶',ev.first.status,ev.first.reason],['二阶',ev.second.status,ev.second.reason],['三阶',ev.event?'pass':'pending',guard]];
  return rows.map(([label,status,reason])=><p key={label}>{label}：{stageStatus[status]} {reason}</p>);})()}{r.threeStage.event&&<><p>事件：{r.threeStage.event.id} · {formatUTC8(r.threeStage.event.at)}</p><p>原生箱体：{r.threeStage.event.boxId} · 分段 {r.threeStage.event.segment}</p><p>版本：{r.threeStage.event.algorithmVersion} / {r.threeStage.event.guardVersion}</p><p>初始化：{formatUTC8(r.threeStage.event.initializationStart)} · {r.threeStage.event.initializationId}</p><p>参数：{JSON.stringify(r.threeStage.event.parameters)}</p></>}{r.missedGuard&&<p>错过新线 {r.missedGuard.count} 次；最近 {formatUTC8(r.missedGuard.event.at)}：{r.missedGuard.reason}</p>}</details>}{r.zeroTradeWait&&<p className="text-[10px] text-muted-foreground">零成交及读数恢复期间等待 {r.zeroTradeWait.count} 个分钟观测，未判定入选；首次 {formatUTC8(r.zeroTradeWait.firstAt)}，最近 {formatUTC8(r.zeroTradeWait.lastAt)}</p>}</td>
        <td className={libraryCell}>{formatUTC8(Math.min(r.cursor, r.endTime ?? r.cursor))}</td>
        <td className={libraryCell}>{r.matchedAt ? formatUTC8(r.matchedAt) : '—'}</td>
        <td className={libraryCell}>{r.readings.map((reading, i) => <p key={reading.key}>{readingLabel(r,reading.key,i)}: {reading.value == null ? '—' : +reading.value.toPrecision(6)}{reading.at && <span className="ml-1 text-[10px] text-muted-foreground">{formatUTC8(reading.at)}</span>}</p>)}{r.lastVeto&&<p className="text-[10px] text-muted-foreground">曾被否决 {r.lastVeto.count} 个分钟观测 · 最近 {formatUTC8(r.lastVeto.at)}：{r.lastVeto.reason}</p>}</td>
        <td className={libraryCell}>{r.status === 'matched' && onJump && <button type="button" className="text-primary" onClick={() => { const signal = preEntrySignal(r); if (signal) onJump(signal); }}>K 线</button>}
          {!selectedOnly && (r.status === 'error' || rounds.get(r.roundId)?.state === 'paused') && <button type="button" disabled={monitor.running} className="text-primary disabled:opacity-40" onClick={() => void monitor.resume(r.roundId)}>{r.status === 'error' ? '重试本轮缺数据' : '继续本轮'}</button>}</td>
      </tr>;})}</tbody></table></div></details>;
  const directoryItems:FishDirectoryItem[]=[...rounds.values()].filter(round=>admitted.some(r=>r.roundId===round.id)).map(round=>({id:round.id,at:round.startedAt,label:'入选轮次',summary:admitted.filter(r=>r.roundId===round.id).length+' 条记录 · '+(round.state==='running'?'运行中':round.state==='paused'?'已暂停':'已完成'),revision:monitor.library,study:()=>entryDirectoryStudy(monitor.library,round),details:close=>renderEvidence(round.id,close)}));
  const renderLibrary=()=> <FishLibraryTimeDirectory openRequest={openRequest} onSelectDirectory={onSelectDirectory} name="筛选库" prefix="pre-entry" items={directoryItems} edits={mergeLibraryDirectoryEdits(state.study?.monitorLibrary?.directoryEdits,monitor.library.directoryEdits)} onRename={state.renameLibraryEntry} onSetHidden={onSetHidden} onCopyStudy={onCopyStudy} renderStudy={renderStudy} recordCount={admitted.length}
    description={`仅收录满足全部条件的标的 · ${admitted.length} 条入选记录 · ${directoryItems.length} 轮`}
    dataActions={<FishEntryLibraryDataActions library={{...monitor.library,directoryEdits:mergeLibraryDirectoryEdits(state.study?.monitorLibrary?.directoryEdits,monitor.library.directoryEdits)}} onImport={monitor.importLibrary}/>}
    download={()=>downloadDirectoryTables('筛选库',directoryItems.map(item=>({id:item.id,study:item.study() as FishQualityStudy})))}
    info={<><p>与监测库共用时间目录，按轮次保存入选组合表，目录菜单可编辑并保存名称。仅收录已满足记录，原信号、冻结条件、首次满足时间和判定证据保留；未入选的扫描记录仍保存在原库。</p><p>三阶方案使用分钟筛选 v6：⓪ 必要条件、① 防守线新事件、② 排除门槛（加仓否决／卖出／硬终止）同刻通过才入选；v5 旧轮次沿用原顺序，旧版筛选引擎已下线。</p><p>展开后可复制至组合表。复制前完整归档当前组合表，载入后不自动运行；完整下载与导入保留各版本历史，不改当前方案。</p></>}
    empty="暂无入选记录。满足全部条件后才会进入筛选库。"/>;
  return <div className="contents" data-testid="pre-entry-controls">
    <div role="group" aria-label="筛选运行" className="inline-flex h-6 shrink-0 items-stretch">
      {monitor.running ? <button type="button" className={qualitySplitPauseAction} onClick={monitor.pause}><Pause aria-hidden className="h-3 w-3"/>暂停筛选</button>
        : <button type="button" className={qualitySplitPrimaryAction} disabled={resumable ? !monitor.ready || !state.ready : !canStart}
          title={resumable ? '继续上轮：沿用已冻结的信号和条件，从暂停处继续筛选' : !filtersOn ? '先设置并启用筛选条件' : !selectedCount ? '当前筛选下没有已勾选的信号' : `对已勾选的 ${selectedCount} 条信号向后筛选，首次满足全部条件时保存到筛选库`}
          onClick={() => void (resumable ? monitor.resume(resumable.id) : monitor.start(Number(hours)))}><Filter aria-hidden className="h-3 w-3"/>开始筛选</button>}
      <Popover open={menuOpen} onOpenChange={setMenuOpen}><PopoverTrigger asChild><button type="button" aria-label="开始筛选的其他方式" disabled={!state.ready}
        className={`${qualitySplitMenuAction} ${monitor.running ? 'border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground' : 'border-primary/25 bg-primary/10 text-primary hover:border-primary/45 hover:bg-primary/20'}`}><ChevronDown aria-hidden className="h-3 w-3"/></button></PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1"><button type="button" disabled={!canStart} className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-muted disabled:opacity-40" onClick={() => { setMenuOpen(false); void monitor.restart(Number(hours)); }}>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium"><RotateCcw aria-hidden className="h-3 w-3"/>从头重新筛选</span><span className="text-[10px] leading-relaxed text-muted-foreground">保留历史轮次，按当前勾选和条件重新开始{monitor.running ? '；先停止当前批次' : ''}。</span></button>
          {latestRound&&<button type="button" className="w-full rounded px-2 py-1.5 text-left text-[11px] hover:bg-muted" onClick={()=>{setMenuOpen(false);setResultsOpen(true);}}>本轮筛选结果</button>}
          {latestRound && missingCount > 0 && <button type="button" disabled={monitor.running || !monitor.ready} className="w-full rounded px-2 py-1.5 text-left text-[11px] hover:bg-muted disabled:opacity-40" onClick={() => { setMenuOpen(false); void monitor.resume(latestRound.id); }}>重试本轮缺数据（{missingCount}）</button>}
          {!monitor.ready && !monitor.error && <p role="status" className="px-2 py-1.5 text-[10px] text-muted-foreground">正在读取筛选库…</p>}
          {monitor.error && <p role="alert" className="px-2 py-1.5 text-[10px] text-destructive">{monitor.error}{!monitor.ready && <button type="button" className="ml-1 underline" onClick={monitor.retry}>重试读取</button>}</p>}
        </PopoverContent>
      </Popover>
    </div>
    <Popover open={settingsOpen} onOpenChange={setSettingsOpen}><PopoverTrigger asChild><button type="button" className={`${qualitySettingsAction} ${filtersOn ? 'text-foreground' : ''}`} aria-label="动态筛选条件" title="设置动态筛选条件与时长"><Settings2 aria-hidden className="h-3 w-3"/>条件设置</button></PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="w-[46rem] max-w-[calc(100vw-2rem)] max-h-[min(85dvh,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain pb-0">
        {renderConditions?renderConditions(()=>setSettingsOpen(false)):<FishPreEntrySettings state={state} selectedCount={selectedCount} done={()=>setSettingsOpen(false)}/>}
      </PopoverContent>
    </Popover>
    {renderLibrary()}
    <FishPreEntryProgress monitor={monitor} open={resultsOpen} onOpenChange={setResultsOpen}/>
  </div>;
}
