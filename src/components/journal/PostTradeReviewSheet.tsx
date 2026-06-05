/**
 * 平仓评价弹窗 — 桌面 centered Dialog / 移动 bottom Sheet
 * 注意：本弹窗一旦被打开（journal.post_reviewed_at == null）就不允许 dismiss。
 *      用户必须填完字段并保存才能离开。这是为了堵住"静默关闭"漏洞。
 */
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';
import { Pencil, ChevronDown, BrainCircuit, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { COGNITIVE_BIAS_LABELS } from '@/lib/cognitiveBiasTags';
import {
  EDGE_SOURCE_OPTIONS, EDGE_SOURCE_LABELS,
  aggregateEdgeSourceUsage, HAMMER_DOMINANCE_THRESHOLD, HAMMER_MIN_SAMPLES,
} from '@/lib/edgeSource';
import { regimeEdgeMismatchHint } from '@/lib/snapshotStructure';
import { buildReflectionText, parseReflectionText } from '@/lib/reflectionFacts';
import {
  classifyStructureResult,
  STRUCTURE_RESULT_QUADRANTS,
  STRUGGLE_LEVEL_LABELS,
  STRUGGLE_LEVEL_HINTS,
  SMALL_POSITION_DRAG_OPTIONS,
  MISSED_HIGH_ODDS_OPTIONS,
  type StruggleLevel,
  type StructureResultQuadrant,
} from '@/lib/structureResult';
import { parseHedgeBoundaryBasis } from '@/lib/hedgeBoundaryBasis';
import { HEDGE_BOUNDARY_STANCE_LABELS, HEDGE_ORDER_METHOD_LABELS, HEDGE_TYPE_LABELS } from '@/lib/hedgeTypes';
import {
  buildOddsStructureReviewText,
  ODDS_STRUCTURE_LABELS,
  parseOddsStructureReviewText,
  type OddsStructureReview,
} from '@/lib/oddsStructure';
import { deriveLoopReadout, type LegTone } from '@/lib/structureLoop';
import {
  finalizeJournalReview,
  updateJournalDeepAnalysis, stampJournalCloseRealTime, listJournals,
} from '@/lib/journalApi';
import type { TradeJournal, TradeOutcome } from '@/types/journal';
import { MENTAL_STATE_LABELS, PAIN_TAG_LABELS } from '@/types/journal';
import type { PainTag } from '@/types/journal';
import { formatBeijingTime } from '@/lib/timeFormat';
import type { TradeRecord } from '@/types/trading';
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

function EdgeSourceTooltipContent({ option }: { option: (typeof EDGE_SOURCE_OPTIONS)[number] }) {
  return (
    <div className="max-w-[340px] space-y-1.5 text-[11px] leading-relaxed">
      <div className="font-medium text-foreground">{option.label}</div>
      <div><span className="text-[#F0B90B]">入场第一性原理：</span>{option.entryPrinciple}</div>
      <div><span className="text-[#0ECB81]">好位置：</span>{option.goodLocation}</div>
      <div><span className="text-[#F6465D]">坏位置：</span>{option.badLocation}</div>
      <div><span className="text-[#F0B90B]">入场要等：</span>{option.waitForEntry}</div>
      <div><span className="text-[#F6465D]">不能等到：</span>{option.avoidWaitingUntil}</div>
    </div>
  );
}

/** 闭环判读：腿色调 → 品牌色（库只给语义色调，视图在这里落到具体色值）。 */
const LOOP_TONE_COLOR: Record<LegTone, string> = {
  good: '#0ECB81',
  warn: '#D89B00',
  bad: '#F6465D',
  muted: '#9AA0A6',
};

export function PostTradeReviewSheet({
  isOpen, onOpenChange, journal, tradeRecord, onReviewed, onAutoPause,
}: Props) {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { setTradeHistory } = useTradingContext();
  const [reflection, setReflection] = useState('');
  const [reflectionFacts, setReflectionFacts] = useState('');
  const [correctAction, setCorrectAction] = useState('');
  const [exitReason, setExitReason] = useState('');
  const [resultSummary, setResultSummary] = useState('');
  const [decisionQuality, setDecisionQuality] = useState<TradeJournal['post_decision_quality']>('mixed');
  const [expectancyReview, setExpectancyReview] = useState('');
  const [oddsStructureReviewValue, setOddsStructureReviewValue] = useState<OddsStructureReview | null>(null);
  const [premortemReview, setPremortemReview] = useState('');
  const [invalidationReview, setInvalidationReview] = useState('');
  const [falsificationStatus, setFalsificationStatus] = useState<TradeJournal['exit_falsification_status']>(null);
  const [falsificationNote, setFalsificationNote] = useState('');
  const [struggleLevel, setStruggleLevel] = useState<StruggleLevel | null>(null);
  const [smallPositionDrag, setSmallPositionDrag] = useState<TradeJournal['post_small_position_drag']>(null);
  const [missedHighOddsState, setMissedHighOddsState] = useState<TradeJournal['post_missed_high_odds_state']>(null);
  const [edgeSourceBackfill, setEdgeSourceBackfill] = useState<TradeJournal['pre_edge_source']>(null);
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
  /** 用户全部主力单（用于「工具箱集中度 / 铁锤人」体检，仅展示）。 */
  const [allUserJournals, setAllUserJournals] = useState<TradeJournal[]>([]);
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
        const parsedReflection = parseReflectionText(journal.post_reflection);
        setReflectionFacts(parsedReflection.facts);
        setReflection(parsedReflection.interpretation);
        setCorrectAction(journal.post_correct_action ?? '');
        setExitReason(tradeRecord?.exit_reason_text ?? '');
        setResultSummary(journal.post_result_summary ?? '');
        setDecisionQuality(journal.post_decision_quality ?? 'mixed');
        const parsedOddsStructureReview = parseOddsStructureReviewText(journal.post_positive_expectancy_review);
        setOddsStructureReviewValue(parsedOddsStructureReview.review);
        setExpectancyReview(parsedOddsStructureReview.body);
        setPremortemReview(journal.post_premortem_review ?? '');
        setInvalidationReview(journal.post_invalidation_review ?? '');
        setFalsificationStatus(journal.exit_falsification_status ?? null);
        setFalsificationNote(journal.exit_falsification_note ?? '');
        setStruggleLevel((journal.post_struggle_level as StruggleLevel | null) ?? null);
        setSmallPositionDrag(journal.post_small_position_drag ?? null);
        setMissedHighOddsState(journal.post_missed_high_odds_state ?? null);
        setEdgeSourceBackfill(journal.pre_edge_source ?? null);
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
          // 拉取全部主力单做「工具箱集中度」体检（铁锤人自检），失败不阻塞复盘。
          listJournals(user.id).then(setAllUserJournals).catch(() => {});
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
      isMobile ? (
        <Sheet open={isOpen} onOpenChange={onOpenChange}>
          <SheetContent
            side="bottom"
            className="h-[60vh] rounded-t-2xl p-0 bg-card border-t border-border text-foreground"
          >
            {placeholder}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
          <DialogContent className="w-[calc(100vw-32px)] max-w-[860px] h-[60vh] p-0 bg-card border border-border text-foreground overflow-hidden rounded-2xl shadow-2xl [&>button]:right-5 [&>button]:top-5">
            {placeholder}
          </DialogContent>
        </Dialog>
      )
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
  const snapshotOddsSource = journal.pre_odds_structure_source || '';
  const snapshotOddsPremortem = journal.pre_odds_structure_premortem || '';
  const snapshotOddsBreakdown = journal.pre_odds_structure_breakdown_signals || '';
  const hedgeBoundaryBasis = parseHedgeBoundaryBasis(journal.hedge_boundary_basis);
  const hasStructuredHedgeDownPlan = Boolean(
    journal.hedge_down_if_chop
    || journal.hedge_down_if_trend
    || journal.hedge_down_if_rebound,
  );
  const riskAnchorPct = journal.pre_max_loss_usdt != null && journal.pre_account_equity_usdt
    ? (journal.pre_max_loss_usdt / journal.pre_account_equity_usdt) * 100
    : null;

  // 结构 × 结果 四象限：结构轴 = 当时决策质量，结果轴 = 这单赢/亏。
  const quadrantApplicable = journal.direction !== 'no_entry' && (outcome === 'win' || outcome === 'loss');
  const quadrant = classifyStructureResult(decisionQuality, outcome);
  // edge 源头：开仓已标则只读回显；旧快照漏标则允许复盘补标，纳入「盈亏同源」。
  const showEdgeSource = !isHedge && journal.direction !== 'no_entry';
  const capturedEdge = journal.pre_edge_source ?? null;
  // 小机会仓位记账：机会成本不足、无明确 edge、目标不清或盈亏比不足时触发。
  const showSmallPositionDrag = !isHedge
    && journal.direction !== 'no_entry'
    && (
      journal.pre_opportunity_cost_worth === false
      || journal.pre_cheap_opportunity === 'not_cheap'
      || journal.pre_cheap_opportunity === 'unclear'
      || journal.pre_edge_source === 'no_clear_edge'
      || journal.pre_odds_structure === 'odds_insufficient'
      || journal.pre_odds_structure === 'target_unclear'
      || journal.pre_odds_structure === 'neutral_choppy'
    );
  // 厚结构没吃够：与「小机会仓位」对称。只在快照显示结构足够厚/便宜时追问。
  const showMissedHighOddsState = !isHedge
    && journal.direction !== 'no_entry'
    && (
      journal.pre_odds_structure === 'r2_supported'
      || journal.pre_odds_structure === 'r3_open'
      || journal.pre_odds_structure === 'against_crowd_unreleased'
      || (journal.pre_opportunity_cost_worth === true && journal.pre_cheap_opportunity === 'cheap')
    );
  // 结构对／错的 2×2 排布（上排结构对、下排结构错；左列赢、右列亏）。
  const QUADRANT_GRID: StructureResultQuadrant[] = ['deserved_win', 'correct_loss', 'dangerous_win', 'deserved_loss'];

  // 工具箱集中度体检（铁锤人自检，仅展示）：统计全部主力单各 edge 源头的使用频次。
  const edgeConcentration = aggregateEdgeSourceUsage(allUserJournals);
  const showConcentration = !isHedge
    && journal.direction !== 'no_entry'
    && edgeConcentration.total >= HAMMER_MIN_SAMPLES;
  // 结构 × 源头错配率：用既有的 regimeEdgeMismatchHint 逐单判定，看「同一个动作换个结构」发生得有多频繁。
  const regimeChecked = allUserJournals.filter(j =>
    j.order_kind !== 'hedge'
    && (j.journal_kind ?? 'trade') === 'trade'
    && j.direction !== 'no_entry'
    && j.pre_market_regime
    && j.pre_edge_source,
  );
  const regimeMismatchCount = regimeChecked.filter(j =>
    regimeEdgeMismatchHint(j.pre_market_regime, j.pre_edge_source) != null,
  ).length;

  const reflectionValid = !!reflection.trim();
  const correctValid = !!correctAction.trim();
  const exitReasonValid = journal.direction === 'no_entry' || !!exitReason.trim();
  const resultValid = !!resultSummary.trim();
  const quadrantValid = !quadrantApplicable || !!quadrant;
  const decisionValid = !quadrantApplicable || decisionQuality === 'good' || decisionQuality === 'bad';
  const falsificationFactValid = !snapshotFalsification || falsificationStatus != null;
  const oddsStructureFactValid = isHedge || !journal.pre_odds_structure || oddsStructureReviewValue != null;
  const reviewLoopValid = !!expectancyReview.trim()
    && !!premortemReview.trim()
    && !!invalidationReview.trim()
    && falsificationFactValid
    && oddsStructureFactValid;
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
  const canSave = reflectionValid
    && correctValid
    && exitReasonValid
    && resultValid
    && decisionValid
    && quadrantValid
    && reviewLoopValid
    && opponentValid
    && hedgeWorthItValid
    && fiveStepValid
    && !saving;

  const sectionCardClass = 'rounded-xl border border-border/70 bg-card/70 shadow-[0_10px_30px_rgba(0,0,0,0.04)]';
  const subtleLabelClass = 'text-[11px] font-medium text-muted-foreground';
  const metricCardClass = 'rounded-xl border border-border/70 bg-background/70 px-3 py-3';
  const factPillClass = 'inline-flex h-5 items-center rounded-full border border-border/60 bg-background/70 px-2 text-[10px] font-medium text-muted-foreground';
  const cheapOpportunityLabel = journal.pre_cheap_opportunity === 'cheap'
    ? '便宜机会'
    : journal.pre_cheap_opportunity === 'not_cheap'
      ? '不便宜'
      : journal.pre_cheap_opportunity === 'unclear'
        ? '说不清便宜'
        : null;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const updated = await finalizeJournalReview(journal.id, {
        post_outcome: outcome,
        post_realized_pnl: pnl,
        post_r_multiple: finalR,
        post_reflection: buildReflectionText(reflectionFacts, reflection),
        post_correct_action: correctAction.trim(),
        post_result_summary: resultSummary.trim(),
        post_decision_quality: decisionQuality,
        post_struggle_level: struggleLevel,
        post_small_position_drag: showSmallPositionDrag ? smallPositionDrag : null,
        post_missed_high_odds_state: showMissedHighOddsState ? missedHighOddsState : null,
        // 仅当开仓漏标 edge 且本次复盘补标时回写（不覆盖开仓已标的源头）。
        ...(capturedEdge == null && edgeSourceBackfill != null ? { pre_edge_source: edgeSourceBackfill } : {}),
        post_positive_expectancy_review: buildOddsStructureReviewText(expectancyReview, oddsStructureReviewValue),
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
    // 场景 / 现实 是可观察事实 → 事实栏；根因是解释 → 解释栏。与「先事实后解释」分离对称。
    setReflectionFacts(`[场景] ${sixStep.post_error_scenario}\n[现实] ${sixStep.post_reality_feedback}`);
    setReflection(`[根因] ${sixStep.post_real_problem}`);
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
  const outcomeLabel = outcome === 'win'
    ? 'WIN'
    : outcome === 'loss'
      ? 'LOSS'
      : outcome === 'breakeven'
        ? 'FLAT'
        : 'NO TRADE';
  const outcomeClass = outcome === 'win'
    ? 'border-[#0ECB81]/30 bg-[#0ECB81]/10 text-[#0ECB81]'
    : outcome === 'loss'
      ? 'border-[#F6465D]/30 bg-[#F6465D]/10 text-[#F6465D]'
      : 'border-border bg-muted text-muted-foreground';
  const pnlClass = pnl > 0 ? 'text-[#0ECB81]' : pnl < 0 ? 'text-[#F6465D]' : 'text-muted-foreground';
  const pnlLabel = `${pnl > 0 ? '+' : ''}${pnl.toFixed(2)} USDT`;
  const rLabel = finalR != null ? `${finalR > 0 ? '+' : ''}${finalR.toFixed(2)}R` : '—R';

  // ===== 结构闭环判读（看见 + 迭代）=====
  // 你押的是一个闭环（正 / 反 / 止），不是一个 EV。把上面已核验的事实收口成一句裁决，
  // 并在死法走「后门」（不在预案内）时给出迭代指令。仅主力方向单、有赢/亏结果时判读。
  const loopReadoutApplicable = !isHedge && quadrantApplicable;
  const hasFalsificationPlan = !!snapshotFalsification;
  const loopReadout = deriveLoopReadout({
    outcome,
    quadrant,
    oddsReview: oddsStructureReviewValue,
    premortemReviewFilled: !!premortemReview.trim(),
    falsificationStatus,
    hasFalsificationPlan,
  });
  const loopVerdictMeta = (() => {
    switch (loopReadout.verdict) {
      case 'intact':
        return {
          accent: '#0ECB81',
          title: outcome === 'win' ? '闭环完整 · 它怎么赢你清楚' : '闭环完整 · 真死时是按预案死的',
          body:
            outcome === 'win'
              ? '正向预期兑现、事实可核验 —— 这是结构成熟度里的一个正向样本。'
              : '它怎么赢你知道，它怎么死你也提前知道；这次亏损从「前门」走，闭环干净，纳入结构成熟。',
        };
      case 'lagged':
        return {
          accent: '#D89B00',
          title: '闭环有迟滞 · 死法在预案内，但你反应晚了',
          body: '信号触发了、你也看见了，却动手晚了 —— 这是执行差，不是结构差。把这个动作前置成机械触发（触发即离场），别留裁量空间。',
        };
      case 'gap':
        return {
          accent: '#F6465D',
          title: '闭环有缺口 · 这次的死法不在你的预案里',
          body: '你是主观平的，预设止损信号没被触发 —— 这是「后门死法」：结构里没建模的失败模式，最危险的尾部。胜率再准，后门死法过半也会把结构压回「成形中」、不给毕业。',
        };
      default:
        return {
          accent: '#9AA0A6',
          title: hasFalsificationPlan ? '先核验「止」才能判读闭环' : '本笔没有预设止损信号',
          body: hasFalsificationPlan
            ? '上面的「止」还没选 —— 先回答证伪信号被触发没有，才能判这次死法走的是前门还是后门。'
            : '开仓时没写下「什么信号出现就该离场」，所以无法判读死法门。下次开仓务必补「止」，否则每一次亏损都是后门死法。',
        };
    }
  })();

  const body = (
    <>
      <div className="shrink-0 border-b border-border bg-gradient-to-b from-muted/30 to-background/95 px-6 py-4 pr-14">
        <div className="mx-auto flex w-full max-w-[780px] items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-[0.01em] text-foreground">平仓评价</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground">
              <span>{journal.symbol}</span>
              <span>·</span>
              <span>{journal.direction}</span>
              <span>·</span>
              <span>模拟时间 {fmtTime(journal.pre_simulated_time)}</span>
            </div>
          </div>
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${outcomeClass}`}>{outcomeLabel}</span>
            <span className={`font-mono text-[12px] ${pnlClass}`}>{rLabel}</span>
            <span className={`font-mono text-[12px] ${pnlClass}`}>{pnlLabel}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-muted/20 px-5 py-5">
        <div className="mx-auto w-full max-w-[780px] space-y-4">
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
                    <span className="text-muted-foreground">向下预案：</span>{journal.hedge_resolution_down || '—'}
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
                <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                  <span className="text-muted-foreground">盈亏比目标：</span>
                  {journal.pre_odds_structure ? ODDS_STRUCTURE_LABELS[journal.pre_odds_structure] : '—'}
                </div>
                {cheapOpportunityLabel && (
                  <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                    <span className="text-muted-foreground">机会成本：</span>{cheapOpportunityLabel}
                    {journal.pre_opportunity_cost_worth != null ? (
                      <span className="text-muted-foreground">
                        {' '}· {journal.pre_opportunity_cost_worth ? '不做更亏' : '不做也不亏'}
                      </span>
                    ) : null}
                  </div>
                )}
                {journal.pre_planned_stop_loss != null && (
                  <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                    <span className="text-muted-foreground">R 回撤价 / 目标失效价：</span>{journal.pre_planned_stop_loss.toFixed(2)}
                  </div>
                )}
                {journal.pre_odds_structure && (
                  <>
                    <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                      <span className="text-muted-foreground">收益空间来自：</span>{snapshotOddsSource || '—'}
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                      <span className="text-muted-foreground">目标判断错因：</span>{snapshotOddsPremortem || '—'}
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                      <span className="text-muted-foreground">目标失效信号：</span>{snapshotOddsBreakdown || '—'}
                    </div>
                  </>
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

        <div className={`space-y-3 px-4 py-4 ${sectionCardClass}`}>
          <div>
            <div className="text-[12px] font-semibold text-foreground">事实模块 · 逐条核验闭环的腿（反 / 止 / 结构 / 置信）</div>
            <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
              你押的是一个闭环。先逐条回答快照里的假设有没有被市场碰到 —— 这里只核验差值、不写事后故事；收口的闭环判读放到下面。
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className={factPillClass}>反</span>
              <div className="text-[12px] font-medium text-foreground">预设的亏损原因兑现没有？*</div>
            </div>
            {snapshotPremortem && (
              <div className="rounded-lg border border-border/60 bg-card px-3 py-2 text-[11px] leading-relaxed">
                <span className="text-muted-foreground">开仓前写下的反：</span>{snapshotPremortem}
              </div>
            )}
            <Textarea
              rows={2}
              value={premortemReview}
              onChange={e => setPremortemReview(e.target.value)}
              placeholder="只写这个 pre-mortem 是否被碰到：命中 / 部分命中 / 没命中。先别解释为什么。"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl"
            />
          </div>

          <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className={factPillClass}>止</span>
              <div className="text-[12px] font-medium text-foreground">预设的证伪信号兑现没有？*</div>
            </div>
            {snapshotFalsification ? (
              <>
                <div className="rounded-lg border border-border/60 bg-card px-3 py-2 text-[11px] leading-relaxed">
                  <span className="text-muted-foreground">开仓前写下的止：</span>{snapshotFalsification}
                </div>
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
                  placeholder="证伪状态备注（可选）：例如触发时间、迟疑点、是否按计划拆仓。"
                  className="text-[12px] bg-background/80 border-border/70 rounded-xl"
                />
                {!falsificationFactValid && <div className="text-right font-mono text-[10px] text-[#F6465D]">必选</div>}
              </>
            ) : (
              <div className="rounded-lg border border-border/60 bg-card px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                本笔未记录预设证伪信号；在下方写清离场事实即可。
              </div>
            )}
            <Textarea
              rows={2}
              value={invalidationReview}
              onChange={e => setInvalidationReview(e.target.value)}
              placeholder="只写证伪/拆仓信号有没有出现、你有没有按它执行。叙事解释放到下方模块。"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl"
            />
          </div>

          {!isHedge && (
            <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className={factPillClass}>结构</span>
                <div className="text-[12px] font-medium text-foreground">你命名的结构破坏信号出现没有？*</div>
              </div>
              {journal.pre_odds_structure ? (
                <div className="rounded-lg border border-border/60 bg-card px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
                  当时目标：<span className="text-foreground">{ODDS_STRUCTURE_LABELS[journal.pre_odds_structure]}</span>
                  {snapshotOddsBreakdown ? <span> · 破坏信号：{snapshotOddsBreakdown}</span> : null}
                </div>
              ) : (
                <div className="rounded-lg border border-border/60 bg-card px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                  本笔未记录盈亏比结构；直接按实际盘面补充判断。
                </div>
              )}
              {journal.pre_odds_structure && (
                <div className="grid gap-2">
                  {[
                    { value: 'right', label: '未出现', desc: '目标结构基本保持，破坏信号没有兑现' },
                    { value: 'mixed', label: '部分出现', desc: '有破坏迹象，但不完整或我处理不清' },
                    { value: 'wrong', label: '出现了', desc: '结构破坏信号兑现，目标假设失效' },
                  ].map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setOddsStructureReviewValue(option.value as OddsStructureReview)}
                      className={`rounded-lg border px-3 py-2 text-left text-[11px] transition-colors ${
                        oddsStructureReviewValue === option.value
                          ? 'border-foreground bg-foreground/5 text-foreground'
                          : 'border-border bg-background text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      <div className="font-medium">{option.label}</div>
                      <div className="mt-0.5 text-[10px] leading-relaxed">{option.desc}</div>
                    </button>
                  ))}
                </div>
              )}
              {!oddsStructureFactValid && <div className="text-right font-mono text-[10px] text-[#F6465D]">必选</div>}
              <Textarea
                rows={2}
                value={expectancyReview}
                onChange={e => setExpectancyReview(e.target.value)}
                placeholder="只写目标空间/结构破坏是否被市场验证；不要用最后盈亏倒推。"
                className="text-[12px] bg-background/80 border-border/70 rounded-xl"
              />
            </div>
          )}

          {isHedge && (
            <div className="space-y-1.5">
              <Label className="text-[12px] font-medium">正期望/保险价值事实备注 *</Label>
              <Textarea
                rows={2}
                value={expectancyReview}
                onChange={e => setExpectancyReview(e.target.value)}
                placeholder="只写这份对冲保险有没有值回摩擦成本，先不写解释。"
                className="text-[12px] bg-background/80 border-border/70 rounded-xl"
              />
            </div>
          )}

          {calibrationPct != null && (
            <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={factPillClass}>置信</span>
                  <div className="text-[12px] font-medium text-foreground">进场钉的置信度被验证没有？</div>
                </div>
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
                <div className={metricCardClass}>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">平仓后结果</div>
                  <div className={outcome === 'win' ? 'text-[#0ECB81]' : outcome === 'loss' ? 'text-[#F6465D]' : 'text-muted-foreground'}>
                    {calibrationOutcomeLabel}
                  </div>
                </div>
              </div>
              {journal.pre_confidence_basis && (
                <div className="rounded-lg border border-border/60 bg-card px-3 py-2 text-[11px] leading-relaxed">
                  <span className="text-muted-foreground">当时给这个置信度的依据：</span>{journal.pre_confidence_basis}
                </div>
              )}
            </div>
          )}
        </div>

        {loopReadoutApplicable && (
          <div className={`space-y-3 px-4 py-4 ${sectionCardClass}`}>
            <div>
              <div className="text-[12px] font-semibold text-foreground">结构闭环判读 · 看见与迭代</div>
              <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                你押的是一个闭环（正 · 反 · 止），不是一个期望值。把上面核验过的事实收口成一句话 ——
                它怎么赢你要清楚，它怎么死你也要提前知道；真死的时候，是按预案死的吗？
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1.5 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={factPillClass}>正</span>
                  <span className="text-[10px] font-medium" style={{ color: LOOP_TONE_COLOR[loopReadout.zheng.tone] }}>
                    {loopReadout.zheng.status}
                  </span>
                </div>
                <div className="line-clamp-3 text-[10px] leading-relaxed text-muted-foreground">{snapshotWhyRight || '—'}</div>
                {calibrationScore != null && (
                  <div className="font-mono text-[10px] text-muted-foreground">
                    Brier {calibrationScore.toFixed(2)} · 预测 {calibrationPct?.toFixed(0)}%
                  </div>
                )}
              </div>

              <div className="space-y-1.5 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={factPillClass}>反</span>
                  <span className="text-[10px] font-medium" style={{ color: LOOP_TONE_COLOR[loopReadout.fan.tone] }}>
                    {loopReadout.fan.status}
                  </span>
                </div>
                <div className="line-clamp-3 text-[10px] leading-relaxed text-muted-foreground">{snapshotPremortem || '—'}</div>
              </div>

              <div className="space-y-1.5 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={factPillClass}>止</span>
                  <span className="text-[10px] font-medium" style={{ color: LOOP_TONE_COLOR[loopReadout.zhi.tone] }}>
                    {loopReadout.zhi.status}
                  </span>
                </div>
                <div className="line-clamp-3 text-[10px] leading-relaxed text-muted-foreground">{snapshotFalsification || '—'}</div>
              </div>
            </div>

            <div
              className="flex gap-2 rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed"
              style={{
                borderColor: `${loopVerdictMeta.accent}59`,
                backgroundColor: `${loopVerdictMeta.accent}12`,
                color: loopVerdictMeta.accent,
              }}
            >
              {(loopReadout.verdict === 'gap' || loopReadout.verdict === 'lagged') && (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              <div className="space-y-0.5">
                <div className="font-semibold">{loopVerdictMeta.title}</div>
                <div className="text-muted-foreground">{loopVerdictMeta.body}</div>
              </div>
            </div>

            {loopReadout.verdict === 'gap' && (
              <div className="space-y-1.5 rounded-xl border border-[#F6465D]/35 bg-[#F6465D]/[0.05] px-3 py-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#F6465D]">
                  <AlertTriangle className="h-3.5 w-3.5" /> 结构迭代 · 把这次的死法补进「止」预案
                </div>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  现在它从后门走。把刚才那个让你措手不及的信号，写成一条
                  <span className="text-foreground">开仓前就能识别、触发即离场</span>
                  的前置止损信号 —— 下次同样的死法就从前门走。落到下方「设计干预」并把干预类型设为「规则」，或在六步里写成新规则草稿、去复现页激活。
                </p>
              </div>
            )}
          </div>
        )}

        <div className={`space-y-3 px-4 py-4 ${sectionCardClass}`}>
          <div className="text-[12px] font-medium">结果复盘</div>
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

          {quadrantApplicable && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] font-medium">结构 × 结果</Label>
                <span className="text-[10px] text-muted-foreground">机会是运气，优秀是结构</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {QUADRANT_GRID.map(cell => {
                  const meta = STRUCTURE_RESULT_QUADRANTS[cell];
                  const active = quadrant === cell;
                  const selectable = meta.isWin === (outcome === 'win');
                  return (
                    <button
                      key={cell}
                      type="button"
                      disabled={!selectable}
                      onClick={() => {
                        if (!selectable) return;
                        setDecisionQuality(meta.structureSound ? 'good' : 'bad');
                      }}
                      className={`rounded-lg border px-2.5 py-2 leading-tight transition-colors ${
                        active
                          ? ''
                          : selectable
                            ? 'border-border/60 bg-background/40 hover:bg-accent/60'
                            : 'border-border/40 bg-background/20 opacity-35 cursor-not-allowed'
                      }`}
                      style={active ? { borderColor: meta.accent, backgroundColor: `${meta.accent}1A` } : undefined}
                    >
                      <div
                        className={`text-[11px] font-semibold ${active ? '' : 'text-muted-foreground'}`}
                        style={active ? { color: meta.accent } : undefined}
                      >
                        {meta.label}
                      </div>
                      <div className="text-[9px] text-muted-foreground">
                        {meta.structureSound ? '结构对' : '结构错'} · {meta.isWin ? '赢' : '亏'}
                      </div>
                    </button>
                  );
                })}
              </div>
              {quadrant ? (
                <div
                  className="flex gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed"
                  style={{
                    borderColor: `${STRUCTURE_RESULT_QUADRANTS[quadrant].accent}66`,
                    backgroundColor: `${STRUCTURE_RESULT_QUADRANTS[quadrant].accent}14`,
                    color: STRUCTURE_RESULT_QUADRANTS[quadrant].accent,
                  }}
                >
                  {STRUCTURE_RESULT_QUADRANTS[quadrant].isDanger && (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  <span>
                    <span className="font-semibold">{STRUCTURE_RESULT_QUADRANTS[quadrant].label}</span>
                    ：{STRUCTURE_RESULT_QUADRANTS[quadrant].insight}
                  </span>
                </div>
              ) : (
                <p className="rounded border border-border/60 bg-background/40 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                  请选择本笔落在哪一格。
                </p>
              )}
            </div>
          )}
        </div>

        {showEdgeSource && (
          <div className={`space-y-2 px-4 py-4 ${sectionCardClass}`}>
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-medium">源头校准 · 盈亏同源</div>
              {capturedEdge && (
                <span className="text-[10px] text-muted-foreground">开仓已标</span>
              )}
            </div>
            {capturedEdge ? (
              <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-[11px] leading-relaxed">
                <span className="text-muted-foreground">这一单的 edge 源头：</span>
                <span className="font-medium text-foreground">{EDGE_SOURCE_LABELS[capturedEdge]}</span>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  盈亏会归到这个源头下。当同一个源头既是你最大的盈利、又是最大的亏损来源时，就是「盈亏同源」—— 别砍掉对的做法。
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  这单开仓时没标 edge 源头（旧快照）。补一个，才能纳入「盈亏同源」统计：
                </p>
                <TooltipProvider delayDuration={120}>
                  <div className="grid grid-cols-2 gap-1.5">
                    {EDGE_SOURCE_OPTIONS.map(opt => {
                      const active = edgeSourceBackfill === opt.id;
                      const warn = opt.isWarning;
                      return (
                        <Tooltip key={opt.id}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => setEdgeSourceBackfill(active ? null : opt.id)}
                              className={`rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                                active
                                  ? warn
                                    ? 'border-[#F6465D] bg-[#F6465D]/10 text-[#F6465D]'
                                    : 'border-[#F0B90B] bg-[#F0B90B]/10 text-foreground'
                                  : 'border-border bg-background text-muted-foreground hover:bg-accent'
                              }`}
                            >
                              {opt.label}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" align="start" className="border-border bg-card text-card-foreground shadow-lg">
                            <EdgeSourceTooltipContent option={opt} />
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </TooltipProvider>
                <p className="text-[10px] text-muted-foreground">软性项，可跳过 —— 但补全后历史「盈亏同源」会更准。</p>
              </div>
            )}
          </div>
        )}

        {/* 工具箱集中度体检（铁锤人自检）— 仅展示，不阻塞 */}
        {showConcentration && (
          <div className={`space-y-2.5 px-4 py-4 ${sectionCardClass}`}>
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-medium">工具箱集中度体检 · 铁锤人自检</div>
              <span className="text-[10px] text-muted-foreground">{edgeConcentration.total} 笔主力单</span>
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              统计你实际在用哪几招（与盈亏无关）。手里只有一把锤子，看什么都像钉子——越顺手的一招越危险。
            </p>
            <div className="space-y-1.5">
              {edgeConcentration.usage.map(u => {
                const isDom = edgeConcentration.dominant?.edge === u.edge;
                const pct = Math.round(u.share * 100);
                return (
                  <div key={u.edge} className="flex items-center gap-2">
                    <span className="w-[68px] shrink-0 text-[10px] text-foreground">{u.label}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-background/70">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(4, pct)}%`,
                          background: isDom && edgeConcentration.isConcentrated ? '#F0B90B' : 'hsl(var(--muted-foreground) / 0.55)',
                        }}
                      />
                    </div>
                    <span className="w-[58px] shrink-0 text-right font-mono text-[10px] text-muted-foreground">{u.count}·{pct}%</span>
                  </div>
                );
              })}
            </div>
            {edgeConcentration.isConcentrated ? (
              <div className="rounded-lg border border-[#F0B90B]/30 bg-[#F0B90B]/5 px-3 py-2 text-[11px] leading-relaxed text-[#D89B00]">
                ⚠ 你 {Math.round(edgeConcentration.dominant!.share * 100)}% 的主力单都用「{edgeConcentration.dominant!.label}」这一招。
                问自己：是这一招真的最适合你遇到的市场，还是你只会这一招、所以什么行情都套它？
              </div>
            ) : (
              <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                源头分布较分散，暂无明显「铁锤人」集中——继续保持工具箱里有多把锤子。
              </div>
            )}
            {regimeChecked.length >= HAMMER_MIN_SAMPLES && regimeMismatchCount > 0 && (
              <div className="text-[10px] leading-relaxed text-muted-foreground">
                结构 × 源头错配：{regimeMismatchCount}/{regimeChecked.length} 笔（{Math.round((regimeMismatchCount / regimeChecked.length) * 100)}%）的源头与当时市场结构不自洽——同一个动作换个结构就改变性质。
              </div>
            )}
          </div>
        )}

        {!isHedge && journal.direction !== 'no_entry' && (
          <div className={`space-y-2 px-4 py-4 ${sectionCardClass}`}>
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-medium">过程纠结度 · 先行指标</div>
              <span className="text-[10px] text-muted-foreground">最重要的不是赚钱，是轻松</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {([1, 2, 3, 4, 5] as StruggleLevel[]).map(lvl => {
                const active = struggleLevel === lvl;
                const accent = lvl <= 1 ? '#F6465D' : lvl === 2 ? '#D89B00' : lvl >= 4 ? '#0ECB81' : null;
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setStruggleLevel(active ? null : lvl)}
                    className={`flex h-auto flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 transition-colors ${
                      active
                        ? accent ? '' : 'border-foreground/40 bg-muted text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:bg-accent'
                    }`}
                    style={active && accent ? { borderColor: accent, backgroundColor: `${accent}1A`, color: accent } : undefined}
                  >
                    <span className="text-[13px] font-semibold leading-none">{lvl}</span>
                    <span className="text-[9px] leading-tight">{STRUGGLE_LEVEL_LABELS[lvl]}</span>
                  </button>
                );
              })}
            </div>
            {struggleLevel ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground">{STRUGGLE_LEVEL_HINTS[struggleLevel]}</p>
            ) : (
              <p className="text-[10px] text-muted-foreground">高纠结即使结果对，过程也已经亮黄灯 —— 它是亏损的先行指标。</p>
            )}
          </div>
        )}

        {showSmallPositionDrag && (
          <div className="space-y-2 px-4 py-4 rounded-xl border border-[#F0B90B]/40 bg-[#F0B90B]/[0.04] shadow-[0_10px_30px_rgba(0,0,0,0.04)]">
            <div className="text-[12px] font-medium text-[#D89B00]">小机会仓位记账</div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {journal.pre_opportunity_cost_worth === false
                ? '开仓时你判定「不做也不亏」—— 这是典型的小机会仓位（多半在填补无聊）。它的隐性成本要被记下来：'
                : journal.pre_cheap_opportunity === 'not_cheap'
                  ? '开仓时你判定「不是便宜机会」—— 方向可能对，但成本太厚。它的隐性成本要被记下来：'
                  : journal.pre_cheap_opportunity === 'unclear'
                    ? '开仓时你判定「说不清便宜不便宜」—— 成本优势不清。它的隐性成本要被记下来：'
                    : journal.pre_edge_source === 'no_clear_edge'
                      ? '开仓时你选择「无明确 edge」—— 看不出来源，只是想交易。它的隐性成本要被记下来：'
                      : '开仓时你判定「目标不清楚 / 盈亏比不足」—— 方向可能对，但目标空间不够厚。它的隐性成本要被记下来：'}
            </p>
            <div className="grid gap-1.5">
              {SMALL_POSITION_DRAG_OPTIONS.map(opt => {
                const active = smallPositionDrag === opt.id;
                const accent = opt.severity === 0 ? '#0ECB81' : opt.severity === 1 ? '#F0B90B' : opt.severity === 2 ? '#D89B00' : '#F6465D';
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSmallPositionDrag(active ? null : opt.id)}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                      active ? '' : 'border-border bg-background hover:bg-accent'
                    }`}
                    style={active ? { borderColor: accent, backgroundColor: `${accent}14` } : undefined}
                  >
                    <div
                      className={`text-[11px] font-medium ${active ? '' : 'text-foreground'}`}
                      style={active ? { color: accent } : undefined}
                    >
                      {opt.label}
                    </div>
                    <div className="text-[10px] leading-tight text-muted-foreground">{opt.description}</div>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              持有小机会仓位是一等负向状态：它比空仓更糟 —— 在悄悄损耗你的行动力与对大机会的敏感度。
            </p>
          </div>
        )}

        {showMissedHighOddsState && (
          <div className="space-y-2 px-4 py-4 rounded-xl border border-[#F6465D]/30 bg-[#F6465D]/[0.035] shadow-[0_10px_30px_rgba(0,0,0,0.04)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[12px] font-medium text-[#F6465D]">踏空高盈亏比结构 / 该重没重</div>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  这是「小机会仓位」的对称负态：厚结构出现时没上、上轻了，或错过后补票，都会损耗系统的复利能力。
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-[#F6465D]/25 px-2 py-0.5 text-[10px] text-[#F6465D]">
                厚结构记账
              </span>
            </div>
            <div className="grid gap-1.5">
              {MISSED_HIGH_ODDS_OPTIONS.map(opt => {
                const active = missedHighOddsState === opt.id;
                const accent = opt.severity === 0 ? '#0ECB81' : opt.severity === 1 ? '#F0B90B' : opt.severity === 2 ? '#D89B00' : '#F6465D';
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setMissedHighOddsState(active ? null : opt.id)}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                      active ? '' : 'border-border bg-background hover:bg-accent'
                    }`}
                    style={active ? { borderColor: accent, backgroundColor: `${accent}14` } : undefined}
                  >
                    <div
                      className={`text-[11px] font-medium ${active ? '' : 'text-foreground'}`}
                      style={active ? { color: accent } : undefined}
                    >
                      {opt.label}
                    </div>
                    <div className="text-[10px] leading-tight text-muted-foreground">{opt.description}</div>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              小机会仓位惩罚的是「不该占用却占用了」；这一项惩罚的是「该暴露却没有充分暴露」。两边都在保护行动力。
            </p>
          </div>
        )}

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
            <div className="text-[12px] font-medium">L5 规律上卷 · 五条命脉</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              不重看一千根 K 线，只把这笔压缩成：反差、止差、结构差、置信差、执行差。
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">目标 *</Label>
            <Textarea rows={2} value={fiveStepGoal} onChange={e => setFiveStepGoal(e.target.value)}
              placeholder="这条误差路径要把哪个元指标改善到什么程度？例如证伪延迟率、结构破坏误判率。"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">问题 *</Label>
            <Textarea rows={2} value={fiveStepProblem} onChange={e => setFiveStepProblem(e.target.value)}
              placeholder="精准命名是哪条命脉出错：反、止、结构、置信，还是执行。"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl" />
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-[12px] font-medium">近因（我做了什么动作）*</Label>
              <Textarea rows={2} value={proximateCause} onChange={e => setProximateCause(e.target.value)}
                placeholder="例如：证伪触发后迟疑、结构破坏信号出现仍持仓、置信度过高。"
                className="text-[12px] bg-background/80 border-border/70 rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-medium">根因（我是什么性质导致）*</Label>
              <Textarea rows={2} value={rootCause} onChange={e => setRootCause(e.target.value)}
                placeholder="例如：对浮亏耐受力低、把震荡误读成趋势、对陌生结构过度自信。"
                className="text-[12px] bg-background/80 border-border/70 rounded-xl" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">设计干预 *</Label>
            <Textarea rows={2} value={designIntervention} onChange={e => setDesignIntervention(e.target.value)}
              placeholder="把这条误差路径转成原则、规则、SOP 或觉察项。"
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
              placeholder="干预如何上线？未来用哪个 L5 指标确认它是否有效？"
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

        {/* (C+) 六步深度分析（可选） */}
        <Collapsible open={sixStepOpen} onOpenChange={setSixStepOpen}>
          <CollapsibleTrigger className="w-full rounded-xl border border-border/70 bg-gradient-to-r from-card via-card to-accent/20 px-4 py-3 flex items-center gap-2 transition-colors hover:bg-accent/30 shadow-[0_10px_30px_rgba(0,0,0,0.04)]">
            <BrainCircuit className="w-3.5 h-3.5 text-[#F0B90B]" />
            <div className="flex-1 text-left">
              <div className="text-[12px] font-medium text-foreground">可选：补充单笔细节</div>
              <div className="text-[10px] text-muted-foreground">
                只在 L5 命脉仍说不清时展开；它服务于规律上卷，不替代事实核验。
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

        {/* (D) Reflection — 事实 vs 解释 分离（把快照的双通道好设计搬到复盘） */}
        <div className={`space-y-3 px-4 py-4 ${sectionCardClass}`}>
          <div className="rounded-lg border border-[#5b8def]/25 bg-[#5b8def]/5 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
            先写盘面发生了什么事实，再写解释——别把它们混成一个自洽的故事。
            事后回看时，人最容易把「发生了什么」和「为什么」压成一个完美闭环，再当成真相。
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-medium text-muted-foreground">① 盘面发生了什么（只写可观察的事实）</Label>
            <Textarea
              rows={3}
              value={reflectionFacts}
              onChange={e => setReflectionFacts(e.target.value)}
              placeholder="例如：入场后价格先朝预期方向走了 0.8%，随后跌破入场价 1.2% 触发止损；止损后 40 分钟内反向走出 +3%。只记录看得见的价格 / 成交 / 时间，不写原因。"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl"
            />
            <p className="text-[10px] text-muted-foreground">软性项，可留空——但写下事实能挡住事后归因。</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">② 这笔交易里你真正学到了什么（解释）*</Label>
            <Textarea
              rows={4}
              value={reflection}
              onChange={e => setReflection(e.target.value)}
              placeholder="例如：止损位放得过近（与结构无关，只是凭感觉），导致被噪音扫出后又看着行情走出预期方向。下次应根据结构失效位而非固定百分比设置止损。"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl"
            />
            {!reflectionValid && <div className="text-[10px] text-[#F6465D] text-right font-mono">必填</div>}
          </div>
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

      </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background/95 px-6 py-3.5">
        <div className="mx-auto flex w-full max-w-[780px] items-center justify-between gap-3">
          {unreviewedBlock ? (
            <span className="text-[11px] font-medium text-[#F6465D]">
              完成评价后即可继续下一笔
            </span>
          ) : (
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-9 rounded-lg px-4 text-[12px] hover:bg-accent/60">取消</Button>
          )}
          <Button
            onClick={handleSave}
            disabled={!canSave}
            className="h-9 rounded-lg px-5 text-[12px] bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black shadow-[0_10px_24px_rgba(240,185,11,0.18)] disabled:opacity-40 disabled:shadow-none"
          >{saving ? '保存中...' : '保存评价'}</Button>
        </div>
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
    <Dialog open={isOpen} onOpenChange={guardedOpenChange}>
      <DialogContent
        className="w-[calc(100vw-32px)] max-w-[860px] h-[92vh] overflow-hidden bg-background border border-border p-0 flex flex-col gap-0 rounded-2xl shadow-2xl [&>button]:right-5 [&>button]:top-5"
        onPointerDownOutside={unreviewedBlock ? e => e.preventDefault() : undefined}
        onEscapeKeyDown={unreviewedBlock ? e => e.preventDefault() : undefined}
        onInteractOutside={unreviewedBlock ? e => e.preventDefault() : undefined}
      >
        {body}
      </DialogContent>
    </Dialog>
  );
}
