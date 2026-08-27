import type { PendingOrder } from '@/types/trading';
import { resolveConditionalTriggerPrice } from '@/lib/conditionalOrders';

/**
 * 一张挂单的**折算价**：把它的 USD 名义折成币数时，该除以哪个价。
 *
 * 币本位一张合约的面值锁死在 USD（BTC 100，其余 10），币数 = 名义 ÷ 价——
 * 所以「这一单是多少个币」这句话，只有指明**按哪个价**才有意义。
 * 此前挂单一律按**下单那一刻的市价**折算：条件单触发价 0.010344、市价 0.011199 时，
 * 面板与委托列表都显示 892.94 NOM，而这单真正成交时给的是 966.744006 NOM——
 * 差 8.27%，且永远不收敛，因为它是拿一个**永不发生的价**算出来的。
 *
 * 折算价只有一个正确定义：**引擎真正会在哪个价成交**。逐型对照四个撮合入口
 * （Index.tsx 的逐 K 线 switch、runConditionalMatchingForSymbol、离线补撮合、
 * useBackgroundPrices 的非当前标的轮询）——四处对同一类型给出的成交价一致：
 *
 *   LIMIT / POST_ONLY        fillPrice = order.price            (Index.tsx:1125,1128)
 *   LIMIT_TP_SL              fillPrice = order.price            (Index.tsx:1152,1155)
 *                            —— stopPrice 只是「武装线」，成交价从来不是它
 *   SCALED                   下单即拆成 N 张 LIMIT 子单，各带自己的 price
 *                            (TradingContext.tsx:1060-1084)；父单从不入库
 *   CONDITIONAL              fillPrice = 触发价                  (Index.tsx:650 → :545)
 *                            —— 含减仓止盈/止损单，它们就是 CONDITIONAL
 *   TRAILING_STOP            fillPrice = 极值 × (1 ∓ 回调率)      (Index.tsx:1191,1204)
 *   TWAP                     每片按当时市价成交                   (Index.tsx:1367)
 *   MARKET_TP_SL             fillPrice = order.stopPrice        (Index.tsx:1090-1103)
 *                            —— 只剩历史遗留单会是这个类型，见下方一节
 *
 * 后三类取不到自有价，退回实时市价并标 'market'。这不是在预测成交价——
 * 标签写着「按现价折算」，它声称的就只是「按此刻的市价，这一单相当于多少币」。
 * 拿激活价去折才是错的：那个数会被读成成交价，而它永远不是
 * （激活价 0.0125 折出 800 NOM，真实成交只可能落在 526–842 之间）。
 *
 * 返回 kind 是为了让调用方**把折算口径写在屏幕上**。同一张单在不同价下是不同的币数，
 * 这本身没有错；错的是不说按哪个价算的——用户已经为此报过四次错。
 *
 * ── 关于 *_TP_SL 两个历史类型 ──
 * 它们**不再由面板产生**：勾选「止盈止损」曾经把类型改写成
 * LIMIT_TP_SL / MARKET_TP_SL、并把止盈价塞进 stopPrice，引擎于是拿止盈价当开仓
 * 触发价；那条已经改掉了（保护价单独随单带，成交时才兑现）。
 * 所以现在只剩**已经持久化的旧单**会是这两个类型，面板永远不会同屏显示一张，
 * 也就不存在「两屏对不上」的问题——按引擎真正的成交价折算即可：
 * LIMIT_TP_SL 成交在 price（走「价优先」那一支），MARKET_TP_SL 成交在 stopPrice。
 *
 * ── 未统一的既有实现（刻意不动）──
 * TradingContext.tsx:1442 与 journalApi.ts:2370 用的是
 * `price → conditionalLimitPrice → stopPrice` 阶梯，且**只把结果落库**
 * （CancelledOrderSnapshot / FilledOrderSnapshot 不带 stopPrice）。
 * 改它们会让**每一场已存战役**的初始风险锚 L 与 b 值被追溯改写
 * （campaignAnalysis.ts:138-194 → :492）。hedgeLines.ts:106 则是 stopPrice 优先。
 * 那三处喂的是风险数学，不是这里的币数显示，边界就划在这里。
 */
export type OrderPriceKind = 'limit' | 'trigger' | 'market';

export interface OrderReferencePrice {
  price: number;
  kind: OrderPriceKind;
}

const positive = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const orderPriceKindLabel = (kind: OrderPriceKind): string =>
  kind === 'limit' ? '委托价' : kind === 'trigger' ? '触发价' : '现价';

/**
 * 挂单的折算价。**永不返回 0 或 NaN**：取不到自有价时退回市价并标 'market'。
 *
 * 返回 null 本来更「诚实」，但会把张数一起带走——委托列表里张数写在币数那一支里，
 * 币数为 null 就整支不渲染，用户反而少看到信息。标注口径比抹掉数字好。
 */
export function orderReferencePrice(
  order: Pick<PendingOrder, 'type' | 'price' | 'stopPrice'> & Partial<PendingOrder>,
  marketPrice: number,
): OrderReferencePrice {
  const market = (): OrderReferencePrice => ({ price: positive(marketPrice), kind: 'market' });

  if (order.type === 'CONDITIONAL') {
    /**
     * 条件单**必须先查触发价，而且永远不落到 'limit'**——不能走「价优先」。
     * 引擎从头到尾只读触发价，没有任何一处读 order.price
     * （createTriggeredConditionalPosition，Index.tsx:533-546）。
     * 而 ordersMap 是持久化并同步到云端的：本次之前挂出的条件单，可能带着一个
     * **幽灵委托价**（切到条件委托标签前在限价框填过的残值，已在源头掐掉，
     * 但旧单里还留着）。价优先会把 0.0113 读成委托价，给出 884.96 NOM 并标
     * 「按委托价折算」——恰好在这个修复本来要救的那批旧单上读错。
     */
    const trigger = positive(resolveConditionalTriggerPrice(order as PendingOrder))
      // resolveConditionalTriggerPrice 用的是 `triggerPrice ?? stopPrice`，
      // `??` 不对 0 兜底：老数据里一个 triggerPrice: 0 会把有效的 stopPrice 遮掉。
      || positive(order.stopPrice);
    return trigger > 0 ? { price: trigger, kind: 'trigger' } : market();
  }

  // 价优先。既有实现里 hedgeLines.ts:106 反着排（stopPrice 优先），
  // 那对 LIMIT_TP_SL 是错的：它成交在 price，stopPrice 只是武装线。
  const limit = positive(order.price);
  if (limit > 0) return { price: limit, kind: 'limit' };

  // 历史遗留的 MARKET_TP_SL：引擎确实成交在 stopPrice 上（Index.tsx:1090-1103）。
  // 面板已经不会再产生这个类型，所以不存在「面板与列表对不上」的顾虑了。
  if (order.type === 'MARKET_TP_SL') {
    const trigger = positive(order.stopPrice);
    if (trigger > 0) return { price: trigger, kind: 'trigger' };
  }
  return market();
}

/**
 * 下单面板的折算价——与上面同一套规则，但读的是面板里**还没成单**的输入。
 *
 * 必须与 orderReferencePrice 给出同一个数，否则「输入框 / 提示 / 当前委托显示同一个数」
 * 这条不变量当场破掉，而那正是用户反复报的那件事。
 *
 * 面板这一侧只认 CONDITIONAL 的触发价，与挂单侧严格对齐：
 * 跟踪委托那行是**激活价**不是成交价；MARKET_TP_SL 的止盈价面板此刻还看不见。
 */
export function panelReferencePrice(args: {
  orderType: PendingOrder['type'];
  priceSelection: 'MARKET' | 'LIMIT' | 'BEST';
  limitPrice: number;
  triggerPrice: number;
  marketPrice: number;
}): OrderReferencePrice {
  const { orderType, priceSelection, limitPrice, triggerPrice, marketPrice } = args;
  if (orderType === 'CONDITIONAL') {
    const trigger = positive(triggerPrice);
    return trigger > 0 ? { price: trigger, kind: 'trigger' } : { price: positive(marketPrice), kind: 'market' };
  }
  if (priceSelection === 'LIMIT') {
    const limit = positive(limitPrice);
    if (limit > 0) return { price: limit, kind: 'limit' };
  }
  return { price: positive(marketPrice), kind: 'market' };
}
