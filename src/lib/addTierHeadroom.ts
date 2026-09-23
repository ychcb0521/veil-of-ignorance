/**
 * 加仓计算器的第二道上限：币安分层（-2027「当前杠杆倍数最高可持有头寸」）。
 *
 * Plan B 只看垫子够不够；可这一单下出去还要过分层——同一个合约的持仓（多空相加）+ 当前委托 + 这一单，
 * 不得超过当前杠杆的上限。垫子再厚，超过分层的那部分引擎也下不出去；按 Plan B 上限预填一张注定被拒的单，
 * 等于让人在面板前对着一条拒单提示重算。所以计算器给出的可下单量 = min(Plan B 上限, 分层余量)。
 *
 * 单看这一单的余量（alone）与下单面板的「可开」是同一个数：checkPlacementPositionLimit + placementSizingRemainingUsd
 * （含多空相加、非只减仓挂单、第二道——条件单按触发价、挂着的限价单按成交那一刻的委托价——、
 * 估值随标记价浮动时的 0.2% 余量、更新前仓位的对冲豁免；已经穿价的限价加仓按现价估值、当作立即成交）。
 *
 * **计划自己的对冲也占同一个上限**：Plan B 的锁死靠 S₁ 上那张反向条件单（合计对冲 X₁ + X₂），
 * 它是非只减仓的开仓委托，与加仓共用这张合约的上限。只按加仓算余量，按上限下完之后对冲就挂不上了
 * （KAITOUSDT 15x：多 10,000 之后按余量再加 39,900，S₁ = 0.9 上连 X₁ 的对冲都被拒）。
 * 给了 hedge 时，可下单量取「加仓 + 要补挂的对冲都放得下」的最大值（二分，逐点走同一个判定）：
 *   · 加仓这一单过 checkPlacementPositionLimit（与面板同一个判定、同样的余量）；
 *   · 加仓下出去之后，要补挂的对冲（X₁ + X₂ − 已挂在 S₁ 上 / 已成交的对冲）作为 S₁ 上的条件单，
 *     按现价、按触发价两道都过（现价那一道同样留余量）。触发价那一道按「价格从现价走到 S₁」算：
 *     回调加仓的限价单、落在这段路上的加仓条件单到 S₁ 时已是按 S₁ 估值的持仓，不是还挂在 S₂ 上的委托；
 *   · 加仓若是挂着的限价单，补挂对冲之后它在 S₂ 成交那一刻（第二道）仍放得下——S₁ 在路上时对冲那时已是持仓；
 *   · 计划的两张单**谁先到都算**（positionLimit 文件头「几种走法」）：S₂ 与 S₁ 在现价两侧时（突破加仓在上、止损对冲在下），
 *     「先突破、加仓成交，再跌回 S₁」对冲要放得下，「先跌到 S₁、对冲成交，再涨到 S₂」加仓也要放得下；
 *     同一侧时先后由价格决定，直接走就包含了。已挂的、触发 / 成交时会被再判的单也按同样的几种走法，不能被这两张单弄得注定被拒
 *     （newlyDoomedTriggerOrders，checkAdded）。
 * 连不加仓时的对冲都放不下（blocked），可下单量为 0，并给出对冲这一侧还剩多少。
 *
 * 折成计算器的币数：
 *   U 本位 → 引擎按估值价（市价 = 成交基准价，限价 = 挂单价、已经穿价的按现价，条件单 = 触发价）给这一单估值，币数 = 余量 ÷ 估值价；
 *   币本位 → 余量 ÷ 面值 向下取整成张，再按预计成交价 S₂′ 折币（计算器的币数都在 S₂′ 上）；
 *            对冲按 S₁ 折张（向上取整：对冲只能多盖不能少盖）。
 *
 * 只管「可下单量」：计划快照（addCoinsMax）仍是 Plan B 的上限，成交后复判与 Legs 校验照旧只判 Plan B。
 */
import type { OrderSide, OrderType, PendingOrder, Position, SettlementMode } from '@/types/trading';
import {
  LIVE_PRICE_TIER_HEADROOM,
  checkPlacementPositionLimit,
  effectiveSymbolLeverage,
  isMarketableLimitPrice,
  limitSettlementOf,
  newlyDoomedTriggerOrders,
  orderWaypointPrice,
  placementAftermath,
  placementCheckPrice,
  placementFloatsWithMark,
  placementSizingRemainingUsd,
  placementUsesLegacyHedge,
  type PlacementDraft,
  type PlacementLimitResult,
} from '@/lib/positionLimit';
import { isPositionOpen } from '@/lib/tradingSettlement';

/** 计划里的对冲：S₁ 上一张反向条件单，合计盖住 X₁ + X₂。 */
export interface AddTierHedge {
  /** 止损线 S₁：对冲条件单的触发价（已按面板精度取整后的那个）。 */
  price: number;
  /** X₁：对冲要盖住的现有主仓币数。 */
  mainCoins: number;
  /** 已经挂在 S₁ 上、或已经成交的反向对冲币数：只需补上差额。 */
  existingCoins: number;
}

export interface AddTierHeadroomInput {
  symbol: string;
  settlement: SettlementMode;
  side: OrderSide;
  /** 保存的杠杆（leverageMap 的原值）；按 settlement 夹到这张合约的上限后使用。 */
  storedLeverage: number | null | undefined;
  positions: readonly Position[] | null | undefined;
  orders: readonly PendingOrder[] | null | undefined;
  /** 引擎成交的基准价：持仓按它估值，市价单也按它。 */
  markPrice: number;
  orderKind: 'market' | 'limit' | 'conditional';
  /** 限价 = 挂单价，条件单 = 触发价（都已按面板精度取整）；市价不用。 */
  orderPrice: number;
  /** 预计成交价 S₂′：币本位的整张按它折回币。 */
  fillPrice: number;
  /** 币本位一张的面值（USD）；U 本位为 null。 */
  contractFaceUsd: number | null;
  /** 计划的对冲；不给（还没有 S₁）就只看加仓这一单。 */
  hedge?: AddTierHedge | null;
}

export interface AddTierHedgeRoom {
  price: number;
  /** 按可下单量要补挂的对冲（X₁ + X₂ − 已有），币数（币本位按整张 × 面值 ÷ S₁）。 */
  coins: number;
  /** 币本位：要补挂的对冲整张数；U 本位为 null。 */
  contracts: number | null;
  /** 对冲一起算进来之后，可下单量比单看这一单的余量小。 */
  binds: boolean;
  /** 连不加仓时要补挂的对冲（X₁ − 已有）都放不下：可下单量为 0。 */
  blocked: boolean;
  /** 不加仓时，S₁ 上的对冲这一侧按分层还能挂多少（币，按 S₁ 折）。 */
  roomCoins: number;
}

export interface AddTierHeadroom {
  /** 实际生效的杠杆（保存值夹到这张合约的上限）。 */
  leverage: number;
  /** 分层还允许这一侧再开的币数（U 本位按估值价，币本位按整张 × 面值 ÷ S₂′）；给了对冲时已给它留出位置。 */
  coins: number;
  /** 币本位：分层允许的整张数（向下取整）；U 本位为 null。 */
  contracts: number | null;
  /** 可下单量的 USD 名义。 */
  usd: number;
  /** 单看这一单的余量：与下单面板「可开」同一个数。 */
  alone: { coins: number; contracts: number | null; usd: number };
  /** 计划的对冲在分层里的情形；没给对冲时为 null。 */
  hedge: AddTierHedgeRoom | null;
  /** 下单面板同一个判定的结果（单位、上限、现有敞口……）。 */
  limit: PlacementLimitResult;
}

/** 下单面板的「可开」口径：判定通过，且按现价估值会漂时离上限留出余量（与 sizingRemainingOpenUsd 同一个量）。 */
function fitsWithHeadroom(r: PlacementLimitResult, floats: boolean): boolean {
  if (!r.ok) return false;
  const m = r.atMark;
  if (m.reason !== 'ok' || !floats) return true;
  return m.exposureAfter <= m.cap * (1 - LIVE_PRICE_TIER_HEADROOM) * (1 + 1e-12);
}

const ORDER_TYPE: Record<AddTierHeadroomInput['orderKind'], OrderType> = {
  market: 'MARKET',
  limit: 'LIMIT',
  conditional: 'CONDITIONAL',
};

/** 算不出（没有价、没有估值价）时返回 null：只受 Plan B 约束，不另设限。 */
export function addTierHeadroom(input: AddTierHeadroomInput): AddTierHeadroom | null {
  const { symbol, side, orderKind, contractFaceUsd } = input;
  const markPrice = Number(input.markPrice);
  if (!(markPrice > 0)) return null;
  const coin = input.settlement === 'coin';
  const settlement = limitSettlementOf({ settlementMode: input.settlement });
  const leverage = effectiveSymbolLeverage(input.storedLeverage, symbol, settlement);
  const addPx = orderKind === 'market' ? markPrice : Number(input.orderPrice);
  if (!(addPx > 0)) return null;
  /** 已经穿价的限价加仓（买价 ≥ 现价、卖价 ≤ 现价）下一根就成交：按现价估值，当作立即成交。 */
  const immediate = orderKind === 'market' || (orderKind === 'limit' && isMarketableLimitPrice(side, addPx, markPrice));
  const valuationPrice = immediate ? markPrice : addPx;
  const positions = input.positions ?? [];
  const orders = input.orders ?? [];
  const face = Number(contractFaceUsd);
  const fill = Number(input.fillPrice);
  if (coin && (!(face > 0) || !(fill > 0))) return null;

  const draft = (type: OrderType, orderSide: OrderSide, units: number, price: number): PlacementDraft => ({
    type,
    side: orderSide,
    leverage,
    quantity: units,
    contracts: coin ? units : undefined,
    contractSizeUsd: coin ? face : undefined,
    settlementMode: input.settlement,
    price: type === 'LIMIT' ? price : 0,
    stopPrice: type === 'CONDITIONAL' ? price : 0,
  });
  const addDraft = (units: number) => draft(ORDER_TYPE[orderKind], side, units, addPx);
  /** 第二道：条件单 = 触发价，挂着的限价单 = 委托价（成交那一刻），市价 / 已经穿价的没有。 */
  const gate = placementCheckPrice(addDraft(1), markPrice, orderKind === 'market');
  const placement = (orderUsd: number, extraOrders: readonly PendingOrder[] = [], via: number | null = null) => checkPlacementPositionLimit({
    symbol,
    settlement,
    leverage,
    positions,
    orders: extraOrders.length > 0 ? [...orders, ...extraOrders] : orders,
    markPrice,
    orderNotionalUsd: orderUsd,
    orderPrice: valuationPrice,
    side,
    // 第二道：余量取两道里较小的那个
    triggerPrice: gate.price,
    triggerKind: gate.kind,
    pathVia: via ? [via] : undefined,
  });
  const limit = placement(0);
  const hasOpenPositions = positions.some(p => p && isPositionOpen(p) && limitSettlementOf(p) === settlement);
  const addFloats = placementFloatsWithMark({ draft: addDraft(1), atMarket: immediate, markPrice, orders });
  const aloneUsd = placementSizingRemainingUsd(limit, markPrice, { orderAtMarket: addFloats, hasOpenPositions });
  if (!Number.isFinite(aloneUsd)) return null;

  /** 加仓的量：币本位是整张，U 本位是币。 */
  const aloneUnits = coin ? Math.max(0, Math.floor(aloneUsd / face + 1e-9)) : Math.max(0, aloneUsd / valuationPrice);
  const unitsToCoins = (units: number) => (coin ? (units * face) / fill : units);
  const unitsToUsd = (units: number) => (coin ? units * face : units * valuationPrice);
  const alone = { coins: unitsToCoins(aloneUnits), contracts: coin ? aloneUnits : null, usd: aloneUsd };
  const result = (units: number, hedge: AddTierHedgeRoom | null): AddTierHeadroom => ({
    leverage,
    coins: unitsToCoins(units),
    contracts: coin ? units : null,
    usd: units === aloneUnits ? aloneUsd : unitsToUsd(units),
    alone,
    hedge,
    limit,
  });

  const hedgeIn = input.hedge;
  const hedgePx = Number(hedgeIn?.price);
  const mainCoins = Number(hedgeIn?.mainCoins);
  if (!hedgeIn || !(hedgePx > 0) || !Number.isFinite(mainCoins)) return result(aloneUnits, null);
  const existingCoins = Math.max(0, Number(hedgeIn.existingCoins) || 0);

  const hedgeSide: OrderSide = side === 'LONG' ? 'SHORT' : 'LONG';
  const measureFloats = limit.tiers.measure !== 'usd-face';
  /** 对冲的量：币本位按 S₁ 折整张、向上取整；U 本位是币。 */
  const hedgeUnitsFor = (addUnits: number) => {
    const need = mainCoins + unitsToCoins(addUnits) - existingCoins;
    if (!(need > 1e-12)) return 0;
    return coin ? Math.ceil((need * hedgePx) / face - 1e-9) : need;
  };
  const hedgeDraft = (units: number) => draft('CONDITIONAL', hedgeSide, units, hedgePx);
  const empty = { positions: [] as Position[], orders: [] as PendingOrder[] };

  /**
   * 挂着的限价加仓在 S₂ 成交之前，价格可能先到过的另一侧的价（挂单与补挂的对冲一碰就成交 / 触发的价）：
   * 与触发单的「几种走法」同一个口径（positionLimit.triggerWaypoints）。
   */
  const limitAddWaypoints = (all: readonly PendingOrder[]): number[] => {
    const direction = Math.sign(addPx - markPrice);
    if (direction === 0) return [];
    return [...new Set(all.map(orderWaypointPrice).filter(w => w > 0 && Math.sign(w - markPrice) === -direction))];
  };

  /**
   * 加 units、再补挂对冲之后，计划里的两张单（以及已挂的、触发 / 成交时会被再判的单）在每一种先后下都放得下：
   *   · 加仓这一单、要补挂的对冲，下单时两道都过（现价那一道留余量）；对冲的第二道按「价格从现价直接走到 S₁」——
   *     回调加仓的限价单、落在路上的加仓条件单到那时已是按 S₁ 估值的持仓；
   *   · 挂着的限价加仓：补挂对冲之后，它在 S₂ 成交那一刻仍放得下——直接走过去（S₁ 在路上时对冲已是持仓），
   *     S₁ 在现价另一侧时再判「先到 S₁、对冲成交之后再折回 S₂」；
   *   · 触发 / 成交时会被再判的单（加仓条件单、对冲、已挂的这种单）每一种走法都放得下（newlyDoomedTriggerOrders，checkAdded）：
   *     突破加仓在上、对冲在下时，「先突破、加仓成交，再跌回 S₁」对冲要放得下，「先跌到 S₁、对冲成交，再涨到 S₂」加仓也要放得下。
   */
  const feasible = (units: number): boolean => {
    const add = placement(unitsToUsd(units));
    if (!fitsWithHeadroom(add, measureFloats && (addFloats || hasOpenPositions))) return false;
    const added = units > 0
      ? placementAftermath(addDraft(units), { markPrice, immediate, legacy: placementUsesLegacyHedge(add) })
      : empty;
    const hedgeUnits = hedgeUnitsFor(units);
    let hedgeOrders: PendingOrder[] = [];
    if (hedgeUnits > 0) {
      const withAdd = { positions: [...positions, ...added.positions], orders: [...orders, ...added.orders] };
      const hedgeCheck = checkPlacementPositionLimit({
        symbol,
        settlement,
        leverage,
        ...withAdd,
        markPrice,
        orderNotionalUsd: coin ? hedgeUnits * face : hedgeUnits * hedgePx,
        orderPrice: hedgePx,
        side: hedgeSide,
        // 从现价走到 S₁：路上成交 / 触发的加仓到那时已是持仓（checkPlacementPositionLimit 的第二道）
        triggerPrice: hedgePx,
        triggerKind: 'trigger',
      });
      const hedgeFloats = placementFloatsWithMark({ draft: hedgeDraft(hedgeUnits), atMarket: false, markPrice, orders: withAdd.orders });
      if (!fitsWithHeadroom(hedgeCheck, measureFloats && (hasOpenPositions || added.positions.length > 0 || hedgeFloats))) return false;
      hedgeOrders = placementAftermath(hedgeDraft(hedgeUnits), {
        markPrice, immediate: false, legacy: placementUsesLegacyHedge(hedgeCheck),
      }).orders;
    }
    // 挂着的限价加仓：补挂对冲之后，它在 S₂ 成交那一刻（第二道）每一种走法都放得下
    if (units > 0 && added.orders.length > 0 && gate.kind === 'limit') {
      for (const via of [null, ...limitAddWaypoints([...orders, ...hedgeOrders])]) {
        if (!placement(unitsToUsd(units), hedgeOrders, via).ok) return false;
      }
    }
    if (added.positions.length === 0 && added.orders.length === 0 && hedgeOrders.length === 0) return true;
    return newlyDoomedTriggerOrders({
      symbol,
      positions,
      orders,
      added: { positions: added.positions, orders: [...added.orders, ...hedgeOrders] },
      markPrice,
      // 突破加仓与补挂的对冲自己触发时也要放得下（另一张先成交的走法也算）
      checkAdded: true,
    }).length === 0;
  };

  /** 不加仓时，对冲这一侧还能挂多少（面板对 S₁ 上那张条件单给出的「可开」）。 */
  const hedgeRoomCoins = (): number => {
    const r = checkPlacementPositionLimit({
      symbol, settlement, leverage, positions, orders, markPrice,
      orderNotionalUsd: 0, orderPrice: hedgePx, side: hedgeSide, triggerPrice: hedgePx, triggerKind: 'trigger',
    });
    const hedgeFloats = placementFloatsWithMark({ draft: hedgeDraft(1), atMarket: false, markPrice, orders });
    const usd = placementSizingRemainingUsd(r, markPrice, { orderAtMarket: hedgeFloats, hasOpenPositions });
    if (!Number.isFinite(usd)) return Infinity;
    return coin ? (Math.floor(usd / face + 1e-9) * face) / hedgePx : usd / hedgePx;
  };
  const hedgeRoom = (units: number, binds: boolean, blocked: boolean): AddTierHedgeRoom => {
    const hedgeUnits = hedgeUnitsFor(units);
    return {
      price: hedgePx,
      coins: coin ? (hedgeUnits * face) / hedgePx : hedgeUnits,
      contracts: coin ? hedgeUnits : null,
      binds,
      blocked,
      roomCoins: hedgeRoomCoins(),
    };
  };

  if (feasible(aloneUnits)) return result(aloneUnits, hedgeRoom(aloneUnits, false, false));
  // 单看这一单就已经没有余量时，卡住的是加仓这一侧，不算对冲挂不下
  if (!feasible(0)) return result(0, hedgeRoom(0, aloneUnits > 0, aloneUnits > 0));
  // feasible(lo) 恒真、feasible(hi) 恒假；更多的加仓只会让两张单更难放下（单调），二分找最大可行量
  let lo = 0;
  let hi = aloneUnits;
  if (coin) {
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (feasible(mid)) lo = mid; else hi = mid;
    }
  } else {
    for (let i = 0; i < 80 && hi - lo > Math.max(1e-12, hi * 1e-10); i++) {
      const mid = (lo + hi) / 2;
      if (feasible(mid)) lo = mid; else hi = mid;
    }
  }
  return result(lo, hedgeRoom(lo, true, false));
}
