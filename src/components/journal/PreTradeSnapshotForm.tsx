/**
 * 开仓快照表单 — 批次 23 精简版
 * 新快照只录入会直接改变决策质量的字段；旧列保留但不再在 UI 中填写。
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  COGNITIVE_BIAS_CATEGORIES,
  COGNITIVE_BIAS_META,
  type CognitiveBiasCategory,
  type CognitiveBiasMeta,
  type CognitiveBiasTagId,
} from '@/lib/cognitiveBiasTags';
import { computeDiscount } from '@/lib/confidenceDiscount';
import {
  computeBetSizing,
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
  LegRole,
  OrderKind,
  PainTag,
  StrategyTemplate,
  TradeCampaign,
  TradeDirection,
  TradeJournal,
  TradingRule,
} from '@/types/journal';

export type SnapshotMode = 'trade' | 'no_entry';

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
  pre_account_equity_usdt: number | null;
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
  onTooHard?: (draft: { order_kind: OrderKind }) => void;
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
    title: '什么 K 线 / 盘面信号会让你提前止损或拆仓？',
    hint: '证伪点：必须可被盘面客观验证',
    placeholder: '写成具体事件，例如「跌破 4h 关键支撑且 1h 量能放大」。',
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
  const [checked, setChecked] = useState<string[]>([]);
  const [userRules, setUserRules] = useState<TradingRule[]>([]);
  const [historicalJournals, setHistoricalJournals] = useState<TradeJournal[]>([]);
  const [historicalCampaigns, setHistoricalCampaigns] = useState<TradeCampaign[]>([]);
  const [submitting, setSubmitting] = useState(false);

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

  const maxLoss = Number(maxLossInput);
  const maxLossValid = Number.isFinite(maxLoss) && maxLoss > 0;
  const maxLossPct = maxLossValid && accountEquity > 0 ? (maxLoss / accountEquity) * 100 : null;
  const maxLossPctLabel = maxLossPct == null ? '—' : `${maxLossPct.toFixed(1)}%`;

  const decisionReady = whyRight.trim().length > 0
    && failureReason.trim().length > 0
    && falsificationSignal.trim().length > 0;
  const mentalReady = mental >= 3;
  const tradeReady = !isTrade || (
    currentMarginMode === 'isolated'
    && maxLossValid
    && checklistPassed
  );
  const canSubmit = decisionReady && mentalReady && tradeReady;

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

  // 下注规模 · 毁灭概率封顶（批次 25）— 胜率与盈亏比改用战役口径，绝不写库，仅显示。
  const campaignSizingStats = useMemo(
    () => estimateCampaignSizingStats(historicalCampaigns),
    [historicalCampaigns],
  );
  const campaignWinRatePct = campaignSizingStats.winRate == null
    ? null
    : Number((campaignSizingStats.winRate * 100).toFixed(0));
  const sizingWinProb = campaignSizingStats.winRate ?? (discount.discountedPct / 100);
  const payoffRatio = campaignSizingStats.payoffRatio ?? DEFAULT_PAYOFF_RATIO;
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
      proposedLeverage: leverage,
      markPrice: priceMap[symbol] ?? null,
      positions,
      recentCloses,
      nowMs: simulatedTime.getTime(),
    });
  }, [direction, positionsMap, symbol, historicalJournals, leverage, priceMap, simulatedTime]);

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
        pre_planned_stop_loss: null,
        pre_planned_take_profit: null,
        pre_mental_state: mental,
        pre_mental_trigger: null,
        pre_risk_awareness: null,
        pre_risk_management: null,
        pre_checklist_items: isTrade ? checklistItemsOut : [],
        pre_checklist_passed: isTrade ? checklistPassed : true,
        pre_position_size: isTrade ? inferredPositionSizeUsdt : null,
        pre_max_loss_usdt: isTrade && maxLossValid ? Number(maxLoss.toFixed(2)) : null,
        pre_thesis_why_right: whyRight.trim(),
        pre_premortem_failure_reason: failureReason.trim(),
        pre_falsification_signal: falsificationSignal.trim(),
        pre_confidence_basis: confidenceBasis.trim() || null,
        pre_account_equity_usdt: accountEquity > 0 ? Number(accountEquity.toFixed(2)) : null,
        pre_mortem_text: null,
        pre_positive_expectancy: null,
        pre_invalidation_condition: null,
        pre_calibration_win_pct: confidencePct,
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
      : isShort
        ? 'bg-[#F6465D] hover:bg-[#F6465D]/90 text-white'
        : 'bg-[#0ECB81] hover:bg-[#0ECB81]/90 text-black';

  const confirmBtnText = submitting ? '提交中...'
    : mode === 'no_entry' ? '记录决策'
    : isHedge ? '确认对冲并下单'
    : '确认并下单';

  const labelCls = 'text-[11px] text-muted-foreground';
  const requiredStar = <span className="ml-0.5 text-[#F6465D]">*</span>;
  const inputCls = 'h-9 border-border bg-background text-[12px] text-foreground font-mono';
  const textareaCls = 'min-h-[116px] resize-none border-border bg-background text-[12px] text-foreground leading-relaxed';

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

        {isTrade && (
          <section className="rounded border border-border bg-card p-3">
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

        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <div className="text-[12px] font-medium text-foreground">决策三问{requiredStar}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                正—反—止：用 Munger inversion 把胜与败一起写清楚，三题都必填
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
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
          <div className="grid items-stretch gap-3 md:grid-cols-3">
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
                  className="group flex h-full min-h-[292px] flex-col rounded-lg border bg-card/90 p-3.5 shadow-sm transition-colors"
                  style={{
                    borderColor: filled ? q.accent : 'hsl(var(--border))',
                    background: filled ? `${q.accent}0A` : undefined,
                  }}
                >
                  <div className="mb-3 flex min-h-[48px] items-start gap-2.5">
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
                    className={`${textareaCls} min-h-[170px] flex-1 bg-background/80`}
                  />
                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span
                      className="inline-flex h-4 items-center rounded px-1.5 text-[9px] font-medium"
                      style={{ background: `${q.accent}1A`, color: q.accent }}
                    >
                      {q.badgeText}
                    </span>
                    <span className="font-mono">{value.trim().length} 字</span>
                  </div>
                </label>
              );
            })}
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-[1fr_160px]">
          {isTrade && (
            <label className="block rounded border border-border bg-card p-3">
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
            </label>
          )}

          <div className="rounded border border-border bg-card p-3">
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
        </section>

        {isTrade && betSizing && (
          <section className="rounded-lg border border-border bg-card p-3.5 shadow-sm">
            <div className={labelCls}>下注规模 · 毁灭概率封顶</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              胜率与盈亏比优先使用战役级统计；当前折扣后置信度保留为自我校准镜子，不再用单笔交易样本抬高下注规模。
            </div>
            {betSizing.verdict === 'no_edge' ? (
              <div className="mt-2 rounded border border-[#F6465D]/40 bg-[#F6465D]/10 px-3 py-2 text-[12px] text-[#F6465D]">
                按当前用于定仓位的胜率 {(sizingWinProb * 100).toFixed(0)}% 与盈亏比 {betSizing.payoffRatio.toFixed(2)}，这单没有正期望优势 → 不该下注。
                只在赔率明显被错误定价时才出手。
              </div>
            ) : (
              <div className="mt-2 space-y-2">
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
                    <div className={`rounded border px-3 py-2 text-[12px] ${tone.box} ${tone.text}`}>
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
                    : `默认 ${DEFAULT_PAYOFF_RATIO.toFixed(2)}（战役盈亏样本不足）`}
                </div>
              </div>
            )}
          </section>
        )}

        {isTrade && positionFeedback.signals.length > 0 && (
          <section className="rounded border border-border bg-card p-3">
            <div className={labelCls}>持仓反馈体检</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              把这一单和现有持仓、近期平仓对照 — 负反馈维稳，正反馈顺势。
            </div>
            <div className="mt-2 space-y-1.5">
              {positionFeedback.signals.map(sig => {
                const tone = polarityTone(sig.polarity);
                return (
                  <div key={sig.kind} className={`rounded border px-3 py-2 ${tone.box}`}>
                    <div className={`text-[12px] font-medium ${tone.text}`}>{sig.title}</div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{sig.detail}</div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <div className="text-[12px] font-medium text-foreground">当前情绪标签</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                依然分三类：正向情绪帮助执行规则，负向情绪容易破坏规则，中性情绪本身不一定坏，但需要被校准，否则会滑向失控。可多选，也可全不选；悬停标签可看核心含义与可能导致的行为倾向。
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground">
              已选 <span className="font-mono text-foreground">{painTags.length}</span>
            </div>
          </div>
          <TooltipProvider delayDuration={150}>
            <div className="space-y-2">
              {EMOTION_GROUPS.map(group => (
                <div
                  key={group.valence}
                  className="rounded-lg border border-border/70 bg-card/80 p-3 shadow-sm"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: group.accent }}
                    />
                    <span className="text-[11px] font-medium text-foreground">{group.title}</span>
                    <span className="text-[10px] text-muted-foreground">· {group.ruleImpact}</span>
                  </div>
                  <div
                    className="mb-2.5 border-l-2 pl-2 text-[10px] italic leading-snug text-muted-foreground"
                    style={{ borderColor: group.accent }}
                  >
                    {group.systemPrompt}
                  </div>
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
                </div>
              ))}
            </div>
          </TooltipProvider>
        </section>

        <section>
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <div className="text-[12px] font-medium text-foreground">认知偏差自查</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                按决策的哪个环节出错分三类：看错信息 / 想错逻辑 / 做错动作。情绪你能感觉到，偏差你意识不到，所以更要主动查。悬停标签可看核心含义与典型交易危害。
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground">
              已选 <span className="font-mono text-foreground">{cognitiveBiasTags.length}</span>
            </div>
          </div>
          <TooltipProvider delayDuration={150}>
            <div className="space-y-2">
              {COGNITIVE_BIAS_GROUPS.map(group => (
                <div
                  key={group.category}
                  className="rounded-lg border border-border/70 bg-card/80 p-3 shadow-sm"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: group.accent }}
                    />
                    <span className="text-[11px] font-medium text-foreground">{group.title}</span>
                    <span className="text-[10px] text-muted-foreground">· {group.oneLiner}</span>
                  </div>
                  <div
                    className="mb-2.5 border-l-2 pl-2 text-[10px] italic leading-snug text-muted-foreground"
                    style={{ borderColor: group.accent }}
                  >
                    {group.systemPrompt}
                  </div>
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
                </div>
              ))}
            </div>
          </TooltipProvider>
        </section>

        <section className="rounded border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className={labelCls}>二元预测概率</div>
              <div className="mt-1 text-[12px] text-muted-foreground">移动任一端，另一端自动补足到 100%。</div>
            </div>
            <div className="text-right font-mono">
              <div className="text-[13px] text-[#0ECB81]">对 {confidencePct}%</div>
              <div className="text-[13px] text-[#F6465D]">错 {100 - confidencePct}%</div>
            </div>
          </div>
          <div className="mt-3 space-y-3">
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
            <Input
              value={confidenceBasis}
              onChange={event => setConfidenceBasis(event.target.value)}
              placeholder="我为什么有资格给这个置信度？"
              className={inputCls}
            />
            <div className="rounded border border-border/70 bg-background/70 px-3 py-2.5">
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
          </div>
        </section>

        {isTrade && (
          <section className="rounded border border-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className={labelCls}>开仓 Checklist{requiredStar}</div>
              <div className="text-[11px] text-muted-foreground">
                必填 {requiredCount}/{requiredTotal} · 可选 {optionalCount}/{optionalNeed}
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {checklistItems.map(item => (
                <label
                  key={item.id}
                  className="flex min-h-[36px] items-center gap-2 rounded border border-border/60 bg-background px-2 py-1.5 text-[12px]"
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
          {isTrade && (
            <button
              type="button"
              onClick={() => onTooHard?.({ order_kind: orderKind })}
              disabled={submitting}
              className="h-9 rounded border border-[#F0B90B]/40 px-4 text-[12px] font-medium text-[#F0B90B] transition-colors hover:bg-[#F0B90B]/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              太难，不做这单
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit || submitting}
            className={`h-9 rounded px-4 text-[12px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40 ${confirmBtnClass}`}
          >
            {confirmBtnText}
          </button>
        </div>
      </div>
    </div>
  );
}
