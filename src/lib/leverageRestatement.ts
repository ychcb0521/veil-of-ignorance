import type { PendingOrder, Position } from '@/types/trading';
import {
  calcLiquidationPrice,
  calcUnrealizedPnl,
  getMaxLeverageForNotional,
  LEVERAGE_TIERS,
  MAINTENANCE_MARGIN_RATE,
} from '@/types/trading';
import { getPositionNotionalUsd, isCoinSettled, isPositionOpen } from '@/lib/tradingSettlement';

/**
 * 改一个标的的杠杆——**同时**重述该标的下所有持仓与挂单。
 *
 * 提杠杆 = 降低保证金地板 = 释放保证金。名义、张数、开仓价一概不动：
 *
 *     保证金 = 名义(按开仓价) ÷ 杠杆
 *     释放   = 名义 × (1/L₁ − 1/L₂)          （L₂ > L₁ 时为正）
 *
 * 这条正是「提杠杆间接换取加仓弹药」的机制,也是它唯一会**凭空造钱**的地方——
 * 见下面 releaseUsd 的注释。
 */

export type LeverageRefusalCode =
  | 'no-change'
  | 'no-price'
  | 'below-floor'
  | 'tier-cap'
  | 'would-liquidate';

export interface LeverageLegPlan {
  positionId: string;
  side: Position['side'];
  from: number;
  to: number;
  marginBefore: number;
  marginAfter: number;
  releaseUsd: number;
  releaseCoin: number;
  liqBefore: number | null;
  liqAfter: number | null;
  next: Position;
}

export interface LeverageChangePlan {
  ok: boolean;
  refusal: { code: LeverageRefusalCode; message: string } | null;
  symbol: string;
  from: number;
  to: number;
  /** 滑块下限：有持仓时只能升不能降。 */
  floorLeverage: number;
  /** 滑块上限：按该标的**总**名义（持仓 + 非减仓挂单）查档位。 */
  tierMaxLeverage: number;
  /** 「当前杠杆倍数最高可开 N USDT」——档位的反读。 */
  tierMaxNotionalUsd: number;
  /** 立刻触发强平的杠杆下界；≥ 它即拒绝。无持仓时为 Infinity。 */
  maxSafeLeverage: number;
  legs: LeverageLegPlan[];
  /** 释放回余额的总额（USD）。 */
  totalReleaseUsd: number;
  /** 会被一并重述的挂单（只开仓单，减仓单不动）。 */
  restatedOrderIds: string[];
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampLev = (v: number) => Math.max(1, Math.min(125, Math.round(v)));

/** 档位反读：给定杠杆，最多能开多少名义。 */
export function maxNotionalForLeverage(leverage: number): number {
  let best = 0;
  for (const tier of LEVERAGE_TIERS) {
    if (tier.maxLeverage >= leverage) best = Math.max(best, tier.maxNotional);
  }
  return best;
}

/** 该标的的总敞口：持仓按标记价 + 非减仓挂单按其委托价。档位要看总量，不是单笔。 */
export function symbolExposureNotionalUsd(
  symbol: string,
  positions: Position[],
  orders: PendingOrder[],
  markPrice: number,
): number {
  let total = 0;
  for (const p of positions) {
    if (!isPositionOpen(p)) continue;
    const px = markPrice > 0 ? markPrice : p.entryPrice;
    total += Math.abs(getPositionNotionalUsd(symbol, p, px));
  }
  for (const o of orders) {
    if (o.reduceOnly) continue;
    const px = o.price > 0 ? o.price : (o.stopPrice > 0 ? o.stopPrice : markPrice);
    if (!(px > 0)) continue;
    total += Math.abs(getPositionNotionalUsd(symbol, o as unknown as Position, px));
  }
  return total;
}

/**
 * 提到多高会**当场**被强平。
 *
 * 引擎判的是「逐仓保证金 + 未实现盈亏 ≤ 按**标记价**算的名义 × 维持保证金率」
 * （liquidationGuards）。把保证金拆成「地板 + 手动追加的盈余 S」：
 *
 *     N_entry/L + S + pnl ≤ N_mark·mmr
 *     ⟺ L ≥ N_entry / (N_mark·mmr − pnl − S)
 *
 * 注意分母用的是**标记价**下的名义，而卡片上的强平价用的是开仓价下的名义——
 * 两者不是一个数，不能拿卡片上的强平价来反推这个界。
 */
export function maxSafeLeverageForPosition(
  symbol: string,
  position: Position,
  markPrice: number,
): number {
  if (position.marginMode !== 'isolated') return Infinity;
  if (!isPositionOpen(position) || !(markPrice > 0)) return Infinity;
  const nEntry = Math.abs(getPositionNotionalUsd(symbol, position, position.entryPrice));
  const nMark = Math.abs(getPositionNotionalUsd(symbol, position, markPrice));
  if (!(nEntry > 0)) return Infinity;
  const floor = nEntry / Math.max(1, position.leverage);
  const surplus = Math.max(0, Number(position.isolatedMargin ?? position.margin) - floor);
  const pnl = calcUnrealizedPnl(position, markPrice);
  const denom = nMark * MAINTENANCE_MARGIN_RATE - pnl - surplus;
  return denom > 0 ? nEntry / denom : Infinity;
}

/** 把一笔持仓重述到新杠杆。名义、张数、开仓价不动；只动保证金与余额。 */
function restateLeg(symbol: string, p: Position, to: number): LeverageLegPlan {
  const from = Math.max(1, Number(p.leverage) || 1);
  const nEntry = Math.abs(getPositionNotionalUsd(symbol, p, p.entryPrice));
  /**
   * 释放额按**开仓价**折，不按标记价。
   *
   * 币本位的 marginCoin 在开仓那一刻就锚死在 N/(E·L) 上；按标记价折会让它随行情漂移，
   * 而币本位的强平价只读 marginCoin ——「高价提、低价降」来回几次就能把强平价
   * 推得离标记价任意远，凭空拿到下跌保护。所以这段不能借用按标记价折算的
   * handleAdjustMargin，必须自己算。
   */
  const releaseUsd = nEntry * (1 / from - 1 / to);
  const releaseCoin = p.entryPrice > 0 ? releaseUsd / p.entryPrice : 0;
  const coin = isCoinSettled(p);

  const next: Position = {
    ...p,
    leverage: to,
    margin: Math.max(0, Number(p.margin) - releaseUsd),
    isolatedMargin: p.isolatedMargin != null
      ? Math.max(0, Number(p.isolatedMargin) - releaseUsd)
      : undefined,
    marginCoin: coin && p.marginCoin != null
      ? Math.max(0, Number(p.marginCoin) - releaseCoin)
      : p.marginCoin,
  };

  const liqBefore = calcLiquidationPrice(p);
  const liqAfter = calcLiquidationPrice(next);
  return {
    positionId: p.id,
    side: p.side,
    from,
    to,
    marginBefore: Number(p.isolatedMargin ?? p.margin),
    marginAfter: Number(next.isolatedMargin ?? next.margin),
    releaseUsd,
    releaseCoin,
    liqBefore: Number.isFinite(liqBefore) ? liqBefore : null,
    liqAfter: Number.isFinite(liqAfter) ? liqAfter : null,
    next,
  };
}

const refuse = (
  code: LeverageRefusalCode,
  message: string,
  base: Omit<LeverageChangePlan, 'ok' | 'refusal'>,
): LeverageChangePlan => ({ ...base, ok: false, refusal: { code, message } });

export function planLeverageChange(args: {
  symbol: string;
  positions: Position[];
  orders: PendingOrder[];
  markPrice: number;
  currentLeverage: number;
  nextLeverage: number;
}): LeverageChangePlan {
  const { symbol, markPrice, currentLeverage } = args;
  const to = clampLev(args.nextLeverage);
  const open = (args.positions ?? []).filter(isPositionOpen);
  const orders = args.orders ?? [];

  /**
   * 下限 = 现有持仓里最高的那个杠杆。**有持仓时只能升不能降**（与币安一致）。
   * 降杠杆要**倒扣**余额，而下单面板拖一下滑块就该扣钱是不能接受的；
   * 更要命的是扣款可能失败，一旦失败 leverageMap 与 position.leverage 就分叉，
   * 而合并键把杠杆算在内——下一笔成交会另开一张卡，等于拖一下滑块拆了仓位。
   */
  const floorLeverage = open.length > 0
    ? Math.max(1, ...open.map(p => Math.max(1, Number(p.leverage) || 1)))
    : 1;

  const exposure = symbolExposureNotionalUsd(symbol, open, orders, markPrice);
  const tierMaxLeverage = exposure > 0 ? getMaxLeverageForNotional(exposure) : 125;
  const maxSafeLeverage = open.length > 0
    ? Math.min(...open.map(p => maxSafeLeverageForPosition(symbol, p, markPrice)))
    : Infinity;

  const base: Omit<LeverageChangePlan, 'ok' | 'refusal'> = {
    symbol,
    from: currentLeverage,
    to,
    floorLeverage,
    tierMaxLeverage,
    tierMaxNotionalUsd: maxNotionalForLeverage(to),
    maxSafeLeverage,
    legs: [],
    totalReleaseUsd: 0,
    restatedOrderIds: [],
  };

  if (to === currentLeverage) return refuse('no-change', '杠杆未变', base);
  // 有持仓却拿不到价，就不要在一个自己都不敢担保的价上重述风险。
  if (open.length > 0 && !(markPrice > 0)) {
    return refuse('no-price', '暂时取不到标记价，无法调整杠杆', base);
  }
  if (open.length > 0 && to < floorLeverage) {
    return refuse('below-floor', `逐仓有持仓时只能提高杠杆，当前最低 ${floorLeverage}x`, base);
  }
  if (to > tierMaxLeverage) {
    return refuse(
      'tier-cap',
      `本标的总敞口 ${Math.round(exposure).toLocaleString('en-US')} USDT，最高 ${tierMaxLeverage}x`,
      base,
    );
  }
  if (to >= maxSafeLeverage) {
    return refuse(
      'would-liquidate',
      `提到 ${to}x 会立即触发强平（上限 ${maxSafeLeverage.toFixed(2)}x）`,
      base,
    );
  }

  const legs = open.map(p => restateLeg(symbol, p, to));
  return {
    ...base,
    ok: true,
    refusal: null,
    legs,
    totalReleaseUsd: legs.reduce((s, l) => s + l.releaseUsd, 0),
    // 减仓单不动：它的 leverage 只是重发时的元数据，而且它是平仓的，不占新保证金。
    restatedOrderIds: orders.filter(o => !o.reduceOnly && Number(o.leverage) !== to).map(o => o.id),
  };
}
