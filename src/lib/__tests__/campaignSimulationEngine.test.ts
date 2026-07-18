import { describe, expect, it } from 'vitest';

import type { KlineData } from '@/hooks/useBinanceData';
import type {
  CampaignCounterfactualManualLeg,
  CampaignCounterfactualParams,
  TradeJournal,
} from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

import {
  buildManualLegs,
  computeManualLegDeviationCosts,
  manualLegPnl,
  simulateCampaign,
  simulateManualLegScenario,
} from '../campaignSimulationEngine';

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

describe('buildManualLegs', () => {
  it('与原始 Legs 列表共用成交记录时间和历史平仓价校正', () => {
    const record = {
      id: 'close-record-1',
      positionId: 'position-1',
      symbol: 'ALPACAUSDT',
      side: 'LONG',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 0.165244,
      exitPrice: 0.19867,
      quantity: 100,
      leverage: 3,
      pnl: 10,
      fee: 0,
      slippage: 0,
      openTime: t0 + MIN,
      closeTime: t0 + 3 * MIN,
    } satisfies TradeRecord;
    const leg = {
      id: 'leg-1',
      trade_record_id: 'position-1',
      leg_sequence: 1,
      source: 'live',
      leg_role: 'main_open',
      direction: 'long',
      pre_simulated_time: new Date(t0).toISOString(),
      pre_entry_price: 0.15,
      pre_position_size: 2_000,
      leverage: 3,
      post_simulated_close_time: new Date(t0 + 2 * MIN).toISOString(),
      post_exit_price_snapshot: 0.19,
    } as TradeJournal;

    const manualLegs = buildManualLegs(
      baseParams(),
      [leg],
      [k(0, 0.16, 0.17, 0.15, 0.16), k(3, 0.19, 0.191, 0.186, 0.1895)],
      [record],
      {
        'leg-1': {
          exitPrice: 0.1895,
          originalExitPrice: 0.19867,
          candleLow: 0.186,
          candleHigh: 0.191,
        },
      },
    );

    expect(manualLegs).toEqual([expect.objectContaining({
      open_time: new Date(record.openTime).toISOString(),
      close_time: new Date(record.closeTime).toISOString(),
      entry_price: record.entryPrice,
      exit_price: 0.1895,
      size_usdt: 2_000,
      leverage: 3,
    })]);
  });

  it('没有成交记录时保留腿上的开平仓快照', () => {
    const openTime = new Date(t0 + MIN).toISOString();
    const closeTime = new Date(t0 + 2 * MIN).toISOString();
    const leg = {
      id: 'snapshot-leg',
      trade_record_id: null,
      leg_sequence: 1,
      source: 'retroactive_from_record',
      leg_role: 'hedge_initial_a',
      direction: 'short',
      pre_simulated_time: openTime,
      pre_entry_price: 101,
      pre_position_size: 500,
      leverage: 2,
      post_simulated_close_time: closeTime,
      post_exit_price_snapshot: 98,
    } as TradeJournal;

    expect(buildManualLegs(baseParams(), [leg], [], [])).toEqual([
      expect.objectContaining({
        open_time: openTime,
        close_time: closeTime,
        entry_price: 101,
        exit_price: 98,
        size_usdt: 500,
        leverage: 2,
      }),
    ]);
  });
});

describe('computeManualLegDeviationCosts', () => {
  const makeLeg = (
    id: string,
    leg_role: string,
    direction: 'long' | 'short',
    entry_price: number,
    exit_price: number,
    size_usdt: number,
  ): CampaignCounterfactualManualLeg => ({
    id,
    leg_role,
    direction,
    open_time: new Date(t0).toISOString(),
    close_time: new Date(t0 + 3 * MIN).toISOString(),
    entry_price,
    exit_price,
    size_usdt,
    leverage: 1,
    enabled: true,
  });

  it('逐腿拆分：改腿 / 加腿 / 删腿，合计 = 手动调整总盈亏 − 原始总盈亏', () => {
    const original = [
      makeLeg('main', 'main_open', 'long', 100, 110, 1000), // +100
      makeLeg('hedge', 'hedge_initial_a', 'short', 100, 105, 500), // -25
      makeLeg('stable', 'mirror_tp', 'long', 100, 102, 100), // +2（未改动）
    ];
    const adjusted = [
      makeLeg('main', 'main_open', 'long', 100, 120, 1000), // +200（改了出场价）
      makeLeg('stable', 'mirror_tp', 'long', 100, 102, 100), // +2（不变）
      makeLeg('manual-x', 'hedge_rolling', 'long', 100, 105, 200), // +10（新增腿）
      // 'hedge' 在手动方案里被删除
    ];

    const costs = computeManualLegDeviationCosts(original, adjusted);

    // 未改动的 'stable' 腿差额为 0，被过滤；改腿先按 adjusted 顺序、删腿排在最后。
    expect(costs).toEqual([
      { legId: 'main', leg_role: 'main_open', cost_usdt: 100 },
      { legId: 'manual-x', leg_role: 'hedge_rolling', cost_usdt: 10 },
      { legId: 'hedge', leg_role: 'hedge_initial_a', cost_usdt: 25 },
    ]);

    // 合计 = 手动调整总盈亏 − 原始总盈亏 = 原始错误的总代价。
    const total = costs.reduce((sum, c) => sum + c.cost_usdt, 0);
    const adjustedTotal = adjusted.reduce((sum, leg) => sum + manualLegPnl(leg), 0);
    const originalTotal = original.reduce((sum, leg) => sum + manualLegPnl(leg), 0);
    expect(total).toBeCloseTo(adjustedTotal - originalTotal, 4);
    expect(total).toBe(135);
  });

  it('原始与调整完全一致时返回空数组', () => {
    const legs = [
      makeLeg('main', 'main_open', 'long', 100, 110, 1000),
      makeLeg('hedge', 'hedge_initial_a', 'short', 100, 105, 500),
    ];
    expect(computeManualLegDeviationCosts(legs, legs.map(leg => ({ ...leg })))).toEqual([]);
  });
});
