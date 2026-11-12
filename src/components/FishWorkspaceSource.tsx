import { useMemo, useState } from 'react';
import { Database, Download } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { qualityComparisonRows, type FishQualityStudy } from '@/lib/fish/quality';
import { qualitySignalTime } from '@/lib/fish/qualityAdmissionTime';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { formatUTC8 } from '@/lib/timeFormat';
import { isDelayedTuringReplaySample } from '@/lib/turingReplaySamples';

export const fishSourceButton = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40';
const field = 'h-7 min-w-36 rounded-md border border-border bg-background px-2 text-xs';
const pageSize = 60;

type ImportRows = (snapshot: FishQualityStudy, ids: readonly string[]) => boolean;

export function FishWorkspaceRows({snapshot,onImport,onDone}:{
  snapshot: FishQualityStudy; onImport: ImportRows; onDone?: () => void;
}) {
  const [query,setQuery] = useState(''), [page,setPage] = useState(0);
  const [selected,setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [error,setError] = useState('');
  const rows = useMemo(() => qualityComparisonRows(snapshot).filter(row => !isDelayedTuringReplaySample(row.source))
    .sort((a,b) => qualitySignalTime(b.source)-qualitySignalTime(a.source)),[snapshot]);
  const found = useMemo(() => rows.filter(row => row.source.symbol.toUpperCase().includes(query.trim().toUpperCase())),[rows,query]);
  const lastPage = Math.max(0,Math.ceil(found.length/pageSize)-1);
  const currentPage = Math.min(page,lastPage), visible = found.slice(currentPage*pageSize,(currentPage+1)*pageSize);
  const checked = !!found.length && found.every(row => selected.has(row.id));
  const toggle = (ids: readonly string[], enabled: boolean) => setSelected(prior => {
    const next = new Set(prior);
    for (const id of ids) if (enabled) next.add(id); else next.delete(id);
    return next;
  });
  return <div className="space-y-2 text-[11px]" data-testid="quality-workspace-source-rows">
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label="搜索来源标的" className={field} placeholder="搜索标的" value={query} onChange={e => {setQuery(e.target.value);setPage(0);}}/>
      <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={checked} disabled={!found.length} onChange={e=>toggle(found.map(row=>row.id),e.target.checked)}/>全选搜索结果</label>
      <span className="text-muted-foreground">已选 {selected.size} 条</span>
      <button type="button" className={fishSourceButton+' ml-auto text-primary'} disabled={!selected.size} onClick={()=>{
        if(onImport(snapshot,[...selected])){setSelected(new Set());setError('');onDone?.();}
        else setError('组合表尚未就绪，请稍后导入');
      }}><Download aria-hidden className="h-3 w-3"/>导入组合表</button>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {visible.length ? <div className="max-h-64 overflow-auto rounded-md border border-border/60">
      <table className="w-full text-left"><thead className="sticky top-0 bg-card"><tr><th className="w-10 px-2 py-1.5">选取</th><th className="px-2 py-1.5">标的</th><th className="px-2 py-1.5">市场</th><th className="px-2 py-1.5">信号时间</th><th className="px-2 py-1.5">入场时间</th></tr></thead><tbody>
        {visible.map(row => <tr key={row.id} className="border-t border-border/50">
          <td className="px-2 py-1"><input type="checkbox" aria-label={`选取 ${row.source.symbol} ${formatUTC8(qualitySignalTime(row.source))}`} checked={selected.has(row.id)} onChange={e=>toggle([row.id],e.target.checked)}/></td>
          <td className="px-2 py-1 font-medium">{row.source.symbol}</td>
          <td className="px-2 py-1 text-muted-foreground">{row.source.market==='us_stock'?'美股':EXCHANGE_NAMES[row.source.exchange??'binance']}</td>
          <td className="px-2 py-1 font-mono">{formatUTC8(qualitySignalTime(row.source))}</td>
          <td className="px-2 py-1 font-mono">{row.enteredAt&&row.enteredAt!==qualitySignalTime(row.source) ? formatUTC8(row.enteredAt) : '—'}</td>
        </tr>)}
      </tbody></table>
    </div> : <p className="py-3 text-muted-foreground">没有可导入的记录。</p>}
    {lastPage > 0 && <div className="flex items-center justify-end gap-2">
      <button type="button" className={fishSourceButton} disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>上一页</button>
      <span className="text-muted-foreground">{currentPage+1} / {lastPage+1}</span>
      <button type="button" className={fishSourceButton} disabled={currentPage===lastPage} onClick={()=>setPage(currentPage+1)}>下一页</button>
    </div>}
  </div>;
}

export function FishWorkspaceSource({name,snapshot,onImport}:{name:string;snapshot?:FishQualityStudy;onImport:ImportRows}) {
  const [open,setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" className={fishSourceButton} disabled={!snapshot}><Database aria-hidden className="h-3 w-3"/>{name}</button></DialogTrigger>
    <DialogContent className="w-[calc(100vw-1.5rem)] max-w-2xl">
      <DialogHeader><DialogTitle>{name}</DialogTitle><DialogDescription>勾选要带入组合表的记录。</DialogDescription></DialogHeader>
      {snapshot && <FishWorkspaceRows snapshot={snapshot} onImport={onImport} onDone={()=>setOpen(false)}/>}
    </DialogContent>
  </Dialog>;
}
