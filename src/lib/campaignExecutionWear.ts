/**
 * L_磨损（执行磨损）【用户要求】2026-10-15：「多空最终平仓价不一致、委托价与实际成交价不一致，以及实际加仓数量不一致
 * （超覆盖或不够覆盖），需要新增一个指标体现出来：L_磨损」，并与盈亏比括号里已有的中途对冲磨损合并。
 *
 * 单位 USDT，带号：负数是磨损（让结果比模型差），正数是红利。L_磨损 ÷ L₀ 就是盈亏比括号里的那个 R。
 * 只算主多战役（与神奇的 b 同口径）。四项互不重叠：
 *
 *   ① 中途对冲：中途对冲空单（不含锁住行情、参与相对涨幅的那几张）的已实现盈亏之和——原有的磨损。
 *   ② 多空平仓价差：主力平仓那一刻有空单把行情锁住时，模型按 F（锁仓空单的开仓价）结算；实际是多单、空单各自平在自己的价上。
 *      = Σ 锁仓之后平掉的多单 币数 ×（平仓委托价 − F） + Σ 锁仓空单 币数 ×（开仓价 − 平仓委托价）。
 *      多空同量、同一个价平掉时恰为 0；两边平仓价不一致，差多少就磨损（或多赚）多少。
 *      这里的平仓价取「委托价」（成交价扣回滑点），滑点只记在 ③，不重复。没有锁仓（F 就是主力平仓价）时这一项不适用。
 *   ③ 委托 / 成交滑点：委托价与实际成交价之差。
 *      · 平仓：每条平仓记录自带的滑点（止盈止损按触发价、手动平仓按点下时的市价），全部是不利的，记负；
 *      · 锁仓空单开仓：反向对冲委托的委托价 vs 成交价；
 *      · 加仓开仓：加仓计算器下单时记下的这一笔委托价（s2AtOrder）vs 成交价。
 *      主力 / 镜像开仓、没走计算器的加仓读不到委托价，不计；中途对冲空单的滑点已经在 ① 的已实现盈亏里，不再计。
 *      平仓价被 1 分钟 K 线校正过的那一条，记录里的滑点不再可信，不计。
 *   ④ 加仓数量偏差（超覆盖 / 不够覆盖）：Σ（实际加仓币数 − 允许加仓币数）×（F − 加仓成交价）。
 *      允许加仓币数 = 加仓前币数 × α理论（与「1+α（理论）」同一份）。多加了、行情又走到 F，多出的币多赚，为正；
 *      少加了就是少赚的那部分，为负；多加了却亏了，为负。
 *
 * 逐腿也拆开（byLeg），Legs 表的「磨损」列逐行显示，合计行等于 L_磨损。
 */
import type { CampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { tradeRecordNotionalAt, type ResolvedLegExecution, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import type { LegTheoreticalGeometricFactor } from '@/lib/campaignLegGeometricFactor';
import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

export const EXECUTION_WEAR_LABEL = 'L_磨损';
export const EXECUTION_WEAR_FORMULA = 'L_磨损 = 中途对冲 + 多空平仓价差 + 委托/成交滑点 + 加仓数量偏差';
export const PAYOFF_RATIO_WEAR_FORMULA = '盈亏比（方法二）= 神奇的 b + L_磨损 ÷ L₀';
export const EXECUTION_WEAR_COMPONENT_RULES = {
  hedge: '中途对冲：中途对冲空单（不含锁住行情、参与相对涨幅的那几张）的已实现盈亏之和。',
  exit: '多空平仓价差：锁仓后多单、空单各自平仓的委托价与 F 之差 = Σ 锁仓后平掉的多单 币数 ×（平仓委托价 − F）+ Σ 锁仓空单 币数 ×（开仓价 − 平仓委托价）；多空同量同价平掉时为 0。没有锁仓时不适用。',
  slippage: '委托/成交滑点：平仓记录自带的滑点（止盈止损按触发价、手动平仓按点下时的市价），锁仓空单开仓的委托价 vs 成交价，经加仓计算器下单的加仓委托价 vs 成交价；读不到委托价的开仓（主力、镜像、没走计算器的加仓）不计。',
  sizing: '加仓数量偏差：Σ（实际加仓币数 − 允许加仓币数）×（F − 加仓成交价）；允许加仓币数 = 加仓前币数 × α理论（与「1+α（理论）」同一份）。多加且赚到为正，少加或多加却亏为负。',
} as const;
export const EXECUTION_WEAR_RULE = '单位 USDT，带号：负数是磨损，正数是红利；÷ L₀ 就是盈亏比括号里的那个数。只算主多战役（与神奇的 b 同口径），四项互不重叠，算不出的一项不计入；四项都算不出时写「—」。';

export type ExecutionWearComponent = keyof typeof EXECUTION_WEAR_COMPONENT_RULES;
export const EXECUTION_WEAR_COMPONENT_LABEL: Record<ExecutionWearComponent, string> = {
  hedge: '中途对冲',
  exit: '多空平仓价差',
  slippage: '委托/成交滑点',
  sizing: '加仓数量偏差',
};
export const EXECUTION_WEAR_COMPONENTS: readonly ExecutionWearComponent[] = ['hedge', 'exit', 'slippage', 'sizing'];

export type LegExecutionWear = Record<ExecutionWearComponent, number | null> & { total: number };

export interface CampaignExecutionWear {
  /** L_磨损（USDT）；四项都算不出时 null。 */
  usd: number | null;
  /** L_磨损 ÷ L₀；缺 L₀ 时 null。 */
  r: number | null;
  /** 各项合计（USDT）；不适用 / 算不出为 null。 */
  components: Record<ExecutionWearComponent, number | null>;
  /** 逐腿拆分（leg id → 各项与合计）；纯对象，列表缓存可以直接比较。 */
  byLeg: Record<string, LegExecutionWear>;
}

export interface ExecutionWearInput {
  legs: TradeJournal[];
  executions: Map<string, ResolvedLegExecution>;
  lookup: Map<string, TradeRecord>;
  settlement: CampaignRealizedPnl;
  corrections: LegExitPriceCorrections;
  orders: CampaignReverseHedgeOrder[];
  /** F：相对涨幅的最终卖出价（锁仓时是锁仓空单的开仓价）。 */
  finalExitPrice: number | null;
  /** 锁住行情、参与相对涨幅的空单 leg id；空 = 没有锁仓。 */
  lockingLegIds: readonly string[];
  /** 实际加仓（与几何仓位同一份）及其理论因子（同序）。 */
  addSteps: ReadonlyArray<{ legId: string; addCoins: number | null }>;
  theoreticalFactors: ReadonlyArray<LegTheoreticalGeometricFactor | null> | null;
  initialExpectedMaxLoss: number;
}

const isHedgeLeg = (leg: TradeJournal) => leg.direction === 'short'
  && ((leg.leg_role ?? '').startsWith('hedge_') || leg.leg_role === 'reentry_hedge');
const isMainSideLeg = (leg: TradeJournal) => leg.direction === 'long'
  && (leg.leg_role === 'main_open' || leg.leg_role === 'mirror_tp' || (leg.leg_role ?? '').startsWith('main_add_'));
const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);

function recordCoins(record: TradeRecord, leg: TradeJournal): number {
  if (!(record.entryPrice > 0)) return 0;
  const sized = !record.settlementMode && leg.pre_settlement_mode === 'coin' ? { ...record, settlementMode: 'coin' as const } : record;
  const coins = tradeRecordNotionalAt(sized) / record.entryPrice;
  return Number.isFinite(coins) && coins > 0 ? coins : 0;
}

export function computeCampaignExecutionWear(input: ExecutionWearInput): CampaignExecutionWear {
  const { legs, executions, lookup, settlement, corrections, orders, finalExitPrice: F, initialExpectedMaxLoss } = input;
  const byLeg: Record<string, LegExecutionWear> = {};
  const components: Record<ExecutionWearComponent, number | null> = { hedge: null, exit: null, slippage: null, sizing: null };
  const add = (legId: string, part: ExecutionWearComponent, value: number) => {
    if (!Number.isFinite(value)) return;
    const row = byLeg[legId] ??= { hedge: null, exit: null, slippage: null, sizing: null, total: 0 };
    row[part] = (row[part] ?? 0) + value;
    row.total += value;
    components[part] = (components[part] ?? 0) + value;
  };
  const lockingIds = new Set(input.lockingLegIds);
  /** 每条腿最后一刀若被 K 线校正过：那一条用校正价、不读记录里的滑点。 */
  const closesOf = (leg: TradeJournal) => {
    const records = settlement.recordsByLeg.get(leg.id) ?? [];
    const last = Math.max(...records.map(record => record.closeTime));
    return records.map(record => {
      const corrected = record.closeTime === last && corrections[leg.id] ? corrections[leg.id].exitPrice : null;
      const coins = recordCoins(record, leg);
      const slippage = corrected == null && finite(record.slippage) && record.slippage > 0 ? record.slippage : 0;
      return { record, coins, fill: corrected ?? record.exitPrice, slippage };
    }).filter(close => close.coins > 0 && close.fill > 0);
  };

  for (const leg of legs) {
    const hedge = isHedgeLeg(leg);
    // ① 中途对冲：整条腿的已实现盈亏（已含它自己的滑点，③ 不再计）
    if (hedge && !lockingIds.has(leg.id)) {
      const pnl = settlement.byLeg.get(leg.id);
      if (finite(pnl)) add(leg.id, 'hedge', pnl);
      continue;
    }
    if (!hedge && !isMainSideLeg(leg)) continue;
    // ③ 平仓滑点：卖出平多、买入平空都是不利的
    for (const close of closesOf(leg)) if (close.slippage > 0) add(leg.id, 'slippage', -close.slippage);
  }

  // ② 多空平仓价差：只在锁仓时
  if (lockingIds.size && finite(F) && F > 0) {
    const lockOpen = Math.min(...[...lockingIds].map(id => executions.get(id)?.openTime ?? Number.POSITIVE_INFINITY));
    for (const leg of legs) {
      if (lockingIds.has(leg.id)) {
        // 空单：开仓价 − 平仓委托价（买入平空，委托价 = 成交价 − 滑点 ÷ 币数）
        for (const close of closesOf(leg)) {
          const orderPrice = close.fill - close.slippage / close.coins;
          add(leg.id, 'exit', close.coins * (close.record.entryPrice - orderPrice));
        }
      } else if (isMainSideLeg(leg) && Number.isFinite(lockOpen)) {
        // 多单：锁仓之后平掉的那几刀，平仓委托价 − F（卖出平多，委托价 = 成交价 + 滑点 ÷ 币数）
        for (const close of closesOf(leg)) {
          if (!(close.record.closeTime >= lockOpen)) continue;
          const orderPrice = close.fill + close.slippage / close.coins;
          add(leg.id, 'exit', close.coins * (orderPrice - F));
        }
      }
    }
  }

  // ③ 开仓滑点：锁仓空单（反向对冲委托）、走过计算器的加仓
  for (const id of lockingIds) {
    const leg = legs.find(item => item.id === id);
    if (!leg) continue;
    const recordIds = new Set([leg.trade_record_id, ...(settlement.recordsByLeg.get(id) ?? []).map(record => record.id)].filter(Boolean));
    const order = orders.find(item => item.status === 'triggered' && item.tradeRecordId != null && recordIds.has(item.tradeRecordId));
    const execution = executions.get(id);
    const fill = order?.fillPrice ?? execution?.entryPrice;
    const record = leg.trade_record_id ? lookup.get(leg.trade_record_id) : undefined;
    const coins = record ? recordCoins(record, leg) : 0;
    // 卖出开空：成交低于委托价是不利的
    if (order && finite(order.price) && order.price > 0 && finite(fill) && fill > 0 && coins > 0) add(id, 'slippage', (fill - order.price) * coins);
  }
  for (const step of input.addSteps) {
    const leg = legs.find(item => item.id === step.legId);
    const record = leg?.trade_record_id ? lookup.get(leg.trade_record_id) : undefined;
    const orderPrice = record?.addSizingSnapshot?.s2AtOrder;
    const fill = executions.get(step.legId)?.entryPrice;
    // 买入开多：成交高于委托价是不利的
    if (finite(orderPrice) && orderPrice > 0 && finite(fill) && fill > 0 && finite(step.addCoins) && step.addCoins > 0) {
      add(step.legId, 'slippage', (orderPrice - fill) * step.addCoins);
    }
  }

  // ④ 加仓数量偏差
  if (finite(F) && F > 0 && input.theoreticalFactors) {
    input.addSteps.forEach((step, index) => {
      const factor = input.theoreticalFactors![index];
      if (!factor || !finite(step.addCoins) || !finite(factor.addCoins) || !finite(factor.addPrice)) return;
      add(step.legId, 'sizing', (step.addCoins - factor.addCoins) * (F - factor.addPrice));
    });
  }

  const present = EXECUTION_WEAR_COMPONENTS.map(part => components[part]).filter(finite);
  const usd = present.length ? present.reduce((sum, value) => sum + value, 0) : null;
  const r = usd != null && initialExpectedMaxLoss > 0 ? usd / initialExpectedMaxLoss : null;
  return { usd, r: r != null && Number.isFinite(r) ? r : null, components, byLeg };
}

/** USDT 带号两位小数，负号用「−」。 */
export function formatExecutionWearUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(2));
  return `${rounded < 0 ? '−' : rounded > 0 ? '+' : ''}${Math.abs(rounded).toFixed(2)}`;
}
