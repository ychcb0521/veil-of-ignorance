import { resolveCampaignEquityPathLegFacts, type CampaignLocalOrderFacts } from '@/lib/campaignAnalysis';
import { resolveLegExecution, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import { MIN_VISIBLE_PHASE_DURATION_MS } from '@/lib/campaignLegPhases';
import { computeLegPriceChangePct } from '@/lib/legPriceChange';
import { buildTradeRecordLookup } from '@/lib/objectiveOperationTime';
import type { CampaignCounterfactualManualLeg, TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

/** 参与「涨幅」的主力角色：main_open 全部；一条都没有才取 reentry_main（与 pickPrimaryMainLeg 同一套角色分档）。 */
const PRIMARY_MAIN_ROLES = ['main_open', 'reentry_main'] as const;
/** 【用户要求】主力平仓时若有滚动对冲在手（仍持有、或与主力同一次操作里平掉），战役的平仓价按滚动对冲的开仓价。 */
const ROLLING_HEDGE_ROLE = 'hedge_rolling';
/**
 * 【用户要求】已触发的初始对冲 A/B 与回场对冲，**与主力同一次操作里平掉**（相差不超过 SAME_CLOSE_TOLERANCE_MS）时也锁平仓价；
 * 与滚动对冲不同，主力平了它们还挂着不算——「平仓时间一致」才算。
 */
const SAME_CLOSE_HEDGE_ROLES = ['hedge_initial_a', 'hedge_initial_b', 'reentry_hedge'] as const;

/**
 * 「对冲的平仓和主力的平仓时间一致」的判据：两者相差不超过一分钟——
 * 与阶段拆分（campaignLegPhases）判「同一次平仓操作里的成交先后」同一个数，两处不各定各的。
 */
export const SAME_CLOSE_TOLERANCE_MS = MIN_VISIBLE_PHASE_DURATION_MS;

export type PriceChangeSide = 'long' | 'short';

/** 算战役涨幅要用到的一条腿：主力与能锁平仓价的对冲各一份，页面与反事实都喂这个形状。 */
export interface PriceChangeLegInput {
  id: string;
  role: string;
  side: PriceChangeSide;
  entryPrice: number | null;
  /** 还没平仓时 null。 */
  exitPrice: number | null;
  openTime: number | null;
  /** 还没平仓时 null。 */
  closeTime: number | null;
}

/** 平仓价取自哪里：主力自己的平仓价，或锁住行情的那张对冲（按角色分）的开仓价。 */
export type CampaignPriceChangeExitSource = 'main' | 'rolling_hedge' | 'initial_hedge_a' | 'initial_hedge_b' | 'reentry_hedge';

const EXIT_SOURCE_BY_HEDGE_ROLE: Readonly<Record<string, Exclude<CampaignPriceChangeExitSource, 'main'>>> = {
  hedge_rolling: 'rolling_hedge',
  hedge_initial_a: 'initial_hedge_a',
  hedge_initial_b: 'initial_hedge_b',
  reentry_hedge: 'reentry_hedge',
};

const EXIT_SOURCE_LABELS: Readonly<Record<Exclude<CampaignPriceChangeExitSource, 'main'>, string>> = {
  rolling_hedge: '滚动对冲',
  initial_hedge_a: '初始对冲 A',
  initial_hedge_b: '初始对冲 B',
  reentry_hedge: '回场对冲',
};

/**
 * 平仓价规则的一句话说明：盈亏概览（含反事实）的 ⓘ 与列表页的说明都读这一句，规则改了只改这里。
 */
export const PRICE_CHANGE_EXIT_RULE_TEXT = '平仓价看主力平仓那一刻有没有对冲把行情锁住：滚动对冲仍持有、或与主力同一次操作里平掉'
  + '（相差不超过一分钟），以及已触发的初始对冲 A/B、回场对冲与主力同一次操作里平掉，都算锁住——'
  + '有就取其中最早开的那张对冲的开仓价（对冲一挂上，主力后面的行情就不再属于它）；没有就取主力自己的平仓价（最后平的那几笔里最有利的）。';

/** 「本场：开仓价 → 平仓价」的来源注记：「平仓价取滚动对冲的开仓价」「平仓价取主力的平仓价」（不带括号，内联时由调用方加）。 */
export function describePriceChangeExitSource(source: CampaignPriceChangeExitSource | null | undefined): string {
  if (source == null || source === 'main') return '平仓价取主力的平仓价';
  const label = EXIT_SOURCE_LABELS[source];
  // 「初始对冲 B」以字母结尾，后面接汉字时空一格
  return `平仓价取${label}${/[A-Za-z0-9]$/.test(label) ? ' ' : ''}的开仓价`;
}

/** 战役涨幅与它的依据：读数之外，还记下开仓价取自哪一笔主力、平仓价取自主力还是哪张对冲。 */
export interface CampaignPriceChange {
  pct: number | null;
  side: PriceChangeSide | null;
  entryPrice: number | null;
  entryLegId: string | null;
  exitPrice: number | null;
  exitSource: CampaignPriceChangeExitSource | null;
  exitLegId: string | null;
  /** 主力各笔里最晚的平仓时刻；主力都还没平仓时 null。 */
  mainCloseTime: number | null;
}

export const EMPTY_CAMPAIGN_PRICE_CHANGE: CampaignPriceChange = Object.freeze({
  pct: null, side: null, entryPrice: null, entryLegId: null, exitPrice: null, exitSource: null, exitLegId: null, mainCloseTime: null,
});
const NO_PRICE_CHANGE = EMPTY_CAMPAIGN_PRICE_CHANGE;

function usable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function mainLegsOf<T extends { role: string }>(legs: readonly T[]): T[] {
  for (const role of PRIMARY_MAIN_ROLES) {
    const found = legs.filter(leg => leg.role === role);
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * 战役的涨幅（【用户要求】的口径，不再粗糙地取主力各笔里涨幅最大的那笔）：
 *   · 开仓价：主力（main_open）各笔里最有利的那个——主多取最低、主空取最高（并列取最早开的）。
 *   · 主力平仓时刻：主力已平仓各笔里最晚的那个；主力都还没平仓时算不出，显示「—」。
 *   · 平仓价：主力平仓那一刻有对冲把行情锁住，取**其中最早开的那张对冲的开仓价**——对冲一挂上，主力后面的行情就被锁住了，
 *     主力真正吃到的涨幅到对冲开仓为止；否则取主力自己的平仓价（最后平的那几笔里最有利的：主多取最高、主空取最低）。
 *     「锁住」：滚动对冲仍在持有、或与主力同一次操作里平掉（相差 ≤ SAME_CLOSE_TOLERANCE_MS）；
 *     已触发的初始对冲 A/B、回场对冲只认与主力同一次操作里平掉（主力平了它们还挂着不算）。
 *   · 按主力方向计：空单价格跌了为正，与盈亏同号。
 * 涨幅效率、加仓效用、排序、封面、散点图、盈亏概览、导出图、反事实都从这一个数派生。
 */
export function computeCampaignPriceChange(inputs: readonly PriceChangeLegInput[]): CampaignPriceChange {
  const mains = mainLegsOf(inputs);
  if (mains.length === 0) return NO_PRICE_CHANGE;
  const side: PriceChangeSide = mains[0].side;
  const better = (a: number, b: number) => (side === 'long' ? a < b : a > b);

  const entries = mains.filter(leg => usable(leg.entryPrice) && leg.entryPrice > 0);
  if (entries.length === 0) return { ...NO_PRICE_CHANGE, side };
  const entryLeg = entries.reduce((best, leg) => {
    if (better(leg.entryPrice as number, best.entryPrice as number)) return leg;
    if (leg.entryPrice === best.entryPrice && (leg.openTime ?? Infinity) < (best.openTime ?? Infinity)) return leg;
    return best;
  });
  const entryPrice = entryLeg.entryPrice as number;

  const closed = mains.filter(leg => usable(leg.exitPrice) && leg.exitPrice > 0);
  if (closed.length === 0) return { ...NO_PRICE_CHANGE, side, entryPrice, entryLegId: entryLeg.id };
  // 只有平仓价快照、没有平仓时间的主力（Legs 表照样判「已平仓」）也算已平：平仓时刻按记了时间的那几笔；
  // 一笔都没记时间时读不出主力何时平的，对冲锁没锁住也就判不了，按主力自己的平仓价算。
  const timed = closed.filter(leg => usable(leg.closeTime));
  const mainCloseTime = timed.length > 0 ? Math.max(...timed.map(leg => leg.closeTime as number)) : null;
  const finalMains = mainCloseTime == null ? closed : timed.filter(leg => leg.closeTime === mainCloseTime);
  // 最后平的那几笔里最有利的平仓价（主多取最高、主空取最低）
  const exitLeg = finalMains.reduce((best, leg) => (
    (side === 'long' ? (leg.exitPrice as number) > (best.exitPrice as number) : (leg.exitPrice as number) < (best.exitPrice as number)) ? leg : best
  ));

  // 主力平仓那一刻把行情锁住的对冲：取最早开的那张。
  //   · 滚动对冲：还没平（没有平仓价），或平仓时间不早于主力平仓一分钟；
  //   · 初始对冲 A/B、回场对冲：已平仓，且平仓时间与主力相差不超过一分钟（还挂着的不算）。
  // 有平仓价却没记平仓时间的算不出，不当锁住。
  const locks = (leg: PriceChangeLegInput, closeAt: number): boolean => {
    const closedInTime = usable(leg.closeTime) && leg.closeTime > (leg.openTime as number);
    if (leg.role === ROLLING_HEDGE_ROLE) {
      return leg.exitPrice == null || (closedInTime && (leg.closeTime as number) >= closeAt - SAME_CLOSE_TOLERANCE_MS);
    }
    return leg.exitPrice != null && closedInTime && Math.abs((leg.closeTime as number) - closeAt) <= SAME_CLOSE_TOLERANCE_MS;
  };
  const lockingHedge = mainCloseTime == null ? null : inputs
    .filter(leg => isLockingHedgeRole(leg.role) && leg.side !== side
      && usable(leg.entryPrice) && leg.entryPrice > 0
      && usable(leg.openTime) && leg.openTime < mainCloseTime
      && locks(leg, mainCloseTime))
    .sort((a, b) => (a.openTime as number) - (b.openTime as number) || a.id.localeCompare(b.id))[0] ?? null;

  const exitPrice = lockingHedge ? (lockingHedge.entryPrice as number) : (exitLeg.exitPrice as number);
  return {
    pct: computeLegPriceChangePct(entryPrice, exitPrice, side),
    side,
    entryPrice,
    entryLegId: entryLeg.id,
    exitPrice,
    exitSource: lockingHedge ? EXIT_SOURCE_BY_HEDGE_ROLE[lockingHedge.role] : 'main',
    exitLegId: lockingHedge ? lockingHedge.id : exitLeg.id,
    mainCloseTime,
  };
}

function isLockingHedgeRole(role: string | null | undefined): boolean {
  return role === ROLLING_HEDGE_ROLE || (SAME_CLOSE_HEDGE_ROLES as readonly string[]).includes(role ?? '');
}

function isPriceChangeRole(role: string | null | undefined): boolean {
  return isLockingHedgeRole(role) || (PRIMARY_MAIN_ROLES as readonly string[]).includes(role ?? '');
}

/**
 * 真实战役里主力与能锁平仓价的对冲（滚动对冲、初始对冲 A/B、回场对冲）各腿的开平价与时间（按腿 id）。
 * 开平价与 Legs 表逐字同源：成交记录按 buildTradeRecordLookup 查，取 resolveLegExecution（含 1 分钟 K 线平仓价校正、爆仓不改价）；
 * 还没平仓的腿平仓价与平仓时间为 null，与 Legs 表的「—」一致。
 * 哪些腿真的成交过、没有成交记录的对冲从何时起持有，读权益路径同一份事实（resolveCampaignEquityPathLegFacts，
 * 反事实副本 buildManualLegs 也读它）：挂出后从未成交的腿（Legs 表里的「挂单中」）不进来——挂单不是对冲在手；
 * 没有成交记录、靠 hedge_triggered 事件持有的对冲，开仓时刻是触发时刻而不是挂出时刻。
 * 反事实逐腿对账也读这一份：没改过的腿直接沿用这里的数。
 */
export function campaignPriceChangeLegInputs(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  corrections: LegExitPriceCorrections = {},
  localOrders: CampaignLocalOrderFacts = {},
): PriceChangeLegInput[] {
  const lookup = buildTradeRecordLookup(tradeRecords);
  const facts = resolveCampaignEquityPathLegFacts(campaign, legs, tradeRecords, localOrders);
  return legs
    .filter(leg => isPriceChangeRole(leg.leg_role) && !facts.unfilledLegIds.has(leg.id))
    .map(leg => {
      const record = leg.trade_record_id ? lookup.get(leg.trade_record_id) ?? null : null;
      const execution = resolveLegExecution(leg, record, corrections);
      return {
        id: leg.id,
        role: leg.leg_role,
        side: leg.direction === 'short' ? 'short' : 'long',
        entryPrice: execution.entryPrice,
        exitPrice: execution.exitPrice,
        // 没有成交记录的腿按权益路径的持有起点（触发时刻）；有记录的按记录
        openTime: record ? execution.openTime : (facts.heldStartMsByLeg.get(leg.id) ?? execution.openTime),
        closeTime: execution.exitPrice == null ? null : execution.closeTime,
      };
    });
}

/** 真实战役的涨幅及其依据（见 computeCampaignPriceChange）。 */
export function campaignPriceChange(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  corrections: LegExitPriceCorrections = {},
  localOrders: CampaignLocalOrderFacts = {},
): CampaignPriceChange {
  return computeCampaignPriceChange(campaignPriceChangeLegInputs(campaign, legs, tradeRecords, corrections, localOrders));
}

/** 战役列表「涨幅」排序与卡片读数、盈亏概览的「涨幅」：campaignPriceChange 的读数。 */
export function campaignMainLegPriceChangePct(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  corrections: LegExitPriceCorrections = {},
  localOrders: CampaignLocalOrderFacts = {},
): number | null {
  return campaignPriceChange(campaign, legs, tradeRecords, corrections, localOrders).pct;
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
 * 加仓效用 = 盈亏比 b ÷ 涨幅效率。
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

type ManualPriceChangeLeg = Pick<CampaignCounterfactualManualLeg,
  'id' | 'leg_role' | 'direction' | 'open_time' | 'close_time' | 'entry_price' | 'exit_price' | 'enabled' | 'filled' | 'actual'>;

/**
 * 真实战役那一侧算涨幅用到的各腿（campaignPriceChangeLegInputs，按腿 id）与取出来的读数（campaignPriceChange().pct）。
 * 反事实逐腿对账：没改过的腿直接沿用这里的那一份，原样重跑因此逐位相同。
 */
export interface ActualMainPriceChange {
  byLegId: Readonly<Record<string, PriceChangeLegInput>>;
  pct: number | null;
}

function samePrice(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-9;
}

function sameInstant(left: string, right: string): boolean {
  const a = Date.parse(left);
  const b = Date.parse(right);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

function parseTime(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 反事实（手动 Legs 分支）的涨幅：与真实一侧同一条规则（computeCampaignPriceChange），喂的是副本里参与运行的主力与能锁平仓价的对冲。
 *
 * 逐腿、**逐字段**对账（副本里腿 id 不变）：以真实一侧这条腿的那一份为底，只把相对 actual 真正改过的字段
 * （方向、开仓价、平仓价、开仓时间、平仓时间各自比对）换成副本的值——副本的开平价是按分刀、认领、事件快照还原出来的，
 * 与 Legs 表那一行未必是同一对（主力最后一刀被加仓腿认领、换了浏览器只剩快照、一条腿都结算不了……），
 * 原样重跑必须逐位相同，改一格也只能挪这一格，这两点只能靠「没改的字段不重算」保证，不能靠两套还原碰巧一致。
 * 真实一侧没有平仓价的腿（还没平、或一条腿都结算不了），平仓价没改就仍视为未平仓，不拿副本的占位平仓价算；
 * 改了平仓价的按改后的价，平仓时间取副本的。真实一侧没有的腿（新增的、改了角色的）整条按副本算，
 * 实际还没平仓、平仓价也没改过的视为未平仓（引擎只是按数据末端强行结算）。停用的、标着「挂单中」的腿不参与。
 */
export function counterfactualPriceChange(
  manualLegs: readonly ManualPriceChangeLeg[] | null | undefined,
  actualMain?: ActualMainPriceChange | null,
): CampaignPriceChange {
  const byLegId = actualMain?.byLegId ?? {};
  const inputs: PriceChangeLegInput[] = [];
  for (const leg of manualLegs ?? []) {
    if (!leg.enabled || leg.filled === false || !isPriceChangeRole(leg.leg_role)) continue;
    const actual = leg.actual;
    const manualSide: PriceChangeSide = leg.direction === 'short' ? 'short' : 'long';
    const base = Object.prototype.hasOwnProperty.call(byLegId, leg.id) ? byLegId[leg.id] : null;

    if (base && actual) {
      const exitUnchanged = samePrice(leg.exit_price, actual.exit_price);
      const closeUnchanged = actual.close_time_fallback === true || sameInstant(leg.close_time, actual.close_time);
      let exitPrice = exitUnchanged ? base.exitPrice : leg.exit_price;
      let closeTime = closeUnchanged ? base.closeTime : parseTime(leg.close_time);
      // 真实一侧没有平仓价、平仓价也没改：仍是未平仓，平仓时间也不能单独存在
      if (exitUnchanged && base.exitPrice == null) { exitPrice = null; closeTime = null; }
      // 用户给真实一侧还没平的腿定了平仓价：平仓时间取副本的。平仓价没改就不补——
      // 只有平仓价快照、没记平仓时间的腿，副本给的是兜底时间（close_time_fallback），补进去会让它变成「最晚平的主力」
      if (!exitUnchanged && exitPrice != null && closeTime == null) closeTime = parseTime(leg.close_time);
      inputs.push({
        id: leg.id,
        role: leg.leg_role,
        side: leg.direction === actual.direction ? base.side : manualSide,
        entryPrice: samePrice(leg.entry_price, actual.entry_price) ? base.entryPrice : leg.entry_price,
        exitPrice,
        openTime: sameInstant(leg.open_time, actual.open_time) ? base.openTime : parseTime(leg.open_time),
        closeTime,
      });
      continue;
    }

    const stillOpen = actual != null
      && (actual.still_open || actual.close_time_fallback || actual.source === 'unsettled')
      && samePrice(leg.exit_price, actual.exit_price);
    inputs.push({
      id: leg.id,
      role: leg.leg_role,
      side: manualSide,
      entryPrice: leg.entry_price,
      exitPrice: stillOpen ? null : leg.exit_price,
      openTime: parseTime(leg.open_time),
      closeTime: stillOpen ? null : parseTime(leg.close_time),
    });
  }
  return computeCampaignPriceChange(inputs);
}

/** 反事实的涨幅读数（counterfactualPriceChange().pct）。 */
export function counterfactualMainLegPriceChangePct(
  manualLegs: readonly ManualPriceChangeLeg[] | null | undefined,
  actualMain?: ActualMainPriceChange | null,
): number | null {
  return counterfactualPriceChange(manualLegs, actualMain).pct;
}

function isMainAddRole(role: string | null | undefined): boolean {
  return !!role && role.startsWith('main_add');
}

/**
 * 【用户要求】「加仓效用」只对做过加仓的战役计算：没有加仓，这个比值只是「主力盈亏比 ÷ 主力涨幅效率」，
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
