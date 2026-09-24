import type { PendingOrder, Position, SettlementMode } from '@/types/trading';
import { calcLiquidationPrice, calcUnrealizedPnl } from '@/types/trading';
import { getPositionNotionalUsd, isCoinSettled, isPositionOpen } from '@/lib/tradingSettlement';
import { hedgeBaseKindOf, positionMaintenanceMarginUsd } from '@/lib/positionRiskModel';
import { formatUSDT } from '@/lib/formatters';
import { clampLeverageToTiers, resolveSymbolTiers, usdNotionalFromTierAmount } from '@/lib/leverageTiers';
import {
  checkLeverageChange,
  leverageFloorOf,
  limitSettlementOf,
  symbolExposureUsd,
  type LimitSettlement,
} from '@/lib/positionLimit';
import {
  UNLIMITED_MAX_LEVERAGE,
  isUnlimitedLimitMode,
  type PositionLimitMode,
} from '@/lib/positionLimitMode';

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
 *
 * 持仓限制模式（lib/positionLimitMode）：币安标准下有持仓只能升不能降（-4161）、要过分层上限；
 * 无限制模式下杠杆 1–150x、不判分层上限，有持仓时**也能降**——降杠杆 = 追加保证金（释放额为负），
 * 从可用余额里扣，所以只多一条「可用余额补不上就拒」（insufficient-balance），余额永远不会被扣成负数。
 */

export type LeverageRefusalCode =
  | 'no-change'
  | 'no-price'
  | 'below-floor'
  /** 敞口超过目标杠杆的上限，降到现有敞口放得下的杠杆就行。 */
  | 'tier-cap'
  /**
   * 现有敞口在用户还能选的最低杠杆上也放不下（逐仓持仓把下限卡住了，或超过最高一档）：
   * 调杠杆解决不了，只能减仓 / 撤单。停在当前杠杆时也报它，不报「杠杆未变」。
   */
  | 'exposure-over-cap'
  | 'would-liquidate'
  /** 无限制模式下降杠杆要追加的保证金超过可用余额。 */
  | 'insufficient-balance';

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
  /**
   * 该标的**总**敞口（持仓 + 非减仓挂单）所在档位允许的最高杠杆（币安分层，按合约）；
   * 超过最高一档上限为 0。滑块上限是合约的最高杠杆 symbolMaxLeverage，不是它。
   */
  tierMaxLeverage: number;
  /** 这个合约（当前结算方式）的最高杠杆，即滑块上限。 */
  symbolMaxLeverage: number;
  /** 「当前杠杆倍数最高可持有头寸」——目标杠杆下的档位上限，单位见 tierUnit。 */
  tierCap: number;
  /** 档位单位：'USDT'、币名（真币本位）或 'USD'（合成币本位）。 */
  tierUnit: string;
  /** 当前敞口（档位单位），与 tierCap 可直接比较。 */
  tierExposure: number;
  /** tierCap 折成 USD 名义（真币本位按标记价折；无价时为 NaN）。 */
  tierMaxNotionalUsd: number;
  /** 立刻触发强平的杠杆下界；≥ 它即拒绝。无持仓时为 Infinity。 */
  maxSafeLeverage: number;
  legs: LeverageLegPlan[];
  /** 释放回余额的总额（USD）；无限制模式下降杠杆时为负（要从余额里追加的保证金）。 */
  totalReleaseUsd: number;
  /** 判的时候用的持仓限制模式；缺省（旧调用口径）为币安标准。 */
  limitMode?: PositionLimitMode;
  /** 会被一并重述的挂单（只开仓单，减仓单不动）。 */
  restatedOrderIds: string[];
}

/**
 * 该标的的总敞口（USD）：持仓按标记价 + 非减仓挂单按其委托价（TWAP 只算没成交的部分）。
 * 档位要看总量，不是单笔。实现在 positionLimit（分层判定的唯一入口），这里保留旧名给界面用。
 */
export function symbolExposureNotionalUsd(
  symbol: string,
  positions: Position[],
  orders: PendingOrder[],
  markPrice: number,
): number {
  return symbolExposureUsd(symbol, positions, orders, markPrice);
}

/** 没说结算方式时按手上的仓位 / 挂单推：有币本位的就算币本位，否则 U 本位。 */
function inferSettlement(positions: Position[], orders: PendingOrder[]): LimitSettlement {
  const items = [...positions, ...orders.filter(o => !o.reduceOnly)];
  return items.some(i => limitSettlementOf(i) === 'coin') ? 'coin' : 'usdt';
}

/**
 * 提到多高会**当场**被强平。
 *
 * 引擎判的是「逐仓保证金 + 未实现盈亏 ≤ 标记价下的维持保证金 MM_mark」
 * （liquidationGuards）。把保证金拆成「地板 + 手动追加的盈余 S」：
 *
 *     N_entry/L + S + pnl ≤ MM_mark
 *     ⟺ L ≥ N_entry / (MM_mark − pnl − S)
 *
 * MM_mark 按仓位的风险模型取（positionMaintenanceMarginUsd）：旧仓位 = N_mark × 0.4%，
 * 分层仓位 = 按币安档位算，与杠杆无关，所以提杠杆不改变它。
 * 注意旧模型下卡片上的强平价用的是开仓价下的名义——
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
  if (!(nEntry > 0)) return Infinity;
  const floor = nEntry / Math.max(1, position.leverage);
  const surplus = Math.max(0, Number(position.isolatedMargin ?? position.margin) - floor);
  const pnl = calcUnrealizedPnl(position, markPrice);
  const denom = positionMaintenanceMarginUsd(symbol, position, markPrice) - pnl - surplus;
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

  const liqBefore = calcLiquidationPrice(p, symbol);
  const liqAfter = calcLiquidationPrice(next, symbol);
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
  /** 下单面板当前的结算方式（决定用哪张分层）；缺省按手上的仓位 / 挂单推断。 */
  settlementMode?: SettlementMode;
  /** 持仓限制模式（lib/positionLimitMode）；缺省按币安标准。 */
  limitMode?: PositionLimitMode | null;
  /**
   * 可用余额（USD）：无限制模式下有持仓时降杠杆要从这里追加保证金，补不上就拒。
   * 缺省不判（币安标准下降杠杆本来就被拒，用不到它）。
   */
  availableBalance?: number;
}): LeverageChangePlan {
  const { symbol, markPrice, currentLeverage } = args;
  const open = (args.positions ?? []).filter(isPositionOpen);
  const orders = args.orders ?? [];
  const settlement: LimitSettlement = args.settlementMode
    ? (args.settlementMode === 'coin' ? 'coin' : 'usdt')
    : inferSettlement(open, orders);
  const tiers = resolveSymbolTiers(symbol, settlement);
  if (isUnlimitedLimitMode(args.limitMode)) {
    return planUnlimitedLeverageChange({ ...args, open, orders, settlement });
  }
  // 滑块与输入框之外的调用也不许越过合约的最高杠杆（BTCUSDT 150x、KAITOUSDT 75x……）。
  const to = clampLeverageToTiers(tiers, args.nextLeverage);

  /**
   * 下限 = 现有持仓里最高的那个杠杆。**有持仓时只能升不能降**（与币安一致）。
   * 降杠杆要**倒扣**余额，而下单面板拖一下滑块就该扣钱是不能接受的；
   * 更要命的是扣款可能失败，一旦失败 leverageMap 与 position.leverage 就分叉，
   * 而合并键把杠杆算在内——下一笔成交会另开一张卡，等于拖一下滑块拆了仓位。
   */
  const floorLeverage = leverageFloorOf(open);

  /**
   * 分层上限与下单面板、引擎下单走同一个判定（positionLimit）：
   * 敞口在目标杠杆的「最高可持有头寸」之内才放行。
   */
  const limit = checkLeverageChange({ symbol, settlement, leverage: to, positions: open, orders, markPrice });
  const maxSafeLeverage = open.length > 0
    ? Math.min(...open.map(p => maxSafeLeverageForPosition(symbol, p, markPrice)))
    : Infinity;

  const base: Omit<LeverageChangePlan, 'ok' | 'refusal'> = {
    symbol,
    from: currentLeverage,
    to,
    floorLeverage,
    tierMaxLeverage: limit.maxLeverageForResult,
    symbolMaxLeverage: tiers.maxLeverage,
    tierCap: limit.cap,
    tierUnit: limit.unit,
    tierExposure: limit.exposureAfter,
    tierMaxNotionalUsd: usdNotionalFromTierAmount(limit.tiers, limit.cap, markPrice),
    maxSafeLeverage,
    legs: [],
    totalReleaseUsd: 0,
    restatedOrderIds: [],
  };

  /**
   * 「杠杆没变」有一个例外：旧版本的滑块到 125x，保存值读出来已按合约夹到上限（KAITOUSDT 75x），
   * 可挂单上还写着 125x。此时在上限上确认，正是要把这些挂单拉回合约允许的杠杆，不能当成没变。
   */
  const overMaxOrders = orders.some(o => !o.reduceOnly
    && Number(o.leverage) > resolveSymbolTiers(symbol, limitSettlementOf(o)).maxLeverage);

  /**
   * 死局：现有敞口在用户还能选的最低杠杆（下限，且不超过合约最高杠杆）上也放不下。
   * 更新前按旧规则开的大仓位、或行情把持仓的价值推过了线，都会落进来——
   * 这时降杠杆被「只能升不能降」挡住、升杠杆上限只会更低，唯一的出路是减仓 / 撤单。
   * 对话框不能再说「请调低杠杆倍数至 Nx 以下」（N 低于下限，根本选不到）。
   */
  const lowestSelectable = Math.min(floorLeverage, tiers.maxLeverage);
  const atLowest = markPrice > 0 && lowestSelectable !== to
    ? checkLeverageChange({ symbol, settlement, leverage: lowestSelectable, positions: open, orders, markPrice })
    : limit;
  const stuck = markPrice > 0 && !atLowest.ok && atLowest.reason !== 'leverage-above-max'
    ? atLowest.message
    : null;

  if (to === currentLeverage && !overMaxOrders) {
    return stuck ? refuse('exposure-over-cap', stuck, base) : refuse('no-change', '杠杆未变', base);
  }
  // 有持仓却拿不到价，就不要在一个自己都不敢担保的价上重述风险。
  if (open.length > 0 && !(markPrice > 0)) {
    return refuse('no-price', '暂时取不到标记价，无法调整杠杆', base);
  }
  if (open.length > 0 && to < floorLeverage) {
    // 更新前按旧规则开的仓位（或无限制模式下开的仓位），杠杆可能高过合约现在的最高杠杆（LUMIAUSDT 35x / 最高 10x）：
    // 滑块上哪个值都选不了，照实说。
    const floorText = floorLeverage > tiers.maxLeverage
      ? `逐仓有持仓时不能降杠杆：现有仓位按 ${floorLeverage}x 开（高于该合约现在的最高杠杆 ${tiers.maxLeverage}x，`
        + `是${overMaxOrigin(open, tiers.maxLeverage)}），平仓前无法调整杠杆；新单最高只能用 ${tiers.maxLeverage}x`
      : `逐仓有持仓时只能提高杠杆，当前最低 ${floorLeverage}x`;
    return refuse('below-floor', stuck ? `${floorText}。${stuck}` : floorText, base);
  }
  if (!limit.ok) {
    // limit 的文案已按「降得下去 / 降不下去」选好出路（leverageChangeRefusalMessage）。
    return refuse(
      stuck && limit.reason !== 'leverage-above-max' ? 'exposure-over-cap' : 'tier-cap',
      limit.message ?? `请调低杠杆倍数至 ${limit.maxLeverageForResult}x 以下`,
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

/**
 * 杠杆高过合约最高杠杆的那几笔仓位是怎么来的（below-floor 文案）：
 * 只有无限制模式下开的 →「无限制模式下开的」；只有更新前的（或说不清）→「更新前按旧规则开的」（与改动前逐字相同）；
 * 两种都有 →「更新前按旧规则或无限制模式下开的」。
 */
function overMaxOrigin(open: readonly Position[], maxLeverage: number): string {
  const over = open.filter(p => Math.max(1, Number(p.leverage) || 1) > maxLeverage);
  const kinds = new Set(over.map(p => hedgeBaseKindOf(p)));
  const unlimited = kinds.has('unlimited');
  const pre = kinds.has('pre-update') || !unlimited;
  if (unlimited && pre) return '更新前按旧规则或无限制模式下开的';
  return unlimited ? '无限制模式下开的' : '更新前按旧规则开的';
}

/**
 * 无限制模式的改杠杆：任何币种 1–150x，不判分层上限、不挡降杠杆（有持仓也能降）。
 * 保留的只有不是「限制」的机制：杠杆没变、有持仓却取不到价、提到会当场强平、降杠杆要追加的保证金可用余额补不上。
 * 分层相关的字段（tierCap / tierMaxNotionalUsd 等）填中性值（上限 Infinity），界面在这个模式下不显示它们。
 */
function planUnlimitedLeverageChange(args: {
  symbol: string;
  open: Position[];
  orders: PendingOrder[];
  settlement: LimitSettlement;
  markPrice: number;
  currentLeverage: number;
  nextLeverage: number;
  availableBalance?: number;
}): LeverageChangePlan {
  const { symbol, open, orders, markPrice, currentLeverage } = args;
  const to = clampLeverageToTiers({ maxLeverage: UNLIMITED_MAX_LEVERAGE }, args.nextLeverage);
  const tiers = resolveSymbolTiers(symbol, args.settlement);
  const maxSafeLeverage = open.length > 0
    ? Math.min(...open.map(p => maxSafeLeverageForPosition(symbol, p, markPrice)))
    : Infinity;
  const base: Omit<LeverageChangePlan, 'ok' | 'refusal'> = {
    symbol,
    from: currentLeverage,
    to,
    floorLeverage: 1,
    tierMaxLeverage: UNLIMITED_MAX_LEVERAGE,
    symbolMaxLeverage: UNLIMITED_MAX_LEVERAGE,
    tierCap: Infinity,
    tierUnit: tiers.unit,
    tierExposure: symbolExposureUsd(symbol, open, orders, markPrice, { settlement: args.settlement }),
    tierMaxNotionalUsd: Infinity,
    maxSafeLeverage,
    legs: [],
    totalReleaseUsd: 0,
    restatedOrderIds: [],
    limitMode: 'unlimited',
  };
  // 「杠杆没变」的例外与币安标准同一个道理：挂单上的杠杆超出 1–150x（不应发生）时，停在原值确认也要把它们拉回来。
  const overMaxOrders = orders.some(o => !o.reduceOnly && Number(o.leverage) > UNLIMITED_MAX_LEVERAGE);
  if (to === currentLeverage && !overMaxOrders) return refuse('no-change', '杠杆未变', base);
  if (open.length > 0 && !(markPrice > 0)) {
    return refuse('no-price', '暂时取不到标记价，无法调整杠杆', base);
  }
  if (to >= maxSafeLeverage) {
    return refuse(
      'would-liquidate',
      `提到 ${to}x 会立即触发强平（上限 ${maxSafeLeverage.toFixed(2)}x）`,
      base,
    );
  }
  const legs = open.map(p => restateLeg(symbol, p, to));
  const totalReleaseUsd = legs.reduce((s, l) => s + l.releaseUsd, 0);
  /**
   * 降杠杆 = 追加保证金：从可用余额里扣。补不上就拒——扣款失败会让 leverageMap 与 position.leverage 分叉
   * （合并键把杠杆算在内，下一笔成交就另开一张卡），余额也不能被扣成负数。
   */
  const available = Number(args.availableBalance);
  if (totalReleaseUsd < 0 && Number.isFinite(available) && -totalReleaseUsd > Math.max(0, available) + 1e-9) {
    // 与对话框「追加保证金」那一行同一种写法：千分位、两位小数、带单位（合成 / 真币本位的保证金按 USD 计）
    const unit = args.settlement === 'coin' ? 'USD' : 'USDT';
    return refuse(
      'insufficient-balance',
      `降到 ${to}x 要追加保证金 ${formatUSDT(-totalReleaseUsd)} ${unit}，可用余额只有 ${formatUSDT(Math.max(0, available))} ${unit}：`
        + '请先减仓，或少降一些',
      { ...base, legs, totalReleaseUsd },
    );
  }
  return {
    ...base,
    ok: true,
    refusal: null,
    legs,
    totalReleaseUsd,
    restatedOrderIds: orders.filter(o => !o.reduceOnly && Number(o.leverage) !== to).map(o => o.id),
  };
}
