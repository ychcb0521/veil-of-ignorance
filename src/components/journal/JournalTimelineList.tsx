import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ExitMethodBadge } from './ExitMethodBadge';
import { useTradingContext } from '@/contexts/TradingContext';
import { formatPrice } from '@/lib/formatters';
import { formatBeijingTimeShort } from '@/lib/timeFormat';
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
function fmtTime(ms: number | string | null | undefined) {
  if (!ms) return null;
  const d = typeof ms === 'number' ? new Date(ms) : new Date(ms);
  if (isNaN(+d)) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtPnl(v: number) { return `${v > 0 ? '+' : ''}${v.toFixed(2)}`; }

const COLS = 'grid-cols-[110px_110px_80px_60px_80px_80px_70px_50px_60px_60px_80px_60px_80px]';

export function JournalTimelineList({ journals, assignments, patterns }: Props) {
  const nav = useNavigate();
  const [page, setPage] = useState(0);
  const { tradeHistory } = useTradingContext();
  const tradeRecordMap = useMemo(
    () => new Map(tradeHistory.map(t => [t.id, t])),
    [tradeHistory],
  );

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
      <div className="overflow-x-auto">
        <div className={`grid ${COLS} text-[10px] text-muted-foreground bg-muted/40 px-3 py-2 sticky top-0 min-w-[1100px]`}>
          <span>实际开仓<br/><span className="text-[9px]">(北京 / 模拟)</span></span>
          <span>实际平仓<br/><span className="text-[9px]">(北京 / 模拟)</span></span>
          <span>标的</span><span>方向</span>
          <span>开仓价</span><span>平仓价</span><span>平仓方式</span><span>心态</span>
          <span>结果</span><span>R</span><span>P&L</span><span>标签数</span><span>操作</span>
        </div>
        {pageRows.length === 0 && (
          <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">暂无数据</div>
        )}
        {pageRows.map(j => {
          const tags = tagsByJournal.get(j.id) ?? [];
          const tr = j.trade_record_id ? tradeRecordMap.get(j.trade_record_id) ?? null : null;
          const openRealBeijing = formatBeijingTimeShort(j.pre_real_time);
          const closeRealBeijing = formatBeijingTimeShort(j.post_real_close_time);
          const openSim = fmtTime(tr?.openTime) ?? fmtTime(j.pre_simulated_time);
          const closeSim = fmtTime(tr?.closeTime);
          const entryP = tr?.entryPrice ?? j.pre_entry_price ?? null;
          const exitP = tr && tr.exitPrice > 0 ? tr.exitPrice : null;
          return (
            <div key={j.id} className={`grid ${COLS} px-3 py-2 text-[11px] font-mono border-b border-border/40 hover:bg-accent items-center min-w-[1100px]`}>
              <span className="flex items-center gap-1">
                {j.reason_was_rewritten && <AlertTriangle className="w-3 h-3 text-[#F0B90B]" />}
                {j.source === 'retroactive_from_record' && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <RotateCcw className="w-3 h-3 text-muted-foreground" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="text-[11px]">历史回填</TooltipContent>
                  </Tooltip>
                )}
                <span className="leading-tight">
                  <span className="block">{openRealBeijing}</span>
                  <span className="block text-[9px] text-muted-foreground">{openSim ?? '—'}</span>
                </span>
              </span>
              <span className="leading-tight">
                <span className="block">{closeRealBeijing}</span>
                <span className="block text-[9px] text-muted-foreground">{closeSim ?? '—'}</span>
              </span>
              <span className="truncate">{j.symbol}</span>
              <span className={
                j.direction === 'long' ? 'text-[#0ECB81]' :
                j.direction === 'short' ? 'text-[#F6465D]' : 'text-muted-foreground'
              }>
                {j.direction === 'long' ? 'LONG' : j.direction === 'short' ? 'SHORT' : 'PASS'}
              </span>
              <span>{entryP != null ? formatPrice(entryP, j.symbol) : <span className="text-muted-foreground">—</span>}</span>
              <span>{exitP != null ? formatPrice(exitP, j.symbol) : <span className="text-muted-foreground">—</span>}</span>
              <span><ExitMethodBadge method={tr?.exit_method} /></span>
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
      </div>
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
