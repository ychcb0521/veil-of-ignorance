/**
 * /journal/:id — 单笔交易五通道复现页
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBeforeUnload, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertOctagon, Pencil, BrainCircuit } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getJournalById, listAssignmentsForJournal, listPatterns, listAllJournalDataForUser,
} from '@/lib/journalApi';
import type { ErrorTagPattern, JournalTagAssignment, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import { ReplayProvider } from '@/contexts/ReplayContext';
import { ReplayChartView } from '@/components/journal/ReplayChartView';
import { ContextChannelsStack } from '@/components/journal/ContextChannelsStack';
import { PostTradeReviewSheet } from '@/components/journal/PostTradeReviewSheet';
import { BackButton } from '@/components/journal/BackButton';
import { formatBeijingTime } from '@/lib/timeFormat';
import {
  buildTradeRecordLookup,
  journalCloseOperationTime,
  journalOpenOperationTime,
} from '@/lib/objectiveOperationTime';

function outcomeColor(o: string | null) {
  switch (o) {
    case 'win': return 'bg-[#0ECB81]/20 text-[#0ECB81]';
    case 'loss': return 'bg-[#F6465D]/20 text-[#F6465D]';
    case 'breakeven': return 'bg-[#F0B90B]/20 text-[#F0B90B]';
    case 'no_entry': return 'bg-muted text-muted-foreground';
    default: return 'bg-muted text-muted-foreground';
  }
}
function outcomeLabel(o: string | null) {
  return o === 'win' ? 'WIN' : o === 'loss' ? 'LOSS' : o === 'breakeven' ? 'BE' : o === 'no_entry' ? 'PASS' : '待评价';
}
function pnlColor(v: number) {
  return v > 0 ? 'text-[#0ECB81]' : v < 0 ? 'text-[#F6465D]' : 'text-muted-foreground';
}

export default function JournalPlaybackPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const userId = user?.id;
  const { tradeHistory } = useTradingContext();
  const isMobile = useIsMobile();

  const [journal, setJournal] = useState<TradeJournal | null>(null);
  const [assignments, setAssignments] = useState<JournalTagAssignment[]>([]);
  const [patterns, setPatterns] = useState<ErrorTagPattern[]>([]);
  const [allJournals, setAllJournals] = useState<TradeJournal[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const reviewSavedRef = useRef(false);
  const reviewParam = searchParams.get('review');
  const requestedReviewMode = reviewParam === 'edit' || reviewParam === 'required'
    ? reviewParam
    : null;

  useEffect(() => {
    if (!id || !userId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const j = await getJournalById(id);
        if (cancelled) return;
        if (!j || j.user_id !== userId) {
          toast.error('该交易日记不存在或无权访问');
          nav('/journal');
          return;
        }
        setJournal(j);
        const [as, ps, bulk] = await Promise.all([
          listAssignmentsForJournal(j.id),
          listPatterns(userId, { includeArchived: true }),
          listAllJournalDataForUser(userId),
        ]);
        if (cancelled) return;
        setAssignments(as);
        setPatterns(ps);
        setAllJournals(bulk.journals);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, userId, nav, reloadKey]);

  useEffect(() => {
    reviewSavedRef.current = false;
  }, [id, requestedReviewMode]);

  useEffect(() => {
    if (journal?.id && requestedReviewMode) setEditOpen(true);
  }, [journal?.id, requestedReviewMode]);

  const tradeRecord: TradeRecord | null = useMemo(() => {
    if (!journal?.trade_record_id) return null;
    return buildTradeRecordLookup(tradeHistory).get(journal.trade_record_id) ?? null;
  }, [journal, tradeHistory]);
  const objectiveCloseTime = useMemo(
    () => journal ? journalCloseOperationTime(journal, tradeRecord) : null,
    [journal, tradeRecord],
  );
  const requiredReviewPending = Boolean(
    requestedReviewMode === 'required'
    && journal
    && !journal.post_reviewed_at
    && !reviewSavedRef.current,
  );
  const guardRequiredReviewUnload = useCallback((event: BeforeUnloadEvent) => {
    if (!requiredReviewPending) return;
    event.preventDefault();
    event.returnValue = '';
  }, [requiredReviewPending]);
  useBeforeUnload(guardRequiredReviewUnload);

  const clearReviewRequest = useCallback(() => {
    if (!requestedReviewMode) return;
    const next = new URLSearchParams(searchParams);
    next.delete('review');
    next.delete('from');
    setSearchParams(next, { replace: true });
  }, [requestedReviewMode, searchParams, setSearchParams]);

  const handleReviewOpenChange = (open: boolean) => {
    if (!open && requiredReviewPending && !reviewSavedRef.current) {
      toast.error('请先完成并保存本笔平仓评价，再离开');
      return;
    }
    setEditOpen(open);
    if (!open) clearReviewRequest();
  };

  if (loading || !journal) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Skeleton className="h-10 w-full mb-4 bg-card" />
        <div className={isMobile ? '' : 'grid grid-cols-[1fr_400px] gap-3'}>
          <Skeleton className="h-[60vh] bg-card" />
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 bg-card" />)}
          </div>
        </div>
      </div>
    );
  }

  const fmtSimTime = (() => {
    const d = new Date(journal.pre_simulated_time);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  })();

  const dirLabel = journal.direction === 'long' ? 'LONG' : journal.direction === 'short' ? 'SHORT' : 'PASS';
  const dirColor = journal.direction === 'long' ? 'text-[#0ECB81]'
    : journal.direction === 'short' ? 'text-[#F6465D]' : 'text-muted-foreground';
  const attributionComplete = Boolean(
    journal.post_reviewed_at &&
    journal.post_reflection?.trim() &&
    journal.post_correct_action?.trim(),
  );
  const hindsightLocked = journal.direction !== 'no_entry' && !attributionComplete;

  const hindsightGuard = (
    <div className="h-full min-h-[360px] rounded border border-[#F0B90B]/35 bg-card flex items-center justify-center p-8">
      <div className="max-w-[520px] text-center space-y-3">
        <div className="mx-auto h-10 w-10 rounded-full bg-[#F0B90B]/12 border border-[#F0B90B]/35 flex items-center justify-center">
          <AlertOctagon className="h-5 w-5 text-[#F0B90B]" />
        </div>
        <div className="text-[15px] font-medium">后续走势已隐藏</div>
        <div className="text-[12px] leading-6 text-muted-foreground">
          为封住 hindsight bias，必须先完成结果归因、错误标签和可执行修正，再揭示平仓后的行情路径。
        </div>
        <Button
          size="sm"
          className="h-8 bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black text-[12px]"
          onClick={() => setEditOpen(true)}
        >
          先完成归因
        </Button>
      </div>
    </div>
  );

  return (
    <ReplayProvider journal={journal} tradeRecord={tradeRecord} assignments={assignments} patterns={patterns}>
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
          <div className="px-6 py-3 max-w-[1600px] mx-auto w-full flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <BackButton />
              <h1 className="text-[14px] font-medium shrink-0">L5 复盘 · {journal.symbol}</h1>
            </div>
            <div className="font-mono text-[11px] text-muted-foreground truncate flex-1 text-center hidden md:block">
              <span className={dirColor}>{dirLabel}</span>
              {journal.leverage != null && journal.direction !== 'no_entry' && (
                <> · 杠杆 {journal.leverage}×</>
              )}
              {' · 模拟 '}{fmtSimTime}
              <span className="ml-2 text-foreground/70">
                · 实际开仓 <span className="text-foreground">{formatBeijingTime(journalOpenOperationTime(journal))}</span>
              </span>
              {objectiveCloseTime != null && (
                <span className="ml-2 text-foreground/70">
                  · 平仓 <span className="text-foreground">{formatBeijingTime(objectiveCloseTime)}</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`h-6 px-2 rounded text-[11px] font-medium flex items-center ${outcomeColor(journal.post_outcome)}`}>
                {outcomeLabel(journal.post_outcome)}
              </span>
              {journal.post_r_multiple != null && (
                <span className={`font-mono text-[11px] ${pnlColor(journal.post_r_multiple)}`}>
                  R̄ {journal.post_r_multiple.toFixed(2)}
                </span>
              )}
              {journal.post_realized_pnl != null && (
                <span className={`font-mono text-[11px] ${pnlColor(journal.post_realized_pnl)}`}>
                  {journal.post_realized_pnl >= 0 ? '+' : ''}{journal.post_realized_pnl.toFixed(2)} USDT
                </span>
              )}
              <Button size="sm" variant="ghost" className="h-7 text-[11px]"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('replay:scroll-to-deep-analysis'));
                }}>
                <BrainCircuit className="w-3 h-3 mr-1" /> L5 上卷
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]"
                onClick={() => setEditOpen(true)}>
                <Pencil className="w-3 h-3 mr-1" /> 编辑评价
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-4 min-h-0">
          {hindsightLocked ? (
            <div className={isMobile ? 'h-[calc(100vh-120px)]' : 'h-[calc(100vh-100px)] grid grid-cols-[1fr_400px] gap-3 min-h-0'}>
              <div className="min-h-0">{hindsightGuard}</div>
              {!isMobile && (
                <div className="rounded border border-border bg-card p-4 text-[12px] text-muted-foreground leading-6">
                  归因完成前，本页只保留开仓快照入口，不展示后续 K 线、结果解释或走势复盘。先完成“反 / 止 / 结构 / 置信”的事实核验，再把误差上卷到 L5。
                </div>
              )}
            </div>
          ) : isMobile ? (
            <div className="h-full flex flex-col gap-2">
              <div className="h-[55vh] min-h-0"><ReplayChartView /></div>
              <div className="h-[45vh] min-h-0 overflow-y-auto">
                <ContextChannelsStack allJournals={allJournals} />
              </div>
            </div>
          ) : (
            <div className="h-[calc(100vh-100px)] grid grid-cols-[1fr_400px] gap-3 min-h-0">
              <div className="min-h-0"><ReplayChartView /></div>
              <div className="min-h-0">
                <ContextChannelsStack allJournals={allJournals} />
              </div>
            </div>
          )}
        </main>

        <PostTradeReviewSheet
          isOpen={editOpen}
          onOpenChange={handleReviewOpenChange}
          journal={journal}
          tradeRecord={tradeRecord}
          requireSaveBeforeClose={requiredReviewPending}
          onReviewed={updated => {
            reviewSavedRef.current = true;
            setJournal(updated);
            setEditOpen(false);
            clearReviewRequest();
            setReloadKey(k => k + 1);
          }}
        />
      </div>
    </ReplayProvider>
  );
}
