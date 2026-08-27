/**
 * 盘口上「真正挂着的对冲线」。
 *
 * 为什么需要它：加仓计算器的整套「锁死」承诺建立在一个前提上——
 * **喂进去的 S₁ 就是盘口上那张对冲单的触发价**。此前 S₁ 纯手填、零校验，
 * 计算器压根读不到 ordersMap，于是两者可以静默地不是同一个数。
 *
 * 实测代价（SCRTUSDT 2026-04-20）：填进去的 S₁ = 0.114572，盘口挂的是 0.114401，
 * 差 0.000171（0.149%）——加仓量因此超了 9.1%，对冲触发那一刻净值不是 0 而是
 * −3,247 USDT。0.15% 的输入偏差，被 1/险 放大成四位数的亏损。
 *
 * ⚠ 这里刻意**只产出候选，不替用户做决定**：下面每一条排除规则都说明了
 * 为什么「side 反向的开仓挂单」不等于「对冲单」。系统分不出意图，
 * 所以它只负责把候选摆出来并算清偏差代价，选哪条线始终是人的事。
 */
// 不从 TradingContext 导 OrdersMap：那会把数据层反向拖进 lib，形成环。
import type { PendingOrder, Position } from '@/types/trading';

type OrdersBySymbol = Record<string, PendingOrder[]>;
import { legOpeningCoins, type AddSide } from '@/lib/addSizing';

/** 委托归属本场的前置窗口。与 journalApi 归属委托时的口径同源——
 *  ordersMap 走 usePersistedState 持久化，跨回放、跨会话都活着，
 *  没有这道窗口，上一场战役遗留的挂单会漏进来。 */
export const PRE_MAIN_LOOKBACK_MS = 5 * 60_000;

/** 对冲方向 = 主仓的反向。绝不从持仓推——主空战役里 positionsMap 同时有
 *  主空仓和已成交的对冲多仓，按「哪个方向先命中」会把自己的加仓单读成对冲线。 */
export function hedgeSideFor(mainSide: AddSide): 'LONG' | 'SHORT' {
  return mainSide === 'LONG' ? 'SHORT' : 'LONG';
}

type OrderLike = PendingOrder & {
  reduceOnly?: boolean;
  reduceKind?: 'TP' | 'SL' | null;
  linkedPositionId?: string | null;
  reducePositionSide?: unknown;
};

/**
 * 平仓性质的单子。与 journalApi 的同名局部判据同源，但**收紧了一处**：
 * *_TP_SL 在本项目里是 OrderPanel「限价/市价 + 勾选止盈止损」组合出的**开仓**单
 * （finalType 由 enableTpSl 转换，全程没有 reduceOnly），真正的平仓止盈止损是
 * handlePlaceTpSl 造的 CONDITIONAL + reduceOnly + linkedPositionId。
 * 照抄原判据会把带止盈止损的对冲开仓单误排除。
 */
function isClosingOrder(o: OrderLike): boolean {
  if (o.reduceOnly === true || o.reduceKind != null) return true;
  if (o.linkedPositionId || o.reducePositionSide) return true;
  return false;
}

/** 这类委托没有事前确定的线，「锁死」的前提对它们不成立，一律不作候选。 */
export type UnlineableKind = 'TRAILING_STOP' | 'TWAP' | 'NO_PRICE';

export interface HedgeLineCandidate {
  id: string;
  /** 触发价。条件单读 stopPrice——它才是触发价，price 是执行价。 */
  price: number;
  coins: number;
  createdAt: number;
}

export interface HedgeLineReading {
  candidates: HedgeLineCandidate[];
  /** 已成交的反向持仓币量。对冲一旦触发，订单就离开 ordersMap 变成反向仓位，
   *  只数挂单会把「已挂量」少算一大截。 */
  filledHedgeCoins: number;
  /** 无固定线、被显式排除的委托——必须可见，不能静默丢掉。 */
  unlineable: Array<{ id: string; kind: UnlineableKind; coins: number }>;
  /** 早于本场窗口、被时间窗滤掉的条数。 */
  staleCount: number;
}

const OPEN_STATUSES = new Set(['NEW', 'PENDING', 'ACTIVE']);

/**
 * 读出盘口上所有可作为对冲线的候选。
 * @param mainSide 主仓方向——**必须由调用方显式给**，不许从持仓猜。
 * @param sinceMs  本场窗口起点（通常 = 主力最早开仓 − PRE_MAIN_LOOKBACK_MS）。
 * @param settlement 标的的结算口径，作为委托自身 settlementMode 缺失时的兜底——
 *   orders_map 是持久化的，早于该字段的委托会缺它，用委托口径折币会得 0。
 */
export function readHedgeLines(
  symbol: string,
  ordersMap: OrdersBySymbol | undefined,
  positions: Position[] | undefined,
  mainSide: AddSide,
  sinceMs: number,
  settlement: 'coin' | 'usdt',
  defaultFaceUsd: number,
): HedgeLineReading {
  const want = hedgeSideFor(mainSide);
  const orders = ((ordersMap ?? {})[symbol] ?? []) as OrderLike[];
  const candidates: HedgeLineCandidate[] = [];
  const unlineable: HedgeLineReading['unlineable'] = [];
  let staleCount = 0;

  for (const o of orders) {
    if (!o || o.side !== want) continue;
    if (!OPEN_STATUSES.has(String(o.status))) continue;
    if (isClosingOrder(o)) continue;
    if (Number.isFinite(o.createdAt) && o.createdAt < sinceMs) { staleCount += 1; continue; }

    const coins = legOpeningCoins(
      { ...o, entryPrice: o.stopPrice > 0 ? o.stopPrice : o.price, settlementMode: o.settlementMode ?? settlement },
      defaultFaceUsd,
    );

    // 跟踪委托的 stopPrice 是**激活价**不是触发价，真实触发点随行情游走
    // （SHORT 用 trough×(1+rate)），事前没有固定的线。
    if (o.type === 'TRAILING_STOP') { unlineable.push({ id: o.id, kind: 'TRAILING_STOP', coins }); continue; }
    // TWAP 的 price / stopPrice 都是 0，取不到线；而且 quantity 是未扣已成交的总量。
    if (o.type === 'TWAP') { unlineable.push({ id: o.id, kind: 'TWAP', coins }); continue; }

    const price = o.stopPrice > 0 ? o.stopPrice : o.price;
    if (!(price > 0)) { unlineable.push({ id: o.id, kind: 'NO_PRICE', coins }); continue; }
    candidates.push({ id: o.id, price, coins, createdAt: o.createdAt ?? 0 });
  }

  // 已成交的反向持仓
  let filledHedgeCoins = 0;
  for (const p of positions ?? []) {
    if (!p || p.side !== want) continue;
    filledHedgeCoins += legOpeningCoins(p, defaultFaceUsd);
  }

  // 最保守的一条排前（主多取最低线、主空取最高线）；币量只作次级键。
  candidates.sort((a, b) => (mainSide === 'LONG' ? a.price - b.price : b.price - a.price) || b.coins - a.coins);
  return { candidates, filledHedgeCoins, unlineable, staleCount };
}

/** 两条线是不是同一条（相对误差，价格量级从 1e-5 到 1e5 都要能用）。 */
export function sameLine(a: number, b: number): boolean {
  if (!(a > 0) || !(b > 0)) return false;
  return Math.abs(a - b) <= Math.max(1e-12, Math.max(Math.abs(a), Math.abs(b)) * 1e-6);
}

export interface S1Deviation {
  bookPrice: number;
  typedS1: number;
  /** 按盘口线本该下的加仓量 */
  shouldAdd: number;
  /** 按填入的 S₁ 算出的加仓量 */
  typedAdd: number;
  /** 多下了多少币（负=少下） */
  excessCoins: number;
  /** 走到盘口线那一刻的净值（设计意图是 0）。负数=已经亏了这么多。 */
  netAtBookLine: number;
}

/**
 * 把「S₁ 与盘口线不一致」翻译成一个用户能直接判断的数：
 * 价格真走到盘口那条线时，账面净值是多少。设计意图是 0。
 *
 * 净值 = X₁(线 − S̄) + G − X_total(S₂ − 线)
 * 其中 X_total 是按**填入的 S₁** 算出来的加仓量（也就是他真的下出去的量）。
 */
export function evaluateS1Deviation(args: {
  side: AddSide; sBar: number; s1: number; s2: number; x1: number; g: number; bookPrice: number;
}): S1Deviation | null {
  const { side, sBar, s1, s2, x1, g, bookPrice } = args;
  const d = side === 'SHORT' ? -1 : 1;
  const fin = (v: number) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (!fin(sBar) || !fin(s1) || !fin(s2) || !fin(x1) || !fin(bookPrice)) return null;
  const riskTyped = (s2 - s1) * d;
  const riskBook = (s2 - bookPrice) * d;
  if (!(riskTyped > 0) || !(riskBook > 0)) return null;

  const typedAdd = (x1 * (s1 - sBar) * d + Math.max(0, g)) / riskTyped;
  const shouldAdd = (x1 * (bookPrice - sBar) * d + Math.max(0, g)) / riskBook;
  const netAtBookLine = x1 * (bookPrice - sBar) * d + Math.max(0, g) - typedAdd * riskBook;

  return {
    bookPrice, typedS1: s1, shouldAdd, typedAdd,
    excessCoins: typedAdd - shouldAdd,
    netAtBookLine,
  };
}
