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
        price: 1.201,
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
      entryPrice: 1.201,
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
        pre_entry_price: 1.201,
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
      price: 1.2,
      fillPrice: 1.201,
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

  it('浏览器成交快照已被旧上限淘汰时，从预设委托对冲 leg 精确恢复已触发委托', async () => {
    const triggeredAt = t('2025-09-20T10:05:00.000Z');
    const closeTime = t('2025-09-20T10:20:00.000Z');
    journals = [
      makeLeg({
        id: 'legacy-limit-hedge-leg',
        trade_record_id: 'legacy-limit-hedge-record',
        order_kind: 'hedge',
        hedge_order_method: 'limit_preset',
        hedge_boundary_price: 1.2,
        pre_simulated_time: new Date(triggeredAt).toISOString(),
        pre_entry_price: 1.201,
        pre_position_size: 120,
      }),
    ];
    const tradeHistory: TradeRecord[] = [{
      id: 'legacy-limit-hedge-record',
      symbol: 'ASTERUSDT',
      side: 'SHORT',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 1.201,
      exitPrice: 1.1,
      quantity: 100,
      leverage: 5,
      pnl: 10,
      fee: 0,
      slippage: 0,
      openTime: triggeredAt,
      closeTime,
    }];
    localStorage.setItem('sim_user-1_trade_history', JSON.stringify(tradeHistory));

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders).toEqual([expect.objectContaining({
      id: 'legacy-limit-preset:legacy-limit-hedge-leg',
      tradeRecordId: 'legacy-limit-hedge-record',
      side: 'SHORT',
      price: 1.2,
      fillPrice: 1.201,
      createdAt: triggeredAt,
      triggeredAt,
      cancelledAt: closeTime,
      status: 'triggered',
    })]);
  });

  it('不会用市价追单 hedge leg 恢复黄色委托层', async () => {
    const triggeredAt = t('2025-09-20T10:05:00.000Z');
    journals = [
      makeLeg({
        id: 'market-chase-hedge-leg',
        trade_record_id: 'market-chase-hedge-record',
        order_kind: 'hedge',
        hedge_order_method: 'market_chase',
        pre_simulated_time: new Date(triggeredAt).toISOString(),
        pre_entry_price: 1.201,
      }),
    ];
    const tradeHistory: TradeRecord[] = [{
      id: 'market-chase-hedge-record',
      symbol: 'ASTERUSDT',
      side: 'SHORT',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 1.201,
      exitPrice: 1.1,
      quantity: 100,
      leverage: 5,
      pnl: 10,
      fee: 0,
      slippage: 0,
      openTime: triggeredAt,
      closeTime: t('2025-09-20T10:20:00.000Z'),
    }];
    localStorage.setItem('sim_user-1_trade_history', JSON.stringify(tradeHistory));

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders).toEqual([]);
  });

  it('从带明确委托 ID 的战役事件恢复已撤销委托', async () => {
    const createdAt = '2025-09-20T10:02:00.000Z';
    const cancelledAt = '2025-09-20T10:08:00.000Z';
    campaign.actual_evolution = [
      {
        id: 'placed-event',
        timestamp: createdAt,
        event_type: 'hedge_placed',
        leg_role: 'hedge_initial_a',
        journal_id: null,
        trade_record_id: null,
        pending_order_id: 'historical-cancelled-order',
        price: 1.19,
        size_usdt: 100,
        notes: null,
        recorded_at: createdAt,
        direction: 'short',
      },
      {
        id: 'cancelled-event',
        timestamp: cancelledAt,
        event_type: 'hedge_cancelled',
        leg_role: 'hedge_initial_a',
        journal_id: null,
        trade_record_id: null,
        pending_order_id: 'historical-cancelled-order',
        price: 1.19,
        size_usdt: 100,
        notes: null,
        recorded_at: cancelledAt,
        direction: 'short',
      },
    ];

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders).toEqual([expect.objectContaining({
      id: 'historical-cancelled-order',
      side: 'SHORT',
      price: 1.19,
      createdAt: t(createdAt),
      cancelledAt: t(cancelledAt),
      status: 'cancelled',
    })]);
  });

  it('【回归】同一段行情回放两次：委托按真实操作时间归属，上一次回放的单子不混进来', async () => {
    // 模拟时间轴：两次回放完全一样（都是 2025-09-20 10:00–10:30 那段行情）
    const createdAt = t('2025-09-20T10:01:00.000Z');
    const filledAt = t('2025-09-20T10:05:00.000Z');
    const closeTime = t('2025-09-20T10:20:00.000Z');
    // 真实时间轴：第一次回放在 9 月 5 日，本场（第二次）在 9 月 7 日
    const REPLAY_1 = Date.parse('2026-09-05T10:00:00.000Z');
    const REPLAY_2 = Date.parse('2026-09-07T09:00:00.000Z');
    const MIN = 60_000;

    const shortOpen = (
      id: string,
      createdRealAt: number | undefined,
      positionId: string,
      price = 1.201,
      createdAtSim = createdAt,
    ): FilledOrderSnapshot => ({
      id,
      symbol: 'ASTERUSDT',
      side: 'SHORT',
      type: 'CONDITIONAL',
      reduceOnly: false,
      reduceKind: null,
      price,
      triggerPrice: price,
      quantity: 100,
      leverage: 5,
      createdAt: createdAtSim,
      filledAt,
      positionId,
      ...(createdRealAt != null ? { createdRealAt, filledRealAt: createdRealAt + 4 * MIN } : {}),
    });
    // 上一次回放的那张单，模拟时间、价格、数量与本场主单**一模一样**——只差真实时刻
    const filledOrders: FilledOrderSnapshot[] = [
      shortOpen('short-open-replay-1', REPLAY_1 + 1 * MIN, 'short-position-old'),
      shortOpen('short-open-order', REPLAY_2 + 1 * MIN, 'short-position'),
      // 升级前的老委托：一个真实时刻都没有，但它开出的仓位是本场选中的腿（record-short-legacy）→ 保留（见下方断言）
      shortOpen('short-open-legacy', undefined, 'short-position-legacy', 1.21, t('2025-09-20T10:02:00.000Z')),
      // 同样一个真实时刻都没有、开出的仓位不在本场：本场是盖章时代打的，它不算本场
      shortOpen('short-open-legacy-orphan', undefined, 'short-position-legacy-orphan', 1.23, t('2025-09-20T10:03:00.000Z')),
      // 开主力前 2 分钟挂出的前置对冲：落在回看窗内 → 保留。
      // 现实里比主单早 3 分钟挂出，模拟时刻也必须更早（同一次回放里两只钟同向走）；
      // 原先写成 10:03（晚于主单的 10:01）是一条物理上不存在的时间线。
      shortOpen('short-prehedge-open', REPLAY_2 - 2 * MIN, 'short-position-pre', 1.22, t('2025-09-20T09:59:00.000Z')),
    ];
    const cancelledOrders: CancelledOrderSnapshot[] = [
      {
        id: 'short-cancelled-replay-1',
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
        createdRealAt: REPLAY_1 + 4 * MIN,
        cancelledRealAt: REPLAY_1 + 9 * MIN,
      },
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
        createdRealAt: REPLAY_2 + 4 * MIN,
        cancelledRealAt: REPLAY_2 + 9 * MIN,
      },
    ];
    const pendingBase: PendingOrder = {
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
      createdRealAt: REPLAY_2 + 8 * MIN,
    };
    const pendingReplay1: PendingOrder = { ...pendingBase, id: 'short-pending-replay-1', createdRealAt: REPLAY_1 + 8 * MIN };

    // 一张已成交的开仓委托对应一个仓位、一条平仓记录（既有去重规则：record 相同即视为同一张单），
    // 所以三张本场成交单各自带一条记录。老记录没有真实时刻。
    const closedRecord = (id: string, positionId: string, entryPrice: number, real?: { opened: number; closed: number }): TradeRecord => ({
      id,
      symbol: 'ASTERUSDT',
      side: 'SHORT',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice,
      exitPrice: 1.1,
      quantity: 100,
      leverage: 5,
      pnl: 10,
      fee: 0,
      slippage: 0,
      openTime: filledAt,
      closeTime,
      positionId,
      ...(real ? { openedRealAt: real.opened, closedRealAt: real.closed } : {}),
    } as TradeRecord);
    const tradeHistory: TradeRecord[] = [
      closedRecord('record-short-position', 'short-position', 1.201, { opened: REPLAY_2 + 5 * MIN, closed: REPLAY_2 + 20 * MIN }),
      closedRecord('record-short-legacy', 'short-position-legacy', 1.21),
      closedRecord('record-short-pre', 'short-position-pre', 1.22, { opened: REPLAY_2 + 2 * MIN, closed: REPLAY_2 + 18 * MIN }),
    ];
    journals = [
      makeLeg({
        id: 'leg-triggered-short',
        trade_record_id: 'record-short-position',
        leg_sequence: 1,
        pre_simulated_time: new Date(filledAt).toISOString(),
        pre_real_time: new Date(REPLAY_2 + 1 * MIN).toISOString(),
        pre_entry_price: 1.201,
        pre_position_size: 120,
      }),
      makeLeg({
        id: 'leg-legacy-short',
        trade_record_id: 'record-short-legacy',
        leg_sequence: 2,
        pre_simulated_time: new Date(filledAt).toISOString(),
        pre_real_time: new Date(REPLAY_2 + 2 * MIN).toISOString(),
        pre_entry_price: 1.21,
        pre_position_size: 121,
      }),
      makeLeg({
        id: 'leg-pre-short',
        trade_record_id: 'record-short-pre',
        leg_sequence: 3,
        pre_simulated_time: new Date(filledAt).toISOString(),
        pre_real_time: new Date(REPLAY_2 - 2 * MIN).toISOString(),
        pre_entry_price: 1.22,
        pre_position_size: 122,
      }),
    ];

    localStorage.setItem('sim_user-1_filled_orders', JSON.stringify(filledOrders));
    localStorage.setItem('sim_user-1_cancelled_orders', JSON.stringify(cancelledOrders));
    localStorage.setItem('sim_user-1_orders_map', JSON.stringify({ ASTERUSDT: [pendingBase, pendingReplay1] }));
    localStorage.setItem('sim_user-1_trade_history', JSON.stringify(tradeHistory));

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);
    const ids = reverseHedgeOrders.map(order => order.id);

    // 本场 + 前置对冲 + 开出本场仓位的老委托：保留
    expect([...ids].sort()).toEqual([
      'short-cancelled-open',
      'short-open-legacy',
      'short-open-order',
      'short-pending-open',
      'short-prehedge-open',
    ]);
    // 规则变更（2026-09-14）：原先期望没有真实时刻的老委托一律放行。但本场的委托带 createdRealAt、成交带 openedRealAt，
    // 证明本场是在真实时刻开始记录（2026-09-07）之后打的；挂单没盖章、模拟时刻又晚于本场第一个盖章证据的委托
    // 必然早于上线，只能是更早某次回放同一段行情留下的——TUTUSDT 8 月那次回放正是这样混进盘面的（L1）。
    // short-open-legacy 仍保留，是因为它成交开出的仓位是用户亲手归进本场的腿：这张委托就是本场的，不再过回放时间线。
    // 老战役（本场自己也没有盖章证据）里的无真实时刻委托仍然放行，见 TUTUSDT 组的老战役用例。
    expect(ids).not.toContain('short-open-legacy-orphan');
    // 上一次回放：三种状态的委托全部排除
    expect(ids).not.toContain('short-open-replay-1');
    expect(ids).not.toContain('short-cancelled-replay-1');
    expect(ids).not.toContain('short-pending-replay-1');
  });
});

describe('【用户要求】委托空单与本场操作时间对齐：TUTUSDT 2026-08-07 同一段行情多次回放', () => {
  const MIN = 60_000;
  /** 模拟时钟：北京 2026-08-07 19:41 开主力 → 2026-08-09 01:46 平仓。 */
  const SIM0 = t('2026-08-07T11:41:00.000Z');
  const SIM_CLOSE = t('2026-08-08T17:46:00.000Z');
  const sim = (minutes: number) => SIM0 + minutes * MIN;
  const iso = (ms: number) => new Date(ms).toISOString();
  /** 本场这遍回放：北京 2026-09-13 19:34 起、约 360 倍速，19:39 平主力——即 Legs 表上的「操作」时间。 */
  const REAL_MINE = t('2026-09-13T11:34:00.000Z');
  const realMine = (simAt: number) => REAL_MINE + Math.round((simAt - SIM0) / 360);
  /** 另一遍盖了章的回放：北京 2026-09-10 21:00 起、600 倍速。 */
  const REAL_OTHER = t('2026-09-10T13:00:00.000Z');
  const realOther = (simAt: number) => REAL_OTHER + Math.round((simAt - SIM0) / 600);

  const hedge = (
    id: string,
    createdAt: number,
    cancelledAt: number,
    stamps: { createdRealAt?: number; cancelledRealAt?: number } = {},
    price = 0.03005,
  ): CancelledOrderSnapshot => ({
    id,
    symbol: 'TUTUSDT',
    side: 'SHORT',
    type: 'CONDITIONAL',
    reduceOnly: false,
    reduceKind: null,
    price,
    quantity: 10_000,
    leverage: 5,
    createdAt,
    cancelledAt,
    ...stamps,
  });
  const mineHedge = (id: string, createdAt: number, cancelledAt: number, price?: number) =>
    hedge(id, createdAt, cancelledAt, { createdRealAt: realMine(createdAt), cancelledRealAt: realMine(cancelledAt) }, price);
  const otherHedge = (id: string, createdAt: number, cancelledAt: number, price?: number) =>
    hedge(id, createdAt, cancelledAt, { createdRealAt: realOther(createdAt), cancelledRealAt: realOther(cancelledAt) }, price);

  const mainRecord = (stamps: { openedRealAt?: number; closedRealAt?: number }): TradeRecord => ({
    id: 'tutu-main-record',
    positionId: 'tutu-main-position',
    fillId: 'tutu-main-position',
    symbol: 'TUTUSDT',
    side: 'LONG',
    type: 'MARKET',
    action: 'CLOSE',
    entryPrice: 0.0312,
    exitPrice: 0.0335,
    quantity: 10_000,
    leverage: 5,
    pnl: 23,
    fee: 0,
    slippage: 0,
    openTime: SIM0,
    closeTime: SIM_CLOSE,
    ...stamps,
  } as TradeRecord);
  /** 回填腿：pre_real_time 是归类时刻；平仓两只钟各自独立，post_real_close_time 就是「操作」时间。 */
  const retroLeg = (overrides: Partial<TradeJournal>) => makeLeg({
    symbol: 'TUTUSDT',
    source: 'retroactive_from_record',
    pre_real_time: '2026-09-13T12:10:00.000Z',
    ...overrides,
  });
  const mainLeg = () => retroLeg({
    id: 'tutu-main-leg',
    trade_record_id: 'tutu-main-record',
    leg_role: 'main_open',
    leg_sequence: 1,
    direction: 'long',
    pre_simulated_time: iso(SIM0),
    pre_entry_price: 0.0312,
    post_simulated_close_time: iso(SIM_CLOSE),
    post_real_close_time: iso(realMine(SIM_CLOSE)),          // 北京 19:39
  });
  const mirrorLeg = () => retroLeg({
    id: 'tutu-mirror-leg',
    trade_record_id: 'tutu-mirror-record',
    leg_role: 'mirror_tp',
    leg_sequence: 2,
    direction: 'long',
    pre_simulated_time: iso(sim(1)),
    pre_entry_price: 0.0313,
    post_simulated_close_time: iso(sim(8)),
    post_real_close_time: iso(realMine(sim(8))),             // 北京 19:34
  });

  const store = (data: {
    tradeHistory?: TradeRecord[];
    cancelled?: CancelledOrderSnapshot[];
    filled?: FilledOrderSnapshot[];
    pending?: PendingOrder[];
  }) => {
    localStorage.setItem('sim_user-1_trade_history', JSON.stringify(data.tradeHistory ?? []));
    localStorage.setItem('sim_user-1_cancelled_orders', JSON.stringify(data.cancelled ?? []));
    localStorage.setItem('sim_user-1_filled_orders', JSON.stringify(data.filled ?? []));
    localStorage.setItem('sim_user-1_orders_map', JSON.stringify({ TUTUSDT: data.pending ?? [] }));
  };

  beforeEach(() => {
    localStorage.clear();
    journals = [];
    campaign = {
      id: 'campaign-1',
      user_id: 'user-1',
      symbol: 'TUTUSDT',
      direction: 'main_long',
      status: 'closed_profit',
      strategy_template: 'custom',
      title: 'TUTUSDT 2026-08-07 多战役',
      opened_at: iso(SIM0),
      closed_at: iso(SIM_CLOSE),
      initial_main_size_usdt: null,
      initial_leverage: null,
      final_realized_pnl: null,
      final_r_multiple: null,
      peak_unrealized_pnl: null,
      peak_drawdown: null,
      notes: null,
      actual_evolution: [],
      created_at: '2026-09-13T12:10:00.000Z',
      updated_at: '2026-09-13T12:10:00.000Z',
    } as TradeCampaign;
  });

  it('【回归 L1】8 月回放同一段行情留下的无真实时刻委托，不混进 9 月盖章时代打的本场', async () => {
    journals = [mainLeg(), mirrorLeg()];
    const minePending: PendingOrder = {
      id: 'mine-pending-0288000',
      side: 'SHORT',
      type: 'CONDITIONAL',
      price: 0.0288,
      stopPrice: 0.0288,
      quantity: 10_000,
      leverage: 5,
      marginMode: 'isolated',
      status: 'PENDING',
      createdAt: sim(20 * 60),
      createdRealAt: realMine(sim(20 * 60)),
    };
    const augustPending: PendingOrder = {
      ...minePending,
      id: 'aug-pending-0288000',
      createdAt: sim(20 * 60) + 20_000,
      createdRealAt: undefined,
    };
    store({
      tradeHistory: [mainRecord({ openedRealAt: realMine(SIM0), closedRealAt: realMine(SIM_CLOSE) })],
      cancelled: [
        mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
        // 8 月那次回放：同一分钟、同一价格，一个真实时刻都没有
        hedge('aug-0300500-1942', sim(1) + 15_000, sim(5 * 60)),
      ],
      pending: [minePending, augustPending],
    });

    const { reverseHedgeOrders, pendingOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942', 'mine-pending-0288000']);
    expect(pendingOrders.map(order => order.id)).toEqual(['mine-pending-0288000']);
  });

  it('【回归 L2】挂单没盖章、撤单 / 成交盖了章：按撤单 / 成交的真实时刻归到另一次回放，排除', async () => {
    journals = [mainLeg(), mirrorLeg()];
    store({
      tradeHistory: [mainRecord({ openedRealAt: realMine(SIM0), closedRealAt: realMine(SIM_CLOSE) })],
      cancelled: [
        mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
        hedge('partial-cancelled-0300500-1942', sim(1) + 15_000, sim(5 * 60), { cancelledRealAt: realOther(sim(5 * 60)) }),
      ],
      filled: [{
        id: 'partial-filled-0299000',
        symbol: 'TUTUSDT',
        side: 'SHORT',
        type: 'CONDITIONAL',
        reduceOnly: false,
        reduceKind: null,
        price: 0.0299,
        triggerPrice: 0.0299,
        quantity: 10_000,
        leverage: 5,
        createdAt: sim(3),
        filledAt: sim(4 * 60),
        filledRealAt: realOther(sim(4 * 60)),
      }],
    });

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942']);
  });

  it('【回归 L3】本地成交被清掉、只剩腿上的操作时间：另一次回放的委托仍被排除，本场的保留', async () => {
    // 「清除标的数据」删了 trade_history，委托快照还在；Legs 表照样显示 19:34 / 19:39 的操作时间
    journals = [mainLeg(), mirrorLeg()];
    store({
      tradeHistory: [],
      cancelled: [
        mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
        mineHedge('mine-0290000-late', sim(20 * 60), sim(22 * 60), 0.029),
        otherHedge('other-0300500-1942', sim(1) + 15_000, sim(6 * 60)),
        otherHedge('other-0290000-late', sim(20 * 60) + 30_000, sim(22 * 60), 0.029),
      ],
    });

    const { tradeRecords, reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(tradeRecords).toEqual([]);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942', 'mine-0290000-late']);
  });

  it('【回归 L4】主力在第 A 遍开、倒回后第 B 遍平：A 遍倒回点之后挂的单不再与 B 遍成对出现', async () => {
    const REAL_PASS_A = t('2026-09-13T10:00:00.000Z');
    journals = [mainLeg()];
    store({
      // 开仓真实时刻在 A 遍，平仓真实时刻在 B 遍——两段都含本场锚点
      tradeHistory: [mainRecord({ openedRealAt: REAL_PASS_A, closedRealAt: realMine(SIM_CLOSE) })],
      cancelled: [
        // A 遍：开主力前 2 分钟挂的前置对冲——B 遍从 19:42 起重走，没有重走到它，保留
        hedge('passA-prehedge-1939', sim(-2), sim(90), {
          createdRealAt: REAL_PASS_A - 30_000,
          cancelledRealAt: REAL_PASS_A + 5 * MIN,
        }, 0.0301),
        // A 遍：19:42 挂的 0.0300500——跳回去后 B 遍在同一分钟、同一价格又挂了一张
        hedge('passA-0300500-1942', sim(1) + 20_000, sim(3 * 60), {
          createdRealAt: REAL_PASS_A + 30_000,
          cancelledRealAt: REAL_PASS_A + 6 * MIN,
        }),
        mineHedge('passB-0300500-1942', sim(1), sim(6 * 60)),
      ],
    });

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['passA-prehedge-1939', 'passB-0300500-1942']);
  });

  it('【回归 C】挂好前置对冲后停了 10 分钟（现实）才开主力：同一遍回放里的对冲不被现实回看误踢', async () => {
    journals = [mainLeg()];
    store({
      tradeHistory: [mainRecord({ openedRealAt: REAL_MINE, closedRealAt: realMine(SIM_CLOSE) })],
      cancelled: [
        // 模拟时间只早 2 分钟（在 5 分钟模拟回看内），现实里早 10 分钟（超出旧的 5 分钟现实回看）
        hedge('prehedge-paused-1939', sim(-2), sim(2 * 60), {
          createdRealAt: REAL_MINE - 10 * MIN,
          cancelledRealAt: realMine(sim(2 * 60)),
        }, 0.0301),
        mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
      ],
    });

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['prehedge-paused-1939', 'mine-0300500-1942']);
  });

  it('【老战役】本场自己没有盖章证据：无真实时刻的委托照旧保留，盖了章的另一次回放照样排除', async () => {
    const REAL_JUNE = t('2026-06-20T12:00:00.000Z');
    journals = [retroLeg({
      id: 'tutu-june-main-leg',
      trade_record_id: 'tutu-main-record',
      leg_role: 'main_open',
      direction: 'long',
      pre_simulated_time: iso(SIM0),
      pre_entry_price: 0.0312,
    })];
    store({
      // 6 月的成交只有 closedRealAt（openedRealAt 9 月才开始记）
      tradeHistory: [mainRecord({ closedRealAt: REAL_JUNE + 5 * MIN })],
      cancelled: [
        hedge('june-0300500-1942', sim(1), sim(6 * 60)),
        otherHedge('other-0300500-1942', sim(1) + 15_000, sim(6 * 60)),
      ],
    });

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['june-0300500-1942']);
  });

  it('战役事件恢复的委托：有快照按快照的两只钟判，没有快照就是本场事件流自己记下的、保留', async () => {
    journals = [mainLeg()];
    const event = (id: string, orderId: string, eventType: 'hedge_placed' | 'hedge_cancelled', at: number) => ({
      id,
      timestamp: iso(at),
      event_type: eventType,
      leg_role: 'hedge_initial_a' as const,
      journal_id: null,
      trade_record_id: null,
      pending_order_id: orderId,
      price: 0.03005,
      size_usdt: 300,
      notes: null,
      recorded_at: iso(at),
      direction: 'short' as const,
    });
    campaign.actual_evolution = [
      event('other-placed', 'other-evt-0300500-1942', 'hedge_placed', sim(1) + 15_000),
      event('other-cancelled', 'other-evt-0300500-1942', 'hedge_cancelled', sim(6 * 60)),
      event('orphan-placed', 'orphan-evt-0300500-1942', 'hedge_placed', sim(1) + 30_000),
      event('orphan-cancelled', 'orphan-evt-0300500-1942', 'hedge_cancelled', sim(5 * 60)),
    ] as TradeCampaign['actual_evolution'];
    store({
      tradeHistory: [mainRecord({ openedRealAt: realMine(SIM0), closedRealAt: realMine(SIM_CLOSE) })],
      cancelled: [
        mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
        otherHedge('other-evt-0300500-1942', sim(1) + 15_000, sim(6 * 60)),
      ],
    });

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    // other-evt：本地快照在，按快照判到 9 月 10 日那次回放，排除。
    // orphan-evt：只记在本场事件流里、没有快照——本场自己记下的单子，保留（事件只有模拟钟，判不了回放时间线）。
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942', 'orphan-evt-0300500-1942']);
  });

  const shortFill = (
    id: string,
    createdAt: number,
    filledAt: number,
    stamps: { createdRealAt?: number; filledRealAt?: number } = {},
    positionId?: string,
    price = 0.0299,
  ): FilledOrderSnapshot => ({
    id,
    symbol: 'TUTUSDT',
    side: 'SHORT',
    type: 'CONDITIONAL',
    reduceOnly: false,
    reduceKind: null,
    price,
    triggerPrice: price,
    quantity: 10_000,
    leverage: 5,
    createdAt,
    filledAt,
    ...(positionId ? { positionId } : {}),
    ...stamps,
  });
  const shortPending = (id: string, createdAt: number, createdRealAt: number, price = 0.0302): PendingOrder => ({
    id,
    side: 'SHORT',
    type: 'CONDITIONAL',
    price,
    stopPrice: price,
    quantity: 10_000,
    leverage: 5,
    marginMode: 'isolated',
    status: 'PENDING',
    createdAt,
    createdRealAt,
  });

  it('【复核】挂单没盖章的 8 月老委托，被这遍撤掉 / ⏹ 停止一键撤掉 / 触发成交而盖上结束时刻，也不混进盖章时代的本场', async () => {
    journals = [mainLeg(), mirrorLeg()];
    store({
      tradeHistory: [mainRecord({ openedRealAt: realMine(SIM0), closedRealAt: realMine(SIM_CLOSE) })],
      cancelled: [
        mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
        // 8 月挂出、一直挂到这遍才被手动撤掉：只有撤单时刻
        hedge('aug-carried-cancelled-1942', sim(1) + 15_000, sim(5 * 60), { cancelledRealAt: realMine(sim(5 * 60)) }),
        // 平仓后按 ⏹ 停止：handleStop 对每张挂单调 handleCancelOrder，撤单时刻盖在平仓之后 10 秒
        hedge('aug-stop-cancelled-1943', sim(2), SIM_CLOSE, { cancelledRealAt: realMine(SIM_CLOSE) + 10_000 }),
      ],
      filled: [shortFill('aug-carried-filled-0299000', sim(3), sim(4 * 60), { filledRealAt: realMine(sim(4 * 60)) })],
    });

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942']);
  });

  it('【复核】跨过盖章上线那一刻打的战役：上线前挂的对冲没有真实时刻照样保留，晚于上线证据的无章委托仍排除', async () => {
    const REAL_POST_ROLLOUT = t('2026-09-08T02:00:00.000Z');
    journals = [retroLeg({
      id: 'tutu-straddle-main-leg',
      trade_record_id: 'tutu-main-record',
      leg_role: 'main_open',
      direction: 'long',
      pre_simulated_time: iso(SIM0),
      pre_entry_price: 0.0312,
    })];
    store({
      // 主力 09-06 开（上线前，没有 openedRealAt），刷新到新代码后 09-08 平
      tradeHistory: [mainRecord({ closedRealAt: REAL_POST_ROLLOUT + 30 * MIN })],
      cancelled: [
        hedge('pre-rollout-hedge', sim(1), sim(30)),
        hedge('post-rollout-hedge', sim(60), sim(90), {
          createdRealAt: REAL_POST_ROLLOUT,
          cancelledRealAt: REAL_POST_ROLLOUT + MIN,
        }),
        // 模拟时刻晚于上线后的第一张委托，却一个真实时刻都没有：不可能是这一遍挂的
        hedge('unstamped-after-rollout', sim(120), sim(150), {}, 0.0296),
      ],
    });

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['pre-rollout-hedge', 'post-rollout-hedge']);
  });

  it('【复核】老战役之后同一标的往后接着打了一遍盖章的回放（不切段）：老战役自己没盖章的委托照旧保留', async () => {
    const REAL_JUNE = t('2026-06-20T12:00:00.000Z');
    const REAL_SEPT = t('2026-09-10T13:00:00.000Z');
    const SIM_AUG_20 = t('2026-08-20T02:00:00.000Z');
    journals = [retroLeg({
      id: 'tutu-june-main-leg',
      trade_record_id: 'tutu-main-record',
      leg_role: 'main_open',
      direction: 'long',
      pre_simulated_time: iso(SIM0),
      pre_entry_price: 0.0312,
    })];
    store({
      tradeHistory: [mainRecord({ closedRealAt: REAL_JUNE + 5 * MIN })],
      cancelled: [
        hedge('june-0300500-1942', sim(1), sim(6 * 60)),
        // 9 月 10 日从 08-20 起往后打：模拟时间只往前走，并进了 6 月那一段（在本场模拟窗口之外，本身不显示）
        hedge('sept-0820-order', SIM_AUG_20, SIM_AUG_20 + 30 * MIN, {
          createdRealAt: REAL_SEPT,
          cancelledRealAt: REAL_SEPT + 3 * MIN,
        }),
      ],
    });

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['june-0300500-1942']);
  });

  it('【复核 L4】活过倒回的委托不被取代：A 遍挂、B 遍才成交的对冲，与 A 遍成交后仓位带进 B 遍的对冲都保留', async () => {
    const REAL_PASS_A = t('2026-09-13T10:00:00.000Z');
    journals = [
      mainLeg(),
      retroLeg({
        id: 'passA-hedge-leg',
        trade_record_id: 'passA-hedge-record',
        leg_role: 'hedge_initial_a',
        leg_sequence: 2,
        direction: 'short',
        pre_simulated_time: iso(sim(31)),
        pre_entry_price: 0.0302,
      }),
    ];
    const hedgeRecord = {
      ...mainRecord({ openedRealAt: REAL_PASS_A + 3 * MIN, closedRealAt: realMine(sim(10 * 60)) }),
      id: 'passA-hedge-record',
      positionId: 'passA-hedge-position',
      fillId: 'passA-hedge-position',
      side: 'SHORT',
      entryPrice: 0.0302,
      exitPrice: 0.0298,
      openTime: sim(31),
      closeTime: sim(10 * 60),
    } as TradeRecord;
    store({
      tradeHistory: [mainRecord({ openedRealAt: REAL_PASS_A, closedRealAt: realMine(SIM_CLOSE) }), hedgeRecord],
      cancelled: [
        // A 遍 19:42 挂、A 遍里就撤了：B 遍重走了这一分钟，取代
        hedge('passA-0300500-1942', sim(1) + 20_000, sim(3 * 60), {
          createdRealAt: REAL_PASS_A + 30_000,
          cancelledRealAt: REAL_PASS_A + 6 * MIN,
        }),
        mineHedge('passB-0300500-1942', sim(1), sim(6 * 60)),
      ],
      filled: [
        // A 遍 20:11 挂出，跳回去时没撤（handleJumpToSignal 不动 ordersMap），B 遍 20:41 才成交
        shortFill('passA-carried-filled-in-B', sim(30), sim(60), {
          createdRealAt: REAL_PASS_A + MIN,
          filledRealAt: realMine(sim(60)),
        }, undefined, 0.0301),
        // A 遍里挂出并成交，开出的对冲仓位带过倒回、在 B 遍平掉——这条仓位是本场选中的腿
        shortFill('passA-hedge-filled', sim(30) + 30_000, sim(31), {
          createdRealAt: REAL_PASS_A + 2 * MIN,
          filledRealAt: REAL_PASS_A + 3 * MIN,
        }, 'passA-hedge-position', 0.0302),
      ],
    });

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual([
      'passB-0300500-1942',
      'passA-carried-filled-in-B',
      'passA-hedge-filled',
    ]);
  });

  it('【复核 L4】A 遍挂出、倒回后至今仍挂着的对冲：持仓面板与委托层都保留（否则会误判没有对冲挂单、提示结束战役）', async () => {
    const REAL_PASS_A = t('2026-09-13T10:00:00.000Z');
    campaign.closed_at = null;
    campaign.status = 'active';
    journals = [mainLeg()];
    store({
      tradeHistory: [mainRecord({ openedRealAt: REAL_PASS_A, closedRealAt: realMine(SIM_CLOSE) })],
      cancelled: [mineHedge('passB-0300500-1942', sim(1), sim(6 * 60))],
      pending: [shortPending('passA-pending-still-live', sim(30), REAL_PASS_A + MIN)],
    });

    const { pendingOrders, reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(pendingOrders.map(order => order.id)).toEqual(['passA-pending-still-live']);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['passB-0300500-1942', 'passA-pending-still-live']);
  });

  it('【复核 L4】B 遍先绕去 08-01 的信号、再一跳到 08-08 继续：A 遍 20:41 的对冲从没被重走，保留', async () => {
    const REAL_PASS_A = t('2026-09-13T10:00:00.000Z');
    const SIM_DETOUR = t('2026-08-01T04:00:00.000Z');
    const SIM_CONTINUE = t('2026-08-08T08:46:00.000Z');      // 北京 08-08 16:46
    journals = [mainLeg()];
    store({
      tradeHistory: [mainRecord({ openedRealAt: REAL_PASS_A, closedRealAt: REAL_PASS_A + 30 * MIN })],
      cancelled: [
        hedge('passA-hedge-2041', sim(60), sim(70), {
          createdRealAt: REAL_PASS_A + MIN,
          cancelledRealAt: REAL_PASS_A + 2 * MIN,
        }),
        // 带着仓位跳到 08-01 的信号，挂了一张又撤掉（在本场模拟窗口之外，本身不显示）
        hedge('detour-0801', SIM_DETOUR, SIM_DETOUR + 10 * MIN, {
          createdRealAt: REAL_PASS_A + 10 * MIN,
          cancelledRealAt: REAL_PASS_A + 11 * MIN,
        }),
        // 再往前一跳到 08-08 16:46 继续打：往前跳不切段，这一段的起点是 08-01
        hedge('continuation-0808', SIM_CONTINUE, SIM_CONTINUE + 20 * MIN, {
          createdRealAt: REAL_PASS_A + 20 * MIN,
          cancelledRealAt: REAL_PASS_A + 21 * MIN,
        }),
      ],
    });

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['passA-hedge-2041', 'continuation-0808']);
  });

  it('【复核 C】进行中的战役还没有任何平仓：靠实时腿的记录决策时刻建分段，停下来想了 10 分钟的前置对冲不被现实回看误踢', async () => {
    campaign.closed_at = null;
    campaign.status = 'active';
    journals = [makeLeg({
      id: 'tutu-live-main-leg',
      symbol: 'TUTUSDT',
      source: 'live',
      leg_role: 'main_open',
      leg_sequence: 1,
      direction: 'long',
      pre_simulated_time: iso(SIM0),
      pre_real_time: iso(REAL_MINE),
      pre_entry_price: 0.0312,
    })];
    store({
      tradeHistory: [],
      pending: [
        // 9 月 10 日那次回放同一段行情留下、至今还挂着的单
        shortPending('other-replay-pending', sim(1) + 15_000, realOther(sim(1))),
        // 模拟时间早 2 分钟（在 5 分钟模拟回看内），现实里早 10 分钟（超出旧的 5 分钟现实回看）
        shortPending('paused-prehedge', sim(-2), REAL_MINE - 10 * MIN, 0.0301),
        shortPending('after-main', sim(1), REAL_MINE + MIN),
      ],
    });

    const { pendingOrders, reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(pendingOrders.map(order => order.id)).toEqual(['paused-prehedge', 'after-main']);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['paused-prehedge', 'after-main']);
  });

  it('【复核二 F1】三天前在同一信号上挂了前置对冲又放弃：那次的委托不因模拟时间没有回落就并进本场', async () => {
    const REAL_SEPT10 = t('2026-09-10T13:00:00.000Z');
    journals = [mainLeg()];
    store({
      tradeHistory: [mainRecord({ openedRealAt: REAL_MINE, closedRealAt: realMine(SIM_CLOSE) })],
      cancelled: [
        hedge('sept10-prehedge-1938', sim(-3), sim(-2), {
          createdRealAt: REAL_SEPT10,
          cancelledRealAt: REAL_SEPT10 + 10_000,
        }, 0.0301),
        mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
      ],
      pending: [shortPending('sept10-live-1939', sim(-2.5), REAL_SEPT10 + 5_000, 0.0301)],
    });

    const { reverseHedgeOrders, pendingOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942']);
    expect(pendingOrders).toEqual([]);
  });

  it('【复核二 F2】取代不看同一分钟里谁先谁后：A 遍那张的模拟时刻比 B 遍早几秒，照样被 B 遍取代', async () => {
    const REAL_PASS_A = t('2026-09-13T10:00:00.000Z');
    journals = [mainLeg()];
    store({
      tradeHistory: [mainRecord({ openedRealAt: REAL_PASS_A, closedRealAt: realMine(SIM_CLOSE) })],
      cancelled: [
        hedge('passA-0300500-1942', sim(1), sim(3 * 60), {
          createdRealAt: REAL_PASS_A + 30_000,
          cancelledRealAt: REAL_PASS_A + 6 * MIN,
        }),
        mineHedge('passB-0300500-1942', sim(1) + 15_000, sim(6 * 60)),
      ],
    });

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['passB-0300500-1942']);
  });

  it('【复核二 F3】8 月回放留在开主力前 5 分钟回看窗里的无章委托（撤了 / ⏹ 停止撤的 / 至今挂着）也不混进盖章时代的本场', async () => {
    journals = [mainLeg()];
    store({
      tradeHistory: [mainRecord({ openedRealAt: realMine(SIM0), closedRealAt: realMine(SIM_CLOSE) })],
      cancelled: [
        mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
        hedge('aug-prehedge-1938', sim(-3), sim(-1), {}, 0.0301),
        hedge('aug-carried-prehedge-stop', sim(-4), SIM_CLOSE, { cancelledRealAt: realMine(SIM_CLOSE) + 10_000 }, 0.0302),
      ],
      pending: [{ ...shortPending('aug-live-prehedge', sim(-2), 0, 0.0303), createdRealAt: undefined }],
    });

    const { reverseHedgeOrders, pendingOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942']);
    expect(pendingOrders).toEqual([]);
  });

  it('【复核二 F4】本地成交被清掉、本场这遍没留下盖章委托：腿上 9 月的平仓操作时刻同样证明这段是盖章时代打的', async () => {
    journals = [mainLeg(), mirrorLeg()];
    store({
      tradeHistory: [],
      cancelled: [
        hedge('aug-0300500-1942', sim(1) + 15_000, sim(5)),
        hedge('aug-0290000-2141', sim(120), sim(150), {}, 0.029),
        otherHedge('other-0300500-1942', sim(1) + 15_000, sim(6 * 60)),
      ],
    });

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders).toEqual([]);
  });

  it('【复核二 F5】进行中的战役带着主力倒回：倒回后这一遍挂的对冲仍在持仓面板与委托层，A 遍里就结束的单子被取代', async () => {
    campaign.closed_at = null;
    campaign.status = 'active';
    journals = [makeLeg({
      id: 'tutu-live-main-leg',
      symbol: 'TUTUSDT',
      source: 'live',
      leg_role: 'main_open',
      leg_sequence: 1,
      direction: 'long',
      pre_simulated_time: iso(SIM0),
      pre_real_time: iso(REAL_MINE),
      pre_entry_price: 0.0312,
    })];
    store({
      tradeHistory: [],
      cancelled: [hedge('A-late', sim(590), sim(600), {
        createdRealAt: REAL_MINE + 5 * MIN,
        cancelledRealAt: REAL_MINE + 6 * MIN,
      }, 0.0296)],
      pending: [
        shortPending('A-pending', sim(60), REAL_MINE + MIN, 0.0301),
        // 倒回到 sim+120m 之后：主力还开着，这一遍给它挂的对冲
        shortPending('B-pending', sim(130), REAL_MINE + 40 * MIN, 0.0299),
      ],
    });

    const { pendingOrders, reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(pendingOrders.map(order => order.id)).toEqual(['A-pending', 'B-pending']);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['A-pending', 'B-pending']);
  });

  it('【复核二 F6】两笔成交合并成一个对冲仓位、带过倒回在 B 遍平掉：并进去的那笔（仓位 id 只在 fillId 上）不被取代', async () => {
    const REAL_PASS_A = t('2026-09-13T10:00:00.000Z');
    journals = [
      mainLeg(),
      retroLeg({
        id: 'merged-hedge-leg',
        trade_record_id: 'P1',
        leg_role: 'hedge_initial_a',
        leg_sequence: 2,
        direction: 'short',
        pre_simulated_time: iso(sim(10)),
        pre_entry_price: 0.0302,
      }),
    ];
    const hedgeFillRecord = (id: string, fillId: string, openTime: number, openedRealAt: number, entryPrice: number) => ({
      ...mainRecord({ openedRealAt, closedRealAt: realMine(sim(300)) }),
      id,
      positionId: 'P1',
      fillId,
      side: 'SHORT',
      entryPrice,
      exitPrice: 0.0295,
      openTime,
      closeTime: sim(300),
    } as TradeRecord);
    store({
      tradeHistory: [
        mainRecord({ openedRealAt: REAL_PASS_A, closedRealAt: realMine(SIM_CLOSE) }),
        hedgeFillRecord('h1', 'P1', sim(10), REAL_PASS_A + MIN, 0.0302),
        hedgeFillRecord('h2', 'P2', sim(50), REAL_PASS_A + 4 * MIN, 0.0303),
      ],
      cancelled: [
        hedge('A-late', sim(100), sim(110), { createdRealAt: REAL_PASS_A + 6 * MIN, cancelledRealAt: REAL_PASS_A + 7 * MIN }, 0.0297),
        mineHedge('B-hedge', sim(25), sim(200), 0.0298),
      ],
      filled: [
        shortFill('o1', sim(5), sim(10), { createdRealAt: REAL_PASS_A + 30_000, filledRealAt: REAL_PASS_A + MIN }, 'P1', 0.0302),
        // 合并保留最早那笔的仓位 id（P1），快照上记的却是这笔成交自己开出的仓位 id（P2）
        shortFill('o2-merged', sim(40), sim(50), { createdRealAt: REAL_PASS_A + 3 * MIN, filledRealAt: REAL_PASS_A + 4 * MIN }, 'P2', 0.0303),
      ],
    });

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['o1', 'B-hedge', 'o2-merged']);
  });

  it('【复核二 F7】本场事件流里记着的委托、本地已没有快照：它是本场自己记下的，不因无真实时刻被踢', async () => {
    journals = [mainLeg()];
    const event = (id: string, eventType: 'hedge_placed' | 'hedge_cancelled', at: number) => ({
      id,
      timestamp: iso(at),
      event_type: eventType,
      leg_role: 'hedge_initial_a' as const,
      journal_id: 'tutu-main-leg',
      trade_record_id: null,
      pending_order_id: 'evt-order',
      price: 0.03005,
      size_usdt: 300,
      notes: null,
      recorded_at: iso(at),
      direction: 'short' as const,
    });
    campaign.actual_evolution = [
      event('evt-placed', 'hedge_placed', sim(30)),
      event('evt-cancelled', 'hedge_cancelled', sim(90)),
    ] as TradeCampaign['actual_evolution'];
    store({ tradeHistory: [mainRecord({ openedRealAt: REAL_MINE, closedRealAt: REAL_MINE + 60 * MIN })] });

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => `${order.id}|${order.status}`)).toEqual(['evt-order|cancelled']);
  });

  it('【复核二 F8】6 月的老战役，之后 9 月从它平仓后的行情往后接着打：老战役那张没盖章、晚于 9 月起点才撤的对冲照旧保留', async () => {
    const REAL_JUNE = t('2026-06-20T12:00:00.000Z');
    const REAL_SEPT = t('2026-09-10T13:00:00.000Z');
    journals = [retroLeg({
      id: 'tutu-june-main-leg',
      trade_record_id: 'tutu-main-record',
      leg_role: 'main_open',
      direction: 'long',
      pre_simulated_time: iso(SIM0),
      pre_entry_price: 0.0312,
    })];
    store({
      tradeHistory: [mainRecord({ closedRealAt: REAL_JUNE + 5 * MIN })],
      cancelled: [
        hedge('june-hedge', sim(30), SIM_CLOSE + 120 * MIN),
        hedge('sept-unrelated', SIM_CLOSE + 60 * MIN, SIM_CLOSE + 70 * MIN, {
          createdRealAt: REAL_SEPT,
          cancelledRealAt: REAL_SEPT + MIN,
        }),
      ],
    });

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => `${order.id}|${order.status}`)).toEqual(['june-hedge|cancelled']);
  });

  it('【复核三 F1】持仓跨过资金费时段：资金费结算记录（没有 openedRealAt）不让本场被误判为跨上线，8 月回看窗里的无章委托照样排除', async () => {
    const SIM_FUNDING = t('2026-08-07T16:00:30.000Z');
    journals = [mainLeg()];
    store({
      tradeHistory: [
        mainRecord({ openedRealAt: realMine(SIM0), closedRealAt: realMine(SIM_CLOSE) }),
        {
          id: 'funding-0807-16',
          symbol: 'TUTUSDT',
          side: 'LONG',
          type: 'FUNDING',
          action: 'FUNDING',
          entryPrice: 0.0315,
          exitPrice: 0,
          quantity: 10_000,
          leverage: 5,
          pnl: -0.03,
          fee: 0.03,
          slippage: 0,
          openTime: SIM_FUNDING,
          closeTime: SIM_FUNDING,
          closedRealAt: realMine(SIM_FUNDING),
        } as TradeRecord,
      ],
      cancelled: [
        mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
        hedge('aug-prehedge-1938', sim(-3), sim(-1), {}, 0.0301),
        hedge('aug-carried-prehedge-stop', sim(-4), SIM_CLOSE, { cancelledRealAt: realMine(SIM_CLOSE) + 10_000 }, 0.0302),
      ],
      pending: [{ ...shortPending('aug-live-prehedge', sim(-2), 0, 0.0303), createdRealAt: undefined }],
    });

    const { reverseHedgeOrders, pendingOrders } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942']);
    expect(pendingOrders).toEqual([]);
  });

  const liveMainLeg = () => makeLeg({
    id: 'tutu-live-main-leg',
    symbol: 'TUTUSDT',
    source: 'live',
    leg_role: 'main_open',
    leg_sequence: 1,
    direction: 'long',
    pre_simulated_time: iso(SIM0),
    pre_real_time: iso(REAL_MINE),
    pre_entry_price: 0.0312,
  });

  it('【复核三 F2】进行中的战役隔天回来接着往后打（没有倒回）：第二天挂的对冲仍在持仓面板与委托层', async () => {
    campaign.closed_at = null;
    campaign.status = 'active';
    journals = [liveMainLeg()];
    store({
      tradeHistory: [],
      pending: [
        shortPending('day1-after-main', sim(1), REAL_MINE + MIN),
        shortPending('day2-continued-hedge', sim(180), REAL_MINE + 20 * 60 * MIN, 0.0299),
      ],
    });

    const { pendingOrders, reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(pendingOrders.map(order => order.id)).toEqual(['day1-after-main', 'day2-continued-hedge']);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['day1-after-main', 'day2-continued-hedge']);
  });

  it('【复核三 F4】挂好对冲后把时间机器倒回几分钟再开主力：至今挂着的那张仍在持仓面板；倒回前就撤掉的不算', async () => {
    campaign.closed_at = null;
    campaign.status = 'active';
    journals = [liveMainLeg()];
    store({
      tradeHistory: [],
      cancelled: [hedge('pre-rewind-cancelled', sim(6), sim(7), {
        createdRealAt: REAL_MINE - 3 * MIN,
        cancelledRealAt: REAL_MINE - 2.5 * MIN,
      }, 0.0304)],
      pending: [
        shortPending('pre-rewind-hedge-live', sim(8), REAL_MINE - 2 * MIN, 0.0301),
        shortPending('after-main', sim(3), REAL_MINE + MIN),
      ],
    });

    const { pendingOrders, reverseHedgeOrders } = await getCampaignFullData(campaign.id);

    expect(pendingOrders.map(order => order.id)).toEqual(['pre-rewind-hedge-live', 'after-main']);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['after-main', 'pre-rewind-hedge-live']);
  });
});
