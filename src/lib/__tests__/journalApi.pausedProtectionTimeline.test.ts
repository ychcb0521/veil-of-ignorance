import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignEvent, TradeCampaign } from '@/types/journal';
import type { CancelledOrderSnapshot, FilledOrderSnapshot, TradeRecord } from '@/types/trading';
import type { ReplayTimelineRegistry } from '@/lib/replayTimeline';

let campaign: TradeCampaign;
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from(table: string) {
      const result = () => ({ data: table === 'trade_campaigns' ? campaign : [], error: null });
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        in() { return builder; },
        order() { return builder; },
        single() { return Promise.resolve(result()); },
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return builder;
    },
  },
}));

import { createUserLocalSnapshotReader, getCampaignFullData, readUserLocalSnapshot, type UserLocalSnapshot } from '@/lib/journalApi';
import { computeInitialExpectedMaxDrawdownPct, computeInitialExpectedMaxLoss } from '@/lib/campaignAnalysis';
import { clearPersistedStateMemoryForTests, writePersistedStateRaw } from '@/lib/persistedStateStorage';

// Deliberately synthetic: only the ordering and gaps reproduce the reported shape.
// No account identifiers, original symbol, prices or absolute operation times are retained.
const OWNER = 'paused-protection-test-owner';
const SYMBOL = 'TESTUSDT';
const TIMELINE = 'test-continuous-timeline';
const SIM = Date.parse('2024-04-12T00:00:00Z');
const REAL = Date.parse('2026-09-20T00:00:00Z');
const MIRROR_SIM = SIM + 26 * 60_000 + 40_000;
const CLOSE_SIM = SIM + 67 * 60_000 + 30_000;
const iso = (time: number) => new Date(time).toISOString();

const record = (id: string, closeTime: number, closedRealAt: number): TradeRecord => ({
  id, positionId: `position-${id}`, fillId: `position-${id}`, symbol: SYMBOL,
  side: 'LONG', action: 'CLOSE', entryPrice: 100, exitPrice: 103,
  quantity: 10, size: 1_000, leverage: 5, margin: 200, pnl: 30,
  openTime: SIM, closeTime, openedRealAt: REAL, closedRealAt,
  openedTimelineId: TIMELINE, closedTimelineId: TIMELINE,
  exit_method: 'manual',
} as TradeRecord);

const attached = (id: string, role: 'main_open' | 'mirror_tp', closeTime: number, closedRealAt: number): CampaignEvent => ({
  id: `event-${id}`, timestamp: iso(SIM), event_type: 'historical_leg_attached',
  leg_role: role, journal_id: null, trade_record_id: id, pending_order_id: null,
  price: 100, entry_price: 100, exit_price: 103, size_usdt: 1_000,
  open_time: iso(SIM), close_time: iso(closeTime), operation_time: iso(closedRealAt),
  direction: 'long', timeline_id: TIMELINE, realized_pnl: 30,
  notes: null, recorded_at: iso(REAL + 300_000),
});

function localSnapshot(withRecords: boolean): UserLocalSnapshot {
  const cancelledOrders: CancelledOrderSnapshot[] = [
    ...[0, 1].map(index => ({
      id: `initial-${index}`, symbol: SYMBOL, side: 'SHORT' as const, type: 'CONDITIONAL' as const,
      reduceOnly: false, reduceKind: null, price: 95, quantity: 10, leverage: 5,
      createdAt: SIM + 15_100 + index * 200, createdRealAt: REAL + 15_100 + index * 200,
      cancelledAt: MIRROR_SIM, cancelledRealAt: REAL + 108_500 + index * 200,
      createdTimelineId: TIMELINE, cancelledTimelineId: TIMELINE,
    })),
    {
      id: 'replacement-cancelled', symbol: SYMBOL, side: 'SHORT', type: 'CONDITIONAL',
      reduceOnly: false, reduceKind: null, price: 96, quantity: 10, leverage: 5,
      createdAt: MIRROR_SIM, createdRealAt: REAL + 105_500,
      cancelledAt: MIRROR_SIM, cancelledRealAt: REAL + 120_500,
      createdTimelineId: TIMELINE, cancelledTimelineId: TIMELINE,
    },
    {
      id: 'legacy-unstamped', symbol: SYMBOL, side: 'SHORT', type: 'CONDITIONAL',
      reduceOnly: false, price: 80, quantity: 10, leverage: 5,
      createdAt: SIM + 20_000, cancelledAt: MIRROR_SIM,
    },
  ];
  const filledOrders: FilledOrderSnapshot[] = [{
    id: 'replacement-filled-later', symbol: SYMBOL, side: 'SHORT', type: 'CONDITIONAL',
    reduceOnly: false, reduceKind: null, price: 96, triggerPrice: 96, quantity: 10, leverage: 5,
    createdAt: MIRROR_SIM, createdRealAt: REAL + 106_200,
    filledAt: SIM + 4 * 3_600_000 + 13 * 60_000, filledRealAt: REAL + 147 * 60_000,
    createdTimelineId: TIMELINE, filledTimelineId: TIMELINE, positionId: 'later-short-position',
  }];
  const replayTimelines: ReplayTimelineRegistry = {
    v: 1,
    current: { synced: TIMELINE },
    nodes: {
      [TIMELINE]: {
        id: TIMELINE, scope: 'synced', parentId: null, cause: 'start', direction: 1,
        forkSimTime: SIM, startedRealAt: REAL, endSimTime: null, endedRealAt: null,
        lastSimTime: filledOrders[0].filledAt, lastRealAt: filledOrders[0].filledRealAt,
        carried: {},
      },
    },
  };
  return {
    tradeHistory: withRecords ? [record('main', CLOSE_SIM, REAL + 229_000), record('mirror', MIRROR_SIM, REAL + 132_300)] : [],
    ordersMap: {}, cancelledOrders, filledOrders, positionsMap: {}, replayTimelines,
  };
}

function persistSnapshot(local: UserLocalSnapshot, owner = OWNER) {
  for (const [key, value] of Object.entries({
    trade_history: local.tradeHistory, orders_map: local.ordersMap,
    cancelled_orders: local.cancelledOrders, filled_orders: local.filledOrders,
    positions_map: local.positionsMap, replay_timelines_v1: local.replayTimelines,
  })) localStorage.setItem(`sim_${owner}_${key}`, JSON.stringify(value));
}

beforeEach(() => {
  clearPersistedStateMemoryForTests();
  localStorage.clear();
  campaign = {
    id: 'paused-protection-campaign', user_id: OWNER, symbol: SYMBOL,
    direction: 'main_long', status: 'closed_profit', strategy_template: 'custom',
    title: 'Paused protection fixture', opened_at: iso(SIM), closed_at: iso(CLOSE_SIM),
    initial_main_size_usdt: 1_000, initial_leverage: 5,
    final_realized_pnl: 60, final_r_multiple: null, peak_unrealized_pnl: null,
    peak_drawdown: null, notes: null,
    actual_evolution: [
      { id: 'created', timestamp: iso(SIM), event_type: 'historical_classification_created',
        leg_role: null, journal_id: null, trade_record_id: null, pending_order_id: null,
        price: null, size_usdt: null, notes: null, recorded_at: iso(REAL + 300_000) },
      attached('main', 'main_open', CLOSE_SIM, REAL + 229_000),
      attached('mirror', 'mirror_tp', MIRROR_SIM, REAL + 132_300),
    ],
    created_at: iso(REAL + 300_000), updated_at: iso(REAL + 300_000),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  clearPersistedStateMemoryForTests();
});

describe('same timeline protection orders while the simulation clock is paused', () => {
  it.each([true, false])('keeps both initial protection orders and the replacements with synthetic event legs (local records: %s)', async withRecords => {
    const local = localSnapshot(withRecords);
    // Exercise the actual persistent snapshot reader and synthetic-leg reconstruction.
    persistSnapshot(local);

    const details = await getCampaignFullData(campaign.id, { heal: false });

    expect(details.legs.map(leg => leg.leg_role)).toEqual(['main_open', 'mirror_tp']);
    expect(details.reverseHedgeOrders.map(order => order.id).sort()).toEqual([
      'initial-0', 'initial-1', 'replacement-cancelled', 'replacement-filled-later',
    ]);
    expect(details.timelineDiagnostics.verdicts['initial-0']).toMatchObject({ heuristic: true, exact: 'in' });
    expect(details.timelineDiagnostics.verdicts['initial-1']).toMatchObject({ heuristic: true, exact: 'in' });
    expect(computeInitialExpectedMaxDrawdownPct(details.campaign, details.legs, details.tradeRecords, details.reverseHedgeOrders)).toBeCloseTo(5);
    expect(computeInitialExpectedMaxLoss(details.campaign, details.legs, details.tradeRecords, details.reverseHedgeOrders)).toBeGreaterThan(0);
  });

  it.each([true, false])('reads failed cancellation writes from memory in detail and a previously cached snapshot reader (local records: %s)', async withRecords => {
    const local = localSnapshot(withRecords);
    const protectionOrders = local.cancelledOrders.filter(order => order.id.startsWith('initial-'));
    const key = `sim_${OWNER}_cancelled_orders`;
    persistSnapshot({ ...local, cancelledOrders: [], filledOrders: [] });
    const reader = createUserLocalSnapshotReader(OWNER);
    const before = reader.read();
    expect(before.cancelledOrders).toEqual([]);
    const missing = await getCampaignFullData(campaign.id, { heal: false });
    expect(missing.reverseHedgeOrders).toEqual([]);
    expect(computeInitialExpectedMaxLoss(missing.campaign, missing.legs, missing.tradeRecords, missing.reverseHedgeOrders)).toBe(0);

    const originalSetItem = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (itemKey, value) {
      if (itemKey === key) throw new DOMException('Synthetic storage quota reached', 'QuotaExceededError');
      originalSetItem.call(this, itemKey, value);
    });
    expect(writePersistedStateRaw(key, JSON.stringify(protectionOrders))).toBe(false);
    expect(write).toHaveBeenCalledWith(key, JSON.stringify(protectionOrders));
    expect(localStorage.getItem(key)).toBe('[]');

    const latest = reader.read();
    expect(latest).not.toBe(before);
    expect(latest.cancelledOrders).toEqual(protectionOrders);
    expect(reader.read()).toBe(latest);
    expect(readUserLocalSnapshot(OWNER).cancelledOrders).toEqual(protectionOrders);

    // No local override: detail uses the same storage-reading path as the app.
    const details = await getCampaignFullData(campaign.id, { heal: false });
    expect(details.reverseHedgeOrders.map(order => order.id)).toEqual(['initial-0', 'initial-1']);
    expect(computeInitialExpectedMaxDrawdownPct(details.campaign, details.legs, details.tradeRecords, details.reverseHedgeOrders)).toBeCloseTo(5);
    expect(computeInitialExpectedMaxLoss(details.campaign, details.legs, details.tradeRecords, details.reverseHedgeOrders)).toBeGreaterThan(0);
    expect(localStorage.getItem(key)).toBe('[]');
  });

  it('isolates unpersisted protection orders between accounts even when campaign and order IDs coincide', async () => {
    const otherOwner = 'other-paused-protection-owner';
    const local = localSnapshot(false);
    const firstOrders = local.cancelledOrders.filter(order => order.id.startsWith('initial-'));
    const secondOrders = firstOrders.map(order => ({ ...order, price: 90 }));
    const firstKey = `sim_${OWNER}_cancelled_orders`;
    const secondKey = `sim_${otherOwner}_cancelled_orders`;
    const disk = { ...local, cancelledOrders: [], filledOrders: [] };
    persistSnapshot(disk);
    persistSnapshot(disk, otherOwner);
    const firstReader = createUserLocalSnapshotReader(OWNER);
    const secondReader = createUserLocalSnapshotReader(otherOwner);
    expect(firstReader.read().cancelledOrders).toEqual([]);
    expect(secondReader.read().cancelledOrders).toEqual([]);

    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === firstKey || key === secondKey) throw new DOMException('Synthetic storage quota reached', 'QuotaExceededError');
      originalSetItem.call(this, key, value);
    });
    expect(writePersistedStateRaw(firstKey, JSON.stringify(firstOrders))).toBe(false);
    expect(secondReader.read().cancelledOrders).toEqual([]);
    expect(readUserLocalSnapshot(otherOwner).cancelledOrders).toEqual([]);
    expect(writePersistedStateRaw(secondKey, JSON.stringify(secondOrders))).toBe(false);

    for (const [owner, expectedOrders, expectedDrawdown] of [
      [OWNER, firstOrders, 5],
      [otherOwner, secondOrders, 10],
      [OWNER, firstOrders, 5],
    ] as const) {
      campaign = { ...campaign, user_id: owner };
      const details = await getCampaignFullData(campaign.id, { heal: false });
      expect(details.reverseHedgeOrders.map(order => order.price)).toEqual(expectedOrders.map(order => order.price));
      expect(computeInitialExpectedMaxDrawdownPct(details.campaign, details.legs, details.tradeRecords, details.reverseHedgeOrders)).toBeCloseTo(expectedDrawdown);
    }
    expect(firstReader.read().cancelledOrders).toEqual(firstOrders);
    expect(secondReader.read().cancelledOrders).toEqual(secondOrders);
    expect(localStorage.getItem(firstKey)).toBe('[]');
    expect(localStorage.getItem(secondKey)).toBe('[]');
  });
});
