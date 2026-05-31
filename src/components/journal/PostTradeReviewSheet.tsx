/**
 * 平仓评价抽屉 — 桌面 right Sheet / 移动 bottom Sheet
 * 注意：本抽屉一旦被打开（journal.post_reviewed_at == null）就不允许 dismiss。
 *      用户必须填完字段并保存才能离开。这是为了堵住"静默关闭"漏洞。
 */
import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';
import { Pencil, ChevronDown, BrainCircuit } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { COGNITIVE_BIAS_LABELS } from '@/lib/cognitiveBiasTags';
import { parseHedgeBoundaryBasis } from '@/lib/hedgeBoundaryBasis';
import { HEDGE_BOUNDARY_STANCE_LABELS, HEDGE_ORDER_METHOD_LABELS, HEDGE_TYPE_LABELS } from '@/lib/hedgeTypes';
import {
  finalizeJournalReview, replacePhaseAssignments,
  listAssignmentsForJournal, countPatternOccurrencesLast30Days, listPatterns,
  updateJournalDeepAnalysis, stampJournalCloseRealTime,
} from '@/lib/journalApi';
import type { TradeJournal, TradeOutcome, ErrorTagPattern } from '@/types/journal';
import { MENTAL_STATE_LABELS, PAIN_TAG_LABELS } from '@/types/journal';
import type { PainTag } from '@/types/journal';
import { formatBeijingTime } from '@/lib/timeFormat';
import type { TradeRecord } from '@/types/trading';
import { JournalTagPicker } from './JournalTagPicker';
import {
  SixStepAnalysisForm, EMPTY_SIX_STEP, pickSixStepValue, countCompletedSteps,
  type SixStepValue,
} from './SixStepAnalysisForm';

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  journal: TradeJournal | null;
  tradeRecord?: TradeRecord | null;
  onReviewed?: (updated: TradeJournal) => void;
  onAutoPause?: () => void;
}

export function PostTradeReviewSheet({
  isOpen, onOpenChange, journal, tradeRecord, onReviewed, onAutoPause,
}: Props) {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { setTradeHistory } = useTradingContext();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagNotes, setTagNotes] = useState<Record<string, string>>({});
  const [noErrors, setNoErrors] = useState(false);
  const [reflection, setReflection] = useState('');
  const [correctAction, setCorrectAction] = useState('');
  const [exitReason, setExitReason] = useState('');
  const [resultSummary, setResultSummary] = useState('');
  const [decisionQuality, setDecisionQuality] = useState<TradeJournal['post_decision_quality']>('mixed');
  const [expectancyReview, setExpectancyReview] = useState('');
  const [premortemReview, setPremortemReview] = useState('');
  const [invalidationReview, setInvalidationReview] = useState('');
  const [falsificationStatus, setFalsificationStatus] = useState<TradeJournal['exit_falsification_status']>(null);
  const [falsificationNote, setFalsificationNote] = useState('');
  const [hedgeWorthIt, setHedgeWorthIt] = useState<TradeJournal['hedge_worth_it']>(null);
  const [opponentWasRight, setOpponentWasRight] = useState<boolean | null>(null);
  const [fiveStepGoal, setFiveStepGoal] = useState('');
  const [fiveStepProblem, setFiveStepProblem] = useState('');
  const [proximateCause, setProximateCause] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [designIntervention, setDesignIntervention] = useState('');
  const [interventionType, setInterventionType] = useState<NonNullable<TradeJournal['post_intervention_type']>>('rule');
  const [executionMonitor, setExecutionMonitor] = useState('');
  const [fiveStepWeakPoint, setFiveStepWeakPoint] = useState<NonNullable<TradeJournal['post_five_step_weak_point']>>('diagnosis');
  const [rMultipleOverride, setRMultipleOverride] = useState<string>('');
  const [editingR, setEditingR] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hotCounts, setHotCounts] = useState<Record<string, number>>({});
  const [allPatterns, setAllPatterns] = useState<ErrorTagPattern[]>([]);
  const [sixStep, setSixStep] = useState<SixStepValue>(EMPTY_SIX_STEP);
  const [sixStepOpen, setSixStepOpen] = useState(false);
  /** Local override so the just-stamped close time renders immediately without re-fetch. */
  const [stampedCloseTime, setStampedCloseTime] = useState<string | null>(null);
  const pausedOnce = useState({ done: false })[0];

  // Auto-pause + reset state per journal
  useEffect(() => {
    if (!isOpen || !journal) return;
    if (!pausedOnce.done) { pausedOnce.done = true; onAutoPause?.(); }
    setStampedCloseTime(null);
    (async () => {
      try {
        const existing = await listAssignmentsForJournal(journal.id);
        const post = existing.filter(a => a.tagged_phase === 'post');
        setSelectedTags(post.map(a => a.pattern_id));
        const ns: Record<string, string> = {};
        post.forEach(a => { if (a.note) ns[a.pattern_id] = a.note; });
        setTagNotes(ns);
        setNoErrors(post.length === 0 && !!journal.post_reviewed_at);
        setReflection(journal.post_reflection ?? '');
        setCorrectAction(journal.post_correct_action ?? '');
        setExitReason(tradeRecord?.exit_reason_text ?? '');
        setResultSummary(journal.post_result_summary ?? '');
        setDecisionQuality(journal.post_decision_quality ?? 'mixed');
        setExpectancyReview(journal.post_positive_expectancy_review ?? '');
        setPremortemReview(journal.post_premortem_review ?? '');
        setInvalidationReview(journal.post_invalidation_review ?? '');
        setFalsificationStatus(journal.exit_falsification_status ?? null);
        setFalsificationNote(journal.exit_falsification_note ?? '');
        setHedgeWorthIt(journal.hedge_worth_it ?? null);
        setOpponentWasRight(journal.post_opponent_was_right ?? null);
        setFiveStepGoal(journal.post_five_step_goal ?? '');
        setFiveStepProblem(journal.post_five_step_problem ?? '');
        setProximateCause(journal.post_proximate_cause ?? '');
        setRootCause(journal.post_root_cause ?? '');
        setDesignIntervention(journal.post_design_intervention ?? '');
        setInterventionType(journal.post_intervention_type ?? 'rule');
        setExecutionMonitor(journal.post_execution_monitor ?? '');
        setFiveStepWeakPoint(journal.post_five_step_weak_point ?? 'diagnosis');
        setRMultipleOverride(journal.post_r_multiple != null ? String(journal.post_r_multiple) : '');
        setSixStep(pickSixStepValue(journal));
        setSixStepOpen(countCompletedSteps(pickSixStepValue(journal)) > 0);
        if (user) {
          listPatterns(user.id).then(setAllPatterns).catch(() => {});
        }
        // Stamp the real close time on first open (idempotent — API noop if already set)
        if (!journal.post_reviewed_at && !journal.post_real_close_time) {
          const stamped = await stampJournalCloseRealTime(journal.id);
          if (stamped) setStampedCloseTime(stamped);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { pausedOnce.done = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, journal?.id, tradeRecord?.id]);

  // 计算频次告警
  useEffect(() => {
    if (!user || selectedTags.length === 0) { setHotCounts({}); return; }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        selectedTags.map(async id => {
          try {
            const n = await countPatternOccurrencesLast30Days(user.id, id);
            return [id, n] as const;
          } catch { return [id, 0] as const; }
        }),
      );
      if (!cancelled) setHotCounts(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [selectedTags, user]);

  // Auto outcome — guard for null journal so hooks order is stable
  const pnl = tradeRecord?.pnl ?? journal?.post_realized_pnl ?? 0;
  const outcome: TradeOutcome =
    journal?.direction === 'no_entry' ? 'no_entry'
    : pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven';
  const computedR = useMemo(() => {
    const ml = journal?.pre_max_loss_usdt;
    if (!ml || ml === 0) return null;
    return pnl / ml;
  }, [pnl, journal?.pre_max_loss_usdt]);
  const finalR = rMultipleOverride !== '' && !isNaN(Number(rMultipleOverride))
    ? Number(rMultipleOverride)
    : computedR;

  const holdDurationLabel = useMemo(() => {
    if (!journal) return '—';
    const start = new Date(journal.pre_simulated_time).getTime();
    const end = tradeRecord?.closeTime ?? Date.now();
    const diff = Math.max(0, end - start);
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }, [journal, tradeRecord?.closeTime]);

  // Hard-block dismiss when an unreviewed journal is open. Editing an already-reviewed
  // journal stays freely dismissible.
  const unreviewedBlock = !!journal && !journal.post_reviewed_at;
  const guardedOpenChange = (next: boolean) => {
    if (!next && unreviewedBlock) {
      toast.error('请先完成本笔平仓评价，再离开');
      return;
    }
    onOpenChange(next);
  };

  // Render loading placeholder instead of null to keep hook order stable
  if (!journal) {
    const placeholder = (
      <div className="p-6 space-y-3">
        <div className="h-4 w-32 bg-muted rounded animate-pulse" />
        <div className="h-3 w-full bg-muted rounded animate-pulse" />
        <div className="h-3 w-3/4 bg-muted rounded animate-pulse" />
        <div className="h-3 w-2/3 bg-muted rounded animate-pulse" />
      </div>
    );
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent
          side={isMobile ? 'bottom' : 'right'}
          className={isMobile
            ? 'h-[60vh] rounded-t-2xl p-0 bg-card border-t border-border text-foreground'
            : 'w-[640px] sm:max-w-[640px] p-0 bg-card border-l border-border text-foreground'}
        >
          {placeholder}
        </SheetContent>
      </Sheet>
    );
  }

  const checklistItemsArr = journal.pre_checklist_items ?? [];
  const checklistRequired = checklistItemsArr.filter(i => i.required);
  const checklistOptional = checklistItemsArr.filter(i => !i.required);
  const reqChecked = checklistRequired.filter(i => i.checked).length;
  const optChecked = checklistOptional.filter(i => i.checked).length;
  const isHedge = journal.order_kind === 'hedge';
  const positionModeLabel = journal.position_mode === 'isolated'
    ? '逐仓'
    : journal.position_mode === 'cross'
      ? '全仓'
      : '—';
  const positionModeChipClass = journal.position_mode === 'isolated'
    ? 'bg-[#0ECB81]/10 text-[#0ECB81]'
    : journal.position_mode === 'cross'
      ? 'bg-[#F6465D]/10 text-[#F6465D]'
      : 'bg-muted text-muted-foreground';
  const isSnapshotV2 = Boolean(
    journal.pre_thesis_why_right
    || journal.pre_premortem_failure_reason
    || journal.pre_falsification_signal,
  );
  const snapshotWhyRight = journal.pre_thesis_why_right || journal.pre_positive_expectancy || journal.pre_entry_reason || '';
  const snapshotPremortem = journal.pre_premortem_failure_reason || journal.pre_mortem_text || '';
  const snapshotFalsification = journal.pre_falsification_signal || journal.pre_invalidation_condition || '';
  const hedgeBoundaryBasis = parseHedgeBoundaryBasis(journal.hedge_boundary_basis);
  const hasStructuredHedgeDownPlan = Boolean(
    journal.hedge_down_if_chop
    || journal.hedge_down_if_trend
    || journal.hedge_down_if_rebound,
  );
  const riskAnchorPct = journal.pre_max_loss_usdt != null && journal.pre_account_equity_usdt
    ? (journal.pre_max_loss_usdt / journal.pre_account_equity_usdt) * 100
    : null;

  const tagsValid = noErrors || selectedTags.length >= 1;
  const reflectionValid = !!reflection.trim();
  const correctValid = !!correctAction.trim();
  const exitReasonValid = journal.direction === 'no_entry' || !!exitReason.trim();
  const resultValid = !!resultSummary.trim();
  const decisionValid = !!decisionQuality;
  const reviewLoopValid = !!expectancyReview.trim() && !!premortemReview.trim() && !!invalidationReview.trim();
  const opponentValid = !journal.pre_opponent_statement || opponentWasRight !== null;
  const hedgeWorthItValid = !isHedge || hedgeWorthIt != null;
  const fiveStepValid = [
    fiveStepGoal,
    fiveStepProblem,
    proximateCause,
    rootCause,
    designIntervention,
    executionMonitor,
  ].every(value => value.trim().length > 0);
  const canSave = tagsValid && reflectionValid && correctValid && exitReasonValid && resultValid && decisionValid && reviewLoopValid && opponentValid && hedgeWorthItValid && fiveStepValid && !saving;

  const hotWarnings = selectedTags
    .map(id => {
      const p = allPatterns.find(x => x.id === id);
      const n = hotCounts[id] ?? 0;
      return p && n >= 2 ? { pattern: p, count: n } : null;
    })
    .filter(Boolean) as { pattern: ErrorTagPattern; count: number }[];

  const sectionCardClass = 'rounded-xl border border-border/70 bg-card/70 shadow-[0_10px_30px_rgba(0,0,0,0.04)]';
  const subtleLabelClass = 'text-[11px] font-medium text-muted-foreground';
  const metricCardClass = 'rounded-xl border border-border/70 bg-background/70 px-3 py-3';

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const updated = await finalizeJournalReview(journal.id, {
        post_outcome: outcome,
        post_realized_pnl: pnl,
        post_r_multiple: finalR,
        post_reflection: reflection.trim(),
        post_correct_action: correctAction.trim(),
        post_result_summary: resultSummary.trim(),
        post_decision_quality: decisionQuality,
        post_positive_expectancy_review: expectancyReview.trim(),
        post_premortem_review: premortemReview.trim(),
        post_invalidation_review: invalidationReview.trim(),
        exit_falsification_status: falsificationStatus,
        exit_falsification_note: falsificationNote.trim() || null,
        hedge_worth_it: isHedge ? hedgeWorthIt : null,
        post_opponent_was_right: opponentWasRight,
        post_five_step_goal: fiveStepGoal.trim(),
        post_five_step_problem: fiveStepProblem.trim(),
        post_proximate_cause: proximateCause.trim(),
        post_root_cause: rootCause.trim(),
        post_design_intervention: designIntervention.trim(),
        post_intervention_type: interventionType,
        post_execution_monitor: executionMonitor.trim(),
        post_five_step_weak_point: fiveStepWeakPoint,
      });
      const assignments = noErrors ? [] : selectedTags.map(id => ({
        patternId: id,
        phase: 'post' as const,
        note: tagNotes[id] ?? null,
      }));
      await replacePhaseAssignments(journal.id, 'post', assignments);
      // Save deep analysis if any field was filled
      const hasDeep = Object.values(sixStep).some(v => String(v ?? '').trim().length > 0);
      if (hasDeep) {
        try {
          await updateJournalDeepAnalysis(journal.id, sixStep);
          if (sixStep.post_new_rule_draft.trim().length > 0) {
            toast.info('提示：Step 6 已写但未加入 checklist，可前往复现页激活');
          }
        } catch (e) {
          console.warn('[deep] save failed', e);
        }
      }
      if (tradeRecord?.id) {
        const nextExitReason = exitReason.trim();
        setTradeHistory(prev => prev.map(t => (
          t.id === tradeRecord.id ? { ...t, exit_reason_text: nextExitReason } : t
        )));
      }
      toast.success('已保存平仓评价');
      window.dispatchEvent(new CustomEvent('journal:reviewed', { detail: { journalId: journal.id } }));
      onReviewed?.(updated);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const applySixStepToFields = () => {
    const ref = `[场景] ${sixStep.post_error_scenario}\n[现实] ${sixStep.post_reality_feedback}\n[根因] ${sixStep.post_real_problem}`;
    setReflection(ref);
    if (sixStep.post_new_rule_draft) setCorrectAction(sixStep.post_new_rule_draft);
  };

  const exitMethodLabel = (() => {
    const m = tradeRecord?.action === 'LIQUIDATION' ? 'liquidation' : tradeRecord?.exit_method;
    if (!m) return '—';
    if (m === 'manual') return '手动';
    if (m === 'sl') return '止损';
    if (m === 'liquidation') return '爆仓';
    if (m === 'tp1') return '止盈 1';
    if (m === 'tp2') return '止盈 2';
    if (m === 'tp3') return '止盈 3';
    return m;
  })();

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  const calibrationPct = journal.pre_calibration_win_pct;
  const calibrationScore = calibrationPct == null || journal.direction === 'no_entry'
    ? null
    : Math.pow((calibrationPct / 100) - (outcome === 'win' ? 1 : 0), 2);
  const calibrationOutcomeLabel = outcome === 'win'
    ? '实际盈利'
    : outcome === 'loss'
      ? '实际亏损'
      : outcome === 'breakeven'
        ? '实际保本'
        : '未入场';

  const body = (
    <>
      <div className="px-5 py-4 border-b border-border bg-gradient-to-b from-muted/25 to-background/80">
        <div className="text-[15px] font-semibold tracking-[0.01em] text-foreground">平仓评价</div>
        <div className="font-mono text-[11px] text-muted-foreground mt-0.5">
          {journal.symbol} · {journal.direction} · 模拟时间 {fmtTime(journal.pre_simulated_time)}
        </div>
      </div>

      <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1 bg-background">
        {journal.source === 'retroactive_from_record' && (
          <div className="rounded border border-[#F0B90B]/30 bg-[#F0B90B]/10 px-3 py-2 text-[11px] text-[#F0B90B]">
            这是历史回填，事后复盘有效，但避免编造当时未存在的决策。
          </div>
        )}
        {/* (A) Snapshot */}
        <Collapsible defaultOpen>
          <CollapsibleTrigger className={`w-full px-4 py-3 text-[11px] ${subtleLabelClass} flex items-center gap-1.5 hover:text-foreground transition-colors ${sectionCardClass}`}>
            <ChevronDown className="w-3 h-3" /> 开仓时的快照
          </CollapsibleTrigger>
          <CollapsibleContent className={`mt-2 space-y-2 text-[11px] font-mono text-foreground/85 px-4 py-4 ${sectionCardClass}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`inline-block rounded px-2 py-0.5 text-[10px] ${
                isHedge ? 'bg-[#F0B90B]/15 text-[#F0B90B]' : 'bg-foreground/10 text-foreground'
              }`}>{isHedge ? '对冲单' : '主力单'}</span>
              {journal.position_mode && (
                <span className={`inline-block rounded px-2 py-0.5 text-[10px] ${positionModeChipClass}`}>
                  {positionModeLabel}
                </span>
              )}
              {journal.position_mode === 'cross' && (
                <span className="inline-block rounded px-2 py-0.5 text-[10px] bg-[#F6465D]/10 text-[#F6465D]">
                  这笔在守卫上线前用了全仓
                </span>
              )}
              {!isSnapshotV2 && (
                <span className="inline-block rounded px-2 py-0.5 text-[10px] bg-muted text-muted-foreground">
                  旧版快照 v1
                </span>
              )}
            </div>
            <div className="border border-border/60 rounded-md bg-background/60 px-2.5 py-2 text-[10.5px] leading-relaxed">
              <div className="text-muted-foreground mb-1">实际操作时间（北京时间）</div>
              <div>开仓：<span className="text-foreground">{formatBeijingTime(journal.pre_real_time)}</span></div>
              <div>
                平仓：
                <span className="text-foreground">
                  {formatBeijingTime(journal.post_real_close_time ?? stampedCloseTime)}
                </span>
              </div>
            </div>
            {isHedge ? (
              <div className="grid gap-2">
                <div className="rounded-lg border border-[#F0B90B]/30 bg-[#F0B90B]/8 px-3 py-2 text-[11px] leading-relaxed text-foreground">
                  对冲不是下注，是把“未知、不可控的无限风险”，换成“已知、可衡量的极小摩擦成本”。
                </div>
                <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                  <span className="text-muted-foreground">对冲类型：</span>
                  {journal.hedge_type ? HEDGE_TYPE_LABELS[journal.hedge_type] : '—'}
                  {journal.hedge_necessity_pct != null ? <span> · 必要性 {journal.hedge_necessity_pct.toFixed(0)}%</span> : null}
                  {journal.hedge_conviction_pct != null ? <span> · 把握性 {journal.hedge_conviction_pct.toFixed(0)}%</span> : null}
                </div>
                <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                  <span className="text-muted-foreground">客观锚点：</span>
                  {journal.hedge_safety_strength != null ? <span>强劲 {journal.hedge_safety_strength}/5</span> : '—'}
                  {journal.hedge_safety_regularity != null ? <span> · 规则 {journal.hedge_safety_regularity}/5</span> : null}
                  {journal.hedge_risk_magnitude != null ? <span> · 烈度 {journal.hedge_risk_magnitude}/5</span> : null}
                </div>
                <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                  <span className="text-muted-foreground">边界：</span>
                  {journal.hedge_boundary_price != null ? journal.hedge_boundary_price.toFixed(4) : '—'}
                  {journal.hedge_boundary_stance ? <span> · {HEDGE_BOUNDARY_STANCE_LABELS[journal.hedge_boundary_stance]}</span> : null}
                  {journal.hedge_lock_profit_pct != null ? <span> · 锁定微利 {journal.hedge_lock_profit_pct}%</span> : null}
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                    <span className="text-muted-foreground">正：</span>{hedgeBoundaryBasis.whyRight || '—'}
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                    <span className="text-muted-foreground">反：</span>{hedgeBoundaryBasis.failureReason || '—'}
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                    <span className="text-muted-foreground">止：</span>{hedgeBoundaryBasis.invalidationSignal || '—'}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                  <span className="text-muted-foreground">向上预案：</span>{journal.hedge_resolution_up || '—'}
                </div>
                {hasStructuredHedgeDownPlan ? (
                  <div className="grid gap-2 md:grid-cols-3">
                    <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                      <span className="text-muted-foreground">向下 · 震荡：</span>{journal.hedge_down_if_chop || '—'}
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                      <span className="text-muted-foreground">向下 · 确认下行：</span>{journal.hedge_down_if_trend || '—'}
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                      <span className="text-muted-foreground">向下 · 快速反弹：</span>{journal.hedge_down_if_rebound || '—'}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                    <span className="text-muted-foreground">旧版向下预案：</span>{journal.hedge_resolution_down || '—'}
                  </div>
                )}
                <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                  <span className="text-muted-foreground">摩擦成本：</span>{journal.hedge_friction_cost || '—'}
                  {journal.hedge_order_method ? <span> · {HEDGE_ORDER_METHOD_LABELS[journal.hedge_order_method]}</span> : null}
                </div>
              </div>
            ) : isSnapshotV2 ? (
              <div className="grid gap-2">
                <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                  <span className="text-muted-foreground">这笔为什么会对：</span>{snapshotWhyRight || '—'}
                </div>
                <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                  <span className="text-muted-foreground">亏完最可能原因：</span>{snapshotPremortem || '—'}
                </div>
                <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                  <span className="text-muted-foreground">提前止损/拆仓信号：</span>{snapshotFalsification || '—'}
                </div>
                {calibrationPct != null && (
                  <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                    <span className="text-muted-foreground">开仓预测：</span>会对 {calibrationPct.toFixed(0)}% · 会错 {(100 - calibrationPct).toFixed(0)}%
                    {journal.pre_confidence_basis ? <span> · {journal.pre_confidence_basis}</span> : null}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div>• {isHedge ? '对冲理由' : '入场理由'}：{journal.pre_entry_reason || '—'}</div>
                {journal.pre_planned_stop_loss != null ? (
                  <div>• 预设止损/止盈：{journal.pre_planned_stop_loss} / {journal.pre_planned_take_profit ?? '—'} <span className="text-[10px] text-muted-foreground">（历史记录）</span></div>
                ) : journal.pre_planned_take_profit != null ? (
                  <div>• 预设止盈：{journal.pre_planned_take_profit}</div>
                ) : null}
              </>
            )}
            {journal.pre_max_loss_usdt != null && (
              <div>
                • 本次预设最大亏损：<span className="text-[#F6465D]">{journal.pre_max_loss_usdt.toFixed(2)} USDT</span>
                {riskAnchorPct != null ? <span className="text-muted-foreground"> · 占当时账户 {riskAnchorPct.toFixed(1)}%</span> : null}
              </div>
            )}
            {journal.pre_risk_awareness && <div>• 风险认识：{journal.pre_risk_awareness}</div>}
            {journal.pre_risk_management && <div>• 风险管理：{journal.pre_risk_management}</div>}
            <div>
              • 心态自评：{journal.pre_mental_state} 分（{MENTAL_STATE_LABELS[journal.pre_mental_state]}）
              {journal.pre_mental_trigger ? ` · ${journal.pre_mental_trigger}` : ''}
            </div>
            {journal.direction !== 'no_entry' && (
              <div>• 杠杆 / 仓位模式：{journal.leverage != null ? `${journal.leverage}x` : '—'} · {positionModeLabel}</div>
            )}
            {checklistItemsArr.length > 0 && (
              <div>
                • Checklist：{reqChecked}/{checklistRequired.length} 必填 · {optChecked}/{checklistOptional.length} 可选 · {journal.pre_checklist_passed ? '通过' : '未通过'}
              </div>
            )}
            {(journal.pre_info_kline_facts || journal.pre_opponent_statement || journal.pre_pain_tags?.length) && (
              <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
                {journal.pre_info_kline_facts && <div>• K线事实：{journal.pre_info_kline_facts}</div>}
                {journal.pre_info_macro_facts && <div>• 宏观事实：{journal.pre_info_macro_facts}</div>}
                {journal.pre_info_rule_advice && <div>• 规则建议：{journal.pre_info_rule_advice}</div>}
                {journal.pre_info_intuition && <div>• 直觉/感觉：{journal.pre_info_intuition}</div>}
                {journal.pre_info_designer_view && <div>• 设计者视角：{journal.pre_info_designer_view}</div>}
                {journal.pre_opponent_statement && <div>• 反对者：{journal.pre_opponent_statement}</div>}
                {journal.pre_pain_tags && journal.pre_pain_tags.length > 0 && (
                  <div>• 情绪标签：{journal.pre_pain_tags.map(tag => PAIN_TAG_LABELS[tag as PainTag] ?? tag).join(' / ')}</div>
                )}
                {journal.pre_cognitive_bias_tags && journal.pre_cognitive_bias_tags.length > 0 && (
                  <div>• 认知偏差：{journal.pre_cognitive_bias_tags.map(tag => COGNITIVE_BIAS_LABELS[tag] ?? tag).join(' / ')}</div>
                )}
                {journal.pre_executor_self && <div>• 执行者-我：{journal.pre_executor_self}</div>}
                {journal.pre_designer_self && <div>• 设计者-我：{journal.pre_designer_self}</div>}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* (B) Auto outcome */}
        {!tradeRecord && journal.direction !== 'no_entry' && (
          <div className="rounded-xl border border-[#F0B90B]/30 bg-[#F0B90B]/8 px-3 py-2.5 text-[11px] leading-relaxed text-[#F0B90B]">
            未找到对应的成交记录，下方判定字段使用快照中保存的数据，必要时可手填 R 倍数覆盖。
          </div>
        )}
        <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px] font-mono ${sectionCardClass} p-3`}>
          <div className={metricCardClass}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">结果</div>
            <div className={outcome === 'win' ? 'text-[#0ECB81]' : outcome === 'loss' ? 'text-[#F6465D]' : 'text-foreground'}>
              {outcome}
            </div>
          </div>
          <div className={metricCardClass}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">实现 P&L</div>
            <div className={pnl >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}>
              {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
            </div>
          </div>
          <div className={metricCardClass}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              R 倍数
              <button onClick={() => setEditingR(v => !v)}><Pencil className="w-2.5 h-2.5 text-muted-foreground hover:text-foreground" /></button>
            </div>
            {editingR ? (
              <Input
                value={rMultipleOverride}
                onChange={e => setRMultipleOverride(e.target.value)}
                onBlur={() => setEditingR(false)}
                autoFocus
                className="mt-1 h-7 text-[12px] bg-card border-border/70 font-mono rounded-md"
              />
            ) : (
              <div>{finalR != null ? finalR.toFixed(2) + ' R' : '—'}</div>
            )}
          </div>
          <div className={metricCardClass}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">持仓时长</div>
            <div>{holdDurationLabel}</div>
          </div>
        </div>

        {isHedge && (
          <div className={`space-y-3 px-4 py-4 ${sectionCardClass}`}>
            <div>
              <div className="text-[12px] font-medium">这个对冲值回成本了吗？</div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                回答的不是方向对错，而是这份保险是否真的值回它付出的摩擦成本。
              </div>
            </div>
            <div className="grid gap-2">
              {[
                { value: 'yes', label: '值', desc: '该锁的锁住了 / 边界划对了' },
                { value: 'partial', label: '部分', desc: '起到了一部分保护，但不够完整' },
                { value: 'no', label: '不值', desc: '被噪音打穿白付摩擦 / 白白盖死上限' },
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setHedgeWorthIt(option.value as NonNullable<TradeJournal['hedge_worth_it']>)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    hedgeWorthIt === option.value
                      ? 'border-[#F0B90B] bg-[#F0B90B]/10 text-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent'
                  }`}
                >
                  <div className="text-[11px] font-medium">{option.label}</div>
                  <div className="mt-0.5 text-[10px] leading-relaxed">{option.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {calibrationPct != null && (
          <div className={`space-y-2 px-4 py-4 ${sectionCardClass}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-[12px] font-medium">Calibration 比对</div>
              {calibrationScore != null && (
                <span className={`font-mono text-[11px] ${
                  calibrationScore <= 0.2 ? 'text-[#0ECB81]' : calibrationScore <= 0.3 ? 'text-[#F0B90B]' : 'text-[#F6465D]'
                }`}>
                  Brier {calibrationScore.toFixed(3)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className={metricCardClass}>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">开仓预测胜率</div>
                <div>{calibrationPct.toFixed(0)}%</div>
              </div>
              {(journal.pre_confidence_interval_low_pct != null || journal.pre_confidence_interval_high_pct != null) && (
                <div className={metricCardClass}>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">90% 区间</div>
                  <div>
                    {journal.pre_confidence_interval_low_pct != null ? journal.pre_confidence_interval_low_pct.toFixed(0) : '—'}%
                    ~
                    {journal.pre_confidence_interval_high_pct != null ? journal.pre_confidence_interval_high_pct.toFixed(0) : '—'}%
                  </div>
                </div>
              )}
              <div className={metricCardClass}>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">平仓后结果</div>
                <div className={outcome === 'win' ? 'text-[#0ECB81]' : outcome === 'loss' ? 'text-[#F6465D]' : 'text-muted-foreground'}>
                  {calibrationOutcomeLabel}
                </div>
              </div>
            </div>
            {(journal.pre_calibration_reference_class || journal.pre_calibration_competence_basis || journal.pre_calibration_update_signal) && (
              <div className="grid gap-2 text-[11px] leading-relaxed">
                {journal.pre_calibration_reference_class && (
                  <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                    <span className="text-muted-foreground">历史回溯：</span>{journal.pre_calibration_reference_class}
                  </div>
                )}
                {journal.pre_calibration_competence_basis && (
                  <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                    <span className="text-muted-foreground">能力圈依据：</span>{journal.pre_calibration_competence_basis}
                  </div>
                )}
                {journal.pre_calibration_update_signal && (
                  <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                    <span className="text-muted-foreground">更新检查：</span>{journal.pre_calibration_update_signal}
                  </div>
                )}
              </div>
            )}
            {journal.pre_mortem_text && (
              <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-[11px] leading-relaxed">
                <span className="text-muted-foreground">开仓前最担心：</span>{journal.pre_mortem_text}
              </div>
            )}
          </div>
        )}

        <div className={`space-y-3 px-4 py-4 ${sectionCardClass}`}>
          <div className="text-[12px] font-medium">结果与决策质量分离</div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">这笔结果如何？*</Label>
            <Textarea
              rows={2}
              value={resultSummary}
              onChange={e => setResultSummary(e.target.value)}
              placeholder="只写结果事实：赚/亏/保本、平仓方式、是否达到原计划。"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">按当时信息看，这笔决策质量如何？*</Label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'good', label: '好决策', className: 'border-[#0ECB81] bg-[#0ECB81]/10 text-[#0ECB81]' },
                { value: 'mixed', label: '混合', className: 'border-[#F0B90B] bg-[#F0B90B]/10 text-[#F0B90B]' },
                { value: 'bad', label: '坏决策', className: 'border-[#F6465D] bg-[#F6465D]/10 text-[#F6465D]' },
              ].map(item => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setDecisionQuality(item.value as TradeJournal['post_decision_quality'])}
                  className={`h-9 rounded-lg border text-[11px] ${
                    decisionQuality === item.value ? item.className : 'border-border bg-background text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">坏结果不自动等于坏决策；好结果也不自动等于好决策。</p>
            {outcome === 'win' && (
              <p className="rounded border border-[#F0B90B]/40 bg-[#F0B90B]/10 px-2 py-1.5 text-[10px] leading-relaxed text-[#D89B00]">
                {decisionQuality === 'good'
                  ? '这笔赚钱了 — 但先确认它不是靠运气：如果当时推理错了、只是运气好，照样标成「坏决策」记下来。'
                  : '赚钱但靠运气 = 坏决策。结果盈利不改判当时的推理质量，照样如实记下来。'}
              </p>
            )}
          </div>
        </div>

        <div className={`space-y-3 px-4 py-4 ${sectionCardClass}`}>
          <div className="text-[12px] font-medium">下单前三问复核</div>
          {snapshotWhyRight && (
            <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-[11px] leading-relaxed">
              <span className="text-muted-foreground">当时认为会对：</span>{snapshotWhyRight}
            </div>
          )}
          {snapshotPremortem && (
            <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-[11px] leading-relaxed">
              <span className="text-muted-foreground">当时预演的亏损原因：</span>{snapshotPremortem}
            </div>
          )}
          {journal.pre_falsification_signal && (
            <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-3 space-y-3">
              <div>
                <div className="text-[12px] font-medium text-foreground">证伪信号校验</div>
                <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  你开仓时写的证伪信号：
                </div>
                <div className="mt-1 rounded border border-border/60 bg-card px-3 py-2 text-[11px] leading-relaxed text-foreground">
                  {journal.pre_falsification_signal}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-[12px] font-medium">这个信号在平仓前触发了吗？</Label>
                <div className="grid gap-2">
                  {[
                    { value: 'triggered_reacted', label: '触发了，我及时反应了' },
                    { value: 'triggered_late', label: '触发了，但我反应晚了' },
                    { value: 'not_triggered', label: '没触发，我是主观平仓' },
                  ].map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setFalsificationStatus(option.value as NonNullable<TradeJournal['exit_falsification_status']>)}
                      className={`rounded-lg border px-3 py-2 text-left text-[11px] transition-colors ${
                        falsificationStatus === option.value
                          ? 'border-[#F0B90B] bg-[#F0B90B]/10 text-foreground'
                          : 'border-border bg-background text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <Textarea
                  rows={2}
                  value={falsificationNote}
                  onChange={event => setFalsificationNote(event.target.value)}
                  placeholder="备注（可选）"
                  className="text-[12px] bg-background/80 border-border/70 rounded-xl"
                />
                <div className="text-[10px] text-muted-foreground">这项是软性校验，可跳过，不阻塞保存。</div>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">正期望判断是否成立？*</Label>
            <Textarea
              rows={2}
              value={expectancyReview}
              onChange={e => setExpectancyReview(e.target.value)}
              placeholder="复核当时的赔率、结构、胜率假设；不要用最终盈亏倒推。"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">亏损原因是否命中 pre-mortem？*</Label>
            <Textarea
              rows={2}
              value={premortemReview}
              onChange={e => setPremortemReview(e.target.value)}
              placeholder="如果亏损，是否正是开仓前担心的原因；如果盈利，风险是否仍真实存在。"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl"
            />
          </div>
          {snapshotFalsification && (
            <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-[11px] leading-relaxed">
              <span className="text-muted-foreground">当时证伪/拆仓信号：</span>{snapshotFalsification}
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">证伪条件是否出现？你是否执行？*</Label>
            <Textarea
              rows={2}
              value={invalidationReview}
              onChange={e => setInvalidationReview(e.target.value)}
              placeholder="记录市场是否给出反证、你是否承认反证并执行。"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl"
            />
          </div>
        </div>

        {journal.pre_opponent_statement && (
          <div className={`space-y-3 px-4 py-4 ${sectionCardClass}`}>
            <div className="text-[12px] font-medium">反对者陈述追踪</div>
            <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-[11px] leading-relaxed">
              <span className="text-muted-foreground">开仓前反对者说：</span>{journal.pre_opponent_statement}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOpponentWasRight(true)}
                className={`h-9 rounded-lg border text-[11px] ${
                  opponentWasRight === true
                    ? 'border-[#F6465D] bg-[#F6465D]/10 text-[#F6465D]'
                    : 'border-border bg-background text-muted-foreground hover:bg-accent'
                }`}
              >
                反对者命中
              </button>
              <button
                type="button"
                onClick={() => setOpponentWasRight(false)}
                className={`h-9 rounded-lg border text-[11px] ${
                  opponentWasRight === false
                    ? 'border-[#0ECB81] bg-[#0ECB81]/10 text-[#0ECB81]'
                    : 'border-border bg-background text-muted-foreground hover:bg-accent'
                }`}
              >
                原方案成立
              </button>
            </div>
            {opponentWasRight === null && <div className="text-[10px] text-[#F6465D] text-right font-mono">必选</div>}
          </div>
        )}

        <div className={`space-y-3 px-4 py-4 ${sectionCardClass}`}>
          <div>
            <div className="text-[12px] font-medium">Dalio 五步诊断</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              目标、问题、诊断、设计、执行分开写；近因写动作，根因写性质。
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">目标 *</Label>
            <Textarea rows={2} value={fiveStepGoal} onChange={e => setFiveStepGoal(e.target.value)}
              placeholder="这条错题要把哪个可衡量指标改善到什么程度？"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">问题 *</Label>
            <Textarea rows={2} value={fiveStepProblem} onChange={e => setFiveStepProblem(e.target.value)}
              placeholder="精准描述问题，不写“心态不好”这种空泛结论。"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl" />
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-[12px] font-medium">近因（我做了什么动作）*</Label>
              <Textarea rows={2} value={proximateCause} onChange={e => setProximateCause(e.target.value)}
                placeholder="例如：提前拆掉对冲、追高加仓、没有执行证伪。"
                className="text-[12px] bg-background/80 border-border/70 rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-medium">根因（我是什么性质导致）*</Label>
              <Textarea rows={2} value={rootCause} onChange={e => setRootCause(e.target.value)}
                placeholder="例如：对浮亏耐受力低、对陌生结构过度自信。"
                className="text-[12px] bg-background/80 border-border/70 rounded-xl" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">设计干预 *</Label>
            <Textarea rows={2} value={designIntervention} onChange={e => setDesignIntervention(e.target.value)}
              placeholder="针对根因设计干预：原则、规则、SOP 或觉察项。"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl" />
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-[12px] font-medium">干预类型 *</Label>
              <select
                value={interventionType}
                onChange={e => setInterventionType(e.target.value as NonNullable<TradeJournal['post_intervention_type']>)}
                className="h-9 rounded-xl border border-border/70 bg-background/80 px-3 text-[12px] w-full"
              >
                <option value="principle">L1 原则</option>
                <option value="rule">L2 规则</option>
                <option value="sop">SOP</option>
                <option value="awareness">觉察项</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-medium">最薄弱的一步 *</Label>
              <select
                value={fiveStepWeakPoint}
                onChange={e => setFiveStepWeakPoint(e.target.value as NonNullable<TradeJournal['post_five_step_weak_point']>)}
                className="h-9 rounded-xl border border-border/70 bg-background/80 px-3 text-[12px] w-full"
              >
                <option value="goal">目标</option>
                <option value="problem">问题</option>
                <option value="diagnosis">诊断</option>
                <option value="design">设计</option>
                <option value="execution">执行</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">执行与监控 *</Label>
            <Textarea rows={2} value={executionMonitor} onChange={e => setExecutionMonitor(e.target.value)}
              placeholder="干预如何上线？未来用哪个指标确认它是否有效？"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl" />
          </div>
          {!fiveStepValid && <div className="text-[10px] text-[#F6465D] text-right font-mono">五步诊断必填</div>}
        </div>

        <div className={`space-y-2 px-4 py-4 ${sectionCardClass}`}>
          <div className="flex items-center justify-between gap-3">
            <Label className="text-[12px] font-medium">出场原因 *</Label>
            <span className="text-[11px] text-muted-foreground">出场方式：{exitMethodLabel}</span>
          </div>
          <Textarea
            rows={3}
            value={exitReason}
            onChange={e => setExitReason(e.target.value)}
            placeholder={
              tradeRecord?.exit_method === 'manual' || tradeRecord?.action === 'LIQUIDATION'
                ? '例如：跌破计划结构位后主动认错；或出现超预期波动，优先回收风险敞口。'
                : '例如：止盈触发后没有再追；止损触发符合预案，因此按系统执行离场。'
            }
            className="text-[12px] bg-background/80 border-border/70 rounded-xl"
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">这里写的是你为什么在这个位置离场，不是这笔交易最后学到了什么。</p>
            {!exitReasonValid && <span className="text-[10px] font-mono text-[#F6465D]">必填</span>}
          </div>
        </div>

        {/* (C) Tags */}
        {user && (
          <div className={`space-y-2 px-4 py-4 ${sectionCardClass}`}>
            <div className="flex items-center justify-between">
              <Label className="text-[12px] font-medium">错误标签 *</Label>
              <span className="text-[11px] text-muted-foreground">至少选 1 个，或勾选下方"本次无明显错误"</span>
            </div>
            <JournalTagPicker
              userId={user.id}
              selectedPatternIds={selectedTags}
              notes={tagNotes}
              onChange={(ids, ns) => { setSelectedTags(ids); setTagNotes(ns); }}
              disabled={noErrors}
            />
            <label className="flex items-center gap-2 text-[12px] text-foreground cursor-pointer rounded-lg border border-border/60 bg-background/60 px-3 py-2">
              <Checkbox
                checked={noErrors}
                onCheckedChange={v => {
                  const next = !!v;
                  setNoErrors(next);
                  if (next) { setSelectedTags([]); setTagNotes({}); }
                }}
              />
              ✓ 本次交易过程符合预期，无明显错误模式
            </label>
          </div>
        )}

        {/* (C+) 六步深度分析（可选） */}
        <Collapsible open={sixStepOpen} onOpenChange={setSixStepOpen}>
          <CollapsibleTrigger className="w-full rounded-xl border border-border/70 bg-gradient-to-r from-card via-card to-accent/20 px-4 py-3 flex items-center gap-2 transition-colors hover:bg-accent/30 shadow-[0_10px_30px_rgba(0,0,0,0.04)]">
            <BrainCircuit className="w-3.5 h-3.5 text-[#F0B90B]" />
            <div className="flex-1 text-left">
              <div className="text-[12px] font-medium text-foreground">进入六步深度分析（推荐）</div>
              <div className="text-[10px] text-muted-foreground">
                比"复盘文字"+"反事实"更结构化。完成后下方两个字段可自动生成。
              </div>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${sixStepOpen ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            <SixStepAnalysisForm value={sixStep} onChange={setSixStep} />
            <Button size="sm" variant="ghost" onClick={applySixStepToFields}
              className="h-8 rounded-lg text-[10px] border border-border/70 bg-card/80 hover:bg-accent/60">
              用六步内容回写下方字段
            </Button>
          </CollapsibleContent>
        </Collapsible>

        {/* (D) Reflection */}
        <div className={`space-y-2 px-4 py-4 ${sectionCardClass}`}>
          <Label className="text-[12px] font-medium">复盘文字（这笔交易里你真正学到了什么？）*</Label>
          <Textarea
            rows={4}
            value={reflection}
            onChange={e => setReflection(e.target.value)}
            placeholder="例如：本次入场理由在事后看仍然成立，但仓位过重；止损位过近导致被洗出后又看着行情走出预期方向。下次应根据 ATR 设置止损宽度。"
            className="text-[12px] bg-background/80 border-border/70 rounded-xl"
          />
          {!reflectionValid && <div className="text-[10px] text-[#F6465D] text-right font-mono">必填</div>}
        </div>

        {/* (E) Counterfactual */}
        <div className={`space-y-2 px-4 py-4 ${sectionCardClass}`}>
          <Label className="text-[12px] font-medium">如果重来一次，你会怎么做？*</Label>
          <Textarea
            rows={3}
            value={correctAction}
            onChange={e => setCorrectAction(e.target.value)}
            placeholder="例如：止损位放在 X 而非 Y；分批入场 3 次而非一次满仓；不在心态 ≤3 分时开仓。"
            className="text-[12px] bg-background/80 border-border/70 rounded-xl"
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">❗ 必须可执行——不是"下次更冷静"，而是"下次开仓前必须满足 checklist 第 N 项"</p>
            {!correctValid && <span className="text-[10px] text-[#F6465D] font-mono">必填</span>}
          </div>
        </div>

        {/* (F) Frequency warning */}
        {hotWarnings.length > 0 && (
          <div className="bg-[#F6465D]/8 border border-[#F6465D]/25 rounded-xl px-4 py-3 space-y-1 shadow-[0_10px_30px_rgba(246,70,93,0.08)]">
            {hotWarnings.map(w => (
              <div key={w.pattern.id} className="text-[12px] text-[#F6465D]">
                ⚠ 模式「{w.pattern.pattern_name}」最近 30 天内已出现 {w.count} 次（含本次 = {w.count + 1} 次）。
                满 3 次后，系统会在批次 6 强制要求你写一条新规则加入 checklist。
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-border flex justify-between items-center gap-2 shrink-0 bg-gradient-to-t from-muted/20 to-background">
        {unreviewedBlock ? (
          <span className="text-[10px] text-[#F6465D] font-medium">
            🔒 评价完成前无法关闭 — 防止"静默关闭"丢失错题样本
          </span>
        ) : (
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-9 rounded-lg px-4 text-[12px] hover:bg-accent/60">取消</Button>
        )}
        <Button
          onClick={handleSave}
          disabled={!canSave}
          className="h-9 rounded-lg px-4 text-[12px] bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black shadow-[0_10px_24px_rgba(240,185,11,0.18)] disabled:opacity-40 disabled:shadow-none"
        >{saving ? '保存中...' : '保存评价'}</Button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={guardedOpenChange}>
        <SheetContent
          side="bottom"
          className="h-[92vh] rounded-t-2xl p-0 bg-background border-t border-border flex flex-col"
          onPointerDownOutside={unreviewedBlock ? e => e.preventDefault() : undefined}
          onEscapeKeyDown={unreviewedBlock ? e => e.preventDefault() : undefined}
          onInteractOutside={unreviewedBlock ? e => e.preventDefault() : undefined}
        >
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={isOpen} onOpenChange={guardedOpenChange}>
      <SheetContent
        side="right"
        className="w-[640px] sm:max-w-[640px] p-0 bg-background border-l border-border shadow-2xl flex flex-col"
        onPointerDownOutside={unreviewedBlock ? e => e.preventDefault() : undefined}
        onEscapeKeyDown={unreviewedBlock ? e => e.preventDefault() : undefined}
        onInteractOutside={unreviewedBlock ? e => e.preventDefault() : undefined}
      >
        {body}
      </SheetContent>
    </Sheet>
  );
}
