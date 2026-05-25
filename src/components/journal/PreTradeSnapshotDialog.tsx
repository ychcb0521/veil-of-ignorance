/**
 * 开仓快照弹窗 — 桌面 Dialog / 移动 Sheet 自适应
 * 负责：打开瞬间锁定 模拟时间 + 入场价 + 价格；自动暂停时光机；调 journalApi 创建快照；
 *       trade 模式下回调 onPlaceOrder 真正下单并回填 trade_record_id。
 */

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { toast } from 'sonner';
import { appendCampaignEvent, attachJournalToCampaign, createCampaign, createJournalPreSnapshot, updateJournalTradeRef } from '@/lib/journalApi';
import type { PlaceOrderParams } from '@/contexts/TradingContext';
import type { TradeDirection, PositionMode } from '@/types/journal';
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

  useEffect(() => {
    if (isOpen) {
      setLockedTime(new Date(simulatedTimeMs));
      setLockedPrice(lockedEntryPrice);
      if (!pausedRef.current) {
        pausedRef.current = true;
        onAutoPause?.();
      }
    } else {
      pausedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleSubmit = async (payload: SnapshotPayload) => {
    if (!user) {
      toast.error('请先登录后再记录交易快照');
      return;
    }
    try {
      let campaignId = payload.campaign_id;
      if (mode === 'trade' && payload.campaign_mode === 'create' && payload.campaign_title && payload.campaign_template) {
        const campaign = await createCampaign({
          symbol,
          direction: direction === 'short' ? 'main_short' : 'main_long',
          title: payload.campaign_title,
          opened_at: lockedTime.toISOString(),
          strategy_template: payload.campaign_template,
          notes: null,
        });
        campaignId = campaign.id;
      }

      const journal = await createJournalPreSnapshot({
        user_id: user.id,
        trade_record_id: null,
        campaign_id: mode === 'trade' ? (campaignId ?? null) : null,
        leg_role: mode === 'trade' ? (payload.campaign_leg_role ?? null) : null,
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
      });

      if (mode === 'trade' && campaignId && payload.campaign_leg_role && payload.campaign_mode !== 'standalone') {
        await attachJournalToCampaign(journal.id, campaignId, payload.campaign_leg_role);
        if (payload.campaign_note?.trim()) {
          await appendCampaignEvent(campaignId, {
            timestamp: lockedTime.toISOString(),
            event_type: 'note',
            leg_role: payload.campaign_leg_role,
            journal_id: journal.id,
            trade_record_id: null,
            pending_order_id: null,
            price: lockedPrice,
            size_usdt: payload.pre_position_size,
            notes: payload.campaign_note.trim(),
          });
        }
      }

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

  const form = (
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
      onSubmit={handleSubmit}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="h-[92vh] rounded-t-2xl p-0 bg-card border-t border-border overflow-y-auto"
        >
          {form}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[680px] max-h-[90vh] overflow-y-auto bg-card border border-border p-0">
        {form}
      </DialogContent>
    </Dialog>
  );
}
