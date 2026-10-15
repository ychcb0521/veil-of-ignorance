/**
 * L_磨损（执行磨损）【用户要求】2026-10-15。用户的定义（逐字）：
 *   「它包括两部分，第一部分源自中途的对冲单（非最后一次的）的盈亏；第二部分源自多空最终平仓价不一致的差价造成的磨损、
 *    最终的对冲空单委托价与实际成交价不一致的差价造成的磨损，以及理论上的对冲单的币的数量与实际上对冲单的币数不一致的
 *    数量差值造成的磨损。因此，在 legs 中，如果有磨损，那它只出现在中途对冲单那行，以及最终对冲单那行。」
 *
 * 【用户要求】计量单位与盈亏比一致：按 R 读（金额 ÷ 初始最大预期亏损 L₀，两位小数），带号：负数是磨损，正数是红利；
 * 也就是盈亏比括号里的那个数。下面的各项先按 USDT 算，再统一 ÷ L₀。只算主多战役（与神奇的 b 同口径）。
 *
 *   第一部分 · 中途对冲：中途对冲空单（不是最后锁住行情的那几张）的已实现盈亏之和，记在各自那一行。
 *   第二部分 · 最终对冲磨损：只在主力平仓那一刻有空单锁住行情（最终对冲单，参与相对涨幅、F 取自它的开仓价）时计算，
 *     全部记在最终对冲单那一行：
 *     ① 多空平仓价差 = 对冲币数 ×（多单最终平仓价 − 空单平仓价）：多空同一个价平掉时为 0；
 *        （有不止一张最终对冲单、开仓价不同于 F 时，各自 币数 ×（开仓价 − F）也记在这里）
 *     ② 对冲委托/成交差 = 对冲币数 ×（开仓价 − 委托价）：卖出开空，开仓成交低于委托价是磨损；
 *     ③ 对冲数量差 =（理论对冲币数 − 实际对冲币数）×（多单最终平仓价 − F）：理论对冲币数 = 锁仓时手里的多单币数
 *        （之后平掉的那些）；少对冲的那部分币跟着行情走，多对冲则反过来。记在最早那张最终对冲单那一行。
 *     多单最终平仓价取锁仓之后平掉的那几刀的币数加权成交价（平仓价校正过的取校正价）。
 *     ①＋③ 恰好等于「实际多空两边从 F 起的盈亏」与「模型按 F 结算」之差（单张最终对冲单时）。
 *
 * 主力、加仓、镜像那几行不会出现磨损。
 */
import type { CampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { tradeRecordNotionalAt, type ResolvedLegExecution, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

export const EXECUTION_WEAR_LABEL = 'L_磨损';
export const EXECUTION_WEAR_FORMULA = 'L_磨损 = 中途对冲 + 最终对冲磨损（多空平仓价差 + 对冲委托/成交差 + 对冲数量差）';
export const PAYOFF_RATIO_WEAR_FORMULA = '盈亏比（方法二）= 神奇的 b + L_磨损 ÷ L₀';
export const EXECUTION_WEAR_COMPONENT_RULES = {
  hedge: '中途对冲：中途对冲空单（不是最后锁住行情的那几张）的已实现盈亏之和。',
  exit: '多空平仓价差：对冲币数 ×（多单最终平仓价 − 最终对冲空单平仓价）；多空同一个价平掉时为 0。',
  slippage: '对冲委托/成交差：最终对冲空单 对冲币数 ×（开仓价 − 委托价）；开仓成交低于委托价是磨损。',
  sizing: '对冲数量差：（理论对冲币数 − 实际对冲币数）×（多单最终平仓价 − F）；理论对冲币数 = 锁仓时手里的多单币数。',
} as const;
export const EXECUTION_WEAR_RULE = '单位与盈亏比一致：各项金额 ÷ 初始最大预期亏损 L₀，两位小数，带号：负数是磨损，正数是红利；就是盈亏比括号里的那个数。只算主多战役（与神奇的 b 同口径）。最终对冲磨损只在主力平仓那一刻有空单锁住行情时计算，算不出的一项不计入；都算不出时写「—」。Legs 里磨损只出现在中途对冲单与最终对冲单那几行。';

export type ExecutionWearComponent = keyof typeof EXECUTION_WEAR_COMPONENT_RULES;
export const EXECUTION_WEAR_COMPONENT_LABEL: Record<ExecutionWearComponent, string> = {
  hedge: '中途对冲',
  exit: '多空平仓价差',
  slippage: '对冲委托/成交差',
  sizing: '对冲数量差',
};
export const EXECUTION_WEAR_COMPONENTS: readonly ExecutionWearComponent[] = ['hedge', 'exit', 'slippage', 'sizing'];
/** 第二部分（最终对冲磨损）的三项。 */
export const FINAL_HEDGE_WEAR_COMPONENTS: readonly ExecutionWearComponent[] = ['exit', 'slippage', 'sizing'];
export const FINAL_HEDGE_WEAR_LABEL = '最终对冲磨损';

/** Legs「磨损」点开后的计算过程：代入的每一个数。 */
export type LegWearDetail =
  | { kind: 'midHedge'; pnl: number }
  | {
    kind: 'finalHedge';
    /** 这张最终对冲单的币数与开仓价 / 平仓价（平仓价为币数加权）。 */
    coins: number;
    entry: number | null;
    shortExit: number | null;
    /** F 与多单最终平仓价（锁仓后平掉的多单，币数加权）、理论对冲币数（锁仓时的多单币数）。 */
    finalExitPrice: number;
    longExit: number | null;
    longCoins: number;
    /** 全部最终对冲单的币数合计（对冲数量差用它）；sizingOwner = 对冲数量差记在这一行。 */
    hedgeCoinsTotal: number;
    sizingOwner: boolean;
    orderPrice: number | null;
    fillPrice: number | null;
  };

export type LegExecutionWear = Record<ExecutionWearComponent, number | null> & { total: number; detail?: LegWearDetail };

export interface CampaignExecutionWear {
  /** L_磨损（USDT）；都算不出时 null。 */
  usd: number | null;
  /** L_磨损 ÷ L₀；缺 L₀ 时 null。 */
  r: number | null;
  /** 各项合计（USDT）；不适用 / 算不出为 null。 */
  components: Record<ExecutionWearComponent, number | null>;
  /** 逐腿拆分（leg id → 各项与合计，USDT）：只有中途对冲单与最终对冲单。纯对象，列表缓存可以直接比较。 */
  byLeg: Record<string, LegExecutionWear>;
  /** 换算成 R 的分母 L₀；缺失时为 null（R 读数写「—」）。 */
  initialExpectedMaxLoss?: number | null;
}

/** USDT → R（÷ L₀）；缺 L₀ 时 null。 */
export function executionWearInR(value: number | null | undefined, initialExpectedMaxLoss: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || initialExpectedMaxLoss == null || !(initialExpectedMaxLoss > 0)) return null;
  const r = value / initialExpectedMaxLoss;
  return Number.isFinite(r) ? r : null;
}

/** 【用户要求】与盈亏比同一写法：R 两位小数，负数写「-」，不带单位；读作 0.00 时不带负号。 */
export function formatExecutionWearR(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(2));
  return (rounded === 0 ? 0 : rounded).toFixed(2);
}

export interface ExecutionWearInput {
  legs: TradeJournal[];
  executions: Map<string, ResolvedLegExecution>;
  lookup: Map<string, TradeRecord>;
  settlement: CampaignRealizedPnl;
  corrections: LegExitPriceCorrections;
  orders: CampaignReverseHedgeOrder[];
  /** F：相对涨幅的最终卖出价（锁仓时是最早那张最终对冲空单的开仓价）。 */
  finalExitPrice: number | null;
  /** 最终对冲单（锁住行情、参与相对涨幅的空单）leg id；空 = 没有锁仓。 */
  lockingLegIds: readonly string[];
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
  const { legs, executions, settlement, corrections, orders, finalExitPrice: F, initialExpectedMaxLoss } = input;
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
  /** 一条腿的平仓：币数与成交价（最后一刀被 K 线校正过的用校正价）。 */
  const closesOf = (leg: TradeJournal) => {
    const records = settlement.recordsByLeg.get(leg.id) ?? [];
    const last = Math.max(...records.map(record => record.closeTime));
    return records.map(record => {
      const corrected = record.closeTime === last && corrections[leg.id] ? corrections[leg.id].exitPrice : null;
      return { record, coins: recordCoins(record, leg), price: corrected ?? record.exitPrice };
    }).filter(close => close.coins > 0 && close.price > 0);
  };

  // 第一部分 · 中途对冲：非最终对冲空单的已实现盈亏
  for (const leg of legs) {
    if (!isHedgeLeg(leg) || lockingIds.has(leg.id)) continue;
    const pnl = settlement.byLeg.get(leg.id);
    if (finite(pnl)) {
      add(leg.id, 'hedge', pnl);
      byLeg[leg.id].detail = { kind: 'midHedge', pnl };
    }
  }

  // 第二部分 · 最终对冲磨损：只在锁仓时，全部记在最终对冲单那一行
  const lockers = legs.filter(leg => lockingIds.has(leg.id) && isHedgeLeg(leg))
    .sort((a, b) => (executions.get(a.id)?.openTime ?? Infinity) - (executions.get(b.id)?.openTime ?? Infinity));
  if (lockers.length && finite(F) && F > 0) {
    const lockOpen = executions.get(lockers[0].id)?.openTime ?? null;
    // 多单最终平仓价：锁仓之后平掉的多单，币数加权
    let longCoins = 0, longValue = 0;
    if (lockOpen != null) {
      for (const leg of legs) {
        if (!isMainSideLeg(leg)) continue;
        for (const close of closesOf(leg)) {
          if (!(close.record.closeTime >= lockOpen)) continue;
          longCoins += close.coins;
          longValue += close.coins * close.price;
        }
      }
    }
    const longExit = longCoins > 0 ? longValue / longCoins : null;
    let hedgeCoins = 0;
    const finalDetails: Array<Extract<LegWearDetail, { kind: 'finalHedge' }> & { legId: string }> = [];
    for (const leg of lockers) {
      const closes = closesOf(leg);
      const record = leg.trade_record_id ? input.lookup.get(leg.trade_record_id) : undefined;
      const coins = closes.length ? closes.reduce((sum, close) => sum + close.coins, 0) : record ? recordCoins(record, leg) : 0;
      if (!(coins > 0)) continue;
      hedgeCoins += coins;
      const entry = executions.get(leg.id)?.entryPrice ?? closes[0]?.record.entryPrice ?? null;
      // ① 多空平仓价差（空单已平、多单最终平仓价读得到时）
      if (longExit != null && closes.length) {
        const shortExit = closes.reduce((sum, close) => sum + close.coins * close.price, 0) / coins;
        add(leg.id, 'exit', coins * (longExit - shortExit) + (finite(entry) ? coins * (entry - F) : 0));
      }
      // ② 对冲委托/成交差：反向对冲委托的委托价 vs 这张空单的开仓价
      // 【用户要求】成交价就是空单的「开仓价」（Legs 开 / 平价那一格）。委托快照里的 fillPrice 不可靠
      // （条件委托触发时有的写的是触发价本身），只在读不到开仓价时才用它兜底。
      const recordIds = new Set([leg.trade_record_id, ...closes.map(close => close.record.id)].filter(Boolean));
      const order = orders.find(item => item.status === 'triggered' && item.tradeRecordId != null && recordIds.has(item.tradeRecordId));
      const fill = finite(entry) && entry > 0 ? entry : order?.fillPrice ?? null;
      const hasOrder = order != null && finite(order.price) && order.price > 0 && finite(fill) && fill > 0;
      if (hasOrder) add(leg.id, 'slippage', coins * (fill! - order!.price));
      const shortExit = closes.length ? closes.reduce((sum, close) => sum + close.coins * close.price, 0) / coins : null;
      finalDetails.push({ legId: leg.id, kind: 'finalHedge', coins, entry: finite(entry) ? entry : null, shortExit, finalExitPrice: F,
        longExit, longCoins, hedgeCoinsTotal: 0, sizingOwner: leg.id === lockers[0].id,
        orderPrice: hasOrder ? order!.price : null, fillPrice: hasOrder ? fill! : null });
    }
    // ③ 对冲数量差：记在最早那张最终对冲单
    if (longExit != null && hedgeCoins > 0) add(lockers[0].id, 'sizing', (longCoins - hedgeCoins) * (longExit - F));
    for (const { legId, ...detail } of finalDetails) {
      if (byLeg[legId]) byLeg[legId].detail = { ...detail, hedgeCoinsTotal: hedgeCoins };
    }
  }

  const present = EXECUTION_WEAR_COMPONENTS.map(part => components[part]).filter(finite);
  const usd = present.length ? present.reduce((sum, value) => sum + value, 0) : null;
  const r = usd != null && initialExpectedMaxLoss > 0 ? usd / initialExpectedMaxLoss : null;
  return { usd, r: r != null && Number.isFinite(r) ? r : null, components, byLeg, initialExpectedMaxLoss: initialExpectedMaxLoss > 0 ? initialExpectedMaxLoss : null };
}

/** 第二部分（最终对冲磨损）合计；三项都不适用时 null。 */
export function finalHedgeWear(components: Record<ExecutionWearComponent, number | null>): number | null {
  const parts = FINAL_HEDGE_WEAR_COMPONENTS.map(part => components[part]).filter(finite);
  return parts.length ? parts.reduce((sum, value) => sum + value, 0) : null;
}

/**
 * 【用户要求】「封面上磨损这列占的空间太大了」：封面 / 排序分档用的紧凑写法（与盈亏比同一单位）。
 * |x| < 10 两位小数；10–100 一位；100–1 万取整；≥ 1 万写「x.xxw」。列宽按全表最长的读数定，
 * 少数几场磨损特别大的战役不再把整列撑宽。分档按同一个取整，封面读数相同的必在同一档。
 */
function compactWearDigits(abs: number): number {
  if (abs >= 100) return 0;
  if (abs >= 10) return 1;
  return 2;
}
export function compactExecutionWearR(value: number): number {
  const abs = Math.abs(value);
  const rounded = abs >= 10_000 ? Math.round(abs / 100) * 100 : Number(abs.toFixed(compactWearDigits(abs)));
  return rounded === 0 ? 0 : Math.sign(value) * rounded;
}
export function formatCompactExecutionWearR(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const text = abs >= 10_000 ? `${(abs / 10_000).toFixed(2)}w` : abs.toFixed(compactWearDigits(abs));
  return `${value < 0 && /[1-9]/.test(text) ? '-' : ''}${text}`;
}

/** USDT 带号两位小数，负号用「−」。 */
export function formatExecutionWearUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(2));
  return `${rounded < 0 ? '−' : rounded > 0 ? '+' : ''}${Math.abs(rounded).toFixed(2)}`;
}

/**
 * 【用户要求】L_磨损读数：数值写总的，括号里写两部分相加——中途对冲的损益 + 最终对冲磨损（多空平仓价差、对冲委托/成交差、对冲数量差）。
 * 例：−35.00（−30.00−5.00）。任一部分算不出或读作 0.00（没有中途对冲、或没有最终对冲磨损）时括号就是总数本身，不写。
 */
export function formatExecutionWearParts(
  total: number | null | undefined,
  hedge: number | null | undefined,
  other: number | null | undefined,
  format: (value: number) => string,
): string {
  if (total == null || !Number.isFinite(total)) return '—';
  const head = format(total);
  // 任一部分缺失或读作 0.00 时，括号只会重复总数，不写
  if (hedge == null || other == null || !Number.isFinite(hedge) || !Number.isFinite(other)
    || Number(hedge.toFixed(2)) === 0 || Number(other.toFixed(2)) === 0) return head;
  const second = format(other);
  return `${head}（${format(hedge)}${/^[-−+]/.test(second) ? '' : '+'}${second}）`;
}
