import { describe, expect, it } from 'vitest';
import { computeSopDeviation } from '@/lib/campaignAnalysis';
import type { LegRole, TradeCampaign, TradeJournal } from '@/types/journal';

const openedAt = '2026-07-25T00:00:00.000Z';

const campaign = {
  id: 'campaign-60',
  direction: 'main_long',
  strategy_template: 'main_dual_hedge_mirror_tp',
  status: 'closed_profit',
  opened_at: openedAt,
  actual_evolution: [],
  peak_drawdown: null,
} as TradeCampaign;

function leg(id: string, role: LegRole, size: number, minute: number): TradeJournal {
  return {
    id,
    source: 'live',
    leg_role: role,
    direction: role.startsWith('hedge_') ? 'short' : 'long',
    pre_simulated_time: new Date(Date.parse(openedAt) + minute * 60_000).toISOString(),
    pre_entry_price: 100,
    pre_position_size: size,
    leverage: 1,
  } as TradeJournal;
}

function setupLegs(mirrorSize: number): TradeJournal[] {
  return [
    leg('main', 'main_open', 1_000, 0),
    leg('hedge-a', 'hedge_initial_a', 500, 1),
    leg('hedge-b', 'hedge_initial_b', 500, 2),
    leg('mirror', 'mirror_tp', mirrorSize, 3),
  ];
}

describe('mirror TP reduction SOP', () => {
  it('accepts 60% mirror reduction while keeping both initial hedges at 50%', () => {
    const result = computeSopDeviation(campaign, setupLegs(600), []);

    expect(result.deductions.some(item => item.reason.includes('仓位大小未对齐'))).toBe(false);
  });

  it('flags the historical 50% mirror reduction against the new 60% SOP', () => {
    const result = computeSopDeviation(campaign, setupLegs(500), []);

    expect(result.deductions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reason: 'mirror_tp 仓位大小未对齐主仓 60%',
      }),
    ]));
  });
});
