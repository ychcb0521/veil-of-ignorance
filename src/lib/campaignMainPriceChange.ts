import { resolveLegExecution, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import { computeLegPriceChangePct } from '@/lib/legPriceChange';
import { buildTradeRecordLookup } from '@/lib/objectiveOperationTime';
import type { CampaignCounterfactualManualLeg, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

/** 参与「涨幅」的主力角色：main_open 全部；一条都没有才取 reentry_main（与 pickPrimaryMainLeg 同一套角色分档）。 */
const PRIMARY_MAIN_ROLES = ['main_open', 'reentry_main'] as const;

function mainLegsOf<T extends { leg_role: string }>(legs: readonly T[]): T[] {
  for (const role of PRIMARY_MAIN_ROLES) {
    const found = legs.filter(leg => leg.leg_role === role);
    if (found.length > 0) return found;
  }
  return [];
}

/** 一组涨幅里的最大值；全是 null（主力都还没平仓）时为 null。 */
function maxPriceChange(values: Iterable<number | null>): number | null {
  let best: number | null = null;
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    if (best == null || value > best) best = value;
  }
  return best;
}

/**
 * 每条主力腿在 Legs 表「涨跌幅」列里的那个数（按腿 id）。
 *
 * 与 Legs 表逐字同源：成交记录按 buildTradeRecordLookup 查，开平价取 resolveLegExecution
 * （含 1 分钟 K 线平仓价校正、爆仓不改价），再按这条腿的方向算——空单价格跌了是正数。
 * 还没平仓（没有平仓价）的腿记 null，与 Legs 表的「—」一致。
 */
export function campaignMainLegPriceChanges(
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  corrections: LegExitPriceCorrections = {},
): Map<string, number | null> {
  const lookup = buildTradeRecordLookup(tradeRecords);
  const result = new Map<string, number | null>();
  for (const leg of mainLegsOf(legs)) {
    const record = leg.trade_record_id ? lookup.get(leg.trade_record_id) ?? null : null;
    const execution = resolveLegExecution(leg, record, corrections);
    result.set(leg.id, computeLegPriceChangePct(execution.entryPrice, execution.exitPrice, leg.direction === 'short' ? 'short' : 'long'));
  }
  return result;
}

/**
 * 战役列表「涨幅」排序与卡片读数、盈亏概览的「涨幅」：
 * 【用户要求】主力有几笔时，取**涨幅最大**的那一笔（各笔的数就是 Legs 表主力那几行「涨跌幅」列）。
 * 还没平仓的主力不参与；主力都还没平仓时返回 null（显示「—」）。
 */
export function campaignMainLegPriceChangePct(
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  corrections: LegExitPriceCorrections = {},
): number | null {
  return maxPriceChange(campaignMainLegPriceChanges(legs, tradeRecords, corrections).values());
}

/**
 * 涨幅效率 = 主力涨幅 ÷ 预期回撤（两者都是价格层面的百分数，结果是倍数）：
 * 主力涨了 12%、入场到对冲边界 4%，效率 +3.00——价格走出了 3 个「预期回撤」。
 * 任一缺失、或预期回撤不为正时不算。战役卡片、列表排序与盈亏概览（含反事实）都读这一个函数。
 */
export function computeMainPriceEfficiency(
  mainPriceChangePct: number | null | undefined,
  expectedMaxDrawdownPct: number | null | undefined,
): number | null {
  if (mainPriceChangePct == null || !Number.isFinite(mainPriceChangePct)) return null;
  if (expectedMaxDrawdownPct == null || !Number.isFinite(expectedMaxDrawdownPct) || !(expectedMaxDrawdownPct > 0)) return null;
  const value = mainPriceChangePct / expectedMaxDrawdownPct;
  return Number.isFinite(value) ? value : null;
}

/**
 * 加仓效率 = 盈亏比 b ÷ 涨幅效率。
 * 只拿主力、不加仓时，b 大致就是主力的涨幅效率（最大预期亏损按入场到对冲边界的距离定），比值约为 1；
 * 大于 1 说明加仓把同一段行情放大成了更多的 R，小于 1 说明加仓 / 对冲 / 止盈吃掉了行情。
 * payoffRatio 是 b 本身（倍数，不是百分数）。
 *
 * 【用户要求】门槛：只在涨幅效率**为正**时算（按显示到两位小数的值判，显示 0.00 的不算）。
 * 涨幅效率为负时，亏损战役负负得正会排到最前；接近 0 时分母太小，主力几乎没动也会被放大成十几倍——两种读数都没有意义。
 * 「只算做过加仓的战役」由调用方用 campaignHasMainAdd 另判。
 */
export function computeAddEfficiency(
  payoffRatio: number | null | undefined,
  mainPriceEfficiency: number | null | undefined,
): number | null {
  if (payoffRatio == null || !Number.isFinite(payoffRatio)) return null;
  if (mainPriceEfficiency == null || !Number.isFinite(mainPriceEfficiency)) return null;
  if (!(Number(mainPriceEfficiency.toFixed(2)) > 0)) return null;
  const value = payoffRatio / mainPriceEfficiency;
  return Number.isFinite(value) ? value : null;
}

/** 两项效率的读数：「+3.00」「-0.75」；取整为 0 统一成「0.00」；缺值「—」。 */
export function formatEfficiency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(2));
  return rounded === 0 ? '0.00' : `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}`;
}

type ManualMainLeg = Pick<CampaignCounterfactualManualLeg,
  'id' | 'leg_role' | 'direction' | 'open_time' | 'close_time' | 'entry_price' | 'exit_price' | 'size_usdt' | 'enabled' | 'filled' | 'actual'>;

/**
 * 真实战役那一侧的主力涨幅：每条主力腿的涨幅（campaignMainLegPriceChanges，按腿 id）
 * 与取最大之后真实「盈亏概览」里的那个数（campaignMainLegPriceChangePct）。
 */
export interface ActualMainPriceChange {
  byLegId: Readonly<Record<string, number | null>>;
  pct: number | null;
}

function samePrice(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-9;
}

/**
 * 反事实（手动 Legs 分支）里的主力涨幅：与真实一侧同一条规则——参与运行的主力里取**涨幅最大**的那一笔。
 *
 * 逐腿对账（副本里腿 id 不变）：一条主力的方向、开仓价、平仓价都没改过时，**直接沿用真实一侧这条腿的那个数**——
 * 副本的开平价是按分刀、认领、事件快照还原出来的，与 Legs 表那一行未必是同一对（主力最后一刀被加仓腿认领、
 * 换了浏览器只剩快照、一条腿都结算不了……），原样重跑必须逐位相同，这一点只能靠「没改就不重算」保证，
 * 不能靠两套还原碰巧一致。改过了才按副本里的开平价算（与 Legs 表同一个公式、按方向计）。
 * 真实一侧没有的主力（新增的腿、改成主力角色的腿）按副本的开平价算；实际还没平仓、平仓价也没改过的腿不算
 * （引擎只是按数据末端强行结算）。停用的腿不参与。
 */
export function counterfactualMainLegPriceChangePct(
  manualLegs: readonly ManualMainLeg[] | null | undefined,
  actualMain?: ActualMainPriceChange | null,
): number | null {
  const live = (manualLegs ?? []).filter(leg => leg.enabled && leg.filled !== false);
  const pctOf = (leg: ManualMainLeg) =>
    computeLegPriceChangePct(leg.entry_price, leg.exit_price, leg.direction === 'short' ? 'short' : 'long');
  const byLegId = actualMain?.byLegId ?? {};

  return maxPriceChange(mainLegsOf(live).map(leg => {
    const actual = leg.actual;
    const pricesUnchanged = actual != null
      && leg.direction === actual.direction
      && samePrice(leg.entry_price, actual.entry_price)
      && samePrice(leg.exit_price, actual.exit_price);
    if (pricesUnchanged && Object.prototype.hasOwnProperty.call(byLegId, leg.id)) return byLegId[leg.id];
    if (actual && (actual.still_open || actual.close_time_fallback || actual.source === 'unsettled')
      && samePrice(leg.exit_price, actual.exit_price)) {
      return null;
    }
    return pctOf(leg);
  }));
}

function isMainAddRole(role: string | null | undefined): boolean {
  return !!role && role.startsWith('main_add');
}

/**
 * 【用户要求】「加仓效率」只对做过加仓的战役计算：没有加仓，这个比值只是「主力盈亏比 ÷ 主力涨幅效率」，
 * 恒在 1 附近，排进来只会把真正加过仓的战役冲散。
 * 「做过加仓」= 有一条加仓腿（main_add_N）真的成交过：带成交 id（实时 / 回填都有），或腿上已有结算结果。
 * 只挂了单、腿上连成交 id 都没有的加仓不算。
 */
export function campaignHasMainAdd(
  legs: readonly Pick<TradeJournal, 'leg_role' | 'trade_record_id' | 'post_realized_pnl' | 'post_real_close_time' | 'post_simulated_close_time'>[],
): boolean {
  return legs.some(leg => isMainAddRole(leg.leg_role) && (
    !!leg.trade_record_id
    || (leg.post_realized_pnl != null && Number.isFinite(Number(leg.post_realized_pnl)))
    || !!leg.post_real_close_time
    || !!leg.post_simulated_close_time
  ));
}

/** 反事实（手动 Legs）里有没有参与运行、且成交了的加仓腿：与 campaignHasMainAdd 同一个口径。 */
export function counterfactualHasMainAdd(
  manualLegs: readonly Pick<CampaignCounterfactualManualLeg, 'leg_role' | 'enabled' | 'filled'>[] | null | undefined,
): boolean {
  return (manualLegs ?? []).some(leg => leg.enabled && leg.filled !== false && isMainAddRole(leg.leg_role));
}
