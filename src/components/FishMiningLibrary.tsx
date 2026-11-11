import {FishLibraryTimeDirectory,type FishDirectoryItem,type FishDirectoryRequest} from './FishLibraryTimeDirectory';
import {FishLibraryDataActions} from './FishLibraryTransferContext';
import {miningAlgorithmDirectories,miningFamilyLibrary,miningDirectoryStudy} from '@/lib/fish/miningLibraryDirectory';
import {downloadDirectoryTables} from '@/lib/fish/qualityLibraryDirectory';
import type {FishQualityStudy} from '@/lib/fish/quality';
import {useFishBulkDelete} from './FishBulkDeletion';
import { miningRecordDeleteTargets } from '@/lib/fish/libraryDeletion';
import { miningLibraryConditions, libraryConditionSearch } from '@/lib/fish/libraryConditions';
import { FishLibraryCondition, libraryReading } from '@/components/FishLibraryConditions';
/** 捕捞库：批量捕捞每一档的扫描与挖到的信号（数据见 lib/fish/miningLibrary，存 IndexedDB 并随账号同步）。 */
import { useCallback, useEffect,useRef, useMemo, useState, type ReactNode } from 'react';
import { FishLibraryDialog, libraryCell } from '@/components/FishLibraryDialog';
import { emptyMiningLibrary, miningRecordSignal, type FishMiningLibrary, type FishMiningRecord, type FishMiningRun } from '@/lib/fish/miningLibrary';
import { loadMiningLibrary, MINING_LIBRARY_EVENT } from '@/lib/fish/miningLibraryStore';
import { fishVisibleCatchKey } from '@/lib/fish/records';
import { formatUTC8 } from '@/lib/timeFormat';
import { miningCaptureTime } from '@/lib/fish/qualitySources';
import type { TradeSignal } from '@/lib/signalLibrary';

const date = (t: number | null | undefined) => t == null ? '—' : formatUTC8(t);
const short = (t: number) => formatUTC8(t).slice(0, 16);
const RULE_NAMES: Record<string, string> = { cbi2: 'CBI-2', state: 'S', cba: 'CBA', 'drift-speed': 'DSP·a', 'drift-speed-z': 'az', bss: 'BSS' };
const runText = (run: FishMiningRun) => run.rules.filter(rule => rule.enabled !== false).map(r => `${RULE_NAMES[r.featureId] ?? r.featureId} · ${r.statistic} ${r.direction ?? '>'} ${r.threshold}`).join(run.combination === 'and' ? ' ∩ ' : ' ∪ ');
/** 实际捕到这条信号的探测算法（并集只列命中的，交集列全部）。 */

type FishMiningRow = FishMiningRecord & { ids: string[]; minedAt: number | null };


type MiningDirectoryProps={openRequest?:FishDirectoryRequest;onSelectDirectory?:(id:string,s:FishQualityStudy,ids?:string[])=>Promise<boolean>;directoryEdits?:Record<string,{hidden:boolean;at:number}>;onSetHidden?:(id:string,hidden:boolean)=>Promise<boolean>;account?:string;holdKeys?:()=>ReadonlySet<string>;onJump?:(s:TradeSignal)=>void;canJump?:(s:TradeSignal)=>boolean;onSelectInTable?:(signals:readonly TradeSignal[])=>boolean;renderStudy?:(s:FishQualityStudy)=>ReactNode;onCopyStudy?:(s:FishQualityStudy)=>Promise<boolean>};
export function FishMiningLibrary(props:MiningDirectoryProps){
 const {account,renderStudy,onCopyStudy,directoryEdits,onSetHidden,openRequest,onSelectDirectory}=props;
 const [library,setLibrary]=useState<FishMiningLibrary>(emptyMiningLibrary),[open,setOpen]=useState(false),[loadError,setLoadError]=useState('');
 const generation=useRef(0);
 useEffect(()=>{const epoch=++generation.current;setLibrary(emptyMiningLibrary());setLoadError('');if(!open)return;
  const reload=()=>{void loadMiningLibrary(account).then(value=>{if(generation.current===epoch)setLibrary(value);},()=>{if(generation.current===epoch)setLoadError('读取捕捞库失败，请关闭后重试');});};
  reload();const refresh=(e:Event)=>{if(((e as CustomEvent).detail?.owner??null)===(account??null))reload();};window.addEventListener(MINING_LIBRARY_EVENT,refresh);return()=>{generation.current=epoch+1;window.removeEventListener(MINING_LIBRARY_EVENT,refresh);};
 },[open,account]);
 const directories=useMemo(()=>miningAlgorithmDirectories(library),[library]);
 const items:FishDirectoryItem[]=directories.map(d=>({id:d.id,at:0,label:d.family+' 系列',summary:d.records.length+' 条记录',revision:library,study:()=>miningDirectoryStudy(d.records,d.family),details:close=><details className="m-4 text-[11px]"><summary className="cursor-pointer text-muted-foreground">挖掘记录详情</summary><FishMiningRecords {...props} librarySource={miningFamilyLibrary(library,d.records)} onClose={close}/></details>}));
 return <FishLibraryTimeDirectory openRequest={openRequest} onSelectDirectory={onSelectDirectory} name="捕捞库" prefix="mining" kind="algorithm" items={items} edits={directoryEdits} onSetHidden={onSetHidden} renderStudy={renderStudy} onCopyStudy={onCopyStudy} onOpenChange={setOpen} recordCount={library.records.length}
  description={`${library.records.length} 条记录 · ${directories.length} 类算法 · ${library.anchors.length} 档`} dataActions={<FishLibraryDataActions scope="mining"/>} download={()=>downloadDirectoryTables('捕捞库',directories.map(d=>({id:d.id,study:miningDirectoryStudy(d.records,d.family)})))}
  info={<><p>与监测库共用目录布局和操作，按实际命中的算法大类归档。CDA、BSS、CBI-2 等同系列的门槛、周期和版本放在同一个目录，原始条件和读数分别保留。</p><p>一个记录命中多个系列时，可在对应目录分别查看；原始信号不复制入库。展开后展示组合表，可复制至主组合表，复制前先完整归档当前表。</p>{loadError&&<p role="alert">{loadError}</p>}</>}
  empty={loadError||'暂无挖掘记录。开始批量捕捞后，每一档会自动保存。'}/>;
}
function FishMiningRecords({ onJump, canJump, onSelectInTable,librarySource,onClose }: MiningDirectoryProps & {librarySource:FishMiningLibrary;onClose:()=>void}) {
  const bulk=useFishBulkDelete(),[selected,setSelected]=useState<Set<string>>(()=>new Set());
  const [direction, setDirection] = useState<'none' | 'ascending' | 'descending'>('none');
  const library=librarySource;
  const [tableError,setTableError]=useState('');
  const runs = useMemo(() => new Map(library.runs.map(r => [r.id, r])), [library.runs]);
  const evidence=useMemo(()=>new Map(library.records.map(r=>[r.id,miningLibraryConditions(r,runs.get(r.runId))])),[library.records,runs]);
  const anchors = useMemo(() => [...library.anchors].sort((a, b) => b.anchorMs - a.anchorMs || b.scannedAt - a.scannedAt), [library.anchors]);
  const anchorOf = useMemo(() => new Map(library.anchors.map(a => [a.id, new Set(a.recordIds)])), [library.anchors]);
  // 【用户要求】2026-10-27「命中算法只显示探测算法（被哪个算法捕捉到的）」：只列实际命中的算法（并集看命中编号）。
  // 同一方案与档位里的算法别名重复项合并。重新开始的轮次各自保留，便于核对和删除。
  const byAnchor = useMemo(() => {
    const rows = new Map<string, FishMiningRow>();
    for (const record of library.records) {
      const key = `${record.runId}|${record.anchorMs}|${fishVisibleCatchKey(record.signal)}|${evidence.get(record.id)!.identity}`, prior = rows.get(key);
      const minedAt = miningCaptureTime(miningRecordSignal(record));
      if (!prior) rows.set(key, { ...record, ids: [record.id], minedAt });
      else {
        const latest = prior.updatedAt >= record.updatedAt ? prior : record;
        rows.set(key, { ...latest, ids: [...prior.ids, record.id], minedAt: (latest === prior ? prior.minedAt : minedAt) ?? prior.minedAt ?? minedAt });
      }
    }
    return [...rows.values()].sort((a, b) => b.anchorMs - a.anchorMs || b.signal.timeMs - a.signal.timeMs || a.signal.symbol.localeCompare(b.signal.symbol));
  }, [library.records, evidence]);
  const items = useMemo(() => {
    if (direction === 'none') return byAnchor;
    return [...byAnchor].sort((a, b) => {
      if (a.minedAt === null) return b.minedAt === null ? 0 : 1;
      if (b.minedAt === null) return -1;
      return direction === 'ascending' ? a.minedAt - b.minedAt : b.minedAt - a.minedAt;
    });
  }, [byAnchor, direction]);
  const multipleRuns = library.runs.length > 1;
  const options = anchors.map(a => ({ id: a.id, error: a.error, label: `${short(a.anchorMs)} 这一档 · ${a.error ? `出错${a.attempts > 1 ? `（已试 ${a.attempts} 次）` : ''}` : `扫到 ${a.found} · 新增 ${a.added}`}${multipleRuns ? ` · ${runText(runs.get(a.runId)!)}` : ''}` }));
  const match = useCallback((r: FishMiningRow, needle: string, anchorId: string) => {
    if (anchorId && !r.ids.some(id => anchorOf.get(anchorId)?.has(id))) return false;
    return !needle || r.signal.symbol.toUpperCase().includes(needle) || (r.minedAt !== null && date(r.minedAt).includes(needle)) || evidence.get(r.id)!.conditions.some(c=>libraryConditionSearch(c).toUpperCase().includes(needle));
  }, [anchorOf,evidence]);
  const errors = library.anchors.filter(a => a.error).length;
  const latestRun = [...library.runs].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const selectedItems = items.filter(row => selected.has(row.id));
  const selectedIds = () => selectedItems.flatMap(row => row.ids);
  const selectInTable = () => {
    const ids = new Set(selectedIds());
    const signals = library.records.filter(record => ids.has(record.id)).map(miningRecordSignal);
    if (onSelectInTable?.(signals)) return true;
    setTableError('这批记录暂未在组合表中找到，请刷新捕捞库后重试。');
    return false;
  };
  return <FishLibraryDialog embedded name="捕捞库" roundLabel="档位" rounds={options} placeholder="搜索标的、捕捞时间、指标或门槛…" onOpenChange={next => { if(!next)onClose(); setTableError(''); if (!next) setSelected(new Set()); }}
    description={`${items.length} 条信号 · ${library.anchors.length} 档${errors ? ` · ${errors} 档出错` : ''}`}
    info={<><p>批量捕捞逐档记录：扫到几条、新增几条、出错原因；挖到的每条信号保存当时的读数快照。命中算法逐条显示具体序列、方向、门槛、周期与历史公式版本，可展开核对公式和参数。</p><p>捕捞库、鱼舱和信号库独立并行，均可进入过滤库与监测库。删除一个来源不影响另两个库；同标的、同信号和入场时刻的下游结果合并显示，仍有其他来源时保留。「捕捞时间」是实际捕捞到信号的北京时间。每轮结果单独保留，同一轮内相同档位与算法条件的重复记录合并显示。可搜索旧门槛，再勾选要删除的记录。随账号保存。</p>{latestRun && <p className="text-muted-foreground">批量捕捞方案：{runText(latestRun)}；从 {short(latestRun.startMs)} 起，{latestRun.scan?.continuous ? '连续扫描' : `每 ${latestRun.stepMs / 3_600_000} 小时一档`}</p>}</>}
    headers={['标的', '信号时间', '扫描档位', '命中算法', '读数', '捕捞时间']}
    sortColumn={{ label: '捕捞时间', direction, toggle: () => setDirection(current => current === 'descending' ? 'ascending' : 'descending') }}
    items={items} match={match} detail={tableError && <p role="alert" className="text-xs text-destructive">{tableError}</p>}
    selection={bulk || onSelectInTable ? {
      selected: new Set(selectedItems.map(row => row.id)),
      select: ids => { setSelected(new Set(ids)); setTableError(''); },
      action: onSelectInTable ? selectInTable : undefined,
      remove: bulk ? () => {
        const ids = selectedIds();
        bulk({ kind: 'mining', ids, targets: miningRecordDeleteTargets(library.records, new Set(ids)) });
      } : undefined,
    } : undefined}
    empty={{ none: '暂无挖掘记录。开始批量捕捞后，每一档会自动保存。', unmatched: '没有匹配的挖掘记录。' }}
    row={(r, onCheck) => {
      const saved=evidence.get(r.id)!;
      return <tr key={r.id} className="border-t border-border/40 hover:bg-muted/20" data-testid="mining-library-row">
        {onCheck && <td className={libraryCell}>
          <input type="checkbox" aria-label={`选择挖掘记录 ${r.signal.symbol} ${r.id}`} checked={selected.has(r.id)}
            title="按住 Shift 点另一行可连续选择"
            onMouseDown={e => { if (e.shiftKey) e.preventDefault(); }}
            onChange={e => onCheck(e.target.checked, (e.nativeEvent as MouseEvent).shiftKey === true)}/>
        </td>}
        <td className={`${libraryCell} font-mono`}><button type="button" className="hover:text-primary hover:underline disabled:cursor-default disabled:no-underline disabled:hover:text-inherit" disabled={!onJump || !!canJump && !canJump(r.signal)} onClick={() => onJump?.(r.signal)}>{r.signal.symbol}</button></td>
        <td className={`${libraryCell} font-mono text-muted-foreground`}>{date(r.signal.timeMs)}</td>
        <td className={`${libraryCell} font-mono text-muted-foreground`}>{short(r.anchorMs)}</td>
        <td className={`${libraryCell} min-w-[320px] max-w-[440px] align-top`}><p className="mb-1 text-[9px] text-muted-foreground">{saved.combination}</p><div className="space-y-1.5">{saved.conditions.map((c,i)=><FishLibraryCondition key={i} condition={c}/>)}</div>{saved.note&&<p className="mt-1 whitespace-normal text-[10px] text-muted-foreground">{saved.note}</p>}</td>
        <td className={`${libraryCell} min-w-[180px] align-top font-mono tabular-nums`}><p className="mb-1 font-sans text-[9px] text-muted-foreground">与左侧算法逐项对应</p><div className="space-y-1.5">{saved.conditions.map((c,i)=><div key={i} className="min-h-9"><p className="text-foreground">{c.metric} = {libraryReading(c.reading)}</p>{c.rawReading!==undefined&&c.reading===undefined?<p className="text-[9px] text-muted-foreground">原值 {libraryReading(c.rawReading)} · 显示倍率未记录</p>:<p className="text-[9px] text-muted-foreground">{c.snapshot.scale===1?'原值':`原值 × ${c.snapshot.scale??'未知'}`}</p>}</div>)}</div></td>
        <td className={`${libraryCell} font-mono text-muted-foreground`} title={`入库时间：${date(r.firstSavedAt)}`} data-testid="mining-library-mined-at">{date(r.minedAt)}</td>
      </tr>;
    }}/>;
}
