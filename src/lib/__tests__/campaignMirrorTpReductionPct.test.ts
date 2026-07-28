import { describe, expect, it } from 'vitest';
import { computeMirrorTpReductionPct } from '@/lib/campaignAnalysis';
import type { CampaignEvent, TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const openedAt = '2026-07-25T00:00:00.000Z';

function campaign(events: CampaignEvent[] = []): TradeCampaign {
  return {
    id: 'campaign-mirror-ratio',
    direction: 'main_long',
    strategy_template: 'main_dual_hedge_mirror_tp',
    opened_at: openedAt,
    initial_main_size_usdt: null,
    actual_evolution: events,
  } as TradeCampaign;
}

function leg(id: string, role: TradeJournal['leg_role'], size: number | null): TradeJournal {
  return {
    id,
    leg_role: role,
    direction: 'long',
    pre_simulated_time: openedAt,
    pre_entry_price: 100,
    pre_position_size: size,
    trade_record_id: null,
  } as TradeJournal;
}

function event(
  id: string,
  role: CampaignEvent['leg_role'],
  size: number,
  type: CampaignEvent['event_type'] = 'historical_leg_attached',
): CampaignEvent {
  return {
    id: `event-${id}`,
    timestamp: openedAt,
    event_type: type,
    leg_role: role,
    journal_id: id,
    trade_record_id: null,
    pending_order_id: null,
    price: 100,
    size_usdt: size,
    notes: null,
    recorded_at: openedAt,
  };
}

describe('computeMirrorTpReductionPct', () => {
  it('shows 60% for a 40/60 initial M and mirror split', () => {
    const main = leg('main', 'main_open', 400);
    const mirror = leg('mirror', 'mirror_tp', 600);

    expect(computeMirrorTpReductionPct(campaign(), mirror, [main, mirror], []))
      .toBeCloseTo(60, 8);
  });

  it('shows 50% for a historical 50/50 split', () => {
    const main = leg('main', 'main_open', 500);
    const mirror = leg('mirror', 'mirror_tp', 500);

    expect(computeMirrorTpReductionPct(campaign(), mirror, [main, mirror], []))
      .toBeCloseTo(50, 8);
  });

  it('reconstructs the actual percentage from historical campaign events', () => {
    const main = leg('main', 'main_open', null);
    const mirror = leg('mirror', 'mirror_tp', null);
    const events = [
      event('main', 'main_open', 500),
      event('mirror', 'mirror_tp', 500),
    ];

    expect(computeMirrorTpReductionPct(campaign(events), mirror, [main, mirror], []))
      .toBeCloseTo(50, 8);
  });

  it('prefers linked fill notionals when records are available', () => {
    const main = { ...leg('main', 'main_open', null), trade_record_id: 'main-position' };
    const mirror = { ...leg('mirror', 'mirror_tp', null), trade_record_id: 'mirror-position' };
    const records = [
      {
        id: 'main-close',
        positionId: 'main-position',
        symbol: 'TESTUSDT',
        side: 'LONG',
        entryPrice: 100,
        quantity: 4,
        leverage: 1,
        marginMode: 'cross',
        closeTime: 2,
      },
      {
        id: 'mirror-close',
        positionId: 'mirror-position',
        symbol: 'TESTUSDT',
        side: 'LONG',
        entryPrice: 100,
        quantity: 6,
        leverage: 1,
        marginMode: 'cross',
        closeTime: 2,
      },
    ] as TradeRecord[];

    expect(computeMirrorTpReductionPct(campaign(), mirror, [main, mirror], records))
      .toBeCloseTo(60, 8);
  });
});
