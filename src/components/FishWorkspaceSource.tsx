import { createContext, useContext, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Database, Download } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { qualityComparisonRows, qualityEntryIdentity, type FishQualityStudy } from '@/lib/fish/quality';
import { filterDetectorReadings,percentilePosition,type FilterDetectorReading } from '@/lib/fish/filterDetectorReadings';
import { miningReadingsByEntry, type MiningDirectoryEvidence } from '@/lib/fish/miningLibraryDirectory';
import { libraryReading } from './FishLibraryConditions';
import { FishContinuousTable } from './FishContinuousTable';
import { qualitySignalTime } from '@/lib/fish/qualityAdmissionTime';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { formatUTC8 } from '@/lib/timeFormat';
import { isDelayedTuringReplaySample } from '@/lib/turingReplaySamples';

export const fishSourceButton = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40';
const field = 'h-7 min-w-36 rounded-md border border-border bg-background px-2 text-xs';

type ImportRows = (snapshot: FishQualityStudy, ids: readonly string[]) => boolean;

export const DirectoryImportContext = createContext<{
  onImport: ImportRows;
  onImportInformation?: (snapshot:FishQualityStudy, ids:readonly string[])=>Promise<boolean>;
  prepareImport?: {label:string; onClick?:()=>void};
} | undefined>(undefined);

export const FilterDetectorContext=createContext<readonly import('@/lib/fish/qualityFilterLibrary').QualityFilterRecord[]|undefined>(undefined);
const columns = { selected: '选取', symbol: '标的', market: '市场', algorithm:'探测算法', reading: '探测数值', percentile: '百分位', signalTime: '信号时间', entryTime: '入场时间' } as const;
const percentileHelp='同指标、公式、周期和单位下，小于或等于当前读数的有效捕捞读数占比。多项命中时按最高百分位排序。';
const rowKey=(row:{id:string})=>row.id;
type SortColumn = keyof typeof columns;
type SortDirection = 'ascending' | 'descending';
const collator = new Intl.Collator('zh-CN', {numeric:true});
function compareValues(a:string|number|null, b:string|number|null, direction:SortDirection) {
  if(a===null)return b===null?0:1;
  if(b===null)return -1;
  const result=typeof a==='number'&&typeof b==='number'?a-b:collator.compare(String(a),String(b));
  return direction==='ascending'?result:-result;
}

export type WorkspaceRowsProps={
  snapshot: FishQualityStudy; onImport?: ImportRows; onDone?: () => void; initiallySelected?:boolean; mining?:MiningDirectoryEvidence;
  prepareImport?: { label: string; onClick?: () => void };
};
export const ArchiveRowsRenderer=createContext<((props:WorkspaceRowsProps)=>React.ReactNode)|undefined>(undefined);
export function FishWorkspaceRows(props:WorkspaceRowsProps){
  const renderBoard=useContext(ArchiveRowsRenderer);
  return renderBoard?renderBoard(props):<StandaloneWorkspaceRows {...props}/>;
}
export function useDirectoryDetectorReadings(mining?:MiningDirectoryEvidence, samples?:FishQualityStudy['samples']){
  const {family,series,records,runs}=mining??{};
  const filterRecords=useContext(FilterDetectorContext);
  return useMemo(()=>{
    if(family&&records&&runs)return miningReadingsByEntry({family,series,records,runs});
    if(!filterRecords&&!samples?.some(sample=>sample.directoryInformation?.detectors?.length))return;
    const byEntry=new Map<string,FilterDetectorReading[]>();
    for(const sample of samples??[]){
      if(sample.directoryInformation?.detectors?.length){
        const key=qualityEntryIdentity(sample.source,sample.enteredAt);
        byEntry.set(key,[...new Map([...(byEntry.get(key)??[]),...sample.directoryInformation.detectors].map(reading=>[JSON.stringify(reading),reading])).values()]);
      }
    }
    for(const record of filterRecords??[]){
      const key=qualityEntryIdentity(record.sample?.source??record.source,record.sample?.enteredAt??record.enteredAt);
      const list=byEntry.get(key)??[];
      list.push(...filterDetectorReadings(record));byEntry.set(key,list);
    }
    return byEntry;
  },[family,series,records,runs,filterRecords,samples]);
}
function StandaloneWorkspaceRows({snapshot,onImport,onDone,mining,prepareImport,initiallySelected=false}:WorkspaceRowsProps){
  const [query,setQuery] = useState('');
  const [error,setError] = useState('');
  const [sort,setSort] = useState<{column:SortColumn;direction:SortDirection}>({column:'signalTime',direction:'descending'});
  const family=mining?.family,filterRecords=useContext(FilterDetectorContext);
  const showDetectors=!!(mining||filterRecords);
  const readingsByEntry=useDirectoryDetectorReadings(mining);
  const rows=useMemo(()=>qualityComparisonRows(snapshot).filter(row=>!isDelayedTuringReplaySample(row.source)).map(row=>{
    const signalTime=qualitySignalTime(row.source);
    const readings:FilterDetectorReading[]=readingsByEntry?.get(qualityEntryIdentity(row.source,row.enteredAt))??[];
    const reading=readings.reduce<number|null>((max,r)=>r.reading===undefined?max:Math.max(max??r.reading,r.reading),null);
    const percentile=readings.reduce<number|null>((max,r)=>r.percentile===undefined?max:Math.max(max??r.percentile,r.percentile),null);
    return {id:row.id, symbol:row.source.symbol, market:row.source.market==='us_stock'?'美股':EXCHANGE_NAMES[row.source.exchange??'binance'],
      algorithm:readings.map(r=>r.metric).join('、'),signalTime,entryTime:row.enteredAt&&row.enteredAt!==signalTime?row.enteredAt:null, readings,reading,percentile};
  }).sort((a,b)=>b.signalTime-a.signalTime),[snapshot,readingsByEntry]);
  const [selected,setSelected] = useState<ReadonlySet<string>>(() => new Set(initiallySelected ? rows.map(row=>row.id) : []));
  const found=useMemo(()=>{
    const needle=query.trim().toUpperCase();
    return needle?rows.filter(row=>row.symbol.toUpperCase().includes(needle)):rows;
  },[rows,query]);
  const sortSelection=sort.column==='selected'?selected:undefined;
  const sorted=useMemo(()=>{
    const {column,direction}=sort;
    if(column==='signalTime'&&direction==='descending')return found;
    return [...found].sort((a,b)=>column==='selected'
      ?compareValues(Number(sortSelection?.has(a.id)),Number(sortSelection?.has(b.id)),direction)
      :compareValues(a[column],b[column],direction));
  },[found,sort,sortSelection]);
  const eligibleSelected = useMemo(() => rows.filter(row => selected.has(row.id)).map(row => row.id), [rows, selected]);
  const checked = !!found.length && found.every(row => selected.has(row.id));
  function header(column:SortColumn){
    const active=sort.column===column;
    const Icon=active?(sort.direction==='ascending'?ArrowUp:ArrowDown):ArrowUpDown;
    const label=filterRecords&&column==='percentile'?'百分位位置':columns[column];
    return <th scope="col" className={'whitespace-nowrap px-2 py-1.5 '+(column==='selected'?'w-10':'')} aria-sort={active?sort.direction:undefined}>
      {<button type="button" className="inline-flex items-center gap-1 hover:text-primary" aria-label={'按'+label+'排序'}
        title={column==='percentile'?percentileHelp:column==='reading'?'同系列有多项命中时，按最大已知读数排序':'按'+label+'排序'} onClick={()=>{
          setSort(prior=>({column,direction:prior.column===column?(prior.direction==='ascending'?'descending':'ascending'):
            column==='symbol'||column==='market'?'ascending':'descending'}));
        }}>{label}<Icon aria-hidden="true" className={'h-3 w-3 '+(active?'text-primary':'text-muted-foreground')}/></button>}
    </th>;
  }
  const toggle = (ids: readonly string[], enabled: boolean) => setSelected(prior => {
    const next = new Set(prior);
    for (const id of ids) if (enabled) next.add(id); else next.delete(id);
    return next;
  });
  const headings=<tr>{onImport&&header('selected')}{header('symbol')}{header('market')}{filterRecords&&header('algorithm')}{showDetectors&&header('reading')}{showDetectors&&header('percentile')}{header('signalTime')}{header('entryTime')}</tr>;
  const renderRow=(row:typeof rows[number])=><tr key={row.id} className="[&>td]:border-t [&>td]:border-border/50">
    {onImport&&<td className="px-2 py-1"><input type="checkbox" aria-label={`选取 ${row.symbol} ${formatUTC8(row.signalTime)}`} checked={selected.has(row.id)} onChange={e=>toggle([row.id],e.target.checked)}/></td>}
    <td className="px-2 py-1 font-medium">{row.symbol}</td>
    <td className="px-2 py-1 text-muted-foreground">{row.market}</td>
    {filterRecords&&<td>{row.readings.length?row.readings.map((r,i)=><div key={i}>{r.metric}</div>):'未记录'}</td>}
    {showDetectors&&<>
      <td className="whitespace-nowrap px-2 py-1 font-mono tabular-nums">{row.readings.length?row.readings.map((r,i)=>
        <div key={i} title={r.metric}>{!filterRecords&&row.readings.length>1&&<span className="mr-1 text-muted-foreground">{r.metric}</span>}
          {filterRecords&&r.reading!==undefined?String(r.reading):r.reading===undefined&&r.rawReading!==undefined?`原值 ${libraryReading(r.rawReading)}（倍率未记录）`:libraryReading(r.reading)}</div>):'未记录'}</td>
      <td className="whitespace-nowrap px-2 py-1 font-mono tabular-nums">{row.readings.length?row.readings.map((r,i)=>
        <div key={i} title={r.sampleCount?`${r.metric} · ${r.sampleCount} 个有效读数`:r.metric}>{filterRecords?percentilePosition(r):r.percentile===undefined?'—':r.percentile.toFixed(2)+'%'}</div>):'—'}</td>
    </>}
    <td className="px-2 py-1 font-mono">{formatUTC8(row.signalTime)}</td>
    <td className="px-2 py-1 font-mono">{row.entryTime ? formatUTC8(row.entryTime) : '—'}</td>
  </tr>;
  const empty=<p className="py-3 text-muted-foreground">{onImport?'没有可导入的记录。':'没有匹配的记录。'}</p>;
  return <div className="space-y-2 text-[11px]" data-testid="quality-workspace-source-rows">
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label="搜索来源标的" className={field} placeholder="搜索标的" value={query} onChange={e => setQuery(e.target.value)}/>
      {onImport && <><label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={checked} disabled={!found.length} onChange={e=>toggle(found.map(row=>row.id),e.target.checked)}/>全选搜索结果</label>
      <span className="text-muted-foreground">已选 {eligibleSelected.length} 条</span>
      <button type="button" className={fishSourceButton+' ml-auto text-primary'} disabled={!eligibleSelected.length || !!prepareImport && !prepareImport.onClick} onClick={()=>{
        if (prepareImport) { prepareImport.onClick?.(); return; }
        if(onImport(snapshot,eligibleSelected)){setSelected(new Set());setError('');onDone?.();}
        else setError('组合表尚未就绪，请稍后导入');
      }}><Download aria-hidden className="h-3 w-3"/>{prepareImport?.label ?? '导入组合表'}</button></>}
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <FishContinuousTable items={sorted} getKey={rowKey} row={renderRow} header={headings}
      columns={(filterRecords?7:mining?6:4)+(onImport?1:0)} resetKey={JSON.stringify([family,query,sort.column,sort.direction])}
      label={mining?'捕捞明细':'归档来源明细'} testId={mining?'mining-directory-table':'workspace-directory-table'}
      estimate={28} empty={empty} className={`rounded-md border border-border/60 ${mining?'max-h-[50dvh]':'max-h-64'}`}
      tableClassName="whitespace-nowrap text-left" headClassName="bg-card"/>
  </div>;
}

export function FishWorkspaceSource({ name, loadSnapshot, onImport, onOpenChange, loading, error, retry, prepareImport }: {
  name: string;
  loadSnapshot?: () => FishQualityStudy;
  onImport: ImportRows;
  onOpenChange?: (open: boolean) => void;
  loading?: boolean;
  error?: string;
  retry?: () => void;
  prepareImport?: { label: string; onClick?: () => void };
}) {
  const [open,setOpen] = useState(false);
  const snapshot = useMemo(() => open ? loadSnapshot?.() : undefined, [open, loadSnapshot]);
  const changeOpen = (value: boolean) => { setOpen(value); onOpenChange?.(value); };
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><button type="button" className={fishSourceButton} disabled={!loadSnapshot}><Database aria-hidden className="h-3 w-3"/>{name}</button></DialogTrigger>
    <DialogContent className="max-h-[85dvh] w-[calc(100vw-1.5rem)] max-w-[96vw] overflow-auto sm:max-w-[96vw]">
      <DialogHeader><DialogTitle>{name}</DialogTitle><DialogDescription>勾选要带入组合表的记录。</DialogDescription></DialogHeader>
      {loading && <p role="status" className="text-xs text-muted-foreground">正在读取回放归档…</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error} {retry && <button type="button" className="underline" onClick={retry}>重试</button>}</p>}
      {snapshot && <FishWorkspaceRows snapshot={snapshot} onImport={onImport} prepareImport={prepareImport} onDone={()=>changeOpen(false)}/>}
    </DialogContent>
  </Dialog>;
}
