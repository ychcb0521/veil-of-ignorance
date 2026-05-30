/**
 * 开仓快照弹窗 — 桌面 Dialog / 移动 Sheet 自适应
 * 负责：打开瞬间锁定 模拟时间 + 入场价 + 价格；自动暂停时光机；调 journalApi 创建快照；
 *       trade 模式下回调 onPlaceOrder 真正下单并回填 trade_record_id。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertOctagon } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { toast } from 'sonner';
import {
  createJournalPreSnapshot, createNoTradeJournal, findUnreviewedJournals, updateJournalTradeRef,
} from '@/lib/journalApi';
import type { PlaceOrderParams } from '@/contexts/TradingContext';
import type { TradeDirection, PositionMode, TradeJournal } from '@/types/journal';
import {
  PreTradeSnapshotForm,
  type SnapshotMode,
  type SnapshotPayload,
} from './PreTradeSnapshotForm';

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SnapshotMode;
  symbol: string;
  direction: TradeDirection;
  simulatedTimeMs: number;
  lockedEntryPrice: number | null;
  leverage: number;
  marginMode: 'cross' | 'isolated';
  pricePrecision: number;
  orderParams?: PlaceOrderParams | null;
  initialPositionSizeUsdt?: number | null;
  /** Trade mode: actually places the order, returns the new trade record id (null for pending) */
  onPlaceOrder?: (order: PlaceOrderParams) => { id: string } | null | Promise<{ id: string } | null>;
  /** Auto-pause hook — called once when the dialog opens (if time machine is running) */
  onAutoPause?: () => void;
}

export function PreTradeSnapshotDialog({
  isOpen, onOpenChange, mode, symbol, direction,
  simulatedTimeMs, lockedEntryPrice, leverage, marginMode, pricePrecision,
  orderParams, initialPositionSizeUsdt, onPlaceOrder, onAutoPause,
}: Props) {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const trading = useTradingContext();
  const currentLeverage = trading.getSymbolLeverage(symbol) ?? leverage;
  const currentMarginMode = trading.getSymbolMarginMode(symbol) ?? marginMode;

  // Lock time + entry price on open
  const [lockedTime, setLockedTime] = useState<Date>(() => new Date(simulatedTimeMs));
  const [lockedPrice, setLockedPrice] = useState<number | null>(lockedEntryPrice);
  const pausedRef = useRef(false);
  const [tooHardOpen, setTooHardOpen] = useState(false);
  const [tooHardReason, setTooHardReason] = useState('');
  const [tooHardOrderKind, setTooHardOrderKind] = useState<'main' | 'hedge'>('main');
  const [savingTooHard, setSavingTooHard] = useState(false);

  // Pending-review gate: closed trades without post-review must be evaluated before new orders
  const [pendingReviews, setPendingReviews] = useState<TradeJournal[] | null>(null);
  const openPositionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const positions of Object.values(trading.positionsMap)) {
      for (const p of positions) ids.add(p.id);
    }
    return ids;
  }, [trading.positionsMap]);

  useEffect(() => {
    if (isOpen) {
      setLockedTime(new Date(simulatedTimeMs));
      setLockedPrice(lockedEntryPrice);
      setTooHardReason('');
      setTooHardOpen(false);
      if (!pausedRef.current) {
        pausedRef.current = true;
        onAutoPause?.();
      }
    } else {
      pausedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Fetch pending reviews when opening in trade mode
  useEffect(() => {
    if (!isOpen || mode !== 'trade' || !user) {
      setPendingReviews(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await findUnreviewedJournals(user.id);
        // Filter to journals whose linked position is no longer open (i.e., the trade is closed)
        const closed = list.filter(j =>
          j.trade_record_id != null && !openPositionIds.has(j.trade_record_id),
        );
        if (!cancelled) setPendingReviews(closed);
      } catch (e) {
        console.warn('[PreTradeSnapshot] pending-review check failed', e);
        if (!cancelled) setPendingReviews([]);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, mode, user, openPositionIds]);

  const blocked = mode === 'trade' && (pendingReviews?.length ?? 0) > 0;

  const handleSubmit = async (payload: SnapshotPayload) => {
    if (!user) {
      toast.error('请先登录后再记录交易快照');
      return;
    }
    if (mode === 'trade') {
      try {
        const list = await findUnreviewedJournals(user.id);
        const stillPending = list.filter(j =>
          j.trade_record_id != null && !openPositionIds.has(j.trade_record_id),
        );
        if (stillPending.length > 0) {
          setPendingReviews(stillPending);
          toast.error(`还有 ${stillPending.length} 笔已平仓未评价交易，必须先评价`);
          return;
        }
      } catch (e) {
        console.warn('[PreTradeSnapshot] gate recheck failed', e);
      }
    }
    try {
      const journal = await createJournalPreSnapshot({
        user_id: user.id,
        trade_record_id: null,
        campaign_id: null,
        leg_role: null,
        leg_sequence: null,
        symbol,
        direction,
        leverage: mode === 'trade' ? currentLeverage : null,
        position_mode: mode === 'trade' ? (currentMarginMode as PositionMode) : null,
        pre_simulated_time: lockedTime.toISOString(),
        pre_entry_price: lockedPrice,
        order_kind: payload.order_kind,
        pre_planned_stop_loss: payload.pre_planned_stop_loss,
        pre_planned_take_profit: payload.pre_planned_take_profit,
        pre_entry_reason: payload.pre_entry_reason,
        pre_mental_state: payload.pre_mental_state,
        pre_mental_trigger: payload.pre_mental_trigger,
        pre_risk_awareness: payload.pre_risk_awareness,
        pre_risk_management: payload.pre_risk_management,
        pre_checklist_items: payload.pre_checklist_items,
        pre_checklist_passed: payload.pre_checklist_passed,
        pre_position_size: payload.pre_position_size,
        pre_max_loss_usdt: payload.pre_max_loss_usdt,
        pre_thesis_why_right: payload.pre_thesis_why_right,
        pre_premortem_failure_reason: payload.pre_premortem_failure_reason,
        pre_falsification_signal: payload.pre_falsification_signal,
        pre_confidence_basis: payload.pre_confidence_basis,
        pre_account_equity_usdt: payload.pre_account_equity_usdt,
        // Decision-quality fields
        pre_mortem_text: payload.pre_mortem_text,
        pre_positive_expectancy: payload.pre_positive_expectancy,
        pre_invalidation_condition: payload.pre_invalidation_condition,
        pre_calibration_win_pct: payload.pre_calibration_win_pct,
        pre_confidence_interval_low_pct: payload.pre_confidence_interval_low_pct,
        pre_confidence_interval_high_pct: payload.pre_confidence_interval_high_pct,
        pre_calibration_reference_class: payload.pre_calibration_reference_class,
        pre_calibration_competence_basis: payload.pre_calibration_competence_basis,
        pre_calibration_update_signal: payload.pre_calibration_update_signal,
        pre_dataset_split: payload.pre_dataset_split,
        pre_lollapalooza_score: payload.pre_lollapalooza_score,
        pre_bankruptcy_estimate: payload.pre_bankruptcy_estimate,
        pre_info_kline_facts: payload.pre_info_kline_facts,
        pre_info_macro_facts: payload.pre_info_macro_facts,
        pre_info_rule_advice: payload.pre_info_rule_advice,
        pre_info_intuition: payload.pre_info_intuition,
        pre_info_designer_view: payload.pre_info_designer_view,
        pre_opponent_statement: payload.pre_opponent_statement,
        pre_triggered_principle_ids: payload.pre_triggered_principle_ids,
        pre_triggered_rule_ids: payload.pre_triggered_rule_ids,
        pre_pain_tags: payload.pre_pain_tags,
        pre_cognitive_bias_tags: payload.pre_cognitive_bias_tags,
        pre_executor_self: payload.pre_executor_self,
        pre_designer_self: payload.pre_designer_self,
      });

      if (mode === 'trade' && orderParams && onPlaceOrder) {
        try {
          const result = await onPlaceOrder(orderParams);
          if (result?.id) {
            await updateJournalTradeRef(journal.id, result.id);
          }
        } catch (orderErr) {
          console.error('[Snapshot] 下单失败', orderErr);
        }
        toast.success('已记录开仓快照并提交订单');
      } else {
        toast.success("已记录'该开没开'决策");
      }
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    }
  };

  const handleConfirmTooHard = async () => {
    if (!user) {
      toast.error('请先登录后再记录交易快照');
      return;
    }
    if (mode !== 'trade' || direction === 'no_entry') return;
    setSavingTooHard(true);
    try {
      await createNoTradeJournal({
        user_id: user.id,
        symbol,
        direction,
        pre_simulated_time: lockedTime.toISOString(),
        no_trade_would_be_entry_price: lockedPrice,
        no_trade_reason: tooHardReason,
        order_kind: tooHardOrderKind,
      });
      toast.success("已记录'太难'决策");
      setTooHardOpen(false);
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setSavingTooHard(false);
    }
  };

  const fmtTimeShort = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const blocker = blocked && pendingReviews ? (
    <div className="flex flex-col">
      <div className="bg-[#F6465D]/10 px-5 py-3 border-b border-[#F6465D]/30 flex items-center gap-2">
        <AlertOctagon className="w-4 h-4 text-[#F6465D]" />
        <span className="text-[14px] font-medium">先评价已平仓交易，再开新仓</span>
      </div>
      <div className="px-5 py-4 space-y-3">
        <p className="text-[12px] text-foreground">
          你有 <span className="text-[#F6465D] font-medium">{pendingReviews.length}</span> 笔已平仓但未评价的交易。
          按 "无知之幕" 闭环原则：错题未归类前不能开新仓——否则错题集会丢失这些样本，元监控失真。
        </p>
        <div className="rounded border border-border bg-background/60 max-h-[240px] overflow-y-auto">
          {pendingReviews.slice(0, 10).map(j => (
            <Link
              key={j.id}
              to={`/journal/${j.id}`}
              onClick={() => onOpenChange(false)}
              className="block border-b border-border/40 last:border-b-0 px-3 py-2 text-[11px] font-mono hover:bg-accent/40"
            >
              <span className="text-foreground">{j.symbol}</span>
              <span className={`mx-2 ${j.direction === 'long' ? 'text-[#0ECB81]' : j.direction === 'short' ? 'text-[#F6465D]' : 'text-muted-foreground'}`}>
                {j.direction.toUpperCase()}
              </span>
              <span className="text-muted-foreground">{fmtTimeShort(j.pre_simulated_time)}</span>
            </Link>
          ))}
          {pendingReviews.length > 10 && (
            <div className="px-3 py-2 text-[10px] text-muted-foreground">还有 {pendingReviews.length - 10} 笔…</div>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          每条记录点击即可进入评价。完成所有评价后回到这里再下单。
        </p>
      </div>
      <div className="px-5 py-3 border-t border-border flex justify-between">
        <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-8 text-[12px]">
          取消下单
        </Button>
        <Link to="/journal" onClick={() => onOpenChange(false)}>
          <Button className="h-8 text-[12px] bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black">
            前往错题集
          </Button>
        </Link>
      </div>
    </div>
  ) : null;

  const form = blocker ?? (
    <PreTradeSnapshotForm
      mode={mode}
      symbol={symbol}
      direction={direction}
      simulatedTime={lockedTime}
      lockedEntryPrice={lockedPrice}
      leverage={currentLeverage}
      initialPositionSizeUsdt={initialPositionSizeUsdt ?? null}
      pricePrecision={pricePrecision}
      orderParams={orderParams ?? null}
      onCancel={() => onOpenChange(false)}
      onTooHard={({ order_kind }) => {
        setTooHardOrderKind(order_kind);
        setTooHardOpen(true);
      }}
      onSubmit={handleSubmit}
    />
  );

  if (isMobile) {
    return (
      <>
        <Sheet open={isOpen} onOpenChange={onOpenChange}>
          <SheetContent
            side="bottom"
            className="h-[92vh] rounded-t-2xl p-0 bg-card border-t border-border overflow-y-auto"
          >
            {form}
          </SheetContent>
        </Sheet>
        <Dialog open={tooHardOpen} onOpenChange={setTooHardOpen}>
          <DialogContent className="max-w-[420px] bg-card border border-border">
            <DialogHeader>
              <DialogTitle className="text-[14px]">记录为"太难"决策</DialogTitle>
              <DialogDescription className="text-[11px] leading-relaxed text-muted-foreground">
                我只想知道我将来会死在哪里，这样就永远不去那里。不做，也是一种被尊重的决定。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <label className="block">
                <div className="text-[12px] font-medium text-foreground">为什么这单太难？（可选）</div>
                <Textarea
                  rows={4}
                  value={tooHardReason}
                  onChange={event => setTooHardReason(event.target.value)}
                  placeholder="例如：结构看不懂 / 赔率不够 / 我对这个币种没有能力圈 / 此刻状态不对"
                  className="mt-2 min-h-[110px] border-border bg-background text-[12px]"
                />
              </label>
              <div className="rounded border border-border bg-background/70 px-3 py-2 text-[11px] text-muted-foreground">
                标的 <span className="text-foreground">{symbol}</span> · 方向 <span className="text-foreground">{direction === 'long' ? '做多' : '做空'}</span> · 当前价 <span className="text-foreground">{lockedPrice != null ? lockedPrice.toFixed(pricePrecision) : '—'}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" onClick={() => setTooHardOpen(false)} className="h-8 text-[12px]">
                  返回继续填快照
                </Button>
                <Button
                  onClick={() => void handleConfirmTooHard()}
                  disabled={savingTooHard}
                  className="h-8 bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90 text-[12px]"
                >
                  {savingTooHard ? '记录中...' : '确认跳过'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[860px] max-h-[92vh] overflow-y-auto bg-card border border-border p-0">
          {form}
        </DialogContent>
      </Dialog>
      <Dialog open={tooHardOpen} onOpenChange={setTooHardOpen}>
        <DialogContent className="max-w-[460px] bg-card border border-border">
          <DialogHeader>
            <DialogTitle className="text-[14px]">记录为"太难"决策</DialogTitle>
            <DialogDescription className="text-[11px] leading-relaxed text-muted-foreground">
              我只想知道我将来会死在哪里，这样就永远不去那里。不做，也是一种被尊重的决定。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block">
              <div className="text-[12px] font-medium text-foreground">为什么这单太难？（可选）</div>
              <Textarea
                rows={4}
                value={tooHardReason}
                onChange={event => setTooHardReason(event.target.value)}
                placeholder="例如：结构看不懂 / 赔率不够 / 我对这个币种没有能力圈 / 此刻状态不对"
                className="mt-2 min-h-[120px] border-border bg-background text-[12px]"
              />
            </label>
            <div className="rounded border border-border bg-background/70 px-3 py-2 text-[11px] text-muted-foreground">
              标的 <span className="text-foreground">{symbol}</span> · 方向 <span className="text-foreground">{direction === 'long' ? '做多' : '做空'}</span> · 当前价 <span className="text-foreground">{lockedPrice != null ? lockedPrice.toFixed(pricePrecision) : '—'}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => setTooHardOpen(false)} className="h-8 text-[12px]">
                返回继续填快照
              </Button>
              <Button
                onClick={() => void handleConfirmTooHard()}
                disabled={savingTooHard}
                className="h-8 bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90 text-[12px]"
              >
                {savingTooHard ? '记录中...' : '确认跳过'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
