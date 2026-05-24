import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { PostTradeReviewSheet } from './PostTradeReviewSheet';
import { ExitMethodBadge } from './ExitMethodBadge';
import { useTradingContext } from '@/contexts/TradingContext';
import { formatPrice } from '@/lib/formatters';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

interface Props {
  journals: TradeJournal[];
  onReviewed?: (j: TradeJournal) => void;
}

function fmtTime(ms: number | string | null | undefined) {
  if (!ms) return null;
  const d = typeof ms === 'number' ? new Date(ms) : new Date(ms);
  if (isNaN(+d)) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dirLabel(d: TradeJournal['direction']) {
  return d === 'long' ? 'LONG' : d === 'short' ? 'SHORT' : 'PASS';
}
function dirColor(d: TradeJournal['direction']) {
  return d === 'long' ? 'text-[#0ECB81]' : d === 'short' ? 'text-[#F6465D]' : 'text-muted-foreground';
}
function mentalColor(s: number) {
  if (s <= 2) return 'text-[#F6465D]';
  if (s === 3) return 'text-muted-foreground';
  return 'text-[#0ECB81]';
}

const COLS = 'grid-cols-[110px_110px_90px_70px_90px_90px_80px_60px_100px]';

export function UnreviewedJournalList({ journals, onReviewed }: Props) {
  const { tradeHistory } = useTradingContext();
  const tradeRecordMap = useMemo(
    () => new Map(tradeHistory.map(t => [t.id, t])),
    [tradeHistory],
  );
  const unreviewed = useMemo(
    () => journals.filter(j => j.trade_record_id && !j.post_reviewed_at)
      .sort((a, b) => +new Date(b.pre_simulated_time) - +new Date(a.pre_simulated_time)),
    [journals],
  );
  const [active, setActive] = useState<TradeJournal | null>(null);
  const activeTradeRecord = active?.trade_record_id ? tradeRecordMap.get(active.trade_record_id) ?? null : null;

  const getRecord = (j: TradeJournal): TradeRecord | null =>
    j.trade_record_id ? tradeRecordMap.get(j.trade_record_id) ?? null : null;

  return (
    <div className="space-y-2">
      <div className="bg-[#F0B90B]/10 border border-[#F0B90B]/30 rounded px-3 py-2 text-[11px] text-[#F0B90B]">
        未评价的交易不计入错题模式统计。请尽快补完。
      </div>

      {/* Desktop / tablet table */}
      <div className="hidden md:block bg-card border border-border rounded">
        <div className="overflow-x-auto">
          <div className={`grid ${COLS} text-[10px] text-muted-foreground bg-muted/40 px-2 py-2 sticky top-0 min-w-[800px]`}>
            <span>开仓时间</span><span>平仓时间</span><span>标的</span><span>方向</span>
            <span>开仓价</span><span>平仓价</span><span>平仓方式</span><span>心态</span><span>操作</span>
          </div>
          {unreviewed.length === 0 && (
            <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">没有未评价的交易 🎉</div>
          )}
          {unreviewed.map(j => {
            const tr = getRecord(j);
            const openT = fmtTime(tr?.openTime) ?? fmtTime(j.pre_simulated_time);
            const closeT = fmtTime(tr?.closeTime);
            const entryP = tr?.entryPrice ?? j.pre_entry_price ?? null;
            const exitP = tr && tr.exitPrice > 0 ? tr.exitPrice : null;
            return (
              <div key={j.id} className={`grid ${COLS} px-2 py-2 text-[11px] font-mono border-b border-border/40 hover:bg-accent items-center min-w-[800px]`}>
                <span className="flex items-center gap-1">
                  {j.reason_was_rewritten && <AlertTriangle className="w-3 h-3 text-[#F0B90B]" />}
                  {openT ?? <span className="text-muted-foreground">—</span>}
                </span>
                <span>{closeT ?? <span className="text-muted-foreground">—</span>}</span>
                <span className="truncate">{j.symbol}</span>
                <span className={dirColor(j.direction)}>{dirLabel(j.direction)}</span>
                <span>{entryP != null ? formatPrice(entryP, j.symbol) : <span className="text-muted-foreground">—</span>}</span>
                <span>{exitP != null ? formatPrice(exitP, j.symbol) : <span className="text-muted-foreground">—</span>}</span>
                <span><ExitMethodBadge method={tr?.exit_method} /></span>
                <span className={mentalColor(j.pre_mental_state)}>{j.pre_mental_state}</span>
                <span>
                  <Button size="sm" className="h-6 px-2 text-[10px] bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90"
                    onClick={() => setActive(j)}>
                    立即评价
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile card stack */}
      <div className="md:hidden space-y-2">
        {unreviewed.length === 0 && (
          <div className="bg-card border border-border rounded px-3 py-8 text-center text-[11px] text-muted-foreground">
            没有未评价的交易 🎉
          </div>
        )}
        {unreviewed.map(j => {
          const tr = getRecord(j);
          const openT = fmtTime(tr?.openTime) ?? fmtTime(j.pre_simulated_time);
          const closeT = fmtTime(tr?.closeTime);
          const entryP = tr?.entryPrice ?? j.pre_entry_price ?? null;
          const exitP = tr && tr.exitPrice > 0 ? tr.exitPrice : null;
          return (
            <div key={j.id} className="bg-card border border-border rounded p-3 space-y-1.5">
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="flex items-center gap-1">
                  {j.reason_was_rewritten && <AlertTriangle className="w-3 h-3 text-[#F0B90B]" />}
                  <span>开 {openT ?? '—'}</span>
                  <span className="text-muted-foreground">→</span>
                  <span>平 {closeT ?? '—'}</span>
                </span>
                <Button size="sm" className="h-6 px-2 text-[10px] bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90"
                  onClick={() => setActive(j)}>
                  立即评价
                </Button>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-mono truncate">{j.symbol}</span>
                <span className="text-muted-foreground">·</span>
                <span className={dirColor(j.direction)}>{dirLabel(j.direction)}</span>
                <span className="text-muted-foreground">·</span>
                <span className={mentalColor(j.pre_mental_state)}>心态 {j.pre_mental_state}</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span>开 {entryP != null ? formatPrice(entryP, j.symbol) : '—'}</span>
                <span className="text-muted-foreground">→</span>
                <span>平 {exitP != null ? formatPrice(exitP, j.symbol) : '—'}</span>
                <ExitMethodBadge method={tr?.exit_method} />
              </div>
            </div>
          );
        })}
      </div>

      <PostTradeReviewSheet
        isOpen={!!active}
        onOpenChange={open => { if (!open) setActive(null); }}
        journal={active}
        tradeRecord={activeTradeRecord}
        onReviewed={u => { onReviewed?.(u); setActive(null); }}
      />
    </div>
  );
}
