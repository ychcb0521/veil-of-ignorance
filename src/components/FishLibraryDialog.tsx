/**
 * 挖掘库 / 过滤库共用的弹窗外壳：与「监测库」同一套尺寸和样式（搜索、轮次、表格、每页 50 条）。
 * 内容（记录、轮次、表头、行）由各库自己给。
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Database } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FishQualityInfo } from '@/components/FishQualityModule';
import {FishLibraryDataActions} from './FishLibraryTransferContext';

const action = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40';
const field = 'h-8 min-w-0 rounded-md border border-border/60 bg-muted/30 px-2 text-[11px] outline-none focus-visible:border-ring';
const PAGE = 50;
export const libraryCell = 'px-3 py-2';

export interface FishLibraryRoundOption { id: string; label: string; error?: string }
export function FishLibraryDialog<T>({ name, info, description, placeholder, rounds, roundLabel, headers, items, match, row, empty, detail, onOpenChange,selection }: {
  selection?:{key:(item:T)=>string;selected:ReadonlySet<string>;toggle:(key:string)=>void;select:(keys:string[])=>void;clear:()=>void;remove:()=>void};
  /** 按钮与标题，如「挖掘库」。 */
  name: string; info: ReactNode; description: string; placeholder: string;
  rounds: FishLibraryRoundOption[]; roundLabel: string;
  headers: string[];
  /** 全部记录（已排序）；按轮次与关键词筛选由 match 决定。 */
  items: readonly T[]; match: (item: T, needle: string, roundId: string) => boolean;
  row: (item: T) => ReactNode; empty: { none: string; unmatched: string };
  detail?: ReactNode; onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [roundId, setRoundId] = useState(''), [page, setPage] = useState(0);
  const needle = query.trim().toUpperCase();
  const filtered = useMemo(() => open ? items.filter(item => match(item, needle, roundId)) : [], [open, items, match, needle, roundId]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE)), current = Math.min(page, pages - 1), visible = filtered.slice(current * PAGE, (current + 1) * PAGE);
  const round = rounds.find(r => r.id === roundId);
  const change = (next: boolean) => { setOpen(next); onOpenChange?.(next); };
  return <Dialog open={open} onOpenChange={change}>
    <DialogTrigger asChild><button type="button" className={action} aria-label={`打开${name}`}><Database aria-hidden className="h-3 w-3"/>{name}</button></DialogTrigger>
    <DialogContent className="flex max-h-[85dvh] w-[calc(100vw-1.5rem)] max-w-[96vw] sm:max-w-[96vw] flex-col gap-3 overflow-y-auto overscroll-contain p-4 sm:p-5">
      <DialogHeader className="shrink-0 space-y-1 text-left">
        <div className="flex flex-wrap items-center gap-1.5"><DialogTitle className="text-sm">{name}</DialogTitle><FishQualityInfo label={`${name}说明`}>{info}</FishQualityInfo>{(name==='挖掘库'||name==='过滤库')&&<FishLibraryDataActions scope={name==='挖掘库'?'mining':'filter'}/>}</div>
        <DialogDescription className="text-[11px]">{description}</DialogDescription>
      </DialogHeader>
      <div className="flex shrink-0 flex-wrap gap-2">
        <input aria-label={`搜索${name}`} className={`${field} min-w-36 flex-1`} placeholder={placeholder} value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}/>
        <select aria-label={`${name}${roundLabel}`} className={`${field} max-w-full sm:max-w-96`} value={roundId} onChange={e => { setRoundId(e.target.value); setPage(0); }}>
          <option value="">全部{roundLabel}</option>{rounds.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>
      {round?.error && <p role="status" className="shrink-0 text-[11px] text-destructive">{round.error}</p>}
      {detail}
      {selection&&<div className="flex flex-wrap items-center gap-2 text-[11px]"><button type="button" className={action} onClick={()=>selection.select(filtered.map(selection.key))}>全选当前筛选（{filtered.length}）</button><button type="button" className={action} onClick={selection.clear}>取消选择</button><button type="button" className={`${action} text-destructive`} disabled={!selection.selected.size} onClick={selection.remove}>删除所选（{selection.selected.size}）</button></div>}
      <div className="max-h-[50dvh] min-h-32 shrink-0 overflow-auto rounded-md border border-border/60" data-testid={`${name}-table`}>
        <table className="w-full whitespace-nowrap text-left text-[11px]">
          <thead className="sticky top-0 bg-background text-[10px] text-muted-foreground"><tr className="bg-muted/40">{selection&&<th className={libraryCell}>选择</th>}{headers.map(h => <th key={h} className={`${libraryCell} font-medium`}>{h}</th>)}</tr></thead>
          <tbody>{visible.map(row)}</tbody>
        </table>
        {!filtered.length && <p className="px-4 py-8 text-center text-[11px] text-muted-foreground">{items.length ? empty.unmatched : empty.none}</p>}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>共 {filtered.length} 条 · {current + 1} / {pages} 页</span><div className="flex gap-1">
        <button type="button" className={action} disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</button>
        <button type="button" className={action} disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>下一页</button>
      </div></div>
    </DialogContent>
  </Dialog>;
}
