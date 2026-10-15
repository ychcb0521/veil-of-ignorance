import { describe, expect, it } from 'vitest';
import { computeCampaignExecutionWear, formatExecutionWearUsd, type ExecutionWearInput } from '../campaignExecutionWear';
import type { CampaignRealizedPnl } from '../campaignRealizedPnl';
import type { ResolvedLegExecution } from '../campaignLegExecution';
import type { LegTheoreticalGeometricFactor } from '../campaignLegGeometricFactor';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const leg = (id: string, role: string, direction: 'long' | 'short', recordId: string | null = null) =>
  ({ id, leg_role: role, direction, trade_record_id: recordId }) as unknown as TradeJournal;
const record = (id: string, side: 'LONG' | 'SHORT', entry: number, exit: number, coins: number, closeTime: number, slippage = 0, extra: Partial<TradeRecord> = {}) =>
  ({ id, symbol: 'XUSDT', side, type: 'MARKET', action: 'CLOSE', entryPrice: entry, exitPrice: exit, quantity: coins, leverage: 5,
    pnl: 0, fee: 0, slippage, openTime: closeTime - 1_000, closeTime, ...extra }) as TradeRecord;
const execution = (openTime: number, entryPrice: number): ResolvedLegExecution =>
  ({ record: null, openTime, closeTime: null, entryPrice, exitPrice: null, exitCorrection: null });

/**
 * 主力 10 币 @100，锁仓空单 10 币 @108（F = 108）后，主力平在 110（滑点 2 U）、空单平在 112（滑点 1 U）；
 * 中途对冲空单亏 30；加仓 5 币 @105（计算器委托价 104），允许 3 币。L₀ = 100。
 */
function example(overrides: Partial<ExecutionWearInput> = {}): ExecutionWearInput {
  const main = leg('main', 'main_open', 'long', 'r-main');
  const add = leg('add', 'main_add_1', 'long', 'r-add-open');
  const lock = leg('lock', 'hedge_rolling', 'short', 'r-lock');
  const mid = leg('mid', 'hedge_initial_a', 'short', 'r-mid');
  const mainClose = record('r-main', 'LONG', 100, 110, 10, 10_000, 2);
  const lockClose = record('r-lock', 'SHORT', 108, 112, 10, 10_500, 1);
  const addOpen = record('r-add-open', 'LONG', 105, 0, 5, 9_000, 0, { action: 'OPEN', addSizingSnapshot: { s2AtOrder: 104 } as TradeRecord['addSizingSnapshot'] });
  const settlement = {
    total: null, basis: 'records', settled: true, stored: null, drift: null,
    byLeg: new Map([['main', 100], ['lock', -40], ['mid', -30], ['add', null]]),
    recordsByLeg: new Map([['main', [mainClose]], ['lock', [lockClose]], ['mid', []], ['add', []]]),
  } as unknown as CampaignRealizedPnl;
  const factor = { beforeCoins: 10, addCoins: 3, addPrice: 105 } as LegTheoreticalGeometricFactor;
  return {
    legs: [main, add, lock, mid],
    executions: new Map([['main', execution(1_000, 100)], ['add', execution(5_000, 105)], ['lock', execution(8_000, 108)], ['mid', execution(3_000, 99)]]),
    lookup: new Map([['r-main', mainClose], ['r-lock', lockClose], ['r-add-open', addOpen]]),
    settlement,
    corrections: {},
    orders: [{ id: 'o-lock', tradeRecordId: 'r-lock', side: 'SHORT', price: 108.5, fillPrice: 108, createdAt: 7_000, triggeredAt: 8_000, cancelledAt: null, status: 'triggered' }],
    finalExitPrice: 108,
    lockingLegIds: ['lock'],
    addSteps: [{ legId: 'add', addCoins: 5 }],
    theoreticalFactors: [factor],
    initialExpectedMaxLoss: 100,
    ...overrides,
  };
}

describe('L_磨损（执行磨损）', () => {
  it('四项分开算、互不重叠，合计 ÷ L₀ 就是盈亏比括号里的磨损值', () => {
    const wear = computeCampaignExecutionWear(example());
    // ① 中途对冲：这张没锁仓的空单亏 30
    expect(wear.components.hedge).toBeCloseTo(-30, 9);
    // ② 多空平仓价差（按委托价）：多单 10 ×（110 + 2/10 − 108）= 22；空单 10 ×（108 −（112 − 1/10））= −39
    expect(wear.components.exit).toBeCloseTo(22 - 39, 9);
    // ③ 滑点：多单平仓 −2、空单平仓 −1、锁仓空单开仓 (108 − 108.5) × 10 = −5、加仓开仓 (104 − 105) × 5 = −5
    expect(wear.components.slippage).toBeCloseTo(-13, 9);
    // ④ 加仓数量偏差：多加 2 币 ×（F 108 − 105）= +6
    expect(wear.components.sizing).toBeCloseTo(6, 9);
    expect(wear.usd).toBeCloseTo(-30 - 17 - 13 + 6, 9);
    expect(wear.r).toBeCloseTo(-0.54, 9);
    // 逐腿合计等于总数
    const legSum = Object.values(wear.byLeg).reduce((sum, row) => sum + row.total, 0);
    expect(legSum).toBeCloseTo(wear.usd!, 9);
    expect(wear.byLeg.main).toMatchObject({ exit: expect.closeTo(22, 9), slippage: expect.closeTo(-2, 9), hedge: null, sizing: null });
    expect(wear.byLeg.lock).toMatchObject({ exit: expect.closeTo(-39, 9), slippage: expect.closeTo(-6, 9) });
    expect(wear.byLeg.add).toMatchObject({ slippage: expect.closeTo(-5, 9), sizing: expect.closeTo(6, 9) });
    expect(wear.byLeg.mid.total).toBeCloseTo(-30, 9);
  });

  it('多空同量、同一个委托价平掉时平仓价差为 0；没有锁仓时这一项不适用', () => {
    const base = example();
    const flat = record('r-lock', 'SHORT', 108, 110.3, 10, 10_500, 1); // 委托价 110.3 − 0.1 = 110.2 = 多单的委托价
    const settlement = { ...base.settlement, recordsByLeg: new Map(base.settlement.recordsByLeg).set('lock', [flat]) } as CampaignRealizedPnl;
    expect(computeCampaignExecutionWear({ ...base, settlement }).components.exit).toBeCloseTo(0, 9);
    expect(computeCampaignExecutionWear({ ...base, lockingLegIds: [] }).components.exit).toBeNull();
  });

  it('少加（不够覆盖）且赚到 F：少赚的部分为负；读不到依据的项不计入，全都没有时为 null', () => {
    const under = computeCampaignExecutionWear(example({ addSteps: [{ legId: 'add', addCoins: 1 }] }));
    expect(under.components.sizing).toBeCloseTo((1 - 3) * 3, 9);
    const none = computeCampaignExecutionWear(example({
      legs: [], addSteps: [], theoreticalFactors: null, lockingLegIds: [], orders: [],
    }));
    expect(none.usd).toBeNull();
    expect(none.r).toBeNull();
  });

  it('平仓价被 K 线校正过的那一条不再读记录里的滑点', () => {
    const wear = computeCampaignExecutionWear(example({ corrections: { main: { exitPrice: 109 } as never } }));
    // 多单：校正价 109、不加滑点 → 10 ×（109 − 108）= 10；滑点少了多单那 −2
    expect(wear.byLeg.main.exit).toBeCloseTo(10, 9);
    expect(wear.byLeg.main.slippage).toBeNull();
  });

  it('金额写法：带号两位小数，负号用「−」', () => {
    expect(formatExecutionWearUsd(-54)).toBe('−54.00');
    expect(formatExecutionWearUsd(6.004)).toBe('+6.00');
    expect(formatExecutionWearUsd(-0.001)).toBe('0.00');
    expect(formatExecutionWearUsd(null)).toBe('—');
  });
});
