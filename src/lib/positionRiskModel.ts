/**
 * 仓位用哪套维持保证金 / 强平价模型——**所有**读维持保证金的地方都经过这里。
 *
 * 两套模型：
 *   旧模型（legacy）：维持保证金 = 名义 × 0.4%，所有合约一个费率。
 *   分层模型（binance-tiers-v1）：维持保证金 = 名义 × 档位费率 − 速算扣除额，
 *     档位按合约取自币安快照（leverageTiers），强平价用币安的逐仓公式并在跨档时换档重算。
 *
 * 来源（riskModel 一个字段，三种取值，**显式**记下，不靠「没有戳」去猜）：
 *   · 'binance-tiers-v1'（分层）：本次更新之后经引擎下的开仓委托（handlePlaceOrder，含分段子单、
 *     跟踪委托、TWAP、条件单）都带它；这样的委托成交开出的仓位按分层模型。
 *   · 'legacy-hedge-v1'（对冲豁免）：本次更新之后下的、**只靠**「对冲更新前的仓位」那条豁免才放行的委托
 *     （positionLimit 文件头），以及它们成交开出的仓位。按旧的 0.4% 模型算（它的名义可能远超分层允许的大小，
 *     套上分层会一成交就爆），但它**不是**更新前的仓位：不能再给别的单当豁免的底，
 *     反而占着它对冲掉的那份额度；挂着的时候触发 / 成交那一刻要再判一次豁免是否仍成立。
 *   · 没有 riskModel（更新前）：升级之前开的仓位、升级之前挂出的委托，以及这些旧委托之后成交开出的仓位
 *     （它们是按旧规则放行的：旧通用表、滑块到 125x、默认 35x，套上分层会一成交就在开仓价上被强平）。
 *     只有它们是豁免的底（isPreUpdatePosition）。
 *
 * 切换规则（不追溯）——**仓位开出来之后就不换强平模型**：
 *   · 委托成交时（executeSettlementFill）仓位沿用委托的来源（positionRiskStampForFill）；
 *     挂着的、带来源的委托在触发 / 成交那一刻再判时，由闸门按那一刻的判定改定（settleFillDebit）。
 *   · 【规则一】**合并时存活仓位一律保留「被加仓的那个仓位」（target）的模型与戳**（survivorRiskStamp）。
 *     仓位一旦开出来就不会中途换维持保证金模型、换强平价——没有任何一笔成交能改动一个现有仓位的
 *     维持保证金、强平价或是否 solvent。
 *   · 【规则二】所以**分层的一笔可以并进按旧 0.4% 的仓位**（更新前的、对冲豁免的）：整个仓位仍按旧的
 *     0.4% 算，什么都没被重新定价，也不会多出一条只靠自己那点保证金硬扛的新腿——加仓照旧被旧仓位的
 *     权益扛着（tradingSettlement 里 COAIUSDT 那段事故正是为此）。加仓在**下单**那一刻照样要过分层上限，
 *     这一条没变；过了上限才谈得上合并。
 *   · 【规则三】反过来**不并**：按旧 0.4% 的一笔（更新前的旧委托成交、对冲豁免成交）不并进分层仓位。
 *     存活的会是分层仓位，它要把并进来的那一截名义也按档位定价、推进更高的档，
 *     足以把现有的分层仓位当场强平（算例在 mergeRiskBlocked 的注释里）——那正是规则一禁止的事。
 *   · 【规则四】**豁免的底不因合并变大**：更新前的仓位记着一个冻结的「底」（hedgeBaseUnits），
 *     分层加仓并进来只加仓位的大小、不加这个底；部分平仓按比例缩，平光就没了（hedgeExemptBaseUnits）。
 *     对冲额度、触发 / 成交那一刻的再判、面板的「可开」读的都是这个冻结的底，不是仓位当前的大小。
 *   · 没有戳的仓位（升级前开的、旧委托开的、手工构造的）与豁免仓位一律按旧模型，升级本身不会让任何
 *     现有仓位或现有委托开出的仓位被强平或改变强平价。
 *
 * 这个模块只从 types/trading 引类型（types/trading 的 calcLiquidationPrice 要反过来调它），
 * 名义也在这里就地算，不借 tradingSettlement，免得形成运行期循环依赖。
 */
import type { Position } from '@/types/trading';
import { getCoinContracts, getCoinContractSizeUsd } from '@/lib/coinMargined';
import {
  binanceIsolatedLiquidationPriceCoinm,
  binanceIsolatedLiquidationPriceUsdm,
  resolveSymbolTiers,
  tierAmountFromUsdNotional,
  tierFor,
  usdFaceIsolatedLiquidationPriceCoin,
  type LeverageTier,
  type ResolvedSymbolTiers,
} from '@/lib/leverageTiers';

/** 旧模型的统一维持保证金率 0.4%。types/trading 的 MAINTENANCE_MARGIN_RATE 就是它。 */
export const LEGACY_MAINTENANCE_MARGIN_RATE = 0.004;

export const TIERED_RISK_MODEL = 'binance-tiers-v1' as const;
/** 只靠「对冲更新前的仓位」那条豁免放行的委托与它们开出的仓位：旧 0.4% 模型，但不是更新前的仓位。 */
export const LEGACY_HEDGE_RISK_MODEL = 'legacy-hedge-v1' as const;
export type PositionRiskModelId = typeof TIERED_RISK_MODEL | typeof LEGACY_HEDGE_RISK_MODEL;

type RiskStamped = Pick<Position, 'riskModel' | 'riskSymbol'>;
type RiskPositionLike = Pick<
  Position,
  'side' | 'entryPrice' | 'quantity' | 'leverage' | 'marginMode' | 'settlementMode' | 'contractSizeUsd'
  | 'contracts' | 'margin' | 'marginCoin' | 'isolatedMargin' | 'riskModel' | 'riskSymbol'
>;

/** 新开仓位要盖的戳。symbol 是 positionsMap 的键（仓位对象本身不带标的）。 */
export function positionRiskStamp(symbol: string): Required<RiskStamped> {
  return { riskModel: TIERED_RISK_MODEL, riskSymbol: String(symbol || '').toUpperCase() };
}

/** 对冲豁免仓位的标记（旧模型；标的照样记下）。 */
export function legacyHedgeRiskStamp(symbol: string): Required<RiskStamped> {
  return { riskModel: LEGACY_HEDGE_RISK_MODEL, riskSymbol: String(symbol || '').toUpperCase() };
}

/** 引擎下单时盖在委托上的戳。 */
export const ORDER_RISK_STAMP: Readonly<{ riskModel: typeof TIERED_RISK_MODEL }> = Object.freeze({ riskModel: TIERED_RISK_MODEL });
/** 只靠对冲豁免放行的委托盖的标记。 */
export const ORDER_LEGACY_HEDGE_STAMP: Readonly<{ riskModel: typeof LEGACY_HEDGE_RISK_MODEL }> = Object.freeze({ riskModel: LEGACY_HEDGE_RISK_MODEL });

type RiskModelLike = { riskModel?: string | null } | null | undefined;

/** 一笔成交开出的仓位该带的戳：沿用委托的来源（分层 / 对冲豁免）；委托没有来源（升级前挂出的）就不带，按旧模型。 */
export function positionRiskStampForFill(symbol: string, order: RiskModelLike): RiskStamped {
  if (order?.riskModel === TIERED_RISK_MODEL) return positionRiskStamp(symbol);
  if (order?.riskModel === LEGACY_HEDGE_RISK_MODEL) return legacyHedgeRiskStamp(symbol);
  return {};
}

export function isTieredRiskPosition(position?: Pick<Position, 'riskModel'> | null): boolean {
  return position?.riskModel === TIERED_RISK_MODEL;
}

/** 只靠对冲豁免放行的委托 / 它开出的仓位。 */
export function isLegacyHedgeRisk(item?: RiskModelLike): boolean {
  return item?.riskModel === LEGACY_HEDGE_RISK_MODEL;
}

/**
 * 更新前的仓位（或更新前挂出的委托）：**没有任何** riskModel。只有它们是对冲豁免的底。
 * 豁免仓位、分层仓位、以及将来任何带了来源的仓位都不算。
 */
export function isPreUpdateRisk(item?: RiskModelLike): boolean {
  return !!item && (item.riskModel == null || item.riskModel === '');
}

/** 带着显式来源（分层或对冲豁免）的委托：本次更新之后经引擎下的，触发 / 成交那一刻要再判。 */
export function hasRiskProvenance(item?: RiskModelLike): boolean {
  return item?.riskModel === TIERED_RISK_MODEL || item?.riskModel === LEGACY_HEDGE_RISK_MODEL;
}

/**
 * 【规则一】合并两笔同方向仓位时，存活仓位的来源**一律取被加仓的那个仓位（target）的**，
 * 与并进来的这一笔是什么来源无关：**仓位开出来之后不换强平模型**（DESIGN A3：升级不重新定价任何现有仓位）。
 * target 是更新前的仓位时返回 {}（存活的仍是更新前的仓位，`...target` 本来也没有戳）。
 *
 * 之前这里取的是「更严的那个」（分层 > 豁免 > 更新前）。取更严的那一刻就等于给一个现有仓位换模型：
 * 豁免并进更新前的仓位时两边同是 0.4%、数不变，但分层并进来就会把旧仓位整个套上分层维持保证金。
 * 现在换模型这条路整个封死——需要「底不能借合并变大」的那件事改由**冻结的底**（hedgeExemptBaseUnits）
 * 单独负责，不再靠把整个仓位的来源升级掉。
 */
export function survivorRiskStamp(target: RiskStamped): RiskStamped {
  if (target.riskModel == null) return {};
  return { riskModel: target.riskModel, riskSymbol: target.riskSymbol };
}

/**
 * 【规则四】这个仓位有多少「量」算作对冲豁免的底（hedgeExemptBaseUnits）。
 *
 * 只有更新前的仓位是底（豁免仓位、分层仓位一律 0，见 isPreUpdateRisk）。规则二放开了
 * 「分层加仓并进更新前的仓位」，若照旧拿仓位**当前**的大小当底，一笔分层加仓就把豁免额度顶大一截，
 * 反向再开一笔同样大的超限裸仓位——这正是第 5 轮 F5 那个循环（旧仓位既没减、底却变大）。
 * 所以底单独记在 hedgeBaseUnits 上：
 *   · 没有这个字段（升级前就在的仓位、手工构造的） → 整仓都是底，与改动前一致；
 *   · 合并时只有**更新前的那一笔**成交会把底加大（更新前挂出、更新后才成交的旧委托，用户没法再挂新的）；
 *     分层 / 豁免成交并进来只加仓位的大小，底不动；
 *   · 部分平仓按比例缩（scaleSettlementPosition），平光了仓位本身就没了。
 * 底不会超过仓位当前的量（先加仓再减仓时，缩过的底自然更小）。
 */
export function hedgeExemptBaseUnits(
  position: Pick<Position, 'riskModel' | 'hedgeBaseUnits'> | null | undefined,
  currentUnits: number,
): number {
  if (!position || !isPreUpdateRisk(position)) return 0;
  const units = Number.isFinite(currentUnits) ? Math.max(0, currentUnits) : 0;
  const frozen = Number(position.hedgeBaseUnits);
  if (!Number.isFinite(frozen)) return units;
  return Math.max(0, Math.min(units, frozen));
}

/**
 * 合并之后存活仓位该记多少底（规则四）：target 原来的底 + 只有这一笔本身是**更新前**的成交时才加它的量。
 * target 不是更新前的仓位（豁免 / 分层）时不写这个字段——它本来就不是底。
 */
export function mergedHedgeBaseUnits(
  target: Pick<Position, 'riskModel' | 'hedgeBaseUnits'>,
  targetUnits: number,
  fill: Pick<Position, 'riskModel'>,
  fillUnits: number,
): number | undefined {
  if (!isPreUpdateRisk(target)) return undefined;
  const base = hedgeExemptBaseUnits(target, targetUnits);
  return isPreUpdateRisk(fill) ? base + Math.max(0, Number(fillUnits) || 0) : base;
}

/**
 * 两笔同方向仓位能不能合并（来源这一项）。判据只有一条，**而且是有方向的**：
 * **被加仓的那个仓位（target）是分层的、并进来的这一笔不是**，就不合并。
 *
 * 为什么只挡这一个方向（规则一：仓位开出来之后不换强平模型，存活的一律用 target 的模型）：
 *   · target 分层 × 这一笔按旧 0.4%（更新前的旧委托成交、对冲豁免成交）→ **不并**。
 *     存活的是分层仓位，它会把并进来的那一截名义也按档位定价：那一截从来没过分层（豁免往往远超当前
 *     杠杆允许的大小；更新前的旧委托是按旧通用表、滑块到 125x 放行的），总名义一旦跨进更高的档，
 *     **现有的分层仓位自己就被推到强平价之上**。算例——KAITOUSDT 5x：分层空 9,000 维持保证金
 *     9,000 × 1.5% − 25 = 110；并进一笔 230,000 的豁免对冲后按分层是 239,000 × 10% − 7,700 = 16,200，
 *     而两笔各算各的只需 110 + 920 = 1,030。这是规则一禁止的事，所以挡掉。
 *   · target 按旧 0.4% × 这一笔分层 → **并**（第 7 轮定的规则二，推翻第 6 轮的「两个方向都不并」）。
 *     存活的是旧仓位，整仓仍按 0.4%：**没有任何一个数被重新定价**，旧仓位的维持保证金、强平价照旧，
 *     加仓的那一截也按 0.4%（比币安的分层更松，但它在下单那一刻已经过了分层上限——上限限的是总敞口，
 *     所以靠一路加仓把 0.4% 的仓位堆到上限之上是做不到的）。
 *     换来的是加仓**照旧被旧仓位的权益扛着**：第 6 轮把这个方向也挡掉之后，加到浮盈旧仓位上的那一刀
 *     只有自己那点保证金，标记价 0.96、旧多仓 40,000 @0.50（+92%）上加 10,000 USDT，
 *     那一刀自己的强平价是 0.923452（离标记价 3.81%），而并进去之后整仓是 0.567669（离 41%）——
 *     一次 4% 的回撤就把加仓单独打掉，正是 COAIUSDT 2026-06-13 那次事故的形状。
 *   · 两笔口径相同（都分层、都按旧 0.4%）→ 照常并，存活的仍是 target 的来源。
 *
 * 全矩阵（目标仓位 × 这一笔成交，**不对称**；「并」后面写存活仓位的来源）：
 *   更新前 × 更新前 → 并，仍是更新前（更新前挂出、更新后才成交的旧委托；豁免的底随之变大，见规则四）
 *   更新前 × 分层   → 并，仍是更新前（整仓 0.4%，一个数都不重新定价；**底冻结不变**）
 *   更新前 × 豁免   → 并，仍是更新前（同是 0.4%；豁免那一截不是底，底冻结不变）
 *   豁免   × 豁免   → 并，仍是豁免（同一套 0.4%；豁免不是底）
 *   豁免   × 更新前 → 并，仍是豁免（同是 0.4%；豁免不是底，整仓不是底）
 *   豁免   × 分层   → 并，仍是豁免（整仓 0.4%，不重新定价）
 *   分层   × 分层   → 并，仍是分层（同一套档位；总名义变大导致的维持保证金变化是币安本来的行为）
 *   分层   × 更新前 → **不并**（规则三）。旧委托照旧自己开一个更新前的仓位，与「同方向什么都没有」时一样。
 *   分层   × 豁免   → **不并**（规则三）
 * 任一边不存在（null）时谈不上合并，返回 false。
 *
 * 注意 a、b 的**顺序有意义**：a 是现有仓位（target），b 是这一笔成交。调用方
 * （tradingSettlement.mergeBlocker）两处都是这个顺序。
 */
export function mergeRiskBlocked(a: RiskModelLike, b: RiskModelLike): boolean {
  if (!a || !b) return false;
  const tiered = (x: RiskModelLike) => x?.riskModel === TIERED_RISK_MODEL;
  // 只挡一个方向：现有仓位是分层的、并进来的这一笔按旧 0.4% —— 合并会把那一截也按档位定价，
  // 把现有的分层仓位推进更高的档、当场强平。反过来（分层并进旧仓位）整仓仍按 0.4%，不重新定价，照并。
  return tiered(a) && !tiered(b);
}

/**
 * 合成仓位（合并卡片上拼出来的那个）该带哪个戳：所有成员都是分层模型才带，否则按旧模型——
 * 与引擎逐笔判定时各自的模型保持同一取向（混合时偏向旧模型，不凭空套用分层）。
 */
export function sharedRiskStamp(positions: readonly (RiskStamped | null | undefined)[]): RiskStamped {
  const list = positions.filter(Boolean) as RiskStamped[];
  if (list.length === 0 || !list.every(p => isTieredRiskPosition(p))) return {};
  return { riskModel: TIERED_RISK_MODEL, riskSymbol: list[0].riskSymbol };
}

/** 一组仓位的模型构成，用于爆仓弹窗说明维持保证金口径。 */
export function summarizeRiskModels(
  positions: readonly (Pick<Position, 'riskModel'> | null | undefined)[],
): 'legacy' | 'tiered' | 'mixed' | undefined {
  let tiered = 0;
  let legacy = 0;
  for (const p of positions) {
    if (!p) continue;
    if (isTieredRiskPosition(p)) tiered++;
    else legacy++;
  }
  if (tiered === 0 && legacy === 0) return undefined;
  if (tiered > 0 && legacy > 0) return 'mixed';
  return tiered > 0 ? 'tiered' : 'legacy';
}

/** 仓位对应的分层。显式传入的 symbol 优先，否则用戳里记下的标的。 */
export function resolvePositionTiers(position: RiskPositionLike, symbol?: string | null): ResolvedSymbolTiers | null {
  const sym = symbol || position.riskSymbol;
  if (!sym) return null;
  return resolveSymbolTiers(sym, position.settlementMode === 'coin' ? 'coin' : 'usdt');
}

/** 与 tradingSettlement.getPositionNotionalUsd 同一口径：U 本位 = 数量 × 价；币本位 = 张数 × 面值。 */
function notionalUsd(symbol: string, position: RiskPositionLike, price?: number): number {
  if (position.settlementMode === 'coin') {
    return getCoinContracts(position) * getCoinContractSizeUsd(symbol, position);
  }
  const px = Number(price ?? position.entryPrice ?? 0);
  return Number(position.quantity ?? 0) * px;
}

/** 分层模型下，仓位在这个价位上所在的档位与以档位单位计的名义。 */
export function positionTierAt(
  symbol: string,
  position: RiskPositionLike,
  price: number,
): { resolved: ResolvedSymbolTiers; tier: LeverageTier; notional: number } | null {
  const resolved = resolvePositionTiers(position, symbol);
  if (!resolved) return null;
  const notional = tierAmountFromUsdNotional(resolved, Math.abs(notionalUsd(symbol, position, price)), price);
  if (!Number.isFinite(notional)) return null;
  return { resolved, tier: tierFor(resolved.tiers, notional), notional };
}

/**
 * 仓位在价格 price 上的维持保证金（USD）——引擎强平判据、全仓汇总、保证金比率、
 * 「提杠杆会不会当场爆仓」都读这一个函数。
 *
 *   旧模型：USD 名义 × 0.4%
 *   分层 · U 本位：n = 数量 × 价；n × 费率 − cum
 *   分层 · 币本位：c = 张数 × 面值 ÷ 价（币）；(c × 费率 − cum) × 价 = N × 费率 − cum × 价
 *   分层 · 合成币本位：N × 费率 − cum（N = 张数 × 面值，cum 以 USD 计）
 *
 * 不传价格时按开仓价（与 getPositionNotionalUsd 一致）。真币本位分层在价格 ≤ 0 时返回 NaN——
 * 名义要按价折成币，调用方的「算不清就不强平」会接住它。
 */
export function positionMaintenanceMarginUsd(symbol: string, position: RiskPositionLike, price?: number): number {
  const legacy = () => notionalUsd(symbol, position, price) * LEGACY_MAINTENANCE_MARGIN_RATE;
  if (!isTieredRiskPosition(position)) return legacy();
  const resolved = resolvePositionTiers(position, symbol);
  // 戳里连标的都没有（不应发生）：查不到分层，只能按旧模型。
  if (!resolved) return legacy();
  const px = Number(price ?? position.entryPrice ?? 0);
  if (resolved.measure === 'coin' && !(px > 0)) return NaN;
  const usd = Math.abs(notionalUsd(symbol, position, px));
  const notional = tierAmountFromUsdNotional(resolved, usd, px);
  if (!Number.isFinite(notional)) return NaN;
  if (!(notional > 0)) return 0;
  const tier = tierFor(resolved.tiers, notional);
  const inTierUnit = notional * tier.maintenanceMarginRate - tier.maintenanceAmount;
  return resolved.measure === 'coin' ? inTierUnit * px : inTierUnit;
}

/** 维持保证金率的展示：旧模型是固定的 0.4%，分层模型是这一刻所在档位的费率。 */
export function positionMaintenanceRateAt(symbol: string, position: RiskPositionLike, price?: number): {
  model: 'legacy' | 'tiered';
  rate: number;
  amount: number;
  unit: string | null;
  bracket: number | null;
} {
  if (!isTieredRiskPosition(position)) {
    return { model: 'legacy', rate: LEGACY_MAINTENANCE_MARGIN_RATE, amount: 0, unit: null, bracket: null };
  }
  const at = positionTierAt(symbol, position, Number(price ?? position.entryPrice ?? 0));
  if (!at) {
    // 分层仓位此刻定不了档（没有价）：照实说「分层、档位未知」，不冒充旧模型的 0.4%。
    const resolved = resolvePositionTiers(position, symbol);
    return { model: 'tiered', rate: NaN, amount: NaN, unit: resolved?.unit ?? null, bracket: null };
  }
  return {
    model: 'tiered',
    rate: at.tier.maintenanceMarginRate,
    amount: at.tier.maintenanceAmount,
    unit: at.resolved.unit,
    bracket: at.tier.bracket,
  };
}

/**
 * 分层模型下的强平价（calcLiquidationPrice 对带戳仓位的实现）。
 * 保证金取法与旧公式一致：U 本位逐仓用 isolatedMargin，全仓按 名义 ÷ 杠杆 折一个有效保证金；
 * 币本位用 marginCoin，缺失时按 margin ÷ 开仓价 推。算不出来返回 NaN（含空单永不强平的 Infinity）。
 */
export function tieredLiquidationPrice(position: RiskPositionLike, symbol?: string | null): number {
  const resolved = resolvePositionTiers(position, symbol);
  if (!resolved) return NaN;
  const entry = Number(position.entryPrice);
  if (!(entry > 0)) return NaN;

  let liq: number;
  if (position.settlementMode === 'coin') {
    const contracts = Math.max(0, Math.round(Number(position.contracts ?? position.quantity ?? 0)));
    const contractSizeUsd = Number(position.contractSizeUsd) > 0
      ? Number(position.contractSizeUsd)
      : (resolved.contractSizeUsd ?? 10);
    const walletBalanceCoin = position.marginCoin ?? (Number(position.margin) / entry);
    if (!contracts || !(walletBalanceCoin > 0)) return NaN;
    const args = { side: position.side, contracts, contractSizeUsd, entryPrice: entry, walletBalanceCoin, tiers: resolved.tiers };
    liq = resolved.measure === 'coin'
      ? binanceIsolatedLiquidationPriceCoinm(args)
      : usdFaceIsolatedLiquidationPriceCoin(args);
  } else {
    const quantity = Number(position.quantity);
    if (!(quantity > 0)) return NaN;
    const walletBalance = position.marginMode === 'isolated' && position.isolatedMargin != null
      ? Number(position.isolatedMargin)
      : (quantity * entry) / Number(position.leverage);
    liq = binanceIsolatedLiquidationPriceUsdm({
      side: position.side, quantity, entryPrice: entry, walletBalance, tiers: resolved.tiers,
    });
  }
  return Number.isFinite(liq) ? liq : NaN;
}
