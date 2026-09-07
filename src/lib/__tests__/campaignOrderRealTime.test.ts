import { describe, expect, it } from 'vitest';
import {
  campaignRealTimeWindow,
  orderWithinRealWindow,
  REAL_TIME_LOOKBACK_MS,
} from '@/lib/campaignOrderRealTime';

/**
 * 场景：同一段 WLDUSDT 历史行情回放了两次。
 * 模拟时间轴上两次的委托完全重合；真实时间轴上，第一次在 9 月 5 日、第二次在 9 月 7 日。
 */
const DAY = 24 * 60 * 60_000;
const SESSION_A_OPEN = Date.parse('2026-09-05T10:00:00.000Z');
const SESSION_B_OPEN = Date.parse('2026-09-07T09:00:00.000Z');
const MIN = 60_000;

/** 第二次回放（本场）的成交：真实开仓 09:00，真实平仓 09:20。 */
const recordsB = [
  { openedRealAt: SESSION_B_OPEN, closedRealAt: SESSION_B_OPEN + 20 * MIN },
  { openedRealAt: SESSION_B_OPEN + 1 * MIN, closedRealAt: SESSION_B_OPEN + 5 * MIN },
];

describe('真实时间窗口：两次回放必须分开', () => {
  it('【回归】第一次回放的委托被排除，本场的保留，老委托放行', () => {
    const w = campaignRealTimeWindow({ tradeRecords: recordsB, legs: [], campaignClosed: true })!;
    expect(w).not.toBeNull();
    // 上一场的委托：真实时间早两天，模拟时间却和本场完全一样
    expect(orderWithinRealWindow(SESSION_A_OPEN + 30 * MIN, w)).toBe(false);
    // 本场的委托
    expect(orderWithinRealWindow(SESSION_B_OPEN + 3 * MIN, w)).toBe(true);
    // 老委托没有真实时刻 → 不做判断
    expect(orderWithinRealWindow(undefined, w)).toBe(true);
    expect(orderWithinRealWindow(null, w)).toBe(true);
  });

  it('前置对冲：开主力前 2 分钟挂的算本场，前 10 分钟的不算', () => {
    const w = campaignRealTimeWindow({ tradeRecords: recordsB, legs: [], campaignClosed: true })!;
    expect(orderWithinRealWindow(SESSION_B_OPEN - 2 * MIN, w)).toBe(true);
    expect(orderWithinRealWindow(SESSION_B_OPEN - 10 * MIN, w)).toBe(false);
    expect(w.start).toBe(SESSION_B_OPEN - REAL_TIME_LOOKBACK_MS);
  });

  it('上界取最晚的真实平仓；平仓之后才挂的单不属于本场', () => {
    const w = campaignRealTimeWindow({ tradeRecords: recordsB, legs: [], campaignClosed: true })!;
    expect(w.end).toBe(SESSION_B_OPEN + 20 * MIN);
    expect(orderWithinRealWindow(SESSION_B_OPEN + 20 * MIN, w)).toBe(true);
    expect(orderWithinRealWindow(SESSION_B_OPEN + 21 * MIN, w)).toBe(false);
  });

  it('进行中的战役上界开放', () => {
    const w = campaignRealTimeWindow({ tradeRecords: recordsB, legs: [], campaignClosed: false })!;
    expect(w.end).toBe(Number.POSITIVE_INFINITY);
    expect(orderWithinRealWindow(SESSION_B_OPEN + 3 * DAY, w)).toBe(true);
  });

  it('【判据】没有任何真实开仓证据 → 不做过滤（老战役原样）', () => {
    const legacy = [{ closedRealAt: SESSION_B_OPEN + 20 * MIN }];   // 只有平仓真实时刻
    expect(campaignRealTimeWindow({ tradeRecords: legacy, legs: [], campaignClosed: true })).toBeNull();
    expect(campaignRealTimeWindow({ tradeRecords: [], legs: [], campaignClosed: true })).toBeNull();
    expect(orderWithinRealWindow(SESSION_A_OPEN, null)).toBe(true);
  });

  it('回填腿的 pre_real_time 是归类时刻，不能当下界；实时腿的可以', () => {
    const classifiedAt = new Date(SESSION_B_OPEN + 2 * DAY).toISOString();   // 两天后才归类
    const backfilled = [{ pre_real_time: classifiedAt, source: 'retroactive_from_record' }];
    expect(campaignRealTimeWindow({ tradeRecords: [], legs: backfilled, campaignClosed: true })).toBeNull();

    const live = [{ pre_real_time: new Date(SESSION_B_OPEN).toISOString(), source: 'live' }];
    const w = campaignRealTimeWindow({ tradeRecords: [], legs: live, campaignClosed: false })!;
    expect(w.start).toBe(SESSION_B_OPEN - REAL_TIME_LOOKBACK_MS);
  });

  it('上界同时看成交的 closedRealAt 与腿的 post_real_close_time，取最晚', () => {
    const legs = [{ post_real_close_time: new Date(SESSION_B_OPEN + 40 * MIN).toISOString() }];
    const w = campaignRealTimeWindow({ tradeRecords: recordsB, legs, campaignClosed: true })!;
    expect(w.end).toBe(SESSION_B_OPEN + 40 * MIN);
  });

  it('已结束但没有真实平仓证据 → 上界开放，宁可多收不可误踢', () => {
    const opensOnly = [{ openedRealAt: SESSION_B_OPEN }];
    const w = campaignRealTimeWindow({ tradeRecords: opensOnly, legs: [], campaignClosed: true })!;
    expect(w.end).toBe(Number.POSITIVE_INFINITY);
  });

  it('脏值不参与：0 / NaN / 负数一律忽略', () => {
    const dirty = [
      { openedRealAt: 0, closedRealAt: NaN },
      { openedRealAt: -5, closedRealAt: SESSION_B_OPEN },
      { openedRealAt: SESSION_B_OPEN, closedRealAt: SESSION_B_OPEN + MIN },
    ];
    const w = campaignRealTimeWindow({ tradeRecords: dirty, legs: [], campaignClosed: true })!;
    expect(w.start).toBe(SESSION_B_OPEN - REAL_TIME_LOOKBACK_MS);
    expect(orderWithinRealWindow(NaN, w)).toBe(true);
    expect(orderWithinRealWindow(0, w)).toBe(true);
  });
});
