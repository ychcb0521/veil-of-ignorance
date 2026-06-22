import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeCampaign } from '@/types/journal';
import type { CancelledOrderSnapshot, FilledOrderSnapshot, PendingOrder, TradeRecord } from '@/types/trading';

const t = (iso: string) => Date.parse(iso);

let campaign: TradeCampaign;

vi.mock('@/integrations/supabase/client', () => {
  function from(table: string) {
    const resolveResult = () => {
      if (table === 'trade_campaigns') return { data: campaign, error: null };
      if (table === 'trade_journals') return { data: [], error: null };
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

describe('getCampaignFullData reverse hedge order layer', () => {
  beforeEach(() => {
    localStorage.clear();
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

    localStorage.setItem('sim_user-1_filled_orders', JSON.stringify(filledOrders));
    localStorage.setItem('sim_user-1_cancelled_orders', JSON.stringify(cancelledOrders));
    localStorage.setItem('sim_user-1_orders_map', JSON.stringify({ ASTERUSDT: [pendingShortOpen, pendingShortTp] }));
    localStorage.setItem('sim_user-1_trade_history', JSON.stringify(tradeHistory));

    const { reverseHedgeOrders } = await getCampaignFullData(campaign.id);
    const ids = reverseHedgeOrders.map(order => order.id);

    expect(ids).toEqual(['short-open-order', 'short-cancelled-open', 'short-pending-open']);
    expect(ids).not.toContain('tp-close-order');
    expect(ids).not.toContain('short-cancelled-tp');
    expect(ids).not.toContain('short-pending-tp');
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
});
