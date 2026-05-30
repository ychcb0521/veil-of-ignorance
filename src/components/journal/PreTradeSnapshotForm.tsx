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
import { PAIN_TAG_LABELS } from '@/types/journal';
import { buildChecklist, isChecklistPassed } from '@/lib/defaultChecklist';
import { listRules } from '@/lib/journalApi';
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
  TradeDirection,
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
  onSubmit: (payload: SnapshotPayload) => Promise<void> | void;
}

const PAIN_TAG_ORDER = Object.keys(PAIN_TAG_LABELS) as PainTag[];

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
  const [confidencePct, setConfidencePct] = useState(50);
  const [confidenceBasis, setConfidenceBasis] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const [userRules, setUserRules] = useState<TradingRule[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const isHedge = isTrade && orderKind === 'hedge';
  const currentLeverage = getSymbolLeverage(symbol) ?? leverage;
  const currentMarginMode = getSymbolMarginMode(symbol) ?? 'cross';
  const crossBlocked = isTrade && currentMarginMode !== 'isolated';

  useEffect(() => {
    if (!user || !isTrade) return;
    listRules(user.id).then(setUserRules).catch(() => setUserRules([]));
  }, [user, isTrade]);

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
          <div className={`${labelCls} mb-2`}>决策三问{requiredStar}</div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <div className="mb-1 text-[12px] font-medium">这笔为什么会对？</div>
              <Textarea
                value={whyRight}
                onChange={event => setWhyRight(event.target.value)}
                placeholder="结构、量能、宏观、规则一起说，不分多框。"
                className={textareaCls}
              />
            </label>
            <label className="block">
              <div className="mb-1 text-[12px] font-medium">假设这笔亏完，最可能的原因是什么？</div>
              <Textarea
                value={failureReason}
                onChange={event => setFailureReason(event.target.value)}
                placeholder="Munger inversion——先想清楚怎么输，才有资格谈怎么赢。"
                className={textareaCls}
              />
            </label>
            <label className="block">
              <div className="mb-1 text-[12px] font-medium">什么 K 线/盘面信号会让你提前止损或拆仓？</div>
              <Textarea
                value={falsificationSignal}
                onChange={event => setFalsificationSignal(event.target.value)}
                placeholder="把证伪点写成可被盘面客观验证的事件。"
                className={textareaCls}
              />
            </label>
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

        <section>
          <div className={`${labelCls} mb-2`}>当前痛苦/情绪标签</div>
          <div className="flex flex-wrap gap-2">
            {PAIN_TAG_ORDER.map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => togglePainTag(tag)}
                className={`h-8 rounded border px-3 text-[12px] transition-colors ${
                  painTags.includes(tag)
                    ? 'border-[#F0B90B] bg-[#F0B90B]/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent'
                }`}
              >
                {PAIN_TAG_LABELS[tag]}
              </button>
            ))}
          </div>
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
  );
}
