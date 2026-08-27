import { describe, expect, it } from 'vitest';
import type { PendingOrder } from '@/types/trading';
import { orderPriceKindLabel, orderReferencePrice, panelReferencePrice } from '@/lib/orderReferencePrice';

/**
 * 折算价的唯一判据是**引擎真正在哪个价成交**，不是「哪个字段看上去像个价」。
 * 每条断言下面都写了它对应的撮合代码位置——改这张表之前先去读那一行。
 */
const MARKET = 0.011199;

const order = (over: Partial<PendingOrder>): PendingOrder => ({
  id: 'o1', side: 'LONG', type: 'LIMIT', price: 0, stopPrice: 0,
  quantity: 1, leverage: 3, marginMode: 'isolated', status: 'NEW', createdAt: 0,
  ...over,
} as PendingOrder);

describe('挂单折算价：逐型对照撮合引擎', () => {
  it('LIMIT / POST_ONLY 成交在 order.price（Index.tsx:1126,1129）', () => {
    for (const type of ['LIMIT', 'POST_ONLY'] as const) {
      expect(orderReferencePrice(order({ type, price: 0.0100 }), MARKET))
        .toEqual({ price: 0.0100, kind: 'limit' });
    }
  });

  it('CONDITIONAL 成交在触发价（Index.tsx:648 → :545）——本次事故的那一单', () => {
    const ref = orderReferencePrice(order({ type: 'CONDITIONAL', price: 0, stopPrice: 0.010344 }), MARKET);
    expect(ref).toEqual({ price: 0.010344, kind: 'trigger' });
  });

  it('【回归】条件单绝不走「价优先」——旧单里的幽灵委托价必须被无视', () => {
    // ordersMap 会持久化并同步到云端。本次之前挂出的条件单可能带着一个幽灵 price：
    // 切到条件委托标签前在限价框填过的残值。源头已经掐掉，但旧单还带着它。
    // 引擎从头到尾只读触发价（Index.tsx:533-546 没有一处读 order.price），
    // 价优先会把 0.0113 读成委托价 → 884.96 NOM「按委托价折算」，
    // 恰好在这个修复本来要救的那批旧单上读错。
    expect(orderReferencePrice(order({ type: 'CONDITIONAL', price: 0.0113, stopPrice: 0.010344 }), MARKET))
      .toEqual({ price: 0.010344, kind: 'trigger' });
  });

  it('【回归】triggerPrice: 0 不得遮住有效的 stopPrice', () => {
    // resolveConditionalTriggerPrice 用 `triggerPrice ?? stopPrice`，`??` 不对 0 兜底。
    const shadowed = { ...order({ type: 'CONDITIONAL', price: 0, stopPrice: 0.010344 }), triggerPrice: 0 };
    expect(orderReferencePrice(shadowed as PendingOrder, MARKET))
      .toEqual({ price: 0.010344, kind: 'trigger' });
  });

  it('MARKET_TP_SL 读 stopPrice——引擎就成交在那儿，且面板已不再产生这个类型', () => {
    // 我一度让它退回现价，理由是「面板还以为自己在下市价单，两屏会差 25%」。
    // 那条理由随勾选框的改造一起作废了：勾选不再改写类型，面板永远不会同屏
    // 显示一张 MARKET_TP_SL，只剩已经持久化的旧单。对旧单就该按引擎的成交价折。
    expect(orderReferencePrice(order({ type: 'MARKET_TP_SL', price: 0, stopPrice: 0.015 }), MARKET))
      .toEqual({ price: 0.015, kind: 'trigger' });
  });

  it('LIMIT_TP_SL 仍然走价优先——它成交在 price，stopPrice 只是武装线', () => {
    expect(orderReferencePrice(order({ type: 'LIMIT_TP_SL', price: 0.0100, stopPrice: 0.0150 }), MARKET))
      .toEqual({ price: 0.0100, kind: 'limit' });
  });

  it('LIMIT_TP_SL 成交在 price，stopPrice 只是武装线（Index.tsx:1149-1159）', () => {
    // 拿武装线当折算价会把 1000 个币读成 666.67——hedgeLines.ts:106 的 stopPrice 优先
    // 排法正好会犯这个错，所以这条不是凑数的。
    expect(orderReferencePrice(order({ type: 'LIMIT_TP_SL', price: 0.0100, stopPrice: 0.0150 }), MARKET))
      .toEqual({ price: 0.0100, kind: 'limit' });
  });

  it('TRAILING_STOP 的 stopPrice 是激活价，不是成交价——必须退回市价', () => {
    // 成交价 = 极值 ×(1∓回调率)（Index.tsx:1197,1210）。激活价 0.0125、回调 5% 时，
    // 可达区间是 526–842 个币，而按激活价折出来的 800 落在区间外：一个永远不会发生的数。
    expect(orderReferencePrice(order({ type: 'TRAILING_STOP', price: 0, stopPrice: 0.0125 }), MARKET))
      .toEqual({ price: MARKET, kind: 'market' });
  });

  it('TWAP 的两个价都是 0，退回市价而不是折出 0 或 Infinity', () => {
    expect(orderReferencePrice(order({ type: 'TWAP', price: 0, stopPrice: 0 }), MARKET))
      .toEqual({ price: MARKET, kind: 'market' });
  });

  it('取不到任何价时也绝不返回 0 / NaN——张数那一行挂在币数分支里，返回 null 会把它一起抹掉', () => {
    for (const bad of [0, -1, NaN, Infinity, undefined as unknown as number]) {
      const ref = orderReferencePrice(order({ type: 'CONDITIONAL', price: 0, stopPrice: bad }), MARKET);
      expect(ref).toEqual({ price: MARKET, kind: 'market' });
    }
    // 连市价都没有时返回 0，由调用方的 coinNotionalAmount 决定怎么显示，不臆造数
    expect(orderReferencePrice(order({ type: 'TWAP' }), 0)).toEqual({ price: 0, kind: 'market' });
  });

  it('老数据把触发价存在 triggerPrice 别名上——回填只跑在挂载期，不能裸读 stopPrice', () => {
    const legacy = { ...order({ type: 'CONDITIONAL', price: 0, stopPrice: 0 }), triggerPrice: 0.010344 };
    expect(orderReferencePrice(legacy as PendingOrder, MARKET))
      .toEqual({ price: 0.010344, kind: 'trigger' });
  });

  it('口径标签', () => {
    expect(orderPriceKindLabel('limit')).toBe('委托价');
    expect(orderPriceKindLabel('trigger')).toBe('触发价');
    expect(orderPriceKindLabel('market')).toBe('现价');
  });
});

describe('面板折算价：必须与挂单侧给出同一个数', () => {
  const panel = (over: Partial<Parameters<typeof panelReferencePrice>[0]>) => panelReferencePrice({
    orderType: 'CONDITIONAL', priceSelection: 'MARKET',
    limitPrice: 0, triggerPrice: 0, marketPrice: MARKET, ...over,
  });

  it('条件委托读触发价——面板与委托列表必须同源，否则同屏两个数', () => {
    const inPanel = panel({ orderType: 'CONDITIONAL', triggerPrice: 0.010344 });
    const onBook = orderReferencePrice(order({ type: 'CONDITIONAL', stopPrice: 0.010344 }), MARKET);
    expect(inPanel).toEqual(onBook);
  });

  it('触发价还没填时退回市价,不是 0——按钮不该在敲第一个字符前就死掉', () => {
    expect(panel({ orderType: 'CONDITIONAL', triggerPrice: 0 })).toEqual({ price: MARKET, kind: 'market' });
  });

  it('条件委托下限价框的残值不得压过触发价——引擎根本不读它', () => {
    // 这条我最初写反了：以为「价优先」是普适的。它不是。
    // 条件单成交在触发价上，order.price 没有任何一个引擎会读；
    // 让限价残值优先，正好会在带幽灵委托价的旧单上读错。
    expect(panel({ orderType: 'CONDITIONAL', priceSelection: 'LIMIT', limitPrice: 0.0102, triggerPrice: 0.010344 }))
      .toEqual({ price: 0.010344, kind: 'trigger' });
  });

  it('非条件类型仍然价优先：限价单读限价框', () => {
    expect(panel({ orderType: 'LIMIT', priceSelection: 'LIMIT', limitPrice: 0.0102, triggerPrice: 0 }))
      .toEqual({ price: 0.0102, kind: 'limit' });
  });

  it('跟踪委托 / TWAP / 分段：面板一律用市价，绝不读那行输入框', () => {
    // 那行在跟踪委托下标的是「激活价」，面板自己都这么写了，不能回头拿它当折算价。
    for (const t of ['TRAILING_STOP', 'TWAP', 'SCALED'] as const) {
      expect(panel({ orderType: t, triggerPrice: 0.0125 })).toEqual({ price: MARKET, kind: 'market' });
    }
  });

  it('市价 + 勾选止盈止损：面板按现价，因为它下出去的就是一张市价单', () => {
    // 勾选不再改写类型，保护价也不再进 stopPrice，所以面板与挂单两侧都读现价。
    expect(panel({ orderType: 'MARKET', triggerPrice: 0.015 })).toEqual({ price: MARKET, kind: 'market' });
    expect(orderReferencePrice(order({ type: 'MARKET', price: 0, stopPrice: 0 }), MARKET))
      .toEqual({ price: MARKET, kind: 'market' });
  });

  /**
   * 【回归】把面板与挂单两侧**并排**验一遍。
   * 只验条件单那一格是不够的：之前 MARKET_TP_SL 一侧写 trigger、另一侧写 market，
   * 两条断言各自为真，整套测试全绿，而屏幕上差着 25%。
   */
  it.each([
    // MARKET_TP_SL 不在配对表里：面板已经不会产生它，只剩历史遗留单，
    // 不存在「同一张单同屏两个数」的场景。
    ['市价 + 止盈止损', { orderType: 'MARKET' as const, priceSelection: 'MARKET' as const, limitPrice: 0, triggerPrice: 0.015 },
      order({ type: 'MARKET', price: 0, stopPrice: 0 })],
    ['条件委托', { orderType: 'CONDITIONAL' as const, priceSelection: 'MARKET' as const, limitPrice: 0, triggerPrice: 0.010344 },
      order({ type: 'CONDITIONAL', price: 0, stopPrice: 0.010344 })],
    ['限价', { orderType: 'LIMIT' as const, priceSelection: 'LIMIT' as const, limitPrice: 0.0100, triggerPrice: 0 },
      order({ type: 'LIMIT', price: 0.0100, stopPrice: 0 })],
    ['限价 + 止盈止损', { orderType: 'LIMIT' as const, priceSelection: 'LIMIT' as const, limitPrice: 0.0100, triggerPrice: 0.015 },
      order({ type: 'LIMIT_TP_SL', price: 0.0100, stopPrice: 0.015 })],
    ['跟踪委托', { orderType: 'TRAILING_STOP' as const, priceSelection: 'MARKET' as const, limitPrice: 0, triggerPrice: 0.0125 },
      order({ type: 'TRAILING_STOP', price: 0, stopPrice: 0.0125 })],
    ['TWAP', { orderType: 'TWAP' as const, priceSelection: 'MARKET' as const, limitPrice: 0, triggerPrice: 0 },
      order({ type: 'TWAP', price: 0, stopPrice: 0 })],
  ])('%s：下单前后是同一个折算价', (_label, panelArgs, placed) => {
    expect(panelReferencePrice({ ...panelArgs, marketPrice: MARKET }))
      .toEqual(orderReferencePrice(placed, MARKET));
  });
});
