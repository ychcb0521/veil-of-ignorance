/**
 * 币安「当前杠杆倍数最高可持有头寸」（-2027 Exceeded the maximum allowable position at current leverage）。
 *
 * 下单面板、杠杆对话框、引擎下单、条件单触发**只读这一个判定**，所以它们不可能给出两个答案。
 *
 * 口径（币安 FAQ 与网页文案，分层数据见 leverageTiers）：
 *   · 判的是**下单之后**的敞口：该合约的持仓 + 当前委托 + 这一单，不是这一单自己
 *     （网页文案「持仓和当前委托价值超过」）。
 *   · 双向持仓下多空按绝对值相加，共用一个上限。
 *   · 敞口 = |多仓| + |空仓|（按标记价）+ 非只减仓挂单（按各自的委托价 / 触发价 / 激活价；
 *     TWAP 只算还没成交的部分），与 planLeverageChange 的定义相同，
 *     逐笔换成档位单位：U 本位 USDT；真币本位按各自的估值价折成币（持仓按标记价）；合成币本位直接用 USD 面值。
 *   · 同一个应用标的下，U 本位与币本位是两张合约（RUNEUSDT 与 RUNEUSD），各算各的敞口、各用各的分层。
 *   · 通过条件：结果敞口所在档位的最高杠杆 ≥ 当前杠杆，并且不超过最高一档的上限。
 *     杠杆 L 下最多能持有的头寸 = 最后一个最高杠杆 ≥ L 的档位的上限（maxPositionAtLeverage）。
 *
 * 与币安刻意不同的一处：只减仓 / 平仓单**永远放行**。币安在挂单把总量顶过上限时也会拒绝平仓
 * （「如需平仓，请先撤销当前委托」），但训练器里拦住平仓只会把人困在仓位里，不安全。
 *
 * 现有敞口**自己**就已超过上限（行情把持仓的价值推过了线、或更新前按旧规则开的仓）时，
 * 再小的单也开不出去，而逐仓有持仓又不能降杠杆——拒绝理由单列一种（exposure-over-cap），
 * 照实说出路：能降杠杆就说降，降不了就只说减仓 / 撤单。
 *
 * 第二处刻意的不同：更新前按旧规则开的仓位（没有任何 riskModel，见 positionRiskModel.isPreUpdateRisk）可能已经超过它的新上限。
 * 对冲它的反向开仓单不受上限约束，只要反向的总量（已有持仓与挂单 + 这一单）不超过这些旧仓位的大小（legacy-hedge）——
 * 否则升级会让现有仓位连对冲都挂不出去；往旧仓位那一侧加仓照常受上限约束。
 *   · 额度（按方向）= 反方向上**更新前仓位冻结的底** − 这一侧已有的全部敞口（持仓与挂单，含已经靠豁免开出 / 挂出的对冲）。
 *     豁免的底只有更新前的仓位：靠豁免开出的仓位带着显式的 'legacy-hedge-v1' 标记，不是底，只占额度——
 *     否则它会反过来给旧仓位那一侧当底，旧仓位减掉之后又能加回去，旧仓位平掉之后还能开出新的超限仓位，一轮轮接下去。
 *     **底是「多少」，不是「是不是」**（positionRiskModel.hedgeExemptBaseUnits，规则四）：分层加仓会并进更新前的仓位
 *     （规则二），仓位因此变大，但底冻在加仓之前——只有更新前挂出的旧委托成交并进来才把底做大，部分平仓按比例缩。
 *     不冻的话一笔分层加仓就把额度顶大一截，反向再开一笔同样大的超限裸仓位，一轮轮接下去。
 *   · 比的是仓位大小：旧仓位、这一单、这一侧的持仓与挂单**一律按标记价**折成档位单位
 *     （U 本位 = 币数 × 标记价，真币本位 = 张数 × 面值 ÷ 标记价，合成币本位 = USD 面值）。
 *     按各自的委托价比，一张远离现价的限价单就能比它要对冲的旧仓位大出一截，多出来的是没过分层的新方向敞口。
 *   · 只靠这条豁免放行的单盖 'legacy-hedge-v1'（placementUsesLegacyHedge）：按旧模型开仓（它的名义可能远超
 *     当前杠杆在分层里允许的大小，套上分层维持保证金会高过它自己的保证金，一成交就被强平）。
 *     挂着的豁免单在触发 / 成交那一刻**再判一次**：豁免仍成立（旧仓位还在、额度没被别的对冲占掉）才按旧模型开；
 *     不成立就按普通的分层判，过得去就开分层仓位，过不去就撤单留痕——旧仓位先平掉之后，
 *     那张对冲单不会再开出一个远超上限的裸仓位。
 *
 * 估值：持仓按标记价；挂单与这一单按各自的估值价（orderValuationPrice：委托价 / 触发价 / 激活价，
 * 市价与 TWAP 按标记价）。真币本位（以币计）也是逐笔按这个价把 USD 名义折成币——一张低于现价的买入限价单
 * 成交时就是按它的委托价折的币，按标记价折会少算，成交后仓位就超了。
 * 例外：**会立即成交的限价单**（买价 ≥ 现价、卖价 ≤ 现价，下一根 K 线就成交）按现价估值——成交之后它就是按标记价估值的持仓。
 *
 * 「价格走到 P 那一刻」的敞口（ExposureOptions.pathFrom / pathVia；触发单的再判、预警、计算器、限价单的第二道都用它）：
 *   · 价格从现价 M 出发、（可能先到过另一侧的某个价 w，）最后到 P：走过的区间 = [min(M, w, P), max(M, w, P)]；
 *   · 持仓按 P 估值；
 *   · 走过的区间里会成交 / 触发的开仓挂单算作已成交的持仓，按 P 估值：
 *       限价单——买单委托价 ≥ 区间下沿、卖单委托价 ≤ 区间上沿（含已经穿价、下一根就成交的）；
 *       条件单（与旧的市价止盈止损开仓单）——触发价落在区间里（它触发时自己还要再判；按「开出来了」算，宁严勿松）；
 *   · 其余挂单按各自的估值价（跟踪委托按激活价：单边走过去只会激活、不会成交）；
 *   · 这一单按 P 估值。
 *   M = P（真正触发 / 成交的那一刻）时，就是「已经穿价的限价单按现价」这一条。
 *
 * 触发 / 成交那一刻的几种走法（restingTriggerScenarios，委托列表的标记、下单与改杠杆的预警、加仓计算器共用）：
 *   直接从 M 走到 P；或者先到 M 另一侧某张开仓挂单的价 w（它先成交 / 触发）、再折回 P。
 *   突破加仓在上、止损对冲在下，两张单谁先到都有可能——两种先后都要放得下。同一侧的单子先后由价格决定，直接走就包含了。
 *
 * 持仓限制模式（lib/positionLimitMode）：上面写的全部是「币安标准」模式的规则。使用者选「无限制」（默认）时，
 * 每个入口都带着 mode = 'unlimited' 进来：任何币种 1–150x、不设上限（checkPositionLimit 直接放行，理由 'unlimited'），
 * 触发 / 成交那一刻不再判、也不预警（recheckPrice 为 null）。缺省 mode 按币安标准，库与已有测试的口径不变。
 * 切到币安标准之后，无限制模式下开的仓位（'unlimited-v1'）与更新前的仓位一样是对冲豁免的底（isHedgeBaseRisk），
 * 文案按底的来源说「更新前的仓位」还是「无限制模式下开的仓位」（hedgeBaseNoun）。
 *
 * 这个模块是纯函数，不碰 React、不弹提示。
 */
import type { OrderSide, PendingOrder, Position, SettlementMode } from '@/types/trading';
import { getPositionNotionalUsd, getPositionUnits, isCoinSettled, isPositionOpen } from '@/lib/tradingSettlement';
import { formatPrice } from '@/lib/formatters';
import { orderReferencePrice } from '@/lib/orderReferencePrice';
import { resolveConditionalTriggerPrice } from '@/lib/conditionalOrders';
import {
  LEGACY_HEDGE_RISK_MODEL,
  TIERED_RISK_MODEL,
  hasRiskProvenance,
  hedgeBaseKindOf,
  hedgeExemptBaseUnits,
  isHedgeBaseRisk,
  isLegacyHedgeRisk,
  isPreUpdateRisk,
  type HedgeBaseKind,
} from '@/lib/positionRiskModel';
import {
  UNLIMITED_MAX_LEVERAGE,
  isUnlimitedLimitMode,
  symbolMaxLeverageFor,
  type PositionLimitMode,
} from '@/lib/positionLimitMode';
import {
  clampLeverageToTiers,
  exceedsTopCap,
  formatTierAmount,
  maxLeverageForNotional,
  maxPositionAtLeverage,
  resolveSymbolTiers,
  tierAmountFromUsdNotional,
  usdNotionalFromTierAmount,
  type ResolvedSymbolTiers,
} from '@/lib/leverageTiers';

export type LimitSettlement = 'usdt' | 'coin';

export function limitSettlementOf(item?: { settlementMode?: SettlementMode | null } | null): LimitSettlement {
  return isCoinSettled(item) ? 'coin' : 'usdt';
}

/** 杠杆夹到这个合约（这种结算方式）允许的 [1, 最高杠杆]；无限制模式下一律 [1, 150]。mode 缺省按币安标准。 */
export function clampSymbolLeverage(
  symbol: string,
  settlement: LimitSettlement,
  leverage: number,
  mode?: PositionLimitMode | null,
): number {
  return clampLeverageToTiers({ maxLeverage: symbolMaxLeverageFor(symbol, settlement, mode) }, leverage);
}

/** 没设置过杠杆的标的的起手杠杆（读出来时再夹到合约的最高杠杆）。 */
export const DEFAULT_SYMBOL_LEVERAGE = 35;

/**
 * 按标的存的那一个杠杆，在某种结算方式下实际生效的值：没存过取 35x，再夹到这张合约的最高杠杆
 * （无限制模式下夹到 150x）。TradingContext.getSymbolLeverage 与加仓计算器（按被加仓仓位的结算方式）读的都是它。
 */
export function effectiveSymbolLeverage(
  stored: number | null | undefined,
  symbol: string,
  settlement: LimitSettlement,
  mode?: PositionLimitMode | null,
): number {
  const raw = stored == null ? NaN : Number(stored);
  return clampSymbolLeverage(symbol, settlement, Number.isFinite(raw) ? raw : DEFAULT_SYMBOL_LEVERAGE, mode);
}

/** 同一个币的 U 本位与币本位里较高的那个最高杠杆（两张合约的上限可能不同：BNB 75x / 20x）；无限制模式下 150x。 */
export function maxLeverageAcrossSettlements(symbol: string, mode?: PositionLimitMode | null): number {
  if (isUnlimitedLimitMode(mode)) return UNLIMITED_MAX_LEVERAGE;
  return Math.max(resolveSymbolTiers(symbol, 'usdt').maxLeverage, resolveSymbolTiers(symbol, 'coin').maxLeverage);
}

/**
 * 杠杆按标的只存一份：不看结算方式的写入（偏好里的默认杠杆）夹到两张合约里较高的那个上限，
 * 读的时候再按各自的结算方式夹（effectiveSymbolLeverage）——两张合约各得 min(偏好, 自己的上限)。
 */
export function clampLeverageAcrossSettlements(symbol: string, leverage: number, mode?: PositionLimitMode | null): number {
  return clampLeverageToTiers({ maxLeverage: maxLeverageAcrossSettlements(symbol, mode) }, leverage);
}

/**
 * 从币安标准切到无限制（含从没选过、按默认进了无限制的老用户第一次打开）时，哪些标的的杠杆要**钉住**、钉在几倍。
 *
 * 为什么要钉：币安标准下读出来的杠杆是夹过的（没存过的默认 35x 夹到 LUMIAUSDT 的 10x、旧滑块存下的 125x 夹到
 * KAITOUSDT 的 75x），仓位就是按夹过的值开的；无限制模式下夹到 150x，同一个保存值一下子读成 35x / 125x。
 * 保存值不动的话，这些标的的下一笔加仓按新杠杆成交、与现有仓位杠杆不同（合并键含杠杆）就另开一张卡，
 * 自己那点保证金扛着、强平价贴得更近，下单面板与持仓卡上的杠杆也对不上——而切换本身不该改变任何现有仓位怎么被加仓。
 *
 * 规则（只看有持仓或有开仓挂单的标的；什么都没有的标的读成多少都不会分叉，不钉）：
 *   · 切换前后读出来的杠杆一样 → 不钉（币安的夹值没在起作用）；
 *   · 否则钉在「现有仓位共同的杠杆」（没有持仓时看开仓挂单）：仓位都按 10x 开 → 钉 10x；
 *     更新前按 35x 开的旧仓位（币安标准下被夹成 10x、加仓本来就另开）→ 无限制下读成 35x 正好对上，不用钉；
 *   · 仓位 / 挂单杠杆不一（本来就分叉）→ 钉在切换前读出来的值：切换不改变任何东西。
 * 钉 = 把按标的存的杠杆写成这个值（写之前与写之后在无限制模式下读出来都 ≤ 150x）。反方向（切到币安标准）不钉：
 * 超过合约上限的保存值照样按上限生效并提示一次，切回无限制又按原值生效（leverageClampNotice）。
 */
export function leveragePinsForUnlimited(args: {
  leverageMap: Readonly<Record<string, number | null | undefined>>;
  positionsMap: Readonly<Record<string, readonly Position[] | undefined>>;
  ordersMap: Readonly<Record<string, readonly PendingOrder[] | undefined>>;
  /** 这个标的下单面板此刻的结算方式（TradingContext.getSymbolLeverage 按它夹）。 */
  settlementOf: (symbol: string) => LimitSettlement;
}): Record<string, number> {
  const pins: Record<string, number> = {};
  const symbols = new Set([...Object.keys(args.positionsMap), ...Object.keys(args.ordersMap)]);
  const common = (levs: number[]): number | null => {
    const set = new Set(levs);
    if (set.size !== 1) return null;
    const [only] = [...set];
    return Number.isInteger(only) && only >= 1 && only <= UNLIMITED_MAX_LEVERAGE ? only : null;
  };
  for (const symbol of symbols) {
    const held = (args.positionsMap[symbol] ?? []).filter(p => p && isPositionOpen(p));
    const opening = (args.ordersMap[symbol] ?? []).filter(o => o && !o.reduceOnly);
    if (held.length === 0 && opening.length === 0) continue;
    const settlement = args.settlementOf(symbol);
    const stored = args.leverageMap[symbol];
    const before = effectiveSymbolLeverage(stored, symbol, settlement, 'binance');
    const after = effectiveSymbolLeverage(stored, symbol, settlement, 'unlimited');
    if (before === after) continue;
    const levs = (held.length > 0 ? held : opening).map(x => Math.max(1, Number(x.leverage) || 1));
    const target = common(levs) ?? before;
    if (target !== after) pins[symbol] = target;
  }
  return pins;
}

/**
 * 触发之后才真正下单的开仓类型。币安在触发那一刻才把单子送进撮合，
 * 分层上限要按那一刻的敞口再判一次；挂在盘口的限价单成交时不再判。
 */
const TRIGGERED_ORDER_TYPES = new Set<string>(['CONDITIONAL', 'TRAILING_STOP', 'MARKET_TP_SL', 'LIMIT_TP_SL']);

export function isTriggeredOpenOrder(order: Pick<PendingOrder, 'type' | 'reduceOnly'>): boolean {
  return !order.reduceOnly && TRIGGERED_ORDER_TYPES.has(order.type);
}

/**
 * 触发类开仓单在触发那一刻会按哪个价被再判一次——下单时就按这个价预判一道
 * （checkPlacementPositionLimit），免得一张下单时放行的单子一触发就注定被撤。
 *   条件单 / 旧止盈止损开仓单 → 引擎的成交价（orderReferencePrice：条件单 = 触发价，
 *                                LIMIT_TP_SL = 委托价，MARKET_TP_SL = stopPrice）
 *   跟踪委托 → 激活价（真正的成交价是「极值 ×(1∓回调率)」，下单时不可知，激活价是价格必须先够到的一档）
 *   其余、只减仓单、价取不到 → 0（不判这一道）
 */
export function triggeredCheckPrice(
  order: Pick<PendingOrder, 'type' | 'price' | 'stopPrice'> & Partial<Pick<PendingOrder, 'reduceOnly'>>,
): number {
  if (!isTriggeredOpenOrder(order)) return 0;
  if (order.type === 'TRAILING_STOP') {
    const activation = Number(order.stopPrice);
    return Number.isFinite(activation) && activation > 0 ? activation : 0;
  }
  const ref = orderReferencePrice(order, 0);
  return ref.kind === 'market' ? 0 : ref.price;
}

/** 挂在盘口、按委托价成交的限价类开仓单（分段订单的子单也是 LIMIT）。 */
const RESTING_LIMIT_TYPES = new Set<string>(['LIMIT', 'POST_ONLY']);

export function isRestingLimitOrder(order: Pick<PendingOrder, 'type'> & Partial<Pick<PendingOrder, 'reduceOnly'>>): boolean {
  return !order.reduceOnly && RESTING_LIMIT_TYPES.has(order.type);
}

/**
 * 限价单是不是会立即成交（已经穿价）：买价 ≥ 现价、卖价 ≤ 现价。引擎在下一根 K 线上就按委托价成交，
 * 成交之后它是按标记价估值的持仓，所以分层判定按现价给它估值。
 */
export function isMarketableLimitPrice(side: OrderSide, limitPrice: number, markPrice: number): boolean {
  if (!(limitPrice > 0) || !(markPrice > 0)) return false;
  return side === 'LONG' ? limitPrice >= markPrice : limitPrice <= markPrice;
}

/** 价格走过的区间：从 from 出发，先到过 via 里的价，最后到 to。价取不到时为 null。 */
export interface PricePath {
  lo: number;
  hi: number;
}

export function pricePath(from: number, to: number, via: readonly number[] = []): PricePath | null {
  if (!(from > 0) || !(to > 0)) return null;
  const points = [from, to, ...via.filter(v => Number(v) > 0).map(Number)];
  return { lo: Math.min(...points), hi: Math.max(...points) };
}

/**
 * 价格从 from（先到过 via）走到 to 的路上，这张限价单会不会成交（引擎：买单最低价 ≤ 委托价、卖单最高价 ≥ 委托价）：
 *   买单：委托价 ≥ 走过的最低价；卖单：委托价 ≤ 走过的最高价。from = to、没有 via 时就是「已经穿价」。
 */
export function limitFillsOnPath(
  order: Pick<PendingOrder, 'type' | 'side' | 'price'> & Partial<Pick<PendingOrder, 'reduceOnly'>>,
  from: number,
  to: number,
  via: readonly number[] = [],
): boolean {
  if (!isRestingLimitOrder(order)) return false;
  const k = Number(order.price);
  const path = pricePath(from, to, via);
  if (!(k > 0) || !path) return false;
  return order.side === 'LONG' ? k >= path.lo : k <= path.hi;
}

type PathOrder = Pick<PendingOrder, 'type' | 'side' | 'price' | 'stopPrice'> & Partial<PendingOrder>;

/** 条件单 / 旧的市价止盈止损开仓单的触发价（引擎读的那个）；别的类型为 0。 */
function openTriggerPriceOf(order: PathOrder): number {
  if (order.type === 'CONDITIONAL') {
    const t = Number(resolveConditionalTriggerPrice(order as PendingOrder));
    if (Number.isFinite(t) && t > 0) return t;
    const stop = Number(order.stopPrice);
    return Number.isFinite(stop) && stop > 0 ? stop : 0;
  }
  if (order.type === 'MARKET_TP_SL') {
    const stop = Number(order.stopPrice);
    return Number.isFinite(stop) && stop > 0 ? stop : 0;
  }
  return 0;
}

/**
 * 价格从 from（先到过 via）走到 to 的路上，这张开仓触发单会不会已经触发（见文件头）：
 *   条件单 / 旧市价止盈止损开仓单：触发价落在走过的区间里（挂着没触发，说明现价还在它挂出时的那一侧，走到触发价就触发）；
 *   旧限价止盈止损开仓单：触发价在区间里，并且委托价按限价单的规则也够得着；
 *   跟踪委托、TWAP、只减仓单：不算（跟踪委托单边走过去只会激活、不会成交）。
 */
export function triggerFiresOnPath(order: PathOrder, from: number, to: number, via: readonly number[] = []): boolean {
  if (order.reduceOnly) return false;
  const path = pricePath(from, to, via);
  if (!path) return false;
  const inPath = (t: number) => t > 0 && t >= path.lo && t <= path.hi;
  if (order.type === 'LIMIT_TP_SL') {
    const k = Number(order.price);
    return inPath(Number(order.stopPrice)) && k > 0 && (order.side === 'LONG' ? k >= path.lo : k <= path.hi);
  }
  return inPath(openTriggerPriceOf(order));
}

/** 走过这段路之后，这张开仓挂单已经成交 / 触发（限价单或触发单）。 */
export function orderFillsOnPath(order: PathOrder, from: number, to: number, via: readonly number[] = []): boolean {
  return limitFillsOnPath(order, from, to, via) || triggerFiresOnPath(order, from, to, via);
}

/**
 * 一张开仓挂单「价格一碰到就成交 / 触发」的那个价（给「先到另一侧再折回来」的走法当路标）：
 * 限价单 = 委托价，条件单 / 旧市价止盈止损开仓单 = 触发价；其余（跟踪委托、TWAP、只减仓单）没有，为 0。
 */
export function orderWaypointPrice(order: PathOrder | null | undefined): number {
  if (!order || order.reduceOnly) return 0;
  if (RESTING_LIMIT_TYPES.has(order.type)) {
    const k = Number(order.price);
    return Number.isFinite(k) && k > 0 ? k : 0;
  }
  return openTriggerPriceOf(order);
}

/**
 * TWAP 的一片在执行时交给 settleFillDebit 的分层判定参数（与触发类同一道闸）：
 * 按这一片（fill）估值、按现价给持仓估值，并把这张 TWAP 自己还没成交的余量排除——
 * 余量不是挂在盘口的委托，判的是「持仓 + 其余委托 + 这一片」。
 *
 * earlier：同一轮里排在它前面、已经处理过的 TWAP。它们刚成交的那一片已经并进持仓（持仓的写入是同步的），
 * 挂单列表却要等这一轮的 updater 返回才写回——不把它们的新版本（twapFilledQty 已加上这一片）交进去，
 * 那一片就会按持仓与挂单各算一遍；这一轮被停掉 / 走完的 TWAP 同理整张排除。
 */
export function twapSliceTrigger(
  order: Pick<PendingOrder, 'id'>,
  slice: PendingOrder,
  price: number,
  earlier: { updated?: readonly PendingOrder[]; removedIds?: readonly string[] } = {},
): {
  price: number;
  settledOrderIds: string[];
  fill: PendingOrder;
  orderOverrides: PendingOrder[];
} {
  return {
    price,
    settledOrderIds: [order.id, ...(earlier.removedIds ?? [])],
    fill: slice,
    orderOverrides: [...(earlier.updated ?? [])],
  };
}

// ─────────────────────────── 敞口 ───────────────────────────

/** 挂单里还会开出去的那部分：TWAP 扣掉已成交的切片（切片早已并进持仓），其余原样。 */
function unfilledOrderPart(order: PendingOrder): PendingOrder | null {
  if (order.type !== 'TWAP') return order;
  const total = Number(order.twapTotalQty ?? order.quantity) || 0;
  const filled = Number(order.twapFilledQty ?? 0) || 0;
  const rest = Math.max(0, total - filled);
  if (!(rest > 0)) return null;
  return { ...order, quantity: rest, contracts: isCoinSettled(order) ? rest : order.contracts };
}

/**
 * 一张挂单在分层判定里按哪个价估值——U 本位的名义 = 数量 × 这个价，真币本位的币数 = 张数 × 面值 ÷ 这个价：
 *   跟踪委托 → 激活价（真正的成交价下单时不可知，激活价是价格必须先够到的一档；没有激活价按标记价）
 *   其余     → 引擎的成交参照价 orderReferencePrice：限价 / 只做 Maker / LIMIT_TP_SL = 委托价，
 *              条件单 = 触发价（不读残留的委托价），MARKET_TP_SL = stopPrice，TWAP = 标记价
 * 标记价也取不到时返回 0（调用方跳过这张单）。
 */
export function orderValuationPrice(
  order: Pick<PendingOrder, 'type' | 'price' | 'stopPrice'> & Partial<PendingOrder>,
  markPrice: number,
): number {
  if (order.type === 'TRAILING_STOP') {
    const activation = Number(order.stopPrice);
    if (Number.isFinite(activation) && activation > 0) return activation;
    return markPrice > 0 ? markPrice : 0;
  }
  return orderReferencePrice(order, markPrice).price;
}

export interface ExposureOptions {
  /** 只算这一种结算方式的持仓与挂单。缺省全算（planLeverageChange 的旧口径）。 */
  settlement?: LimitSettlement;
  /** 不算这些挂单——条件单触发时，它自己（以及同一批刚成交、还没从列表里移走的单）正在变成持仓。 */
  excludeOrderIds?: readonly string[];
  /** 同一批里刚改过、挂单列表还没写回的委托（刚成交了一片的 TWAP）：按这里的版本算。 */
  orderOverrides?: readonly PendingOrder[];
  /**
   * 价格从哪里走到 markPrice（见文件头「价格走到 P 那一刻」）：路上会成交的限价单、会触发的条件单按 markPrice 估值、算作持仓。
   * 缺省 = markPrice，即只有已经穿价的限价单（与触发价恰好在这个价上的条件单）算作持仓。
   */
  pathFrom?: number;
  /** 到 markPrice 之前先到过的价（「先到另一侧再折回来」的走法）；缺省没有。 */
  pathVia?: readonly number[];
}

interface ExposureItem {
  side: OrderSide;
  /** USD 名义（getPositionNotionalUsd 的口径）。 */
  usd: number;
  /** 估值价：持仓 = 标记价（取不到按开仓价），挂单 = orderValuationPrice。 */
  price: number;
  /**
   * 这一笔里算作**对冲豁免的底**的那部分名义（按标记价，与 usdAtMark 同口径）；不是底的一律 0。
   *
   * 不是布尔值：分层加仓可以并进更新前的仓位（positionRiskModel 规则二），并进去之后仓位变大了、
   * 底却必须冻在合并之前（规则四，hedgeExemptBaseUnits）——所以这里记的是「多少」，不是「是不是」。
   */
  legacyUsdAtMark: number;
  /** 这一笔是底时，底是哪一种（更新前的 / 无限制模式开的）；不是底为 null。只用于文案。 */
  legacyKind: HedgeBaseKind | null;
  /** 按标记价估的 USD 名义与价（对冲豁免比大小用）；标记价取不到时同 usd / price。 */
  usdAtMark: number;
  priceAtMark: number;
}

function exposureItems(
  symbol: string,
  positions: readonly Position[] | null | undefined,
  orders: readonly PendingOrder[] | null | undefined,
  markPrice: number,
  options: ExposureOptions,
): ExposureItem[] {
  const wanted = (item: { settlementMode?: SettlementMode | null }) =>
    !options.settlement || limitSettlementOf(item) === options.settlement;
  const excluded = new Set(options.excludeOrderIds ?? []);
  const overrides = new Map((options.orderOverrides ?? []).map(o => [o.id, o] as const));
  const from = Number(options.pathFrom) > 0 ? Number(options.pathFrom) : markPrice;
  const items: ExposureItem[] = [];
  for (const p of positions ?? []) {
    if (!p || !isPositionOpen(p) || !wanted(p)) continue;
    const price = markPrice > 0 ? markPrice : (Number(p.entryPrice) || 0);
    const usd = Math.abs(getPositionNotionalUsd(symbol, p, price));
    // 名义与计量单位数成正比（U 本位 = 币数 × 价，币本位 = 张数 × 面值），所以按单位数的占比折名义是精确的。
    const units = getPositionUnits(p);
    const baseUnits = hedgeExemptBaseUnits(p, units);
    items.push({
      side: p.side,
      usd,
      price,
      legacyUsdAtMark: units > 0 ? (usd * baseUnits) / units : 0,
      legacyKind: baseUnits > 0 ? hedgeBaseKindOf(p) : null,
      usdAtMark: usd,
      priceAtMark: price,
    });
  }
  for (const listed of orders ?? []) {
    const o = listed ? (overrides.get(listed.id) ?? listed) : listed;
    if (!o || o.reduceOnly || excluded.has(o.id) || !wanted(o)) continue;
    const part = unfilledOrderPart(o);
    if (!part) continue;
    if (orderFillsOnPath(o, from, markPrice, options.pathVia)) {
      // 走到这个价之前就会成交 / 触发：已经是持仓，按这个价估值；来源与它开出的仓位相同
      const usd = Math.abs(getPositionNotionalUsd(symbol, part as unknown as Position, markPrice));
      items.push({
        side: o.side,
        usd,
        price: markPrice,
        // 更新前挂出的旧委托：成交后开出（或并进）更新前的仓位，整笔都是底。
        legacyUsdAtMark: isPreUpdateRisk(o) ? usd : 0,
        legacyKind: isPreUpdateRisk(o) ? 'pre-update' : null,
        usdAtMark: usd,
        priceAtMark: markPrice,
      });
      continue;
    }
    const price = orderValuationPrice(o, markPrice);
    if (!(price > 0)) continue;
    const priceAtMark = markPrice > 0 ? markPrice : price;
    items.push({
      side: o.side,
      usd: Math.abs(getPositionNotionalUsd(symbol, part as unknown as Position, price)),
      price,
      legacyUsdAtMark: 0,
      legacyKind: null,
      usdAtMark: Math.abs(getPositionNotionalUsd(symbol, part as unknown as Position, priceAtMark)),
      priceAtMark,
    });
  }
  return items;
}

/**
 * 该标的的总敞口（USD 名义）：持仓按标记价（取不到时按开仓价）+ 非只减仓挂单按各自的估值价
 * （orderValuationPrice；已经穿价的限价单按标记价）。多空都取绝对值相加。
 */
export function symbolExposureUsd(
  symbol: string,
  positions: readonly Position[] | null | undefined,
  orders: readonly PendingOrder[] | null | undefined,
  markPrice: number,
  options: ExposureOptions = {},
): number {
  return exposureItems(symbol, positions, orders, markPrice, options).reduce((sum, item) => sum + item.usd, 0);
}

// ─────────────────────────── 判定 ───────────────────────────

export type PositionLimitReason =
  | 'ok'
  | 'reduce-only'
  | 'no-price'
  | 'leverage-above-max'
  /** 这一单把总量顶过了当前杠杆的上限。 */
  | 'exceeds-cap'
  /** 这一单把总量顶过了最高一档的上限。 */
  | 'exceeds-top-cap'
  /** 下单之前的敞口自己就已超过上限：这一单再小也过不去。 */
  | 'exposure-over-cap'
  /** 按上限本该拒绝，但这一单是在对冲更新前按旧规则开的仓位，反向总量不超过它们的名义：放行（见文件头）。 */
  | 'legacy-hedge'
  /** 持仓限制模式是「无限制」：不设上限，放行（杠杆超出 1–150x 时仍拒绝，理由 leverage-above-max）。 */
  | 'unlimited';

export interface PositionLimitInput {
  symbol: string;
  settlement: LimitSettlement;
  leverage: number;
  /** 下单之前的敞口（档位单位）。 */
  exposureBefore: number;
  /** 这一单的名义（档位单位）；改杠杆时为 0。 */
  orderNotional: number;
  reduceOnly?: boolean;
  /**
   * 杠杆下限：逐仓有持仓时不能降到它以下（leverageFloorOf）。只用来选拒绝理由里的出路；缺省 1。
   */
  leverageFloor?: number;
  /** 敞口里有没有更新前按旧规则开的仓位（或无限制模式下开的仓位；只用于拒绝理由里的说明）。 */
  legacyExposure?: boolean;
  /** 敞口里对冲豁免的底都是哪几种（文案据此说「更新前的仓位」还是「无限制模式下开的仓位」）；缺省按更新前。 */
  legacyKinds?: readonly HedgeBaseKind[];
  /** 持仓限制模式（lib/positionLimitMode）；缺省按币安标准。 */
  mode?: PositionLimitMode | null;
  /** 这一单的方向；改杠杆时没有。 */
  side?: OrderSide | null;
  /** 这一单的估值价（真币本位按它折币）；只记录下来给「可开」折回 USD 用。 */
  orderPrice?: number;
  /**
   * 更新前仓位的对冲豁免（档位单位，checkOrderPositionLimit 按方向算好；**全部按标记价估值**，比的是仓位大小）：
   *   base        反方向上更新前仓位**冻结的底**合计（这一单要对冲的旧仓位；豁免仓位不算，
 *               并进旧仓位的分层加仓也不算，见 positionRiskModel.hedgeExemptBaseUnits）
   *   room        base − 这一单这一侧已有的敞口（持仓 + 挂单，含已占额度的豁免对冲）：这一单不超过它就放行
   *   reverseRoom 反过来：这一侧的旧仓位留给反方向对冲的余量（只用于拒绝文案里指路）
   *   order       这一单按标记价估的大小；缺省取 orderNotional
   *   markPrice   估值用的标记价（「可开」把额度折回这一单的 USD 名义）
   */
  legacyHedge?: { base: number; room: number; reverseRoom: number; order?: number; markPrice?: number } | null;
}

export interface PositionLimitResult {
  ok: boolean;
  reason: PositionLimitReason;
  leverage: number;
  /** 当前杠杆下最多能持有的头寸（档位单位）；杠杆超过这个合约的最高杠杆时为 0。 */
  cap: number;
  /** 档位单位：'USDT'、币名（如 'BTC'）或 'USD'（合成币本位）。 */
  unit: string;
  /** 下单之后的敞口所在档位允许的最高杠杆；超过最高一档上限为 0。 */
  maxLeverageForResult: number;
  /** 下单之前的敞口所在档位允许的最高杠杆（现有敞口能降到几倍放得下）；超过最高一档上限为 0。 */
  maxLeverageForExposure: number;
  /** 杠杆下限（见 PositionLimitInput.leverageFloor）。 */
  leverageFloor: number;
  legacyExposure: boolean;
  exposureBefore: number;
  exposureAfter: number;
  /** 还能再开多少（档位单位）= max(0, cap − exposureBefore)；算不出时为 NaN。 */
  remaining: number;
  /** 这个合约的最高杠杆（第 1 档）。 */
  maxLeverage: number;
  /** 最高一档的上限：超过它任何杠杆都不能开。 */
  topCap: number;
  /** 这一单的方向；改杠杆时为 null。 */
  side: OrderSide | null;
  /** 这一单的估值价；没给时为 NaN（「可开」按标记价折回 USD）。 */
  orderPrice: number;
  /** 反方向上更新前的仓位合计（档位单位）；没有方向时为 NaN。 */
  legacyHedgeBase: number;
  /** 这一侧还能按对冲豁免再开多少（档位单位，可为负）；没有方向时为 NaN。 */
  legacyHedgeRoom: number;
  /** 这一侧的旧仓位留给反方向对冲的余量（档位单位，可为负）；没有方向时为 NaN。 */
  reverseHedgeRoom: number;
  /** 这一单按标记价估的大小（档位单位，对冲豁免比的就是它）；没有方向时为 NaN。 */
  legacyHedgeOrder: number;
  /** 对冲豁免的几个量用的标记价；没有方向或取不到时为 NaN。 */
  legacyHedgeMarkPrice: number;
  /** 被拒时给用户看的话；通过时为 null。 */
  message: string | null;
  /** 合成合约 / 兜底分层的说明；直接对得上币安合约时为 null。 */
  note: string | null;
  tiers: ResolvedSymbolTiers;
  /** 判的时候用的持仓限制模式；缺省（旧调用口径）为币安标准。 */
  mode?: PositionLimitMode;
  /** 见 PositionLimitInput.legacyKinds。 */
  legacyKinds?: readonly HedgeBaseKind[];
}

const fmt = (amount: number, unit: string) => formatTierAmount(amount, unit);

type MessageFields = Pick<PositionLimitResult,
  'reason' | 'leverage' | 'cap' | 'unit' | 'maxLeverage' | 'maxLeverageForResult' | 'topCap'>
  & Partial<Pick<PositionLimitResult,
    'exposureBefore' | 'exposureAfter' | 'maxLeverageForExposure' | 'leverageFloor' | 'legacyExposure'
    | 'legacyHedgeBase' | 'legacyHedgeRoom' | 'reverseHedgeRoom' | 'legacyHedgeOrder' | 'mode' | 'legacyKinds'>>;

/**
 * 对冲豁免的底怎么称呼：只有更新前的仓位（或没说）→「更新前的仓位」（与改动前逐字相同）；
 * 只有无限制模式下开的 →「无限制模式下开的仓位」；两种都有 →「更新前或无限制模式下开的仓位」。
 */
export function hedgeBaseNoun(kinds?: readonly HedgeBaseKind[] | null): string {
  const pre = !kinds || kinds.length === 0 || kinds.includes('pre-update');
  const unlimited = !!kinds && kinds.includes('unlimited');
  if (pre && unlimited) return '更新前或无限制模式下开的仓位';
  return unlimited ? '无限制模式下开的仓位' : '更新前的仓位';
}

/** 同上，用在「靠对冲更新前仓位的豁免……」这种紧凑说法里（更新前时不带「的」，与改动前逐字相同）。 */
export function hedgeBaseShortNoun(kinds?: readonly HedgeBaseKind[] | null): string {
  const noun = hedgeBaseNoun(kinds);
  return noun === '更新前的仓位' ? '更新前仓位' : noun;
}

/** 几组「底的来源」合成一组（去重、保持先后）；文案按合起来的那一组说。 */
export function mergeHedgeBaseKinds(...groups: (readonly HedgeBaseKind[] | null | undefined)[]): HedgeBaseKind[] {
  const out: HedgeBaseKind[] = [];
  for (const group of groups) {
    for (const kind of group ?? []) if (!out.includes(kind)) out.push(kind);
  }
  return out;
}

/** 「（含更新前按旧规则开的仓位）」那半句，按底的来源换说法。 */
function legacyExposureNote(kinds?: readonly HedgeBaseKind[] | null): string {
  const pre = !kinds || kinds.length === 0 || kinds.includes('pre-update');
  const unlimited = !!kinds && kinds.includes('unlimited');
  if (pre && unlimited) return '（含更新前按旧规则或无限制模式下开的仓位）';
  return unlimited ? '（含无限制模式下开的仓位）' : '（含更新前按旧规则开的仓位）';
}

/** 对冲豁免的容差：同一批数算出来的「恰好等于旧仓位名义」不能因浮点噪声被拒。 */
const hedgeFits = (order: number, room: number) => order <= room + Math.abs(room) * 1e-9;

/**
 * 拒绝文案后面的对冲指路（只在下单时有方向才有）：
 *   这一单本身是对冲旧仓位的，只是超过了豁免额度 → 说额度是多少；
 *   这一侧有旧仓位、反方向还有余量 → 说反向对冲不受此限、最多多少。
 */
function legacyHedgeNote(r: MessageFields): string {
  const order = Number.isFinite(Number(r.legacyHedgeOrder))
    ? Number(r.legacyHedgeOrder)
    : Number(r.exposureAfter) - Number(r.exposureBefore);
  const base = Number(r.legacyHedgeBase);
  const room = Number(r.legacyHedgeRoom);
  const reverse = Number(r.reverseHedgeRoom);
  // 底只有更新前的仓位时与改动前逐字相同；有无限制模式下开的仓位时换成对应的称呼（hedgeBaseNoun）
  const noun = hedgeBaseNoun(r.legacyKinds);
  if (base > 0 && room > 0 && !hedgeFits(order, room)) {
    return `这一单是反向对冲${noun}，不受此限的额度最多 ${fmt(room, r.unit)}（按标记价计，连同这一侧已有的持仓与委托不超过旧仓位的 ${fmt(base, r.unit)}）。`;
  }
  if (reverse > 0) {
    return noun === '更新前的仓位'
      ? `反向开仓对冲更新前的仓位不受此限，最多 ${fmt(reverse, r.unit)}。`
      : `反向开仓对冲${noun}不受此限，最多 ${fmt(reverse, r.unit)}。`;
  }
  return '';
}

/**
 * 现有敞口自己就放不下时的出路（下单被拒、改杠杆被拒共用）：
 *   现有敞口超过最高一档           → 任何杠杆都不行，只能减仓 / 撤单
 *   降到它能放下的杠杆 ≥ 杠杆下限  → 照币安的话说「请调低杠杆倍数至 Nx 以下」，或减仓 / 撤单
 *   否则（逐仓持仓把下限卡住了）   → 只能减仓 / 撤单，把总量降到这个杠杆的上限以下
 */
function exposureOverCapText(a: {
  exposure: number;
  unit: string;
  leverage: number;
  cap: number;
  topCap: number;
  maxLeverageForExposure: number;
  leverageFloor: number;
  legacy: boolean;
  legacyKinds?: readonly HedgeBaseKind[];
}): string {
  const head = `现有持仓和当前委托价值 ${fmt(a.exposure, a.unit)}${a.legacy ? legacyExposureNote(a.legacyKinds) : ' '}已超过`;
  if (!(a.maxLeverageForExposure >= 1)) {
    return `${head}该合约最大可持有头寸 ${fmt(a.topCap, a.unit)}（任何杠杆都不可开）：`
      + `请先减仓或撤单，把总量降到 ${fmt(a.cap, a.unit)} 以下再开新单。`;
  }
  const over = `${head}当前杠杆倍数最高可持有头寸：${a.leverage}x 最高 ${fmt(a.cap, a.unit)}，这个杠杆下再小的单也开不出去。`;
  if (a.maxLeverageForExposure >= Math.max(1, a.leverageFloor)) {
    return `${over}请调低杠杆倍数至 ${a.maxLeverageForExposure}x 以下，或先减仓、撤单。`;
  }
  return `${over}逐仓有持仓时不能降杠杆（当前最低 ${a.leverageFloor}x），`
    + `只能先减仓或撤单，把总量降到 ${fmt(a.cap, a.unit)} 以下再开新单。`;
}

/** 下单被拒时的文案（面板警告与引擎提示是同一句话）。 */
export function positionLimitMessage(r: MessageFields): string | null {
  switch (r.reason) {
    case 'leverage-above-max':
      if (isUnlimitedLimitMode(r.mode)) {
        return `${r.leverage}x 超出无限制模式的杠杆范围 1–${r.maxLeverage}x，请调整杠杆倍数`;
      }
      return `${r.leverage}x 超过该合约最高杠杆 ${r.maxLeverage}x，请调低杠杆倍数至 ${r.maxLeverage}x 以下`;
    case 'exceeds-top-cap':
      return `超过该合约最大可持有头寸 ${fmt(r.topCap, r.unit)}（任何杠杆都不可开）${legacyHedgeNote(r)}`;
    case 'exceeds-cap':
      return `持仓和当前委托价值超过当前杠杆倍数最高可持有头寸：${r.leverage}x 最高 ${fmt(r.cap, r.unit)}。`
        + `按这个规模最高可用 ${r.maxLeverageForResult}x，请调低杠杆或减少数量。${legacyHedgeNote(r)}`;
    case 'exposure-over-cap':
      return exposureOverCapText({
        exposure: Number(r.exposureBefore),
        unit: r.unit,
        leverage: r.leverage,
        cap: r.cap,
        topCap: r.topCap,
        maxLeverageForExposure: Number(r.maxLeverageForExposure),
        leverageFloor: Number(r.leverageFloor ?? 1),
        legacy: !!r.legacyExposure,
        legacyKinds: r.legacyKinds,
      }) + legacyHedgeNote(r);
    default:
      return null;
  }
}

/**
 * 改杠杆被拒时的文案。
 *   降到现有敞口放得下的杠杆是走得通的 → 开头就是币安的「请调低杠杆倍数至 Nx 以下」
 *   走不通（逐仓持仓把下限卡在它上面，或超过最高一档）→「调整杠杆解决不了」，
 *     按用户还能选的最低杠杆（下限，且不超过合约最高杠杆）说该减到多少
 */
export function leverageChangeRefusalMessage(r: PositionLimitResult): string | null {
  if (r.reason === 'exceeds-cap' || r.reason === 'exposure-over-cap' || r.reason === 'exceeds-top-cap') {
    const floor = Math.max(1, r.leverageFloor);
    if (r.maxLeverageForExposure >= floor) {
      return `请调低杠杆倍数至 ${r.maxLeverageForResult}x 以下：持仓和当前委托价值 ${fmt(r.exposureAfter, r.unit)}`
        + ` 超过 ${r.leverage}x 最高可持有头寸 ${fmt(r.cap, r.unit)}`;
    }
    const lowest = Math.min(floor, r.maxLeverage);
    return `调整杠杆解决不了：${exposureOverCapText({
      exposure: r.exposureAfter,
      unit: r.unit,
      leverage: lowest,
      cap: maxPositionAtLeverage(r.tiers.tiers, lowest),
      topCap: r.topCap,
      maxLeverageForExposure: r.maxLeverageForExposure,
      leverageFloor: floor,
      legacy: r.legacyExposure,
      legacyKinds: r.legacyKinds,
    })}`;
  }
  return positionLimitMessage(r);
}

/**
 * 无限制模式的判定：不设上限（cap / remaining / topCap 都是 Infinity，「可开」只受余额约束），
 * 杠杆只要在 1–150x 之内就放行（理由 'unlimited'）；只减仓照旧是 'reduce-only'。
 * 敞口照实记下（exposureBefore / After），只是不拿它比任何上限。
 */
function unlimitedPositionLimit(input: PositionLimitInput): PositionLimitResult {
  const tiers = resolveSymbolTiers(input.symbol, input.settlement);
  const leverage = Number(input.leverage);
  const before = Math.max(0, Number(input.exposureBefore));
  const order = Math.max(0, Math.abs(Number(input.orderNotional)));
  const base = {
    leverage,
    cap: Infinity,
    unit: tiers.unit,
    maxLeverageForResult: UNLIMITED_MAX_LEVERAGE,
    maxLeverageForExposure: UNLIMITED_MAX_LEVERAGE,
    leverageFloor: 1,
    legacyExposure: false,
    exposureBefore: before,
    exposureAfter: before + order,
    remaining: Infinity,
    maxLeverage: UNLIMITED_MAX_LEVERAGE,
    topCap: Infinity,
    side: input.side ?? null,
    orderPrice: Number(input.orderPrice) > 0 ? Number(input.orderPrice) : NaN,
    legacyHedgeBase: NaN,
    legacyHedgeRoom: NaN,
    reverseHedgeRoom: NaN,
    legacyHedgeOrder: NaN,
    legacyHedgeMarkPrice: NaN,
    note: null,
    tiers,
    mode: 'unlimited' as const,
  };
  if (input.reduceOnly) return { ...base, ok: true, reason: 'reduce-only', message: null };
  if (!(leverage >= 1) || leverage > UNLIMITED_MAX_LEVERAGE) {
    const failed = { ...base, ok: false, reason: 'leverage-above-max' as const };
    return { ...failed, message: positionLimitMessage(failed) };
  }
  return { ...base, ok: true, reason: 'unlimited', message: null };
}

/**
 * 唯一的判定（输入都已是档位单位）。
 *
 *   无限制模式        → 见 unlimitedPositionLimit（不设上限）；以下都是币安标准
 *   只减仓            → 放行（见文件头：与币安刻意不同）
 *   敞口算不出（无价）→ 放行；引擎在没有价格时本来就拒绝下单
 *   杠杆 > 合约最高   → 拒绝
 *   下单之前的敞口自己就过不去 → 拒绝（exposure-over-cap：理由里说清出路）
 *   结果 > 最高上限   → 拒绝（任何杠杆都不行）
 *   结果所在档位的最高杠杆 < 当前杠杆 → 拒绝
 *   后三种拒绝里，这一单若是反向对冲更新前的仓位、且没超过豁免额度 → 放行（legacy-hedge，见文件头）
 */
export function checkPositionLimit(input: PositionLimitInput): PositionLimitResult {
  if (isUnlimitedLimitMode(input.mode)) return unlimitedPositionLimit(input);
  const tiers = resolveSymbolTiers(input.symbol, input.settlement);
  const leverage = Number(input.leverage);
  const before = Math.max(0, Number(input.exposureBefore));
  const order = Math.max(0, Math.abs(Number(input.orderNotional)));
  const after = before + order;
  const cap = maxPositionAtLeverage(tiers.tiers, leverage);
  const priced = Number.isFinite(before) && Number.isFinite(order);
  const hedge = input.legacyHedge ?? null;

  const base = {
    leverage,
    cap,
    unit: tiers.unit,
    maxLeverageForResult: priced ? maxLeverageForNotional(tiers.tiers, after) : NaN,
    maxLeverageForExposure: priced ? maxLeverageForNotional(tiers.tiers, before) : NaN,
    leverageFloor: Math.max(1, Number(input.leverageFloor) || 1),
    legacyExposure: !!input.legacyExposure,
    exposureBefore: before,
    exposureAfter: after,
    remaining: priced ? Math.max(0, cap - before) : NaN,
    maxLeverage: tiers.maxLeverage,
    topCap: tiers.topCap,
    side: input.side ?? null,
    orderPrice: Number(input.orderPrice) > 0 ? Number(input.orderPrice) : NaN,
    legacyHedgeBase: hedge ? hedge.base : NaN,
    legacyHedgeRoom: hedge ? hedge.room : NaN,
    reverseHedgeRoom: hedge ? hedge.reverseRoom : NaN,
    legacyHedgeOrder: hedge ? Math.abs(Number(hedge.order ?? order)) : NaN,
    legacyHedgeMarkPrice: hedge && Number(hedge.markPrice) > 0 ? Number(hedge.markPrice) : NaN,
    note: tiers.note,
    tiers,
    ...(input.legacyKinds && input.legacyKinds.length > 0 ? { legacyKinds: input.legacyKinds } : {}),
  };
  const pass = (reason: PositionLimitReason): PositionLimitResult => ({ ...base, ok: true, reason, message: null });
  const fail = (reason: PositionLimitReason): PositionLimitResult => {
    const failed = { ...base, ok: false, reason };
    return { ...failed, message: positionLimitMessage(failed) };
  };
  /** 对冲更新前仓位的豁免：反方向确有旧仓位、这一单（按标记价估的大小）不超过额度。 */
  const hedgeOrder = base.legacyHedgeOrder;
  const hedgesLegacy = !!hedge && hedgeOrder > 0 && hedge.base > 0 && hedge.room > 0 && hedgeFits(hedgeOrder, hedge.room);
  const failUnlessHedge = (reason: PositionLimitReason) => (hedgesLegacy ? pass('legacy-hedge') : fail(reason));

  if (input.reduceOnly) return pass('reduce-only');
  if (!priced) return pass('no-price');
  if (!(leverage >= 1) || leverage > tiers.maxLeverage) return fail('leverage-above-max');
  if (before > 0 && base.maxLeverageForExposure < leverage) return failUnlessHedge('exposure-over-cap');
  if (exceedsTopCap(tiers.tiers, after)) return failUnlessHedge('exceeds-top-cap');
  if (base.maxLeverageForResult < leverage) return failUnlessHedge('exceeds-cap');
  return pass('ok');
}

export interface ExposureContext {
  symbol: string;
  settlement: LimitSettlement;
  positions: readonly Position[] | null | undefined;
  orders: readonly PendingOrder[] | null | undefined;
  /** 标记价：持仓按它估值（真币本位按它把持仓折成币）；市价类挂单也按它。 */
  markPrice: number;
  excludeOrderIds?: readonly string[];
  /** 同一批里刚改过、挂单列表还没写回的委托（见 ExposureOptions.orderOverrides）。 */
  orderOverrides?: readonly PendingOrder[];
  /** 价格从哪里走到 markPrice（见 ExposureOptions.pathFrom）；缺省 = markPrice。 */
  pathFrom?: number;
  /** 到 markPrice 之前先到过的价（见 ExposureOptions.pathVia）。 */
  pathVia?: readonly number[];
  /** 持仓限制模式（lib/positionLimitMode）；缺省按币安标准。 */
  mode?: PositionLimitMode | null;
}

/**
 * 杠杆下限：所有未平仓位里最高的杠杆（没有持仓为 1）。逐仓有持仓时只能升不能降，
 * 与 planLeverageChange 的滑块下限是同一个定义（两种结算方式的仓位一起算：杠杆按标的存一份）。
 */
export function leverageFloorOf(positions: readonly Position[] | null | undefined): number {
  let floor = 1;
  for (const p of positions ?? []) {
    if (!p || !isPositionOpen(p)) continue;
    floor = Math.max(floor, Math.max(1, Number(p.leverage) || 1));
  }
  return floor;
}

const opposite = (side: OrderSide): OrderSide => (side === 'LONG' ? 'SHORT' : 'LONG');

interface ExposureBreakdown {
  total: number;
  /** 以下两项按标记价估值（对冲豁免比仓位大小用），按方向。 */
  markBySide: Record<OrderSide, number>;
  /**
   * 对冲豁免的底（更新前按旧规则开的持仓里冻结的那一截；豁免仓位不算，分层加仓并进来的那一截也不算）。
   */
  legacyBySide: Record<OrderSide, number>;
  /** 底都是哪几种（文案用）。 */
  legacyKinds: HedgeBaseKind[];
}

/**
 * 按档位单位逐笔累加：每一笔按自己的估值价折（真币本位持仓按标记价、挂单按各自的价）。
 * 对冲豁免的两组数另按标记价折——比的是仓位大小，不是各按各的价。
 */
function exposureBreakdown(ctx: ExposureContext): ExposureBreakdown {
  const tiers = resolveSymbolTiers(ctx.symbol, ctx.settlement);
  const out: ExposureBreakdown = {
    total: 0, markBySide: { LONG: 0, SHORT: 0 }, legacyBySide: { LONG: 0, SHORT: 0 }, legacyKinds: [],
  };
  const items = exposureItems(ctx.symbol, ctx.positions, ctx.orders, ctx.markPrice, {
    settlement: ctx.settlement,
    excludeOrderIds: ctx.excludeOrderIds,
    orderOverrides: ctx.orderOverrides,
    pathFrom: ctx.pathFrom,
    pathVia: ctx.pathVia,
  });
  for (const item of items) {
    out.total += item.usd === 0 ? 0 : tierAmountFromUsdNotional(tiers, item.usd, item.price);
    const atMark = item.usdAtMark === 0 ? 0 : tierAmountFromUsdNotional(tiers, item.usdAtMark, item.priceAtMark);
    out.markBySide[item.side] += atMark;
    // 底按这一笔自己那部分折：整笔是底时与 atMark 相等，分层加仓并进来之后只有冻结的那一截。
    if (item.legacyUsdAtMark > 0) {
      out.legacyBySide[item.side] += tierAmountFromUsdNotional(tiers, item.legacyUsdAtMark, item.priceAtMark);
      if (item.legacyKind && !out.legacyKinds.includes(item.legacyKind)) out.legacyKinds.push(item.legacyKind);
    }
  }
  return out;
}

/** 下单之前、这种结算方式下的敞口（档位单位）。 */
export function exposureInTierUnit(ctx: ExposureContext): number {
  return exposureBreakdown(ctx).total;
}

/** 一笔新单（USD 名义）加进现有敞口之后过不过得了分层上限。 */
export function checkOrderPositionLimit(ctx: ExposureContext & {
  leverage: number;
  orderNotionalUsd: number;
  /**
   * 这一单的估值价（orderValuationPrice / placementOrderValuation）：真币本位按它把这一单的 USD 名义折成币。
   * 缺省按标记价（市价单）。
   */
  orderPrice?: number;
  /** 这一单的方向：对冲更新前仓位的豁免要用。改杠杆时没有。 */
  side?: OrderSide | null;
  reduceOnly?: boolean;
}): PositionLimitResult {
  const tiers = resolveSymbolTiers(ctx.symbol, ctx.settlement);
  const ex = exposureBreakdown(ctx);
  const orderUsd = Math.abs(Number(ctx.orderNotionalUsd) || 0);
  const orderPrice = Number(ctx.orderPrice) > 0 ? Number(ctx.orderPrice) : ctx.markPrice;
  const side = ctx.side ?? null;
  /**
   * 对冲豁免按标记价比大小：这一单也按标记价估。U 本位的名义随价走（币数 × 价），换到标记价；
   * 币本位的名义是张数 × 面值、与价无关，真币本位再按标记价折成币。
   */
  const hedgeMark = ctx.markPrice > 0 ? ctx.markPrice : orderPrice;
  const orderUsdAtMark = ctx.settlement === 'usdt' && orderPrice > 0 ? (orderUsd * hedgeMark) / orderPrice : orderUsd;
  const legacyPositions = (ctx.positions ?? []).filter(p => p && isPositionOpen(p)
    && limitSettlementOf(p) === ctx.settlement && isHedgeBaseRisk(p));
  const legacyKinds = [...ex.legacyKinds];
  for (const p of legacyPositions) {
    const kind = hedgeBaseKindOf(p);
    if (kind && !legacyKinds.includes(kind)) legacyKinds.push(kind);
  }
  return checkPositionLimit({
    symbol: ctx.symbol,
    settlement: ctx.settlement,
    leverage: ctx.leverage,
    exposureBefore: ex.total,
    orderNotional: orderUsd === 0 ? 0 : tierAmountFromUsdNotional(tiers, orderUsd, orderPrice),
    reduceOnly: ctx.reduceOnly,
    leverageFloor: leverageFloorOf(ctx.positions),
    legacyExposure: legacyPositions.length > 0,
    legacyKinds,
    mode: ctx.mode,
    side,
    orderPrice: Number(ctx.orderPrice) > 0 ? Number(ctx.orderPrice) : undefined,
    legacyHedge: side
      ? {
        base: ex.legacyBySide[opposite(side)],
        room: ex.legacyBySide[opposite(side)] - ex.markBySide[side],
        reverseRoom: ex.legacyBySide[side] - ex.markBySide[opposite(side)],
        order: orderUsdAtMark === 0 ? 0 : tierAmountFromUsdNotional(tiers, orderUsdAtMark, hedgeMark),
        markPrice: hedgeMark,
      }
      : null,
  });
}

/** 第二道判在哪个价上：触发类 = 触发价（跟踪委托为激活价）；挂在盘口的限价单 = 成交那一刻的委托价。 */
export type PlacementCheckKind = 'trigger' | 'limit';

export interface PlacementLimitResult extends PositionLimitResult {
  /** 按现价（此刻的持仓与挂单）判的那一道。 */
  atMark: PositionLimitResult;
  /**
   * 第二道：触发类开仓单按触发价（跟踪委托按激活价）、不会立即成交的限价单按委托价，
   * 按「价格走到那个价的那一刻」判（见文件头）；没有第二道时为 null。
   */
  atTrigger: (PositionLimitResult & { price: number; kind: PlacementCheckKind }) | null;
}

/**
 * 下单时的判定（下单面板的警告、引擎的下单闸门、加仓计算器共用）。
 *
 * 要过两道：按现价一道（币安的口径：持仓按标记价，挂单与这一单按各自的价）；再按第二道的价 P 一道——
 * 持仓按 P 估值、路上会成交的限价单算作 P 上的持仓、这一单也按 P 估值（真币本位按 P 折成币）：
 *   · 触发类开仓单：P = 触发价 / 激活价，与触发那一刻 settleFillDebit 的判法一致。只判现价的话，
 *     一张对冲单可以在下单时放行、价格一到触发价就注定被撤（BTCUSD 20x：141.67 BTC 下单放行，54,000 触发时 157.41 BTC）。
 *   · 不会立即成交的限价单（分段订单取离现价最远的那笔子单价）：P = 委托价。币安成交时不再判，
 *     可成交那一刻持仓已按委托价估值——真币本位低于现价的买单、U 本位高于现价的卖单，成交之后总量就超过上限，
 *     账户从此连对冲都开不出去。所以下单时就按成交那一刻判（与币安刻意不同的一处，见 placementCheckPrice）。
 * 两道都过才放行。顶层字段取先失败的那一道（第二道的文案带上「按触发价 / 按委托价 X 估值：」），
 * 都过时取现价那一道。
 * ctx.pathVia 只作用于第二道（加仓计算器按「计划里另一张单先成交、价格再折回来」判；面板与引擎不传）。
 */
export function checkPlacementPositionLimit(ctx: ExposureContext & {
  leverage: number;
  orderNotionalUsd: number;
  /** 这一单的估值价（placementOrderValuation().price）；缺省按标记价。 */
  orderPrice?: number;
  side?: OrderSide | null;
  reduceOnly?: boolean;
  /** 第二道的价（placementCheckPrice / triggeredCheckPrice）；0 / 缺省表示不判这一道。 */
  triggerPrice?: number;
  /** 第二道是哪一种价（只影响文案）；缺省 'trigger'。 */
  triggerKind?: PlacementCheckKind;
}): PlacementLimitResult {
  // 现价那一道判的是此刻：不带「走过去」的路
  const atMark = checkOrderPositionLimit({ ...ctx, pathFrom: undefined, pathVia: undefined });
  const px = Number(ctx.triggerPrice);
  const kind: PlacementCheckKind = ctx.triggerKind ?? 'trigger';
  let atTrigger: PlacementLimitResult['atTrigger'] = null;
  // 无限制模式不设上限，触发 / 成交那一刻也不再判：没有第二道
  if (!ctx.reduceOnly && px > 0 && !isUnlimitedLimitMode(ctx.mode)) {
    /**
     * 这一单在 P 上的 USD 名义：U 本位的币数不变、名义随价走（名义 ÷ 估值价 × P）；币本位的名义是张数 × 面值，与价无关。
     * 条件单 / 限价单的估值价本来就是 P，分段订单的估值价是子单均价。没给估值价时视为名义已按 P 估好（旧调用口径）。
     */
    const orderUsd = Math.abs(Number(ctx.orderNotionalUsd) || 0);
    const valuation = Number(ctx.orderPrice) > 0 ? Number(ctx.orderPrice) : px;
    const usdAtPx = ctx.settlement === 'usdt' && valuation > 0 ? (orderUsd * px) / valuation : orderUsd;
    atTrigger = {
      ...checkOrderPositionLimit({
        ...ctx,
        markPrice: px,
        // 从现价走到 P：路上会成交的限价单在 P 上已是持仓
        pathFrom: Number(ctx.pathFrom) > 0 ? Number(ctx.pathFrom) : ctx.markPrice,
        orderPrice: px,
        orderNotionalUsd: usdAtPx,
      }),
      price: px,
      kind,
    };
  }
  if (!atMark.ok || !atTrigger || atTrigger.ok) return { ...atMark, atMark, atTrigger };
  return {
    ...atTrigger,
    message: `${placementCheckLead(kind, px)}${atTrigger.message ?? ''}`,
    atMark,
    atTrigger,
  };
}

/** 第二道拒绝文案的开头。 */
function placementCheckLead(kind: PlacementCheckKind, price: number): string {
  return kind === 'limit'
    ? `按委托价 ${formatPrice(price)} 成交那一刻估值：`
    : `按触发价 ${formatPrice(price)} 估值：`;
}

/**
 * 这一单是不是只靠「对冲更新前的仓位」那条豁免放行的（现价那一道或第二道）。
 * 是的话它盖对冲豁免标记 'legacy-hedge-v1'、按旧模型开仓（见文件头）：第二道靠豁免的条件单，触发那一刻开出的仓位同样会超出分层。
 */
export function placementUsesLegacyHedge(r: Pick<PlacementLimitResult, 'ok' | 'atMark' | 'atTrigger'>): boolean {
  return r.ok && (r.atMark.reason === 'legacy-hedge' || r.atTrigger?.reason === 'legacy-hedge');
}

/**
 * 这一单靠对冲豁免放行时，底是哪几种（现价那一道与第二道合起来）：下单面板的说明、引擎记在委托上的
 * hedgeBaseKinds 都按它说「更新前的仓位」还是「无限制模式下开的仓位」，免得同一个面板上两种说法。
 */
export function placementHedgeBaseKinds(r: Pick<PlacementLimitResult, 'atMark' | 'atTrigger'>): HedgeBaseKind[] {
  return mergeHedgeBaseKinds(r.atMark.legacyKinds, r.atTrigger?.legacyKinds);
}

/**
 * 「可开」与仓位比例按钮的分层上限（USD 名义，按这一单在现价那一道的估值口径）：
 * 现价那一道按 sizingRemainingOpenUsd（含余量）；第二道按 P 把剩余折回 USD（估值钉在 P 上，不随现价漂，不留余量），
 * U 本位再按「币数不变」换回现价那一道的估值价（分段订单：子单均价 ÷ P）；取较小者。
 */
export function placementSizingRemainingUsd(
  r: PlacementLimitResult,
  markPrice: number,
  live: { orderAtMarket: boolean; hasOpenPositions: boolean },
): number {
  const atMark = sizingRemainingOpenUsd(r.atMark, markPrice, live);
  if (!r.atTrigger) return atMark;
  const px = r.atTrigger.price;
  let second = remainingOpenUsd(r.atTrigger, px);
  const basis = r.atMark.orderPrice > 0 ? r.atMark.orderPrice : px;
  if (r.tiers.settlement === 'usdt' && px > 0 && Number.isFinite(second)) second = (second * basis) / px;
  return Math.min(atMark, second);
}

/**
 * 把一个标的改到杠杆 L 过不过得了分层上限（杠杆对话框与 planLeverageChange 共用）。
 *
 * 杠杆按标的存一份，U 本位与币本位的仓位都会被重述，所以当前结算方式之外、
 * 手上还有敞口的那种结算方式也要一起判；哪一种不过就用哪一种的理由拒绝。
 * 通过时返回当前结算方式的结果（对话框显示的就是它）。
 */
export function checkLeverageChange(ctx: Omit<ExposureContext, 'excludeOrderIds'> & { leverage: number }): PositionLimitResult {
  const groups: LimitSettlement[] = [ctx.settlement];
  const add = (s: LimitSettlement) => { if (!groups.includes(s)) groups.push(s); };
  for (const p of ctx.positions ?? []) if (p && isPositionOpen(p)) add(limitSettlementOf(p));
  for (const o of ctx.orders ?? []) if (o && !o.reduceOnly) add(limitSettlementOf(o));

  let primary: PositionLimitResult | null = null;
  for (const settlement of groups) {
    const r = checkOrderPositionLimit({ ...ctx, settlement, orderNotionalUsd: 0 });
    if (!r.ok) {
      // 卡住的是另一种结算方式的那张合约时说清楚是哪一张：两张合约的最高杠杆可能不同（BNB 75x / 20x）。
      const other = settlement !== ctx.settlement ? (settlement === 'coin' ? '另有币本位持仓或委托：' : '另有 U 本位持仓或委托：') : '';
      return { ...r, message: `${other}${leverageChangeRefusalMessage(r)}` };
    }
    if (settlement === ctx.settlement) primary = r;
  }
  return primary as PositionLimitResult;
}

/** 档位金额折回 USD：按这一单的估值价（没有就按给定的价，通常是标记价）。 */
function tierAmountToUsd(r: PositionLimitResult, amount: number, fallbackPrice: number): number {
  const price = r.orderPrice > 0 ? r.orderPrice : fallbackPrice;
  return usdNotionalFromTierAmount(r.tiers, amount, price);
}

/** 这一单能用上的对冲豁免额度（档位单位，按标记价估）；没有就是 0。 */
function hedgeRoomOf(r: PositionLimitResult): number {
  return r.legacyHedgeBase > 0 && r.legacyHedgeRoom > 0 ? r.legacyHedgeRoom : 0;
}

/**
 * 对冲豁免的额度（按标记价估的档位金额）折回这一单的 USD 名义：
 * 先按标记价折回 USD（真币本位 × 标记价），U 本位再按这一单的估值价换算（币数不变，名义随价走）；
 * 币本位的名义是张数 × 面值，与价无关。
 */
function hedgeAmountToOrderUsd(r: PositionLimitResult, amount: number, fallbackPrice: number): number {
  const mark = r.legacyHedgeMarkPrice > 0 ? r.legacyHedgeMarkPrice : fallbackPrice;
  const usdAtMark = usdNotionalFromTierAmount(r.tiers, amount, mark);
  const orderPrice = r.orderPrice > 0 ? r.orderPrice : fallbackPrice;
  if (r.tiers.settlement !== 'usdt' || !(mark > 0) || !(orderPrice > 0)) return usdAtMark;
  return (usdAtMark * orderPrice) / mark;
}

/**
 * 按分层还能再开的 USD 名义（「可开」与仓位比例按钮的上限）：max(当前杠杆上限 − 现有敞口, 对冲豁免额度)，
 * 按这一单的估值价折回 USD（真币本位：限价单按委托价，市价单按标记价）。
 * 算不出来（无价的真币本位）时返回 Infinity，即不额外设限，只受余额约束。
 */
export function remainingOpenUsd(r: PositionLimitResult, markPrice: number): number {
  if (!Number.isFinite(r.remaining)) return Infinity;
  const usd = tierAmountToUsd(r, r.remaining, markPrice);
  if (!Number.isFinite(usd)) return Infinity;
  const hedge = hedgeAmountToOrderUsd(r, hedgeRoomOf(r), markPrice);
  return Math.max(0, usd, Number.isFinite(hedge) ? hedge : 0);
}

/**
 * 「可开」与仓位比例按钮在分层上限前留的余量（占当前杠杆上限的比例）。
 *
 * 面板按平滑后的显示价估值，引擎按最新价估值（Index 的 latestChartPriceRef / priceMap），
 * 两者常差一个 tick：恰好卡在上限上的 100% 单，面板说没问题，引擎按高一个 tick 的价一估就拒了
 * （KAITOUSDT 15x：面板 1.0000 × 50,000 = 50,000，引擎 1.0001 × 50,000 = 50,005）。
 * 只给估值会跟着标记价走的情形留（live，调用方用 placementFloatsWithMark 算）：按现价成交的单（市价、最优价、
 * 已经穿价或离现价不到 0.2% 的限价单——面板与引擎可能对「穿没穿价」看法不同）、挂着这样的限价单、
 * 这一单或挂单按标记价估值（TWAP、没有激活价的跟踪委托），或已有持仓（持仓按标记价估值）——U 本位与真币本位（以币计）都一样。
 * 除此之外（离现价更远的限价 / 触发价单、没有持仓、挂单也都按各自的价估值）不留：估值不随现价漂；第二道钉在 P 上，也不留；
 * 合成币本位（如 KAITOUSD）按 USD 面值计、与价格无关，从不留。
 * 判定本身（面板警告、引擎闸门）不打折，仍是币安的上限。
 */
export const LIVE_PRICE_TIER_HEADROOM = 0.002;

export function sizingRemainingOpenUsd(
  r: PositionLimitResult,
  markPrice: number,
  live: { orderAtMarket: boolean; hasOpenPositions: boolean },
): number {
  if (!Number.isFinite(r.remaining)) return Infinity;
  const normal = tierAmountToUsd(r, r.remaining, markPrice);
  if (!Number.isFinite(normal)) return Infinity;
  const floats = r.tiers.measure !== 'usd-face' && (live.orderAtMarket || live.hasOpenPositions);
  /** 余量按这一道的基数（当前杠杆的上限 / 对冲豁免对着的旧仓位大小）留。 */
  const keep = (usd: number, baseUsd: number) => (floats && Number.isFinite(baseUsd)
    ? usd - baseUsd * LIVE_PRICE_TIER_HEADROOM
    : usd);
  let out = Math.max(0, keep(normal, tierAmountToUsd(r, r.cap, markPrice)));
  const room = hedgeRoomOf(r);
  if (room > 0) {
    const hedge = hedgeAmountToOrderUsd(r, room, markPrice);
    if (Number.isFinite(hedge)) out = Math.max(out, keep(hedge, hedgeAmountToOrderUsd(r, r.legacyHedgeBase, markPrice)));
  }
  return out;
}

export type PlacementOrderDraft = Pick<PendingOrder, 'type' | 'quantity' | 'stopPrice' | 'settlementMode' | 'contracts' | 'contractSizeUsd'> & {
  price?: number;
  scaledCount?: number;
  scaledStartPrice?: number;
  scaledEndPrice?: number;
  /** 方向：已经穿价的限价单（买价 ≥ 现价、卖价 ≤ 现价）按现价估值，要靠它判。不给就不判穿价。 */
  side?: OrderSide;
};

/** 限价类的价会不会被当作「已经穿价」：需要方向与标记价。 */
function marketableAt(draft: { side?: OrderSide }, limitPrice: number, markPrice?: number): boolean {
  return !!draft.side && Number(markPrice) > 0 && isMarketableLimitPrice(draft.side, limitPrice, Number(markPrice));
}

/** 分段订单拆出来的子单（张数的取法与 TradingContext 的分段分支一致）；参数不全时为 null。 */
function scaledChildren<T extends PlacementOrderDraft>(order: T): Array<T & { price: number }> | null {
  const coin = isCoinSettled(order);
  const count = order.scaledCount || 5;
  const startP = order.scaledStartPrice || 0;
  const endP = order.scaledEndPrice || 0;
  if (count < 2 || !(startP > 0) || !(endP > 0)) return null;
  const step = (endP - startP) / (count - 1);
  const qtyPerStep = coin ? Math.max(1, Math.round(order.quantity / count)) : order.quantity / count;
  return Array.from({ length: count }, (_, i) => ({
    ...order,
    quantity: qtyPerStep,
    contracts: coin ? qtyPerStep : undefined,
    price: startP + step * i,
  }));
}

/**
 * U 本位下，这一单在引擎眼里每 1 个币值多少 USD（placementOrderNotionalUsd 的单价）：
 *   分段订单 → 各子单估值价的均值（已经穿价的子单按现价；参数不全时退回折算价）
 *   跟踪委托 → 激活价（没有激活价时退回折算价）
 *   限价单   → 委托价；已经穿价的按现价（markPrice，需要 draft.side）
 *   其余     → 折算价
 * atMarket：这个单价是不是就是现价（折算价取的是现价、或已经穿价的限价单）。
 * 面板的仓位比例按钮按它把「可开名义」换成数量，这样 100% 的单在引擎那边估出来也不超过上限。
 */
export function placementUnitPriceUsd(
  symbol: string,
  draft: PlacementOrderDraft,
  referencePrice: number,
  referenceIsMarket: boolean,
  markPrice?: number,
): { unitUsd: number; atMarket: boolean } {
  if (draft.type === 'SCALED') {
    const unit = { ...draft, quantity: 1, contracts: undefined, settlementMode: 'usdt' as const };
    const avg = placementOrderNotionalUsd(symbol, unit, referencePrice, markPrice);
    if (avg > 0) return { unitUsd: avg, atMarket: false };
  }
  if (draft.type === 'TRAILING_STOP' && Number(draft.stopPrice) > 0) {
    return { unitUsd: Number(draft.stopPrice), atMarket: false };
  }
  if (RESTING_LIMIT_TYPES.has(draft.type) && !referenceIsMarket && marketableAt(draft, referencePrice, markPrice)) {
    return { unitUsd: Number(markPrice), atMarket: true };
  }
  return { unitUsd: referencePrice, atMarket: referenceIsMarket };
}

/**
 * 引擎下单时这一单在分层判定里的估值：USD 名义与估值价（真币本位按估值价把名义折成币）。
 *   分段订单 → 各子单按自己的委托价求和（已经穿价的子单按现价）；估值价 = 名义 ÷ 子单币数合计
 *   跟踪委托 → 激活价，没有激活价按 referencePrice
 *   限价单   → referencePrice（委托价）；已经穿价的按现价 markPrice（下一根 K 线就成交，成交后按标记价估值）
 *   其余     → referencePrice（orderReferencePrice 给出的成交参照价：条件单 = 触发价，市价 = 现价）
 * 判穿价要 draft.side 与 markPrice；缺一个就按委托价。
 * 币本位的名义 = 张数 × 面值，与价格无关；折成币才要价。
 */
export function placementOrderValuation(
  symbol: string,
  order: PlacementOrderDraft,
  referencePrice: number,
  markPrice?: number,
): { usd: number; price: number } {
  const coin = isCoinSettled(order);
  if (order.type === 'SCALED') {
    const children = scaledChildren(order);
    if (!children) return { usd: 0, price: 0 };
    let usd = 0;
    let coins = 0;
    for (const child of children) {
      const px = marketableAt(order, child.price, markPrice) ? Number(markPrice) : child.price;
      const childUsd = Math.abs(getPositionNotionalUsd(symbol, child, px));
      usd += childUsd;
      coins += coin ? (px > 0 ? childUsd / px : 0) : child.quantity;
    }
    return { usd, price: coins > 0 ? usd / coins : 0 };
  }
  let price = referencePrice;
  if (order.type === 'TRAILING_STOP' && Number(order.stopPrice) > 0) price = Number(order.stopPrice);
  else if (RESTING_LIMIT_TYPES.has(order.type) && marketableAt(order, referencePrice, markPrice)) price = Number(markPrice);
  return { usd: Math.abs(getPositionNotionalUsd(symbol, order, price)), price };
}

/**
 * 下单时第二道判在哪个价上（checkPlacementPositionLimit 的 triggerPrice / triggerKind）：
 *   触发类开仓单     → triggeredCheckPrice（触发价 / 激活价），kind 'trigger'
 *   限价单           → 委托价，kind 'limit'；已经穿价的没有第二道（下一根就按现价成交，现价那一道就是它）
 *   分段订单         → 没穿价的子单里离现价最远的那笔的价（持仓与路上成交的子单在那里估值最极端），kind 'limit'
 *   市价 / 最优价 / TWAP / 取不到价 → 0（不判第二道）
 * immediate：这一单立即成交（市价、最优价）。
 */
export function placementCheckPrice(
  draft: PlacementOrderDraft & { priceSelection?: string },
  markPrice: number,
  immediate = false,
): { price: number; kind: PlacementCheckKind } {
  const none = { price: 0, kind: 'trigger' as const };
  if (immediate || draft.priceSelection === 'BEST') return none;
  const trigger = triggeredCheckPrice({ type: draft.type, price: Number(draft.price) || 0, stopPrice: Number(draft.stopPrice) || 0 });
  if (trigger > 0) return { price: trigger, kind: 'trigger' };
  if (RESTING_LIMIT_TYPES.has(draft.type)) {
    const k = Number(draft.price);
    if (!(k > 0) || marketableAt(draft, k, markPrice)) return none;
    return { price: k, kind: 'limit' };
  }
  if (draft.type === 'SCALED') {
    const children = scaledChildren(draft) ?? [];
    let far = 0;
    for (const child of children) {
      if (marketableAt(draft, child.price, markPrice)) continue;
      if (far === 0 || Math.abs(child.price - markPrice) > Math.abs(far - markPrice)) far = child.price;
    }
    return far > 0 ? { price: far, kind: 'limit' } : none;
  }
  return none;
}

/** 按标记价估值的挂单：TWAP（没成交的余量）、没有激活价的跟踪委托（orderValuationPrice 落到标记价的那两种）。 */
function valuedAtMark(order: Pick<PendingOrder, 'type' | 'stopPrice'> & Partial<Pick<PendingOrder, 'reduceOnly'>>): boolean {
  if (order.reduceOnly) return false;
  if (order.type === 'TWAP') return true;
  return order.type === 'TRAILING_STOP' && !(Number(order.stopPrice) > 0);
}

/**
 * 「可开」要不要留 0.2% 余量里「这一单 / 挂单的估值跟着现价漂」的那一半（sizingRemainingOpenUsd 的 orderAtMarket）：
 *   这一单立即成交、按现价估值（placementUnitPriceUsd().atMarket），
 *   或这一单 / 挂着的非只减仓单按标记价估值（TWAP、没有激活价的跟踪委托），
 *   或这一单 / 挂着的非只减仓限价单已经穿价、或离现价不到 LIVE_PRICE_TIER_HEADROOM——
 *   面板的显示价与引擎的最新价差一个 tick，两边对「穿没穿价」可能看法不同，估值就差这一个 tick。
 */
export function placementFloatsWithMark(args: {
  draft: PlacementOrderDraft;
  atMarket: boolean;
  markPrice: number;
  orders?: readonly PendingOrder[] | null;
}): boolean {
  if (args.atMarket) return true;
  const mark = Number(args.markPrice);
  if (!(mark > 0)) return false;
  const near = (side: OrderSide | undefined, k: number) => k > 0 && (
    (side ? isMarketableLimitPrice(side, k, mark) : false)
    || Math.abs(k - mark) <= mark * LIVE_PRICE_TIER_HEADROOM
  );
  const { draft } = args;
  if (valuedAtMark(draft)) return true;
  if (RESTING_LIMIT_TYPES.has(draft.type) && near(draft.side, Number(draft.price))) return true;
  if (draft.type === 'SCALED' && (scaledChildren(draft) ?? []).some(c => near(draft.side, c.price))) return true;
  return (args.orders ?? []).some(o => o && (
    (isRestingLimitOrder(o) && near(o.side, Number(o.price)))
    || (valuedAtMark(o) && unfilledOrderPart(o) != null)
  ));
}

/** 引擎下单时这一单的 USD 名义（仅供分层判定），见 placementOrderValuation。 */
export function placementOrderNotionalUsd(
  symbol: string,
  order: PlacementOrderDraft,
  referencePrice: number,
  markPrice?: number,
): number {
  return placementOrderValuation(symbol, order, referencePrice, markPrice).usd;
}

/** 被拒提示的补充说明：敞口的加法摆出来，并写明分层来源。无限制模式只会因杠杆超出 1–150x 被拒，说模式本身。 */
export function positionLimitDetail(r: PositionLimitResult): string {
  if (isUnlimitedLimitMode(r.mode)) {
    return `无限制模式：任何币种杠杆 1–${UNLIMITED_MAX_LEVERAGE}x，不设持仓上限`;
  }
  const source = r.tiers.binanceSymbol
    ? `币安 ${r.tiers.binanceSymbol} 分层`
    : '兜底分层';
  return `持仓和当前委托 ${fmt(r.exposureBefore, r.unit)} + 本单 ${fmt(r.exposureAfter - r.exposureBefore, r.unit)}`
    + ` = ${fmt(r.exposureAfter, r.unit)}（${source}，快照 ${r.tiers.snapshotDate}）`;
}

// ─────────────────────── 已挂触发类开仓单的预警 ───────────────────────

/** 无限制模式下挂出的委托（PendingOrder.limitModeAtPlacement）。 */
export function placedUnderUnlimited(order: Pick<PendingOrder, 'limitModeAtPlacement'> | null | undefined): boolean {
  return order?.limitModeAtPlacement === 'unlimited';
}

/**
 * 一张挂单在触发 / 成交那一刻会被 settleFillDebit 再判分层上限、而且事先知道按哪个价判——按那个价预判（见 recheckedAtFill）：
 *   本次更新之后下的（带分层戳或对冲豁免标记）触发类开仓单 → 触发价（跟踪委托为激活价），kind 'trigger'；
 *   只靠对冲豁免挂出的限价单 / 只做 Maker 单 → 委托价（成交那一刻再判豁免是否仍成立），kind 'limit'；
 *   无限制模式下挂出、此刻按币安标准判的限价单 / 只做 Maker 单 → 委托价（下单时没过分层，成交那一刻判），kind 'limit'。
 * 其余返回 null：更新前挂出的（没有任何 riskModel）触发时不再判；币安标准下挂出的普通分层限价单成交时不再判；
 * 没有激活价的跟踪委托不知道会在哪个价触发，不预判；**此刻是无限制模式时一律 null**（不再判，也不预警）。
 */
export function recheckPrice(
  order: PendingOrder | null | undefined,
  mode?: PositionLimitMode | null,
): { price: number; kind: PlacementCheckKind } | null {
  if (isUnlimitedLimitMode(mode)) return null;
  if (!order || order.reduceOnly || !hasRiskProvenance(order)) return null;
  if (isTriggeredOpenOrder(order)) {
    const price = triggeredCheckPrice(order);
    return price > 0 ? { price, kind: 'trigger' } : null;
  }
  if ((isLegacyHedgeRisk(order) || placedUnderUnlimited(order)) && isRestingLimitOrder(order)) {
    const price = Number(order.price);
    return Number.isFinite(price) && price > 0 ? { price, kind: 'limit' } : null;
  }
  return null;
}

/**
 * 这张挂单触发 / 成交时会被再判、而且事先知道判在哪个价（recheckPrice 不为 null）：委托列表标记、预警、计算器都看它。
 * 按币安标准判（只收一个参数，好直接交给 .map / .some）；无限制模式下调用方自己跳过（那时什么都不再判）。
 */
export function isTriggerRecheckedOrder(order: PendingOrder | null | undefined): boolean {
  return recheckPrice(order) != null;
}

/**
 * 成交 / 触发那一刻要不要交给 settleFillDebit 再判（调用方据此决定传不传 trigger）：
 *   触发类开仓单（条件单、跟踪委托、旧止盈止损开仓单）——带来源的才真判，更新前挂出的由闸门自己跳过；
 *   只靠对冲豁免挂出的限价单——成交那一刻豁免可能已经不成立（旧仓位先平掉了）；
 *   无限制模式下挂出的限价单 / 只做 Maker 单（含分段子单）——下单时没过分层，此刻若是币安标准就在成交这一刻判。
 * 币安标准下挂出的普通分层限价单成交时不再判（与币安一致）。与此刻的模式无关：
 * 无限制模式下闸门（settleFillDebit）自己什么都不判，传进去也只是让它给仓位定来源。
 */
export function recheckedAtFill(order: PendingOrder | null | undefined): boolean {
  if (!order || order.reduceOnly) return false;
  return isTriggeredOpenOrder(order)
    || order.riskModel === LEGACY_HEDGE_RISK_MODEL
    || (placedUnderUnlimited(order) && isRestingLimitOrder(order));
}

/** 触发 / 成交那一刻的预判结果：判在哪个价、哪一种价，以及价格是不是先到过另一侧的 via 再折回来。 */
export type TriggerCheckResult = PositionLimitResult & { price: number; kind: PlacementCheckKind; via: number | null };

export interface TriggerCheckState {
  positions: readonly Position[] | null | undefined;
  orders: readonly PendingOrder[] | null | undefined;
  /** 改杠杆时挂单会被一并重述到它；缺省取这张单自己的杠杆。 */
  leverage?: number;
  /** 此刻的现价（路的起点）；取不到时只把在 P 上已经穿价 / 触发的挂单算作持仓。 */
  markPrice?: number;
  /** 这条走法先到过的另一侧的价（见文件头「几种走法」）；缺省直接走过去。 */
  via?: number | null;
  /** 持仓限制模式；无限制时不预判（返回 null）。缺省按币安标准。 */
  mode?: PositionLimitMode | null;
}

/**
 * 一张挂着、触发 / 成交时会被再判的开仓单（recheckPrice），价格走到它的判定价 P 那一刻会不会被分层上限拒掉。
 * 判法与 settleFillDebit 相同，再加上「走过的路上会成交 / 触发的挂单」（见文件头）：持仓按 P 估值，
 * 走到 P 之前会成交的限价单、会触发的条件单算作 P 上的持仓，其余挂单按各自的估值价，这一单按 P，排除它自己；
 * 杠杆取 state.leverage，缺省取这张单自己的杠杆。不会被再判的单返回 null。
 */
export function restingTriggerCheck(
  symbol: string,
  order: PendingOrder,
  state: TriggerCheckState,
): TriggerCheckResult | null {
  const gate = recheckPrice(order, state.mode);
  if (!gate) return null;
  const { price, kind } = gate;
  const via = Number(state.via) > 0 ? Number(state.via) : null;
  return {
    ...checkOrderPositionLimit({
      symbol,
      settlement: limitSettlementOf(order),
      leverage: Number(state.leverage ?? order.leverage),
      positions: state.positions,
      orders: state.orders,
      markPrice: price,
      pathFrom: Number(state.markPrice) > 0 ? Number(state.markPrice) : undefined,
      pathVia: via ? [via] : undefined,
      excludeOrderIds: [order.id],
      orderNotionalUsd: getPositionNotionalUsd(symbol, order, price),
      orderPrice: price,
      side: order.side,
      mode: state.mode,
    }),
    price,
    kind,
    via,
  };
}

/**
 * 这张单到判定价 P 之前，价格可能先去过哪些价（「先到另一侧再折回来」的路标）：
 * 其余开仓挂单一碰就成交 / 触发的价（orderWaypointPrice），只取在现价另一侧的（同一侧的先后由价格决定，直接走就包含了）。
 * 现价或 P 取不到、P 恰好是现价时没有。
 */
export function triggerWaypoints(
  order: PendingOrder,
  orders: readonly PendingOrder[] | null | undefined,
  markPrice: number | undefined,
  mode?: PositionLimitMode | null,
): number[] {
  const gate = recheckPrice(order, mode);
  const mark = Number(markPrice);
  if (!gate || !(mark > 0)) return [];
  const direction = Math.sign(gate.price - mark);
  if (direction === 0) return [];
  const out = new Set<number>();
  for (const o of orders ?? []) {
    if (!o || o.id === order.id) continue;
    const w = orderWaypointPrice(o);
    if (w > 0 && Math.sign(w - mark) === -direction) out.add(w);
  }
  return [...out].sort((a, b) => Math.abs(a - mark) - Math.abs(b - mark));
}

/**
 * 这张单在每一种走法下的预判（先直接走，再逐个路标）。
 * 不会被再判的单返回空数组。
 */
export function restingTriggerScenarios(
  symbol: string,
  order: PendingOrder,
  state: Omit<TriggerCheckState, 'via'>,
  waypoints: readonly number[] = triggerWaypoints(order, state.orders, state.markPrice, state.mode),
): TriggerCheckResult[] {
  const out: TriggerCheckResult[] = [];
  for (const via of [null, ...waypoints]) {
    const r = restingTriggerCheck(symbol, order, { ...state, via });
    if (!r) return [];
    out.push(r);
  }
  return out;
}

/**
 * 委托列表的「触发时将超限」/「成交时将超限」：按此刻的持仓与挂单，价格从 markPrice 直接走过去、
 * 或先到另一侧某张开仓挂单的价再折回来（见文件头），这张单到时会被拒——返回第一种会被拒的走法。
 */
export function doomedAtTrigger(
  symbol: string,
  order: PendingOrder,
  positions: readonly Position[] | null | undefined,
  orders: readonly PendingOrder[] | null | undefined,
  markPrice?: number,
  /** 此刻的持仓限制模式；无限制时从不标（触发 / 成交时不再判）。缺省按币安标准。 */
  mode?: PositionLimitMode | null,
): TriggerCheckResult | null {
  if (isUnlimitedLimitMode(mode)) return null;
  return restingTriggerScenarios(symbol, order, { positions, orders, markPrice, mode }).find(r => !r.ok) ?? null;
}

/** 「触发价 0.9 上」「委托价 1.1 成交时」（价格先到 1.2 再回来时）——委托列表标记的悬停说明用。 */
export function triggerCheckLead(r: Pick<TriggerCheckResult, 'price' | 'kind' | 'via'>): string {
  const at = r.kind === 'limit' ? `委托价 ${formatPrice(r.price)} 成交时` : `触发价 ${formatPrice(r.price)} 上`;
  return r.via ? `价格先到 ${formatPrice(r.via)} 再回到${at}` : at;
}

export type PlacementDraft = PlacementOrderDraft & {
  side: OrderSide;
  leverage: number;
};

const DRAFT_ID = '__placement_draft__';
/** 每次预演的单子各带一个编号：两张预演单（加仓与补挂的对冲）放在一起判时，排除自己不能把另一张也排除掉。 */
let draftSeq = 0;

/**
 * 这一单下出去之后，引擎眼里的持仓与挂单会多出什么（给已挂触发单的预判用）：
 * 立即成交的（市价 / 最优价）算一笔持仓，其余算挂单（分段订单拆成各自带价的限价子单；
 * 已经穿价的限价单照样算挂单——敞口的口径会把它按现价估值、在任何「走到 P」的判定里算作持仓）。
 * 都带分层戳，只靠旧仓位对冲豁免放行的带豁免标记（legacy）。
 */
export function placementAftermath(
  draft: PlacementDraft,
  /** legacy：这一单只靠旧仓位对冲豁免放行（placementUsesLegacyHedge），带 'legacy-hedge-v1'、按旧模型开。 */
  opts: { markPrice: number; immediate: boolean; legacy?: boolean },
): { positions: Position[]; orders: PendingOrder[] } {
  const coin = isCoinSettled(draft);
  const qty = Number(draft.quantity) || 0;
  if (!(qty > 0)) return { positions: [], orders: [] };
  const tag = `${DRAFT_ID}:${++draftSeq}`;
  const common = {
    side: draft.side,
    leverage: draft.leverage,
    marginMode: 'isolated' as const,
    settlementMode: draft.settlementMode,
    contractSizeUsd: draft.contractSizeUsd,
    riskModel: opts.legacy ? LEGACY_HEDGE_RISK_MODEL : TIERED_RISK_MODEL,
  };
  if (opts.immediate) {
    const position = {
      ...common,
      id: `${tag}:position`,
      quantity: qty,
      contracts: coin ? qty : undefined,
      entryPrice: opts.markPrice,
      margin: 0,
      openTime: 0,
    } as Position;
    return { positions: [position], orders: [] };
  }
  const asOrder = (id: string, over: Partial<PendingOrder>) => ({
    ...common,
    id,
    type: draft.type,
    price: Number(draft.price) || 0,
    stopPrice: Number(draft.stopPrice) || 0,
    quantity: qty,
    contracts: coin ? qty : undefined,
    status: 'NEW',
    createdAt: 0,
    ...over,
  } as PendingOrder);
  if (draft.type === 'SCALED') {
    const children = scaledChildren(draft) ?? [];
    return {
      positions: [],
      orders: children.map((c, i) => asOrder(`${tag}:scaled:${i}`, {
        type: 'LIMIT', price: c.price, stopPrice: 0, quantity: c.quantity, contracts: c.contracts,
      })),
    };
  }
  return { positions: [], orders: [asOrder(`${tag}:order`, {})] };
}

export interface TriggerRisk {
  order: PendingOrder;
  /** 会被拒的那一种走法（via 为 null 是直接走过去）。 */
  check: TriggerCheckResult;
  /** 这张单就是这一步要下的单（added 里的），不是已挂的。 */
  added?: boolean;
}

/**
 * 这一步（下一单，或把杠杆改到 leverage）会不会让挂着的、触发 / 成交时会被再判的开仓单（recheckPrice）到时被拒。
 *
 * 币安不拦这一步——它在触发时才把单子送进撮合、才判上限——所以这里只预警，不拦：
 * 对每张已挂的这种单、每一种走法（restingTriggerScenarios：直接走到它的判定价，或先到另一侧某张挂单的价再折回来），
 * 逐种走法比，列出「这一步之前放得下、之后放不下」的单；这一步之前就已经放不下的走法，委托列表的「触发时将超限」会标出来
 * （直接走过去就已经放不下的单整张不再说；只在绕路时放不下的单，这一步把直接走的那一种也弄坏了照样说）。
 * 这一单立即成交的算持仓，其余算挂单；走过的路上会成交 / 触发的挂单（包括这一单）到时算作持仓。
 * 行情再变、别的单先开出来，到时的结果还会不同——这是预警，不是保证。
 *
 * added 里会被再判的单自己也要过：它们在「先到另一侧某张挂单的价再折回来」的走法下被拒，同样列出（added: true）；
 * 直接走过去的那一种是下单闸门的第二道（被拒就下不出去），只有 checkAdded 时才在这里一并判——
 * 加仓计算器先挂加仓、再补挂对冲，两张都是这一步的单，每一种走法都得放得下。
 */
export function newlyDoomedTriggerOrders(args: {
  symbol: string;
  positions: readonly Position[] | null | undefined;
  orders: readonly PendingOrder[] | null | undefined;
  added?: { positions: readonly Position[]; orders: readonly PendingOrder[] };
  /** 改杠杆：挂单会被一并重述到这个杠杆。 */
  leverage?: number;
  /** 此刻的现价（价格从这里走到各张单的判定价）。 */
  markPrice?: number;
  checkAdded?: boolean;
  /** 此刻的持仓限制模式；无限制时触发 / 成交那一刻不再判，没有什么会「注定被拒」。缺省按币安标准。 */
  mode?: PositionLimitMode | null;
}): TriggerRisk[] {
  if (isUnlimitedLimitMode(args.mode)) return [];
  const positions = args.positions ?? [];
  const orders = args.orders ?? [];
  const addedOrders = args.added?.orders ?? [];
  const before = { positions, orders, markPrice: args.markPrice };
  const after = {
    positions: [...positions, ...(args.added?.positions ?? [])],
    orders: [...orders, ...addedOrders],
    leverage: args.leverage,
    markPrice: args.markPrice,
  };
  const out: TriggerRisk[] = [];
  for (const order of orders) {
    if (!isTriggerRecheckedOrder(order)) continue;
    /**
     * 逐种走法比：这一步之前就放不下的走法不重复说。直接走过去这一步之前就已经放不下的单
     * （委托列表早就标着「将超限」，最常见的那条路已经走不通）整张不再说；
     * 只在「先到另一侧再折回来」下放不下的单，这一步若把直接走的那一种也弄坏了，照样要说。
     */
    if (!restingTriggerCheck(args.symbol, order, before)?.ok) continue;
    // 路标取这一步之后的挂单：这一单若在另一侧，「先到这一单的价再折回来」是它带来的新走法
    for (const via of [null, ...triggerWaypoints(order, after.orders, args.markPrice)]) {
      if (via != null && !restingTriggerCheck(args.symbol, order, { ...before, via })?.ok) continue;
      const check = restingTriggerCheck(args.symbol, order, { ...after, via });
      if (check && !check.ok) {
        out.push({ order, check });
        break;
      }
    }
  }
  for (const order of addedOrders) {
    if (!isTriggerRecheckedOrder(order)) continue;
    const waypoints = triggerWaypoints(order, after.orders, args.markPrice);
    for (const via of args.checkAdded ? [null, ...waypoints] : waypoints) {
      const check = restingTriggerCheck(args.symbol, order, { ...after, via });
      if (check && !check.ok) {
        out.push({ order, check, added: true });
        break;
      }
    }
  }
  return out;
}

const sideWord = (side: OrderSide) => (side === 'LONG' ? '做多' : '做空');

/** 「做多条件单 1.2」「做空跟踪委托（激活价 1.3）」「做空限价单 1.1」。 */
function triggerOrderLabel(order: PendingOrder, price: number): string {
  if (order.type === 'TRAILING_STOP') return `${sideWord(order.side)}跟踪委托（激活价 ${formatPrice(price)}）`;
  if (isRestingLimitOrder(order)) return `${sideWord(order.side)}${order.type === 'POST_ONLY' ? '只做Maker单' : '限价单'} ${formatPrice(price)}`;
  return `${sideWord(order.side)}条件单 ${formatPrice(price)}`;
}

/** 一条预警里这张单的称呼：先到另一侧再折回来的走法写在后面（已经在括号里时用逗号接）。 */
function riskLabel(r: TriggerRisk, inParens = false): string {
  const label = triggerOrderLabel(r.order, r.check.price);
  if (!r.check.via) return label;
  const via = `价格先到 ${formatPrice(r.check.via)} 再回来时`;
  return inParens ? `${label}，${via}` : `${label}（${via}）`;
}

/** 一组预警是在触发时、成交时，还是两种都有。 */
function whenWord(risks: readonly TriggerRisk[]): string {
  const limits = risks.filter(r => r.check.kind === 'limit').length;
  if (limits === 0) return '触发时';
  return limits === risks.length ? '成交时' : '触发 / 成交时';
}

/**
 * 预警的文案。lead 是这一步：「这张单下出去后」「杠杆调到 25x 后」。
 * 标题照实说哪几张单会在触发 / 成交时被拒（先到另一侧再折回来的走法注明是哪个价）；
 * 说明里摆出每张的加法，并说清这一步不拦、到时那张单会被撤销。
 */
export function triggerRiskMessage(
  risks: readonly TriggerRisk[],
  lead: string,
): { title: string; description: string } | null {
  if (risks.length === 0) return null;
  const resting = risks.filter(r => !r.added);
  const own = risks.filter(r => r.added);
  const parts: string[] = [];
  if (resting.length > 0) {
    const list = resting.map(r => riskLabel(r)).join('、');
    parts.push(`已挂的${list}${/\d$/.test(list) ? ' ' : ''}${whenWord(resting)}会因超出当前杠杆最高可持有头寸被拒`);
  }
  if (own.length > 0) {
    parts.push(`这张单自己（${own.map(r => riskLabel(r, true)).join('；')}）${whenWord(own)}也会因超出当前杠杆最高可持有头寸被拒`);
  }
  const title = `${lead}，${parts.join('；')}`;
  const lines = risks.map(r => `${riskLabel(r)}：按${r.check.kind === 'limit' ? '委托价' : '触发价'}估值，${positionLimitDetail(r.check)}，`
    + `超过 ${r.check.leverage}x 最高 ${fmt(r.check.cap, r.check.unit)}`);
  const closing = risks.some(r => r.check.kind === 'trigger')
    ? '币安不在这一步拦，触发时才判——到时那张单会被撤销。'
    : '这一步不拦；靠对冲豁免挂出的限价单成交时才再判——到时那张单会被撤销。';
  const description = `${lines.join('；')}。${closing}还要靠它保护的话，现在就减量重挂、撤掉它，或先减仓。`;
  return { title, description };
}
