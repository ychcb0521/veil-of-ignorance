/**
 * 开仓快照表单 — 桌面 Dialog 与移动 Sheet 共用
 * 严格按币安 Pro 深色配色（#0B0E11 / #181A20 / #2B3139 / #0ECB81 / #F6465D / #F0B90B）
 */

import { useEffect, useMemo, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { MENTAL_STATE_LABELS } from '@/types/journal';
import { buildChecklist, isChecklistPassed } from '@/lib/defaultChecklist';
import { getCampaignWithLegs, listActiveCampaigns, listRules } from '@/lib/journalApi';
import { LEG_ROLE_LABELS, STRATEGY_TEMPLATES } from '@/lib/strategyTemplates';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import type { PlaceOrderParams } from '@/contexts/TradingContext';
import type {
  ChecklistItem,
  LegRole,
  OrderKind,
  StrategyTemplate,
  TradeCampaign,
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
  pre_entry_reason: string;
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
  tp_levels: TpLevel[];
}

type CampaignOption = TradeCampaign & { legCount: number };

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

const fmtTime = (d: Date) => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
};

const directionLabel = (d: TradeDirection) =>
  d === 'long' ? '做多' : d === 'short' ? '做空' : '未开仓';

const buildDefaultCampaignTitle = (symbol: string, time: Date, direction: TradeDirection) => {
  const date = time.toISOString().slice(0, 10);
  const dir = direction === 'short' ? '做空' : '做多';
  return `${symbol} ${date} ${dir}主战役`;
};

const createRolesForHedge: LegRole[] = ['hedge_initial_a', 'hedge_initial_b', 'mirror_tp', 'hedge_rolling'];
const joinRolesForHedge: LegRole[] = ['hedge_initial_a', 'hedge_initial_b', 'hedge_rolling', 'mirror_tp', 'reentry_hedge'];

export function PreTradeSnapshotForm({
  mode, symbol, direction, simulatedTime, lockedEntryPrice, leverage,
  initialPositionSizeUsdt, pricePrecision, onCancel, onSubmit,
}: Props) {
  const isTrade = mode === 'trade';
  const isShort = direction === 'short';
  const { user } = useAuth();
  const {
    getEffectiveAvailable,
    getSymbolLeverage,
    getSymbolMarginMode,
    setSymbolMarginMode,
  } = useTradingContext();

  const [orderKind, setOrderKind] = useState<OrderKind>('main');
  const isHedge = isTrade && orderKind === 'hedge';
  const showFullFields = isTrade && orderKind === 'main';

  const [reason, setReason] = useState('');
  const [tps, setTps] = useState<TpLevel[]>([{ price: '', pct: '' }]);
  const [posSize, setPosSize] = useState(initialPositionSizeUsdt ? initialPositionSizeUsdt.toFixed(2) : '');
  const [maxLossInput, setMaxLossInput] = useState('');
  const [mental, setMental] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [mentalTrigger, setMentalTrigger] = useState('');
  const [riskAware, setRiskAware] = useState('');
  const [riskManage, setRiskManage] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const [noEntryReason, setNoEntryReason] = useState('');
  const [overrideLowMental, setOverrideLowMental] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [userRules, setUserRules] = useState<TradingRule[]>([]);
  const [activeCampaigns, setActiveCampaigns] = useState<CampaignOption[]>([]);
  const [campaignMode, setCampaignMode] = useState<'create' | 'join' | 'standalone'>('create');
  const [campaignTitle, setCampaignTitle] = useState(() => buildDefaultCampaignTitle(symbol, simulatedTime, direction));
  const [campaignTemplate, setCampaignTemplate] = useState<StrategyTemplate>('main_dual_hedge_mirror_tp');
  const [campaignLegRole, setCampaignLegRole] = useState<LegRole>('main_open');
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [campaignNote, setCampaignNote] = useState('');
  const currentLeverage = getSymbolLeverage(symbol) ?? leverage;
  const currentMarginMode = getSymbolMarginMode(symbol) ?? 'cross';
  const crossBlocked = isTrade && currentMarginMode === 'cross';

  // Load user rules for checklist injection
  useEffect(() => {
    if (!user || !isTrade) return;
    listRules(user.id).then(setUserRules).catch(() => {});
  }, [user, isTrade]);

  useEffect(() => {
    if (!user || !isTrade) {
      setActiveCampaigns([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const campaigns = await listActiveCampaigns(user.id);
        const withCounts = await Promise.all(
          campaigns.map(async campaign => {
            try {
              const details = await getCampaignWithLegs(campaign.id);
              return { ...campaign, legCount: details.legs.length };
            } catch {
              return { ...campaign, legCount: 0 };
            }
          }),
        );
        if (!cancelled) {
          const sorted = withCounts.sort((a, b) => {
            const aMatch = a.symbol === symbol ? 1 : 0;
            const bMatch = b.symbol === symbol ? 1 : 0;
            if (aMatch !== bMatch) return bMatch - aMatch;
            return b.opened_at.localeCompare(a.opened_at);
          });
          setActiveCampaigns(sorted);
        }
      } catch {
        if (!cancelled) setActiveCampaigns([]);
      }
    })();
    return () => { cancelled = true; };
  }, [user, isTrade, symbol]);

  useEffect(() => {
    setCampaignTitle(buildDefaultCampaignTitle(symbol, simulatedTime, direction));
  }, [symbol, simulatedTime, direction]);

  useEffect(() => {
    if (!isTrade) return;
    if (orderKind === 'main') {
      setCampaignMode('create');
      setCampaignLegRole('main_open');
      return;
    }
    if (activeCampaigns.length > 0) {
      setCampaignMode('join');
      setSelectedCampaignId(prev => prev || activeCampaigns[0]?.id || '');
      setCampaignLegRole('hedge_initial_a');
    } else {
      setCampaignMode('create');
      setCampaignLegRole('hedge_initial_a');
    }
  }, [orderKind, activeCampaigns, isTrade]);

  const checklistItems = useMemo(() => buildChecklist(userRules), [userRules]);

  // Reset override when mental state >2
  useEffect(() => {
    if (mental > 2) setOverrideLowMental(false);
  }, [mental]);

  // ===== Derived =====
  const sizeUsdt = parseFloat(posSize) || 0;
  const maxLoss = parseFloat(maxLossInput) || 0;
  const availableBalance = useMemo(() => {
    try { return getEffectiveAvailable(symbol); } catch { return 0; }
  }, [getEffectiveAvailable, symbol]);
  const maxLossPctOfAccount = availableBalance > 0 && maxLoss > 0
    ? (maxLoss / availableBalance) * 100
    : 0;

  const checklistPassed = isChecklistPassed(checked, checklistItems);
  const requiredCount = checklistItems.filter(i => i.required && checked.includes(i.id)).length;
  const requiredTotal = checklistItems.filter(i => i.required).length;
  const optionalCount = checklistItems.filter(i => !i.required && i.source !== 'rule' && checked.includes(i.id)).length;
  const optionalTotal = checklistItems.filter(i => !i.required && i.source !== 'rule').length;

  const tpsValid = useMemo(() => {
    if (!isTrade) return true;
    const filled = tps.filter(t => parseFloat(t.price) > 0);
    if (filled.length === 0) return false;
    const totalPct = filled.reduce((s, t) => s + (parseFloat(t.pct) || (filled.length === 1 ? 100 : 0)), 0);
    return totalPct > 0 && totalPct <= 100;
  }, [tps, isTrade]);

  const joinDisabled = activeCampaigns.length === 0;
  const campaignFieldsValid = useMemo(() => {
    if (!isTrade) return true;
    if (campaignMode === 'standalone') return true;
    if (campaignMode === 'create') {
      return campaignTitle.trim().length >= 3 && !!campaignTemplate && !!campaignLegRole;
    }
    if (campaignMode === 'join') {
      return !!selectedCampaignId && !!campaignLegRole;
    }
    return false;
  }, [campaignLegRole, campaignMode, campaignTemplate, campaignTitle, isTrade, selectedCampaignId]);

  // ===== Submit gate =====
  const canSubmit = useMemo(() => {
    if (reason.trim().length < 20) return false;
    if (mental <= 3 && mentalTrigger.trim().length < 10) return false;
    if (mental <= 2 && !overrideLowMental) return false;
    if (mode === 'no_entry') {
      if (riskAware.trim().length < 15) return false;
      if (riskManage.trim().length < 15) return false;
      if (noEntryReason.trim().length < 10) return false;
      return true;
    }
    // trade mode
    if (currentMarginMode !== 'isolated') return false;
    if (!campaignFieldsValid) return false;
    if (isHedge) {
      return true;
    }
    // main order: full requirements
    if (riskAware.trim().length < 15) return false;
    if (riskManage.trim().length < 15) return false;
    if (!tpsValid) return false;
    if (sizeUsdt <= 0) return false;
    if (maxLoss <= 0) return false;
    if (!checklistPassed) return false;
    return true;
  }, [reason, riskAware, riskManage, mental, mentalTrigger, overrideLowMental,
      mode, isHedge, tpsValid, sizeUsdt, maxLoss, checklistPassed, noEntryReason, currentMarginMode, campaignFieldsValid]);

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const checklistItemsOut: ChecklistItem[] = checklistItems.map(d => ({
        id: d.id,
        label: d.label,
        required: d.required,
        checked: checked.includes(d.id),
      }));

      // Primary TP price (first valid level)
      const firstTp = tps.find(t => parseFloat(t.price) > 0);
      const baseMentalTrigger = mode === 'no_entry'
        ? noEntryReason.trim()
        : (mental <= 3 ? mentalTrigger.trim() : null);
      const resolvedCampaignMode = mode === 'no_entry' ? 'standalone' : campaignMode;
      const resolvedLegRole: LegRole | null = mode === 'no_entry'
        ? null
        : campaignMode === 'standalone'
          ? 'standalone'
          : campaignLegRole;
      const baseCampaign = {
        campaign_mode: resolvedCampaignMode,
        campaign_id: campaignMode === 'join' ? selectedCampaignId : null,
        campaign_title: campaignMode === 'create' ? campaignTitle.trim() : null,
        campaign_template: campaignMode === 'create' ? campaignTemplate : null,
        campaign_leg_role: resolvedLegRole,
        campaign_note: campaignMode === 'join' ? (campaignNote.trim() || null) : null,
      } as const;

      const payload: SnapshotPayload = isHedge
        ? {
            ...baseCampaign,
            order_kind: 'hedge',
            pre_entry_reason: reason.trim(),
            pre_planned_stop_loss: null,
            pre_planned_take_profit: null,
            pre_mental_state: mental,
            pre_mental_trigger: baseMentalTrigger,
            pre_risk_awareness: null,
            pre_risk_management: null,
            pre_checklist_items: null,
            pre_checklist_passed: null,
            pre_position_size: initialPositionSizeUsdt ?? (sizeUsdt > 0 ? sizeUsdt : null),
            pre_max_loss_usdt: null,
            tp_levels: [],
          }
        : {
            ...baseCampaign,
            order_kind: mode === 'no_entry' ? 'main' : orderKind,
            pre_entry_reason: reason.trim(),
            pre_planned_stop_loss: null,
            pre_planned_take_profit: isTrade && firstTp ? parseFloat(firstTp.price) : null,
            pre_mental_state: mental,
            pre_mental_trigger: baseMentalTrigger,
            pre_risk_awareness: riskAware.trim(),
            pre_risk_management: riskManage.trim(),
            pre_checklist_items: isTrade ? checklistItemsOut : [],
            pre_checklist_passed: isTrade ? checklistPassed : true,
            pre_position_size: isTrade && sizeUsdt > 0 ? sizeUsdt : null,
            pre_max_loss_usdt: isTrade && maxLoss > 0 ? Number(maxLoss.toFixed(2)) : null,
            tp_levels: isTrade ? tps : [],
          };

      await onSubmit(payload);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleChecklist = (id: string, v: boolean) => {
    setChecked(prev => v ? [...prev, id] : prev.filter(x => x !== id));
  };

  const updateTp = (idx: number, patch: Partial<TpLevel>) => {
    setTps(prev => prev.map((t, i) => i === idx ? { ...t, ...patch } : t));
  };

  const confirmBtnClass = mode === 'no_entry'
    ? 'bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black'
    : isHedge
      ? 'bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black'
      : isShort
        ? 'bg-[#F6465D] hover:bg-[#F6465D]/90 text-white'
        : 'bg-[#0ECB81] hover:bg-[#0ECB81]/90 text-black';

  const confirmBtnText = submitting ? '提交中…'
    : mode === 'no_entry' ? '记录决策'
    : isHedge ? '确认对冲并下单'
    : '确认并下单';

  const labelCls = 'text-[11px] text-muted-foreground';
  const requiredStar = <span className="text-[#F6465D] ml-0.5">*</span>;
  const inputCls = 'bg-background border-border text-[12px] font-mono text-foreground h-9';
  const textareaCls = 'bg-background border-border text-[12px] font-mono text-foreground resize-none';

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-[14px] font-medium text-foreground">
          {mode === 'no_entry' ? "记录'该开没开'决策" : '开仓快照（必填）'}
        </h2>
        <p className="text-[11px] text-muted-foreground font-mono mt-1">
          {fmtTime(simulatedTime)} · {symbol} · {directionLabel(direction)}
          {isTrade && lockedEntryPrice ? ` · 入场价 ${lockedEntryPrice.toFixed(pricePrecision)}` : ''}
          {isTrade ? ` · ${currentLeverage}x` : ''}
        </p>
      </div>

      {/* Form */}
      <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
        {/* (0) Order kind toggle — hidden in no_entry mode */}
        {isTrade && (
          <div className="mt-0 mb-1">
            <div className={`${labelCls} mb-2`}>订单类型{requiredStar}</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOrderKind('main')}
                className={`h-16 rounded border-2 cursor-pointer transition-all text-left p-3 flex flex-col gap-1 justify-center ${
                  orderKind === 'main'
                    ? 'border-foreground bg-foreground/5 text-foreground'
                    : 'border-border bg-card hover:bg-accent'
                }`}
              >
                <div className="text-[12px] font-medium">主力单</div>
                <div className="text-[10px] text-muted-foreground">方向性下注，需完整理由+风控规划</div>
              </button>
              <button
                type="button"
                onClick={() => setOrderKind('hedge')}
                className={`h-16 rounded border-2 cursor-pointer transition-all text-left p-3 flex flex-col gap-1 justify-center ${
                  orderKind === 'hedge'
                    ? 'border-[#F0B90B] bg-[#F0B90B]/10 text-foreground'
                    : 'border-border bg-card hover:bg-accent'
                }`}
              >
                <div className="text-[12px] font-medium">对冲单</div>
                <div className="text-[10px] text-muted-foreground">防御性头寸，简化记录</div>
              </button>
            </div>
            {isHedge && (
              <div className="mt-2 px-3 py-2 bg-muted/30 rounded">
                <div className="text-[11px] text-muted-foreground">
                  {'💡 对冲单使用与主力单相同的杠杆 '}{currentLeverage}x {'—— 同标的的杠杆是系统级共享设置，不可在订单层独立调整。'}
                </div>
              </div>
            )}
          </div>
        )}

        {/* (0.5) Margin mode guard — hidden in no_entry mode */}
        {isTrade && (
          <div className="mt-0 mb-1">
            <div className={`${labelCls} mb-2`}>仓位模式{requiredStar}</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSymbolMarginMode(symbol, 'cross')}
                className={`h-14 rounded border-2 cursor-pointer transition-all text-left p-3 flex flex-col gap-0.5 justify-center ${
                  currentMarginMode === 'cross'
                    ? 'border-[#F6465D] bg-[#F6465D]/10 text-[#F6465D]'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent'
                }`}
              >
                <div className="text-[12px] font-medium">全仓</div>
                <div className="text-[10px]">本系统禁止使用</div>
              </button>
              <button
                type="button"
                onClick={() => setSymbolMarginMode(symbol, 'isolated')}
                className={`h-14 rounded border-2 cursor-pointer transition-all text-left p-3 flex flex-col gap-0.5 justify-center ${
                  currentMarginMode === 'isolated'
                    ? 'border-[#0ECB81] bg-[#0ECB81]/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent'
                }`}
              >
                <div className="text-[12px] font-medium">逐仓</div>
                <div className="text-[10px] text-muted-foreground">每笔风险独立隔离</div>
              </button>
            </div>
            {crossBlocked && (
              <div className="mt-3 bg-[#F6465D]/10 border border-[#F6465D]/30 rounded p-3">
                <div className="flex items-center gap-2 text-[#F6465D] font-medium text-[12px]">
                  <AlertTriangle className="w-4 h-4" />
                  <span>全仓模式被系统拒绝</span>
                </div>
                <div className="mt-2 text-[11px] text-foreground">
                  全仓会让单笔爆仓拖垮整个账户。本系统在训练阶段不允许使用全仓——这是不可绕过的风险预算守卫，不是 UI 提示。
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setSymbolMarginMode(symbol, 'isolated')}
                    className="bg-[#0ECB81] hover:bg-[#0ECB81]/90 text-black h-8 text-[12px] px-3 rounded font-medium transition-colors"
                  >
                    一键切换为逐仓
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {isTrade && (
          <div className="mt-0 mb-1 space-y-2">
            <div className={`${labelCls} mb-2`}>战役归属{requiredStar}</div>
            <div className="text-[10px] text-muted-foreground italic mb-2">
              把这笔归入哪个战役？战役是复盘的高层单位——用于把"主仓 + 对冲 + 滚动调整"的一系列操作绑在一起看。
            </div>

            <button
              type="button"
              onClick={() => {
                setCampaignMode('create');
                setCampaignLegRole(orderKind === 'main' ? 'main_open' : 'hedge_initial_a');
              }}
              className={`w-full rounded border text-left p-3 transition-colors ${
                campaignMode === 'create' ? 'border-[#F0B90B] bg-[#F0B90B]/10' : 'border-border bg-card hover:bg-accent'
              }`}
            >
              <div className="text-[12px] font-medium">新建战役</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">本笔将作为新战役的起点</div>
              {campaignMode === 'create' && (
                <div className="mt-3 space-y-2">
                  <div>
                    <div className={labelCls}>战役标题{requiredStar}</div>
                    <Input
                      value={campaignTitle}
                      onChange={e => setCampaignTitle(e.target.value)}
                      className={`${inputCls} mt-1`}
                    />
                  </div>
                  <div>
                    <div className={labelCls}>策略模板{requiredStar}</div>
                    <select
                      value={campaignTemplate}
                      onChange={e => setCampaignTemplate(e.target.value as StrategyTemplate)}
                      className={`${inputCls} mt-1 w-full rounded-md px-3`}
                    >
                      {Object.entries(STRATEGY_TEMPLATES).map(([key, meta]) => (
                        <option key={key} value={key}>{meta.name}</option>
                      ))}
                    </select>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {STRATEGY_TEMPLATES[campaignTemplate].description}
                    </div>
                  </div>
                  <div>
                    <div className={labelCls}>本笔在战役中的角色{requiredStar}</div>
                    {orderKind === 'main' ? (
                      <Input value={LEG_ROLE_LABELS.main_open} disabled className={`${inputCls} mt-1 opacity-80`} />
                    ) : (
                      <select
                        value={campaignLegRole}
                        onChange={e => setCampaignLegRole(e.target.value as LegRole)}
                        className={`${inputCls} mt-1 w-full rounded-md px-3`}
                      >
                        {createRolesForHedge.map(role => (
                          <option key={role} value={role}>{LEG_ROLE_LABELS[role]}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  {orderKind === 'hedge' && activeCampaigns.length === 0 && (
                    <div className="text-[10px] text-[#F0B90B]">
                      对冲单一般应加入主力战役，请确认这是有意为之。
                    </div>
                  )}
                </div>
              )}
            </button>

            <button
              type="button"
              disabled={joinDisabled}
              onClick={() => {
                if (joinDisabled) return;
                setCampaignMode('join');
                setSelectedCampaignId(prev => prev || activeCampaigns[0]?.id || '');
                setCampaignLegRole(orderKind === 'main' ? 'reentry_main' : 'hedge_initial_a');
              }}
              className={`w-full rounded border text-left p-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                campaignMode === 'join' ? 'border-[#F0B90B] bg-[#F0B90B]/10' : 'border-border bg-card hover:bg-accent'
              }`}
            >
              <div className="text-[12px] font-medium">加入现有战役</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">本笔将作为某个 active 战役的新 leg</div>
              {joinDisabled && (
                <div className="mt-2 text-[10px] text-muted-foreground">当前无任何 active 战役可加入</div>
              )}
              {campaignMode === 'join' && !joinDisabled && (
                <div className="mt-3 space-y-2">
                  <div>
                    <div className={labelCls}>选择战役{requiredStar}</div>
                    <select
                      value={selectedCampaignId}
                      onChange={e => setSelectedCampaignId(e.target.value)}
                      className={`${inputCls} mt-1 w-full rounded-md px-3`}
                    >
                      {activeCampaigns.map(campaign => {
                        const daysAgo = Math.max(0, Math.floor((Date.now() - new Date(campaign.opened_at).getTime()) / 86400000));
                        const prefix = campaign.symbol === symbol ? '★ ' : '';
                        return (
                          <option key={campaign.id} value={campaign.id}>
                            {prefix}{campaign.title} · {daysAgo} 天前 · {campaign.legCount} legs
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <div className={labelCls}>本笔角色{requiredStar}</div>
                    {orderKind === 'main' ? (
                      <Input value={LEG_ROLE_LABELS.reentry_main} disabled className={`${inputCls} mt-1 opacity-80`} />
                    ) : (
                      <select
                        value={campaignLegRole}
                        onChange={e => setCampaignLegRole(e.target.value as LegRole)}
                        className={`${inputCls} mt-1 w-full rounded-md px-3`}
                      >
                        {joinRolesForHedge.map(role => (
                          <option key={role} value={role}>{LEG_ROLE_LABELS[role]}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <div className={labelCls}>附加说明</div>
                    <Textarea
                      rows={2}
                      value={campaignNote}
                      onChange={e => setCampaignNote(e.target.value)}
                      placeholder="例如：取代旧对冲 X；新支撑位 1.32"
                      className={textareaCls}
                    />
                  </div>
                </div>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setCampaignMode('standalone');
                setCampaignLegRole('standalone');
              }}
              className={`w-full rounded border text-left p-3 transition-colors ${
                campaignMode === 'standalone' ? 'border-[#F0B90B] bg-[#F0B90B]/10' : 'border-border bg-card hover:bg-accent'
              }`}
            >
              <div className="text-[12px] font-medium">不归属任何战役</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">用于一次性单笔交易，不进入战役复盘</div>
            </button>
          </div>
        )}

        {/* (1) Reason */}
        <div className="space-y-1.5">
          <div className={labelCls}>
            {mode === 'no_entry'
              ? '你看到的信号是什么'
              : isHedge
                ? '对冲理由'
                : '开仓理由'}{requiredStar}
            <span className="ml-2 text-muted-foreground/60">至少 20 字</span>
          </div>
          <Textarea
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={mode === 'no_entry'
              ? '你看到的信号是什么'
              : isHedge
                ? '例如：保护 BTC 主力多仓，对冲未来 24h 的下行风险；或对冲整体账户的 BTC beta 敞口'
                : '例如：BTC 突破 4H 趋势线 + 成交量放大；进场点位 X，止损 Y，止盈分批 Z1/Z2'}
            className={textareaCls}
          />
        </div>


        {/* (2) [Removed] Stop loss field — risk now defined by 最大亏损 USDT */}

        {/* (3) TP levels */}
        {showFullFields && (
          <div className="space-y-1.5">
            <div className={labelCls}>预设止盈档位{requiredStar} <span className="text-muted-foreground/60">（最多 3 档，至少 1 档，仓位合计 ≤ 100%）</span></div>
            <div className="space-y-1.5">
              {tps.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-8">TP{i + 1}</span>
                  <Input
                    type="number"
                    value={t.price}
                    onChange={e => updateTp(i, { price: e.target.value })}
                    placeholder="价格"
                    className={`${inputCls} h-8 flex-1`}
                  />
                  <Input
                    type="number"
                    value={t.pct}
                    onChange={e => updateTp(i, { pct: e.target.value })}
                    placeholder={i === 0 && tps.length === 1 ? '100' : '%'}
                    className={`${inputCls} h-8 w-20`}
                  />
                  <span className="text-[10px] text-muted-foreground">%</span>
                </div>
              ))}
              {tps.length < 3 && (
                <button
                  type="button"
                  onClick={() => setTps(prev => [...prev, { price: '', pct: '' }])}
                  className="text-[11px] text-primary hover:underline"
                >
                  + 增加一档
                </button>
              )}
            </div>
          </div>
        )}

        {/* (4) Position size */}
        {showFullFields && (
          <div className="space-y-1.5">
            <div className={labelCls}>仓位规模 (USDT){requiredStar}</div>
            <Input
              type="number"
              value={posSize}
              onChange={e => setPosSize(e.target.value)}
              placeholder="0"
              className={inputCls}
            />
          </div>
        )}

        {/* (5) Max loss — user input */}
        {showFullFields && (
          <div className="space-y-1.5">
            <div className={labelCls}>本次愿意承受最大亏损 USDT{requiredStar}</div>
            <div className="text-[10px] text-muted-foreground italic">
              这笔交易你能承受亏多少？这是后续 R 倍数计算的分母。不需要对应某个具体止损价。
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={maxLossInput}
                onChange={e => setMaxLossInput(e.target.value)}
                placeholder="0.00"
                className={`${inputCls} flex-1`}
              />
              <span className={`text-[10px] font-mono whitespace-nowrap ${maxLossPctOfAccount > 5 ? 'text-[#F6465D]' : 'text-muted-foreground'}`}>
                {maxLoss > 0 && availableBalance > 0
                  ? `≈ 总账户的 ${maxLossPctOfAccount.toFixed(2)}%`
                  : '≈ —'}
              </span>
            </div>
          </div>
        )}

        {/* (6) Mental state */}
        <div className="space-y-1.5">
          <div className={labelCls}>心态自评{requiredStar}</div>
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5].map(n => {
              const active = mental === n;
              const color = n <= 2 ? '#F6465D' : n === 3 ? '#848E9C' : '#0ECB81';
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMental(n as 1 | 2 | 3 | 4 | 5)}
                  className={`flex-1 h-9 rounded text-[12px] font-medium font-mono border transition-colors`}
                  style={{
                    background: active ? color : 'transparent',
                    color: active ? (n <= 2 || n >= 4 ? (n <= 2 ? '#fff' : '#000') : '#fff') : color,
                    borderColor: active ? color : '#2B3139',
                  }}
                >
                  {n}
                </button>
              );
            })}
            <span className="text-[11px] text-muted-foreground ml-2 font-mono w-10">{MENTAL_STATE_LABELS[mental]}</span>
          </div>

          {mental <= 2 && (
            <div className="bg-[#F6465D]/10 border border-[#F6465D]/30 rounded p-2 text-[11px] text-[#F6465D] space-y-2">
              <div>心态 ≤2 分，强烈不建议交易。仍要继续请勾选下方确认。</div>
              <label className="flex items-center gap-2 text-foreground cursor-pointer">
                <Checkbox
                  checked={overrideLowMental}
                  onCheckedChange={v => setOverrideLowMental(!!v)}
                />
                <span className="text-[11px]">我已知心态 ≤2 分，仍坚持本次交易</span>
              </label>
            </div>
          )}
        </div>

        {/* (7) Mental trigger — conditional */}
        {mental <= 3 && mode !== 'no_entry' && (
          <div className="space-y-1.5">
            <div className={labelCls}>心态触发原因{requiredStar} <span className="text-muted-foreground/60">至少 10 字</span></div>
            <Textarea
              rows={2}
              value={mentalTrigger}
              onChange={e => setMentalTrigger(e.target.value)}
              placeholder="例如：连续两笔亏损后；睡眠不足；看到他人盈利推文等"
              className={textareaCls}
            />
          </div>
        )}

        {/* (8) Risk awareness */}
        {(showFullFields || mode === 'no_entry') && (
          <div className="space-y-1.5">
            <div className={labelCls}>当时对风险的认识{requiredStar} <span className="text-muted-foreground/60">至少 15 字</span></div>
            <Textarea
              rows={2}
              value={riskAware}
              onChange={e => setRiskAware(e.target.value)}
              placeholder="例如：这是反弹中的逆势单,最坏情况下可能扫损 1R；本币流动性较差，存在跳空风险"
              className={textareaCls}
            />
          </div>
        )}

        {/* (9) Risk management */}
        {(showFullFields || mode === 'no_entry') && (
          <div className="space-y-1.5">
            <div className={labelCls}>当时对风险的管理方式{requiredStar} <span className="text-muted-foreground/60">至少 15 字</span></div>
            <Textarea
              rows={2}
              value={riskManage}
              onChange={e => setRiskManage(e.target.value)}
              placeholder={mode === 'no_entry'
                ? '如果当时开了，你会怎么控制风险'
                : '例如：止损放在 X 下方；同时挂对冲单于 Y；30 分钟未走出方向则平仓'}
              className={textareaCls}
            />
          </div>
        )}

        {/* (10) Checklist */}
        {showFullFields && (
          <div className="space-y-1.5">
            <div className={labelCls}>开仓 Checklist{requiredStar}</div>
            <div className="space-y-1.5 bg-background border border-border rounded p-3">
              {checklistItems.map(item => (
                <label key={item.id} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={checked.includes(item.id)}
                    onCheckedChange={v => toggleChecklist(item.id, !!v)}
                  />
                  <span className="text-[11px] text-foreground flex items-center gap-1">
                    {item.source === 'rule' && (
                      <ShieldCheck className="w-3 h-3 text-[#F0B90B] shrink-0" />
                    )}
                    <span>{item.label}</span>
                    {item.required && <span className="text-[#F6465D] ml-0.5">*</span>}
                  </span>
                </label>
              ))}
              <div className={`text-[11px] font-mono pt-1.5 border-t border-border ${checklistPassed ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                必填 {requiredCount}/{requiredTotal} · 可选 {optionalCount}/{optionalTotal} · 状态：{checklistPassed ? '通过' : '未通过'}
              </div>
            </div>
          </div>
        )}

        {/* (11) No entry reason */}
        {mode === 'no_entry' && (
          <div className="space-y-1.5">
            <div className={labelCls}>未开仓原因{requiredStar} <span className="text-muted-foreground/60">至少 10 字</span></div>
            <Textarea
              rows={2}
              value={noEntryReason}
              onChange={e => setNoEntryReason(e.target.value)}
              placeholder="例如：心态不在状态；手机不在身边；担心当下波动率不可控"
              className={textareaCls}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="h-8 px-3 text-[12px] text-muted-foreground hover:text-foreground rounded transition-colors"
        >
          取消
        </button>
        <div title={crossBlocked ? '请先切换为逐仓' : undefined}>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className={`h-8 px-4 text-[12px] font-medium rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${confirmBtnClass}`}
          >
            {confirmBtnText}
          </button>
        </div>
      </div>
    </div>
  );
}
