import { describe, expect, it } from 'vitest';

import type { KlineData } from '@/hooks/useBinanceData';
import type { CampaignCounterfactualParams } from '@/types/journal';

import { simulateCampaign, simulateManualLegScenario } from '../campaignSimulationEngine';

const MIN = 60_000;
const t0 = new Date('2024-01-01T00:00:00Z').getTime();

function k(index: number, open: number, high: number, low: number, close: number): KlineData {
  return {
    time: t0 + index * MIN,
    open,
    high,
    low,
    close,
    volume: 0,
  };
}

function baseParams(overrides: Partial<CampaignCounterfactualParams> = {}): CampaignCounterfactualParams {
  return {
    entry: {
      time: new Date(t0).toISOString(),
      price: 100,
      size_usdt: 1000,
      direction: 'long',
      leverage: 1,
    },
    hedge_a: { offset_pct: -2, size_pct: 50 },
    hedge_b: { offset_pct: -4, size_pct: 50 },
    mirror_tp: { offset_pct: 2, size_pct: 50 },
    rolling: {
      enabled: false,
      trigger_rise_pct: 10,
      min_interval_minutes: 60,
      new_hedge_offset_pct: -2,
      rolling_hedge_size_pct: 100,
    },
    exit_rule: 'close_all_on_hedge_trigger',
    ...overrides,
  };
}

describe('simulateCampaign', () => {
  it('long: only mirror_tp triggers and hedges cancel on normal exit', () => {
    const result = simulateCampaign(
      baseParams(),
      [
        k(0, 100, 100, 100, 100),
        k(1, 100, 103, 99, 102),
        k(2, 102, 105, 101, 104),
      ],
      'main_dual_hedge_mirror_tp',
    );

    expect(result.final_realized_pnl).toBeCloseTo(30, 4);
    expect(result.legs_summary.find(leg => leg.leg_role === 'mirror_tp')?.status).toBe('filled');
    expect(result.legs_summary.find(leg => leg.leg_role === 'hedge_initial_a')?.status).toBe('cancelled');
    expect(result.legs_summary.find(leg => leg.leg_role === 'hedge_initial_b')?.status).toBe('cancelled');
  });

  it('long: hedge_a trigger closes all and locks in loss', () => {
    const result = simulateCampaign(
      baseParams(),
      [
        k(0, 100, 100, 100, 100),
        k(1, 100, 101, 97, 98),
      ],
      'main_dual_hedge_mirror_tp',
    );

    expect(result.final_realized_pnl).toBeCloseTo(-20, 4);
    expect(result.final_r_multiple).toBeCloseTo(-1, 4);
    expect(result.legs_summary.find(leg => leg.leg_role === 'hedge_initial_a')?.status).toBe('filled');
  });

  it('long: mirror_tp then rolling hedge trigger exits with profit', () => {
    const result = simulateCampaign(
      baseParams({
        rolling: {
          enabled: true,
          trigger_rise_pct: 5,
          min_interval_minutes: 1,
          new_hedge_offset_pct: -2,
          rolling_hedge_size_pct: 100,
        },
      }),
      [
        k(0, 100, 100, 100, 100),
        k(1, 100, 103, 99, 102),
        k(2, 102, 106, 102, 105),
        k(3, 105, 105, 102.8, 103),
      ],
      'main_dual_hedge_mirror_tp',
    );

    expect(result.final_realized_pnl).toBeCloseTo(24.5, 3);
    expect(result.legs_summary.some(leg => leg.leg_role === 'hedge_rolling' && leg.status === 'filled')).toBe(true);
    expect(result.state_segments.some(segment => segment.state === 'state_2_rolling')).toBe(true);
  });

  it('long: same candle mirror_tp and hedge_a prefers hedge conservatively', () => {
    const result = simulateCampaign(
      baseParams(),
      [
        k(0, 100, 100, 100, 100),
        k(1, 100, 103, 97, 101),
      ],
      'main_dual_hedge_mirror_tp',
    );

    expect(result.final_realized_pnl).toBeCloseTo(-20, 4);
    expect(result.legs_summary.find(leg => leg.leg_role === 'mirror_tp')?.status).not.toBe('filled');
    expect(result.events.some(event => event.event_type === 'hedge_triggered')).toBe(true);
  });

  it('long: reenter_after_hedge_trigger mode can re-open and continue campaign', () => {
    const result = simulateCampaign(
      baseParams({
        exit_rule: 'reenter_after_hedge_trigger',
        reentry: {
          delay_minutes: 1,
          size_pct: 100,
        },
      }),
      [
        k(0, 100, 100, 100, 100),
        k(1, 100, 101, 97, 98),
        k(2, 99, 100, 98, 99.5),
        k(3, 99.5, 102, 99, 101.5),
      ],
      'main_dual_hedge_mirror_tp',
    );

    expect(result.events.some(event => event.event_type === 'reentry_main_opened')).toBe(true);
    expect(result.final_realized_pnl).toBeGreaterThan(0);
  });

  it('long: rolling can happen 3 times before final hedge trigger', () => {
    const result = simulateCampaign(
      baseParams({
        rolling: {
          enabled: true,
          trigger_rise_pct: 2,
          min_interval_minutes: 1,
          new_hedge_offset_pct: -1,
          rolling_hedge_size_pct: 100,
        },
      }),
      [
        k(0, 100, 100, 100, 100),
        k(1, 100, 103, 99, 102),
        k(2, 102, 105, 102, 104.5),
        k(3, 104.5, 107.5, 104.5, 107),
        k(4, 107, 109.2, 107, 108.8),
        k(5, 108.8, 109, 105.8, 106.2),
      ],
      'main_dual_hedge_mirror_tp',
    );

    expect(result.legs_summary.filter(leg => leg.leg_role === 'hedge_rolling').length).toBe(3);
    expect(result.legs_summary.some(leg => leg.leg_role === 'hedge_rolling' && leg.status === 'filled')).toBe(true);
    expect(result.final_realized_pnl).toBeGreaterThan(35);
  });

  it('short: mirror flow works symmetrically', () => {
    const result = simulateCampaign(
      baseParams({
        entry: {
          time: new Date(t0).toISOString(),
          price: 100,
          size_usdt: 1000,
          direction: 'short',
          leverage: 1,
        },
        hedge_a: { offset_pct: 2, size_pct: 50 },
        hedge_b: { offset_pct: 4, size_pct: 50 },
        mirror_tp: { offset_pct: -2, size_pct: 50 },
      }),
      [
        k(0, 100, 100, 100, 100),
        k(1, 100, 101, 97, 98),
        k(2, 98, 99, 95, 96),
      ],
      'main_dual_hedge_mirror_tp',
    );

    expect(result.final_realized_pnl).toBeCloseTo(30, 4);
    expect(result.state_segments.some(segment => segment.state === 'state_1_lockin')).toBe(true);
    expect(result.legs_summary.find(leg => leg.leg_role === 'mirror_tp')?.status).toBe('filled');
  });

  it('short data window returns partial result without throwing', () => {
    const result = simulateCampaign(
      baseParams(),
      [k(0, 100, 100, 100, 100)],
      'main_only',
    );

    expect(result.final_realized_pnl).toBe(0);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.state_segments.length).toBeGreaterThan(0);
  });

  it('manual legs scenario replays edited legs and ignores disabled legs', () => {
    const result = simulateManualLegScenario(
      baseParams({
        manual_legs: [
          {
            id: 'main',
            leg_role: 'main_open',
            direction: 'long',
            open_time: new Date(t0).toISOString(),
            close_time: new Date(t0 + 3 * MIN).toISOString(),
            entry_price: 100,
            exit_price: 108,
            size_usdt: 1000,
            leverage: 1,
            enabled: true,
          },
          {
            id: 'hedge',
            leg_role: 'hedge_rolling',
            direction: 'short',
            open_time: new Date(t0 + MIN).toISOString(),
            close_time: new Date(t0 + 2 * MIN).toISOString(),
            entry_price: 104,
            exit_price: 101,
            size_usdt: 500,
            leverage: 1,
            enabled: true,
          },
          {
            id: 'disabled',
            leg_role: 'mirror_tp',
            direction: 'long',
            open_time: new Date(t0).toISOString(),
            close_time: new Date(t0 + 3 * MIN).toISOString(),
            entry_price: 100,
            exit_price: 60,
            size_usdt: 1000,
            leverage: 1,
            enabled: false,
          },
        ],
      }),
      [
        k(0, 100, 101, 99, 100),
        k(1, 100, 105, 100, 104),
        k(2, 104, 105, 100, 101),
        k(3, 101, 109, 100, 108),
      ],
    );

    expect(result.final_realized_pnl).toBeCloseTo(94.4231, 4);
    expect(result.events.map(event => event.event_type)).toEqual([
      'manual_leg_opened',
      'manual_leg_opened',
      'manual_leg_closed',
      'manual_leg_closed',
    ]);
    expect(result.legs_summary).toHaveLength(2);
    expect(result.legs_summary.some(leg => leg.leg_role === 'mirror_tp')).toBe(false);
    expect(result.state_segments[0]?.state).toBe('manual_legs');
  });
});
