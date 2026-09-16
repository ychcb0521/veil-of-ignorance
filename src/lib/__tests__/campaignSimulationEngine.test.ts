import { describe, expect, it } from 'vitest';

import type { KlineData } from '@/hooks/useBinanceData';
import type {
  CampaignCounterfactualManualLeg,
  CampaignCounterfactualParams,
  TradeCampaign,
  TradeJournal,
} from '@/types/journal';
import { TAKER_FEE, type TradeRecord } from '@/types/trading';

import { computeDecisionAccuracy } from '@/lib/campaignAnalysis';

import {
  adoptBaselineLegFacts,
  buildActualSimulationParams,
  buildManualLegs,
  buildPureSopParams,
  computeManualLegDeviationCosts,
  deriveCounterfactualRiskAnchors,
  isManualLegScenario,
  manualLegFeeUsdt,
  manualLegPnl,
  resolveManualLegEconomics,
  simulateCampaign,
  simulateManualLegScenario,
} from '../campaignSimulationEngine';

const MIN = 60_000;
const t0 = new Date('2024-01-01T00:00:00Z').getTime();

/**
 * 手工拼的手动腿没有 actual（相当于「新增的腿」），引擎按模拟器费率扣平仓费：
 * U 本位 = 数量（名义 ÷ 开仓价）× 平仓价 × Taker 费率。下面的期望值都写成「毛盈亏 − 这笔费」。
 */
const closeFee = (sizeUsdt: number, entry: number, exit: number) => sizeUsdt / entry * exit * TAKER_FEE;

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

    // 毛盈亏 主力 +80、对冲 +14.4231 = 94.4231；两条腿都是手工拼的（没有 actual），各扣模拟器平仓费
    const fees = closeFee(1000, 100, 108) + closeFee(500, 104, 101);
    expect(result.final_realized_pnl).toBeCloseTo(94.4231 - fees, 4);
    expect(result.fees_total).toBeCloseTo(fees, 4);
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
    // 这些腿是手工拼的（没有 actual），两边都按「毛盈亏 − 模拟器平仓费」比：
    // 主力 +200 − 0.60 对 +100 − 0.55；新增 +10 − 0.105；删掉的对冲 −(−25 − 0.2625)。
    expect(costs.map(({ legId, leg_role }) => ({ legId, leg_role }))).toEqual([
      { legId: 'main', leg_role: 'main_open' },
      { legId: 'manual-x', leg_role: 'hedge_rolling' },
      { legId: 'hedge', leg_role: 'hedge_initial_a' },
    ]);
    // cost_usdt 按两位小数落库（9.895 → 9.9），所以只要求与未取整的值相差不超过半分
    const withinHalfCent = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.0051);
    withinHalfCent(costs[0].cost_usdt, 100 - closeFee(1000, 100, 120) + closeFee(1000, 100, 110));
    withinHalfCent(costs[1].cost_usdt, 10 - closeFee(200, 100, 105));
    withinHalfCent(costs[2].cost_usdt, 25 + closeFee(500, 100, 105));

    // 合计 = 手动调整总盈亏 − 原始总盈亏 = 原始错误的总代价（与引擎同一份净额）。
    const total = costs.reduce((sum, c) => sum + c.cost_usdt, 0);
    const net = (leg: CampaignCounterfactualManualLeg) => resolveManualLegEconomics(leg).netPnl;
    const adjustedTotal = adjusted.reduce((sum, leg) => sum + net(leg), 0);
    const originalTotal = original.reduce((sum, leg) => sum + net(leg), 0);
    expect(total).toBeCloseTo(adjustedTotal - originalTotal, 1);
    expect(adjustedTotal).toBeCloseTo(adjusted.reduce((sum, leg) => sum + manualLegPnl(leg) - closeFee(leg.size_usdt, leg.entry_price, leg.exit_price), 0), 6);
  });

  it('带实际成交结果的腿：没改动时两边都取实际结算值，代价恰为 0；改了只加上改动本身值的钱', () => {
    const recorded = (leg: CampaignCounterfactualManualLeg, realized: number): CampaignCounterfactualManualLeg => ({
      ...leg,
      actual: {
        source: 'records',
        direction: leg.direction,
        open_time: leg.open_time,
        close_time: leg.close_time,
        entry_price: leg.entry_price,
        exit_price: leg.exit_price,
        size_usdt: leg.size_usdt,
        realized_pnl_usdt: realized,
        close_fee_usdt: 0.8,
        open_fee_usdt: 0.7,
      },
    });
    // 记录里的净额 +97（与毛盈亏 +100 − 模型费 0.55 不同）：没改的腿不能按模型印出 2.45 的假代价
    const original = [recorded(makeLeg('main', 'main_open', 'long', 100, 110, 1000), 97)];
    expect(computeManualLegDeviationCosts(original, original.map(leg => ({ ...leg })))).toEqual([]);
    const edited = [{ ...original[0], exit_price: 120 }];
    const [cost] = computeManualLegDeviationCosts(original, edited);
    // 平仓价 110 → 120：毛盈亏多 100，平仓费按这条记录自己的费率（0.8 ÷ 1100）多收 10 × 10 × 费率；
    // 记录里另外那 2.45 的差（滑点、老费率……）原样留在实际结算值里，不算进代价
    const recordRate = 0.8 / (10 * 110);
    expect(cost.cost_usdt).toBeCloseTo(100 - 10 * 10 * recordRate, 2);
  });

  it('本次改动之前保存的分支（腿上没有 actual / filled）：没改的腿借原始基线判定，代价仍为 0', () => {
    const baselineMain: CampaignCounterfactualManualLeg = {
      ...makeLeg('main', 'main_open', 'long', 100, 110, 1000),
      actual: {
        source: 'records',
        direction: 'long',
        open_time: new Date(t0).toISOString(),
        close_time: new Date(t0 + 3 * MIN).toISOString(),
        entry_price: 100,
        exit_price: 110,
        size_usdt: 1000,
        realized_pnl_usdt: 99.45,
        close_fee_usdt: 0.55,
        open_fee_usdt: 0.5,
      },
    };
    const baselineHedge: CampaignCounterfactualManualLeg = {
      ...makeLeg('hedge', 'hedge_initial_a', 'short', 95, 95, 500),
      filled: false,
    };
    const { actual: _actual, ...savedMain } = baselineMain;
    const { filled: _filled, ...savedHedge } = baselineHedge;
    expect(computeManualLegDeviationCosts([baselineMain, baselineHedge], [savedMain, savedHedge])).toEqual([]);
    // 老行里真改过的腿照样有代价
    const [cost] = computeManualLegDeviationCosts([baselineMain, baselineHedge], [{ ...savedMain, exit_price: 112 }, savedHedge]);
    expect(cost.legId).toBe('main');
    expect(cost.cost_usdt).toBeCloseTo(120 - closeFee(1000, 100, 112) - 99.45, 2);
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
    // 毛 +80 − 平仓费 10 × 108 × 0.05%；峰值出在持仓期间的最高价上，不受平仓费影响
    expect(result.final_realized_pnl).toBeCloseTo(80 - closeFee(1000, 100, 108), 4);
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
    expect(result.final_realized_pnl).toBeCloseTo(20 - closeFee(1000, 100, 98), 4);
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
    // 峰值 = 最终净额（毛 +200 − 平仓费 0.60）：扫描看不到的那一点就是已实现本身
    expect(result.final_realized_pnl).toBeCloseTo(200 - closeFee(1000, 100, 120), 4);
    expect(result.peak_unrealized_pnl).toBeCloseTo(result.final_realized_pnl, 4);
  });

  it('没有 K 线时峰值就是最终盈亏（盈利）或 0（亏损）', () => {
    const win = simulateManualLegScenario(baseParams({ manual_legs: [manualLeg({})] }), []);
    expect(win.peak_unrealized_pnl).toBeCloseTo(80 - closeFee(1000, 100, 108), 4);
    const loss = simulateManualLegScenario(baseParams({ manual_legs: [manualLeg({ exit_price: 95 })] }), []);
    expect(loss.peak_unrealized_pnl).toBe(0);
    expect(loss.peak_drawdown).toBeCloseTo(50 + closeFee(1000, 100, 95), 4);
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
    // 毛 +80，四条手工腿各扣模拟器平仓费（主力 0.53、镜像 0.26、A/B 各 0.25）
    const fees = manualLegs.reduce((sum, leg) => sum + closeFee(leg.size_usdt, leg.entry_price, leg.exit_price), 0);
    expect(fees).toBeCloseTo(1.29, 6);
    expect(result.final_r_multiple).toBeCloseTo((80 - fees) / 60, 4);

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

describe('手动腿的手续费与成交状态', () => {
  const at = (minutes: number) => new Date(t0 + minutes * MIN).toISOString();

  it('模拟器费率：U 本位 = 数量 × 成交价 × Taker；币本位 = 张数 × 面值 × Taker（与价格无关）', () => {
    const usdt: CampaignCounterfactualManualLeg = {
      id: 'u', leg_role: 'main_open', direction: 'long', open_time: at(0), close_time: at(1),
      entry_price: 100, exit_price: 120, size_usdt: 1000, leverage: 5, enabled: true,
    };
    expect(manualLegFeeUsdt(usdt, 120)).toBeCloseTo(10 * 120 * TAKER_FEE, 10);
    expect(manualLegFeeUsdt(usdt, 100)).toBeCloseTo(10 * 100 * TAKER_FEE, 10);
    const coin: CampaignCounterfactualManualLeg = {
      ...usdt, id: 'c', direction: 'short', entry_price: 50_000, exit_price: 48_000, size_usdt: 2_000,
      settlement_mode: 'coin', contract_size_usd: 100,
    };
    expect(manualLegFeeUsdt(coin, 48_000)).toBeCloseTo(20 * 100 * TAKER_FEE, 10);
    expect(manualLegFeeUsdt(coin, 50_000)).toBeCloseTo(20 * 100 * TAKER_FEE, 10);
    expect(manualLegFeeUsdt(usdt, 0)).toBe(0);
  });

  it('buildManualLegs：成交记录腿带上实际结算值与 Legs 表同一份手续费；从未成交的初始对冲标 filled: false', () => {
    const record = {
      id: 'rec-main',
      positionId: 'pos-main',
      symbol: 'BTCUSDT',
      side: 'LONG',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 100,
      exitPrice: 110,
      quantity: 10,
      leverage: 2,
      pnl: 100 - 0.55,
      fee: 0.55,
      slippage: 0,
      openTime: t0,
      closeTime: t0 + 3 * MIN,
      openFeeUsd: 0.5,
      openFeeRate: TAKER_FEE,
      closeFeeRate: TAKER_FEE,
    } as TradeRecord;
    const legs = [
      {
        id: 'main', trade_record_id: 'rec-main', leg_role: 'main_open', leg_sequence: 1, symbol: 'BTCUSDT',
        direction: 'long', leverage: 2, pre_simulated_time: at(0), pre_entry_price: 100, pre_position_size: 1000,
      },
      {
        id: 'hedge-a', trade_record_id: null, leg_role: 'hedge_initial_a', leg_sequence: 2, symbol: 'BTCUSDT',
        direction: 'short', leverage: 2, pre_simulated_time: at(0), pre_entry_price: 95, pre_position_size: 500,
      },
    ] as TradeJournal[];
    const campaign = {
      id: 'c', direction: 'main_long', opened_at: at(0), closed_at: at(3), actual_evolution: [],
      final_realized_pnl: 99.45, strategy_template: 'custom',
    } as unknown as TradeCampaign;
    const built = buildManualLegs(baseParams(), legs, [], [record], {}, { campaign });
    const main = built.find(leg => leg.id === 'main')!;
    expect(main).not.toHaveProperty('filled');
    expect(main.actual).toMatchObject({ source: 'records', realized_pnl_usdt: 99.45, close_fee_usdt: 0.55, open_fee_usdt: 0.5 });
    expect(resolveManualLegEconomics(main)).toMatchObject({ netPnl: 99.45, closeFeeUsdt: 0.55, openFeeUsdt: 0.5, basis: 'records' });
    const hedge = built.find(leg => leg.id === 'hedge-a')!;
    expect(hedge.filled).toBe(false);
    expect(hedge.enabled).toBe(true);
    expect(hedge).not.toHaveProperty('actual');
    expect(resolveManualLegEconomics(hedge)).toMatchObject({ netPnl: 0, basis: 'unfilled' });

    // 同一张对冲若事件流里有 hedge_triggered，战役页的峰值路径持有它 → 不是挂单
    const triggered = {
      ...campaign,
      actual_evolution: [{
        id: 'ev-1', timestamp: at(1), event_type: 'hedge_triggered', leg_role: 'hedge_initial_a', journal_id: 'hedge-a',
        trade_record_id: null, pending_order_id: null, price: 95, size_usdt: 500, notes: null, recorded_at: at(1),
      }],
    } as unknown as TradeCampaign;
    const withEvent = buildManualLegs(baseParams(), legs, [], [record], {}, { campaign: triggered });
    expect(withEvent.find(leg => leg.id === 'hedge-a')).not.toHaveProperty('filled');
  });

  it('未成交的腿切成「已成交」后按模型计：开平价相同则只剩平仓费', () => {
    const pending: CampaignCounterfactualManualLeg = {
      id: 'ha', leg_role: 'hedge_initial_a', direction: 'short', open_time: at(0), close_time: at(3),
      entry_price: 95, exit_price: 95, size_usdt: 475, leverage: 1, enabled: true, filled: false,
    };
    const main: CampaignCounterfactualManualLeg = {
      id: 'main', leg_role: 'main_open', direction: 'long', open_time: at(0), close_time: at(3),
      entry_price: 100, exit_price: 110, size_usdt: 1000, leverage: 1, enabled: true,
    };
    const klines = [k(0, 100, 101, 99, 100), k(1, 100, 130, 94, 110), k(2, 110, 111, 109, 110)];
    const unfilled = simulateManualLegScenario(baseParams({ manual_legs: [main, pending] }), klines);
    const filled = simulateManualLegScenario(baseParams({ manual_legs: [main, { ...pending, filled: true }] }), klines);
    expect(unfilled.final_realized_pnl).toBeCloseTo(100 - closeFee(1000, 100, 110), 4);
    // 挂单不持有：01 这根高点 130 → 主力 +300
    expect(unfilled.peak_unrealized_pnl).toBeCloseTo(300, 4);
    expect(filled.final_realized_pnl).toBeCloseTo(100 - closeFee(1000, 100, 110) - closeFee(475, 95, 95), 4);
    // 当作成交：同一根高点上空单 −175 → 125
    expect(filled.peak_unrealized_pnl).toBeCloseTo(125, 4);
    // 止损线两种情况都在：L = 1000 × 5%
    expect(unfilled.initial_expected_max_loss).toBeCloseTo(50, 4);
    expect(filled.initial_expected_max_loss).toBeCloseTo(50, 4);
  });

  it('结算没有计入的腿（既无成交记录也无复盘快照，如尚未平仓）：原样重跑记 0、不扣费；改过才按模型算', () => {
    const open = {
      id: 'open-main', trade_record_id: null, leg_role: 'main_open', leg_sequence: 1, symbol: 'BTCUSDT',
      direction: 'long', leverage: 1, pre_simulated_time: at(0), pre_entry_price: 100, pre_position_size: 1000,
    } as TradeJournal;
    const campaign = {
      id: 'c', direction: 'main_long', opened_at: at(0), closed_at: null, actual_evolution: [],
      final_realized_pnl: null, strategy_template: 'custom',
    } as unknown as TradeCampaign;
    const klines = [k(0, 100, 101, 99, 100), k(1, 100, 104, 99, 103), k(2, 103, 103, 102, 103)];
    const [leg] = buildManualLegs(baseParams(), [open], klines, [], {}, { campaign });
    // 没有平仓价：副本按开仓价、在末根 K 线开盘时收；以前按模型算会只剩一笔 −0.50 的平仓费
    expect(leg.exit_price).toBe(100);
    expect(leg).not.toHaveProperty('filled');
    expect(leg.actual).toMatchObject({ source: 'unsettled', realized_pnl_usdt: 0, close_fee_usdt: null, open_fee_usdt: null });
    const unchanged = simulateManualLegScenario(baseParams({ manual_legs: [leg] }), klines);
    expect(unchanged.final_realized_pnl).toBe(0);
    expect(unchanged.fees_total).toBe(0);
    expect(unchanged.legs_summary[0].pnl_basis).toBe('unsettled');
    // 持仓期间的浮盈照样进峰值（战役页的路径同样持有它）：01 这根高点 104
    expect(unchanged.peak_unrealized_pnl).toBeCloseTo(40, 4);

    const edited = simulateManualLegScenario(baseParams({ manual_legs: [{ ...leg, exit_price: 103 }] }), klines);
    expect(edited.final_realized_pnl).toBeCloseTo(30 - closeFee(1000, 100, 103), 4);
    expect(edited.legs_summary[0].pnl_basis).toBe('model');
  });
});

describe('adoptBaselineLegFacts：本次改动之前保存的腿', () => {
  const at = (minutes: number) => new Date(t0 + minutes * MIN).toISOString();
  const main: CampaignCounterfactualManualLeg = {
    id: 'main', leg_role: 'main_open', direction: 'short', open_time: at(0), close_time: at(3),
    entry_price: 50_000, exit_price: 48_000, size_usdt: 2_000, leverage: 10, enabled: true,
    settlement_mode: 'coin', contract_size_usd: 100,
    actual: {
      source: 'records', direction: 'short', open_time: at(0), close_time: at(3), entry_price: 50_000,
      exit_price: 48_000, size_usdt: 2_000, realized_pnl_usdt: 79, close_fee_usdt: 1, open_fee_usdt: 1,
    },
  };
  const hedge: CampaignCounterfactualManualLeg = {
    id: 'hedge-b', leg_role: 'hedge_initial_b', direction: 'long', open_time: at(0), close_time: at(3),
    entry_price: 52_000, exit_price: 52_000, size_usdt: 1_000, leverage: 10, enabled: true, filled: false,
  };
  const legacy = (leg: CampaignCounterfactualManualLeg): CampaignCounterfactualManualLeg => {
    const { actual: _a, filled: _f, settlement_mode: _s, contract_size_usd: _c, ...rest } = leg;
    return rest;
  };

  it('没改过的腿补回实际成交结果、结算方式与「挂单中」，与基线的钱数一致', () => {
    const adoptedMain = adoptBaselineLegFacts(legacy(main), main);
    expect(adoptedMain).toEqual(main);
    expect(resolveManualLegEconomics(adoptedMain)).toMatchObject({ netPnl: 79, basis: 'records' });
    const adoptedHedge = adoptBaselineLegFacts(legacy(hedge), hedge);
    expect(adoptedHedge.filled).toBe(false);
    expect(resolveManualLegEconomics(adoptedHedge).basis).toBe('unfilled');
  });

  it('改过价的挂单写明 filled: true（老引擎当它成交，编辑器据此画开关）；币本位的腿按基线的面值算费', () => {
    const editedHedge = adoptBaselineLegFacts({ ...legacy(hedge), exit_price: 53_000 }, hedge);
    expect(editedHedge.filled).toBe(true);
    expect(resolveManualLegEconomics(editedHedge).basis).toBe('model');
    const editedMain = adoptBaselineLegFacts({ ...legacy(main), exit_price: 47_000 }, main);
    expect(editedMain.settlement_mode).toBe('coin');
    // 20 张 × 100 × Taker，与价格无关
    expect(resolveManualLegEconomics(editedMain).closeFeeUsdt).toBeCloseTo(20 * 100 * TAKER_FEE, 10);
  });

  it('挂单的平仓时间只是兜底：老行存的是保存那一刻 K 线窗口的末根，换了窗口也照样补回「挂单中」', () => {
    const savedInOtherWindow = { ...legacy(hedge), close_time: at(45) };
    const adopted = adoptBaselineLegFacts(savedInOtherWindow, hedge);
    expect(adopted.filled).toBe(false);
    expect(adopted.close_time).toBe(hedge.close_time);
  });

  it('未结算的腿：老行的平仓时间等于那次运行的 K 线末根、或不早于基线的兜底值且其余各格没动时，换成基线的兜底值；确认不了就原样保留', () => {
    const unsettled: CampaignCounterfactualManualLeg = {
      ...main,
      id: 'mirror',
      leg_role: 'mirror_tp',
      settlement_mode: undefined,
      contract_size_usd: undefined,
      actual: {
        source: 'unsettled', direction: 'short', open_time: at(0), close_time: at(3), entry_price: 50_000,
        exit_price: 48_000, size_usdt: 2_000, realized_pnl_usdt: 0, close_fee_usdt: null, open_fee_usdt: null,
        close_time_fallback: true,
      },
    };
    const saved = { ...legacy(unsettled), close_time: at(45) };
    expect(adoptBaselineLegFacts(saved, unsettled, at(45)).close_time).toBe(at(3));
    // 已结束的战役按结束时刻收兜底，老窗口的末根只会在它之后：不早于基线、其余各格没动 → 认作老兜底（换过周期也认得出）
    expect(adoptBaselineLegFacts(saved, unsettled, null).close_time).toBe(at(3));
    expect(adoptBaselineLegFacts(saved, unsettled, at(44)).close_time).toBe(at(3));
    // 确认不了：早于基线的兜底值、或者别的格子也改过——原样保留，免得抹掉用户当时改的平仓时间
    const earlier = { ...legacy(unsettled), close_time: at(2) };
    expect(adoptBaselineLegFacts(earlier, unsettled, at(44)).close_time).toBe(at(2));
    const repriced = { ...saved, exit_price: 47_000 };
    expect(adoptBaselineLegFacts(repriced, unsettled, null).close_time).toBe(at(45));
    expect(adoptBaselineLegFacts(repriced, unsettled, at(45)).close_time).toBe(at(3));
    // 不管平仓时间认没认出来，钱都是 0：兜底的平仓时间不进「改没改」
    expect(resolveManualLegEconomics(adoptBaselineLegFacts(earlier, unsettled, null))).toMatchObject({ netPnl: 0, basis: 'unsettled' });
  });

  it('新行（带 actual 或 filled）、基线里没有的腿原样返回', () => {
    const toggled = { ...hedge, filled: true };
    expect(adoptBaselineLegFacts(toggled, hedge)).toBe(toggled);
    const withActual = { ...main, exit_price: 47_000 };
    expect(adoptBaselineLegFacts(withActual, main)).toBe(withActual);
    const added = { ...legacy(hedge), id: 'manual-1' };
    expect(adoptBaselineLegFacts(added, undefined)).toBe(added);
    expect(adoptBaselineLegFacts(added, hedge)).toBe(added);
  });
});
