import { describe, expect, it } from 'vitest';
import { compactExecutionWearR, computeCampaignExecutionWear, finalHedgeWear, formatCompactExecutionWearR, formatExecutionWearParts, formatExecutionWearUsd, type ExecutionWearInput } from '../campaignExecutionWear';
import { formatCompactUsd } from '../campaignUnitProfit';
import type { CampaignRealizedPnl } from '../campaignRealizedPnl';
import type { ResolvedLegExecution } from '../campaignLegExecution';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const leg = (id: string, role: string, direction: 'long' | 'short', recordId: string | null = null) =>
  ({ id, leg_role: role, direction, trade_record_id: recordId }) as unknown as TradeJournal;
const record = (id: string, side: 'LONG' | 'SHORT', entry: number, exit: number, coins: number, closeTime: number) =>
  ({ id, symbol: 'XUSDT', side, type: 'MARKET', action: 'CLOSE', entryPrice: entry, exitPrice: exit, quantity: coins, leverage: 5,
    pnl: 0, fee: 0, slippage: 0, openTime: closeTime - 1_000, closeTime }) as TradeRecord;
const execution = (openTime: number, entryPrice: number): ResolvedLegExecution =>
  ({ record: null, openTime, closeTime: null, entryPrice, exitPrice: null, exitCorrection: null });

/**
 * 主力 10 币 @100、加仓 5 币 @105；最终对冲空单 10 币 @108 锁住行情（F = 108，委托价 108.5）；
 * 之后主力平在 110、加仓平在 112、空单平在 112。中途对冲空单亏 30。L₀ = 100。
 */
function example(overrides: { mainExit?: number; addExit?: number | null; lockExit?: number; locking?: string[]; corrections?: ExecutionWearInput['corrections'] } = {}): ExecutionWearInput {
  const main = leg('main', 'main_open', 'long', 'r-main');
  const add = leg('add', 'main_add_1', 'long', 'r-add');
  const lock = leg('lock', 'hedge_rolling', 'short', 'r-lock');
  const mid = leg('mid', 'hedge_initial_a', 'short', 'r-mid');
  const mainClose = record('r-main', 'LONG', 100, overrides.mainExit ?? 110, 10, 10_000);
  const addClose = overrides.addExit === null ? null : record('r-add', 'LONG', 105, overrides.addExit ?? 112, 5, 10_200);
  const lockClose = record('r-lock', 'SHORT', 108, overrides.lockExit ?? 112, 10, 10_500);
  const settlement = {
    total: null, basis: 'records', settled: true, stored: null, drift: null,
    byLeg: new Map([['main', 100], ['add', 35], ['lock', -40], ['mid', -30]]),
    recordsByLeg: new Map([['main', [mainClose]], ['add', addClose ? [addClose] : []], ['lock', [lockClose]], ['mid', []]]),
  } as unknown as CampaignRealizedPnl;
  return {
    legs: [main, add, lock, mid],
    executions: new Map([['main', execution(1_000, 100)], ['add', execution(5_000, 105)], ['lock', execution(8_000, 108)], ['mid', execution(3_000, 99)]]),
    lookup: new Map([['r-main', mainClose], ['r-lock', lockClose], ...(addClose ? [['r-add', addClose] as const] : [])]),
    settlement,
    corrections: overrides.corrections ?? {},
    orders: [{ id: 'o-lock', tradeRecordId: 'r-lock', side: 'SHORT', price: 108.5, fillPrice: 108, createdAt: 7_000, triggeredAt: 8_000, cancelledAt: null, status: 'triggered' }],
    finalExitPrice: 108,
    lockingLegIds: overrides.locking ?? ['lock'],
    initialExpectedMaxLoss: 100,
  };
}

describe('【用户要求】L_磨损 = 中途对冲 + 最终对冲磨损（多空平仓价差 + 对冲委托/成交差 + 对冲数量差）', () => {
  it('第一部分记在中途对冲单，第二部分全部记在最终对冲单；主力、加仓那几行没有磨损', () => {
    const wear = computeCampaignExecutionWear(example());
    const longExit = (10 * 110 + 5 * 112) / 15;
    expect(wear.components.hedge).toBeCloseTo(-30, 9);
    // ① 对冲币数 10 ×（多单最终平仓价 110.67 − 空单平仓价 112）
    expect(wear.components.exit).toBeCloseTo(10 * (longExit - 112), 9);
    // ② 10 ×（成交 108 − 委托 108.5）
    expect(wear.components.slippage).toBeCloseTo(-5, 9);
    // ③（理论 15 币 − 实际 10 币）×（110.67 − F 108）
    expect(wear.components.sizing).toBeCloseTo(5 * (longExit - 108), 9);
    // 多空两边从 F 起的实际盈亏：多 10×2 + 5×4 = 40，空 10×(108 − 112) = −40，合计 0 → ①＋③ = 0
    expect(wear.components.exit! + wear.components.sizing!).toBeCloseTo(0, 9);
    expect(wear.usd).toBeCloseTo(-35, 9);
    expect(wear.r).toBeCloseTo(-0.35, 9);
    expect(finalHedgeWear(wear.components)).toBeCloseTo(-5, 9);
    expect(Object.keys(wear.byLeg).sort()).toEqual(['lock', 'mid']);
    expect(wear.byLeg.mid).toMatchObject({ hedge: -30, exit: null, slippage: null, sizing: null, total: -30 });
    expect(wear.byLeg.lock.total).toBeCloseTo(-5, 9);
    expect(wear.byLeg.lock.hedge).toBeNull();
    // 点开 Legs「磨损」要代入的每一个数
    expect(wear.byLeg.mid.detail).toEqual({ kind: 'midHedge', pnl: -30 });
    expect(wear.byLeg.lock.detail).toMatchObject({ kind: 'finalHedge', coins: 10, entry: 108, shortExit: 112, finalExitPrice: 108,
      longCoins: 15, hedgeCoinsTotal: 10, sizingOwner: true, orderPrice: 108.5, fillPrice: 108 });
    expect((wear.byLeg.lock.detail as { longExit: number }).longExit).toBeCloseTo(longExit, 9);
    expect(wear.initialExpectedMaxLoss).toBe(100);
  });

  it('多空同量、同一个价平掉：平仓价差与数量差都是 0，只剩委托/成交差', () => {
    const wear = computeCampaignExecutionWear(example({ addExit: null, lockExit: 110 }));
    expect(wear.components.exit).toBeCloseTo(0, 9);
    expect(wear.components.sizing).toBeCloseTo(0, 9);
    expect(finalHedgeWear(wear.components)).toBeCloseTo(-5, 9);
  });

  it('没有最终对冲单（主力自己平仓）时第二部分不适用，只剩中途对冲', () => {
    const wear = computeCampaignExecutionWear(example({ locking: [] }));
    // 那张空单不再是最终对冲单，就是中途对冲单：−30 − 40
    expect(wear.components).toEqual({ hedge: -70, exit: null, slippage: null, sizing: null });
    expect(finalHedgeWear(wear.components)).toBeNull();
    // 没锁仓时那张空单就是中途对冲单
    expect(wear.byLeg.lock.hedge).toBe(-40);
  });

  it('【用户要求】对冲委托/成交差的成交价取空单的开仓价，不取委托快照里的 fillPrice', () => {
    const input = example();
    // 条件委托触发时委托快照的 fillPrice 写成了触发价本身（108.5）；实际开仓价是 108
    input.orders = [{ ...input.orders[0], fillPrice: 108.5 }];
    const wear = computeCampaignExecutionWear(input);
    expect(wear.components.slippage).toBeCloseTo(10 * (108 - 108.5), 9);
    expect(wear.byLeg.lock.detail).toMatchObject({ fillPrice: 108, orderPrice: 108.5 });
  });

  it('多单平仓价被 K 线校正过时取校正价', () => {
    const wear = computeCampaignExecutionWear(example({ addExit: null, corrections: { main: { exitPrice: 109 } as never } }));
    expect(wear.components.exit).toBeCloseTo(10 * (109 - 112), 9);
  });

  it('金额写法：带号两位小数，负号用「−」', () => {
    expect(formatExecutionWearUsd(-54)).toBe('−54.00');
    expect(formatExecutionWearUsd(6.004)).toBe('+6.00');
    expect(formatExecutionWearUsd(-0.001)).toBe('0.00');
    expect(formatExecutionWearUsd(null)).toBe('—');
  });
});

describe('【用户要求】L_磨损读数：总的在外，括号里中途对冲 + 最终对冲磨损', () => {
  it('两部分相加写在括号里，第二部分带自己的正负号', () => {
    expect(formatExecutionWearParts(-35, -30, -5, formatExecutionWearUsd)).toBe('−35.00（−30.00−5.00）');
    expect(formatExecutionWearParts(-28, -30, 2, formatExecutionWearUsd)).toBe('−28.00（−30.00+2.00）');
    expect(formatExecutionWearParts(-12345, -12000, -345, formatCompactUsd)).toBe('-1.23w（-1.20w-345.00）');
  });
  it('任一部分缺失或读作 0.00 时不写括号；总数算不出写「—」', () => {
    expect(formatExecutionWearParts(-5, null, -5, formatExecutionWearUsd)).toBe('−5.00');
    expect(formatExecutionWearParts(-30, -30, 0, formatExecutionWearUsd)).toBe('−30.00');
    expect(formatExecutionWearParts(-5, 0.001, -5.001, formatExecutionWearUsd)).toBe('−5.00');
    expect(formatExecutionWearParts(null, -30, -5, formatExecutionWearUsd)).toBe('—');
  });
});

describe('【用户要求】封面上 L_磨损那列不能太宽：紧凑写法', () => {
  it('< 10 两位小数，10–100 一位，100–1 万取整，≥ 1 万写 w；负号「-」，读作 0 时不带负号', () => {
    expect(formatCompactExecutionWearR(-0.69)).toBe('-0.69');
    expect(formatCompactExecutionWearR(4.944)).toBe('4.94');
    expect(formatCompactExecutionWearR(-57.94)).toBe('-57.9');
    expect(formatCompactExecutionWearR(-199.24)).toBe('-199');
    expect(formatCompactExecutionWearR(-24390.24)).toBe('-2.44w');
    expect(formatCompactExecutionWearR(-0.001)).toBe('0.00');
    expect(formatExecutionWearParts(-257.18, -57.94, -199.24, formatCompactExecutionWearR)).toBe('-257（-57.9-199）');
  });
  it('分档按同一个取整：封面读数相同的必在同一档', () => {
    expect(compactExecutionWearR(-57.94)).toBe(-57.9);
    expect(compactExecutionWearR(-199.24)).toBe(-199);
    expect(compactExecutionWearR(-24390.24)).toBe(-24400);
    expect(compactExecutionWearR(4.944)).toBe(4.94);
    expect(Object.is(compactExecutionWearR(-0.001), -0)).toBe(false);
  });
});
