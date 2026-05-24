import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { PostTradeReviewSheet } from './PostTradeReviewSheet';
import { useTradingContext } from '@/contexts/TradingContext';
import type { TradeJournal } from '@/types/journal';

interface Props {
  journals: TradeJournal[];
  onReviewed?: (j: TradeJournal) => void;
}

function pnlColor(v: number) {
  return v > 0 ? 'text-[#0ECB81]' : v < 0 ? 'text-[#F6465D]' : 'text-muted-foreground';
}
function fmtTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtPnl(v: number) { return `${v > 0 ? '+' : ''}${v.toFixed(2)}`; }

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

  return (
    <div className="space-y-2">
      <div className="bg-[#F0B90B]/10 border border-[#F0B90B]/30 rounded px-3 py-2 text-[11px] text-[#F0B90B]">
        未评价的交易不计入错题模式统计。请尽快补完。
      </div>

      <div className="bg-card border border-border rounded">
        <div className="grid grid-cols-[110px_80px_60px_50px_80px_100px] text-[10px] text-muted-foreground bg-background px-3 py-1.5 sticky top-0">
          <span>时间</span><span>标的</span><span>方向</span><span>心态</span>
          <span>入场价</span><span>操作</span>
        </div>
        {unreviewed.length === 0 && (
          <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">没有未评价的交易 🎉</div>
        )}
        {unreviewed.map(j => (
          <div key={j.id} className="grid grid-cols-[110px_80px_60px_50px_80px_100px] px-3 py-1.5 text-[11px] font-mono border-b border-border/40 hover:bg-accent items-center">
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
            <span className={pnlColor(j.pre_mental_state - 3)}>{j.pre_mental_state}</span>
            <span>{j.pre_entry_price != null ? fmtPnl(j.pre_entry_price) : '—'}</span>
            <span>
              <Button size="sm" className="h-6 px-2 text-[10px] bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90"
                onClick={() => setActive(j)}>
                立即评价
              </Button>
            </span>
          </div>
        ))}
      </div>

      <PostTradeReviewSheet
        isOpen={!!active}
        onOpenChange={open => { if (!open) setActive(null); }}
        journal={active}
        onReviewed={u => { onReviewed?.(u); setActive(null); }}
      />
    </div>
  );
}
