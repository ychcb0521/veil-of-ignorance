/**
 * 强平判据的纯函数层。
 *
 * 为什么单独抽出来：强平是**不可逆的破坏性动作**——它删掉真实仓位、写死一条
 * LIQUIDATION 记录、没收保证金。这种代码必须能被单测逐条钉住，而不是埋在
 * 一个依赖 5 个 state 的 useEffect 里靠肉眼审。
 *
 * 本层的全部三条规则都**偏向「不强平」**。理由是两类错误的代价不对称：
 *   漏强平 → 用户多扛一会儿风险，下一帧价格到位就会正常强平；
 *   误强平 → 仓位没了、历史里多出一条假爆仓单，且不可撤销。
 */
import {
  MAINTENANCE_MARGIN_RATE,
  calcUnrealizedPnl,
  type PendingOrder,
  type Position,
} from '@/types/trading';
import { resolveConditionalTriggerPrice } from '@/lib/conditionalOrders';
import {
  getPositionNotionalUsd,
  getSettlementFeeParts,
  isPositionOpen,
  type CloseRecordTotals,
} from '@/lib/tradingSettlement';
import { calcLiquidationPrice } from '@/types/trading';

/**
 * 陈价容差的下限（模拟时间，毫秒）。
 * 背景行情每 1 秒真实时间刷一次，倍速越高一次轮询跨过的模拟时间越长，
 * 所以调用方按 max(本常量, speed × 轮询间隔) 放宽。
 * 真正要挡的是「跨日期回放」——那种价差是小时/天级，放宽多少都在容差之外。
 */
export const STALE_PRICE_MIN_TOLERANCE_MS = 60_000;

export function staleToleranceMs(speed: number): number {
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  // 5 秒真实时间 × 当前倍速：够覆盖一次轮询往返 + 节流，又远小于跨日期价差。
  return Math.max(STALE_PRICE_MIN_TOLERANCE_MS, s * 5_000);
}

/**
 * 这个价是不是「此刻的价」。
 *
 * priceMap 只是 Record<string, number>，**没有时间戳**，却被持久化进 localStorage、
 * 又被排除出云端同步（simStateSync 的 EXCLUDED_KEYS 里唯一一个）。于是上一段回放、
 * 上一个日期的价格会活过刷新、活过时间跳转，而强平判据此前唯一的护栏只有
 * `price > 0` —— 它挡得住「没有价」，挡不住「有一个属于别的时刻的价」。
 *
 * asOf 只在**真正发起过一次行情请求**的地方按请求所用的模拟时刻登记，
 * 所以「没登记过」= 说不清这个价属于哪一刻 = 一律不强平。
 */
export function isPriceFreshForLiquidation(
  priceAsOf: number | null | undefined,
  nowSim: number,
  toleranceMs: number,
): boolean {
  if (!Number.isFinite(nowSim) || nowSim <= 0) return false;
  if (priceAsOf == null || !Number.isFinite(priceAsOf)) return false;
  return Math.abs(nowSim - priceAsOf) <= Math.max(0, toleranceMs);
}

export type LiquidationSkipReason =
  | 'not_isolated'
  | 'no_position'
  | 'no_price'
  | 'stale_price'
  /** 这个价是在仓位（当前这副构成）形成**之前**观察到的，描述的不是这个仓位。 */
  | 'price_before_open'
  | 'bad_numbers'
  | 'solvent';

export type IsolatedLiquidationDecision =
  | { liquidate: false; reason: LiquidationSkipReason }
  | {
      liquidate: true;
      pnlUsd: number;
      notionalUsd: number;
      equityUsd: number;
      maintenanceUsd: number;
    };

/**
 * 逐仓强平的唯一判据。与此前内联版本相比有三处收紧，全部偏安全侧：
 *
 *   1. **价格必须对得上当前模拟时刻**，否则 stale_price —— 这是本次两个症状的根因。
 *   2. **零张 / 畸形仓位不产生强平事件**：notional ≤ 0 时旧代码会算出
 *      equity 0 ≤ maint 0，把一个根本不存在的仓位写成一条 quantity=0 的爆仓单。
 *   3. 比较写成**肯定式** `equity <= maint` 再取反。旧代码是 `if (equity > maint) continue`，
 *      任何 NaN 都会让 `>` 为假，于是一路掉进爆仓分支——NaN 的默认归宿是「爆仓」，
 *      这是反的。现在 NaN 落到 bad_numbers。
 */
/** 币本位仓位（保证金记在币上）。 */
function isCoinSettledPosition(position: Position): boolean {
  return position.settlementMode === 'coin';
}

/**
 * 一笔仓位**当下**的保证金美元价值。
 * 币本位持有的是币，价值随价格走；U 本位就是那个固定美元数。
 * 逐仓与全仓必须用同一个口径——否则同一笔币本位仓位在两种模式下按两套模型判生死。
 */
export function positionMarginUsdAtMark(position: Position, price: number): number {
  if (isCoinSettledPosition(position)) return coinMarginUsdAtMark(position, price);
  return position.isolatedMargin ?? position.margin ?? 0;
}

/**
 * 币本位逐仓保证金按**现价**折算出的美元价值。
 * marginCoin 缺失的老仓位退回 isolatedMargin / 开仓价 推出的币数，
 * 与 calcLiquidationPrice 的兜底同一条。
 */
function coinMarginUsdAtMark(position: Position, price: number): number {
  const marginCoin = position.marginCoin
    ?? (position.entryPrice > 0 ? (position.isolatedMargin ?? 0) / position.entryPrice : 0);
  /**
   * 两种情况必须分开，混为一谈会各错一头：
   *   · 保证金**确实被减到 0**（leverageRestatement 的 Math.max(0, marginCoin − releaseCoin)
   *     能做到）→ 返回 0。权益 = 浮盈，照常进入判据；返回 NaN 会让一笔一分保证金都不剩的
   *     仓位落到 bad_numbers 而永远打不掉，比不改还糟。
   *   · 保证金**数据损坏**（NaN / 无穷）→ 返回 NaN，沿用既有取向：算不清就不强平。
   *     把它当成 0 等于拿坏数据去判生死。
   */
  if (!Number.isFinite(marginCoin)) return Number.NaN;
  if (marginCoin <= 0) return 0;
  return marginCoin * price;
}

export function evaluateIsolatedLiquidation(input: {
  symbol: string;
  position: Position;
  price: number;
  priceAsOf?: number | null;
  nowSim: number;
  toleranceMs: number;
  /** 播放方向。倒放时「之后」是更早的真实时刻。缺省正放。 */
  direction?: 1 | -1;
  /** 风险起点的覆盖值（调用方传 nextExposure 给出的起点）。缺省取 positionRiskSince。 */
  riskSince?: number | null;
}): IsolatedLiquidationDecision {
  const { symbol, position, price, priceAsOf, nowSim, toleranceMs } = input;

  if (position.marginMode !== 'isolated' || position.isolatedMargin == null) {
    return { liquidate: false, reason: 'not_isolated' };
  }
  if (!isPositionOpen(position)) return { liquidate: false, reason: 'no_position' };
  if (!Number.isFinite(price) || price <= 0) return { liquidate: false, reason: 'no_price' };
  if (!isPriceFreshForLiquidation(priceAsOf, nowSim, toleranceMs)) {
    return { liquidate: false, reason: 'stale_price' };
  }
  /**
   * 事故（NAORISUSDT 2025-09-13）：两张 0.095 的空单 07:26 触发，却被 07:07 尖顶附近的
   * 0.158877 判了强平——那个价比这两张单还早 19 分钟。上面的新鲜度只问「离现在多远」，
   * 容忍度又随倍速放大（900 倍下 75 个模拟分钟），于是一个仓位还不存在时的价格被当成了
   * 它的现价。现在额外要求：价格必须观察于仓位当前构成形成之后。
   */
  const observedAfterOpen = input.riskSince !== undefined
    ? priceObservedAfter(priceAsOf, input.riskSince, input.direction ?? 1)
    : priceObservedWhilePositionOpen(priceAsOf, position, input.direction ?? 1);
  if (!observedAfterOpen) return { liquidate: false, reason: 'price_before_open' };

  const notionalUsd = getPositionNotionalUsd(symbol, position, price);
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
    return { liquidate: false, reason: 'no_position' };
  }

  const pnlUsd = calcUnrealizedPnl(position, price);
  /**
   * 币本位的保证金持有的是**币**，它的美元价值随价格走，不是开仓那一刻的固定美元数。
   *
   * 事故：这里原来一律用 isolatedMargin（开仓时折算的固定美元）。与卡片上显示的
   * 强平价（calcLiquidationPrice 按 marginCoin 估值）用的是两套模型，于是引擎和
   * 显示价对不上：
   *   equity_引擎 = N/L + pnlUsd
   *   equity_正确 = x·marginCoin + pnlUsd       （x = 当前价）
   *   差额 = (N/L)·(x/E − 1)
   * x > E 时正确值更大 → 引擎低估权益 → **提前**强平；空头正是在 x > E 时亏损，
   * 所以空头会在显示的强平价之前约 10% 就被打掉，而那时保证金还剩一成多。
   * x < E 时反过来 → 多头**越过**显示的强平价仍活着，此时币本位权益其实已经为负。
   *
   * 换成按现价折算之后，判据 x·marginCoin + pnlUsd ≤ N·mmr 解出来的边界，
   * 与 calcLiquidationPrice 的币本位公式逐字一致（下有测试逐条比对）。
   * 维持保证金那一项不用动：币本位名义 N = 张数 × 面值，本来就与价格无关。
   */
  const marginUsd = isCoinSettledPosition(position)
    ? coinMarginUsdAtMark(position, price)
    : position.isolatedMargin;
  const equityUsd = marginUsd + pnlUsd;
  const maintenanceUsd = notionalUsd * MAINTENANCE_MARGIN_RATE;
  if (!Number.isFinite(equityUsd) || !Number.isFinite(maintenanceUsd)) {
    return { liquidate: false, reason: 'bad_numbers' };
  }
  if (!(equityUsd <= maintenanceUsd)) return { liquidate: false, reason: 'solvent' };

  return { liquidate: true, pnlUsd, notionalUsd, equityUsd, maintenanceUsd };
}


/** 全仓一档的输入：钱包余额、全部全仓仓位的保证金与浮盈、维持保证金。 */
export interface CrossLiquidationInput {
  /** 钱包余额。注意：开仓时已经从它里面扣掉了保证金。 */
  balanceUsd: number;
  /** 全部全仓仓位**已被扣走**的保证金之和。 */
  crossMarginUsd: number;
  /** 全部全仓仓位的浮动盈亏之和（亏为负）。 */
  crossUnrealizedPnlUsd: number;
  /** 全部全仓仓位的维持保证金之和。 */
  crossMaintenanceUsd: number;
}

export type CrossLiquidationDecision =
  | { liquidate: false; reason: 'no_position' | 'bad_numbers' | 'solvent'; equityUsd?: number }
  | { liquidate: true; equityUsd: number; maintenanceUsd: number };

/**
 * 全仓强平判据。
 *
 * 事故：原来写的是 `crossEquity = balance + ΣPnL`，把**已经扣走的保证金**漏在了权益之外。
 * 这个代码库里开仓就 `setBalance(prev − margin − fee)`，两种模式都扣；所以钱包里的
 * 现金已经不含在用保证金，真实权益必须是 `余额 + Σ全仓保证金 + Σ浮盈`。
 * 少算的正好是 Σ保证金，后果有两层：
 *   · 强平在真实距离的**一半**处就触发；
 *   · 仓位铺满时余额≈0，任何一点负浮盈（开仓滑点就够）都会在下一个 250ms 判定里
 *     把整个账户清掉——用户看到的是「刚开仓就爆仓」。
 * 逐仓保证金是隔离的，不进这个池子（它有自己的 evaluateIsolatedLiquidation）。
 */
export function evaluateCrossLiquidation(input: CrossLiquidationInput): CrossLiquidationDecision {
  const { balanceUsd, crossMarginUsd, crossUnrealizedPnlUsd, crossMaintenanceUsd } = input;
  if (!(crossMarginUsd > 0) && !(crossMaintenanceUsd > 0)) {
    return { liquidate: false, reason: 'no_position' };
  }
  const equityUsd = balanceUsd + crossMarginUsd + crossUnrealizedPnlUsd;
  if (!Number.isFinite(equityUsd) || !Number.isFinite(crossMaintenanceUsd)) {
    // 与逐仓同一取向：算不清就**不**强平。反过来会让任何畸形数据都以爆仓收场。
    return { liquidate: false, reason: 'bad_numbers' };
  }
  if (!(equityUsd <= crossMaintenanceUsd)) {
    return { liquidate: false, reason: 'solvent', equityUsd };
  }
  return { liquidate: true, equityUsd, maintenanceUsd: crossMaintenanceUsd };
}


/**
 * 仓位当前这副构成是从哪一刻开始的：首笔开仓与之后每一笔加仓里，按播放方向**最晚**的那一刻。
 * 加仓会改变强平价，所以加仓之前的价格描述的是另一个仓位。
 * 老仓位没有任何开仓时刻时返回 null，调用方不加这道约束（向后兼容）。
 */
export function positionRiskSince(position: Position, direction: 1 | -1 = 1): number | null {
  const times: number[] = [];
  if (Number.isFinite(position.openTime) && Number(position.openTime) > 0) times.push(Number(position.openTime));
  for (const fill of position.fills ?? []) {
    if (Number.isFinite(fill.openTime) && fill.openTime > 0) times.push(fill.openTime);
  }
  if (times.length === 0) return null;
  return direction === 1 ? Math.max(...times) : Math.min(...times);
}

/**
 * 行情价的颗粒：规范价取自 1 分钟 K 线，按进度在这一分钟的开收之间插值。
 * 插值价不是任何一笔真实成交；只有整分钟都在仓位形成之后，它才必定落在仓位形成之后的真实成交区间里。
 */
export const CANONICAL_PRICE_BUCKET_MS = 60_000;

/**
 * 这个价是不是**整个**观察于 since 之后（按播放方向）。
 *
 * 只比时间戳不够：规范价是 1 分钟 K 线里的插值，成交所在那一分钟的插值价可能是成交之前的价
 * （例：开 0.155、收 0.0948 的一分钟，空单在 0.095 成交之后，同一分钟的插值价仍可能是 0.116，
 * 已高于它的强平价）。所以要求这个价所在的整分钟都在 since 之后；倒放时整分钟都在 since 之前。
 */
export function priceObservedAfter(
  priceAsOf: number | null | undefined,
  since: number | null | undefined,
  direction: 1 | -1 = 1,
): boolean {
  if (since == null) return true;
  if (priceAsOf == null || !Number.isFinite(priceAsOf)) return false;
  const bucketStart = Math.floor(priceAsOf / CANONICAL_PRICE_BUCKET_MS) * CANONICAL_PRICE_BUCKET_MS;
  return direction === 1 ? bucketStart >= since : bucketStart + CANONICAL_PRICE_BUCKET_MS <= since;
}

/** 这个价是不是在仓位（当前构成）已经存在之后观察到的——按播放方向算「之后」。 */
export function priceObservedWhilePositionOpen(
  priceAsOf: number | null | undefined,
  position: Position,
  direction: 1 | -1 = 1,
): boolean {
  return priceObservedAfter(priceAsOf, positionRiskSince(position, direction), direction);
}

/** 兜底判定为每副仓位构成记下的风险起点。since 变了（加仓、换方向）就重新取。 */
export interface ExposureEntry {
  since: number | null;
  start: number | null;
}

/**
 * 兜底判定用的风险起点：通常就是仓位（当前构成）形成的那一刻；时钟一旦落到它「之前」
 * 超过容忍度——只有跳时间、换方向才会这样——就改从此刻算起。
 *
 * 只比原始时间戳，会把两种正当操作变成永久免死：
 *   · 带着仓位跳回更早的日期：时钟走回开仓时刻之前，每一个价都被当成「成形之前」；
 *   · 正放开仓后倒放（或反过来）：倒放时「之后」是更早的时刻，正放开的仓一个价都不认。
 * 容忍度与陈价同一个（staleToleranceMs：60 秒，或 5 秒真实时间 × 倍速）。界面时钟的落后
 * 只有 250 毫秒真实时间 × 倍速，远小于它，正常播放不会误触重置；重置前的空窗也不超过这么多。
 */
export function nextExposure(
  prev: ExposureEntry | undefined,
  position: Position,
  clock: number,
  direction: 1 | -1,
  toleranceMs: number,
): ExposureEntry {
  const since = positionRiskSince(position, direction);
  if (since == null) return { since: null, start: null };
  const base = prev && prev.since === since && prev.start != null ? prev.start : since;
  if (!Number.isFinite(clock) || clock <= 0) return { since, start: base };
  const tol = Math.max(0, toleranceMs);
  const clockBehind = direction === 1 ? base - clock > tol : clock - base > tol;
  return { since, start: clockBehind ? clock : base };
}

/**
 * 止损与强平谁先被触及。价格朝不利方向走，先碰到离开仓价更近的那一个：
 * 多单止损价 ≥ 强平价、空单止损价 ≤ 强平价 → 止损先。
 *
 * 'liquidation_first'：挂着止损、但每一张都在强平价之外——价格到不了止损就先爆了。
 * 这时若仍按「先撮合止盈止损、再判强平」，止损会在强平价之外成交，记录亏得比保证金还多，
 * 而逐仓的钱包回写又封底在 0，记录与钱包从此对不上。
 */
export function stopLossVersusLiquidation(
  position: Position,
  orders: readonly PendingOrder[],
): 'no_stop' | 'stop_first' | 'liquidation_first' {
  const stops = orders.filter(o =>
    o.reduceOnly && o.reduceKind === 'SL' && o.linkedPositionId === position.id
    && o.type === 'CONDITIONAL' && o.status === 'PENDING');
  if (stops.length === 0) return 'no_stop';
  const liq = calcLiquidationPrice(position);
  if (!Number.isFinite(liq) || liq <= 0) return 'stop_first';
  const firesFirst = (o: PendingOrder) => {
    const trigger = resolveConditionalTriggerPrice(o);
    // 算不清触发价就维持原来的顺序（先撮合），不凭坏数据去抢先强平。
    if (!Number.isFinite(trigger) || trigger <= 0) return true;
    return position.side === 'LONG' ? trigger >= liq : trigger <= liq;
  };
  return stops.some(firesFirst) ? 'stop_first' : 'liquidation_first';
}

/** 逐仓仓位在某个价位上的权益与维持保证金——两条判定路径共用同一个模型。 */
function isolatedEquityAt(symbol: string, position: Position, price: number): {
  notionalUsd: number; pnlUsd: number; equityUsd: number; maintenanceUsd: number;
} | null {
  const notionalUsd = getPositionNotionalUsd(symbol, position, price);
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) return null;
  const pnlUsd = calcUnrealizedPnl(position, price);
  const marginUsd = isCoinSettledPosition(position)
    ? coinMarginUsdAtMark(position, price)
    : Number(position.isolatedMargin);
  return {
    notionalUsd,
    pnlUsd,
    equityUsd: marginUsd + pnlUsd,
    maintenanceUsd: notionalUsd * MAINTENANCE_MARGIN_RATE,
  };
}

/** 一根 K 线（或正在成形那根已经揭示的部分）。 */
export interface LiquidationCandle {
  high: number;
  low: number;
  close: number;
  /** 这根 K 线的开始时刻。 */
  startTime: number;
  /** 这一次判定所看到的最后时刻：收线的 K 线是它的收盘时刻，成形中的是此刻。 */
  endTime: number;
  /**
   * 这根是否已经收线。缺省视为已收线。
   * 成形中那根的 close 是按进度插值出来的合成价，不是任何一笔真实成交——
   * 它甚至落后于同一帧揭示出的高低点，不能当作「成交之后的价」用。
   */
  settled?: boolean;
}

export type CandleLiquidationDecision =
  | {
      liquidate: false;
      reason: LiquidationSkipReason | 'not_isolated' | 'candle_before_open' | 'forming_candle_straddles_open';
    }
  | {
      liquidate: true;
      /** 判定用的那个价：多单是最低价，空单是最高价；成交所在那根只认收盘。 */
      triggerPrice: number;
      /** 记账用的平仓价：强平价落在这根的成交区间内就取强平价。 */
      exitPrice: number;
      equityUsd: number;
      maintenanceUsd: number;
    };

/**
 * 逐根 K 线判定逐仓强平——与止盈止损同一个时钟、同一根 K 线、同一个区间。
 *
 * 原来强平只在 250 毫秒一次的界面刷新里、拿网络取回的一个收盘价判：
 * 影线穿过强平价又收回，它看不见；网络慢时价格停在旧值，它又会拿旧值去判。
 * 这里改看这根 K 线对仓位最不利的那个价：多单看最低，空单看最高。
 *
 * 只用于**正放**。倒放时「之后」是更早的真实时刻，K 线内部的先后也反过来，
 * 倒放继续走带方向判定的 evaluateIsolatedLiquidation。
 */
export function evaluateIsolatedLiquidationOnCandle(input: {
  symbol: string;
  position: Position;
  candle: LiquidationCandle;
  /**
   * 仓位（当前构成）风险起点的覆盖值，缺省取 positionRiskSince。
   * 调用方传 updateRiskFloors 给出的下限：记录里的开仓时刻可能取自落后的界面时钟。
   */
  riskSince?: number | null;
}): CandleLiquidationDecision {
  const { symbol, position, candle } = input;
  if (position.marginMode !== 'isolated' || position.isolatedMargin == null) {
    return { liquidate: false, reason: 'not_isolated' };
  }
  if (!isPositionOpen(position)) return { liquidate: false, reason: 'no_position' };
  const { high, low, close, startTime, endTime } = candle;
  if (![high, low, close].every(v => Number.isFinite(v) && v > 0)) {
    return { liquidate: false, reason: 'no_price' };
  }

  const since = input.riskSince !== undefined ? input.riskSince : positionRiskSince(position, 1);
  // 整根都在仓位成形之前：这根里的任何价都与这个仓位无关。
  if (since != null && Number.isFinite(endTime) && endTime <= since) {
    return { liquidate: false, reason: 'candle_before_open' };
  }
  const lo = Math.min(low, high);
  const hi = Math.max(low, high);
  // 成交就发生在这根里：成交之前那段的高低点分不出来，只认收盘——它必定在成交之后。
  const straddlesOpen = since != null && Number.isFinite(startTime) && startTime < since;
  /**
   * 成交就在这根里、而这根还没收线：已揭示的高低点分不出成交前后，插值收盘又是合成价。
   * 例：一根开 0.155、高 0.16、低 0.0931、收 0.0948 的 K 线按进度揭示时，低点在进度约 0.65
   * 触到 0.095 让空单成交，同一刻插值收盘还停在 0.116——已高于这张空单 0.1136 的强平价，
   * 下一帧就会把一张实际收在 0.0948 的空单判爆。等它收线，用真实收盘判。
   */
  if (straddlesOpen && candle.settled === false) {
    return { liquidate: false, reason: 'forming_candle_straddles_open' };
  }
  const triggerPrice = straddlesOpen ? close : (position.side === 'LONG' ? lo : hi);

  const at = isolatedEquityAt(symbol, position, triggerPrice);
  if (!at) return { liquidate: false, reason: 'no_position' };
  if (!Number.isFinite(at.equityUsd) || !Number.isFinite(at.maintenanceUsd)) {
    return { liquidate: false, reason: 'bad_numbers' };
  }
  if (!(at.equityUsd <= at.maintenanceUsd)) return { liquidate: false, reason: 'solvent' };

  const liq = calcLiquidationPrice(position);
  const exitPrice = Number.isFinite(liq) && liq > 0 ? Math.min(hi, Math.max(lo, liq)) : triggerPrice;
  return { liquidate: true, triggerPrice, exitPrice, equityUsd: at.equityUsd, maintenanceUsd: at.maintenanceUsd };
}

/** 逐根判定为每副仓位构成记下的风险下限。since 变了（加仓）就重新取。 */
export interface RiskFloorEntry {
  since: number | null;
  floor: number;
}

/**
 * 逐根判定用的「仓位从哪一刻起承担风险」的下限。
 *
 * 记录里的开仓时刻并不总是成交那一刻的撮合时钟：手动市价单取的是界面时钟，它每 250 毫秒
 * 真实时间才刷新一次，3600 倍下落后可达 15 个模拟分钟。直接拿它当起点，成交所在那根 K 线里
 * **成交之前**的高低点——往往正是用户看着它才下单的那段——会被算到这张单头上。
 *
 * 一副构成第一次在逐根判定里出现时，它必定形成于上一次判定之后，所以上一次判定看到的
 * 最后时刻是一个可靠的下限。撮合产生的成交本来就按撮合时钟记录，那个时刻不早于上一次判定，
 * 取 max 后原样保留，精度不受影响。
 *
 * 时钟倒退（跳时间、换方向）或第一次判定时没有可信的「上一次」，下限取这一次的最后时刻：
 * 这一根整根跳过，从下一根开始判——偏向不强平。已不在的仓位顺手清掉。
 *
 * 时钟落到下限之前超过 discontinuityMs（带着仓位跳回更早的日期、倒放之后再正放），
 * 下限改从这一刻算起——否则仓位要等时钟走回它的开仓时刻才重新可判，跳得远就等于永久免死。
 */
export function updateRiskFloors(
  prev: ReadonlyMap<string, RiskFloorEntry>,
  positions: readonly Position[],
  lastSeenEnd: number | undefined,
  candleEnd: number,
  discontinuityMs = Number.POSITIVE_INFINITY,
): Map<string, RiskFloorEntry> {
  const trusted = lastSeenEnd != null && Number.isFinite(lastSeenEnd) && candleEnd >= lastSeenEnd;
  const bound = trusted ? (lastSeenEnd as number) : candleEnd;
  const next = new Map<string, RiskFloorEntry>();
  for (const position of positions) {
    const since = positionRiskSince(position, 1);
    const kept = prev.get(position.id);
    if (kept && kept.since === since) {
      next.set(position.id, kept.floor - candleEnd > discontinuityMs ? { since, floor: candleEnd } : kept);
      continue;
    }
    const floor = since == null
      ? bound
      : since - candleEnd > discontinuityMs ? candleEnd : Math.max(since, bound);
    next.set(position.id, { since, floor });
  }
  return next;
}

/**
 * 逐仓强平的结算：**亏掉的恰好是这笔仓位的隔离保证金**，不多也不少。
 *
 * 事故：原来按判定用的那个价全额结算。价格一跳过强平价（或者用了陈价），
 * 记录里的亏损就会比保证金大好几倍——NAORIS 那两张空单记录亏 4.6 万和 3.1 万，
 * 保证金却只有 1.37 万和 0.91 万。而钱包在逐仓强平时一分不动（保证金开仓时已扣），
 * 于是「Σ记录盈亏」与「钱包变化」永久分叉，b、R 全都比真实多亏一截。
 *
 * 币安的做法：强平后隔离保证金全部损失，剩下没亏完的部分作为强平费进保险基金；
 * 亏穿的部分由保险基金承担，不再向用户追索。这里照此记账：
 *   净盈亏 = −隔离保证金
 *   平仓手续费按平仓价照收
 *   强平费 = 保证金扣掉亏损与平仓费之后剩下的部分，亏穿时为 0
 */
export function isolatedLiquidationSettlement(input: {
  symbol: string;
  position: Position;
  exitPrice: number;
}): CloseRecordTotals {
  const { symbol, position, exitPrice } = input;
  const marginUsd = Math.max(0, Number(position.isolatedMargin) || 0);
  const grossPnl = calcUnrealizedPnl(position, exitPrice);
  const { feeUsd: closeFee, feeCoin: closeFeeCoin } = getSettlementFeeParts(symbol, position, exitPrice, false);
  const netPnl = -marginUsd;
  const leftover = grossPnl - closeFee - netPnl;
  const liqFee = Number.isFinite(leftover) ? Math.max(0, leftover) : 0;
  const feeCoin = closeFeeCoin != null && exitPrice > 0 ? closeFeeCoin + liqFee / exitPrice : closeFeeCoin;
  return {
    netPnl,
    feeUsd: closeFee + liqFee,
    feeCoin,
    slippageUsd: 0,
    notionalUsd: getPositionNotionalUsd(symbol, position, exitPrice),
  };
}
