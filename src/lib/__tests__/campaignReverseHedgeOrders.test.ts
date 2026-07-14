import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CancelledOrderSnapshot, FilledOrderSnapshot, PendingOrder, TradeRecord } from '@/types/trading';

const t = (iso: string) => Date.parse(iso);

let campaign: TradeCampaign;
let journals: TradeJournal[];

vi.mock('@/integrations/supabase/client', () => {
  function from(table: string) {
    const resolveResult = () => {
      if (table === 'trade_campaigns') return { data: campaign, error: null };
      if (table === 'trade_journals') return { data: journals, error: null };
      return { data: null, error: null };
    };

    const builder = {
      select() { return builder; },
      update() { return builder; },
      eq() { return builder; },
      order() { return builder; },
      single() { return Promise.resolve(resolveResult()); },
      maybeSingle() { return Promise.resolve(resolveResult()); },
      then(resolve: (value: { data: unknown; error: null }) => unknown) {
        return Promise.resolve(resolveResult()).then(resolve);
      },
    };

    return builder;
  }

  return {
    supabase: {
      from,
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }),
      },
    },
  };
});

import { getCampaignFullData } from '../journalApi';

const makeLeg = (overrides: Partial<TradeJournal>): TradeJournal => ({
  id: overrides.id ?? `leg-${Math.random().toString(36).slice(2)}`,
  user_id: 'user-1',
  trade_record_id: null,
  campaign_id: 'campaign-1',
  leg_role: 'hedge_rolling',
  leg_sequence: null,
  source: 'post_review',
  symbol: 'ASTERUSDT',
  direction: 'short',
  leverage: 5,
  position_mode: 'isolated',
  order_kind: 'trade',
  pre_simulated_time: '2025-09-20T10:00:00.000Z',
  pre_real_time: '2025-09-20T10:00:00.000Z',
  pre_entry_price: null,
  pre_planned_stop_loss: null,
  pre_planned_take_profit: null,
  pre_entry_reason: null,
  pre_mental_state: 3,
  pre_mental_trigger: null,
  pre_risk_awareness: null,
  pre_risk_management: null,
  pre_checklist_items: null,
  pre_checklist_passed: null,
  pre_position_size: null,
  pre_max_loss_usdt: null,
  ...overrides,
} as TradeJournal);

describe('getCampaignFullData reverse hedge order layer', () => {
  beforeEach(() => {
    localStorage.clear();
    journals = [];
    campaign = {
      id: 'campaign-1',
      user_id: 'user-1',
      symbol: 'ASTERUSDT',
      direction: 'main_long',
      status: 'closed_profit',
      strategy_template: 'custom',
      title: 'ASTERUSDT 2025-09-20 多战役',
      opened_at: '2025-09-20T10:00:00.000Z',
      closed_at: '2025-09-20T10:30:00.000Z',
      initial_main_size_usdt: null,
      initial_leverage: null,
      final_realized_pnl: null,
      final_r_multiple: null,
      peak_unrealized_pnl: null,
      peak_drawdown: null,
      notes: null,
      actual_evolution: [],
      created_at: '2025-09-20T10:00:00.000Z',
      updated_at: '2025-09-20T10:30:00.000Z',
    };
  });

  it('只保留开仓性质的委托空单，并保留已触发委托的委托时间与触发时间', async () => {
    const createdAt = t('2025-09-20T10:01:00.000Z');
    const filledAt = t('2025-09-20T10:05:00.000Z');
    const closeTime = t('2025-09-20T10:20:00.000Z');

    const filledOrders: FilledOrderSnapshot[] = [
      {
        id: 'short-open-order',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        reduceOnly: false,
        reduceKind: null,
        price: 1.2,
        triggerPrice: 1.2,
        quantity: 100,
        leverage: 5,
        createdAt,
        filledAt,
        positionId: 'short-position',
      },
      {
        id: 'tp-close-order',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'LIMIT_TP_SL',
        reduceOnly: true,
        reduceKind: 'TP',
        price: 1.3,
        triggerPrice: 1.3,
        quantity: 100,
        leverage: 5,
        createdAt: t('2025-09-20T10:02:00.000Z'),
        filledAt: t('2025-09-20T10:06:00.000Z'),
      },
      {
        id: 'legacy-linked-tp-filled',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        price: 1.31,
        triggerPrice: 1.31,
        quantity: 100,
        leverage: 5,
        createdAt: t('2025-09-20T10:02:30.000Z'),
        filledAt: t('2025-09-20T10:06:30.000Z'),
        linkedPositionId: 'main-long-position',
      },
      {
        id: 'long-open-order',
        symbol: 'ASTERUSDT',
        side: 'LONG',
        type: 'CONDITIONAL',
        price: 1.1,
        triggerPrice: 1.1,
        quantity: 100,
        leverage: 5,
        createdAt: t('2025-09-20T10:03:00.000Z'),
        filledAt: t('2025-09-20T10:07:00.000Z'),
      },
    ];
    const cancelledOrders: CancelledOrderSnapshot[] = [
      {
        id: 'short-cancelled-open',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        reduceOnly: false,
        reduceKind: null,
        price: 1.19,
        quantity: 100,
        leverage: 5,
        createdAt: t('2025-09-20T10:04:00.000Z'),
        cancelledAt: t('2025-09-20T10:09:00.000Z'),
      },
      {
        id: 'short-cancelled-tp',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'LIMIT_TP_SL',
        reduceOnly: true,
        reduceKind: 'TP',
        price: 1.32,
        quantity: 100,
        leverage: 5,
        createdAt: t('2025-09-20T10:04:00.000Z'),
        cancelledAt: t('2025-09-20T10:09:00.000Z'),
      },
      {
        id: 'legacy-linked-tp-cancelled',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        price: 1.33,
        quantity: 100,
        leverage: 5,
        createdAt: t('2025-09-20T10:04:30.000Z'),
        cancelledAt: t('2025-09-20T10:09:30.000Z'),
        linkedPositionId: 'main-long-position',
      },
    ];
    const pendingShortOpen: PendingOrder = {
      id: 'short-pending-open',
      side: 'SHORT',
      type: 'CONDITIONAL',
      price: 1.18,
      stopPrice: 1.18,
      quantity: 100,
      leverage: 5,
      marginMode: 'isolated',
      status: 'PENDING',
      createdAt: t('2025-09-20T10:08:00.000Z'),
    };
    const pendingShortTp: PendingOrder = {
      ...pendingShortOpen,
      id: 'short-pending-tp',
      type: 'LIMIT_TP_SL',
      reduceOnly: true,
      reduceKind: 'TP',
      price: 1.34,
      stopPrice: 1.34,
    };
    const legacyLinkedPendingTp: PendingOrder = {
      ...pendingShortOpen,
      id: 'legacy-linked-pending-tp',
      price: 1.35,
      stopPrice: 1.35,
      createdAt: t('2025-09-20T10:08:30.000Z'),
      linkedPositionId: 'main-long-position',
      reducePositionSide: 'LONG',
    };
    const tradeHistory: TradeRecord[] = [{
      id: 'record-short-position',
      symbol: 'ASTERUSDT',
      side: 'SHORT',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 1.2,
      exitPrice: 1.1,
      quantity: 100,
      leverage: 5,
      pnl: 10,
      fee: 0,
      slippage: 0,
      openTime: filledAt,
      closeTime,
    }];
    journals = [
      makeLeg({
        id: 'leg-triggered-short',
        trade_record_id: 'record-short-position',
        leg_sequence: 1,
        pre_simulated_time: new Date(filledAt).toISOString(),
        pre_entry_price: 1.2,
        pre_position_size: 120,
      }),
      makeLeg({
        id: 'leg-cancelled-short',
        leg_sequence: 2,
        pre_simulated_time: new Date(t('2025-09-20T10:04:00.000Z')).toISOString(),
        pre_entry_price: 1.19,
        pre_position_size: 119,
      }),
      makeLeg({
        id: 'leg-pending-short',
        leg_sequence: 3,
        pre_simulated_time: new Date(t('2025-09-20T10:08:00.000Z')).toISOString(),
        pre_entry_price: 1.18,
        pre_position_size: 118,
      }),
    ];

    localStorage.setItem('sim_user-1_filled_orders', JSON.stringify(filledOrders));
    localStorage.setItem('sim_user-1_cancelled_orders', JSON.stringify(cancelledOrders));
    localStorage.setItem('sim_user-1_orders_map', JSON.stringify({ ASTERUSDT: [pendingShortOpen, pendingShortTp, legacyLinkedPendingTp] }));
    localStorage.setItem('sim_user-1_trade_history', JSON.stringify(tradeHistory));

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);
    const ids = reverseHedgeOrders.map(order => order.id);

    expect(ids).toEqual(['short-open-order', 'short-cancelled-open', 'short-pending-open']);
    expect(ids).not.toContain('tp-close-order');
    expect(ids).not.toContain('legacy-linked-tp-filled');
    expect(ids).not.toContain('short-cancelled-tp');
    expect(ids).not.toContain('legacy-linked-tp-cancelled');
    expect(ids).not.toContain('short-pending-tp');
    expect(ids).not.toContain('legacy-linked-pending-tp');
    expect(ids).not.toContain('long-open-order');

    expect(reverseHedgeOrders[0]).toMatchObject({
      id: 'short-open-order',
      tradeRecordId: 'record-short-position',
      side: 'SHORT',
      status: 'triggered',
      createdAt,
      triggeredAt: filledAt,
      cancelledAt: closeTime,
    });
  });

  it('已触发委托按时间和价格接回成交记录，避免同一笔触发委托重复成两条线', async () => {
    const createdAt = t('2025-09-20T10:01:00.000Z');
    const filledAt = t('2025-09-20T10:05:00.000Z');
    const closeTime = t('2025-09-20T10:20:00.000Z');
    const filledOrders: FilledOrderSnapshot[] = [
      {
        id: 'short-open-order',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        reduceOnly: false,
        reduceKind: null,
        price: 1.2,
        triggerPrice: 1.2,
        quantity: 99,
        leverage: 5,
        createdAt,
        filledAt,
        positionId: 'short-position',
      },
      {
        id: 'short-open-order',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        reduceOnly: false,
        reduceKind: null,
        price: 1.2,
        triggerPrice: 1.2,
        quantity: 99,
        leverage: 5,
        createdAt,
        filledAt,
        positionId: 'short-position',
      },
    ];
    const tradeHistory: TradeRecord[] = [{
      id: 'record-short-position',
      symbol: 'ASTERUSDT',
      side: 'SHORT',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 1.2,
      exitPrice: 1.1,
      quantity: 100,
      leverage: 5,
      pnl: 10,
      fee: 0,
      slippage: 0,
      openTime: filledAt,
      closeTime,
    }];
    journals = [
      makeLeg({
        id: 'leg-triggered-short',
        trade_record_id: 'record-short-position',
        pre_simulated_time: new Date(filledAt).toISOString(),
        pre_entry_price: 1.2,
        pre_position_size: 120,
      }),
    ];

    localStorage.setItem('sim_user-1_filled_orders', JSON.stringify(filledOrders));
    localStorage.setItem('sim_user-1_trade_history', JSON.stringify(tradeHistory));

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders).toHaveLength(1);
    expect(reverseHedgeOrders[0]).toMatchObject({
      id: 'short-open-order',
      tradeRecordId: 'record-short-position',
      status: 'triggered',
      createdAt,
      triggeredAt: filledAt,
      cancelledAt: closeTime,
    });
  });

  it('已触发委托优先按仓位 ID 接回手动拆仓时间', async () => {
    const createdAt = t('2025-09-20T10:01:00.000Z');
    const filledAt = t('2025-09-20T10:05:00.000Z');
    const manualCloseTime = t('2025-09-20T10:12:00.000Z');
    const filledOrders: FilledOrderSnapshot[] = [
      {
        id: 'triggered-short-order',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        reduceOnly: false,
        reduceKind: null,
        price: 1.2,
        triggerPrice: 1.2,
        quantity: 100,
        leverage: 5,
        createdAt,
        filledAt,
        positionId: 'triggered-short-position',
      },
    ];
    const tradeHistory: TradeRecord[] = [{
      id: 'manual-close-triggered-short',
      positionId: 'triggered-short-position',
      symbol: 'ASTERUSDT',
      side: 'SHORT',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 1.2009,
      exitPrice: 1.16,
      quantity: 100,
      leverage: 5,
      pnl: 4,
      fee: 0,
      slippage: 0,
      openTime: filledAt + 180_000,
      closeTime: manualCloseTime,
      exit_method: 'manual',
    }];

    localStorage.setItem('sim_user-1_filled_orders', JSON.stringify(filledOrders));
    localStorage.setItem('sim_user-1_trade_history', JSON.stringify(tradeHistory));

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders).toHaveLength(1);
    expect(reverseHedgeOrders[0]).toMatchObject({
      id: 'triggered-short-order',
      tradeRecordId: 'manual-close-triggered-short',
      status: 'triggered',
      createdAt,
      triggeredAt: filledAt,
      cancelledAt: manualCloseTime,
    });
  });

  it('历史已触发委托缺少仓位 ID 时仍能接回手动拆仓时间', async () => {
    const createdAt = t('2025-09-20T10:01:00.000Z');
    const filledAt = t('2025-09-20T10:05:00.000Z');
    const manualCloseTime = t('2025-09-20T10:16:00.000Z');
    const filledOrders: FilledOrderSnapshot[] = [
      {
        id: 'legacy-triggered-short-order',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        reduceOnly: false,
        reduceKind: null,
        price: 1.2,
        triggerPrice: 1.2,
        quantity: 100,
        leverage: 5,
        createdAt,
        filledAt,
      },
    ];
    const tradeHistory: TradeRecord[] = [{
      id: 'legacy-manual-close-triggered-short',
      symbol: 'ASTERUSDT',
      side: 'SHORT',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 1.204,
      exitPrice: 1.16,
      quantity: 100,
      leverage: 5,
      pnl: 4,
      fee: 0,
      slippage: 0,
      openTime: filledAt + 180_000,
      closeTime: manualCloseTime,
      exit_method: 'manual',
    }];

    localStorage.setItem('sim_user-1_filled_orders', JSON.stringify(filledOrders));
    localStorage.setItem('sim_user-1_trade_history', JSON.stringify(tradeHistory));

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders).toHaveLength(1);
    expect(reverseHedgeOrders[0]).toMatchObject({
      id: 'legacy-triggered-short-order',
      tradeRecordId: 'legacy-manual-close-triggered-short',
      status: 'triggered',
      createdAt,
      triggeredAt: filledAt,
      cancelledAt: manualCloseTime,
    });
  });

  it('已触发委托没有手动拆掉时接到这条对冲的最终平仓时间', async () => {
    const createdAt = t('2025-09-20T10:01:00.000Z');
    const filledAt = t('2025-09-20T10:05:00.000Z');
    const partialCloseTime = t('2025-09-20T10:12:00.000Z');
    const finalCloseTime = t('2025-09-20T10:22:00.000Z');
    const filledOrders: FilledOrderSnapshot[] = [
      {
        id: 'triggered-short-order',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        reduceOnly: false,
        reduceKind: null,
        price: 1.2,
        triggerPrice: 1.2,
        quantity: 100,
        leverage: 5,
        createdAt,
        filledAt,
        positionId: 'triggered-short-position',
      },
    ];
    const tradeHistory: TradeRecord[] = [
      {
        id: 'partial-close-triggered-short',
        positionId: 'triggered-short-position',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'MARKET',
        action: 'CLOSE',
        entryPrice: 1.2,
        exitPrice: 1.17,
        quantity: 40,
        leverage: 5,
        pnl: 2,
        fee: 0,
        slippage: 0,
        openTime: filledAt,
        closeTime: partialCloseTime,
        exit_method: 'tp1',
      },
      {
        id: 'final-close-triggered-short',
        positionId: 'triggered-short-position',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'MARKET',
        action: 'CLOSE',
        entryPrice: 1.2,
        exitPrice: 1.18,
        quantity: 60,
        leverage: 5,
        pnl: 3,
        fee: 0,
        slippage: 0,
        openTime: filledAt,
        closeTime: finalCloseTime,
        exit_method: 'tp2',
      },
    ];

    localStorage.setItem('sim_user-1_filled_orders', JSON.stringify(filledOrders));
    localStorage.setItem('sim_user-1_trade_history', JSON.stringify(tradeHistory));

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders).toHaveLength(1);
    expect(reverseHedgeOrders[0]).toMatchObject({
      id: 'triggered-short-order',
      tradeRecordId: 'final-close-triggered-short',
      status: 'triggered',
      createdAt,
      triggeredAt: filledAt,
      cancelledAt: finalCloseTime,
    });
  });

  it('不会把没有委托快照的普通 SHORT 成交记录兜底成委托空单', async () => {
    const openTime = t('2025-09-20T10:05:00.000Z');
    const closeTime = t('2025-09-20T10:20:00.000Z');
    const tradeHistory: TradeRecord[] = [{
      id: 'manual-short-record',
      symbol: 'ASTERUSDT',
      side: 'SHORT',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 1.2,
      exitPrice: 1.1,
      quantity: 100,
      leverage: 5,
      pnl: 10,
      fee: 0,
      slippage: 0,
      openTime,
      closeTime,
    }];
    journals = [
      makeLeg({
        id: 'manual-short-leg',
        trade_record_id: 'manual-short-record',
        pre_simulated_time: new Date(openTime).toISOString(),
        pre_entry_price: 1.2,
        pre_position_size: 120,
      }),
    ];

    localStorage.setItem('sim_user-1_trade_history', JSON.stringify(tradeHistory));

    const { tradeRecords, reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(tradeRecords.map(record => record.id)).toEqual(['manual-short-record']);
    expect(reverseHedgeOrders).toEqual([]);
  });

  it('成交 legs 只保留所选，委托空单保留整个战役期间的全部开空委托', async () => {
    const preWindowCancelledCreatedAt = t('2025-09-20T09:57:00.000Z');
    const preWindowPendingCreatedAt = t('2025-09-20T09:58:00.000Z');
    const preWindowTriggeredCreatedAt = t('2025-09-20T09:58:30.000Z');
    const preWindowTriggeredFilledAt = t('2025-09-20T10:03:00.000Z');
    const selectedCreatedAt = t('2025-09-20T10:01:00.000Z');
    const selectedFilledAt = t('2025-09-20T10:05:00.000Z');
    const unselectedCreatedAt = t('2025-09-20T10:06:00.000Z');
    const unselectedFilledAt = t('2025-09-20T10:10:00.000Z');
    const selectedRecord: TradeRecord = {
      id: 'selected-short-record',
      symbol: 'ASTERUSDT',
      side: 'SHORT',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 1.2,
      exitPrice: 1.1,
      quantity: 100,
      leverage: 5,
      pnl: 10,
      fee: 0,
      slippage: 0,
      openTime: selectedFilledAt,
      closeTime: t('2025-09-20T10:18:00.000Z'),
    };
    const unselectedRecord: TradeRecord = {
      ...selectedRecord,
      id: 'unselected-short-record',
      entryPrice: 1.4,
      exitPrice: 1.3,
      openTime: unselectedFilledAt,
      closeTime: t('2025-09-20T10:25:00.000Z'),
    };
    const preWindowTriggeredRecord: TradeRecord = {
      ...selectedRecord,
      id: 'pre-window-triggered-short-record',
      entryPrice: 1.45,
      exitPrice: 1.33,
      openTime: preWindowTriggeredFilledAt,
      closeTime: t('2025-09-20T10:15:00.000Z'),
    };
    const filledOrders: FilledOrderSnapshot[] = [
      {
        id: 'pre-window-triggered-short-order',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        reduceOnly: false,
        reduceKind: null,
        price: 1.45,
        triggerPrice: 1.45,
        quantity: 100,
        leverage: 5,
        createdAt: preWindowTriggeredCreatedAt,
        filledAt: preWindowTriggeredFilledAt,
      },
      {
        id: 'selected-short-order',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        reduceOnly: false,
        reduceKind: null,
        price: 1.2,
        triggerPrice: 1.2,
        quantity: 100,
        leverage: 5,
        createdAt: selectedCreatedAt,
        filledAt: selectedFilledAt,
      },
      {
        id: 'unselected-short-order',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        reduceOnly: false,
        reduceKind: null,
        price: 1.4,
        triggerPrice: 1.4,
        quantity: 100,
        leverage: 5,
        createdAt: unselectedCreatedAt,
        filledAt: unselectedFilledAt,
      },
    ];
    const cancelledOrders: CancelledOrderSnapshot[] = [
      {
        id: 'pre-window-cancelled-short',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        reduceOnly: false,
        reduceKind: null,
        price: 1.46,
        quantity: 100,
        leverage: 5,
        createdAt: preWindowCancelledCreatedAt,
        cancelledAt: t('2025-09-20T10:02:00.000Z'),
      },
      {
        id: 'unselected-cancelled-short',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        reduceOnly: false,
        reduceKind: null,
        price: 1.39,
        quantity: 100,
        leverage: 5,
        createdAt: t('2025-09-20T10:12:00.000Z'),
        cancelledAt: t('2025-09-20T10:13:00.000Z'),
      },
    ];
    const preWindowPendingOrder: PendingOrder = {
      id: 'pre-window-pending-short',
      side: 'SHORT',
      type: 'CONDITIONAL',
      price: 1.47,
      stopPrice: 1.47,
      quantity: 100,
      leverage: 5,
      marginMode: 'isolated',
      status: 'PENDING',
      createdAt: preWindowPendingCreatedAt,
    };
    const pendingOrder: PendingOrder = {
      id: 'unselected-pending-short',
      side: 'SHORT',
      type: 'CONDITIONAL',
      price: 1.38,
      stopPrice: 1.38,
      quantity: 100,
      leverage: 5,
      marginMode: 'isolated',
      status: 'PENDING',
      createdAt: t('2025-09-20T10:14:00.000Z'),
    };
    journals = [
      makeLeg({
        id: 'selected-leg',
        trade_record_id: selectedRecord.id,
        pre_simulated_time: new Date(selectedFilledAt).toISOString(),
        pre_entry_price: 1.2,
        pre_position_size: 120,
      }),
    ];

    localStorage.setItem('sim_user-1_trade_history', JSON.stringify([selectedRecord, unselectedRecord, preWindowTriggeredRecord]));
    localStorage.setItem('sim_user-1_filled_orders', JSON.stringify(filledOrders));
    localStorage.setItem('sim_user-1_cancelled_orders', JSON.stringify(cancelledOrders));
    localStorage.setItem('sim_user-1_orders_map', JSON.stringify({ ASTERUSDT: [preWindowPendingOrder, pendingOrder] }));

    const { tradeRecords, reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(tradeRecords.map(record => record.id)).toEqual(['selected-short-record']);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual([
      'pre-window-cancelled-short',
      'pre-window-pending-short',
      'pre-window-triggered-short-order',
      'selected-short-order',
      'unselected-short-order',
      'unselected-cancelled-short',
      'unselected-pending-short',
    ]);
    expect(reverseHedgeOrders[2].tradeRecordId).toBe('pre-window-triggered-short-record');
    expect(reverseHedgeOrders[3].tradeRecordId).toBe('selected-short-record');
    expect(reverseHedgeOrders[4].tradeRecordId).toBe('unselected-short-record');
  });

  it('上一场战役挂出的开空委托(挂单时间早于窗口)不泄漏进本战役', async () => {
    // 战役 10:00–10:30，5min 缓冲 → windowStart 09:55。下面三笔都在 09:20 挂出(早主力 35min，远在窗口外)，
    // 但分别在窗口内「撤销 / 成交 / 仍挂单」——旧 overlap 逻辑会按撤单/成交时间(或缺下界)把它们泄漏进来。
    const prevCampaignPlacedAt = t('2025-09-20T09:20:00.000Z');

    const cancelledOrders: CancelledOrderSnapshot[] = [
      {
        id: 'prev-campaign-cancelled-short',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        reduceOnly: false,
        reduceKind: null,
        price: 1.5,
        quantity: 100,
        leverage: 5,
        createdAt: prevCampaignPlacedAt,
        cancelledAt: t('2025-09-20T10:10:00.000Z'), // 撤销落在窗口内
      },
    ];
    const filledOrders: FilledOrderSnapshot[] = [
      {
        id: 'prev-campaign-triggered-short',
        symbol: 'ASTERUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        reduceOnly: false,
        reduceKind: null,
        price: 1.5,
        triggerPrice: 1.5,
        quantity: 100,
        leverage: 5,
        createdAt: prevCampaignPlacedAt,
        filledAt: t('2025-09-20T10:05:00.000Z'), // 成交落在窗口内
      },
    ];
    const prevCampaignPending: PendingOrder = {
      id: 'prev-campaign-pending-short',
      side: 'SHORT',
      type: 'CONDITIONAL',
      price: 1.5,
      stopPrice: 1.5,
      quantity: 100,
      leverage: 5,
      marginMode: 'isolated',
      status: 'PENDING',
      createdAt: prevCampaignPlacedAt, // 仍挂单，但挂单时间早于窗口
    };

    journals = [];
    localStorage.setItem('sim_user-1_trade_history', JSON.stringify([]));
    localStorage.setItem('sim_user-1_filled_orders', JSON.stringify(filledOrders));
    localStorage.setItem('sim_user-1_cancelled_orders', JSON.stringify(cancelledOrders));
    localStorage.setItem('sim_user-1_orders_map', JSON.stringify({ ASTERUSDT: [prevCampaignPending] }));

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    // 三笔都因挂单时间(09:20)早于 windowStart(09:55) 被排除。
    expect(reverseHedgeOrders).toEqual([]);
  });

  it('持仓面板挂单也按挂单时间归属：早于窗口的实时挂单不进本战役', async () => {
    // 战役 10:00–10:30，windowStart 09:55。同标的两笔实时挂单，只有窗口内那笔属本战役。
    const inWindowPending: PendingOrder = {
      id: 'in-window-pending',
      side: 'SHORT',
      type: 'CONDITIONAL',
      price: 1.2,
      stopPrice: 1.2,
      quantity: 100,
      leverage: 5,
      marginMode: 'isolated',
      status: 'PENDING',
      createdAt: t('2025-09-20T10:10:00.000Z'),
    };
    const preWindowPending: PendingOrder = {
      ...inWindowPending,
      id: 'pre-window-pending',
      createdAt: t('2025-09-20T09:20:00.000Z'), // 早于 windowStart 09:55（属上一场战役）
    };

    journals = [];
    localStorage.setItem('sim_user-1_trade_history', JSON.stringify([]));
    localStorage.setItem('sim_user-1_orders_map', JSON.stringify({ ASTERUSDT: [inWindowPending, preWindowPending] }));

    const { pendingOrders } = await getCampaignFullData(campaign.id);
    expect(pendingOrders.map(order => order.id)).toEqual(['in-window-pending']);
  });
});
