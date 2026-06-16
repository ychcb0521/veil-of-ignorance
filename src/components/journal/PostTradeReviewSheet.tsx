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
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';
import { Pencil, ChevronDown, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { COGNITIVE_BIAS_LABELS } from '@/lib/cognitiveBiasTags';
import {
  aggregateEdgeSourceUsage, HAMMER_DOMINANCE_THRESHOLD, HAMMER_MIN_SAMPLES,
} from '@/lib/edgeSource';
import { regimeEdgeMismatchHint } from '@/lib/snapshotStructure';
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
  groupMainStonesByFamily, MAIN_STONE_META, normalizeMainStoneTags,
  type MainStoneTag,
} from '@/lib/mainStoneTags';
import { CLASS_META, classifyTradePathProxy } from '@/lib/tradePathFacet';
import {
  finalizeJournalReview,
  stampJournalCloseRealTime, listJournals,
} from '@/lib/journalApi';
import type { TradeJournal, TradeOutcome } from '@/types/journal';
import { MENTAL_STATE_LABELS, PAIN_TAG_LABELS } from '@/types/journal';
import type { PainTag } from '@/types/journal';
import { formatBeijingTime } from '@/lib/timeFormat';
import type { TradeRecord } from '@/types/trading';

const PATH_FIRST_MOVE_OPTIONS: Array<{
  value: NonNullable<TradeJournal['post_path_first_move']>;
  label: string;
  desc: string;
  accent: string;
}> = [
  { value: 'immediate_profit', label: '是，第一段就顺', desc: '开仓后很快站到浮盈，位置没有先付错成本。', accent: '#0ECB81' },
  { value: 'immediate_drawdown', label: '不是，上来先水下', desc: '第一段就浮亏，主动权没有立刻站到你这边。', accent: '#F6465D' },
  { value: 'unclear', label: '看不清', desc: '历史盘面不足，先不硬判。', accent: '#9AA0A6' },
];

const PATH_DRAWDOWN_OPTIONS: Array<{
  value: NonNullable<TradeJournal['post_path_drawdown']>;
  label: string;
  desc: string;
  accent: string;
}> = [
  { value: 'none_or_shallow', label: '没有或很浅', desc: '浮亏没有威胁结构，主动权基本在手。', accent: '#0ECB81' },
  { value: 'meaningful', label: '有明显浮亏', desc: '这笔需要扛一段，路径质量打折。', accent: '#D89B00' },
  { value: 'over_stop', label: '打到/越过止损', desc: '已经超过预案边界，主动权交出去了。', accent: '#F6465D' },
  { value: 'unclear', label: '看不清', desc: '缺少足够路径信息，先留空白样本。', accent: '#9AA0A6' },
];

const PATH_WIN_QUALITY_OPTIONS: Array<{
  value: Extract<NonNullable<TradeJournal['post_path_win_quality']>, 'clean_win' | 'dragged_win' | 'unclear'>;
  label: string;
  desc: string;
  accent: string;
}> = [
  { value: 'clean_win', label: '不是，干净赢', desc: '赢来自位置和结构，不靠硬扛换来。', accent: '#0ECB81' },
  { value: 'dragged_win', label: '是，扛出来的赢', desc: '终点赢了，但路径在训练坏习惯。', accent: '#F6465D' },
  { value: 'unclear', label: '看不清', desc: '无法确认是否扛单，后续可用复现页补判。', accent: '#9AA0A6' },
];

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  journal: TradeJournal | null;
  tradeRecord?: TradeRecord | null;
  onReviewed?: (updated: TradeJournal) => void;
  onAutoPause?: () => void;
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
  const [pathFirstMove, setPathFirstMove] = useState<TradeJournal['post_path_first_move']>(null);
  const [pathDrawdown, setPathDrawdown] = useState<TradeJournal['post_path_drawdown']>(null);
  const [pathWinQuality, setPathWinQuality] = useState<TradeJournal['post_path_win_quality']>(null);
  const [pathAgencyNote, setPathAgencyNote] = useState('');
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
  // ===== 平仓情绪侧复盘 · 七问 =====
  const [emoDisturbance, setEmoDisturbance] = useState('');
  const [emoFirstReaction, setEmoFirstReaction] = useState('');
  const [emoWanted, setEmoWanted] = useState('');
  const [emoFeared, setEmoFeared] = useState('');
  const [emoExcuse, setEmoExcuse] = useState('');
  const [emoMainStone, setEmoMainStone] = useState('');
  const [emoMainStoneTags, setEmoMainStoneTags] = useState<MainStoneTag[]>([]);
  const [emoNextTimePlan, setEmoNextTimePlan] = useState('');
  const [rMultipleOverride, setRMultipleOverride] = useState<string>('');
  const [editingR, setEditingR] = useState(false);
  const [saving, setSaving] = useState(false);
  /** 用户全部主力单（用于「工具箱集中度 / 铁锤人」体检，仅展示）。 */
  const [allUserJournals, setAllUserJournals] = useState<TradeJournal[]>([]);
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
        setPathFirstMove(journal.post_path_first_move ?? null);
        setPathDrawdown(journal.post_path_drawdown ?? null);
        setPathWinQuality(journal.post_path_win_quality ?? (journal.post_outcome && journal.post_outcome !== 'win' ? 'not_win' : null));
        setPathAgencyNote(journal.post_path_agency_note ?? '');
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
        setEmoDisturbance(journal.post_emo_disturbance ?? '');
        setEmoFirstReaction(journal.post_emo_first_reaction ?? '');
        setEmoWanted(journal.post_emo_wanted ?? '');
        setEmoFeared(journal.post_emo_feared ?? '');
        setEmoExcuse(journal.post_emo_excuse ?? '');
        setEmoMainStone(journal.post_emo_main_stone ?? '');
        setEmoMainStoneTags(normalizeMainStoneTags(journal.post_emo_main_stone_tags));
        setEmoNextTimePlan(journal.post_emo_next_time_plan ?? '');
        setRMultipleOverride(journal.post_r_multiple != null ? String(journal.post_r_multiple) : '');
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
  const showPathAgency = !isHedge && journal.direction !== 'no_entry';
  const pathProxy = showPathAgency && tradeRecord ? classifyTradePathProxy(journal, tradeRecord) : null;
  const pathWinQualityToSave = outcome === 'win' ? pathWinQuality : 'not_win';
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

  const resultValid = !!resultSummary.trim();
  const quadrantValid = !quadrantApplicable || !!quadrant;
  const decisionValid = !quadrantApplicable || decisionQuality === 'good' || decisionQuality === 'bad';
  const falsificationFactValid = !snapshotFalsification || falsificationStatus != null;
  const oddsStructureFactValid = isHedge || !journal.pre_odds_structure || oddsStructureReviewValue != null;
  const pathAgencyValid = !showPathAgency
    || (!!pathFirstMove && !!pathDrawdown && (outcome !== 'win' || !!pathWinQuality));
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
  // 情绪侧七问：文字栏全部必填；主石头允许"文字 OR 至少 1 个标签"满足其一。
  const emoTextValid = [
    emoDisturbance,
    emoFirstReaction,
    emoWanted,
    emoFeared,
    emoExcuse,
    emoNextTimePlan,
  ].every(value => value.trim().length > 0);
  const emoMainStoneValid = emoMainStone.trim().length > 0 || emoMainStoneTags.length > 0;
  const emoValid = emoTextValid && emoMainStoneValid;
  const canSave = resultValid
    && decisionValid
    && quadrantValid
    && reviewLoopValid
    && pathAgencyValid
    && opponentValid
    && hedgeWorthItValid
    && fiveStepValid
    && emoValid
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
        post_reflection: journal.post_reflection ?? '',
        post_correct_action: journal.post_correct_action ?? '',
        post_result_summary: resultSummary.trim(),
        post_decision_quality: decisionQuality,
        post_struggle_level: struggleLevel,
        post_small_position_drag: showSmallPositionDrag ? smallPositionDrag : null,
        post_missed_high_odds_state: showMissedHighOddsState ? missedHighOddsState : null,
        post_path_first_move: showPathAgency ? pathFirstMove : null,
        post_path_drawdown: showPathAgency ? pathDrawdown : null,
        post_path_win_quality: showPathAgency ? pathWinQualityToSave : null,
        post_path_agency_note: showPathAgency ? (pathAgencyNote.trim() || null) : null,
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
        post_emo_disturbance: emoDisturbance.trim(),
        post_emo_first_reaction: emoFirstReaction.trim(),
        post_emo_wanted: emoWanted.trim(),
        post_emo_feared: emoFeared.trim(),
        post_emo_excuse: emoExcuse.trim(),
        post_emo_main_stone: emoMainStone.trim() || null,
        post_emo_main_stone_tags: emoMainStoneTags.length > 0 ? emoMainStoneTags : null,
        post_emo_next_time_plan: emoNextTimePlan.trim(),
      });
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
  const hasOddsStructurePlan = !!journal.pre_odds_structure;
  const hasOddsBreakdownPlan = !!snapshotOddsBreakdown.trim();
  const falsificationFactTitle = hasFalsificationPlan
    ? '预设的证伪信号兑现没有？*'
    : '离场事实是什么？*';
  const invalidationReviewPlaceholder = hasFalsificationPlan
    ? '只写证伪/拆仓信号有没有出现、你有没有按它执行。叙事解释放到下方模块。'
    : '只写离场前实际出现的盘面事实和你的执行动作；不要事后补写“本该有的止”。';
  const oddsStructureFactTitle = hasOddsBreakdownPlan
    ? '你命名的结构破坏信号出现没有？*'
    : hasOddsStructurePlan
      ? '目标空间假设被市场验证没有？*'
      : '目标空间事实是什么？*';
  const oddsReviewOptions: Array<{ value: OddsStructureReview; label: string; desc: string }> = hasOddsBreakdownPlan
    ? [
        { value: 'right', label: '未出现', desc: '目标结构基本保持，破坏信号没有兑现' },
        { value: 'mixed', label: '部分出现', desc: '有破坏迹象，但不完整或我处理不清' },
        { value: 'wrong', label: '出现了', desc: '结构破坏信号兑现，目标假设失效' },
      ]
    : [
        { value: 'right', label: '兑现了', desc: '目标空间确实打开，结构假设基本成立' },
        { value: 'mixed', label: '部分兑现', desc: '有空间但不干净，或兑现幅度不足' },
        { value: 'wrong', label: '没兑现', desc: '目标空间没有打开，结构假设失效' },
      ];
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
          badge: '闭环完整',
          title: outcome === 'win' ? '这笔可以作为正向样本' : '亏损受控，按预案结束',
          body:
            outcome === 'win'
              ? '正向预期兑现，并且事实可以核验。它会进入结构成熟度的正向样本。'
              : '真亏的时候从「前门」走：该触发的信号触发了，你也按预案执行了。',
          next: outcome === 'win'
            ? '保存评价即可；后续在结构成熟度里看同类结构是否持续兑现。'
            : '不要因为一笔合规亏损改规则；只记录它是这个 edge 的正常成本。',
        };
      case 'lagged':
        return {
          accent: '#D89B00',
          badge: '执行迟滞',
          title: '信号在预案内，但动作晚了',
          body: '这不是结构没写对，而是看见以后没有立刻执行。问题在动作延迟，不在事后解释。',
          next: '把这条信号改成机械动作：触发即离场、触发即拆仓，别留“再看看”的空间。',
        };
      case 'gap':
        return {
          accent: '#F6465D',
          badge: '预案缺口',
          title: '这次的死法不在预案里',
          body: '亏损不是按预设信号结束，而是从你没提前定义的地方钻出来。这个尾巴必须被前置。',
          next: '把这次让你措手不及的盘面事实，写成下次开仓前的“止”：什么信号出现就离场。',
        };
      default:
        return {
          accent: '#9AA0A6',
          badge: '待判读',
          title: hasFalsificationPlan ? '先完成上方“止”的选择' : '本笔无法判死法门',
          body: hasFalsificationPlan
            ? '上面的证伪状态还没选完，所以系统还不知道这次亏损是前门、晚门还是后门。'
            : '开仓时没有写下可验证的“止”，这里不会把事后事实伪装成事前计划。',
          next: hasFalsificationPlan
            ? '回到上方“止”模块，先选证伪信号是否触发，再看这里的结论。'
            : '先保存本次离场事实；下一次同类开仓，必须提前写清“什么信号出现就离场”。',
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
              <span className={factPillClass}>{hasFalsificationPlan ? '止' : '离场'}</span>
              <div className="text-[12px] font-medium text-foreground">{falsificationFactTitle}</div>
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
            ) : null}
            <Textarea
              rows={2}
              value={invalidationReview}
              onChange={e => setInvalidationReview(e.target.value)}
              placeholder={invalidationReviewPlaceholder}
              className="text-[12px] bg-background/80 border-border/70 rounded-xl"
            />
          </div>

          {!isHedge && (
            <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className={factPillClass}>结构</span>
                <div className="text-[12px] font-medium text-foreground">{oddsStructureFactTitle}</div>
              </div>
              {journal.pre_odds_structure ? (
                <div className="rounded-lg border border-border/60 bg-card px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
                  当时目标：<span className="text-foreground">{ODDS_STRUCTURE_LABELS[journal.pre_odds_structure]}</span>
                  {snapshotOddsBreakdown ? <span> · 破坏信号：{snapshotOddsBreakdown}</span> : null}
                </div>
              ) : null}
              {journal.pre_odds_structure && (
                <div className="grid gap-2">
                  {oddsReviewOptions.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setOddsStructureReviewValue(option.value)}
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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[12px] font-semibold text-foreground">结构闭环判读</div>
                <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  这里不用再填写。系统把上方事实自动收口：看正、看反、看止，然后给出下一步。
                </div>
              </div>
              <div className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[10px] text-muted-foreground">
                读法：先看结论，再看下一步
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
                <div className="text-[10px] font-medium text-muted-foreground">看预期有没有兑现</div>
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
                <div className="text-[10px] font-medium text-muted-foreground">看亏损剧本有没有命中</div>
                <div className="line-clamp-3 text-[10px] leading-relaxed text-muted-foreground">{snapshotPremortem || '—'}</div>
              </div>

              <div className="space-y-1.5 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={factPillClass}>止</span>
                  <span className="text-[10px] font-medium" style={{ color: LOOP_TONE_COLOR[loopReadout.zhi.tone] }}>
                    {loopReadout.zhi.status}
                  </span>
                </div>
                <div className="text-[10px] font-medium text-muted-foreground">看真亏时是不是按预案死</div>
                <div className="line-clamp-3 text-[10px] leading-relaxed text-muted-foreground">{snapshotFalsification || '—'}</div>
              </div>
            </div>

            <div
              className="rounded-xl border px-3 py-3 text-[11px] leading-relaxed"
              style={{
                borderColor: `${loopVerdictMeta.accent}59`,
                backgroundColor: `${loopVerdictMeta.accent}12`,
              }}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    {(loopReadout.verdict === 'gap' || loopReadout.verdict === 'lagged') && (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: loopVerdictMeta.accent }} />
                    )}
                    <span
                      className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                      style={{ borderColor: `${loopVerdictMeta.accent}73`, color: loopVerdictMeta.accent }}
                    >
                      {loopVerdictMeta.badge}
                    </span>
                    <span className="font-semibold text-foreground">{loopVerdictMeta.title}</span>
                  </div>
                  <div className="text-muted-foreground">{loopVerdictMeta.body}</div>
                </div>
                <div className="rounded-lg border border-border/60 bg-card/80 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground sm:w-[260px]">
                  <span className="font-semibold text-foreground">下一步：</span>{loopVerdictMeta.next}
                </div>
              </div>
            </div>
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

        {showPathAgency && (
          <div className={`space-y-3 px-4 py-4 ${sectionCardClass}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[12px] font-semibold text-foreground">路径 + 主动权</div>
                <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  终点只告诉你赢亏，路径告诉你主动权在不在自己手里。赢单尤其要看是不是扛出来的。
                </div>
              </div>
              {pathProxy && (
                <div className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[10px] text-muted-foreground">
                  系统初读：{pathProxy.label}
                </div>
              )}
            </div>

            {pathProxy && (
              <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
                {pathProxy.needsReplay
                  ? '终点是赢，但赢单必须继续判路径：如果中途靠有效浮亏换回来，它不是干净样本。'
                  : CLASS_META[pathProxy.cls].hint}
              </div>
            )}

            <div className="grid gap-3 lg:grid-cols-3">
              <div className="space-y-2">
                <Label className="text-[12px] font-medium">上来是不是就盈利？*</Label>
                <div className="grid gap-1.5">
                  {PATH_FIRST_MOVE_OPTIONS.map(option => {
                    const active = pathFirstMove === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setPathFirstMove(active ? null : option.value)}
                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                          active ? '' : 'border-border bg-background text-muted-foreground hover:bg-accent'
                        }`}
                        style={active ? { borderColor: option.accent, backgroundColor: `${option.accent}14` } : undefined}
                      >
                        <div className="text-[11px] font-medium" style={active ? { color: option.accent } : undefined}>
                          {option.label}
                        </div>
                        <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{option.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[12px] font-medium">中途有没有有效浮亏？*</Label>
                <div className="grid gap-1.5">
                  {PATH_DRAWDOWN_OPTIONS.map(option => {
                    const active = pathDrawdown === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setPathDrawdown(active ? null : option.value)}
                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                          active ? '' : 'border-border bg-background text-muted-foreground hover:bg-accent'
                        }`}
                        style={active ? { borderColor: option.accent, backgroundColor: `${option.accent}14` } : undefined}
                      >
                        <div className="text-[11px] font-medium" style={active ? { color: option.accent } : undefined}>
                          {option.label}
                        </div>
                        <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{option.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[12px] font-medium">如果这笔赢了，是不是扛出来的？{outcome === 'win' ? '*' : ''}</Label>
                {outcome === 'win' ? (
                  <div className="grid gap-1.5">
                    {PATH_WIN_QUALITY_OPTIONS.map(option => {
                      const active = pathWinQuality === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setPathWinQuality(active ? null : option.value)}
                          className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                            active ? '' : 'border-border bg-background text-muted-foreground hover:bg-accent'
                          }`}
                          style={active ? { borderColor: option.accent, backgroundColor: `${option.accent}14` } : undefined}
                        >
                          <div className="text-[11px] font-medium" style={active ? { color: option.accent } : undefined}>
                            {option.label}
                          </div>
                          <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{option.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-3 text-[11px] leading-relaxed text-muted-foreground">
                    非赢单不判“扛出来的赢”；本笔只记录第一段和浮亏路径。
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[12px] font-medium">路径备注</Label>
              <Textarea
                rows={2}
                value={pathAgencyNote}
                onChange={event => setPathAgencyNote(event.target.value)}
                placeholder="只写路径事实：第一段是否顺、中途最大浮亏大概发生在哪、是否靠扛回本。"
                className="text-[12px] bg-background/80 border-border/70 rounded-xl"
              />
            </div>
            {!pathAgencyValid && <div className="text-right font-mono text-[10px] text-[#F6465D]">路径主动权必选</div>}
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

        {/* (D2) 情绪侧复盘 · 七问 */}
        <div className={`space-y-3 px-4 py-4 ${sectionCardClass}`}>
          <div>
            <div className="text-[12px] font-semibold text-foreground">情绪侧复盘 · 七问</div>
            <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
              不是分析盘面，是分析你自己。把这单底下真正动你的"那块石头"翻出来命名。
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">① 这单最起波澜的事情是什么？*</Label>
            <Textarea
              rows={2}
              value={emoDisturbance}
              onChange={e => setEmoDisturbance(e.target.value)}
              placeholder="只写让你心里一震/一紧/一急的那个具体时刻：价格跳了、突然爆仓、有人喊单、止损被扫……"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">② 我的第一反应是什么？*</Label>
            <Textarea
              rows={2}
              value={emoFirstReaction}
              onChange={e => setEmoFirstReaction(e.target.value)}
              placeholder="没经过大脑那一下：想加仓、想砍掉、想躲开屏幕、想骂人、想截图发出去……写最原始的那个冲动。"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl"
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[12px] font-medium">③ 我其实想得到什么？*</Label>
              <Textarea
                rows={3}
                value={emoWanted}
                onChange={e => setEmoWanted(e.target.value)}
                placeholder="不是「赚钱」这种正确答案。是更底层的东西：被认可、扳回上一笔、证明自己看对了、一次到位……"
                className="text-[12px] bg-background/80 border-border/70 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-medium">④ 我其实在害怕什么？*</Label>
              <Textarea
                rows={3}
                value={emoFeared}
                onChange={e => setEmoFeared(e.target.value)}
                placeholder="也不是「亏钱」这种表层答案。是更底层的东西：被打脸、错过、回吐、被嘲笑、不能再翻身……"
                className="text-[12px] bg-background/80 border-border/70 rounded-xl"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">⑤ 我自己给自己找了一个什么样的理由？*</Label>
            <Textarea
              rows={2}
              value={emoExcuse}
              onChange={e => setEmoExcuse(e.target.value)}
              placeholder="当时是怎么把这个动作「说圆」的？「这次不一样」/「再等等就回来了」/「信号不算明显」/「破位需要确认」……"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl"
            />
            <p className="text-[10px] text-muted-foreground">不是审判，是采证。把当时骗自己的那句话原样写下来。</p>
          </div>

          {/* ⑥ 主石头 */}
          <div className="rounded-xl border border-[#F0B90B]/30 bg-[#F0B90B]/[0.04] px-3 py-3 space-y-3">
            <div>
              <Label className="text-[12px] font-medium text-[#D89B00]">⑥ 这单我捞起的主石头是什么？*</Label>
              <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                主石头 = 这单底下真正动你的那个原型（恐惧或贪婪的具体类型）。先选标签快速命名，再用文字补一句话。
              </p>
            </div>

            <div className="space-y-2">
              {groupMainStonesByFamily().map(group => (
                <div key={group.family} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-full border px-2 py-0.5 text-[10px] font-medium"
                      style={{ borderColor: `${group.meta.accent}66`, color: group.meta.accent }}
                    >
                      {group.meta.title}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{group.meta.intro}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.stones.map(({ id, meta }) => {
                      const active = emoMainStoneTags.includes(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          title={meta.oneLine}
                          onClick={() => setEmoMainStoneTags(prev =>
                            active ? prev.filter(t => t !== id) : [...prev, id],
                          )}
                          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                            active ? '' : 'border-border bg-background text-muted-foreground hover:bg-accent'
                          }`}
                          style={active ? {
                            borderColor: group.meta.accent,
                            backgroundColor: `${group.meta.accent}1A`,
                            color: group.meta.accent,
                          } : undefined}
                        >
                          {meta.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {emoMainStoneTags.length > 0 && (
              <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground space-y-1">
                {emoMainStoneTags.map(tag => (
                  <div key={tag}>
                    <span className="font-medium text-foreground">{MAIN_STONE_META[tag].label}</span>
                    ：{MAIN_STONE_META[tag].oneLine}
                  </div>
                ))}
              </div>
            )}

            <Textarea
              rows={2}
              value={emoMainStone}
              onChange={e => setEmoMainStone(e.target.value)}
              placeholder="用一句话补充：选中的标签具体长什么样？例如「就是怕上一笔亏了不甘心，这单本质是找回场子」。"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl"
            />
            {!emoMainStoneValid && (
              <div className="text-right font-mono text-[10px] text-[#F6465D]">至少选一个标签，或写一句话</div>
            )}
          </div>

          {/* ⑦ 下次预案 */}
          <div className="rounded-xl border border-[#0ECB81]/30 bg-[#0ECB81]/[0.04] px-3 py-3 space-y-2">
            <Label className="text-[12px] font-medium text-[#0ECB81]">⑦ 如果明天同样遇到一样的事情，我准备怎么选？*</Label>
            <Textarea
              rows={3}
              value={emoNextTimePlan}
              onChange={e => setEmoNextTimePlan(e.target.value)}
              placeholder="不要写「我下次会冷静」。写一个动作级的预案：触发什么信号、做什么动作、不做什么动作。例如：再遇到这种快速跳价，先离开屏幕 5 分钟再决定加减仓。"
              className="text-[12px] bg-background/80 border-border/70 rounded-xl"
            />
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              这块石头下次还会出现。提前写好动作，到时候才不用临场跟自己谈判。
            </p>
          </div>

          {!emoTextValid && (
            <div className="text-right font-mono text-[10px] text-[#F6465D]">情绪七问需填完</div>
          )}
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
