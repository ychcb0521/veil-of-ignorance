import {
  calcFee,
  calcSlippage,
  calcUnrealizedPnl,
  MAINTENANCE_MARGIN_RATE,
  MAKER_FEE,
  TAKER_FEE,
  type MarginMode,
  type OrderSide,
  type Position,
  type PositionFill,
  type SettlementMode,
  type TradeRecord,
} from "@/types/trading";
import {
  coinAmountToUsd,
  coinFeeAmount,
  coinMarginAmount,
  coinNotionalUsd,
  coinPnlAmount,
  getCoinContractSizeUsd,
  getCoinContracts,
  getSettlementAsset,
  roundCoinContracts,
} from "@/lib/coinMargined";

export const POSITION_DUST_EPSILON = 1e-6;

type SettlementInstrument = {
  settlementMode?: SettlementMode | null;
  settlementAsset?: string | null;
  contractSizeUsd?: number | null;
  contracts?: number | null;
  quantity?: number | null;
};

export type SettlementOrderLike = SettlementInstrument & {
  side: OrderSide;
  quantity: number;
  leverage: number;
  marginMode: MarginMode;
};

export function isCoinSettled(item?: { settlementMode?: SettlementMode | null } | null): boolean {
  return item?.settlementMode === "coin";
}

export function normalizeSettlementOrder<T extends SettlementOrderLike>(symbol: string, order: T): T {
  if (!isCoinSettled(order)) {
    return {
      ...order,
      settlementMode: "usdt",
      settlementAsset: "USDT",
      contractSizeUsd: undefined,
      contracts: undefined,
    } as T;
  }

  const contractSizeUsd = getCoinContractSizeUsd(symbol, order);
  const contracts = roundCoinContracts(Number(order.contracts ?? order.quantity));
  return {
    ...order,
    settlementMode: "coin",
    settlementAsset: order.settlementAsset ?? getSettlementAsset(symbol),
    contractSizeUsd,
    contracts,
    quantity: contracts,
  } as T;
}

export function getPositionUnits(item?: SettlementInstrument | null): number {
  if (!item) return 0;
  return isCoinSettled(item) ? getCoinContracts(item) : Number(item.quantity ?? 0);
}

export function isPositionOpen(item?: SettlementInstrument | null): boolean {
  return getPositionUnits(item) > POSITION_DUST_EPSILON;
}

export function getPositionNotionalUsd(
  symbol: string,
  item: SettlementInstrument & { entryPrice?: number | null },
  price?: number,
): number {
  if (isCoinSettled(item)) {
    return coinNotionalUsd(getCoinContracts(item), getCoinContractSizeUsd(symbol, item));
  }
  const px = Number(price ?? item.entryPrice ?? 0);
  return Number(item.quantity ?? 0) * px;
}

/**
 * ROE% = 未实现盈亏(USD) / 初始保证金(USD)。
 * 初始保证金 = 名义价值@开仓 / 杠杆（固定不变、不含追加保证金），U本位与币本位统一同一口径。
 */
export function settlementRoePct(pnlUsd: number, initialMarginUsd: number): number {
  return initialMarginUsd > 0 ? (pnlUsd / initialMarginUsd) * 100 : 0;
}

/**
 * 结算口径下的保证金比率% = 维持保证金 / 保证金余额（与币安一致：亏损越大越逼近 100% = 爆仓）。
 * 维持保证金 = 标记价名义价值 × 维持保证金率（notionalUsdAtMark 对 U本位/币本位都是 USD 名义）。
 * 保证金余额 = 按标记价估值的保证金 + 未实现盈亏(USD)；币本位的保证金需先按现价折算（与 ROE 同口径）。
 * 余额 ≤ 0 视为已触及强平，返回 100。
 */
export function settlementMarginRatioPct(
  notionalUsdAtMark: number,
  marginUsdValuedAtMark: number,
  pnlUsd: number,
): number {
  const marginBalance = marginUsdValuedAtMark + pnlUsd;
  return marginBalance > 0 ? (notionalUsdAtMark * MAINTENANCE_MARGIN_RATE / marginBalance) * 100 : 100;
}

export function getSettlementMarginParts(symbol: string, order: SettlementOrderLike, price: number) {
  if (isCoinSettled(order)) {
    const contracts = getCoinContracts(order);
    const contractSizeUsd = getCoinContractSizeUsd(symbol, order);
    const marginCoin = coinMarginAmount(contracts, price, order.leverage, contractSizeUsd);
    return { marginUsd: coinAmountToUsd(marginCoin, price), marginCoin };
  }
  return { marginUsd: (order.quantity * price) / order.leverage, marginCoin: undefined };
}

export function getSettlementFeeParts(
  symbol: string,
  item: SettlementOrderLike | Position,
  price: number,
  isMaker: boolean,
) {
  if (isCoinSettled(item)) {
    const feeRate = isMaker ? MAKER_FEE : TAKER_FEE;
    const feeCoin = coinFeeAmount(
      getCoinContracts(item),
      price,
      feeRate,
      getCoinContractSizeUsd(symbol, item),
    );
    return { feeUsd: coinAmountToUsd(feeCoin, price), feeCoin };
  }
  return { feeUsd: calcFee(price, Number(item.quantity ?? 0), isMaker), feeCoin: undefined };
}

export function applySettlementSlippage(
  symbol: string,
  price: number,
  order: SettlementOrderLike,
  isMaker: boolean,
) {
  if (isMaker) return { fillPrice: price, slippageUsd: 0 };

  const notionalUsd = getPositionNotionalUsd(symbol, order, price);
  const fillPrice = calcSlippage(price, notionalUsd, order.side);
  if (isCoinSettled(order)) {
    const slipCoin = Math.abs(
      coinPnlAmount(
        order.side,
        getCoinContracts(order),
        price,
        fillPrice,
        getCoinContractSizeUsd(symbol, order),
      ),
    );
    return { fillPrice, slippageUsd: coinAmountToUsd(slipCoin, fillPrice) };
  }
  return { fillPrice, slippageUsd: Math.abs(fillPrice - price) * order.quantity };
}

export function executeSettlementFill(
  symbol: string,
  rawPrice: number,
  order: SettlementOrderLike,
  isMaker: boolean,
  openTime = 0,
) {
  const normalized = normalizeSettlementOrder(symbol, order);
  const { fillPrice, slippageUsd } = applySettlementSlippage(symbol, rawPrice, normalized, isMaker);
  const { feeUsd, feeCoin } = getSettlementFeeParts(symbol, normalized, fillPrice, isMaker);
  const { marginUsd, marginCoin } = getSettlementMarginParts(symbol, normalized, fillPrice);

  const position: Position = {
    id: crypto.randomUUID(),
    side: normalized.side,
    entryPrice: fillPrice,
    quantity: normalized.quantity,
    leverage: normalized.leverage,
    // 开仓杠杆快照：leverage 会被「调整杠杆」改写，这个不会。
    openLeverage: normalized.leverage,
    marginMode: normalized.marginMode,
    settlementMode: normalized.settlementMode ?? "usdt",
    settlementAsset: normalized.settlementAsset ?? "USDT",
    contractSizeUsd: normalized.contractSizeUsd ?? undefined,
    contracts: normalized.contracts ?? undefined,
    margin: marginUsd,
    marginCoin,
    isolatedMargin: normalized.marginMode === "isolated" ? marginUsd : undefined,
    openTime,
  };

  return { fee: feeUsd, feeCoin, margin: marginUsd, marginCoin, slippage: slippageUsd, position };
}

export function closeSettlementPosition(
  symbol: string,
  pos: Position,
  rawPrice: number,
  closeUnits: number,
  isMaker: boolean,
) {
  const orderLike = normalizeSettlementOrder(symbol, {
    ...pos,
    quantity: closeUnits,
    contracts: isCoinSettled(pos) ? closeUnits : undefined,
  });
  const closeSide: OrderSide = pos.side === "LONG" ? "SHORT" : "LONG";
  const closeOrder = { ...orderLike, side: closeSide };
  const { fillPrice, slippageUsd } = applySettlementSlippage(symbol, rawPrice, closeOrder, isMaker);
  const { feeUsd, feeCoin } = getSettlementFeeParts(symbol, closeOrder, fillPrice, isMaker);

  if (isCoinSettled(pos)) {
    const pnlCoin = coinPnlAmount(
      pos.side,
      getCoinContracts(orderLike),
      pos.entryPrice,
      fillPrice,
      getCoinContractSizeUsd(symbol, pos),
    );
    return {
      fillPrice,
      slippageUsd,
      pnlUsd: coinAmountToUsd(pnlCoin, fillPrice),
      pnlCoin,
      feeUsd,
      feeCoin,
      notionalUsd: getPositionNotionalUsd(symbol, orderLike, fillPrice),
    };
  }

  return {
    fillPrice,
    slippageUsd,
    pnlUsd: calcUnrealizedPnl({ ...pos, quantity: closeUnits }, fillPrice),
    pnlCoin: undefined,
    feeUsd,
    feeCoin,
    notionalUsd: getPositionNotionalUsd(symbol, orderLike, fillPrice),
  };
}

export interface SettledPositionClose {
  closeQty: number;
  pct: number;
  remainingUnits: number;
  willFullyClose: boolean;
  returnedMargin: number;
  /**
   * 每笔成交各一条。**刻意不保留 record 这个单数字段**——留一个别名会让旧调用点
   * 继续编译通过,却静默丢掉加仓那一片的钱,正是这次要修的那种失败方式。
   * 长度恒 ≥ 1;没有 fills 或只有一笔时恒为 1 条,与改动前逐字节相同。
   */
  records: TradeRecord[];
  fillPrice: number;
  netPnl: number;
}

export function settlePositionClose(
  symbol: string,
  pos: Position,
  rawPrice: number,
  closeUnits: number,
  closeTime: number,
  exitMethod: NonNullable<TradeRecord["exit_method"]> = "manual",
  closedRealAt = Date.now(),
): SettledPositionClose | null {
  const totalUnits = getPositionUnits(pos);
  if (totalUnits <= POSITION_DUST_EPSILON) return null;
  if (!Number.isFinite(rawPrice) || rawPrice <= 0 || !Number.isFinite(closeUnits)) return null;

  const boundedCloseUnits = Math.min(totalUnits, Math.max(0, closeUnits));
  const closeQty = isCoinSettled(pos)
    ? Math.min(totalUnits, Math.max(1, Math.round(boundedCloseUnits)))
    : boundedCloseUnits;
  if (closeQty <= POSITION_DUST_EPSILON) return null;

  const pct = totalUnits > 0 ? closeQty / totalUnits : 1;
  const remainingUnits = totalUnits - closeQty;
  const willFullyClose = pct >= 1 || remainingUnits <= POSITION_DUST_EPSILON;
  const {
    fillPrice,
    slippageUsd,
    pnlUsd,
    pnlCoin,
    feeUsd,
    feeCoin,
    notionalUsd,
  } = closeSettlementPosition(symbol, pos, rawPrice, closeQty, false);

  const closedMargin = pos.margin * pct;
  const closedIsoMargin = pos.isolatedMargin != null ? pos.isolatedMargin * pct : undefined;
  const returnedMargin = pos.marginMode === "isolated" && closedIsoMargin != null
    ? closedIsoMargin + pnlUsd - feeUsd
    : closedMargin + pnlUsd - feeUsd;
  const netPnl = pnlUsd - feeUsd;

  return {
    closeQty,
    pct,
    remainingUnits,
    willFullyClose,
    returnedMargin,
    fillPrice,
    netPnl,
    records: buildCloseRecords({
      symbol, pos, closeQty, fillPrice, closeTime, exitMethod, closedRealAt,
      totals: { netPnl, pnlCoin, feeUsd, feeCoin, slippageUsd, notionalUsd },
    }),
  };
}

export interface CloseRecordTotals {
  netPnl: number;
  pnlCoin?: number;
  feeUsd: number;
  feeCoin?: number;
  slippageUsd: number;
  notionalUsd: number;
}

/**
 * 把**一次**平仓拆成**每笔成交各一条**记录。
 *
 * 为什么必须拆:同向成交会合并成一个仓位(引擎层是对的,加仓不该被自己的强平价
 * 单独打掉),但平仓只写一条记录的话,这个应用又没有开仓记录——
 * 回填出来的腿全靠平仓记录,于是加仓在战役里**整条消失**,
 * 主力还顶着一个混合开仓价(实盘 ENJUSDT:主力与镜像同一秒开出,
 * 开仓价却差 9.4%,0.112420 vs 0.102754)。
 *
 * 三条铁律:
 *
 * 1. **纯后处理算术,绝不按笔重跑结算。** calcSlippage 的滑点率含
 *    `名义/5e9` 一项,按笔重跑会让每片拿到更小的名义、更好的成交价,
 *    各片之和就不再等于整笔——那不是浮点误差,是真金白银的差额。
 * 2. **按 units 占比分,不按盈亏占比分。** 手续费与滑点在固定成交价下都是
 *    units 的线性函数,按 units 分才能保证 Σ 严格等于整笔。
 * 3. **保证金与余额一分都不进记录。** returnedMargin 留在结果上、只入账一次;
 *    这是「不可能重复入账」的结构性保证。
 */
export function buildCloseRecords(input: {
  symbol: string;
  pos: Position;
  closeQty: number;
  fillPrice: number;
  closeTime: number;
  exitMethod?: TradeRecord["exit_method"];
  closedRealAt?: number;
  totals: CloseRecordTotals;
}): TradeRecord[] {
  const { symbol, pos, closeQty, fillPrice, closeTime, exitMethod, closedRealAt, totals } = input;
  const coin = isCoinSettled(pos);

  const base = (over: Partial<TradeRecord>): TradeRecord => ({
    id: crypto.randomUUID(),
    positionId: pos.id,
    fillId: pos.id,
    symbol,
    side: pos.side,
    type: "MARKET",
    action: "CLOSE",
    entryPrice: pos.entryPrice,
    exitPrice: fillPrice,
    quantity: closeQty,
    contracts: coin ? closeQty : undefined,
    leverage: pos.openLeverage ?? pos.leverage,
    pnl: totals.netPnl,
    pnlCoin: totals.pnlCoin,
    feeCoin: totals.feeCoin,
    fee: totals.feeUsd,
    slippage: totals.slippageUsd,
    notionalUsd: totals.notionalUsd,
    settlementMode: pos.settlementMode,
    settlementAsset: pos.settlementAsset,
    contractSizeUsd: pos.contractSizeUsd,
    openTime: pos.openTime || 0,
    closeTime,
    exit_method: exitMethod,
    closedRealAt,
    ...over,
  } as TradeRecord);

  const fills = (pos.fills ?? []).filter(f => Number.isFinite(f.units) && f.units > 0);
  const totalUnits = fills.reduce((sum, f) => sum + f.units, 0);
  // 单笔成交、旧数据(没有 fills)、或 units 全坏:退回今天的单条记录,逐字节不变。
  // 这条兜底很要紧——分母为 0 时按占比分会得到 NaN 并产出**零条**记录,
  // 而余额照样入账,等于把一次平仓静默删掉。
  if (fills.length < 2 || !(totalUnits > 0)) return [base({})];

  /**
   * 币本位的张数是整数,按占比分不可能整除。用最大余额法(Hamilton):
   * 先各取下整,剩下的 r 张按小数部分从大到小各补一张,Σ 严格等于 closeQty。
   * 不能「先下整、余数全丢给最后一笔」——那是对排在最后那笔的系统性偏袒。
   * 注意 closeQty 被 Math.max(1,…) 托底,所以逐笔的张数只精确到 ±1 张,
   * 而且没有地方能把余额结转到下一次平仓。战役合计不受影响(见下方吸收者)。
   */
  let alloc: number[];
  if (coin) {
    const exact = fills.map(f => (closeQty * f.units) / totalUnits);
    alloc = exact.map(Math.floor);
    let rest = closeQty - alloc.reduce((a, b) => a + b, 0);
    const order = exact
      .map((v, i) => ({ i, frac: v - Math.floor(v), units: fills[i].units }))
      .sort((a, b) => (b.frac - a.frac) || (b.units - a.units) || (a.i - b.i));
    for (const { i } of order) { if (rest <= 0) break; alloc[i] += 1; rest -= 1; }
  } else {
    alloc = fills.map(f => (closeQty * f.units) / totalUnits);
  }

  /**
   * 残差吸收者取**份额最大**那一笔,不是最后一笔。
   * 最大余额法下最后一笔可能被分到 0 张,而一条 quantity 为 0、pnl 不为 0 的记录是畸形的:
   * tradeRecordGrossPnlAtExit 对零数量返回 0,用户第一次校正平仓价时就会把那一片悄悄清零。
   */
  let absorber = 0;
  for (let i = 1; i < fills.length; i++) if (alloc[i] > alloc[absorber]) absorber = i;

  /**
   * 盈亏**不能**按张数占比分,费用可以——这是两套不同的规则,混用会让加仓那一片的盈亏整个反号。
   *
   * 手续费、滑点、名义在固定成交价下确实是张数的线性函数,按张数摊是对的。
   * 但盈亏还取决于**每笔成交自己的开仓价**,而各笔开仓价不同正是这次拆分存在的全部理由。
   * 反例(实测):币本位做多,A 100张@0.10、B(加仓) 100张@0.12,200 张平在 0.11。
   * 真实分账 A +100.00 / B −83.33;按张数摊会写成两条 +8.33——
   * B 那条是做多、开仓 0.12、平仓 0.11 却带着正盈亏,自己的三个字段互相矛盾。
   * 而且所有分片必然**同号**,「主力赚、加仓亏」这种最常见的加仓形态再也表示不出来。
   * Σ 仍然守恒,所以余额没错、漂移阈值也发现不了——错的是按腿分账,正是拆分要提供的那个东西。
   *
   * 正确拆法不必牺牲守恒:合并开仓价的定义式(币本位是名义加权**调和**平均,
   * U 本位是数量加权算术平均)恰好保证 Σ 各笔自算的毛利 ≡ 合并仓位的毛利。于是
   *   毛利  按每笔自己的价格经济学算
   *   成本  = Σ毛利 − 整笔净盈亏,按张数摊(成本确实与张数成正比)
   *   净额  = 各自毛利 − 各自成本
   * Σ 净额 ≡ 整笔净盈亏,而且**不依赖任何关于引擎费用结构的假设**——
   * 强平费、资金费怎么算都不影响这个恒等式(强平路径的 netPnl 减掉的就不止 feeUsd)。
   */
  const contractSize = coin ? getCoinContractSizeUsd(symbol, pos) : 0;
  const grossCoinOf = (units: number, entry: number) =>
    coinPnlAmount(pos.side, units, entry, fillPrice, contractSize);
  const grossUsdOf = (units: number, entry: number) => (coin
    ? coinAmountToUsd(grossCoinOf(units, entry), fillPrice)
    : (pos.side === "LONG" ? fillPrice - entry : entry - fillPrice) * units);

  // 任何一笔开仓价不可用时,整体退回按张数摊——宁可全体一致地退化,
  // 也不要让「有的片按真实经济学、有的片按占比」混在同一次平仓里。
  const pricesUsable = Number.isFinite(fillPrice) && fillPrice > 0
    && fills.every(f => Number.isFinite(f.entryPrice) && f.entryPrice > 0);
  const grossUsd = fills.map((f, i) => (pricesUsable ? grossUsdOf(alloc[i], f.entryPrice) : 0));
  const grossCoin = fills.map((f, i) => (pricesUsable && coin ? grossCoinOf(alloc[i], f.entryPrice) : 0));
  const usable = pricesUsable && grossUsd.every(Number.isFinite) && grossCoin.every(Number.isFinite);
  // 成本 = Σ毛利 − 整笔净额。退化路径下令成本为 0、毛利直接取占比,行为与改动前逐字节相同。
  const costUsd = usable ? grossUsd.reduce((a, b) => a + b, 0) - totals.netPnl : 0;
  const costCoin = usable && totals.pnlCoin != null
    ? grossCoin.reduce((a, b) => a + b, 0) - totals.pnlCoin
    : 0;

  const acc = { quantity: 0, pnl: 0, pnlCoin: 0, fee: 0, feeCoin: 0, slippage: 0, notionalUsd: 0 };
  const out: TradeRecord[] = fills.map((f, i) => {
    const share = alloc[i] / closeQty;
    const rec = base({
      fillId: f.id,
      entryPrice: f.entryPrice,
      openTime: f.openTime || pos.openTime || 0,
      // 每笔成交各带自己的开仓杠杆:持仓期内提过杠杆之后,合并仓位的 openLeverage
      // 一路继承最早那笔的值,加仓那一片会顶着主力的杠杆写进历史,R 倍数随之失真。
      leverage: f.openLeverage ?? pos.openLeverage ?? pos.leverage,
      quantity: alloc[i],
      contracts: coin ? alloc[i] : undefined,
      pnl: usable ? grossUsd[i] - costUsd * share : totals.netPnl * share,
      pnlCoin: totals.pnlCoin == null
        ? undefined
        : (usable && coin ? grossCoin[i] - costCoin * share : totals.pnlCoin * share),
      fee: totals.feeUsd * share,
      feeCoin: totals.feeCoin == null ? undefined : totals.feeCoin * share,
      slippage: totals.slippageUsd * share,
      notionalUsd: totals.notionalUsd * share,
    });
    if (i !== absorber) {
      acc.quantity += rec.quantity; acc.pnl += rec.pnl;
      acc.pnlCoin += rec.pnlCoin ?? 0; acc.fee += rec.fee ?? 0;
      acc.feeCoin += rec.feeCoin ?? 0; acc.slippage += rec.slippage ?? 0;
      acc.notionalUsd += rec.notionalUsd ?? 0;
    }
    return rec;
  });

  /**
   * 吸收者补齐残差:把每一项的 Σ 与整笔的差压到 1 ULP 量级。
   * 做不到严格逐位相等——`total − acc` 再加回 acc 在 IEEE754 下不保证还原
   * (实测 123.45 会走成 123.45000000000002)。但这比「各自按占比算完就算」
   * 好一个量级,而且远在 campaignRealizedPnl 的漂移阈值 max(0.01, 规模×1e-6) 之内。
   */
  const a = out[absorber];
  a.quantity = closeQty - acc.quantity;
  if (coin) a.contracts = a.quantity;
  a.pnl = totals.netPnl - acc.pnl;
  if (totals.pnlCoin != null) a.pnlCoin = totals.pnlCoin - acc.pnlCoin;
  a.fee = totals.feeUsd - acc.fee;
  if (totals.feeCoin != null) a.feeCoin = totals.feeCoin - acc.feeCoin;
  a.slippage = totals.slippageUsd - acc.slippage;
  a.notionalUsd = totals.notionalUsd - acc.notionalUsd;

  // 张数为 0 的片不产出记录:它没有任何可读的内容,只会在战役里多出一行空腿。
  return out.filter(r => r.quantity > 0 || out.length === 1);
}

export function scaleSettlementPosition(pos: Position, remainingUnits: number): Position {
  const totalUnits = getPositionUnits(pos);
  const pct = totalUnits > 0 ? remainingUnits / totalUnits : 0;
  /**
   * fills 也要按同一比例缩。
   *
   * 不缩的话,任何一次部分平仓之后 Σfills.units 就大于仓位实际的量,
   * 而按占比拆分平仓记录**正是拿它当分母**——分母是陈的,每一笔的盈亏就分错。
   * 而且 mergeFilledPosition 是把新成交**追加**到这张表上的,误差会一路累积。
   *
   * 按比例缩,不是先进先出地消耗:先进先出会改变存活仓位的加权开仓价、
   * 从而改变强平价,而币安单向持仓的减仓不动均价(这里 pos.entryPrice 也确实不动)。
   */
  const fills = pos.fills?.map(f => ({ ...f, units: f.units * pct }));
  if (isCoinSettled(pos)) {
    return {
      ...pos,
      quantity: remainingUnits,
      contracts: remainingUnits,
      margin: pos.margin * pct,
      marginCoin: pos.marginCoin == null ? undefined : pos.marginCoin * pct,
      isolatedMargin: pos.isolatedMargin == null ? undefined : pos.isolatedMargin * pct,
      fills,
    };
  }
  return {
    ...pos,
    quantity: remainingUnits,
    fills,
    margin: pos.margin * pct,
    isolatedMargin: pos.isolatedMargin == null ? undefined : pos.isolatedMargin * pct,
  };
}

export function formatSettlementQuantity(item: SettlementInstrument, symbol: string): string {
  if (isCoinSettled(item)) return `${getCoinContracts(item)} 张`;
  return `${Number(item.quantity ?? 0).toFixed(4)} ${getSettlementAsset(symbol)}`;
}


/**
 * 同标的同方向的成交并成**一个**仓位——币安单向持仓模式就是这样。
 *
 * 事故（COAIUSDT 2026-06-13，10x 逐仓）：
 *   主力  开 0.538058，自身强平价 0.486404
 *   加仓1 开 0.604447，自身强平价 0.546420
 *   价格到 0.542220 —— 低于加仓自己的强平价、却远高于主力的，**加仓被单独打掉，主力活着**。
 *   合并后加权开仓价 0.581748、强平价 0.525900，0.542220 根本不该触发任何强平。
 *
 * 缺陷讲清楚就是：逐仓那一支按 `min(各腿 equity − maint) ≤ 0` 判，
 * 而单向持仓应当按 `Σ(equity − maint) ≤ 0` 判。健康那一腿的盈余本来可以扛住加仓，
 * 分开算就等于不让它扛。
 *
 * **强平公式一个字都不用改**——它的每一个输入都是可加的。改的是喂给它的粒度。
 */
export interface PositionMergeResult {
  positions: Position[];
  survivor: Position;
  /** 被吞并的那笔成交的 id；为 null 表示没有合并（新开了一个仓位）。 */
  absorbedFillId: string | null;
  /** 没有合并的原因，用来向用户解释「N 笔合并」这个徽标。 */
  blockedBy: 'leverage' | 'marginMode' | 'settlement' | null;
}

function fillsOf(p: Position, symbol: string): PositionFill[] {
  if (p.fills && p.fills.length > 0) return p.fills;
  // 旧仓位没有这个字段：按纯推导补出来，不做持久化迁移。
  return [{
    id: p.id,
    openTime: Number(p.openTime) > 0 ? Number(p.openTime) : 0,
    entryPrice: p.entryPrice,
    units: getPositionUnits(p),
    openLeverage: p.openLeverage ?? p.leverage,
  }];
}

/** 合并键。side 之外还必须比这三样，否则会把两种物理含义不同的仓位缝在一起。 */
function mergeBlocker(a: Position, b: Position): PositionMergeResult['blockedBy'] {
  // 保证金模式：强平公式在这上面分两支，引擎也分两轮跑。
  if (a.marginMode !== b.marginMode) return 'marginMode';
  // 结算方式 / 面值：quantity 在两种模式下一个是币、一个是张。
  if ((a.settlementMode ?? 'usdt') !== (b.settlementMode ?? 'usdt')) return 'settlement';
  if (Number(a.contractSizeUsd ?? 0) !== Number(b.contractSizeUsd ?? 0)) return 'settlement';
  /**
   * 杠杆不同**不合并**，而不是取加权。
   *
   * 每一处读 leverage 的地方形式都是「名义 ÷ 杠杆」，要保住的不变量是 Σ Nᵢ/Lᵢ；
   * 拒绝合并天然保住它，而取调和平均会把 leverage 变成小数，
   * 连带 ROE 的固定分母、界面上的「10x」都要跟着改——那是另一件事，不该搭这趟车。
   * 注意「取最大」是**错的**：1000@10x + 1000@5x 的初始保证金地板是 300，
   * 按最大算只有 200，用户会以为有 100 可以撤出来，撤完等于事后把 5x 那腿加到了 10x。
   */
  if (Number(a.leverage) !== Number(b.leverage)) return 'leverage';
  return null;
}

export function mergeFilledPosition(
  symbol: string,
  existing: Position[],
  fill: Position,
): PositionMergeResult {
  const open = existing.filter(isPositionOpen);
  const target = open.find(p => p.side === fill.side && mergeBlocker(p, fill) == null) ?? null;

  if (!target) {
    const sameSide = open.find(p => p.side === fill.side) ?? null;
    return {
      positions: [...open, { ...fill, fills: fillsOf(fill, symbol) }],
      survivor: fill,
      absorbedFillId: null,
      blockedBy: sameSide ? mergeBlocker(sameSide, fill) : null,
    };
  }

  const coin = isCoinSettled(target);
  const fills = [...fillsOf(target, symbol), ...fillsOf(fill, symbol)];

  /**
   * 加权开仓价。**U 本位与币本位是同一个式子**：Σ名义 ÷ Σ币量。
   *   U 本位 → 数量加权算术平均
   *   币本位 → 名义加权**调和**平均（按张数取算术平均是错的，
   *            两腿 1000@0.5 + 1000@0.6 会给出 0.55 而正解是 0.545455，
   *            在每一个价位上都差一个固定的币计盈亏）
   * 判据是「合并后的盈亏必须在**任意**价格上等于两腿之和」，不是在某一个价上对上。
   */
  const legs = [
    { coins: coinsAtEntry(symbol, target), entryPrice: target.entryPrice },
    { coins: coinsAtEntry(symbol, fill), entryPrice: fill.entryPrice },
  ];
  const totalCoins = legs.reduce((s, l) => s + l.coins, 0);
  const entryPrice = totalCoins > 0
    ? legs.reduce((s, l) => s + l.coins * l.entryPrice, 0) / totalCoins
    : target.entryPrice;

  const openTimes = fills.map(f => f.openTime).filter(t => t > 0);
  const survivor: Position = {
    ...target,
    // id 保留**最早**那一笔：挂在它上面的减仓单、日志的 trade_record_id 都指着它。
    id: target.id,
    entryPrice,
    quantity: Number(target.quantity) + Number(fill.quantity),
    contracts: coin
      ? Number(target.contracts ?? target.quantity) + Number(fill.contracts ?? fill.quantity)
      : target.contracts,
    margin: Number(target.margin) + Number(fill.margin),
    marginCoin: coin
      ? Number(target.marginCoin ?? 0) + Number(fill.marginCoin ?? 0)
      : target.marginCoin,
    isolatedMargin: target.isolatedMargin != null || fill.isolatedMargin != null
      ? Number(target.isolatedMargin ?? target.margin) + Number(fill.isolatedMargin ?? fill.margin)
      : undefined,
    // 最早的开仓时刻。绝不能落到 0——TradeRecord.openTime 写的是 `pos.openTime || 0`，
    // 而 0 会把战役的委托归属窗口变成 [1970, 平仓]。
    openTime: openTimes.length > 0 ? Math.min(...openTimes) : target.openTime,
    fills,
  };

  return {
    positions: open.map(p => (p.id === target.id ? survivor : p)),
    survivor,
    absorbedFillId: fill.id,
    blockedBy: null,
  };
}

/** 一笔仓位按**开仓价**折出的币量。币本位 = 张 × 面值 ÷ 开仓价；U 本位数量本身就是币量。 */
function coinsAtEntry(symbol: string, p: Position): number {
  if (!(p.entryPrice > 0)) return 0;
  return isCoinSettled(p)
    ? getPositionNotionalUsd(symbol, p, p.entryPrice) / p.entryPrice
    : Number(p.quantity) || 0;
}
