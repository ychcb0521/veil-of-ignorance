import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArrowDown, ArrowUp, Clock3, RotateCcw } from 'lucide-react';
import { PostTradeReviewSheet } from './PostTradeReviewSheet';
import { ExitMethodBadge } from './ExitMethodBadge';
import { useTradingContext } from '@/contexts/TradingContext';
import { formatPrice } from '@/lib/formatters';
import type { TradeJournal } from '@/types/journal';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { buildUnreviewedLongMainItems, summarizeUnreviewedSymbols } from '@/lib/unreviewedLongMainTrades';

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

const COLS = 'grid-cols-[130px_105px_105px_90px_60px_90px_90px_80px_60px_100px]';

export function UnreviewedJournalList({ journals, onReviewed }: Props) {
  const { tradeHistory } = useTradingContext();
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const allUnreviewed = useMemo(
    () => buildUnreviewedLongMainItems(journals, tradeHistory),
    [journals, tradeHistory],
  );
  const symbolSummaries = useMemo(() => summarizeUnreviewedSymbols(allUnreviewed), [allUnreviewed]);
  const unreviewed = useMemo(() => allUnreviewed
    .filter(item => selectedSymbol == null || item.symbol === selectedSymbol)
    .sort((a, b) => (
      sortDirection === 'desc'
        ? b.operationTime - a.operationTime || a.journal.id.localeCompare(b.journal.id)
        : a.operationTime - b.operationTime || a.journal.id.localeCompare(b.journal.id)
    )), [allUnreviewed, selectedSymbol, sortDirection]);
  const [active, setActive] = useState<TradeJournal | null>(null);
  const activeTradeRecord = active
    ? allUnreviewed.find(item => item.journal.id === active.id)?.record ?? null
    : null;
  const firstOperationTime = allUnreviewed.length > 0
    ? Math.min(...allUnreviewed.map(item => item.operationTime))
    : null;

  return (
    <div className="space-y-2">
      <div className="bg-[#F0B90B]/10 border border-[#F0B90B]/30 rounded px-3 py-2 text-[11px] text-[#F0B90B]">
        仅汇总拥有真实操作时间的主力多单。未评价交易不计入错题模式统计，请尽快补完。
        <div>
          <a href="/journal/campaigns/classify" className="text-[#5BA3FF] hover:underline">
            或前往归类历史交易
          </a>
        </div>
      </div>

      <div className="rounded border border-border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[12px] font-medium">未做评价标的汇总</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {symbolSummaries.length} 个标的 · {allUnreviewed.length} 笔主力多单
              {firstOperationTime != null ? ` · 自 ${fmtTime(firstOperationTime)}` : ''}
            </div>
          </div>
          <button
            type="button"
            data-testid="unreviewed-operation-time-sort"
            onClick={() => setSortDirection(current => current === 'desc' ? 'asc' : 'desc')}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-background px-2.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`操作时间，${sortDirection === 'desc' ? '从新到旧' : '从旧到新'}排序；点击切换`}
          >
            <Clock3 className="h-3.5 w-3.5" />
            操作时间
            {sortDirection === 'desc' ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedSymbol(null)}
            className={`rounded border px-2 py-1 text-[10px] ${selectedSymbol == null ? 'border-[#F0B90B]/50 bg-[#F0B90B]/10 text-[#D89B00]' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            全部 {allUnreviewed.length}
          </button>
          {symbolSummaries.map(summary => (
            <button
              key={summary.symbol}
              type="button"
              onClick={() => setSelectedSymbol(current => current === summary.symbol ? null : summary.symbol)}
              className={`rounded border px-2 py-1 font-mono text-[10px] ${selectedSymbol === summary.symbol ? 'border-[#F0B90B]/50 bg-[#F0B90B]/10 text-[#D89B00]' : 'border-border text-muted-foreground hover:text-foreground'}`}
              title={`最近操作 ${fmtTime(summary.latestOperationTime)}`}
            >
              {summary.symbol} {summary.count}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop / tablet table */}
      <div className="hidden md:block bg-card border border-border rounded">
        <div className="overflow-x-auto">
          <div className={`grid ${COLS} text-[10px] text-muted-foreground bg-muted/40 px-2 py-2 sticky top-0 min-w-[930px]`}>
            <span>操作时间</span><span>开仓时间</span><span>平仓时间</span><span>标的</span><span>方向</span>
            <span>开仓价</span><span>平仓价</span><span>平仓方式</span><span>心态</span><span>操作</span>
          </div>
          {unreviewed.length === 0 && (
            <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">没有未评价的交易 🎉</div>
          )}
          {unreviewed.map(item => {
            const { journal: j, record: tr, operationTime } = item;
            const openT = fmtTime(tr?.openTime) ?? fmtTime(j.pre_simulated_time);
            const closeT = fmtTime(tr?.closeTime);
            const entryP = tr?.entryPrice ?? j.pre_entry_price ?? null;
            const exitP = tr && tr.exitPrice > 0 ? tr.exitPrice : null;
            return (
              <div key={j.id} data-operation-time={operationTime} className={`grid ${COLS} px-2 py-2 text-[11px] font-mono border-b border-border/40 hover:bg-accent items-center min-w-[930px]`}>
                <span>{fmtTime(operationTime) ?? '—'}</span>
                <span className="flex items-center gap-1">
                  {j.reason_was_rewritten && <AlertTriangle className="w-3 h-3 text-[#F0B90B]" />}
                  {j.pre_falsification_signal && !j.exit_falsification_status && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex h-2 w-2 rounded-full bg-muted-foreground/60" />
                      </TooltipTrigger>
                      <TooltipContent className="text-[11px]">证伪信号未校验</TooltipContent>
                    </Tooltip>
                  )}
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
        {unreviewed.map(item => {
          const { journal: j, record: tr, operationTime } = item;
          const openT = fmtTime(tr?.openTime) ?? fmtTime(j.pre_simulated_time);
          const closeT = fmtTime(tr?.closeTime);
          const entryP = tr?.entryPrice ?? j.pre_entry_price ?? null;
          const exitP = tr && tr.exitPrice > 0 ? tr.exitPrice : null;
          return (
            <div key={j.id} className="bg-card border border-border rounded p-3 space-y-1.5">
              <div className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                <Clock3 className="h-3 w-3" />
                操作 {fmtTime(operationTime) ?? '—'}
              </div>
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="flex items-center gap-1">
                  {j.reason_was_rewritten && <AlertTriangle className="w-3 h-3 text-[#F0B90B]" />}
                  {j.pre_falsification_signal && !j.exit_falsification_status && <span className="inline-flex h-2 w-2 rounded-full bg-muted-foreground/60" />}
                  {j.source === 'retroactive_from_record' && <RotateCcw className="w-3 h-3 text-muted-foreground" />}
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
