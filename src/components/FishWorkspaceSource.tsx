import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Database, Download } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { qualityComparisonRows, qualityEntryIdentity, type FishQualityStudy } from '@/lib/fish/quality';
import { miningReadingsByEntry, type MiningDirectoryEvidence } from '@/lib/fish/miningLibraryDirectory';
import { libraryReading } from './FishLibraryConditions';
import { qualitySignalTime } from '@/lib/fish/qualityAdmissionTime';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { formatUTC8 } from '@/lib/timeFormat';
import { isDelayedTuringReplaySample } from '@/lib/turingReplaySamples';

export const fishSourceButton = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40';
const field = 'h-7 min-w-36 rounded-md border border-border bg-background px-2 text-xs';
const pageSize = 60;

type ImportRows = (snapshot: FishQualityStudy, ids: readonly string[]) => boolean;

const columns = { selected: '选取', symbol: '标的', market: '市场', reading: '探测数值', signalTime: '信号时间', entryTime: '入场时间' } as const;
type SortColumn = keyof typeof columns;
type SortDirection = 'ascending' | 'descending';
const collator = new Intl.Collator('zh-CN', {numeric:true});
function compareValues(a:string|number|null, b:string|number|null, direction:SortDirection) {
  if(a===null)return b===null?0:1;
  if(b===null)return -1;
  const result=typeof a==='number'&&typeof b==='number'?a-b:collator.compare(String(a),String(b));
  return direction==='ascending'?result:-result;
}

export function FishWorkspaceRows({snapshot,onImport,onDone,mining}:{
  snapshot: FishQualityStudy; onImport?: ImportRows; onDone?: () => void; mining?:MiningDirectoryEvidence;
}) {
  const [query,setQuery] = useState(''), [page,setPage] = useState(0);
  const [selected,setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [error,setError] = useState('');
  const [sort,setSort] = useState<{column:SortColumn;direction:SortDirection}>({column:'signalTime',direction:'descending'});
  const {family,records,runs}=mining??{};
  const readingsByEntry=useMemo(()=>family&&records&&runs?miningReadingsByEntry({family,records,runs}):undefined,[family,records,runs]);
  const rows=useMemo(()=>qualityComparisonRows(snapshot).filter(row=>!isDelayedTuringReplaySample(row.source)).map(row=>{
    const signalTime=qualitySignalTime(row.source);
    const readings=readingsByEntry?.get(qualityEntryIdentity(row.source,row.enteredAt))??[];
    const reading=readings.reduce<number|null>((max,r)=>r.reading===undefined?max:Math.max(max??r.reading,r.reading),null);
    return {id:row.id, symbol:row.source.symbol, market:row.source.market==='us_stock'?'美股':EXCHANGE_NAMES[row.source.exchange??'binance'],
      signalTime,entryTime:row.enteredAt&&row.enteredAt!==signalTime?row.enteredAt:null, readings,reading};
  }).sort((a,b)=>b.signalTime-a.signalTime),[snapshot,readingsByEntry]);
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
  const lastPage = Math.max(0,Math.ceil(found.length/pageSize)-1);
  const currentPage = Math.min(page,lastPage), visible = sorted.slice(currentPage*pageSize,(currentPage+1)*pageSize);
  const eligibleSelected = useMemo(() => rows.filter(row => selected.has(row.id)).map(row => row.id), [rows, selected]);
  const checked = !!found.length && found.every(row => selected.has(row.id));
  function header(column:SortColumn){
    const active=sort.column===column;
    const Icon=active?(sort.direction==='ascending'?ArrowUp:ArrowDown):ArrowUpDown;
    const label=columns[column];
    return <th scope="col" className={'whitespace-nowrap px-2 py-1.5 '+(column==='selected'?'w-10':'')} aria-sort={mining&&active?sort.direction:undefined}>
      {mining?<button type="button" className="inline-flex items-center gap-1 hover:text-primary" aria-label={'按'+label+'排序'}
        title={column==='reading'?'同系列有多项命中时，按最大已知读数排序':'按'+label+'排序'} onClick={()=>{
          setSort(prior=>({column,direction:prior.column===column?(prior.direction==='ascending'?'descending':'ascending'):
            column==='symbol'||column==='market'?'ascending':'descending'}));setPage(0);
        }}>{label}<Icon aria-hidden="true" className={'h-3 w-3 '+(active?'text-primary':'text-muted-foreground')}/></button>:label}
    </th>;
  }
  const toggle = (ids: readonly string[], enabled: boolean) => setSelected(prior => {
    const next = new Set(prior);
    for (const id of ids) if (enabled) next.add(id); else next.delete(id);
    return next;
  });
  return <div className="space-y-2 text-[11px]" data-testid="quality-workspace-source-rows">
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label="搜索来源标的" className={field} placeholder="搜索标的" value={query} onChange={e => {setQuery(e.target.value);setPage(0);}}/>
      {onImport && <><label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={checked} disabled={!found.length} onChange={e=>toggle(found.map(row=>row.id),e.target.checked)}/>全选搜索结果</label>
      <span className="text-muted-foreground">已选 {eligibleSelected.length} 条</span>
      <button type="button" className={fishSourceButton+' ml-auto text-primary'} disabled={!eligibleSelected.length} onClick={()=>{
        if(onImport(snapshot,eligibleSelected)){setSelected(new Set());setError('');onDone?.();}
        else setError('组合表尚未就绪，请稍后导入');
      }}><Download aria-hidden className="h-3 w-3"/>导入组合表</button></>}
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {visible.length ? <div className="max-h-64 overflow-auto rounded-md border border-border/60">
      <table className="w-full text-left"><thead className="sticky top-0 bg-card"><tr>
        {onImport&&header('selected')}{header('symbol')}{header('market')}{mining&&header('reading')}{header('signalTime')}{header('entryTime')}
      </tr></thead><tbody>
        {visible.map(row => <tr key={row.id} className="border-t border-border/50">
          {onImport&&<td className="px-2 py-1"><input type="checkbox" aria-label={`选取 ${row.symbol} ${formatUTC8(row.signalTime)}`} checked={selected.has(row.id)} onChange={e=>toggle([row.id],e.target.checked)}/></td>}
          <td className="px-2 py-1 font-medium">{row.symbol}</td>
          <td className="px-2 py-1 text-muted-foreground">{row.market}</td>
          {mining&&<td className="px-2 py-1 font-mono tabular-nums">{row.readings.length?row.readings.map((r,i)=>
            <div key={i} title={r.metric}>{row.readings.length>1&&<span className="mr-1 text-muted-foreground">{r.metric}</span>}
              {r.reading===undefined&&r.rawReading!==undefined?`原值 ${libraryReading(r.rawReading)}（倍率未记录）`:libraryReading(r.reading)}</div>):'未记录'}</td>}
          <td className="px-2 py-1 font-mono">{formatUTC8(row.signalTime)}</td>
          <td className="px-2 py-1 font-mono">{row.entryTime ? formatUTC8(row.entryTime) : '—'}</td>
        </tr>)}
      </tbody></table>
    </div> : <p className="py-3 text-muted-foreground">{onImport?'没有可导入的记录。':'没有匹配的记录。'}</p>}
    {lastPage > 0 && <div className="flex items-center justify-end gap-2">
      <button type="button" className={fishSourceButton} disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>上一页</button>
      <span className="text-muted-foreground">{currentPage+1} / {lastPage+1}</span>
      <button type="button" className={fishSourceButton} disabled={currentPage===lastPage} onClick={()=>setPage(currentPage+1)}>下一页</button>
    </div>}
  </div>;
}

export function FishWorkspaceSource({name,loadSnapshot,onImport}:{name:string;loadSnapshot?:()=>FishQualityStudy;onImport:ImportRows}) {
  const [open,setOpen] = useState(false);
  const snapshot = useMemo(() => open ? loadSnapshot?.() : undefined, [open, loadSnapshot]);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" className={fishSourceButton} disabled={!loadSnapshot}><Database aria-hidden className="h-3 w-3"/>{name}</button></DialogTrigger>
    <DialogContent className="w-[calc(100vw-1.5rem)] max-w-2xl">
      <DialogHeader><DialogTitle>{name}</DialogTitle><DialogDescription>勾选要带入组合表的记录。</DialogDescription></DialogHeader>
      {snapshot && <FishWorkspaceRows snapshot={snapshot} onImport={onImport} onDone={()=>setOpen(false)}/>}
    </DialogContent>
  </Dialog>;
}
