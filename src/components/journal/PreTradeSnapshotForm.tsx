/**
 * 开仓快照表单 — 批次 23 精简版
 * 新快照只录入会直接改变决策质量的字段；旧列保留但不再在 UI 中填写。
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  COGNITIVE_BIAS_CATEGORIES,
  COGNITIVE_BIAS_META,
  type CognitiveBiasCategory,
  type CognitiveBiasMeta,
  type CognitiveBiasTagId,
} from '@/lib/cognitiveBiasTags';
import { computeDiscount, computeHedgeConvictionDiscount } from '@/lib/confidenceDiscount';
import { buildHedgeBoundaryBasis } from '@/lib/hedgeBoundaryBasis';
import { ODDS_STRUCTURE_OPTIONS } from '@/lib/oddsStructure';
import { EDGE_SOURCE_OPTIONS } from '@/lib/edgeSource';
import { recoveryGainPct, recoveryAsymmetryRatio } from '@/lib/structureResult';
import {
  HEDGE_TYPES,
  HEDGE_DOWN_BRANCH_DEFAULTS,
  HEDGE_ORDER_METHOD_LABELS,
  computeNecessitySuggestion,
  getHedgeType,
} from '@/lib/hedgeTypes';
import {
  computeBetSizing,
  deriveProfitUpsideAdvice,
  estimateCampaignSizingStats,
  DEFAULT_PAYOFF_RATIO,
} from '@/lib/kellySizing';
import { analyzePositionFeedback, type FeedbackPolarity } from '@/lib/positionFeedback';
import { EMOTION_CATEGORIES, EMOTION_TAG_META } from '@/types/journal';
import type { EmotionTagMeta, EmotionValence } from '@/types/journal';
import { buildChecklist, isChecklistPassed } from '@/lib/defaultChecklist';
import { listAllCampaigns, listJournals, listRules } from '@/lib/journalApi';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { calcUnrealizedPnl } from '@/types/trading';
import type { PlaceOrderParams } from '@/contexts/TradingContext';
import type {
  ChecklistItem,
  DatasetSplit,
  EdgeSource,
  HedgeBoundaryStance,
  HedgeOrderMethod,
  HedgeType,
  LegRole,
  OddsStructure,
  OrderKind,
  PainTag,
  StrategyTemplate,
  TradeCampaign,
  TradeDirection,
  TradeJournal,
  TradingRule,
} from '@/types/journal';

export type SnapshotMode = 'trade' | 'no_entry';
type OpportunityCostAnswer = 'worth_it' | 'not_worth_it' | 'unclear';

export interface TpLevel {
  price: string;
  pct: string;
}

export interface SnapshotPayload {
  order_kind: OrderKind;
  campaign_mode: 'create' | 'join' | 'standalone';
  campaign_id: string | null;
  campaign_title: string | null;
  campaign_template: StrategyTemplate | null;
  campaign_leg_role: LegRole | null;
  campaign_note: string | null;
  pre_entry_reason: string | null;
  pre_planned_stop_loss: number | null;
  pre_planned_take_profit: number | null;
  pre_mental_state: 1 | 2 | 3 | 4 | 5;
  pre_mental_trigger: string | null;
  pre_risk_awareness: string | null;
  pre_risk_management: string | null;
  pre_checklist_items: ChecklistItem[] | null;
  pre_checklist_passed: boolean | null;
  pre_position_size: number | null;
  pre_max_loss_usdt: number | null;
  pre_thesis_why_right: string | null;
  pre_premortem_failure_reason: string | null;
  pre_falsification_signal: string | null;
  pre_confidence_basis: string | null;
  pre_odds_structure: OddsStructure | null;
  pre_odds_structure_source: string | null;
  pre_odds_structure_premortem: string | null;
  pre_odds_structure_breakdown_signals: string | null;
  pre_account_equity_usdt: number | null;
  /** 机会成本问句：不做更亏吗？false = 填补无聊 / 凭感觉的小机会仓位。 */
  pre_opportunity_cost_worth: boolean | null;
  /** Edge / 源头标签，用于盈亏同源分析。 */
  pre_edge_source: EdgeSource | null;
  // Deprecated snapshot fields kept in the payload shape for backwards-safe inserts.
  pre_mortem_text: string | null;
  pre_positive_expectancy: string | null;
  pre_invalidation_condition: string | null;
  pre_calibration_win_pct: number | null;
  pre_confidence_interval_low_pct: number | null;
  pre_confidence_interval_high_pct: number | null;
  pre_calibration_reference_class: string | null;
  pre_calibration_competence_basis: string | null;
  pre_calibration_update_signal: string | null;
  pre_dataset_split: DatasetSplit | null;
  pre_lollapalooza_score: number | null;
  pre_bankruptcy_estimate: number | null;
  pre_info_kline_facts: string | null;
  pre_info_macro_facts: string | null;
  pre_info_rule_advice: string | null;
  pre_info_intuition: string | null;
  pre_info_designer_view: string | null;
  pre_opponent_statement: string | null;
  pre_triggered_principle_ids: string[] | null;
  pre_triggered_rule_ids: string[] | null;
  pre_pain_tags: PainTag[] | null;
  pre_cognitive_bias_tags: string[] | null;
  pre_executor_self: string | null;
  pre_designer_self: string | null;
  // 批次 25：对冲单专属快照字段（主力单恒为 null）。
  hedge_type: HedgeType | null;
  hedge_boundary_price: number | null;
  hedge_boundary_basis: string | null;
  hedge_boundary_stance: HedgeBoundaryStance | null;
  hedge_lock_profit_pct: number | null;
  hedge_resolution_up: string | null;
  hedge_down_if_chop: string | null;
  hedge_down_if_trend: string | null;
  hedge_down_if_rebound: string | null;
  /** @deprecated 旧版单字段向下预案，保留给历史 journal。 */
  hedge_resolution_down: string | null;
  hedge_necessity_pct: number | null;
  hedge_safety_strength: 1 | 2 | 3 | 4 | 5 | null;
  hedge_safety_regularity: 1 | 2 | 3 | 4 | 5 | null;
  hedge_risk_magnitude: 1 | 2 | 3 | 4 | 5 | null;
  hedge_conviction_pct: number | null;
  hedge_friction_cost: string | null;
  hedge_order_method: HedgeOrderMethod | null;
  tp_levels: TpLevel[];
}

interface Props {
  mode: SnapshotMode;
  symbol: string;
  direction: TradeDirection;
  simulatedTime: Date;
  lockedEntryPrice: number | null;
  leverage: number;
  initialPositionSizeUsdt: number | null;
  pricePrecision: number;
  orderParams?: PlaceOrderParams | null;
  onCancel: () => void;
  onTooHard?: (draft: {
    order_kind: OrderKind;
    pre_planned_stop_loss?: number | null;
    pre_odds_structure?: OddsStructure | null;
    pre_odds_structure_source?: string | null;
    pre_odds_structure_premortem?: string | null;
    pre_odds_structure_breakdown_signals?: string | null;
    pre_opportunity_cost_worth?: boolean | null;
    pre_edge_source?: EdgeSource | null;
  }) => void;
  onSubmit: (payload: SnapshotPayload) => Promise<void> | void;
}

interface EmotionGroup {
  valence: EmotionValence;
  title: string;
  ruleImpact: string;
  systemPrompt: string;
  accent: string;
  tags: PainTag[];
}

/** 三类情绪（正向助执行 / 中性需校准 / 负向易破坏），按 EMOTION_TAG_META 的声明顺序填充各自的标签。 */
const EMOTION_GROUPS: EmotionGroup[] = EMOTION_CATEGORIES.map(category => ({
  ...category,
  tags: (Object.entries(EMOTION_TAG_META) as [PainTag, EmotionTagMeta][])
    .filter(([, meta]) => meta.valence === category.valence)
    .map(([tag]) => tag),
})).filter(group => group.tags.length > 0);

interface CognitiveBiasGroup {
  category: CognitiveBiasCategory;
  title: string;
  oneLiner: string;
  definition: string;
  systemPrompt: string;
  accent: string;
  tags: CognitiveBiasTagId[];
}

/** 三类认知偏差（信息=看错信息 / 判断=想错逻辑 / 执行=做错动作），按 COGNITIVE_BIAS_META 的声明顺序填充各自的标签。 */
const COGNITIVE_BIAS_GROUPS: CognitiveBiasGroup[] = COGNITIVE_BIAS_CATEGORIES.map(category => ({
  ...category,
  tags: (Object.entries(COGNITIVE_BIAS_META) as [CognitiveBiasTagId, CognitiveBiasMeta][])
    .filter(([, meta]) => meta.category === category.category)
    .map(([tag]) => tag),
})).filter(group => group.tags.length > 0);

interface DecisionQuestion {
  id: 'why' | 'premortem' | 'falsification';
  index: number;
  title: string;
  hint: string;
  placeholder: string;
  accent: string;
  badgeText: string;
}

const DECISION_QUESTIONS: DecisionQuestion[] = [
  {
    id: 'why',
    index: 1,
    title: '这笔为什么会对？',
    hint: '正向论证：结构 / 量能 / 宏观 / 规则',
    placeholder: '把支撑你下注的证据整合成一段话，不分多框。',
    accent: '#0ECB81',
    badgeText: '正',
  },
  {
    id: 'premortem',
    index: 2,
    title: '假设这笔亏完，最可能的原因是？',
    hint: 'Munger inversion：先想清楚怎么输',
    placeholder: '写出最可能让你亏完的剧本——是结构破位、是情绪、还是规则失效。',
    accent: '#F0B90B',
    badgeText: '反',
  },
  {
    id: 'falsification',
    index: 3,
    title: '什么信号一旦触发，你就提前止损 / 拆仓？',
    hint: '失效信号：可观测、可触发，不是「感觉不对」',
    placeholder: '写成盘面会自己触发的事件——价位 / 形态 / 量能 / 时间。例：「跌破 4h 关键支撑且 1h 放量」。不能是「感觉要跌了」这种感受。',
    accent: '#F6465D',
    badgeText: '止',
  },
];

const fmtTime = (d: Date) => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
};

const directionLabel = (d: TradeDirection) =>
  d === 'long' ? '做多' : d === 'short' ? '做空' : '未开仓';

const clampProbability = (value: number) => Math.min(100, Math.max(0, Math.round(value)));
const ODDS_RATIO_MIN = 0.5;
const ODDS_RATIO_MAX = 5;
const ODDS_RATIO_STEP = 0.1;
const ODDS_RATIO_BREAK_EVEN = 1;
const ODDS_RATIO_BREAK_EVEN_PCT = ((ODDS_RATIO_BREAK_EVEN - ODDS_RATIO_MIN) / (ODDS_RATIO_MAX - ODDS_RATIO_MIN)) * 100;
const R_DRAWDOWN_MIN_PCT = 0.1;
const R_DRAWDOWN_MAX_PCT = 50;
const R_DRAWDOWN_STEP_PCT = 0.1;
const formatOddsRatio = (value: number) => value.toFixed(1);
const formatSigned = (value: number, digits = 2) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;

function riskTone(pct: number | null) {
  if (pct == null) return 'text-muted-foreground';
  if (pct < 2) return 'text-[#0ECB81]';
  if (pct < 5) return 'text-[#D89B00]';
  return 'text-[#F6465D]';
}

function polarityTone(polarity: FeedbackPolarity): { box: string; text: string } {
  if (polarity === 'danger') return { box: 'border-[#F6465D]/40 bg-[#F6465D]/10', text: 'text-[#F6465D]' };
  if (polarity === 'caution') return { box: 'border-[#F0B90B]/40 bg-[#F0B90B]/10', text: 'text-[#D89B00]' };
  return { box: 'border-[#0ECB81]/40 bg-[#0ECB81]/10', text: 'text-[#0ECB81]' };
}

export function PreTradeSnapshotForm({
  mode,
  symbol,
  direction,
  simulatedTime,
  lockedEntryPrice,
  leverage,
  initialPositionSizeUsdt,
  pricePrecision,
  orderParams,
  onCancel,
  onTooHard,
  onSubmit,
}: Props) {
  const isTrade = mode === 'trade';
  const isShort = direction === 'short';
  const { user } = useAuth();
  const {
    balance,
    positionsMap,
    priceMap,
    getSymbolLeverage,
    getSymbolMarginMode,
    setSymbolMarginMode,
  } = useTradingContext();

  const [orderKind, setOrderKind] = useState<OrderKind>('main');
  const [whyRight, setWhyRight] = useState('');
  const [failureReason, setFailureReason] = useState('');
  const [falsificationSignal, setFalsificationSignal] = useState('');
  const [maxLossInput, setMaxLossInput] = useState('');
  const [mental, setMental] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [painTags, setPainTags] = useState<PainTag[]>([]);
  const [cognitiveBiasTags, setCognitiveBiasTags] = useState<CognitiveBiasTagId[]>([]);
  const [confidencePct, setConfidencePct] = useState(50);
  const [confidenceBasis, setConfidenceBasis] = useState('');
  const [oddsStructure, setOddsStructure] = useState<OddsStructure | null>(null);
  const [oddsRatioEstimate, setOddsRatioEstimate] = useState(DEFAULT_PAYOFF_RATIO);
  const [plannedDrawdownPriceInput, setPlannedDrawdownPriceInput] = useState('');
  const [oddsStructureSource, setOddsStructureSource] = useState('');
  const [oddsStructurePremortem, setOddsStructurePremortem] = useState('');
  const [oddsStructureBreakdownSignals, setOddsStructureBreakdownSignals] = useState('');
  // 《不对称思考》：先识别 edge/源头标签，再判断机会成本是否足够占用行动力。
  const [oppCostAnswer, setOppCostAnswer] = useState<OpportunityCostAnswer | null>(null);
  const [edgeSource, setEdgeSource] = useState<EdgeSource | null>(null);
  const [confirmBadOddsTradeOpen, setConfirmBadOddsTradeOpen] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [userRules, setUserRules] = useState<TradingRule[]>([]);
  const [historicalJournals, setHistoricalJournals] = useState<TradeJournal[]>([]);
  const [historicalCampaigns, setHistoricalCampaigns] = useState<TradeCampaign[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // 批次 25：对冲专属状态。把握性绝不参与必要性/对冲大小的任何推导（铁律）。
  const [hedgeType, setHedgeType] = useState<HedgeType | null>(null);
  const [hedgeBoundaryPrice, setHedgeBoundaryPrice] = useState('');
  const [hedgeBoundaryWhyRight, setHedgeBoundaryWhyRight] = useState('');
  const [hedgeBoundaryFailureReason, setHedgeBoundaryFailureReason] = useState('');
  const [hedgeBoundaryInvalidationSignal, setHedgeBoundaryInvalidationSignal] = useState('');
  const [hedgeBoundaryStance, setHedgeBoundaryStance] = useState<HedgeBoundaryStance | null>(null);
  const [hedgeLockProfitPct, setHedgeLockProfitPct] = useState('4');
  const [hedgeResolutionUp, setHedgeResolutionUp] = useState('');
  const [hedgeDownIfChop, setHedgeDownIfChop] = useState<string>(HEDGE_DOWN_BRANCH_DEFAULTS.chop);
  const [hedgeDownIfTrend, setHedgeDownIfTrend] = useState<string>(HEDGE_DOWN_BRANCH_DEFAULTS.trend);
  const [hedgeDownIfRebound, setHedgeDownIfRebound] = useState<string>(HEDGE_DOWN_BRANCH_DEFAULTS.rebound);
  const [hedgeSafetyStrength, setHedgeSafetyStrength] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [hedgeSafetyRegularity, setHedgeSafetyRegularity] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [hedgeRiskMagnitude, setHedgeRiskMagnitude] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [hedgeNecessityPct, setHedgeNecessityPct] = useState<number | null>(null);
  const [hedgeConvictionPct, setHedgeConvictionPct] = useState<number | null>(null);
  const [hedgeOrderMethod, setHedgeOrderMethod] = useState<HedgeOrderMethod | null>(null);

  const isHedge = isTrade && orderKind === 'hedge';
  const currentLeverage = getSymbolLeverage(symbol) ?? leverage;
  const currentMarginMode = getSymbolMarginMode(symbol) ?? 'cross';
  const crossBlocked = isTrade && currentMarginMode !== 'isolated';

  useEffect(() => {
    if (!user || !isTrade) return;
    listRules(user.id).then(setUserRules).catch(() => setUserRules([]));
  }, [user, isTrade]);

  useEffect(() => {
    if (!user) {
      setHistoricalJournals([]);
      setHistoricalCampaigns([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [journalRows, campaignRows] = await Promise.all([
          listJournals(user.id),
          listAllCampaigns(user.id, { status: 'all' }),
        ]);
        if (!cancelled) {
          setHistoricalJournals(journalRows);
          setHistoricalCampaigns(campaignRows);
        }
      } catch {
        if (!cancelled) {
          setHistoricalJournals([]);
          setHistoricalCampaigns([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const accountEquity = useMemo(() => {
    let equity = Number.isFinite(balance) ? balance : 0;
    for (const [positionSymbol, positions] of Object.entries(positionsMap)) {
      for (const position of positions) {
        const markPrice = priceMap[positionSymbol] ?? position.entryPrice;
        const pnl = calcUnrealizedPnl(position, markPrice);
        if (position.marginMode === 'isolated') {
          equity += (position.isolatedMargin ?? position.margin ?? 0) + pnl;
        } else {
          equity += pnl;
        }
      }
    }
    return Math.max(0, equity);
  }, [balance, positionsMap, priceMap]);

  const inferredPositionSizeUsdt = useMemo(() => {
    if (initialPositionSizeUsdt != null && Number.isFinite(initialPositionSizeUsdt)) {
      return Number(initialPositionSizeUsdt.toFixed(2));
    }
    if (orderParams?.quantity && lockedEntryPrice) {
      return Number((orderParams.quantity * lockedEntryPrice).toFixed(2));
    }
    if (orderParams?.currencyUnit === 'USDT' && orderParams.inputAmount > 0) {
      if (orderParams.usdtInputMode === 'INITIAL_MARGIN') {
        return Number((orderParams.inputAmount * orderParams.leverage).toFixed(2));
      }
      return Number(orderParams.inputAmount.toFixed(2));
    }
    return null;
  }, [initialPositionSizeUsdt, lockedEntryPrice, orderParams]);

  const checklistItems = useMemo(() => buildChecklist(userRules), [userRules]);
  const checklistPassed = isChecklistPassed(checked, checklistItems);
  const requiredCount = checklistItems.filter(i => i.required && checked.includes(i.id)).length;
  const requiredTotal = checklistItems.filter(i => i.required).length;
  const optionalCount = checklistItems.filter(i => !i.required && i.source !== 'rule' && checked.includes(i.id)).length;
  const optionalTotal = checklistItems.filter(i => !i.required && i.source !== 'rule').length;
  const optionalNeed = Math.min(2, optionalTotal);
  const oppCostWorth = oppCostAnswer == null ? null : oppCostAnswer === 'worth_it';

  const maxLoss = Number(maxLossInput);
  const maxLossValid = Number.isFinite(maxLoss) && maxLoss > 0;
  const maxLossPct = maxLossValid && accountEquity > 0 ? (maxLoss / accountEquity) * 100 : null;
  const maxLossPctLabel = maxLossPct == null ? '—' : `${maxLossPct.toFixed(1)}%`;
  // 回撤的非对称：亏掉 X% 后要 +Y% 才能回本（Y 永远 > X，越深越离谱）。
  const recoveryPct = maxLossPct != null ? recoveryGainPct(maxLossPct) : null;
  const recoveryRatio = maxLossPct != null ? recoveryAsymmetryRatio(maxLossPct) : null;
  const finiteRecoveryPct = recoveryPct != null && Number.isFinite(recoveryPct) ? recoveryPct : null;
  const recoveryScaleMax = maxLossPct != null
    ? Math.max(10, maxLossPct, finiteRecoveryPct ?? maxLossPct)
    : 10;
  const drawdownVisualWidth = maxLossPct != null
    ? Math.min(100, (maxLossPct / recoveryScaleMax) * 100)
    : 0;
  const recoveryVisualWidth = finiteRecoveryPct != null
    ? Math.min(100, (finiteRecoveryPct / recoveryScaleMax) * 100)
    : 100;
  const afterLossEquityPct = maxLossPct != null ? Math.max(0, 100 - maxLossPct) : null;

  const plannedDrawdownPrice = Number(plannedDrawdownPriceInput);
  const plannedDrawdownPriceProvided = plannedDrawdownPriceInput.trim().length > 0;
  const plannedDrawdownPriceFinite = plannedDrawdownPriceProvided
    && Number.isFinite(plannedDrawdownPrice)
    && plannedDrawdownPrice > 0;
  const rDrawdownRawPct = lockedEntryPrice && lockedEntryPrice > 0 && plannedDrawdownPriceFinite
    ? (
      isShort
        ? ((plannedDrawdownPrice - lockedEntryPrice) / lockedEntryPrice) * 100
        : ((lockedEntryPrice - plannedDrawdownPrice) / lockedEntryPrice) * 100
    )
    : null;
  const rDrawdownPct = rDrawdownRawPct != null && rDrawdownRawPct > 0 ? rDrawdownRawPct : null;
  const plannedDrawdownPriceValid = plannedDrawdownPriceFinite && rDrawdownPct != null;
  const plannedDrawdownPriceForPayload = plannedDrawdownPriceValid
    ? Number(plannedDrawdownPrice.toFixed(pricePrecision))
    : null;
  const rDrawdownPctForSlider = rDrawdownPct != null
    ? Math.min(R_DRAWDOWN_MAX_PCT, Math.max(R_DRAWDOWN_MIN_PCT, rDrawdownPct))
    : R_DRAWDOWN_MIN_PCT;
  const rRecoveryPct = rDrawdownPct != null ? recoveryGainPct(rDrawdownPct) : null;
  const rRecoveryRatio = rDrawdownPct != null ? recoveryAsymmetryRatio(rDrawdownPct) : null;
  const rFiniteRecoveryPct = rRecoveryPct != null && Number.isFinite(rRecoveryPct) ? rRecoveryPct : null;
  const rRecoveryScaleMax = rDrawdownPct != null
    ? Math.max(10, rDrawdownPct, rFiniteRecoveryPct ?? rDrawdownPct)
    : 10;
  const rDrawdownVisualWidth = rDrawdownPct != null
    ? Math.min(100, (rDrawdownPct / rRecoveryScaleMax) * 100)
    : 0;
  const rRecoveryVisualWidth = rFiniteRecoveryPct != null
    ? Math.min(100, (rFiniteRecoveryPct / rRecoveryScaleMax) * 100)
    : 100;
  const rAfterDrawdownBasePct = rDrawdownPct != null ? Math.max(0, 100 - rDrawdownPct) : null;
  const updatePlannedDrawdownFromPct = (pct: number) => {
    if (!lockedEntryPrice || lockedEntryPrice <= 0) return;
    const clamped = Math.min(R_DRAWDOWN_MAX_PCT, Math.max(R_DRAWDOWN_MIN_PCT, pct));
    const nextPrice = isShort
      ? lockedEntryPrice * (1 + clamped / 100)
      : lockedEntryPrice * (1 - clamped / 100);
    setPlannedDrawdownPriceInput(nextPrice > 0 ? nextPrice.toFixed(pricePrecision) : '');
  };

  const decisionReady = whyRight.trim().length > 0
    && failureReason.trim().length > 0
    && falsificationSignal.trim().length > 0;
  const oddsStructureReady = isHedge || !isTrade || (
    oddsStructure != null
    && plannedDrawdownPriceValid
    && oddsStructureSource.trim().length > 0
    && oddsStructurePremortem.trim().length > 0
    && oddsStructureBreakdownSignals.trim().length > 0
  );
  // 主力单必须给出 edge/源头与机会成本回答（对冲单与弃单记录不要求）。
  const edgeSourceReady = isHedge || !isTrade || edgeSource != null;
  const oppCostReady = isHedge || !isTrade || oppCostWorth != null;
  const mentalReady = mental >= 3;
  // 对冲路径的可提交条件（见 spec §5）。把握性与必要性各自独立校验，互不推导。
  const hedgeReady = !isHedge || (
    hedgeType != null
    && Number(hedgeBoundaryPrice) > 0
    && hedgeResolutionUp.trim().length > 0
    && (hedgeNecessityPct ?? 0) > 0
    && hedgeSafetyStrength != null
    && hedgeSafetyRegularity != null
    && hedgeRiskMagnitude != null
    && hedgeConvictionPct != null
  );
  const tradeReady = !isTrade || (
    currentMarginMode === 'isolated'
    && (isHedge ? hedgeReady : (maxLossValid && checklistPassed))
  );
  const canSubmit = mentalReady && tradeReady
    && (isHedge || (decisionReady && oddsStructureReady && edgeSourceReady && oppCostReady));
  const recentMainReviewed = historicalJournals.filter(j =>
    (j.journal_kind ?? 'trade') === 'trade'
    && j.order_kind === 'main'
    && j.post_reviewed_at
    && j.post_outcome
    && j.post_outcome !== 'no_entry',
  );
  const weakeningMainPerformance = (() => {
    if (recentMainReviewed.length < 6) return false;
    const recent = recentMainReviewed.slice(0, 6);
    const weakWinRate = recent.filter(j => j.post_outcome === 'win').length / recent.length < 0.4;
    const withR = recent.filter(j => typeof j.post_r_multiple === 'number');
    const weakR = withR.length >= 4
      && (withR.reduce((sum, j) => sum + (j.post_r_multiple ?? 0), 0) / withR.length) < 0;
    return weakWinRate || weakR;
  })();
  const badOddsGate = isTrade && !isHedge && oddsStructure === 'with_crowd_released';
  const smallOpportunityGate = isTrade && !isHedge && oddsStructure === 'neutral_choppy';
  // 机会成本答「否 / 说不清」= 不做也不亏 / 凭感觉 = 小机会仓位，与坏结构同样触发二次确认。
  const boredomGate = isTrade && !isHedge && oppCostWorth === false;
  const oddsCautionGate = badOddsGate || smallOpportunityGate || boredomGate;

  const toggleChecklist = (id: string, checkedValue: boolean) => {
    setChecked(prev => checkedValue ? Array.from(new Set([...prev, id])) : prev.filter(item => item !== id));
  };

  const togglePainTag = (tag: PainTag) => {
    setPainTags(prev => prev.includes(tag) ? prev.filter(item => item !== tag) : [...prev, tag]);
  };

  const toggleCognitiveBiasTag = (tag: CognitiveBiasTagId) => {
    setCognitiveBiasTags(prev => prev.includes(tag) ? prev.filter(item => item !== tag) : [...prev, tag]);
  };

  const discount = useMemo(
    () => computeDiscount(confidencePct, historicalJournals),
    [confidencePct, historicalJournals],
  );

  // ===== 批次 25：对冲专属派生值 =====
  const hedgeTypeMeta = getHedgeType(hedgeType);
  const hedgeBoundary = Number(hedgeBoundaryPrice);
  const hedgeBoundaryValid = Number.isFinite(hedgeBoundary) && hedgeBoundary > 0;
  const hedgeNecessityValue = hedgeNecessityPct ?? 0;
  const hedgeConvictionValue = hedgeConvictionPct ?? 0;

  // 切换对冲类型时预填两分支预案（可编辑、可改不可清空）；同型重复点击不覆盖已编辑内容。
  const selectHedgeType = (id: HedgeType) => {
    if (id === hedgeType) return;
    setHedgeType(id);
    const meta = getHedgeType(id);
    if (meta) {
      setHedgeResolutionUp(meta.resolutionUpDefault);
      setHedgeDownIfChop(HEDGE_DOWN_BRANCH_DEFAULTS.chop);
      setHedgeDownIfTrend(HEDGE_DOWN_BRANCH_DEFAULTS.trend);
      setHedgeDownIfRebound(HEDGE_DOWN_BRANCH_DEFAULTS.rebound);
    }
  };

  // 必要性建议（幽灵刻度）：只由概率维度 + 烈度维度驱动，绝不引用把握性。
  const necessitySuggestion = useMemo(() => {
    if (hedgeSafetyStrength == null || hedgeSafetyRegularity == null || hedgeRiskMagnitude == null) return null;
    return computeNecessitySuggestion(hedgeSafetyStrength, hedgeSafetyRegularity, hedgeRiskMagnitude);
  }, [hedgeSafetyStrength, hedgeSafetyRegularity, hedgeRiskMagnitude]);

  // 把握性的芒格折扣（值回率口径）：仅显示，绝不写库。
  const hedgeDiscount = useMemo(
    () => computeHedgeConvictionDiscount(hedgeConvictionValue, historicalJournals),
    [hedgeConvictionValue, historicalJournals],
  );

  // 恐慌探测器：把握低却下重手——软提示，不阻塞。
  const hedgePanic = isHedge
    && hedgeConvictionPct != null
    && hedgeNecessityPct != null
    && hedgeConvictionPct < 40
    && hedgeNecessityPct > 60;

  // 类型 × 必要性一致性软提示——仅提示，不阻塞。
  const hedgeConsistencyHint = (() => {
    if (!isHedge || hedgeType == null || hedgeNecessityPct == null) return null;
    if (hedgeType === 'filter' && hedgeNecessityPct < 40) return '混沌行情通常需要更大对冲，确认？';
    if (hedgeType === 'ratio' && hedgeNecessityPct > 70) return '主升浪通常只需部分对冲，确认？';
    return null;
  })();

  const hedgeDownBranchesComplete = (
    hedgeDownIfChop.trim().length > 0
    && hedgeDownIfTrend.trim().length > 0
    && hedgeDownIfRebound.trim().length > 0
  );

  // 下注规模 · 毁灭概率封顶（批次 25）— 胜率与盈亏比战役口径优先；样本不足时使用本次滑条，绝不写库。
  const campaignSizingStats = useMemo(
    () => estimateCampaignSizingStats(historicalCampaigns),
    [historicalCampaigns],
  );
  const campaignWinRatePct = campaignSizingStats.winRate == null
    ? null
    : Number((campaignSizingStats.winRate * 100).toFixed(0));
  const sizingWinProb = campaignSizingStats.winRate ?? (discount.discountedPct / 100);
  const payoffRatio = campaignSizingStats.payoffRatio ?? oddsRatioEstimate;
  const betSizing = useMemo(
    () => (isTrade && accountEquity > 0
      ? computeBetSizing({
        winProb: sizingWinProb,
        payoffRatio,
        equity: accountEquity,
        plannedMaxLossUsdt: maxLossValid ? maxLoss : null,
      })
      : null),
    [isTrade, accountEquity, sizingWinProb, payoffRatio, maxLossValid, maxLoss],
  );
  const expectedValueTone = !betSizing || betSizing.expectedR > 0
    ? 'text-[#0ECB81]'
    : betSizing.expectedR < 0
      ? 'text-[#F6465D]'
      : 'text-muted-foreground';
  const profitUpsideAdvice = useMemo(
    () => deriveProfitUpsideAdvice({
      betSizing,
      campaignStats: campaignSizingStats,
      plannedMaxLossUsdt: maxLossValid ? maxLoss : null,
    }),
    [betSizing, campaignSizingStats, maxLossValid, maxLoss],
  );

  // 持仓反馈体检（批次 25）— 负反馈维稳 / 正反馈顺势，软性提示，绝不阻塞。
  const positionFeedback = useMemo(() => {
    const proposedSide = direction === 'long' ? 'LONG' : direction === 'short' ? 'SHORT' : null;
    const positions = (positionsMap[symbol] ?? []).map(p => ({
      side: p.side,
      entryPrice: p.entryPrice,
      quantity: p.quantity,
      leverage: p.leverage,
    }));
    const recentCloses = historicalJournals
      .filter(j => (j.journal_kind ?? 'trade') === 'trade' && j.symbol === symbol && j.post_outcome != null)
      .map(j => ({
        pnlUsdt: typeof j.post_realized_pnl === 'number'
          ? j.post_realized_pnl
          : (j.post_outcome === 'loss' ? -1 : 0),
        closeTimeMs: Date.parse(j.pre_simulated_time),
      }))
      .filter(c => Number.isFinite(c.closeTimeMs));
    return analyzePositionFeedback({
      proposedSide,
      proposedOrderKind: orderKind,
      proposedLeverage: leverage,
      markPrice: priceMap[symbol] ?? null,
      positions,
      recentCloses,
      nowMs: simulatedTime.getTime(),
      recommendedMaxLossUsdt: betSizing?.recommendedMaxLossUsdt ?? null,
    });
  }, [direction, orderKind, positionsMap, symbol, historicalJournals, leverage, priceMap, simulatedTime, betSizing]);

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const checklistItemsOut: ChecklistItem[] = checklistItems.map(item => ({
        id: item.id,
        label: item.label,
        required: item.required,
        checked: checked.includes(item.id),
      }));

      const payload: SnapshotPayload = {
        order_kind: isTrade ? orderKind : 'main',
        campaign_mode: 'standalone',
        campaign_id: null,
        campaign_title: null,
        campaign_template: null,
        campaign_leg_role: null,
        campaign_note: null,
        pre_entry_reason: null,
        pre_planned_stop_loss: isHedge || !isTrade ? null : plannedDrawdownPriceForPayload,
        pre_planned_take_profit: null,
        pre_mental_state: mental,
        pre_mental_trigger: null,
        pre_risk_awareness: null,
        pre_risk_management: null,
        pre_checklist_items: isHedge ? [] : (isTrade ? checklistItemsOut : []),
        pre_checklist_passed: isHedge ? true : (isTrade ? checklistPassed : true),
        pre_position_size: isTrade ? inferredPositionSizeUsdt : null,
        pre_max_loss_usdt: !isHedge && isTrade && maxLossValid ? Number(maxLoss.toFixed(2)) : null,
        pre_thesis_why_right: isHedge ? null : whyRight.trim(),
        pre_premortem_failure_reason: isHedge ? null : failureReason.trim(),
        pre_falsification_signal: isHedge ? null : falsificationSignal.trim(),
        pre_confidence_basis: isHedge ? null : (confidenceBasis.trim() || null),
        pre_odds_structure: isHedge || !isTrade ? null : oddsStructure,
        pre_odds_structure_source: isHedge || !isTrade ? null : (oddsStructureSource.trim() || null),
        pre_odds_structure_premortem: isHedge || !isTrade ? null : (oddsStructurePremortem.trim() || null),
        pre_odds_structure_breakdown_signals: isHedge || !isTrade ? null : (oddsStructureBreakdownSignals.trim() || null),
        pre_account_equity_usdt: accountEquity > 0 ? Number(accountEquity.toFixed(2)) : null,
        pre_opportunity_cost_worth: isHedge || !isTrade ? null : oppCostWorth,
        pre_edge_source: isHedge || !isTrade ? null : edgeSource,
        pre_mortem_text: null,
        pre_positive_expectancy: null,
        pre_invalidation_condition: null,
        pre_calibration_win_pct: isHedge ? null : confidencePct,
        pre_confidence_interval_low_pct: null,
        pre_confidence_interval_high_pct: null,
        pre_calibration_reference_class: null,
        pre_calibration_competence_basis: null,
        pre_calibration_update_signal: null,
        pre_dataset_split: null,
        pre_lollapalooza_score: null,
        pre_bankruptcy_estimate: null,
        pre_info_kline_facts: null,
        pre_info_macro_facts: null,
        pre_info_rule_advice: null,
        pre_info_intuition: null,
        pre_info_designer_view: null,
        pre_opponent_statement: null,
        pre_triggered_principle_ids: null,
        pre_triggered_rule_ids: null,
        pre_pain_tags: painTags,
        pre_cognitive_bias_tags: cognitiveBiasTags,
        pre_executor_self: null,
        pre_designer_self: null,
        // 批次 25：对冲专属字段——仅在对冲路径写入，主力单恒为 null。
        hedge_type: isHedge ? hedgeType : null,
        hedge_boundary_price: isHedge && hedgeBoundaryValid ? Number(hedgeBoundary.toFixed(pricePrecision)) : null,
        hedge_boundary_basis: isHedge
          ? buildHedgeBoundaryBasis({
            whyRight: hedgeBoundaryWhyRight,
            failureReason: hedgeBoundaryFailureReason,
            invalidationSignal: hedgeBoundaryInvalidationSignal,
          })
          : null,
        hedge_boundary_stance: isHedge ? hedgeBoundaryStance : null,
        hedge_lock_profit_pct: isHedge && hedgeTypeMeta?.lockProfit && Number.isFinite(Number(hedgeLockProfitPct))
          ? Number(hedgeLockProfitPct)
          : null,
        hedge_resolution_up: isHedge ? (hedgeResolutionUp.trim() || null) : null,
        hedge_down_if_chop: isHedge ? (hedgeDownIfChop.trim() || null) : null,
        hedge_down_if_trend: isHedge ? (hedgeDownIfTrend.trim() || null) : null,
        hedge_down_if_rebound: isHedge ? (hedgeDownIfRebound.trim() || null) : null,
        hedge_resolution_down: null,
        hedge_necessity_pct: isHedge ? hedgeNecessityPct : null,
        hedge_safety_strength: isHedge ? hedgeSafetyStrength : null,
        hedge_safety_regularity: isHedge ? hedgeSafetyRegularity : null,
        hedge_risk_magnitude: isHedge ? hedgeRiskMagnitude : null,
        hedge_conviction_pct: isHedge ? hedgeConvictionPct : null,
        hedge_friction_cost: null,
        hedge_order_method: isHedge ? hedgeOrderMethod : null,
        tp_levels: [],
      };

      await onSubmit(payload);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmBtnClass = mode === 'no_entry'
    ? 'bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black'
    : isHedge
      ? 'bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black'
      : oddsCautionGate
        ? 'bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black'
      : isShort
        ? 'bg-[#F6465D] hover:bg-[#F6465D]/90 text-white'
        : 'bg-[#0ECB81] hover:bg-[#0ECB81]/90 text-black';

  const confirmBtnText = submitting ? '提交中...'
    : mode === 'no_entry' ? '记录决策'
    : isHedge ? '确认对冲并下单'
    : oddsCautionGate ? '空仓观望 / 太难不做' : '确认并下单';

  const labelCls = 'text-[11px] text-muted-foreground';
  const requiredStar = <span className="ml-0.5 text-[#F6465D]">*</span>;
  const inputCls = 'h-9 border-border bg-background text-[12px] text-foreground font-mono';
  const textareaCls = 'min-h-[116px] resize-none border-border bg-background text-[12px] text-foreground leading-relaxed shadow-inner';
  const mainSurfaceCls = 'rounded-xl border border-border/70 bg-card/95 shadow-sm';
  const mainPanelTriggerCls = 'group flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors hover:bg-accent/40';
  const mainSectionTitleCls = 'text-[12px] font-semibold tracking-normal text-foreground';
  const mainSectionHintCls = 'mt-0.5 text-[10px] leading-relaxed text-muted-foreground';
  const mainStatusChipCls = 'inline-flex h-5 items-center rounded-full border border-border/70 bg-background/80 px-2 text-[10px] font-medium text-muted-foreground';
  const hedgeAnchorCardCls = 'flex h-full flex-col rounded-lg border border-border/70 bg-card p-3.5 shadow-none transition-colors';
  const hedgeAnchorHeaderCls = 'min-h-[60px] border-b border-border/40 pb-2';
  const hedgeAnchorButtonBaseCls = 'h-10 rounded-md border text-[12px] font-medium transition-colors';
  const hedgeAnchorButtonIdleCls = 'border-border/60 bg-muted/45 text-muted-foreground hover:border-border hover:bg-muted/70';
  const hedgeAnchorButtonActiveCls = 'border-[#F0B90B]/55 bg-[#F0B90B]/10 text-foreground';
  const hedgeScenarioCardCls = 'block rounded-xl border border-border/70 bg-card/95 p-4 shadow-sm transition-colors';
  const hedgeScenarioTextareaCls = 'mt-3 min-h-[108px] resize-none rounded-lg border-border bg-background/95 text-[12px] leading-relaxed shadow-inner';
  const decisionDoneCount = [
    whyRight.trim().length > 0,
    failureReason.trim().length > 0,
    falsificationSignal.trim().length > 0,
  ].filter(Boolean).length;
  const oddsDoneCount = [
    oddsStructure != null,
    plannedDrawdownPriceValid,
    oddsStructureSource.trim().length > 0,
    oddsStructurePremortem.trim().length > 0,
    oddsStructureBreakdownSignals.trim().length > 0,
  ].filter(Boolean).length;
  const edgeOppDoneCount = [edgeSource != null, oppCostWorth != null].filter(Boolean).length;

  // 心态自评卡片（批次 25：主力单与对冲单共用同一组件，行为一致——≤2 硬阻断）。
  const mentalRatingCard = (
    <div className="rounded-xl border border-border/70 bg-card/95 p-3 shadow-sm">
      <div className={labelCls}>心态自评{requiredStar}</div>
      <div className="mt-2 grid grid-cols-5 gap-1">
        {[1, 2, 3, 4, 5].map(score => (
          <button
            key={score}
            type="button"
            onClick={() => setMental(score as 1 | 2 | 3 | 4 | 5)}
            className={`h-8 rounded text-[12px] font-medium transition-colors ${
              mental === score
                ? 'bg-[#F0B90B] text-black'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {score}
          </button>
        ))}
      </div>
      {mental <= 2 && (
        <div className="mt-2 text-[11px] text-[#F6465D]">
          心态 ≤2 是硬阻断，不能提交快照。
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-[14px] font-medium text-foreground">
          {mode === 'no_entry' ? "记录'该开没开'决策" : '开仓快照'}
        </h2>
        <p className="mt-1 text-[11px] text-muted-foreground font-mono">
          {fmtTime(simulatedTime)} · {symbol} · {directionLabel(direction)}
          {isTrade && lockedEntryPrice ? ` · 入场价 ${lockedEntryPrice.toFixed(pricePrecision)}` : ''}
          {isTrade ? ` · ${currentLeverage}x` : ''}
        </p>
      </div>

      <div className="space-y-4 px-5 py-4">
        {isTrade && (
          <section className="grid gap-2 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setOrderKind('main')}
              className={`rounded border px-3 py-2 text-left transition-colors ${
                orderKind === 'main'
                  ? 'border-foreground bg-foreground/5 text-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-accent'
              }`}
            >
              <div className="text-[12px] font-medium">主力单</div>
              <div className="mt-0.5 text-[10px]">方向性下注</div>
            </button>
            <button
              type="button"
              onClick={() => setOrderKind('hedge')}
              className={`rounded border px-3 py-2 text-left transition-colors ${
                orderKind === 'hedge'
                  ? 'border-[#F0B90B] bg-[#F0B90B]/10 text-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-accent'
              }`}
            >
              <div className="text-[12px] font-medium">对冲单</div>
              <div className="mt-0.5 text-[10px]">防御性头寸</div>
            </button>
          </section>
        )}

        {isHedge && (
          <section className="rounded border border-[#F0B90B]/30 bg-accent/30 px-3 py-2.5">
            <p className="text-[12px] italic leading-relaxed text-foreground">
              对冲不是下注，是把“未知、不可控的无限风险”，换成“已知、可衡量的极小摩擦成本”。
            </p>
          </section>
        )}

        {isTrade && (
          <section className="rounded-xl border border-border/70 bg-card/95 p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={labelCls}>仓位模式{requiredStar}</div>
                <div className={`mt-1 text-[13px] font-medium ${crossBlocked ? 'text-[#F6465D]' : 'text-[#0ECB81]'}`}>
                  {currentMarginMode === 'isolated' ? '逐仓' : '全仓'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSymbolMarginMode(symbol, 'isolated')}
                className="h-8 rounded bg-[#0ECB81] px-3 text-[12px] font-medium text-black transition-colors hover:bg-[#0ECB81]/90"
              >
                切换逐仓
              </button>
            </div>
            {crossBlocked && (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-[#F6465D]">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>全仓是硬阻断；训练阶段只能使用逐仓。</span>
              </div>
            )}
          </section>
        )}

        {!isHedge && (
          <>
            {isTrade && (
              <section className={`${mainSurfaceCls} overflow-hidden`}>
                <div className="flex items-start justify-between gap-3 border-b border-border/60 px-3.5 py-3">
                  <div className="min-w-0">
                    <div className={mainSectionTitleCls}>源头 · 机会成本{requiredStar}</div>
                    <div className={mainSectionHintCls}>
                      先判断这一单靠什么机制赚钱：顺势、突破，还是均值回归。这里只识别 edge 来源，不判断是否值得下注。
                    </div>
                  </div>
                  <span className={mainStatusChipCls}>{edgeOppDoneCount}/2</span>
                </div>
                <div className="space-y-3 px-3.5 py-3">
                  <div>
                    <div className="mb-1.5 text-[11px] font-medium text-foreground">这一单的 edge 来自哪种市场机制？</div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {EDGE_SOURCE_OPTIONS.map(opt => {
                        const active = edgeSource === opt.id;
                        const warn = opt.isWarning;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setEdgeSource(opt.id)}
                            className={`min-h-[66px] rounded-xl border px-3 py-2 text-left transition-colors ${
                              active
                                ? warn
                                  ? 'border-[#F6465D]/70 bg-[#F6465D]/10 text-foreground shadow-sm'
                                  : 'border-[#F0B90B]/70 bg-[#F0B90B]/10 text-foreground shadow-sm'
                                : 'border-border/70 bg-background/80 text-muted-foreground hover:border-border hover:bg-accent/70'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold">{opt.label}</span>
                              {active && (
                                <span className={`h-1.5 w-1.5 rounded-full ${warn ? 'bg-[#F6465D]' : 'bg-[#F0B90B]'}`} />
                              )}
                            </div>
                            <div className="mt-1 text-[10px] leading-relaxed">{opt.description}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <div className="text-[12px] font-medium text-foreground">
                      不做更亏吗？是在浪费机会吗？
                    </div>
                    <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                      「否」或「说不清」都说明这单没有足够机会成本优势，默认视为「小机会仓位」。
                    </div>
                    <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => setOppCostAnswer('worth_it')}
                        className={`min-h-[44px] rounded-lg border px-2 text-[12px] font-medium transition-colors ${
                          oppCostAnswer === 'worth_it'
                            ? 'border-[#0ECB81]/60 bg-[#0ECB81]/10 text-[#0ECB81]'
                            : 'border-border/70 bg-background/80 text-muted-foreground hover:border-border hover:bg-accent/70'
                        }`}
                      >
                        是 · 不做更亏
                      </button>
                      <button
                        type="button"
                        onClick={() => setOppCostAnswer('not_worth_it')}
                        className={`min-h-[44px] rounded-lg border px-2 text-[12px] font-medium transition-colors ${
                          oppCostAnswer === 'not_worth_it'
                            ? 'border-[#F6465D]/60 bg-[#F6465D]/10 text-[#F6465D]'
                            : 'border-border/70 bg-background/80 text-muted-foreground hover:border-border hover:bg-accent/70'
                        }`}
                      >
                        否 · 不做也不亏
                      </button>
                      <button
                        type="button"
                        onClick={() => setOppCostAnswer('unclear')}
                        className={`min-h-[44px] rounded-lg border px-2 text-[12px] font-medium transition-colors ${
                          oppCostAnswer === 'unclear'
                            ? 'border-[#F0B90B]/60 bg-[#F0B90B]/10 text-[#D89B00]'
                            : 'border-border/70 bg-background/80 text-muted-foreground hover:border-border hover:bg-accent/70'
                        }`}
                      >
                        说不清 / 凭感觉
                      </button>
                    </div>
                    {oppCostWorth === false && (
                      <div className="mt-2 rounded-xl border border-[#F0B90B]/40 bg-[#F0B90B]/10 px-3 py-2 text-[11px] leading-relaxed text-[#D89B00]">
                        {oppCostAnswer === 'unclear'
                          ? '说不清 / 凭感觉 → 小机会仓位。没有可解释的机会成本优势，就不要用行动力去填补模糊感。系统默认建议空仓观望；仍要下单会进入二次确认。'
                          : '小机会仓位警告：它占用行动力，比空仓更差。系统默认建议空仓观望；仍要下单会进入二次确认。'}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {isTrade && (
              <section className={`${mainSurfaceCls} overflow-hidden`}>
                <div className="flex items-start justify-between gap-3 border-b border-border/60 px-3.5 py-3">
                  <div className="min-w-0">
                    <div className={mainSectionTitleCls}>① 盈亏比轴 | 选择目标{requiredStar}</div>
                    <div className={mainSectionHintCls}>
                      再判断这个 edge 现在处于什么价格结构：未释放、胶着，还是已过度释放。这里只判断下注质量。
                    </div>
                  </div>
                  <span className={mainStatusChipCls}>{oddsDoneCount}/5</span>
                </div>
                <div className="space-y-3 px-3.5 py-3">
                  <div className="grid gap-2 lg:grid-cols-3">
                    {ODDS_STRUCTURE_OPTIONS.map(option => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setOddsStructure(option.id);
                          if (option.id !== 'with_crowd_released') setConfirmBadOddsTradeOpen(false);
                        }}
                        className={`min-h-[92px] rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          oddsStructure === option.id
                            ? 'border-[#F0B90B]/70 bg-[#F0B90B]/10 text-foreground shadow-sm'
                            : 'border-border/70 bg-background/80 text-muted-foreground hover:border-border hover:bg-accent/70'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] font-semibold">{option.label}</div>
                          {oddsStructure === option.id && (
                            <span className="h-1.5 w-1.5 rounded-full bg-[#F0B90B]" />
                          )}
                        </div>
                        <div className="mt-1.5 text-[10px] leading-relaxed">{option.description}</div>
                      </button>
                    ))}
                  </div>

                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-foreground">R 回撤滑条 · 成本分母效应{requiredStar}</div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          手动输入预期最大回撤价格，系统自动换算 R 占成本价的比例；做多应低于成本价，做空应高于成本价。
                        </div>
                      </div>
                      <div className="shrink-0 text-right font-mono">
                        <div className={`text-[15px] font-semibold ${rDrawdownPct != null ? 'text-[#F0B90B]' : 'text-muted-foreground'}`}>
                          {rDrawdownPct != null ? `${rDrawdownPct.toFixed(1)}%` : '—'}
                        </div>
                        <div className="text-[10px] text-muted-foreground">R / 成本</div>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-[1fr_170px]">
                      <label className="block">
                        <div className="text-[10px] font-medium text-muted-foreground">预期最大回撤价格</div>
                        <Input
                          value={plannedDrawdownPriceInput}
                          onChange={event => setPlannedDrawdownPriceInput(event.target.value)}
                          placeholder={lockedEntryPrice
                            ? (isShort
                              ? (lockedEntryPrice * 1.03).toFixed(pricePrecision)
                              : (lockedEntryPrice * 0.97).toFixed(pricePrecision))
                            : '结构失效价'}
                          inputMode="decimal"
                          className={`${inputCls} mt-1.5`}
                        />
                      </label>
                      <div className="rounded-lg border border-border/60 bg-card/70 px-3 py-2">
                        <div className="text-[10px] text-muted-foreground">成本价</div>
                        <div className="mt-1 font-mono text-[13px] font-semibold text-foreground">
                          {lockedEntryPrice != null ? lockedEntryPrice.toFixed(pricePrecision) : '—'}
                        </div>
                        <div className="mt-0.5 text-[9px] text-muted-foreground">
                          {isShort ? '做空：回撤价高于成本' : '做多：回撤价低于成本'}
                        </div>
                      </div>
                    </div>
                    {plannedDrawdownPriceProvided && !plannedDrawdownPriceValid && (
                      <div className="mt-2 rounded-lg border border-[#F6465D]/30 bg-[#F6465D]/5 px-2.5 py-2 text-[10px] leading-relaxed text-[#F6465D]">
                        回撤价格必须在亏损方向：做多低于成本价，做空高于成本价。
                      </div>
                    )}
                    <div className="relative mt-4 px-1 pb-6">
                      <Slider
                        value={[rDrawdownPctForSlider]}
                        min={R_DRAWDOWN_MIN_PCT}
                        max={R_DRAWDOWN_MAX_PCT}
                        step={R_DRAWDOWN_STEP_PCT}
                        disabled={!lockedEntryPrice}
                        onValueChange={([value]) => updatePlannedDrawdownFromPct(value ?? R_DRAWDOWN_MIN_PCT)}
                      />
                      <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
                        <span>{R_DRAWDOWN_MIN_PCT.toFixed(1)}%</span>
                        <span>{R_DRAWDOWN_MAX_PCT.toFixed(0)}%</span>
                      </div>
                    </div>
                    {rDrawdownPct != null && rRecoveryPct != null && rRecoveryRatio != null && (
                      <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                        <div className="flex items-start justify-between gap-3 text-[10px] text-muted-foreground">
                          <span className="font-medium text-foreground">回撤非对称 · 分母效应</span>
                          {Number.isFinite(rRecoveryPct) ? (
                            <span className="text-right font-mono text-[#F0B90B]">
                              亏 {rDrawdownPct.toFixed(1)}% 后，回本要 +{rRecoveryPct.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-right font-mono text-[#F6465D]">几乎无法回本</span>
                          )}
                        </div>
                        <div className="mt-3 grid gap-2">
                          <div className="grid grid-cols-[50px_1fr_64px] items-center gap-2">
                            <span className="text-[9px] text-[#F6465D]">下坠</span>
                            <div className="h-3 overflow-hidden rounded-full bg-background shadow-inner">
                              <div
                                className="h-full rounded-full bg-[#F6465D]"
                                style={{ width: `${rDrawdownVisualWidth}%` }}
                              />
                            </div>
                            <span className="text-right font-mono text-[9px] text-[#F6465D]">-{rDrawdownPct.toFixed(1)}%</span>
                          </div>
                          <div className="grid grid-cols-[50px_1fr_64px] items-center gap-2">
                            <span className="text-[9px] text-[#0ECB81]">爬回</span>
                            <div className="h-3 overflow-hidden rounded-full bg-background shadow-inner">
                              <div
                                className="h-full rounded-full bg-[#0ECB81]"
                                style={{ width: `${rRecoveryVisualWidth}%` }}
                              />
                            </div>
                            <span className="text-right font-mono text-[9px] text-[#0ECB81]">
                              {rFiniteRecoveryPct != null ? `+${rFiniteRecoveryPct.toFixed(1)}%` : '+∞'}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-1 text-center font-mono text-[9px]">
                          <div className="rounded-md border border-border/50 bg-background px-2 py-1">
                            <div className="text-muted-foreground">成本</div>
                            <div className="text-foreground">100</div>
                          </div>
                          <div className="h-px flex-1 bg-[#F6465D]/40" />
                          <div className="rounded-md border border-[#F6465D]/30 bg-[#F6465D]/5 px-2 py-1">
                            <div className="text-[#F6465D]">回撤后</div>
                            <div className="text-[#F6465D]">{rAfterDrawdownBasePct != null ? rAfterDrawdownBasePct.toFixed(1) : '—'}</div>
                          </div>
                          <div className="h-px flex-1 bg-[#0ECB81]/40" />
                          <div className="rounded-md border border-[#0ECB81]/30 bg-[#0ECB81]/5 px-2 py-1">
                            <div className="text-[#0ECB81]">回到成本</div>
                            <div className="text-[#0ECB81]">100</div>
                          </div>
                        </div>
                        {Number.isFinite(rRecoveryRatio) && (
                          <div className="mt-2 rounded-md bg-background/70 px-2 py-1 text-[9px] leading-relaxed text-muted-foreground">
                            分母变小后，回本路程是下坠的 <span className="font-mono text-[#F0B90B]">{rRecoveryRatio.toFixed(2)}×</span>。
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-foreground">盈亏比滑条</div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">预期盈利 / 预期亏损；1:1 是需要特别确认的基准线。</div>
                      </div>
                      <div className="shrink-0 text-right font-mono">
                        <div className="text-[15px] font-semibold text-[#F0B90B]">{formatOddsRatio(oddsRatioEstimate)}:1</div>
                        <div className="text-[10px] text-muted-foreground">盈 / 亏</div>
                      </div>
                    </div>
                    <div className="relative mt-4 px-1 pb-6">
                      <Slider
                        value={[oddsRatioEstimate]}
                        min={ODDS_RATIO_MIN}
                        max={ODDS_RATIO_MAX}
                        step={ODDS_RATIO_STEP}
                        onValueChange={([value]) => {
                          const next = Math.min(ODDS_RATIO_MAX, Math.max(ODDS_RATIO_MIN, value ?? DEFAULT_PAYOFF_RATIO));
                          setOddsRatioEstimate(Number(next.toFixed(1)));
                        }}
                      />
                      <div
                        className="pointer-events-none absolute top-5 flex -translate-x-1/2 flex-col items-center gap-0.5"
                        style={{ left: `${ODDS_RATIO_BREAK_EVEN_PCT}%` }}
                      >
                        <span className="h-2 border-l border-[#F6465D]/70" />
                        <span className="rounded bg-background px-1 font-mono text-[10px] text-[#F6465D]">1:1</span>
                      </div>
                      <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
                        <span>{formatOddsRatio(ODDS_RATIO_MIN)}:1</span>
                        <span>{formatOddsRatio(ODDS_RATIO_MAX)}:1</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid items-stretch gap-2 md:grid-cols-3">
                    {[
                      {
                        index: 1,
                        title: '这笔的盈亏比结构来自哪？',
                        hint: '人性与市场错配',
                        value: oddsStructureSource,
                        onChange: setOddsStructureSource,
                        placeholder: '人性：谁在恐慌/狂热；市场：什么错配。说不清＝没有高盈亏比，只是赌。',
                      },
                      {
                        index: 2,
                        title: '如果这个结构判断错了，最可能的原因是什么？',
                        hint: '结构预演',
                        value: oddsStructurePremortem,
                        onChange: setOddsStructurePremortem,
                        placeholder: '写清楚你可能误判了谁的情绪、哪段趋势/震荡周期，或哪里其实已经释放。',
                      },
                      {
                        index: 3,
                        title: '哪些具体信号出现，意味着这个结构破坏了？',
                        hint: '客观破坏信号',
                        value: oddsStructureBreakdownSignals,
                        onChange: setOddsStructureBreakdownSignals,
                        placeholder: '写可被盘面验证的结构破坏信号，而不是主观感觉。',
                      },
                    ].map(q => {
                      const filled = q.value.trim().length > 0;
                      return (
                        <label
                          key={q.index}
                          className="group flex h-full min-h-[236px] flex-col rounded-xl border bg-background/80 p-3 shadow-sm transition-colors"
                          style={{
                            borderColor: filled ? '#F0B90B' : 'hsl(var(--border))',
                            background: filled ? '#F0B90B0A' : undefined,
                          }}
                        >
                          <div className="mb-2.5 flex min-h-[46px] items-start gap-2.5">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F0B90B] text-[11px] font-bold text-black">
                              {q.index}
                            </span>
                            <div className="min-w-0">
                              <div className="text-[12px] font-medium leading-snug text-foreground">{q.title}</div>
                              <div className="text-[10px] leading-snug text-muted-foreground">{q.hint}</div>
                            </div>
                          </div>
                          <Textarea
                            value={q.value}
                            onChange={event => q.onChange(event.target.value)}
                            placeholder={q.placeholder}
                            className={`${textareaCls} min-h-[128px] flex-1 bg-background/95`}
                          />
                          <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                            <span className="inline-flex h-4 items-center rounded bg-[#F0B90B]/10 px-1.5 text-[9px] font-medium text-[#D89B00]">
                              结构
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                {oddsStructure === 'with_crowd_released' && (
                  <div className="rounded-xl border border-[#F0B90B]/40 bg-[#F0B90B]/10 px-3 py-2 text-[11px] leading-relaxed text-[#D89B00]">
                    稳固坏结构：向量已经释放，导致向下空间太大。盈亏比是筛子，这一笔默认该弃；空仓是选择，不是失败。
                  </div>
                )}
                {oddsStructure === 'neutral_choppy' && (
                  <div className="rounded-xl border border-[#F0B90B]/40 bg-[#F0B90B]/10 px-3 py-2 text-[11px] leading-relaxed text-[#D89B00]">
                    持有小机会仓位警告：在震荡里开仓＝持有小机会仓位，比空仓更差。它占行动力，让你在大机会来时犹豫，错过后还会心理懈怠。空仓观望是推荐默认。
                  </div>
                )}
                {oddsStructure === 'neutral_choppy' && weakeningMainPerformance && (
                  <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
                    近期实现 R 或胜率走弱：市场越差，筛子越紧；中性震荡里更该挑，默认空仓观望。
                  </div>
                )}
                {oddsStructure === 'against_crowd_unreleased' && weakeningMainPerformance && (
                  <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
                    近期实现 R 或胜率走弱：即使是逆拥挤，也只做结构来源说得清的纯净机会；来源含糊时先空仓。
                  </div>
                )}
                {!oddsStructureReady && (
                  <div className="text-[10px] font-mono text-[#F6465D]">必须先完成三态单选、R 回撤价与盈亏比结构三问。</div>
                )}
                </div>
              </section>
            )}

            <section className={`${isTrade ? mainSurfaceCls : ''} ${isTrade ? 'p-3.5' : ''}`}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className={isTrade ? mainSectionTitleCls : 'text-[12px] font-medium text-foreground'}>
                    {isTrade ? '② 胜率轴 | 校准你的判断（不是去挑高胜率的单）' : "决策三问"}
                    {requiredStar}
                  </div>
                  <div className={isTrade ? mainSectionHintCls : 'mt-0.5 text-[10px] text-muted-foreground'}>
                    {isTrade
                      ? '决策三问只问方向：正、反、止。胜率只用于事后校准。'
                      : '记录这次“该开没开”的当时判断，后续复盘时用来校准遗漏机会。'}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  {isTrade && <span className={mainStatusChipCls}>{decisionDoneCount}/3</span>}
                  {DECISION_QUESTIONS.map(q => {
                    const done = (
                      q.id === 'why' ? whyRight.trim().length > 0
                        : q.id === 'premortem' ? failureReason.trim().length > 0
                        : falsificationSignal.trim().length > 0
                    );
                    return (
                      <span
                        key={q.id}
                        className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold transition-colors ${
                          done ? 'text-black' : 'text-muted-foreground'
                        }`}
                        style={{ background: done ? q.accent : 'hsl(var(--muted))' }}
                      >
                        {q.index}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="grid items-stretch gap-2 md:grid-cols-3">
                {DECISION_QUESTIONS.map(q => {
                  const value = (
                    q.id === 'why' ? whyRight
                      : q.id === 'premortem' ? failureReason
                      : falsificationSignal
                  );
                  const onChange = (v: string) => {
                    if (q.id === 'why') setWhyRight(v);
                    else if (q.id === 'premortem') setFailureReason(v);
                    else setFalsificationSignal(v);
                  };
                  const filled = value.trim().length > 0;
                  return (
                    <label
                      key={q.id}
                      className="group flex h-full min-h-[236px] flex-col rounded-xl border bg-background/80 p-3 shadow-sm transition-colors"
                      style={{
                        borderColor: filled ? q.accent : 'hsl(var(--border))',
                        background: filled ? `${q.accent}0A` : undefined,
                      }}
                    >
                      <div className="mb-2.5 flex min-h-[46px] items-start gap-2.5">
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-black"
                          style={{ background: q.accent }}
                        >
                          {q.index}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[12px] font-medium leading-snug text-foreground">
                            {q.title}
                          </div>
                          <div className="text-[10px] text-muted-foreground leading-snug">{q.hint}</div>
                        </div>
                      </div>
                      <Textarea
                        value={value}
                        onChange={event => onChange(event.target.value)}
                        placeholder={q.placeholder}
                        className={`${textareaCls} min-h-[128px] flex-1 bg-background/95`}
                      />
                      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span
                          className="inline-flex h-4 items-center rounded px-1.5 text-[9px] font-medium"
                          style={{ background: `${q.accent}1A`, color: q.accent }}
                        >
                          {q.badgeText}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </section>

            {isTrade && (
              <Collapsible className={`${mainSurfaceCls} overflow-hidden`}>
                <CollapsibleTrigger className={mainPanelTriggerCls}>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-foreground">胜率校准</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">滑块与芒格折扣默认收起，只记录你的判断刻度。</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right font-mono leading-tight">
                      <div className="text-[12px] text-[#0ECB81]">对 {confidencePct}%</div>
                      <div className="text-[12px] text-[#F6465D]">错 {100 - confidencePct}%</div>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t border-border/60 px-3.5 py-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                        <span>会对</span><span>{confidencePct}%</span>
                      </div>
                      <Slider value={[confidencePct]} min={0} max={100} step={1} onValueChange={([v]) => setConfidencePct(clampProbability(v ?? 50))} />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                        <span>会错</span><span>{100 - confidencePct}%</span>
                      </div>
                      <Slider value={[100 - confidencePct]} min={0} max={100} step={1} onValueChange={([v]) => setConfidencePct(100 - clampProbability(v ?? 50))} />
                    </div>
                  </div>
                  <Input
                    value={confidenceBasis}
                    onChange={event => setConfidenceBasis(event.target.value)}
                    placeholder="我为什么有资格给这个置信度？"
                    className={`${inputCls} mt-3`}
                  />
                  <div className="mt-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2.5">
                    <div className="text-[11px] font-medium text-foreground">芒格折扣 · 置信度安全边际</div>
                    <div className="mt-1 text-[12px] text-foreground">
                      {discount.source === 'personalized'
                        ? `你的输入：${confidencePct}% → 按你的历史校准，真实可能：${discount.discountedPct}%`
                        : `你的输入：${confidencePct}% → 折扣后真实可能：${discount.discountedPct}%`}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {discount.source === 'personalized'
                        ? `基于你过去 ${discount.sampleSize} 笔相近置信度交易的实际胜率`
                        : '主观置信度系统性偏高约 15 个百分点（Tetlock）。积累 10 笔以上相近交易后，此处将改用你的个人校准。'}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            <section className="grid gap-3 md:grid-cols-[1fr_170px]">
              {isTrade && (
                <label className={`block ${mainSurfaceCls} p-3`}>
                  <div className={labelCls}>本次愿意承受最大亏损 USDT{requiredStar}</div>
                  <Input
                    value={maxLossInput}
                    onChange={event => setMaxLossInput(event.target.value)}
                    placeholder="例如 300"
                    inputMode="decimal"
                    className={`${inputCls} mt-2`}
                  />
                  <div className={`mt-2 text-[12px] font-medium ${riskTone(maxLossPct)}`}>
                    占总账户 {maxLossPctLabel}
                    {maxLossPct != null && maxLossPct > 10 ? ' · 本笔风险偏高，请确认' : ''}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    当前账户净值估算 {accountEquity > 0 ? accountEquity.toFixed(2) : '—'} USDT
                  </div>
                  {maxLossPct != null && recoveryPct != null && recoveryRatio != null && (
                    <div className="mt-2.5 rounded-xl border border-border/60 bg-background/60 p-3">
                      <div className="flex items-start justify-between gap-3 text-[10px] text-muted-foreground">
                        <span className="font-medium text-foreground">回撤的非对称</span>
                        {Number.isFinite(recoveryPct) ? (
                          <span className="text-right font-mono text-[#F0B90B]">亏 {maxLossPct.toFixed(1)}% 后，回本要爬 +{recoveryPct.toFixed(1)}%</span>
                        ) : (
                          <span className="text-right font-mono text-[#F6465D]">几乎无法回本</span>
                        )}
                      </div>
                      <div className="mt-3 rounded-lg border border-border/50 bg-muted/20 p-2.5">
                        <div className="grid grid-cols-[42px_1fr_58px] items-center gap-2">
                          <span className="text-[9px] text-[#F6465D]">下坠</span>
                          <div className="h-3 overflow-hidden rounded-full bg-background shadow-inner">
                            <div
                              className="h-full rounded-full bg-[#F6465D]"
                              style={{ width: `${drawdownVisualWidth}%` }}
                            />
                          </div>
                          <span className="text-right font-mono text-[9px] text-[#F6465D]">-{maxLossPct.toFixed(1)}%</span>
                        </div>
                        <div className="mt-2 grid grid-cols-[42px_1fr_58px] items-center gap-2">
                          <span className="text-[9px] text-[#0ECB81]">爬回</span>
                          <div className="h-3 overflow-hidden rounded-full bg-background shadow-inner">
                            <div
                              className="h-full rounded-full bg-[#0ECB81]"
                              style={{ width: `${recoveryVisualWidth}%` }}
                            />
                          </div>
                          <span className="text-right font-mono text-[9px] text-[#0ECB81]">
                            {finiteRecoveryPct != null ? `+${finiteRecoveryPct.toFixed(1)}%` : '+∞'}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-1 text-center font-mono text-[9px]">
                          <div className="rounded-md border border-border/50 bg-background px-2 py-1">
                            <div className="text-muted-foreground">初始</div>
                            <div className="text-foreground">100</div>
                          </div>
                          <div className="h-px flex-1 bg-[#F6465D]/40" />
                          <div className="rounded-md border border-[#F6465D]/30 bg-[#F6465D]/5 px-2 py-1">
                            <div className="text-[#F6465D]">低点</div>
                            <div className="text-[#F6465D]">{afterLossEquityPct != null ? afterLossEquityPct.toFixed(1) : '—'}</div>
                          </div>
                          <div className="h-px flex-1 bg-[#0ECB81]/40" />
                          <div className="rounded-md border border-[#0ECB81]/30 bg-[#0ECB81]/5 px-2 py-1">
                            <div className="text-[#0ECB81]">回本</div>
                            <div className="text-[#0ECB81]">100</div>
                          </div>
                        </div>
                        {Number.isFinite(recoveryRatio) && (
                          <div className="mt-2 rounded-md bg-background/70 px-2 py-1 text-[9px] leading-relaxed text-muted-foreground">
                            同一把尺：回本路程是下坠的 <span className="font-mono text-[#F0B90B]">{recoveryRatio.toFixed(2)}×</span>。
                          </div>
                        )}
                      </div>
                      <div className="mt-1.5 text-[9px] leading-relaxed text-muted-foreground">
                        亏掉的要用更大的涨幅才能赚回来，越深越难（-50% 要 +100%，-90% 要 +900%）。
                      </div>
                    </div>
                  )}
                </label>
              )}

              {mentalRatingCard}
            </section>

            {isTrade && betSizing && (
              <Collapsible className={`${mainSurfaceCls} overflow-hidden`}>
                <CollapsibleTrigger className={mainPanelTriggerCls}>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-foreground">下注规模 · 毁灭概率封顶</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">小错误不断，大错误不犯；展开可看期望值公式与上限来源。</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right font-mono leading-tight">
                      <div className={`text-[12px] ${expectedValueTone}`}>E {formatSigned(betSizing.expectedR)}R</div>
                      <div className={`text-[10px] ${
                        betSizing.verdict === 'no_edge' ? 'text-[#F6465D]' : 'text-muted-foreground'
                      }`}>
                        {betSizing.verdict === 'no_edge' ? '无正期望' : `上限 ${betSizing.recommendedMaxLossUsdt.toFixed(0)} USDT`}
                      </div>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t border-border/60 px-3.5 py-3">
                  <div className={`mb-3 rounded-xl border px-3 py-2.5 ${
                    betSizing.expectedR > 0
                      ? 'border-[#0ECB81]/40 bg-[#0ECB81]/10'
                      : betSizing.expectedR < 0
                        ? 'border-[#F6465D]/40 bg-[#F6465D]/10'
                        : 'border-border/70 bg-background/70'
                  }`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium text-foreground">具体期望值</div>
                        <div className="mt-1 font-mono text-[12px] text-foreground">
                          E = {(sizingWinProb * 100).toFixed(0)}% × {betSizing.payoffRatio.toFixed(2)}
                          {' − '}
                          {(100 - sizingWinProb * 100).toFixed(0)}% = {formatSigned(betSizing.expectedR)}R
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          盈亏平衡胜率 {(betSizing.breakEvenWinRate * 100).toFixed(1)}%；
                          {betSizing.expectedUsdtAtPlanned == null
                            ? '填入最大亏损后可折算 USDT 期望。'
                            : `按本次最大亏损 ${maxLoss.toFixed(0)} USDT，单笔期望 ${formatSigned(betSizing.expectedUsdtAtPlanned, 0)} USDT。`}
                        </div>
                      </div>
                      <div className={`shrink-0 rounded-full px-2 py-1 font-mono text-[11px] ${expectedValueTone}`}>
                        {formatSigned(betSizing.expectedR)}R
                      </div>
                    </div>
                  </div>
                {betSizing.verdict === 'no_edge' ? (
                  <div className="rounded-xl border border-[#F6465D]/40 bg-[#F6465D]/10 px-3 py-2 text-[12px] text-[#F6465D]">
                    按当前用于定仓位的胜率 {(sizingWinProb * 100).toFixed(0)}% 与盈亏比 {betSizing.payoffRatio.toFixed(2)}，期望值 {formatSigned(betSizing.expectedR)}R，这单没有正期望优势 → 不该下注。
                    只在赔率明显被错误定价时才出手。
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[11px] text-muted-foreground">建议单笔最大亏损 ≤</span>
                      <span className="font-mono text-[13px] text-[#0ECB81]">{betSizing.recommendedMaxLossUsdt.toFixed(0)} USDT</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      取小：半 Kelly {betSizing.halfKellyMaxLossUsdt.toFixed(0)} · 毁灭概率封顶 {betSizing.ruinCapMaxLossUsdt.toFixed(0)}
                      （封顶后破产概率 ≈ {(betSizing.ruinProbabilityAtRecommended * 100).toFixed(0)}/100 笔）
                    </div>
                    {betSizing.ruinProbabilityAtPlanned != null && (() => {
                      const tone = betSizing.verdict === 'over_ruin_cap'
                        ? { box: 'border-[#F6465D]/40 bg-[#F6465D]/10', text: 'text-[#F6465D]' }
                        : betSizing.verdict === 'over_kelly'
                          ? { box: 'border-[#F0B90B]/40 bg-[#F0B90B]/10', text: 'text-[#D89B00]' }
                          : { box: 'border-[#0ECB81]/40 bg-[#0ECB81]/10', text: 'text-[#0ECB81]' };
                      const note = betSizing.verdict === 'over_ruin_cap'
                        ? `已超毁灭概率封顶 — 这是用信心而非毁灭概率定仓位，建议下调到 ${betSizing.recommendedMaxLossUsdt.toFixed(0)} USDT。`
                        : betSizing.verdict === 'over_kelly'
                          ? `略高于半 Kelly 上限，可考虑下调到 ${betSizing.recommendedMaxLossUsdt.toFixed(0)} USDT。`
                          : '在建议上限内。';
                      return (
                        <div className={`rounded-xl border px-3 py-2 text-[12px] ${tone.box} ${tone.text}`}>
                          你的计划 {maxLoss.toFixed(0)} USDT → 连打 100 笔约破产 {(betSizing.ruinProbabilityAtPlanned * 100).toFixed(0)} 次。{note}
                        </div>
                      );
                    })()}
                    <div className="text-[10px] text-muted-foreground">
                      胜率：
                      {campaignWinRatePct != null
                        ? `战役历史 ${campaignWinRatePct}%（${campaignSizingStats.winRateSampleCount} 笔已结束战役）`
                        : `当前折扣后 ${discount.discountedPct}%（战役样本不足，原值 ${confidencePct}%）`}
                      {' '}· 盈亏比：
                      {campaignSizingStats.payoffRatio != null
                        ? `战役历史 ${payoffRatio.toFixed(2)}（盈 ${campaignSizingStats.payoffWinCount} / 亏 ${campaignSizingStats.payoffLossCount}）`
                        : `本次滑条 ${payoffRatio.toFixed(2)}（战役盈亏样本不足）`}
                    </div>
                    {profitUpsideAdvice && (
                      <div className="rounded-xl border border-[#0ECB81]/40 bg-[#0ECB81]/10 px-3 py-2 text-[12px] text-[#0ECB81]">
                        <div className="font-medium">{profitUpsideAdvice.title}</div>
                        <div className="mt-0.5 text-[11px] leading-relaxed text-foreground/80">
                          {profitUpsideAdvice.detail}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                </CollapsibleContent>
              </Collapsible>
            )}

            {isTrade && positionFeedback.signals.length > 0 && (
              <Collapsible className={`${mainSurfaceCls} overflow-hidden`}>
                <CollapsibleTrigger className={mainPanelTriggerCls}>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-foreground">持仓反馈体检</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">与现有持仓、近期平仓对照。</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={mainStatusChipCls}>{positionFeedback.signals.length} 条</span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t border-border/60 px-3.5 py-3">
                <div className="space-y-1.5">
                  {positionFeedback.signals.map(sig => {
                    const tone = polarityTone(sig.polarity);
                    return (
                      <div key={sig.kind} className={`rounded-xl border px-3 py-2 ${tone.box}`}>
                        <div className={`text-[12px] font-medium ${tone.text}`}>{sig.title}</div>
                        <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{sig.detail}</div>
                      </div>
                    );
                  })}
                </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}

        {isHedge && (
          <>
            <section className="rounded-lg border border-[#F0B90B]/25 bg-card p-3.5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[12px] font-medium text-foreground">问一 · 这是哪一类对冲？{requiredStar}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    先给这份保险定类别，再谈边界和大小。
                  </div>
                </div>
                {hedgeTypeMeta && (
                  <div className="rounded-full bg-[#F0B90B]/12 px-2 py-1 text-[10px] font-medium text-[#F0B90B]">
                    已选 {hedgeTypeMeta.label}
                  </div>
                )}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {HEDGE_TYPES.map(type => {
                  const selected = hedgeType === type.id;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => selectHedgeType(type.id)}
                      className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                        selected
                          ? 'border-[#F0B90B] bg-[#F0B90B]/10 text-foreground'
                          : 'border-border bg-background text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      <div className="text-[12px] font-medium">{type.label}</div>
                      <div className="mt-1 text-[10px] leading-relaxed">{type.sub}</div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-3.5 shadow-sm">
              <div className="text-[12px] font-medium text-foreground">问二 · 边界划在哪、比例多少？{requiredStar}</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="block">
                  <div className={labelCls}>边界价{requiredStar}</div>
                  <Input
                    value={hedgeBoundaryPrice}
                    onChange={event => setHedgeBoundaryPrice(event.target.value)}
                    inputMode="decimal"
                    className={`${inputCls} mt-2`}
                  />
                </label>
                <div className="grid gap-3 md:col-span-2 md:grid-cols-3">
                  <label className="block rounded-lg border border-border/70 bg-background/70 p-3">
                    <div className="text-[11px] font-medium text-foreground">正 · 边界为什么会对？</div>
                    <Textarea
                      value={hedgeBoundaryWhyRight}
                      onChange={event => setHedgeBoundaryWhyRight(event.target.value)}
                      className={`${textareaCls} mt-2 min-h-[92px] bg-background`}
                    />
                  </label>
                  <label className="block rounded-lg border border-border/70 bg-background/70 p-3">
                    <div className="text-[11px] font-medium text-foreground">反 · 如果错，原因是什么？</div>
                    <Textarea
                      value={hedgeBoundaryFailureReason}
                      onChange={event => setHedgeBoundaryFailureReason(event.target.value)}
                      className={`${textareaCls} mt-2 min-h-[92px] bg-background`}
                    />
                  </label>
                  <label className="block rounded-lg border border-border/70 bg-background/70 p-3">
                    <div className="text-[11px] font-medium text-foreground">止 · 什么信号出现就意味着不再对了？</div>
                    <Textarea
                      value={hedgeBoundaryInvalidationSignal}
                      onChange={event => setHedgeBoundaryInvalidationSignal(event.target.value)}
                      className={`${textareaCls} mt-2 min-h-[92px] bg-background`}
                    />
                  </label>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/70 p-3 md:col-span-2">
                  <div className={labelCls}>相对“机会=风险”的交叉点，你这条线放在哪？</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {([
                      ['early', '偏早', '机会还略大于风险，我就让出（我有别的机会）'],
                      ['at_crossover', '大致在交叉点', '机会与风险大致打平时，对冲开始接管'],
                      ['late', '偏晚', '风险已经盖过机会，但我舍不得走'],
                    ] as const).map(([value, label, desc]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setHedgeBoundaryStance(value)}
                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                          hedgeBoundaryStance === value
                            ? 'border-[#F0B90B] bg-[#F0B90B]/10 text-foreground'
                            : 'border-border bg-card text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        <div className="text-[11px] font-medium">{label}</div>
                        <div className="mt-0.5 text-[10px] leading-relaxed">{desc}</div>
                      </button>
                    ))}
                  </div>
                  {hedgeBoundaryStance === 'late' && (
                    <div className="mt-2 text-[10px] text-[#D89B00]">
                      偏晚是机会匮乏者的打法。确认这是计划，不是舍不得？
                    </div>
                  )}
                </div>
                {hedgeTypeMeta?.lockProfit && (
                  <label className="block md:col-span-2">
                    <div className={labelCls}>锁定的最低微利 %{requiredStar}</div>
                    <Input
                      value={hedgeLockProfitPct}
                      onChange={event => setHedgeLockProfitPct(event.target.value)}
                      inputMode="decimal"
                      className={`${inputCls} mt-2 max-w-[220px]`}
                    />
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      默认 4，确保总仓位回撤后仍有 3–5% 微利。
                    </div>
                  </label>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-3.5 shadow-sm">
              <div className="text-[12px] font-medium text-foreground">问三 · 向上怎么办、向下怎么办？{requiredStar}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                在还不知道往哪破的此刻就写死两边，到时候照着执行，而不是临场即兴。
              </div>
              <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                <label className="block rounded-xl border border-border/70 bg-background/70 p-4 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-5 items-center rounded-full border border-[#0ECB81]/30 bg-[#0ECB81]/10 px-2 text-[10px] font-medium text-[#0ECB81]">
                      向上
                    </span>
                    <div className="text-[11px] font-semibold text-foreground">向上预案{requiredStar}</div>
                  </div>
                  <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                    这一支保持单字段，处理“继续顺势”的情况。
                  </div>
                  <Textarea
                    value={hedgeResolutionUp}
                    onChange={event => setHedgeResolutionUp(event.target.value)}
                    placeholder={hedgeTypeMeta?.resolutionUpDefault ?? '先选择对冲类型'}
                    className={`${textareaCls} mt-3 min-h-[142px] rounded-lg bg-background/95 shadow-inner`}
                  />
                </label>
                <div className="rounded-xl border border-[#F0B90B]/20 bg-[linear-gradient(180deg,rgba(240,185,11,0.10),rgba(240,185,11,0.04))] p-4 shadow-sm">
                  <div className="inline-flex h-5 items-center rounded-full border border-[#F0B90B]/30 bg-[#F0B90B]/10 px-2 text-[10px] font-medium text-[#D89B00]">
                    触发后先观察
                  </div>
                  <div className="mt-2 text-[13px] font-semibold leading-6 text-foreground">
                    对冲触发不是决定，是“开始观察”的信号。
                  </div>
                  <div className="mt-2 text-[11px] leading-6 text-foreground/85">
                    下一个信号会告诉你走哪一支。现在就把三支都写死，到时候照着读，别临场即兴。
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-2 text-[10px] leading-5 text-muted-foreground">
                      无信号
                      <div className="mt-0.5 font-medium text-foreground">震荡</div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-2 text-[10px] leading-5 text-muted-foreground">
                      反向信号
                      <div className="mt-0.5 font-medium text-foreground">确认下行</div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-2 text-[10px] leading-5 text-muted-foreground">
                      正向增强
                      <div className="mt-0.5 font-medium text-foreground">快速反弹</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-border/60 bg-background/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-semibold tracking-[0.01em] text-foreground">向下触发后的三种情境</div>
                    <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      这是重点。先识别触发后出现的是哪一种信号，再执行对应脚本。
                    </div>
                  </div>
                  <div className="inline-flex h-6 items-center rounded-full border border-[#F0B90B]/25 bg-[#F0B90B]/8 px-2.5 text-[10px] font-medium text-[#D89B00]">
                    三支都建议预先写死
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <label className={`${hedgeScenarioCardCls} border-l-4 border-l-border`}>
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background text-[12px] font-semibold text-foreground">
                        ①
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-foreground">若触发后转为【震荡】</div>
                        <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                          没确认下跌，也没强反弹。先把区间内的拆法写清楚。
                        </div>
                      </div>
                    </div>
                    <Textarea
                      value={hedgeDownIfChop}
                      onChange={event => setHedgeDownIfChop(event.target.value)}
                      className={hedgeScenarioTextareaCls}
                    />
                  </label>
                  <label className={`${hedgeScenarioCardCls} border-l-4 border-l-[#F6465D]/60`}>
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#F6465D]/25 bg-[#F6465D]/10 text-[12px] font-semibold text-[#F6465D]">
                        ②
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-foreground">若触发后【确认下行】</div>
                        <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                          异常反向信号已出现。这里写离场、双平或转防守的脚本。
                        </div>
                      </div>
                    </div>
                    <Textarea
                      value={hedgeDownIfTrend}
                      onChange={event => setHedgeDownIfTrend(event.target.value)}
                      className={hedgeScenarioTextareaCls}
                    />
                  </label>
                  <label className={`${hedgeScenarioCardCls} border-l-4 border-l-[#0ECB81]/60`}>
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#0ECB81]/25 bg-[#0ECB81]/10 text-[12px] font-semibold text-[#0ECB81]">
                        ③
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-foreground">若触发后【快速反弹】</div>
                        <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                          无反向信号，正向信号反而更强。这里写保留主方向、拆保险的脚本。
                        </div>
                      </div>
                    </div>
                    <Textarea
                      value={hedgeDownIfRebound}
                      onChange={event => setHedgeDownIfRebound(event.target.value)}
                      className={hedgeScenarioTextareaCls}
                    />
                  </label>
                </div>
              </div>
              <div className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                这三支对应三种信号：无信号(震荡) / 反向信号(下行) / 正向信号增强(反弹)。触发后先读信号，再决定走哪一支。
              </div>
              {!hedgeDownBranchesComplete && (
                <div className="mt-2 rounded-lg border border-[#D89B00]/30 bg-[#D89B00]/10 px-3 py-2 text-[10px] leading-relaxed text-[#D89B00]">
                  建议把三支都写满。它们是触发后的条件脚本，不是临场再想的即兴反应。
                </div>
              )}
            </section>

            <section className="rounded-lg border border-border bg-card p-3.5 shadow-sm">
              <div className="text-[12px] font-medium text-foreground">必要性 · 外部先定大小{requiredStar}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                = 尾部风险概率 × 风险绝对值。这份保险兜住的风险期望越大，对冲越该大。最大 = 与主仓等额。
              </div>
              <div className="mt-3 grid items-stretch gap-3 lg:grid-cols-3">
                <div className={hedgeAnchorCardCls}>
                  <div className={hedgeAnchorHeaderCls}>
                    <div className="text-[11px] font-semibold text-foreground">行情强劲程度{requiredStar}</div>
                    <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      越强，尾部风险概率越低。
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-1.5">
                    {[1, 2, 3, 4, 5].map(score => (
                      <button
                        key={`strength-${score}`}
                        type="button"
                        onClick={() => setHedgeSafetyStrength(score as 1 | 2 | 3 | 4 | 5)}
                        className={`${hedgeAnchorButtonBaseCls} ${
                          hedgeSafetyStrength === score
                            ? hedgeAnchorButtonActiveCls
                            : hedgeAnchorButtonIdleCls
                        }`}
                      >
                        {score}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={hedgeAnchorCardCls}>
                  <div className={hedgeAnchorHeaderCls}>
                    <div className="text-[11px] font-semibold text-foreground">历史规则程度{requiredStar}</div>
                    <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      越规则，尾部风险概率越低。
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-1.5">
                    {[1, 2, 3, 4, 5].map(score => (
                      <button
                        key={`regularity-${score}`}
                        type="button"
                        onClick={() => setHedgeSafetyRegularity(score as 1 | 2 | 3 | 4 | 5)}
                        className={`${hedgeAnchorButtonBaseCls} ${
                          hedgeSafetyRegularity === score
                            ? hedgeAnchorButtonActiveCls
                            : hedgeAnchorButtonIdleCls
                        }`}
                      >
                        {score}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={hedgeAnchorCardCls}>
                  <div className={hedgeAnchorHeaderCls}>
                    <div className="text-[11px] font-semibold text-foreground">下行烈度 / 跳空风险{requiredStar}</div>
                    <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      一旦反向，它能多猛？妖币能瞬间天地针给 5，低波动主流给 1。
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-1.5">
                    {[1, 2, 3, 4, 5].map(score => (
                      <button
                        key={`magnitude-${score}`}
                        type="button"
                        onClick={() => setHedgeRiskMagnitude(score as 1 | 2 | 3 | 4 | 5)}
                        className={`${hedgeAnchorButtonBaseCls} ${
                          hedgeRiskMagnitude === score
                            ? hedgeAnchorButtonActiveCls
                            : hedgeAnchorButtonIdleCls
                        }`}
                      >
                        {score}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-border/70 bg-background/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-medium text-foreground">对冲必要性 / 占主仓比例{requiredStar}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      = 尾部风险概率 × 风险绝对值，0%–100%，硬顶 100%。
                    </div>
                  </div>
                  <div className="font-mono text-[16px] text-[#F0B90B]">{hedgeNecessityPct == null ? '—' : `${hedgeNecessityValue}%`}</div>
                </div>
                <div className="relative mt-4">
                  {necessitySuggestion && (
                    <div
                      className="pointer-events-none absolute -top-3 z-10 flex -translate-x-1/2 flex-col items-center"
                      style={{ left: `${necessitySuggestion.suggested}%` }}
                    >
                      <span className="rounded-full bg-[#F0B90B]/12 px-1.5 py-0.5 text-[9px] font-mono text-[#F0B90B]">
                        建议 {necessitySuggestion.suggested}%
                      </span>
                      <span className="mt-1 h-4 border-l border-[#F0B90B]/60" />
                    </div>
                  )}
                  <Slider
                    value={[hedgeNecessityValue]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={([value]) => setHedgeNecessityPct(Math.min(100, clampProbability(value ?? 0)))}
                  />
                </div>
                <div className="mt-3 text-[10px] text-muted-foreground">
                  {necessitySuggestion
                    ? '按“概率×烈度”算出，并按“宁可多对冲”+15 偏移。可采纳或覆盖。'
                    : '先给上面的三个客观锚点打分，系统再给出幽灵建议值。'}
                </div>
                {hedgeConsistencyHint && (
                  <div className="mt-3 rounded border border-[#F0B90B]/35 bg-[#F0B90B]/10 px-3 py-2 text-[11px] text-[#D89B00]">
                    {hedgeConsistencyHint}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-3.5 shadow-sm">
              <div className="text-[12px] font-medium text-foreground">把握性 · 内部只定成色{requiredStar}</div>
              <div className="mt-0.5 text-[10px] whitespace-pre-line text-muted-foreground">
                这里不是“市场会不会按我想的走”，而是“我对必要性这个估计（尾部概率 × 烈度）有多确定”。
                是冷静算出来的，还是被行情吓出来高估的？
              </div>
              <div className="mt-4 rounded-lg border border-border/70 bg-background/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-medium text-foreground">把握性 · 我多确定“这个风险估计”是对的</div>
                  <div className="font-mono text-[16px] text-[#F0B90B]">{hedgeConvictionPct == null ? '—' : `${hedgeConvictionValue}%`}</div>
                </div>
                <div className="mt-3">
                  <Slider
                    value={[hedgeConvictionValue]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={([value]) => setHedgeConvictionPct(clampProbability(value ?? 0))}
                  />
                </div>
                <div className="mt-3 rounded border border-border/70 bg-card px-3 py-2.5">
                  <div className="text-[11px] font-medium text-foreground">芒格折扣 · 对冲校准</div>
                  <div className="mt-1 text-[12px] text-foreground">
                    你的输入：{hedgeConvictionValue}% → 折扣后真实可能：{hedgeDiscount.discountedPct}%
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {hedgeDiscount.source === 'personalized'
                      ? `基于你过去 ${hedgeDiscount.sampleSize} 笔已平仓对冲的“值回成本”记录`
                      : '对冲样本不足 10 笔时，默认先做 -15% 谦逊折扣。折扣只显示，不写入数据库。'}
                  </div>
                </div>
              </div>
              <div className="mt-3 text-[10px] text-muted-foreground">
                低把握性意味着你对这个风险估计没底。在不对称原则下，没底是更该保护，而不是更少保护。
              </div>
              {hedgePanic && (
                <div className="mt-3 rounded border border-[#F0B90B]/45 bg-[#F0B90B]/12 px-3 py-2.5 text-[12px] leading-relaxed text-[#D89B00]">
                  你对“必要性这个估计”自己都没底，却下了重手。这是计划内的纪律，还是被行情吓出来高估了风险？
                </div>
              )}
            </section>

            <section className="grid gap-3 lg:grid-cols-[1fr_200px]">
              <div className="rounded-lg border border-border bg-card p-3.5 shadow-sm">
                <div className="text-[12px] font-medium text-foreground">下单方式</div>
                <div className="mt-3">
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(Object.entries(HEDGE_ORDER_METHOD_LABELS) as [HedgeOrderMethod, string][]).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setHedgeOrderMethod(value)}
                        className={`inline-flex h-8 items-center rounded-full border px-3 text-[11px] transition-colors ${
                          hedgeOrderMethod === value
                            ? 'border-[#F0B90B] bg-[#F0B90B]/10 text-[#F0B90B]'
                            : 'border-border bg-background text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {hedgeOrderMethod === 'market_chase' && (
                    <div className="mt-2 text-[10px] text-[#D89B00]">
                      市价追多半是慌，预挂才是纪律。
                    </div>
                  )}
                </div>
              </div>

              {mentalRatingCard}
            </section>
          </>
        )}

        <Collapsible className={`${mainSurfaceCls} overflow-hidden`}>
          <CollapsibleTrigger className={mainPanelTriggerCls}>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-foreground">当前情绪标签</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">可选项，展开后按正向 / 中性 / 负向打标。</div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className={mainStatusChipCls}>已选 {painTags.length}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t border-border/60 px-3.5 py-3">
          <TooltipProvider delayDuration={150}>
            <div className="space-y-2">
              {EMOTION_GROUPS.map(group => {
                const selectedCount = group.tags.filter(tag => painTags.includes(tag)).length;
                return (
                  <Collapsible key={group.valence}>
                    <div className="rounded-lg border border-border/70 bg-card/80 shadow-sm">
                      <CollapsibleTrigger
                        className="group flex w-full items-start justify-between gap-3 px-3 py-3 text-left"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ background: group.accent }}
                            />
                            <span className="text-[11px] font-medium text-foreground">{group.title}</span>
                            <span className="text-[10px] text-muted-foreground">· {group.ruleImpact}</span>
                          </div>
                          <div className="mt-1 border-l-2 pl-2 text-[10px] italic leading-snug text-muted-foreground" style={{ borderColor: group.accent }}>
                            {group.systemPrompt}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-[10px] font-mono text-muted-foreground">
                            已选 {selectedCount}
                          </span>
                          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="px-3 pb-3">
                        <div className="flex flex-wrap gap-2">
                          {group.tags.map(tag => {
                            const meta = EMOTION_TAG_META[tag];
                            const selected = painTags.includes(tag);
                            return (
                              <Tooltip key={tag}>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => togglePainTag(tag)}
                                    className="inline-flex min-h-8 items-center rounded-full border px-2.5 py-1 text-[11px] leading-none transition-colors"
                                    style={{
                                      borderColor: selected ? group.accent : 'hsl(var(--border))',
                                      background: selected ? `${group.accent}1F` : undefined,
                                      color: selected ? group.accent : 'hsl(var(--muted-foreground))',
                                    }}
                                  >
                                    {meta.label}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="bottom"
                                  align="start"
                                  collisionPadding={12}
                                  className="w-[min(320px,calc(100vw-24px))] border-border bg-popover p-3 shadow-xl"
                                >
                                  <div className="space-y-1">
                                    <div className="text-[11px] font-medium" style={{ color: group.accent }}>
                                      {meta.label}
                                    </div>
                                    <div className="text-[11px] leading-snug text-popover-foreground">
                                      <span className="text-muted-foreground">核心含义：</span>{meta.coreMeaning}
                                    </div>
                                    <div className="text-[11px] leading-snug text-popover-foreground">
                                      <span className="text-muted-foreground">可能导致的行为倾向：</span>{meta.behaviorTendency}
                                    </div>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          </TooltipProvider>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible className={`${mainSurfaceCls} overflow-hidden`}>
          <CollapsibleTrigger className={mainPanelTriggerCls}>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-foreground">认知偏差自查</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">可选项，展开后按信息 / 逻辑 / 行动检查。</div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className={mainStatusChipCls}>已选 {cognitiveBiasTags.length}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t border-border/60 px-3.5 py-3">
          <TooltipProvider delayDuration={150}>
            <div className="space-y-2">
              {COGNITIVE_BIAS_GROUPS.map(group => {
                const selectedCount = group.tags.filter(tag => cognitiveBiasTags.includes(tag)).length;
                return (
                  <Collapsible key={group.category}>
                    <div className="rounded-lg border border-border/70 bg-card/80 shadow-sm">
                      <CollapsibleTrigger
                        className="group flex w-full items-start justify-between gap-3 px-3 py-3 text-left"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ background: group.accent }}
                            />
                            <span className="text-[11px] font-medium text-foreground">{group.title}</span>
                            <span className="text-[10px] text-muted-foreground">· {group.oneLiner}</span>
                          </div>
                          <div className="mt-1 border-l-2 pl-2 text-[10px] italic leading-snug text-muted-foreground" style={{ borderColor: group.accent }}>
                            {group.systemPrompt}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-[10px] font-mono text-muted-foreground">
                            已选 {selectedCount}
                          </span>
                          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="px-3 pb-3">
                        <div className="flex flex-wrap gap-2">
                          {group.tags.map(tag => {
                            const meta = COGNITIVE_BIAS_META[tag];
                            const selected = cognitiveBiasTags.includes(tag);
                            return (
                              <Tooltip key={tag}>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => toggleCognitiveBiasTag(tag)}
                                    className="inline-flex min-h-8 items-center rounded-full border px-2.5 py-1 text-[11px] leading-none transition-colors"
                                    style={{
                                      borderColor: selected ? group.accent : 'hsl(var(--border))',
                                      background: selected ? `${group.accent}1F` : undefined,
                                      color: selected ? group.accent : 'hsl(var(--muted-foreground))',
                                    }}
                                  >
                                    {meta.label}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="bottom"
                                  align="start"
                                  collisionPadding={12}
                                  className="w-[min(320px,calc(100vw-24px))] border-border bg-popover p-3 shadow-xl"
                                >
                                  <div className="space-y-1">
                                    <div className="text-[11px] font-medium" style={{ color: group.accent }}>
                                      {meta.label}
                                    </div>
                                    <div className="text-[11px] leading-snug text-popover-foreground">
                                      <span className="text-muted-foreground">核心含义：</span>{meta.coreMeaning}
                                    </div>
                                    <div className="text-[11px] leading-snug text-popover-foreground">
                                      <span className="text-muted-foreground">典型交易危害：</span>{meta.tradingHarm}
                                    </div>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          </TooltipProvider>
          </CollapsibleContent>
        </Collapsible>

        {!isHedge && isTrade && (
          <section className={`${mainSurfaceCls} p-3`}>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[12px] font-semibold text-foreground">开仓 Checklist{requiredStar}</div>
              <div className={mainStatusChipCls}>
                必填 {requiredCount}/{requiredTotal} · 可选 {optionalCount}/{optionalNeed}
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {checklistItems.map(item => (
                <label
                  key={item.id}
                  className="flex min-h-[36px] items-center gap-2 rounded-lg border border-border/60 bg-background/80 px-2.5 py-1.5 text-[12px]"
                >
                  <Checkbox
                    checked={checked.includes(item.id)}
                    onCheckedChange={value => toggleChecklist(item.id, Boolean(value))}
                  />
                  <span className="flex-1 leading-snug">
                    {item.label}
                    {item.required && <span className="ml-1 text-[10px] text-[#F0B90B]">必填</span>}
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded px-3 text-[12px] text-muted-foreground transition-colors hover:bg-accent"
        >
          取消
        </button>
        <div className="flex items-center gap-2">
          {isTrade && !oddsCautionGate && (
            <button
              type="button"
              onClick={() => {
                setConfirmBadOddsTradeOpen(false);
                onTooHard?.({
                  order_kind: orderKind,
                  pre_planned_stop_loss: isHedge ? null : plannedDrawdownPriceForPayload,
                  pre_odds_structure: isHedge ? null : oddsStructure,
                  pre_odds_structure_source: isHedge ? null : (oddsStructureSource.trim() || null),
                  pre_odds_structure_premortem: isHedge ? null : (oddsStructurePremortem.trim() || null),
                  pre_odds_structure_breakdown_signals: isHedge ? null : (oddsStructureBreakdownSignals.trim() || null),
                  pre_opportunity_cost_worth: isHedge ? null : oppCostWorth,
                  pre_edge_source: isHedge ? null : edgeSource,
                });
              }}
              disabled={submitting}
              className="h-9 rounded border border-[#F0B90B]/40 px-4 text-[12px] font-medium text-[#F0B90B] transition-colors hover:bg-[#F0B90B]/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              空仓观望 / 太难不做
            </button>
          )}
          {oddsCautionGate && (
            <button
              type="button"
              onClick={() => setConfirmBadOddsTradeOpen(true)}
              disabled={!canSubmit || submitting}
              className="h-9 rounded border border-border px-4 text-[12px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              仍要下单
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (oddsCautionGate) {
                setConfirmBadOddsTradeOpen(false);
                onTooHard?.({
                  order_kind: orderKind,
                  pre_planned_stop_loss: isHedge ? null : plannedDrawdownPriceForPayload,
                  pre_odds_structure: isHedge ? null : oddsStructure,
                  pre_odds_structure_source: isHedge ? null : (oddsStructureSource.trim() || null),
                  pre_odds_structure_premortem: isHedge ? null : (oddsStructurePremortem.trim() || null),
                  pre_odds_structure_breakdown_signals: isHedge ? null : (oddsStructureBreakdownSignals.trim() || null),
                  pre_opportunity_cost_worth: isHedge ? null : oppCostWorth,
                  pre_edge_source: isHedge ? null : edgeSource,
                });
                return;
              }
              void submit();
            }}
            disabled={oddsCautionGate ? submitting : (!canSubmit || submitting)}
            className={`h-9 rounded px-4 text-[12px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40 ${confirmBtnClass}`}
          >
            {confirmBtnText}
          </button>
        </div>
      </div>
      <AlertDialog open={confirmBadOddsTradeOpen} onOpenChange={setConfirmBadOddsTradeOpen}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[14px] text-foreground">仍要下这一笔？</AlertDialogTitle>
            <AlertDialogDescription className="text-[11px] leading-relaxed text-muted-foreground">
              {badOddsGate
                ? '你已经把这笔判定为“顺情绪 / 追价”的坏结构。系统默认建议空仓观望；如果仍要下，等于明确接受这不是高盈亏比，而是在逆着筛子强行出手。'
                : smallOpportunityGate
                  ? '你已经把这笔判定为“中性震荡”。在震荡里开仓＝持有小机会仓位，比空仓更差；如果仍要下，等于明确接受行动力被占用、未来大机会时更容易犹豫。'
                  : oppCostAnswer === 'unclear'
                    ? '你刚才回答：说不清 / 凭感觉。这意味着这一笔没有可解释的机会成本优势——典型的小机会仓位，比空仓更差；如果仍要下，等于明确接受用行动力去换一个模糊机会。'
                    : '你刚才回答：不做的机会成本并不更高。这意味着这一笔本质是在填补无聊——典型的小机会仓位，比空仓更差；如果仍要下，等于明确接受用行动力去换一个你自己都说不值得的机会。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border border-[#F0B90B]/35 bg-[#F0B90B]/10 px-3 py-2 text-[11px] leading-relaxed text-[#D89B00]">
            空仓是选择，不是失败。这里是二次确认，不是硬阻断；确认后仍按原主力单流程提交。
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border bg-background text-[12px] text-foreground hover:bg-accent">
              返回弃单
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void submit()}
              className="bg-[#F6465D] text-[12px] text-white hover:bg-[#F6465D]/90"
            >
              确认，仍要下单
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
