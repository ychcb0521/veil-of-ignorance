import { describe, expect, it } from 'vitest';
import {
  bestOrderRealStamp,
  buildReplaySessionFilter,
  legCloseReplayEvent,
  legOpenReplayEvent,
  orderClockStamp,
  orderWithinRealWindow,
  type ReplayEvent,
} from '@/lib/campaignOrderRealTime';

const H = 3_600_000;
const M = 60_000;
/** 现实钱包时钟：2026-09-13 16:00（北京）起算的小时 / 分钟偏移。 */
const real = (h: number, m = 0) => Date.parse('2026-09-13T08:00:00.000Z') + h * H + m * M;
/** 模拟 K 线时钟：TUTUSDT 2026-08-07 19:41（北京）起算。 */
const sim = (h: number, m = 0) => Date.parse('2026-08-07T11:41:00.000Z') + h * H + m * M;
/** 盖章上线（2026-09-07）之前的现实时钟：老战役是 6 月打的。 */
const june = (h: number, m = 0) => Date.parse('2026-06-20T08:00:00.000Z') + h * H + m * M;

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

describe('【用户要求】委托归属到本场自己的回放时间线：取代 / 盖章时代 / 最佳时刻 / 腿锚点', () => {
  const S = 1_000;
  const order = (realAt: number, simAt: number): ReplayEvent => ({ realAt, simAt, kind: 'order-create' });

  /**
   * 【回归 L4】仓位跨过一次倒回：第 A 遍开主力，跳回去在第 B 遍平掉。
   * A 在倒回点之后挂的单，被 B 在同一模拟分钟、同一价格重挂一次——盘面成对出现的来源。
   */
  function carriedAcrossRewind() {
    const aEarly = order(real(0, -1), sim(0, -2));                  // A：开主力前 2 分钟的前置对冲（倒回点之前）
    const aDup = order(real(0, 2), sim(0, 1) + 20 * S);             // A：19:42 挂的空单（被 B 重走）
    const bDup = order(real(1, 34), sim(0, 1));                     // B：同一分钟重挂
    const events: ReplayEvent[] = [
      aEarly,
      { realAt: real(0, 0), simAt: sim(0), anchor: true, kind: 'record-open' },
      aDup,
      { realAt: real(0, 10), simAt: sim(3), kind: 'order-end' },
      bDup,
      { realAt: real(1, 39), simAt: sim(30, 5), anchor: true, kind: 'record-close' },
    ];
    return { aEarly, aDup, bDup, filter: buildReplaySessionFilter(events)! };
  }

  it('【取代】A 遍在倒回点之后挂的单（B 遍重走过的模拟时刻）不算本场', () => {
    const { aDup, bDup, filter } = carriedAcrossRewind();
    expect(filter.sessionCount).toBe(2);
    // 两段都含本场锚点，单看成员资格两张都会留下——这就是旧逻辑
    expect(filter.allows(aDup.realAt)).toBe(true);
    expect(filter.allowsOrder({ realAt: aDup.realAt, simAt: aDup.simAt })).toBe(false);
    expect(filter.allowsOrder({ realAt: bDup.realAt, simAt: bDup.simAt })).toBe(true);
  });

  it('【取代】A 遍在倒回点之前挂的单没有被重走，保留', () => {
    const { aEarly, filter } = carriedAcrossRewind();
    expect(filter.allowsOrder({ realAt: aEarly.realAt, simAt: aEarly.simAt })).toBe(true);
  });

  it('【取代】不含本场锚点的段既不保留，也不截断别人', () => {
    const events: ReplayEvent[] = [
      { realAt: real(0, 0), simAt: sim(0), anchor: true, kind: 'record-open' },
      order(real(0, 1), sim(1)),
      { realAt: real(0, 5), simAt: sim(5), kind: 'order-end' },
      // 无关的一段：倒回到 sim(0) 随手挂了单
      order(real(1, 0), sim(0)),
      { realAt: real(1, 1), simAt: sim(4), kind: 'order-end' },
      // 本场的 B 段从 sim(2) 起重走
      order(real(2, 0), sim(2)),
      { realAt: real(2, 5), simAt: sim(8), anchor: true, kind: 'record-close' },
    ];
    const filter = buildReplaySessionFilter(events)!;
    expect(filter.sessionCount).toBe(3);
    // A 段截断点是 B 的 sim(2)，不是无关段的 sim(0)
    expect(filter.allowsOrder({ realAt: real(0, 1), simAt: sim(1) })).toBe(true);
    expect(filter.allowsOrder({ realAt: real(1, 0), simAt: sim(0) })).toBe(false);
    expect(filter.allowsOrder({ realAt: real(2, 0), simAt: sim(2) })).toBe(true);
  });

  it('【盖章时代 L1】保留的段里有委托 createdRealAt：一个真实时刻都没有的委托必早于上线，拒绝', () => {
    const filter = buildReplaySessionFilter([
      order(real(0, 1), sim(0, 1)),
      { realAt: real(0, 50), simAt: sim(30), anchor: true, kind: 'record-close' },
    ])!;
    expect(filter.stampEra).toBe(true);
    expect(filter.allowsOrder({ realAt: undefined, simAt: sim(0, 1) })).toBe(false);
    expect(filter.allowsOrder({ realAt: null, simAt: sim(0, 1) })).toBe(false);
    expect(filter.allowsOrder({ realAt: 0, simAt: sim(0, 1) })).toBe(false);
  });

  it('【盖章时代】本场成交的 openedRealAt 同样是证据；别人的开仓、无关段里的委托不算', () => {
    const byOwnOpen = buildReplaySessionFilter([
      { realAt: real(0, 1), simAt: sim(0), anchor: true, kind: 'record-open' },
    ])!;
    expect(byOwnOpen.stampEra).toBe(true);

    const notMine = buildReplaySessionFilter([
      // 本场（6 月的老战役）：只有平仓真实时刻
      { realAt: june(0, 50), simAt: sim(30), anchor: true, kind: 'record-close' },
      // 之后另一次回放：有盖章，但那一段不含本场锚点
      { realAt: real(3, 0), simAt: sim(0), kind: 'record-open' },
      order(real(3, 1), sim(0, 1)),
    ])!;
    expect(notMine.stampEra).toBe(false);
  });

  it('【老战役】保留的段里没有盖章证据：没有真实时刻的委托照旧放行', () => {
    // 6 月打的：平仓时刻早于上线，不证明任何一段是盖章时代
    const filter = buildReplaySessionFilter([
      { realAt: june(0, 30), simAt: sim(10), anchor: true, kind: 'record-close' },
      { realAt: june(0, 40), simAt: sim(20), kind: 'order-end' },
      { realAt: june(0, 50), simAt: sim(30), anchor: true, kind: 'leg-close' },
    ])!;
    expect(filter.stampEra).toBe(false);
    expect(filter.allowsOrder({ realAt: undefined, simAt: sim(1) })).toBe(true);
  });

  it('【最佳时刻 L2】挂单没盖章、撤单 / 成交盖了章：按撤单 / 成交时刻判归属', () => {
    expect(bestOrderRealStamp({ createdRealAt: real(0, 1), cancelledRealAt: real(0, 9) })).toBe(real(0, 1));
    expect(bestOrderRealStamp({ cancelledRealAt: real(0, 9) })).toBe(real(0, 9));
    expect(bestOrderRealStamp({ createdRealAt: 0, filledRealAt: real(0, 7) })).toBe(real(0, 7));
    expect(bestOrderRealStamp({ createdRealAt: Number.NaN, cancelledRealAt: -1 })).toBeNull();
    expect(bestOrderRealStamp({})).toBeNull();

    const mine = replay(3, true);
    const otherCancel: ReplayEvent = { realAt: real(0, 9), simAt: sim(5), kind: 'order-end' };
    const mineCancel: ReplayEvent = { realAt: real(3, 45), simAt: sim(25), kind: 'order-end' };
    const filter = buildReplaySessionFilter([...mine.all, otherCancel, mineCancel])!;
    const partialOther = { cancelledRealAt: otherCancel.realAt };
    const partialMine = { cancelledRealAt: mineCancel.realAt };
    expect(filter.allowsOrder({ realAt: bestOrderRealStamp(partialOther), simAt: sim(0, 1) })).toBe(false);
    expect(filter.allowsOrder({ realAt: bestOrderRealStamp(partialMine), simAt: sim(20) })).toBe(true);
  });

  it('【腿锚点 L3】本地成交没了，只剩腿上的平仓操作时刻：照样认得出本场那一段', () => {
    const legClose = legCloseReplayEvent({
      source: 'retroactive_from_record',
      post_real_close_time: new Date(real(0, 50)).toISOString(),
      post_simulated_close_time: new Date(sim(30)).toISOString(),
    });
    expect(legClose).toEqual({ realAt: real(0, 50), simAt: sim(30), anchor: true, kind: 'leg-close' });

    const mineOrders = replay(0, false).orders.map(event => ({ ...event, kind: 'order-create' as const }));
    const otherOrders = replay(3, false).orders.map(event => ({ ...event, kind: 'order-create' as const }));
    const filter = buildReplaySessionFilter([...mineOrders, legClose!, ...otherOrders])!;
    for (const event of mineOrders) expect(filter.allowsOrder(event)).toBe(true);
    for (const event of otherOrders) expect(filter.allowsOrder(event)).toBe(false);
  });

  it('【腿锚点】与界面「操作」时间同一口径：被模拟时间污染的回填腿不作锚点', () => {
    const polluted = new Date(sim(30)).toISOString();
    // 回填腿只有 post_real_close_time（无独立模拟平仓）→ 分不清是哪只钟
    expect(legCloseReplayEvent({ source: 'retroactive_from_record', post_real_close_time: polluted })).toBeNull();
    // 两个字段相同 → 同样是污染
    expect(legCloseReplayEvent({
      source: 'retroactive_from_record',
      post_real_close_time: polluted,
      post_simulated_close_time: polluted,
    })).toBeNull();
    // 实时腿的 post_real_close_time 本就可信，但缺模拟平仓时刻就无从切段
    expect(legCloseReplayEvent({ source: 'live', post_real_close_time: new Date(real(0, 50)).toISOString() })).toBeNull();
    expect(legCloseReplayEvent({
      source: 'live',
      post_real_close_time: new Date(real(0, 50)).toISOString(),
      post_simulated_close_time: new Date(sim(30)).toISOString(),
    })).toMatchObject({ realAt: real(0, 50), simAt: sim(30), anchor: true });
  });
});

describe('【复核】盖章时代按模拟先后判 / 活过倒回不被取代 / 重走要有事件为证 / 实时腿开仓锚点', () => {
  const S = 1_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const order = (realAt: number, simAt: number): ReplayEvent => ({ realAt, simAt, kind: 'order-create' });

  it('orderClockStamp：成员资格看最佳真实时刻，盖章判断看挂单（及未盖章的结束），仍挂着活到 +Infinity', () => {
    expect(orderClockStamp({ createdAt: sim(1), createdRealAt: real(0, 1), cancelledAt: sim(5), cancelledRealAt: real(0, 5) }))
      .toEqual({ realAt: real(0, 1), simAt: sim(1), preStampSimAt: null, endRealAt: real(0, 5) });
    // 挂单没盖章、撤单盖了章（⏹ 停止撤掉的老委托）：成员资格看撤单时刻，盖章判断看挂单时刻
    expect(orderClockStamp({ createdAt: sim(1), cancelledAt: sim(5), cancelledRealAt: real(0, 5) }))
      .toEqual({ realAt: real(0, 5), simAt: sim(1), preStampSimAt: sim(1), endRealAt: real(0, 5) });
    // 两头都没盖章：上线前就结束了，取更晚的撤单时刻作界
    expect(orderClockStamp({ createdAt: sim(1), cancelledAt: sim(5) }))
      .toEqual({ realAt: null, simAt: sim(1), preStampSimAt: sim(5), endRealAt: null });
    // 挂单盖了章、成交没盖（减仓单成交快照至今不写 filledRealAt）：不据此判早于上线
    expect(orderClockStamp({ createdAt: sim(1), createdRealAt: real(0, 1), filledAt: sim(5) }).preStampSimAt).toBeNull();
    expect(orderClockStamp({ createdAt: sim(1), createdRealAt: real(0, 1) }, { live: true }).endRealAt)
      .toBe(Number.POSITIVE_INFINITY);
  });

  it('【盖章时代】挂单没盖章的老委托，撤单 / 成交时刻盖在本段里（⏹ 停止一键撤单）也不算本场', () => {
    const filter = buildReplaySessionFilter([
      { realAt: real(0, 0), simAt: sim(0), anchor: true, kind: 'record-open' },
      order(real(0, 1), sim(0, 1)),
      { realAt: real(0, 50), simAt: sim(30), anchor: true, kind: 'record-close' },
      { realAt: real(0, 50) + 10 * S, simAt: sim(30), kind: 'order-end' },
    ])!;
    const stopCancelled = orderClockStamp({
      createdAt: sim(0, 1) + 15 * S,
      cancelledAt: sim(30),
      cancelledRealAt: real(0, 50) + 10 * S,
    });
    expect(filter.allowsOrder(stopCancelled)).toBe(false);
    const carriedFilled = orderClockStamp({ createdAt: sim(0, 3), filledAt: sim(4), filledRealAt: real(0, 10) });
    expect(filter.allowsOrder(carriedFilled)).toBe(false);
    // 同一张单若挂单也盖了章，就是本遍自己的
    expect(filter.allowsOrder(orderClockStamp({
      createdAt: sim(0, 3),
      createdRealAt: real(0, 3),
      filledAt: sim(4),
      filledRealAt: real(0, 10),
    }))).toBe(true);
  });

  it('【盖章时代】跨过上线那一刻打的一遍：早于本段第一个盖章证据的无章委托保留，晚于它的拒绝', () => {
    const filter = buildReplaySessionFilter([
      order(real(0, 10), sim(10)),                                              // 上线后的第一张委托
      // 主力上线前开的仓（没有 openedRealAt）：这一段跨过了上线
      { realAt: real(0, 50), simAt: sim(30), anchor: true, kind: 'record-close', unstampedOpen: true },
    ])!;
    expect(filter.allowsOrder(orderClockStamp({ createdAt: sim(2), cancelledAt: sim(5) }))).toBe(true);
    // 撤单没盖章却晚于证据：撤单时现实已过上线，理应盖章
    expect(filter.allowsOrder(orderClockStamp({ createdAt: sim(2), cancelledAt: sim(10) }))).toBe(false);
    expect(filter.allowsOrder(orderClockStamp({ createdAt: sim(12), cancelledAt: sim(20) }))).toBe(false);
  });

  it('【盖章时代】老战役之后同一标的往后接着打的盖章回放并进了同一段：老战役自己的无章委托不被踢', () => {
    const filter = buildReplaySessionFilter([
      { realAt: june(0, 50), simAt: sim(30), anchor: true, kind: 'record-close' },
      // 9 月从更晚的行情接着打：模拟时间只往前走，不切段
      order(real(72, 0), sim(200)),
      { realAt: real(72, 5), simAt: sim(201), kind: 'order-end' },
    ])!;
    expect(filter.sessionCount).toBe(1);
    // 老战役结束在它最后一次平仓；隔了几个月的那次坐下来不属于本场，它的盖章也不作数
    expect(filter.stampEra).toBe(false);
    expect(filter.allows(real(72, 0))).toBe(false);
    expect(filter.allowsOrder(orderClockStamp({ createdAt: sim(1), cancelledAt: sim(6) }))).toBe(true);
    expect(filter.allowsOrder({ realAt: null, simAt: sim(1) })).toBe(true);
  });

  it('【取代】活过倒回的委托（B 遍里才成交 / 撤单，或至今仍挂着）不被 B 遍取代；A 遍里就结束的照样取代', () => {
    const aOrder = order(real(0, 2), sim(0, 1) + 20 * S);
    const filter = buildReplaySessionFilter([
      { realAt: real(0, 0), simAt: sim(0), anchor: true, kind: 'record-open' },
      aOrder,
      { realAt: real(0, 10), simAt: sim(3), kind: 'order-end' },
      order(real(1, 34), sim(0, 1)),                                              // B 遍从 19:42 起重走
      { realAt: real(1, 36), simAt: sim(2), kind: 'order-end' },                  // A 遍那张在 B 遍里成交
      { realAt: real(1, 39), simAt: sim(30, 5), anchor: true, kind: 'record-close' },
    ])!;
    expect(filter.sessionCount).toBe(2);
    const base = { realAt: aOrder.realAt, simAt: aOrder.simAt };
    expect(filter.allowsOrder({ ...base, endRealAt: real(1, 36) })).toBe(true);
    expect(filter.allowsOrder({ ...base, endRealAt: Number.POSITIVE_INFINITY })).toBe(true);
    expect(filter.allowsOrder({ ...base, endRealAt: real(0, 5) })).toBe(false);
    expect(filter.allowsOrder(base)).toBe(false);
  });

  it('【取代】B 遍先绕去更早的历史、再一跳越过 A 遍那段：没有事件为证的部分不算重走', () => {
    const aHedge = order(real(0, 1), sim(1));
    const detourThenJump: ReplayEvent[] = [
      { realAt: real(0, 0), simAt: sim(0), anchor: true, kind: 'record-open' },
      aHedge,
      { realAt: real(0, 2), simAt: sim(1, 10), kind: 'order-end' },
      order(real(0, 10), sim(-160)),                                               // 带着仓位跳到一周前的信号
      { realAt: real(0, 11), simAt: sim(-160, 10), kind: 'order-end' },
      order(real(0, 20), sim(21)),                                                 // 再往前一跳，越过 A 遍那段
      { realAt: real(0, 30), simAt: sim(30), anchor: true, kind: 'record-close' },
    ];
    const filter = buildReplaySessionFilter(detourThenJump)!;
    expect(filter.sessionCount).toBe(2);
    expect(filter.allowsOrder({ realAt: aHedge.realAt, simAt: aHedge.simAt, endRealAt: real(0, 2) })).toBe(true);

    // 对照：B 遍在 A 遍那段里真留下过事件（19:41:30 挂过单）——A 遍在那之后挂、又在 A 遍结束的单子算被重走
    const replayed = buildReplaySessionFilter([...detourThenJump, order(real(0, 15), sim(0) + 30 * S)])!;
    expect(replayed.allowsOrder({ realAt: aHedge.realAt, simAt: aHedge.simAt, endRealAt: real(0, 2) })).toBe(false);
  });

  it('【实时腿开仓锚点】只认实时腿且要有成对的模拟时刻；进行中的战役没有平仓锚点也建得起分段', () => {
    const legOpen = legOpenReplayEvent({ source: 'live', pre_real_time: iso(real(0, 5)), pre_simulated_time: iso(sim(0)) });
    expect(legOpen).toEqual({ realAt: real(0, 5), simAt: sim(0), anchor: true, kind: 'leg-open' });
    // 回填腿的 pre_real_time 是归类那一刻，不成对
    expect(legOpenReplayEvent({
      source: 'retroactive_from_record',
      pre_real_time: iso(real(0, 5)),
      pre_simulated_time: iso(sim(0)),
    })).toBeNull();
    expect(legOpenReplayEvent({ source: 'live', pre_real_time: iso(real(0, 5)), pre_simulated_time: '' })).toBeNull();

    const filter = buildReplaySessionFilter([
      order(real(0, -5), sim(0, -2)),              // 挂好前置对冲，现实里停了 10 分钟才记录决策
      legOpen!,
      order(real(3, 1), sim(0, -3)),               // 之后另一次回放同一段行情
    ])!;
    expect(filter.allowsOrder({ realAt: real(0, -5), simAt: sim(0, -2) })).toBe(true);
    expect(filter.allowsOrder({ realAt: real(3, 1), simAt: sim(0, -3) })).toBe(false);
  });
});

describe('【复核二】按坐下来修剪时间线 / 取代容差 / 上线时刻作证据', () => {
  const S = 1_000;
  const order = (realAt: number, simAt: number): ReplayEvent => ({ realAt, simAt, kind: 'order-create' });
  const openAnchor = (realAt: number, simAt: number): ReplayEvent => ({ realAt, simAt, anchor: true, kind: 'record-open' });
  const closeAnchor = (realAt: number, simAt: number): ReplayEvent => ({ realAt, simAt, anchor: true, kind: 'record-close' });

  it('【开头】本场从开仓锚点开始：同一段里隔着一次坐下来的更早尝试不算；同一次坐下来里停 10 分钟的前置对冲照算', () => {
    const filter = buildReplaySessionFilter([
      order(real(-72, 0), sim(0, -3)),                 // 三天前挂了前置对冲又放弃，模拟时刻没有晚于本场
      order(real(0, -10), sim(0, -2)),                 // 本场：挂好前置对冲，停下来想了 10 分钟
      openAnchor(real(0, 0), sim(0)),
      closeAnchor(real(0, 50), sim(30)),
    ])!;
    expect(filter.sessionCount).toBe(1);
    expect(filter.allows(real(-72, 0))).toBe(false);
    expect(filter.allowsOrder({ realAt: real(0, -10), simAt: sim(0, -2) })).toBe(true);
  });

  it('【开头】最早的锚点是平仓侧（成交被清掉只剩腿的平仓时刻）：不知道战役从哪开始，不修剪', () => {
    const filter = buildReplaySessionFilter([
      order(real(0, 0), sim(1)),
      { realAt: real(5, 0), simAt: sim(8), anchor: true, kind: 'leg-close' },
    ])!;
    expect(filter.allows(real(0, 0))).toBe(true);
  });

  it('【结尾】已结束的战役停在最后一次平仓：之后隔着一次坐下来的事件不算；中途停一夜不切', () => {
    const filter = buildReplaySessionFilter([
      openAnchor(real(0, 0), sim(0)),
      order(real(12, 0), sim(10)),                     // 停了一夜才挂的对冲：中途，保留
      closeAnchor(real(12, 30), sim(30)),
      order(real(12, 30) + 10 * S, sim(30)),           // ⏹ 停止：同一次坐下来
      order(real(20, 0), sim(40)),                     // 当天晚些时候从这里往后接着打另一场
    ])!;
    expect(filter.allows(real(12, 0))).toBe(true);
    expect(filter.allows(real(12, 30) + 10 * S)).toBe(true);
    expect(filter.allows(real(20, 0))).toBe(false);
  });

  it('【进行中】仓位还开着：倒回之后同一次坐下来里不含锚点的那一遍算本场，并取代 A 遍被重走的部分；隔开一次坐下来的不算', () => {
    const events: ReplayEvent[] = [
      { realAt: real(0, 0), simAt: sim(0), anchor: true, kind: 'leg-open' },
      order(real(0, 5), sim(9, 50)),
      { realAt: real(0, 6), simAt: sim(10), kind: 'order-end' },
      order(real(0, 40), sim(2, 10)),                  // 倒回到 sim+2h 后给还开着的主力挂对冲
      order(real(5, 0), sim(0, 30)),                   // 几小时后另一次回放同一段行情
    ];
    const open = buildReplaySessionFilter(events, { campaignOpen: true })!;
    expect(open.allowsOrder({ realAt: real(0, 40), simAt: sim(2, 10) })).toBe(true);
    expect(open.allowsOrder({ realAt: real(0, 5), simAt: sim(9, 50), endRealAt: real(0, 6) })).toBe(false);
    expect(open.allowsOrder({ realAt: real(5, 0), simAt: sim(0, 30) })).toBe(false);
    // 已结束的战役：不含锚点的那一遍是被放弃的时间线
    const closed = buildReplaySessionFilter(events)!;
    expect(closed.allowsOrder({ realAt: real(0, 40), simAt: sim(2, 10) })).toBe(false);
  });

  it('【取代容差】同一分钟里 A 遍那张比 B 遍早几秒也被取代；早于 B 遍证据一分钟以上的不算重走', () => {
    const filter = buildReplaySessionFilter([
      openAnchor(real(0, 0), sim(0)),
      order(real(0, 1), sim(0, 1)),
      { realAt: real(0, 6), simAt: sim(3), kind: 'order-end' },
      order(real(1, 34), sim(0, 1) + 15 * S),          // B 遍从这里起重走
      closeAnchor(real(1, 39), sim(30)),
    ])!;
    expect(filter.allowsOrder({ realAt: real(0, 1), simAt: sim(0, 1), endRealAt: real(0, 6) })).toBe(false);
    expect(filter.allowsOrder({ realAt: real(0, 1), simAt: sim(0, -1), endRealAt: real(0, 6) })).toBe(true);
  });

  it('【上线证据】任何晚于上线的真实时刻都作证（腿的平仓操作也算）；无章委托只在跨上线的段里、早于证据时放行', () => {
    const legCloseOnly = buildReplaySessionFilter([
      { realAt: real(0, 1), simAt: sim(0, 8), anchor: true, kind: 'leg-close' },
      { realAt: real(0, 5), simAt: sim(30), anchor: true, kind: 'leg-close' },
    ])!;
    expect(legCloseOnly.stampEra).toBe(true);
    expect(legCloseOnly.allowsOrder({ realAt: null, simAt: sim(2) })).toBe(false);
    // 开主力前回看窗里的无章委托：这一段没有任何上线前的证据 → 同样拒绝
    const stamped = buildReplaySessionFilter([openAnchor(real(0, 0), sim(0)), closeAnchor(real(0, 50), sim(30))])!;
    expect(stamped.allowsOrder({ realAt: null, simAt: sim(0, -3) })).toBe(false);
    // 主力上线前开仓（平仓记录没有 openedRealAt）：跨上线，早于第一张盖章委托的无章委托放行
    const straddle = buildReplaySessionFilter([
      order(real(0, 10), sim(10)),
      { realAt: real(0, 50), simAt: sim(30), anchor: true, kind: 'record-close', unstampedOpen: true },
    ])!;
    expect(straddle.allowsOrder({ realAt: null, simAt: sim(0, -3) })).toBe(true);
    // 6 月（上线前）的平仓时刻不作证
    expect(buildReplaySessionFilter([closeAnchor(june(0, 5), sim(30))])!.stampEra).toBe(false);
  });
});

describe('【复核三】进行中的战役按锚点延续 / 活进保留段的委托', () => {
  const order = (realAt: number, simAt: number): ReplayEvent => ({ realAt, simAt, kind: 'order-create' });
  const legOpen = (realAt: number, simAt: number): ReplayEvent => ({ realAt, simAt, anchor: true, kind: 'leg-open' });
  const live = Number.POSITIVE_INFINITY;

  it('【进行中】锚点所在段不按坐下来修剪：隔天回来接着往后打（没有倒回）的对冲算本场；隔天倒回另起一遍的不算', () => {
    const filter = buildReplaySessionFilter([
      legOpen(real(0, 0), sim(0)),
      order(real(0, 1), sim(0, 1)),
      order(real(14, 0), sim(0, 40)),                  // 第二天接着打同一遍
      order(real(20, 0), sim(0, 10)),                  // 又隔了几小时，倒回去另起一遍
    ], { campaignOpen: true })!;
    expect(filter.allowsOrder({ realAt: real(14, 0), simAt: sim(0, 40), endRealAt: live })).toBe(true);
    expect(filter.allowsOrder({ realAt: real(20, 0), simAt: sim(0, 10), endRealAt: live })).toBe(false);
  });

  it('【进行中】两次记录决策之间倒回出来的那一遍：同一次坐下来里照算（补记加仓不会让它消失），隔开一次坐下来的不算', () => {
    const passB: ReplayEvent[] = [
      legOpen(real(0, 0), sim(0)),
      { realAt: real(0, 10), simAt: sim(1, 0), kind: 'order-end' },
      order(real(0, 20), sim(0, 10)),                  // 倒回后给还开着的主力挂的对冲，至今挂着
      { realAt: real(0, 30), simAt: sim(1, 30), kind: 'order-end' },
    ];
    const hedge = orderClockStamp({ createdAt: sim(0, 10), createdRealAt: real(0, 20) }, { live: true });
    const cancelledInB = { realAt: real(0, 20), simAt: sim(0, 10), endRealAt: real(0, 25) };
    const before = buildReplaySessionFilter(passB, { campaignOpen: true })!;
    const after = buildReplaySessionFilter([...passB, legOpen(real(0, 40), sim(0, 20))], { campaignOpen: true })!;
    expect(before.allowsOrder(hedge)).toBe(true);
    expect(after.allowsOrder(hedge)).toBe(true);
    expect(after.allowsOrder(cancelledInB)).toBe(true);

    // 另一天倒回打的一遍夹在两次记录决策之间：不是本场的延续
    const apart = buildReplaySessionFilter([
      legOpen(real(0, 0), sim(0)),
      { realAt: real(0, 10), simAt: sim(1, 0), kind: 'order-end' },
      order(real(24, 0), sim(0, 10)),
      { realAt: real(24, 10), simAt: sim(1, 30), kind: 'order-end' },
      legOpen(real(48, 0), sim(0, 20)),
    ], { campaignOpen: true })!;
    expect(apart.allowsOrder({ realAt: real(24, 0), simAt: sim(0, 10), endRealAt: real(24, 5) })).toBe(false);
  });

  it('【成员资格】倒回之前挂的单活进了本场这一遍（至今挂着 / 这一遍里才撤）：算本场；倒回前就结束的、上一次坐下来挂的不算', () => {
    const filter = buildReplaySessionFilter([
      order(real(-72, 0), sim(0, 7)),                  // 三天前挂的，至今挂着
      order(real(0, -2), sim(0, 8)),                   // 挂好对冲，再倒回 8 个模拟分钟开主力
      { realAt: real(0, 0), simAt: sim(0), anchor: true, kind: 'record-open' },
      order(real(0, 1), sim(0, 3)),
      { realAt: real(0, 50), simAt: sim(2, 0), anchor: true, kind: 'record-close' },
    ])!;
    expect(filter.sessionCount).toBe(2);
    const preRewind = { createdAt: sim(0, 8), createdRealAt: real(0, -2) };
    expect(filter.allowsOrder(orderClockStamp(preRewind, { live: true }))).toBe(true);
    expect(filter.allowsOrder(orderClockStamp({ ...preRewind, cancelledAt: sim(1), cancelledRealAt: real(0, 20) }))).toBe(true);
    expect(filter.allowsOrder(orderClockStamp({ ...preRewind, cancelledAt: sim(0, 9), cancelledRealAt: real(0, -1) }))).toBe(false);
    expect(filter.allowsOrder(orderClockStamp({ createdAt: sim(0, 7), createdRealAt: real(-72, 0) }, { live: true }))).toBe(false);
  });
});
