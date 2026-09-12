import { describe, expect, it } from 'vitest';
import { executeSettlementFill, closeSettlementPosition } from '@/lib/tradingSettlement';

/**
 * 全仓：超过保证金的亏损必须从钱包扣走。
 *
 * 事故：平仓回写写的是 `setBalance(prev + Math.max(0, returnedMargin))`。
 * 开仓时余额已经扣掉了保证金，平仓时 returnedMargin = 保证金 + 盈亏 − 手续费；
 * 亏损一旦超过这笔保证金它就为负，被 max(0,…) 截成 0——超出部分永远没人付。
 * 于是「Σ成交记录盈亏」与「余额变化」对不上账，而 b、R 全建立在这些记录上。
 */
describe('全仓平仓的余额守恒', () => {
  const SYMBOL = 'BTCUSDT';
  const START = 100_000;

  function openCrossLong(entry: number, qty: number, leverage: number) {
    const filled = executeSettlementFill(SYMBOL, entry, {
      side: 'LONG', quantity: qty, leverage, marginMode: 'cross', settlementMode: 'usdt',
    } as never, true, 0, 0);
    return { ...filled, balanceAfterOpen: START - filled.margin - filled.fee };
  }

  it('【回归】亏损超过保证金时，钱包必须继续扣——旧实现把差额送给了用户', () => {
    const opened = openCrossLong(100, 500, 10);        // 名义 50,000，保证金 ≈5,000
    const pos = opened.position;
    const closed = closeSettlementPosition(SYMBOL, pos, 85, 500, false);   // −15%
    const returnedMargin = pos.margin + closed.pnlUsd - closed.feeUsd;

    expect(returnedMargin).toBeLessThan(0);            // 亏损吃穿了保证金

    const fixedBalance = opened.balanceAfterOpen + returnedMargin;
    const oldBalance = opened.balanceAfterOpen + Math.max(0, returnedMargin);
    expect(oldBalance - fixedBalance).toBeCloseTo(-returnedMargin, 6);
    expect(oldBalance).toBeGreaterThan(fixedBalance);  // 旧实现凭空多钱

    // 守恒：余额变化 == 净盈亏 − 开仓费 − 平仓费
    const delta = fixedBalance - START;
    expect(delta).toBeCloseTo(closed.pnlUsd - opened.fee - closed.feeUsd, 6);
  });

  it('亏损没吃穿保证金时，两种写法一致（回归不改变正常路径）', () => {
    const opened = openCrossLong(100, 500, 10);
    const pos = opened.position;
    const closed = closeSettlementPosition(SYMBOL, pos, 97, 500, false);   // −3%
    const returnedMargin = pos.margin + closed.pnlUsd - closed.feeUsd;

    expect(returnedMargin).toBeGreaterThan(0);
    expect(Math.max(0, returnedMargin)).toBeCloseTo(returnedMargin, 12);
  });

  it('盈利平仓不受影响', () => {
    const opened = openCrossLong(100, 500, 10);
    const pos = opened.position;
    const closed = closeSettlementPosition(SYMBOL, pos, 110, 500, false);
    const returnedMargin = pos.margin + closed.pnlUsd - closed.feeUsd;
    const delta = (opened.balanceAfterOpen + returnedMargin) - START;
    expect(delta).toBeCloseTo(closed.pnlUsd - opened.fee - closed.feeUsd, 6);
    expect(delta).toBeGreaterThan(0);
  });
});

/**
 * 全仓强平后的余额必须与刚写下的强平记录对得上账。
 *
 * 事故（复核期间发现）：修 bug 时给它加了 `Math.max(0, 余额 + Σ保证金 + Σ净结算)`，
 * 而那个钳位在这里**恒等于 0**——触发条件是权益 ≤ Σ维持保证金 = 0.004·N，
 * 这一刀要付的却是 平仓费 0.0005·N + 强平费 0.005·N = 0.0055·N。
 * 0.0055 > 0.004 ⇒ 括号内恒为负，钳位于是让这行算什么都一样。
 * 结果是钱包少付了那一截，而记录里记的是完整数额，b 与 R 全都建立在记录上。
 */
describe('全仓强平的余额与记录必须同源', () => {
  const MAINTENANCE = 0.004;
  const TAKER = 0.0005;
  const LIQ = 0.005;

  it('【回归】费用恒大于维持保证金，所以钳到 0 必然让钱包欠账', () => {
    expect(TAKER + LIQ).toBeGreaterThan(MAINTENANCE);
    for (const notional of [10_000, 100_000, 904_000, 5_000_000]) {
      // 触发那一刻权益的上界就是维持保证金，扣掉两项费用后必为负
      const settledUpperBound = notional * MAINTENANCE - notional * (TAKER + LIQ);
      expect(settledUpperBound).toBeLessThan(0);
      expect(Math.max(0, settledUpperBound)).toBe(0);          // 钳位吃掉的正是这一截
      expect(settledUpperBound).toBeCloseTo(-notional * 0.0015, 6);
    }
  });

  it('不加钳位时，余额变化恰等于 Σ记录净额（守恒）', () => {
    const notional = 100_000;
    const margin = 10_000;
    const balanceAfterOpen = 50_000;
    // 权益跌到恰好等于维持保证金那一刻触发
    const equityAtTrigger = notional * MAINTENANCE;
    const pnl = equityAtTrigger - balanceAfterOpen - margin;
    const closeFee = notional * TAKER;
    const liqFee = notional * LIQ;
    const settlement = pnl - closeFee - liqFee;

    const fixed = balanceAfterOpen + margin + settlement;
    expect(fixed - balanceAfterOpen).toBeCloseTo(margin + settlement, 6);
    expect(fixed).toBeLessThan(0);                              // 亏穿了，余额为负
    expect(Math.max(0, fixed)).not.toBeCloseTo(fixed, 6);       // 钳位会破坏守恒
  });
});
