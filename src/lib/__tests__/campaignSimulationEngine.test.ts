import { describe, expect, it } from 'vitest';

import type { KlineData } from '@/hooks/useBinanceData';
import type {
  CampaignCounterfactualManualLeg,
  CampaignCounterfactualParams,
  TradeCampaign,
  TradeJournal,
} from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

import { computeDecisionAccuracy } from '@/lib/campaignAnalysis';

import {
  buildActualSimulationParams,
  buildManualLegs,
  buildPureSopParams,
  computeManualLegDeviationCosts,
  deriveCounterfactualRiskAnchors,
  isManualLegScenario,
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
    /**
     * R 从 −1 变成 −0.3333，是**口径统一**，不是这个场景的结果变了。
     *
     * 反事实的 R 现在与战役页的 b 走同一条 computeInitialExpectedMaxLoss：
     *   敞口 1000（主力）+ 500（镜像 50%）= 1500，不再只算主力；
     *   保护线取**最远**那条 hedge_b −4%（96），不再取最近的 hedge_a −2%（98）。
     *   L = 4% × 1500 = 60，R = −20 / 60 = −0.3333。
     *
     * 取舍要说清楚：本场 exit_rule 是 close_all_on_hedge_trigger，对冲A 在 −2% 就全平，
     * −4% 那条线**永远到不了**，所以旧的 −1R 更贴近「这个计划真正能亏多少」。
     * 但战役页取最远线是因为实盘事先不知道哪条先被打到。两个数要能并排比较，
     * 就必须同口径——这正是统一的理由，代价是仿真的 R 偏保守（分母偏大）。
     */
    expect(result.final_r_multiple).toBeCloseTo(-0.3333, 4);
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

describe('buildPureSopParams', () => {
  it('keeps initial hedges at 50% and changes mirror main reduction to 60%', () => {
    const campaign = {
      direction: 'main_long',
      strategy_template: 'main_dual_hedge_mirror_tp',
    } as TradeCampaign;
    const mainLeg = {
      id: 'main',
      leg_role: 'main_open',
      direction: 'long',
      pre_simulated_time: new Date(t0).toISOString(),
      pre_entry_price: 100,
      pre_position_size: 1_000,
      leverage: 1,
    } as TradeJournal;

    const params = buildPureSopParams(campaign, [mainLeg]);

    expect(params?.hedge_a.size_pct).toBe(50);
    expect(params?.hedge_b.size_pct).toBe(50);
    expect(params?.mirror_tp.size_pct).toBe(60);
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

describe('manual peak semantics (high / low / close, never below realized)', () => {
  const manualLeg = (overrides: Partial<CampaignCounterfactualManualLeg>): CampaignCounterfactualManualLeg => ({
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
    ...overrides,
  });

  it('峰值取每根 K 线最高价 / 最低价 / 收盘价重估后的最大值，而不只看收盘价', () => {
    const result = simulateManualLegScenario(
      baseParams({ manual_legs: [manualLeg({})] }),
      [
        k(0, 100, 101, 99, 100),
        k(1, 100, 115, 100, 104), // 收盘 +40，但盘中最高 +150
        k(2, 104, 105, 100, 101),
        k(3, 101, 109, 100, 108),
      ],
    );
    expect(result.final_realized_pnl).toBeCloseTo(80, 4);
    expect(result.peak_unrealized_pnl).toBeCloseTo(150, 4);
    // 谷值同样看最低价：第 2 根最低 100 → 0，第 0 根最低 99 → −10
    expect(result.peak_drawdown).toBeCloseTo(10, 4);
  });

  it('空头腿的峰值来自最低价', () => {
    const result = simulateManualLegScenario(
      baseParams({ manual_legs: [manualLeg({ direction: 'short', exit_price: 98 })] }),
      [
        k(0, 100, 101, 99, 100),
        k(1, 100, 102, 90, 99), // 最低 90 → 空头 +100
        k(2, 99, 100, 97, 98),
      ],
    );
    expect(result.final_realized_pnl).toBeCloseTo(20, 4);
    expect(result.peak_unrealized_pnl).toBeCloseTo(100, 4);
  });

  it('峰值不低于最终已实现盈亏：最后一腿平在末根 K 线之后时，扫描看不到它', () => {
    const result = simulateManualLegScenario(
      baseParams({ manual_legs: [manualLeg({ exit_price: 120, close_time: new Date(t0 + 30 * MIN).toISOString() })] }),
      [
        k(0, 100, 101, 99, 100),
        k(1, 100, 103, 99, 102),
      ],
    );
    expect(result.final_realized_pnl).toBeCloseTo(200, 4);
    expect(result.peak_unrealized_pnl).toBeCloseTo(200, 4);
  });

  it('没有 K 线时峰值就是最终盈亏（盈利）或 0（亏损）', () => {
    const win = simulateManualLegScenario(baseParams({ manual_legs: [manualLeg({})] }), []);
    expect(win.peak_unrealized_pnl).toBeCloseTo(80, 4);
    const loss = simulateManualLegScenario(baseParams({ manual_legs: [manualLeg({ exit_price: 95 })] }), []);
    expect(loss.peak_unrealized_pnl).toBe(0);
    expect(loss.peak_drawdown).toBeCloseTo(50, 4);
  });
});

describe('counterfactual risk anchors', () => {
  const at = (minutes: number) => new Date(t0 + minutes * MIN).toISOString();
  const manualLegs: CampaignCounterfactualManualLeg[] = [
    { id: 'main', leg_role: 'main_open', direction: 'long', open_time: at(0), close_time: at(30), entry_price: 100, exit_price: 106, size_usdt: 1000, leverage: 5, enabled: true },
    { id: 'mirror', leg_role: 'mirror_tp', direction: 'long', open_time: at(0), close_time: at(30), entry_price: 100, exit_price: 104, size_usdt: 500, leverage: 5, enabled: true },
    { id: 'ha', leg_role: 'hedge_initial_a', direction: 'short', open_time: at(1), close_time: at(2), entry_price: 98, exit_price: 98, size_usdt: 500, leverage: 5, enabled: true },
    { id: 'hb', leg_role: 'hedge_initial_b', direction: 'short', open_time: at(1), close_time: at(2), entry_price: 96, exit_price: 96, size_usdt: 500, leverage: 5, enabled: true },
  ];

  it('手动分支：结果上落库 L / 名义 / d / 杠杆，且与 deriveCounterfactualRiskAnchors(params) 完全一致', () => {
    const params = baseParams({ manual_legs: manualLegs });
    const result = simulateManualLegScenario(params, [k(0, 100, 101, 99, 100)]);
    // 敞口 = M 1000 + 镜像 500；d = max(2%, 4%) = 4% → L = 60
    expect(result.initial_expected_max_loss).toBeCloseTo(60, 4);
    expect(result.initial_main_exposure_notional).toBeCloseTo(1500, 4);
    expect(result.expected_max_drawdown_pct).toBeCloseTo(4, 4);
    // 主力杠杆来自手动腿自己（5x），不是 entry.leverage（1x）
    expect(result.main_leverage).toBe(5);
    expect(result.final_r_multiple).toBeCloseTo(80 / 60, 4);

    const derived = deriveCounterfactualRiskAnchors(params);
    expect(derived.initialExpectedMaxLoss).toBeCloseTo(result.initial_expected_max_loss!, 4);
    expect(derived.initialMainExposureNotional).toBeCloseTo(result.initial_main_exposure_notional!, 4);
    expect(derived.expectedMaxDrawdownPct).toBeCloseTo(result.expected_max_drawdown_pct!, 4);
    expect(derived.mainLeverage).toBe(result.main_leverage);
    expect(isManualLegScenario(params)).toBe(true);
  });

  it('手动分支没有初始对冲 A/B 时 L = 0（不凭空补一条止损线），杠杆仍读得到', () => {
    const params = baseParams({ manual_legs: [manualLegs[0]] });
    const result = simulateManualLegScenario(params, []);
    expect(result.initial_expected_max_loss).toBe(0);
    expect(result.expected_max_drawdown_pct).toBe(0);
    expect(result.initial_main_exposure_notional).toBeCloseTo(1000, 4);
    expect(result.main_leverage).toBe(5);
    expect(deriveCounterfactualRiskAnchors(params)).toEqual({
      initialExpectedMaxLoss: 0,
      initialMainExposureNotional: 1000,
      expectedMaxDrawdownPct: 0,
      mainLeverage: 5,
    });
  });

  it('手动分支所有腿都停用时四个锚全 0', () => {
    const params = baseParams({ manual_legs: manualLegs.map(leg => ({ ...leg, enabled: false })) });
    expect(isManualLegScenario(params)).toBe(false);
  });

  it('SOP 分支：simulateCampaign 也落库四个锚，与只凭 params 重建的锚一致', () => {
    const params = baseParams();
    const result = simulateCampaign(
      params,
      [
        k(0, 100, 100, 100, 100),
        k(1, 100, 103, 99, 102),
        k(2, 102, 105, 101, 104),
      ],
      'main_dual_hedge_mirror_tp',
    );
    // 敞口 = 主力 1000 + 镜像 500；d = max(2%, 4%) = 4% → L = 60
    expect(result.initial_expected_max_loss).toBeCloseTo(60, 4);
    expect(result.initial_main_exposure_notional).toBeCloseTo(1500, 4);
    expect(result.expected_max_drawdown_pct).toBeCloseTo(4, 4);
    expect(result.main_leverage).toBe(1);
    expect(result.final_r_multiple).toBeCloseTo(30 / 60, 4);

    const derived = deriveCounterfactualRiskAnchors(params);
    expect(derived.initialExpectedMaxLoss).toBeCloseTo(60, 4);
    expect(derived.initialMainExposureNotional).toBeCloseTo(1500, 4);
    expect(derived.expectedMaxDrawdownPct).toBeCloseTo(4, 4);
    expect(derived.mainLeverage).toBe(1);
  });

  it('main_only 模板没有对冲腿：L = 0，锚只剩主力名义与杠杆', () => {
    const params = baseParams();
    const result = simulateCampaign(params, [k(0, 100, 100, 100, 100), k(1, 100, 103, 99, 102)], 'main_only');
    expect(result.initial_expected_max_loss).toBe(0);
    expect(result.expected_max_drawdown_pct).toBe(0);
    expect(result.initial_main_exposure_notional).toBeCloseTo(1000, 4);
    expect(deriveCounterfactualRiskAnchors(params, 'main_only')).toEqual({
      initialExpectedMaxLoss: 0,
      initialMainExposureNotional: 1000,
      expectedMaxDrawdownPct: 0,
      mainLeverage: 1,
    });
  });
});

/**
 * 「原样重跑一遍 Legs 副本」和战役页自己的盈亏概览，峰值浮盈必须是同一个数——
 * 两块面板并排摆在一起，读数对不上就等于把用户的判断建在一个错觉上。
 *
 * 最容易分叉的正是「主力开在某根 K 线中间」这一格：战役页的 computeCampaignPnlExtremes
 * 把开仓时刻当成这根 K 线内的一个状态点、照样用这根的最高价重估；
 * 手动 Legs 引擎却曾经整根跳过，于是重跑出来的峰值系统性偏低。
 */
describe('manual peak parity with the campaign page', () => {
  const HOUR = 60 * MIN;
  const openedAt = new Date(t0).toISOString();
  const closedAt = new Date(t0 + 3 * HOUR).toISOString();

  const campaign = {
    id: 'parity-campaign',
    user_id: 'user-1',
    campaign_code: 'C-PARITY',
    symbol: 'TESTUSDT',
    direction: 'main_long',
    status: 'closed_profit',
    strategy_template: 'custom',
    title: 'parity',
    opened_at: openedAt,
    closed_at: closedAt,
    initial_main_size_usdt: 1_000,
    initial_leverage: 1,
    final_realized_pnl: 100,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: [],
    deviation_notes: {},
    created_at: openedAt,
    updated_at: closedAt,
  } as TradeCampaign;

  // 主力开在第 0 根（00:00~01:00）的正中间 00:30；这根的最高价 120 → 浮盈 200
  const mainRecord = {
    id: 'parity-main-record',
    symbol: 'TESTUSDT',
    side: 'LONG',
    type: 'MARKET',
    action: 'CLOSE',
    entryPrice: 100,
    exitPrice: 110,
    quantity: 10,
    leverage: 1,
    pnl: 100,
    fee: 0,
    slippage: 0,
    openTime: t0 + 30 * MIN,
    closeTime: t0 + 3 * HOUR,
  } satisfies TradeRecord;

  const mainLeg = {
    id: 'parity-main',
    trade_record_id: 'parity-main-record',
    leg_sequence: 1,
    source: 'live',
    leg_role: 'main_open',
    direction: 'long',
    pre_simulated_time: openedAt,
    pre_entry_price: 100,
    pre_position_size: 1_000,
    leverage: 1,
    post_simulated_close_time: closedAt,
  } as TradeJournal;

  // 开仓那根之后再没到过 120：跳过整根就只剩第 1 根的 111（浮盈 110）
  const klines: KlineData[] = [
    { time: t0, open: 100, high: 120, low: 99, close: 101, volume: 0 },
    { time: t0 + HOUR, open: 101, high: 111, low: 100, close: 105, volume: 0 },
    { time: t0 + 2 * HOUR, open: 105, high: 108, low: 103, close: 107, volume: 0 },
    { time: t0 + 3 * HOUR, open: 107, high: 110, low: 106, close: 110, volume: 0 },
  ];

  it('主力开在 K 线中间时，未改动的一次重跑与战役页的峰值浮盈一致', () => {
    const params = buildActualSimulationParams(campaign, [mainLeg], [mainRecord]);
    expect(params).not.toBeNull();
    const manualLegs = buildManualLegs(params!, [mainLeg], klines, [mainRecord]);
    const rerun = simulateManualLegScenario({ ...params!, manual_legs: manualLegs }, klines);

    const campaignPeak = computeDecisionAccuracy(campaign, [mainLeg], [mainRecord], klines).campaign_max_profit_real;
    expect(campaignPeak).toBeCloseTo(200, 6);
    expect(rerun.peak_unrealized_pnl).toBeCloseTo(campaignPeak, 2);
  });
});

/**
 * 多腿在同一根 K 线里换状态时的峰值对齐。
 *
 * 战役页 computeCampaignPnlExtremes 在一根 K 线里逐个还原持仓状态
 * （K 线起点、每条腿开仓、每条腿平仓前一刻与平仓时刻、K 线终点），各自用最高 / 最低价重估；
 * 手动 Legs 引擎若把「这根 K 线里碰过的腿」一律当作同时持有、同在极值价上估，
 * 对冲在高点之后才成交、同一根里先平后开、整点换手这几种形状都会与战役页对不上。
 */
describe('manual peak parity with the campaign page: multi-leg transitions inside a bar', () => {
  const HOUR = 60 * MIN;
  const iso = (ms: number) => new Date(ms).toISOString();

  interface LegSpec {
    id: string;
    role: TradeJournal['leg_role'];
    side: 'LONG' | 'SHORT';
    entry: number;
    exit: number;
    /** U 本位是币数；币本位是张数（每张 10 USD）。 */
    qty: number;
    openMs: number;
    closeMs: number;
    coin?: boolean;
  }

  const notionalOf = (spec: LegSpec) => (spec.coin ? spec.qty * 10 : spec.qty * spec.entry);
  const pnlOf = (spec: LegSpec) => (spec.side === 'LONG' ? 1 : -1) * (spec.exit - spec.entry) * notionalOf(spec) / spec.entry;

  function runBoth(direction: 'main_long' | 'main_short', specs: LegSpec[], klines: KlineData[]) {
    const openedAt = Math.min(...specs.map(spec => spec.openMs));
    const closedAt = Math.max(...specs.map(spec => spec.closeMs));
    const totalPnl = specs.reduce((sum, spec) => sum + pnlOf(spec), 0);
    const campaign = {
      id: 'multi-parity',
      user_id: 'user-1',
      campaign_code: 'C-MULTI',
      symbol: 'TESTUSDT',
      direction,
      status: totalPnl >= 0 ? 'closed_profit' : 'closed_loss',
      strategy_template: 'custom',
      title: 'multi parity',
      opened_at: iso(openedAt),
      closed_at: iso(closedAt),
      initial_main_size_usdt: notionalOf(specs[0]),
      initial_leverage: 1,
      final_realized_pnl: totalPnl,
      final_r_multiple: null,
      peak_unrealized_pnl: null,
      peak_drawdown: null,
      importance_weight: 0,
      notes: null,
      actual_evolution: [],
      deviation_notes: {},
      created_at: iso(openedAt),
      updated_at: iso(closedAt),
    } as TradeCampaign;
    const records = specs.map(spec => ({
      id: `${spec.id}-record`,
      symbol: 'TESTUSDT',
      side: spec.side,
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: spec.entry,
      exitPrice: spec.exit,
      quantity: spec.qty,
      leverage: 1,
      pnl: pnlOf(spec),
      fee: 0,
      slippage: 0,
      openTime: spec.openMs,
      closeTime: spec.closeMs,
      ...(spec.coin ? { settlementMode: 'coin' as const, contracts: spec.qty, contractSizeUsd: 10 } : {}),
    }) satisfies TradeRecord);
    const legs = specs.map((spec, index) => ({
      id: spec.id,
      trade_record_id: `${spec.id}-record`,
      leg_sequence: index + 1,
      source: 'live',
      leg_role: spec.role,
      direction: spec.side === 'LONG' ? 'long' : 'short',
      pre_simulated_time: iso(spec.openMs),
      pre_entry_price: spec.entry,
      pre_position_size: notionalOf(spec),
      leverage: 1,
      post_simulated_close_time: iso(spec.closeMs),
    }) as TradeJournal);

    const params = buildActualSimulationParams(campaign, legs, records);
    expect(params).not.toBeNull();
    const manualLegs = buildManualLegs(params!, legs, klines, records);
    expect(manualLegs).toHaveLength(specs.length);
    const rerun = simulateManualLegScenario({ ...params!, manual_legs: manualLegs }, klines);
    const page = computeDecisionAccuracy(campaign, legs, records, klines);
    return { rerun, page };
  }

  const bar = (hours: number, open: number, high: number, low: number, close: number): KlineData => ({
    time: t0 + hours * HOUR,
    open,
    high,
    low,
    close,
    volume: 0,
  });

  it('对冲在高点之后才于 K 线中间成交：峰值是高点时只有主力的那一刻（300），不是两腿同在高点（210）', () => {
    const { rerun, page } = runBoth('main_long', [
      { id: 'main', role: 'main_open', side: 'LONG', entry: 100, exit: 110, qty: 10, openMs: t0, closeMs: t0 + 3 * HOUR },
      { id: 'hedge', role: 'hedge_initial_a', side: 'SHORT', entry: 112, exit: 110, qty: 5, openMs: t0 + 100 * MIN, closeMs: t0 + 3 * HOUR },
    ], [
      bar(0, 100, 105, 99, 104),
      bar(1, 104, 130, 100, 112),
      bar(2, 112, 115, 105, 110),
      bar(3, 110, 111, 109, 110),
    ]);
    expect(page.campaign_max_profit_real).toBeCloseTo(300, 6);
    expect(rerun.final_realized_pnl).toBeCloseTo(110, 6);
    expect(rerun.peak_unrealized_pnl).toBeCloseTo(page.campaign_max_profit_real, 2);
    expect(rerun.peak_drawdown).toBeCloseTo(page.campaign_max_drawdown_real, 2);
  });

  it('主力持有期间一根 K 线内开平完的对冲：峰值仍是 K 线起点只有主力的那一刻', () => {
    const { rerun, page } = runBoth('main_long', [
      { id: 'main', role: 'main_open', side: 'LONG', entry: 100, exit: 110, qty: 10, openMs: t0, closeMs: t0 + 3 * HOUR },
      { id: 'hedge', role: 'hedge_initial_a', side: 'SHORT', entry: 115, exit: 116, qty: 5, openMs: t0 + 70 * MIN, closeMs: t0 + 110 * MIN },
    ], [
      bar(0, 100, 105, 99, 104),
      bar(1, 104, 130, 100, 112),
      bar(2, 112, 115, 105, 110),
      bar(3, 110, 111, 109, 110),
    ]);
    expect(page.campaign_max_profit_real).toBeCloseTo(300, 6);
    expect(rerun.peak_unrealized_pnl).toBeCloseTo(page.campaign_max_profit_real, 2);
    expect(rerun.peak_drawdown).toBeCloseTo(page.campaign_max_drawdown_real, 2);
  });

  it('同一根 K 线里主力先平、再入场：不把已平的主力和新入场同时放在高点上叠加', () => {
    const { rerun, page } = runBoth('main_long', [
      { id: 'main', role: 'main_open', side: 'LONG', entry: 100, exit: 120, qty: 10, openMs: t0, closeMs: t0 + 70 * MIN },
      { id: 'reentry', role: 'reentry_main', side: 'LONG', entry: 127, exit: 112, qty: 10, openMs: t0 + 100 * MIN, closeMs: t0 + 3 * HOUR },
    ], [
      bar(0, 100, 105, 99, 104),
      bar(1, 104, 130, 100, 112),
      bar(2, 112, 115, 105, 110),
      bar(3, 110, 113, 109, 112),
    ]);
    // 高点 130 时要么主力持有（+300），要么主力已平（+200）再加入场腿（+30）
    expect(page.campaign_max_profit_real).toBeCloseTo(300, 6);
    expect(rerun.peak_unrealized_pnl).toBeCloseTo(page.campaign_max_profit_real, 2);
    expect(rerun.peak_drawdown).toBeCloseTo(page.campaign_max_drawdown_real, 2);
  });

  it('币本位空头主力 + 多头对冲，对冲整点开、整点平：平仓那一刻按平仓前那根 K 线的价格重估主力', () => {
    const { rerun, page } = runBoth('main_short', [
      { id: 'main', role: 'main_open', side: 'SHORT', entry: 100, exit: 95, qty: 100, openMs: t0, closeMs: t0 + 3 * HOUR, coin: true },
      { id: 'hedge', role: 'hedge_initial_a', side: 'LONG', entry: 98, exit: 96, qty: 50, openMs: t0 + HOUR, closeMs: t0 + 2 * HOUR, coin: true },
    ], [
      bar(0, 100, 101, 98, 99),
      bar(1, 99, 99, 80, 96),
      bar(2, 96, 97, 90, 95),
      bar(3, 95, 96, 94, 95),
    ]);
    // 01:00 这根的最低 80：对冲平掉（已实现 −10.20）之后主力空单浮盈 +200 → 189.80
    expect(page.campaign_max_profit_real).toBeCloseTo(200 - 500 * 2 / 98, 6);
    expect(rerun.peak_unrealized_pnl).toBeCloseTo(page.campaign_max_profit_real, 2);
    expect(rerun.peak_drawdown).toBeCloseTo(page.campaign_max_drawdown_real, 2);
  });
});
