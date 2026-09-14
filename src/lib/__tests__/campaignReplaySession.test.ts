import { describe, expect, it } from 'vitest';
import {
  buildReplaySessionFilter,
  orderWithinRealWindow,
  type ReplayEvent,
} from '@/lib/campaignOrderRealTime';

const H = 3_600_000;
const M = 60_000;
/** 现实钱包时钟：2026-09-13 16:00（北京）起算的小时 / 分钟偏移。 */
const real = (h: number, m = 0) => Date.parse('2026-09-13T08:00:00.000Z') + h * H + m * M;
/** 模拟 K 线时钟：TUTUSDT 2026-08-07 19:41（北京）起算。 */
const sim = (h: number, m = 0) => Date.parse('2026-08-07T11:41:00.000Z') + h * H + m * M;

/** 一次回放同一段行情：挂 3 张委托，最后一笔成交平仓。 */
function replay(realStartHour: number, anchor: boolean) {
  const orders: ReplayEvent[] = [
    { realAt: real(realStartHour, 1), simAt: sim(0, 1) },
    { realAt: real(realStartHour, 20), simAt: sim(6) },
    { realAt: real(realStartHour, 40), simAt: sim(20) },
  ];
  const close: ReplayEvent = { realAt: real(realStartHour, 50), simAt: sim(30), anchor };
  return { orders, close, all: [...orders, close] };
}

describe('【用户要求】委托按操作时间对齐到同一次回放', () => {
  it('【回归 TUTUSDT 2026-08-07】本场之后又回放了一次同一段行情：那次的委托不算本场', () => {
    const mine = replay(0, true);
    const other = replay(3, false);
    const filter = buildReplaySessionFilter([...mine.all, ...other.all])!;
    expect(filter.sessionCount).toBe(2);
    // 两次回放的委托在模拟时间上一一重合——只看模拟时间分不开，这正是盘面成对出现的原因
    expect(mine.orders.map(o => o.simAt)).toEqual(other.orders.map(o => o.simAt));
    for (const order of mine.orders) expect(filter.allows(order.realAt)).toBe(true);
    for (const order of other.orders) expect(filter.allows(order.realAt)).toBe(false);
  });

  it('另一次回放在现实里先发生，也排除', () => {
    const other = replay(0, false);
    const mine = replay(3, true);
    const filter = buildReplaySessionFilter([...other.all, ...mine.all])!;
    for (const order of mine.orders) expect(filter.allows(order.realAt)).toBe(true);
    for (const order of other.orders) expect(filter.allows(order.realAt)).toBe(false);
  });

  it('本场自己在窗口里一张委托都没留下时，先发生的那次回放的委托也不会冒充本场', () => {
    const other = replay(0, false);
    // 本场只有两笔带真实时刻的平仓：镜像止盈先平（模拟 10h），主力后平（模拟 30h）
    const mine: ReplayEvent[] = [
      { realAt: real(3, 30), simAt: sim(10), anchor: true },
      { realAt: real(3, 50), simAt: sim(30), anchor: true },
    ];
    const filter = buildReplaySessionFilter([...other.all, ...mine])!;
    for (const order of other.orders) expect(filter.allows(order.realAt)).toBe(false);
  });

  it('老数据：委托没有真实时刻 → 放行，不因缺字段误踢', () => {
    const filter = buildReplaySessionFilter([...replay(0, true).all, ...replay(3, false).all])!;
    expect(filter.allows(undefined)).toBe(true);
    expect(filter.allows(null)).toBe(true);
    expect(filter.allows(0)).toBe(true);
  });

  it('本场成交一个带真实时刻的都没有 → 不做判断', () => {
    expect(buildReplaySessionFilter([...replay(0, false).all, ...replay(3, false).all])).toBeNull();
    expect(buildReplaySessionFilter([])).toBeNull();
  });

  it('事件落库顺序的小抖动（模拟时间回退不到 1 分钟）不切段', () => {
    const events: ReplayEvent[] = [
      { realAt: real(0, 1), simAt: sim(10) },
      { realAt: real(0, 2), simAt: sim(10) - 30_000 },
      { realAt: real(0, 3), simAt: sim(11), anchor: true },
    ];
    const filter = buildReplaySessionFilter(events)!;
    expect(filter.sessionCount).toBe(1);
    expect(filter.allows(real(0, 2))).toBe(true);
  });

  it('3600 倍下 state 时钟落后：现实里几乎同时的两件事，模拟回落 10 分钟也不切段', () => {
    const events: ReplayEvent[] = [
      { realAt: real(0, 1), simAt: sim(10), anchor: true },                   // 成交：撮合时钟现算
      { realAt: real(0, 1) + 200, simAt: sim(10) - 10 * M },                  // 200ms 后挂单：读到落后的 state 时钟
      { realAt: real(0, 2), simAt: sim(11) },
    ];
    const filter = buildReplaySessionFilter(events)!;
    expect(filter.sessionCount).toBe(1);
    expect(filter.allows(real(0, 1) + 200)).toBe(true);
  });

  it('短线再回放：只倒回 20 模拟分钟、现实隔了几分钟重打——照样分开', () => {
    const events: ReplayEvent[] = [
      // 本场：1 分钟级短线，模拟 0:00 → 0:15
      { realAt: real(0, 1), simAt: sim(0, 0) },
      { realAt: real(0, 5), simAt: sim(0, 15), anchor: true },
      // 3 分钟后倒回 20 模拟分钟再打一次
      { realAt: real(0, 8), simAt: sim(0, -5) },
      { realAt: real(0, 12), simAt: sim(0, 10) },
    ];
    const filter = buildReplaySessionFilter(events)!;
    expect(filter.sessionCount).toBe(2);
    expect(filter.allows(real(0, 1))).toBe(true);
    expect(filter.allows(real(0, 8))).toBe(false);
    expect(filter.allows(real(0, 12))).toBe(false);
  });

  it('同一次回放里倒回时间机器重做：含本场成交的每一段都保留，被放弃的那段不算', () => {
    const events: ReplayEvent[] = [
      // 第一段：挂单 → 本场一笔成交平仓
      { realAt: real(0, 1), simAt: sim(0) },
      { realAt: real(0, 10), simAt: sim(10), anchor: true },
      // 倒回：挂了两张单，没有任何本场成交，又倒回了——被放弃的时间线
      { realAt: real(0, 20), simAt: sim(2) },
      { realAt: real(0, 25), simAt: sim(6) },
      // 再倒回：挂单 → 本场另一笔成交平仓
      { realAt: real(0, 30), simAt: sim(1) },
      { realAt: real(0, 40), simAt: sim(9), anchor: true },
    ];
    const filter = buildReplaySessionFilter(events)!;
    expect(filter.sessionCount).toBe(3);
    expect(filter.allows(real(0, 1))).toBe(true);
    expect(filter.allows(real(0, 20))).toBe(false);
    expect(filter.allows(real(0, 25))).toBe(false);
    expect(filter.allows(real(0, 30))).toBe(true);
  });

  it('脏值不参与切段：0 / NaN / 负数的事件一律忽略', () => {
    const events: ReplayEvent[] = [
      { realAt: real(0, 1), simAt: sim(5), anchor: true },
      { realAt: Number.NaN, simAt: sim(0) },
      { realAt: real(0, 2), simAt: 0 },
      { realAt: -1, simAt: sim(1) },
      { realAt: real(0, 3), simAt: sim(6) },
    ];
    const filter = buildReplaySessionFilter(events)!;
    expect(filter.sessionCount).toBe(1);
    expect(filter.allows(real(0, 3))).toBe(true);
  });

  it('与 openedRealAt 窗口相与：窗口因缺证据放行时，回放分段仍然能把另一次回放挡住', () => {
    const mine = replay(0, true);
    const other = replay(3, false);
    const filter = buildReplaySessionFilter([...mine.all, ...other.all])!;
    const inRealWindow = (t: number) => orderWithinRealWindow(t, null) && filter.allows(t);
    expect(orderWithinRealWindow(other.orders[0].realAt, null)).toBe(true);   // 旧逻辑：整道失效
    expect(inRealWindow(other.orders[0].realAt)).toBe(false);                 // 现在：挡住
    expect(inRealWindow(mine.orders[0].realAt)).toBe(true);
  });
});
