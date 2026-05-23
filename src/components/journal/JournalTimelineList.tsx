import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { JournalTagAssignment, ErrorTagPattern, TradeJournal } from '@/types/journal';

interface Props {
  journals: TradeJournal[];
  assignments: JournalTagAssignment[];
  patterns: ErrorTagPattern[];
}

const PAGE_SIZE = 50;

function pnlColor(v: number) {
  return v > 0 ? 'text-[#0ECB81]' : v < 0 ? 'text-[#F6465D]' : 'text-muted-foreground';
}
function mentalColor(s: number) {
  if (s <= 2) return 'text-[#F6465D]';
  if (s === 3) return 'text-muted-foreground';
  return 'text-[#0ECB81]';
}
function outcomeColor(o: string | null) {
  switch (o) {
    case 'win': return 'text-[#0ECB81]';
    case 'loss': return 'text-[#F6465D]';
    case 'breakeven': return 'text-[#F0B90B]';
    case 'no_entry': return 'text-muted-foreground';
    default: return 'text-muted-foreground';
  }
}
function outcomeLabel(o: string | null) {
  return o === 'win' ? 'WIN' : o === 'loss' ? 'LOSS' : o === 'breakeven' ? 'BE' : o === 'no_entry' ? 'PASS' : '—';
}
function fmtTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtPnl(v: number) { return `${v > 0 ? '+' : ''}${v.toFixed(2)}`; }

export function JournalTimelineList({ journals, assignments, patterns }: Props) {
  const nav = useNavigate();
  const [page, setPage] = useState(0);

  const tagsByJournal = useMemo(() => {
    const m = new Map<string, ErrorTagPattern[]>();
    const pById = new Map(patterns.map(p => [p.id, p]));
    for (const a of assignments) {
      const p = pById.get(a.pattern_id);
      if (!p) continue;
      if (!m.has(a.journal_id)) m.set(a.journal_id, []);
      m.get(a.journal_id)!.push(p);
    }
    return m;
  }, [assignments, patterns]);

  const sorted = useMemo(
    () => [...journals].sort((a, b) => +new Date(b.pre_simulated_time) - +new Date(a.pre_simulated_time)),
    [journals],
  );
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="bg-card border border-border rounded">
      <div className="grid grid-cols-[110px_80px_60px_50px_60px_60px_80px_60px_80px] text-[10px] text-muted-foreground bg-background px-3 py-1.5 sticky top-0">
        <span>时间</span><span>标的</span><span>方向</span><span>心态</span>
        <span>结果</span><span>R</span><span>P&L</span><span>标签数</span><span>操作</span>
      </div>
      {pageRows.length === 0 && (
        <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">暂无数据</div>
      )}
      {pageRows.map(j => {
        const tags = tagsByJournal.get(j.id) ?? [];
        return (
          <div key={j.id} className="grid grid-cols-[110px_80px_60px_50px_60px_60px_80px_60px_80px] px-3 py-1.5 text-[11px] font-mono border-b border-border/40 hover:bg-accent items-center">
            <span className="flex items-center gap-1">
              {j.reason_was_rewritten && <AlertTriangle className="w-3 h-3 text-[#F0B90B]" />}
              {fmtTime(j.pre_simulated_time)}
            </span>
            <span className="truncate">{j.symbol}</span>
            <span className={
              j.direction === 'long' ? 'text-[#0ECB81]' :
              j.direction === 'short' ? 'text-[#F6465D]' : 'text-muted-foreground'
            }>
              {j.direction === 'long' ? 'LONG' : j.direction === 'short' ? 'SHORT' : 'PASS'}
            </span>
            <span className={mentalColor(j.pre_mental_state)}>{j.pre_mental_state}</span>
            <span className={outcomeColor(j.post_outcome)}>{outcomeLabel(j.post_outcome)}</span>
            <span className={pnlColor(j.post_r_multiple ?? 0)}>{j.post_r_multiple != null ? j.post_r_multiple.toFixed(2) : '—'}</span>
            <span className={pnlColor(j.post_realized_pnl ?? 0)}>{j.post_realized_pnl != null ? fmtPnl(j.post_realized_pnl) : '—'}</span>
            <span>
              {tags.length > 0 ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="inline-flex h-5 px-1.5 rounded bg-muted text-foreground text-[10px]">×{tags.length}</button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2 bg-card border-border text-[11px]">
                    {tags.slice(0, 3).map(t => <div key={t.id} className="truncate">• {t.pattern_name}</div>)}
                    {tags.length > 3 && <div className="text-muted-foreground">…+{tags.length - 3}</div>}
                  </PopoverContent>
                </Popover>
              ) : <span className="text-muted-foreground">—</span>}
            </span>
            <span>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                onClick={() => nav(`/journal/${j.id}`)}>
                复盘
              </Button>
            </span>
          </div>
        );
      })}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-border text-[11px]">
          <span className="text-muted-foreground">共 {sorted.length} 条</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="h-6 text-[11px]"
              disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>上一页</Button>
            <span className="font-mono">{page + 1} / {totalPages}</span>
            <Button size="sm" variant="ghost" className="h-6 text-[11px]"
              disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  );
}
