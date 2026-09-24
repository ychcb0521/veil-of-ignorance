import { resolveLegExecution, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import { pickPrimaryMainLeg } from '@/lib/campaignPrimaryMainLeg';
import { computeLegPriceChangePct } from '@/lib/legPriceChange';
import { buildTradeRecordLookup } from '@/lib/objectiveOperationTime';
import type { CampaignCounterfactualManualLeg, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

/**
 * 战役列表「涨幅」排序与卡片读数：**主力那条腿**在 Legs 表「涨跌幅」列里的那个数。
 *
 * 与 Legs 表逐字同源：主力按 pickPrimaryMainLeg 选（名义最大的 main_open，没有才退到 reentry_main），
 * 成交记录按 buildTradeRecordLookup 查，开平价取 resolveLegExecution（含 1 分钟 K 线平仓价校正、爆仓不改价），
 * 再按主力的方向算——空单价格跌了是正数。主力还没平仓（没有平仓价）时返回 null，与 Legs 表的「—」一致。
 */
export function campaignMainLegPriceChangePct(
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  corrections: LegExitPriceCorrections = {},
): number | null {
  const main = pickPrimaryMainLeg(legs);
  if (!main) return null;
  const record = main.trade_record_id ? buildTradeRecordLookup(tradeRecords).get(main.trade_record_id) ?? null : null;
  const execution = resolveLegExecution(main, record, corrections);
  return computeLegPriceChangePct(execution.entryPrice, execution.exitPrice, main.direction === 'short' ? 'short' : 'long');
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

const PRIMARY_MANUAL_ROLES = ['main_open', 'reentry_main'] as const;

/** 真实战役那一侧的主力：选中的腿 id 与它在真实「盈亏概览」里的涨幅（campaignMainLegPriceChangePct）。 */
export interface ActualMainPriceChange {
  legId: string | null;
  pct: number | null;
}

function samePrice(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-9;
}

/**
 * 反事实（手动 Legs 分支）里主力那条腿的涨幅。
 *
 * 主力优先认真实战役选中的那一条（副本里腿 id 不变）。它的方向、开仓价、平仓价都没改过时，
 * **直接沿用真实「盈亏概览」的那个数**——副本的开平价是按分刀、认领、事件快照还原出来的，
 * 与 Legs 表那一行未必是同一对（主力最后一刀被加仓腿认领、换了浏览器只剩快照、一条腿都结算不了……），
 * 原样重跑必须逐位相同，这一点只能靠「没改就不重算」保证，不能靠两套还原碰巧一致。
 * 改过了才按副本里的开平价算（与 Legs 表同一个公式、按方向计）。
 * 真实选中的那条被停用、删掉或改掉角色时，在参与运行的主力里按「仓位」一格取最大（并列取最早开仓），
 * 与 pickPrimaryMainLeg 同一条规则；这条腿实际还没平仓、平仓价也没改过时不算（引擎只是按数据末端强行结算）。
 */
export function counterfactualMainLegPriceChangePct(
  manualLegs: readonly ManualMainLeg[] | null | undefined,
  actualMain?: ActualMainPriceChange | null,
): number | null {
  const live = (manualLegs ?? []).filter(leg => leg.enabled && leg.filled !== false);
  const isMainRole = (leg: ManualMainLeg) => (PRIMARY_MANUAL_ROLES as readonly string[]).includes(leg.leg_role);
  const pctOf = (leg: ManualMainLeg) =>
    computeLegPriceChangePct(leg.entry_price, leg.exit_price, leg.direction === 'short' ? 'short' : 'long');

  const preferred = actualMain?.legId ? live.find(leg => leg.id === actualMain.legId) : undefined;
  if (preferred && isMainRole(preferred)) {
    const actual = preferred.actual;
    const pricesUnchanged = actual != null
      && preferred.direction === actual.direction
      && samePrice(preferred.entry_price, actual.entry_price)
      && samePrice(preferred.exit_price, actual.exit_price);
    return pricesUnchanged ? actualMain?.pct ?? null : pctOf(preferred);
  }

  let main: ManualMainLeg | null = null;
  for (const role of PRIMARY_MANUAL_ROLES) {
    const candidates = live.filter(leg => leg.leg_role === role);
    if (candidates.length === 0) continue;
    main = [...candidates].sort((a, b) => {
      const sa = Number.isFinite(a.size_usdt) && a.size_usdt > 0 ? a.size_usdt : null;
      const sb = Number.isFinite(b.size_usdt) && b.size_usdt > 0 ? b.size_usdt : null;
      if (sa != null && sb != null && sa !== sb) return sb - sa;
      if (sa != null && sb == null) return -1;
      if (sa == null && sb != null) return 1;
      return Date.parse(a.open_time) - Date.parse(b.open_time);
    })[0] ?? null;
    break;
  }
  if (!main) return null;
  const actual = main.actual;
  if (actual && (actual.still_open || actual.close_time_fallback || actual.source === 'unsettled')
    && samePrice(main.exit_price, actual.exit_price)) {
    return null;
  }
  return pctOf(main);
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
