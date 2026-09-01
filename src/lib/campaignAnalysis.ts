import type { KlineData } from '@/hooks/useBinanceData';
import {
  INITIAL_HEDGE_SIZE_PCT,
  MAIN_ADD_ROLES,
  MIRROR_TP_REDUCTION_PCT,
  usesDualHedgeSop,
} from '@/lib/strategyTemplates';
import {
  buildTradeRecordPnlCorrection,
  type LegExitPriceCorrections,
  type TradeRecordPnlCorrection,
} from '@/lib/campaignLegExecution';
import { getPositionNotionalUsd } from '@/lib/tradingSettlement';
import { buildTradeRecordLookup } from '@/lib/objectiveOperationTime';
import { resolveLegExecution } from '@/lib/campaignLegExecution';
import { isHistoricalCampaign, type CampaignEvent, type LegRole, type TradeCampaign, type TradeJournal } from '@/types/journal';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import type { CampaignReverseHedgeOrder, PendingOrder, SettlementMode, TradeRecord } from '@/types/trading';
import { pickPrimaryMainLeg } from '@/lib/campaignPrimaryMainLeg';
import {
  buildCampaignReverseOrderLegMap,
  createMainLegOwnerResolver,
} from '@/lib/campaignReverseOrderAttribution';

export interface StateSegment {
  state: 'state_0_setup' | 'state_1_lockin' | 'state_2_rolling' | 'state_3_exit';
  state_label: string;
  start_time: string;
  end_time: string;
  triggering_event: CampaignEvent | null;
}

export interface HedgePrecision {
  leg_id: string;
  role: 'hedge_initial_a' | 'hedge_initial_b' | 'hedge_rolling';
  trigger_price: number;
  was_triggered: boolean;
  market_extreme_after_trigger: number | null;
  excess_depth_pct: number | null;
  closest_approach_pct: number | null;
  verdict: string;
}

export interface MirrorTpCapture {
  tp_price: number;
  was_triggered: boolean;
  market_extreme_after_trigger: number | null;
  foregone_profit_pct: number | null;
  closest_approach_pct: number | null;
  verdict: string;
}

export interface DecisionAccuracyResult {
  hedge_precision: HedgePrecision[];
  mirror_tp_capture: MirrorTpCapture | null;
  initial_expected_max_loss: number;
  profit_capture_ratio: number;
  campaign_max_drawdown_real: number;
  campaign_max_profit_real: number;
}

export interface CampaignPnlReconciliation {
  officialCampaignPnl: number | null;
  officialLegPnl: number | null;
  correctedLegPnl: number | null;
  baselinePnl: number;
  correctedPnl: number;
  priceCorrectionDelta: number;
  officialVsLegDelta: number | null;
  correctedRecords: TradeRecordPnlCorrection[];
}

export interface Deduction {
  category: 'setup' | 'lockin' | 'rolling' | 'exit';
  points: number;
  reason: string;
  related_event_ids: string[];
}

export interface SopDeviationResult {
  is_applicable: boolean;
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | null;
  deductions: Deduction[];
  total_deductions: number;
  retroactive_leg_count: number;
}

const HEDGE_ROLES: LegRole[] = ['hedge_initial_a', 'hedge_initial_b', 'hedge_rolling'];
const INITIAL_HEDGE_ROLES: LegRole[] = ['hedge_initial_a', 'hedge_initial_b'];
const MAIN_ROLES: LegRole[] = ['main_open', ...MAIN_ADD_ROLES, 'reentry_main'];
const INITIAL_MAIN_EXPOSURE_ROLES: LegRole[] = ['main_open', 'mirror_tp'];
const POSITION_ENTRY_EVENT_TYPES = new Set<CampaignEvent['event_type']>([
  'historical_leg_attached',
  'main_opened',
  'mirror_tp_placed',
]);
import { resolveUnblendedMainEntry } from '@/lib/campaignMainEntryUnblend';

const EPSILON = 0.0001;
const INITIAL_REVERSE_ORDER_COHORT_MS = 5 * 60 * 1000;

const toMs = (value: string) => new Date(value).getTime();
const toIso = (value: number) => new Date(value).toISOString();

function legSize(leg: TradeJournal): number | null {
  if (leg.pre_position_size != null) return leg.pre_position_size;
  if (leg.pre_entry_price != null && leg.pre_max_loss_usdt != null) return leg.pre_entry_price * leg.pre_max_loss_usdt;
  return null;
}

function findTradeRecord(leg: TradeJournal, tradeRecords: TradeRecord[]): TradeRecord | null {
  if (!leg.trade_record_id) return null;
  return buildTradeRecordLookup(tradeRecords).get(leg.trade_record_id) ?? null;
}

function tradeRecordNotionalUsd(record: TradeRecord, price = record.entryPrice): number {
  return getPositionNotionalUsd(record.symbol, record, price || record.entryPrice);
}

/**
 * 老数据的自动补救：主力那条平仓记录若是**合并出来的**，把主力自己的开仓价解回来。
 *
 * 只在能拿到正面证据时才动手（记录名义 = 主力 + 各兄弟腿），拿不到就原样返回。
 * 本次改动之后成交的仓位不走这里——分片各带自己的价，`fillId` 就是标记。
 */
function unblendedMainEntryPrice(
  campaign: TradeCampaign,
  mainLeg: TradeJournal | null,
  mainRecord: TradeRecord | null,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
): number | null {
  if (mainRecord == null || !positiveOrNull(mainRecord.entryPrice)) return null;
  const mainDirection = campaignMainDirection(campaign);
  const siblings = legs
    .filter(leg => leg.id !== mainLeg?.id)
    .filter(leg => leg.leg_role === 'mirror_tp'
      || (leg.leg_role != null && String(leg.leg_role).startsWith('main_add')))
    .filter(leg => leg.direction == null || leg.direction === mainDirection)
    .filter(leg => {
      // 自己另有仓位的说明当初没并进来，减了反而把主力算错。
      const rec = findTradeRecord(leg, tradeRecords);
      return rec == null || rec.positionId == null || rec.positionId === mainRecord.positionId;
    })
    .map(leg => {
      const rec = findTradeRecord(leg, tradeRecords);
      // 记录若就是主力那一条（老数据两条腿指向同一条），它带的是**合计**，不能当成这条腿的。
      const own = rec != null && rec.id !== mainRecord.id ? rec : null;
      const entryPrice = firstPositiveNumber(leg.pre_entry_price, own?.entryPrice);
      const notionalUsd = firstPositiveNumber(
        leg.pre_position_size,
        own ? tradeRecordNotionalUsd(own, own.entryPrice) : null,
      );
      return entryPrice != null && notionalUsd != null ? { entryPrice, notionalUsd } : null;
    })
    .filter((x): x is { entryPrice: number; notionalUsd: number } => x != null);

  const solved = resolveUnblendedMainEntry({
    blendedEntryPrice: mainRecord.entryPrice,
    totalNotionalUsd: tradeRecordNotionalUsd(mainRecord, mainRecord.entryPrice),
    recordFillId: mainRecord.fillId ?? null,
    mainNotionalUsd: firstPositiveNumber(mainLeg?.pre_position_size, campaign.initial_main_size_usdt),
    mergedSiblings: siblings,
  });
  return solved.ok ? solved.entryPrice : null;
}

function positiveOrNull(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}


/**
 * 该引用名下**全部**平仓分片。ref 可能是记录 id、成交 id 或仓位 id，三级顺序与
 * claimRecordsByLeg / buildTradeRecordLookup 一致。
 */
function settlementSlicesFor(ref: string, settlement: TradeRecord[]): TradeRecord[] {
  const exact = settlement.filter(r => r.id === ref);
  if (exact.length > 0) {
    // 精确命中一条之后要把**同一笔成交的其余分刀**一并带上：
    // 一笔成交经 S 次部分平仓有 S 条分片，只认 1 条会把敞口按刀数除下去。
    const fills = new Set(exact.map(r => r.fillId).filter((x): x is string => Boolean(x)));
    return fills.size > 0
      ? settlement.filter(r => r.id === ref || (r.fillId != null && fills.has(r.fillId)))
      : exact;
  }
  // 成交 id 优先于仓位 id：仓位 id 指向的是合并后的聚合仓位。
  const byFill = settlement.filter(r => r.fillId === ref);
  if (byFill.length > 0) return byFill;
  return settlement.filter(r => r.positionId === ref);
}

/**
 * 这条腿**开仓时**的名义，从它全部平仓分片累加得出。
 *
 * 事故：原来直接取 `tradeRecordNotionalUsd(单条记录)`，而那条记录是一次 CLOSE，
 * 它的量是「这一刀关掉了多少」，不是「这一笔开了多少」。币本位下更直接——
 * getPositionNotionalUsd 对币本位完全由 record.contracts 决定，price 参数是死的。
 *
 * 镜像止盈平掉 60% 是按占比从**每笔成交**里各取 60%（scaleSettlementPosition 按 pct
 * 缩 fills），主力那一笔只剩 40%；收尾平仓时读到的就是那 40%。于是：
 *
 *   预期最大亏损 = 133.85（仓位全开着）→ 镜像止盈落袋那一秒 → 53.54
 *
 * 一个 **ex-ante** 的量会随着行情走对而缩水，而它是盈亏比与 R 倍数的**分母**——
 * 分母缩 60%，盈亏比虚抬 2.5 倍，方向是「这笔仓位没那么危险」。
 * 这个 bug 只在止盈之后发作，而那时用户正在高兴，所以能活很久。
 *
 * 各分片之和恰好等于开仓量：按比例缩之后每一刀都会碰到每一笔成交，Σ 回到原值
 * （币本位整数张有 ±1 张的取整漂移，量级可忽略）。
 */
function openingNotionalUsd(
  ref: string | null | undefined,
  settlement: TradeRecord[],
): number | null {
  if (!ref) return null;
  const slices = settlementSlicesFor(ref, settlement);
  if (slices.length === 0) return null;
  const total = slices.reduce((sum, r) => sum + tradeRecordNotionalUsd(r, r.entryPrice), 0);
  return total > EPSILON ? total : null;
}

/**
 * 承载敞口的记录。只把资金费排除掉——它与开仓量无关，混进来会虚增敞口。
 *
 * 不能反过来写成「只要 CLOSE / LIQUIDATION」：老记录与部分测试夹具**没有 action 字段**，
 * 白名单会把它们整批滤掉，敞口退回快照、快照为空时整条腿消失。
 * 这个应用不写 OPEN 记录，所以「非资金费」等价于「结算」。
 */
function settlementRecordsOf(tradeRecords: TradeRecord[]): TradeRecord[] {
  return tradeRecords.filter(r => r.action !== 'FUNDING');
}

function firstPositiveNumber(...values: Array<number | null | undefined>): number | null {
  const value = values.find(candidate => Number.isFinite(candidate) && Number(candidate) > EPSILON);
  return value == null ? null : Number(value);
}

function uniquePrices(prices: number[], limit = INITIAL_HEDGE_ROLES.length): number[] {
  const result: number[] = [];
  for (const price of prices) {
    const duplicate = result.some(existing =>
      Math.abs(existing - price) <= Math.max(EPSILON, Math.abs(existing) * 1e-6),
    );
    if (!duplicate) result.push(price);
    if (result.length >= limit) break;
  }
  return result;
}

function resolveInitialReverseHedgePrices(
  campaign: TradeCampaign,
  reverseHedgeOrders: CampaignReverseHedgeOrder[],
  mainOpenedAt: number | null,
  roleHedgePrices: number[],
): number[] {
  const expectedSide = campaign.direction === 'main_long' ? 'SHORT' : 'LONG';
  const eligibleOrders = [...reverseHedgeOrders]
    .filter(order => order.side === expectedSide && firstPositiveNumber(order.price) != null)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (eligibleOrders.length === 0) return [];

  const initialOrderIds = new Set(
    (campaign.actual_evolution ?? [])
      .filter(event =>
        event.pending_order_id != null
        && event.leg_role != null
        && INITIAL_HEDGE_ROLES.includes(event.leg_role),
      )
      .map(event => event.pending_order_id as string),
  );
  const roleMatchedPrices = eligibleOrders
    .filter(order => initialOrderIds.has(order.id))
    .map(order => order.price);
  if (roleMatchedPrices.length > 0) return uniquePrices(roleMatchedPrices);

  // Some historical snapshots predate explicit A/B role events. Initial
  // protection orders are submitted as one opening cohort; a later rolling
  // hedge is a new decision and must never expand the ex-ante risk boundary.
  const cohortStart = mainOpenedAt == null
    ? eligibleOrders[0].createdAt
    : mainOpenedAt - INITIAL_REVERSE_ORDER_COHORT_MS;
  const cohortEnd = mainOpenedAt == null
    ? eligibleOrders[0].createdAt + INITIAL_REVERSE_ORDER_COHORT_MS
    : mainOpenedAt + INITIAL_REVERSE_ORDER_COHORT_MS;
  const openingCohortPrices = uniquePrices(
    eligibleOrders
      .filter(order => order.createdAt >= cohortStart && order.createdAt <= cohortEnd)
      .map(order => order.price),
  );
  if (openingCohortPrices.length > 0) return openingCohortPrices;

  // A number of early imports retained relative/order-sequence timestamps
  // instead of wall-clock timestamps. Recover the original order price only
  // when its fill can be paired with an explicit initial A/B leg.
  const fillMatchedPrices = eligibleOrders
    .filter(order => {
      const fillPrice = firstPositiveNumber(order.fillPrice);
      if (fillPrice == null) return false;
      return roleHedgePrices.some(rolePrice =>
        Math.abs(rolePrice - fillPrice) <= Math.max(EPSILON, Math.abs(rolePrice) * 1e-6),
      );
    })
    .map(order => order.price);
  if (fillMatchedPrices.length > 0) return uniquePrices(fillMatchedPrices);

  // The oldest snapshots have neither A/B role legs nor absolute timestamps.
  // In that format, order sequence is the only surviving opening-cohort signal.
  if (roleHedgePrices.length === 0) {
    const legacyCohortEnd = eligibleOrders[0].createdAt + INITIAL_REVERSE_ORDER_COHORT_MS;
    return uniquePrices(
      eligibleOrders
        .filter(order => order.createdAt <= legacyCohortEnd)
        .map(order => order.price),
    );
  }

  return [];
}

/** 最早开仓的那笔主力（权益快照口径）。 */
function findEarliestMainLeg(legs: TradeJournal[]): TradeJournal | null {
  return legs
    .filter(leg => leg.leg_role === 'main_open')
    .sort((a, b) => toMs(a.pre_simulated_time) - toMs(b.pre_simulated_time))[0] ?? null;
}

/** 这笔镜像所属主力那一组的开仓敞口；单笔主力时返回 null 走原路径。 */
function resolveMirrorGroupExposure(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  mirrorLeg: TradeJournal,
): number | null {
  const mainLegs = legs
    .filter(leg => leg.leg_role === 'main_open')
    .sort((a, b) => toMs(a.pre_simulated_time) - toMs(b.pre_simulated_time));
  if (mainLegs.length <= 1) return null;
  const legWindow = (leg: TradeJournal) => {
    const exec = resolveLegExecution(leg, findTradeRecord(leg, tradeRecords));
    return { openMs: exec.openTime ?? null, closeMs: exec.closeTime ?? null };
  };
  const ownerForLeg = createMainLegOwnerResolver(legs, { legWindow, tieBreak: 'nearest-open' });
  const groups = groupInitialMainExposure(campaign, legs, tradeRecords, mainLegs, ownerForLeg);
  const owner = ownerForLeg(firstPositiveNumber(
    findTradeRecord(mirrorLeg, tradeRecords)?.openTime,
    toMs(mirrorLeg.pre_simulated_time),
  ));
  const grouped = owner ? groups.get(owner.id) : null;
  return grouped != null && grouped > EPSILON ? grouped : null;
}

function findInitialMainLeg(legs: TradeJournal[]): TradeJournal | null {
  // 多笔主仓时以名义金额最大的那笔为准（并列时退回最早开仓），
  // 否则一笔残仓排在前面就会把开仓价、风险锚整体带偏。
  return pickPrimaryMainLeg(legs.filter(leg => leg.leg_role === 'main_open'));
}

interface InitialRiskAnchor {
  initialMainExposureNotional: number;
  drawdownFraction: number;
}

function campaignMainDirection(campaign: TradeCampaign): 'long' | 'short' {
  return campaign.direction === 'main_short' ? 'short' : 'long';
}

function isInitialMainExposurePosition(
  campaign: TradeCampaign,
  role: LegRole | null,
  direction: TradeJournal['direction'] | null | undefined,
): boolean {
  if (role == null || !INITIAL_MAIN_EXPOSURE_ROLES.includes(role)) return false;
  if (direction === 'long' || direction === 'short') {
    return direction === campaignMainDirection(campaign);
  }
  return true;
}

function resolvedRecordIdentity(record: TradeRecord | null): string | null {
  return record ? `record:${record.id}` : null;
}

function positionIdentity(
  record: TradeRecord | null,
  recordReference: string | null | undefined,
  journalId: string | null | undefined,
  fallback: string,
): string {
  return resolvedRecordIdentity(record)
    ?? (recordReference ? `record-ref:${recordReference}` : null)
    ?? (journalId ? `journal:${journalId}` : fallback);
}

/**
 * 同一笔仓位的**全部别名**，而不是只有「胜出的那一个」。
 *
 * 事故 BMTUSDT 2025-04-28：开仓敞口显示 13,543,000，恰好是真值 6,771,500 的 **2.000 倍**，
 * 预期最大亏损 564,753 而不是 282,372，盈亏比因此从 29.6% 塌成 14.8%。
 *
 * 敞口有两条来源——`legs` 与 `actual_evolution` 事件流——靠 positionIdentity 去重。
 * 但同一笔仓位从两条路走出来的字符串可以不一样：
 *   · 腿这边关联得到记录  → `record:rm`
 *   · 事件那边只有 journal_id、`trade_record_id` 还是 null → `journal:m`
 * 回填流程正是「先建 journal、发事件、**再**关联记录」，发事件那一刻 ref 还是空的，
 * 于是留下一个对不上的别名，同一笔仓位进账两次。
 *
 * 「恰好 2.000 倍」这个整数比本身就是判据：价格、滑点、精度的误差不会给出整洁的 2。
 *
 * 登记全部别名之后，任一别名撞上就算见过——两条路径从此不可能各记一次。
 */
function positionIdentityAliases(
  record: TradeRecord | null,
  recordReference: string | null | undefined,
  journalId: string | null | undefined,
  fallback: string,
): string[] {
  const keys = [
    resolvedRecordIdentity(record),
    recordReference ? `record-ref:${recordReference}` : null,
    // 记录自带的 id 也要登记：腿按 ref 找到它、事件按 record.id 找到它，两边要能对上。
    record?.id ? `record-ref:${record.id}` : null,
    journalId ? `journal:${journalId}` : null,
  ].filter((k): k is string => Boolean(k));
  return keys.length > 0 ? keys : [fallback];
}

/**
 * 内容别名：当两条路径**一个 id 都不共享**时的最后一道链接。
 *
 * 形状 (c)：腿没有 trade_record_id（用户手工建的腿），而记录派生的事件
 * `journal_id` 恒为 null（见 campaignEventFromTradeRecord）——两边的 id 别名集合
 * 交集为空，纯靠 id 永远对不上，同一笔仓位仍会记两次。
 *
 * 上一版用「角色 + 名义取整 + 开仓分钟」拼成字符串做指纹，**方向错了**：
 * 那是拿**精确哈希**去做**近似匹配**。哈希只能回答「完全相同吗」，而这里要问的是
 * 「是不是同一笔仓位」。两条来源对时间的理解本就不同——回填事件带的往往是
 * **归类那一刻**的时间戳（2026-09-01），不是开仓时刻（2025-04-29）；名义也可能差几毛钱。
 * 实测三种形状仍然整整翻倍：事件时间戳取归类时刻、时间戳跨分钟桶边界差 2 秒、
 * 名义差 1 USDT。等于只是把失效的门槛从「id 不同」挪到了「分钟不同」。
 *
 * 现在的判据分两层，且**腿是权威来源**：
 *   · 腿：只按 id 别名去重，**绝不做内容合并**。腿有几条就是几笔——
 *     两笔名义恰好相同的主力是合法的（多主力战役），内容合并会把它们吃掉一条。
 *   · 事件：先按 id 别名认领；认不上再按「同角色 + 名义相对误差 ≤ 0.1%」认领已有的那一笔。
 *     两者都认不上才算一笔新仓位——那对应「腿已不在、只剩事件流」的老战役。
 * 时间彻底不进判据：它在两条来源之间系统性地不一致，只会制造假阴性。
 */
interface ClaimedPosition {
  aliases: Set<string>;
  role: string;
  notional: number;
}

/** 名义相对误差 0.1%：够吸收滑点与取整，又远小于两笔真实仓位之间的差距。 */
const NOTIONAL_MATCH_TOLERANCE = 1e-3;

function sameNotional(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(a) * NOTIONAL_MATCH_TOLERANCE);
}

/**
 * 认领一笔仓位。返回 true 表示这是**新的一笔**、该计入敞口。
 * `allowContentMatch` 为 false 时只按 id 认领——腿那一侧用它。
 */
function claimPosition(
  claimed: ClaimedPosition[],
  aliases: string[],
  role: string | null | undefined,
  notional: number,
  allowContentMatch: boolean,
): boolean {
  const existingById = claimed.find(item => aliases.some(key => item.aliases.has(key)));
  if (existingById) {
    for (const key of aliases) existingById.aliases.add(key);
    return false;
  }
  if (allowContentMatch && role) {
    const existingByShape = claimed.find(item =>
      item.role === role && sameNotional(item.notional, notional));
    if (existingByShape) {
      // 把事件的 id 并进去，后续同一笔的其它事件可以直接按 id 命中。
      for (const key of aliases) existingByShape.aliases.add(key);
      return false;
    }
  }
  claimed.push({ aliases: new Set(aliases), role: role ?? '', notional });
  return true;
}

/**
 * Resolve the full opening exposure before the mirror TP closes. This is the
 * initial M position plus every initial mirror position on the same side. Later
 * additions/re-entries and reverse hedges are deliberately excluded. Event
 * snapshots fill legacy campaigns that no longer have local journals, while
 * stable record/journal identities prevent double counting.
 */
function resolveInitialMainExposureNotional(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  mainLeg: TradeJournal | null,
  mainRecord: TradeRecord | null,
  mainEvent: CampaignEvent | null,
): number | null {
  const recordLookup = buildTradeRecordLookup(tradeRecords);
  const settlement = settlementRecordsOf(tradeRecords);

  /**
   * 敞口有两条来源：腿（trade_journals）与事件流（campaign.actual_evolution）。
   * 同一笔仓位两边都描述一遍，于是要么去重、要么翻倍。
   *
   * 前两版都在做**跨来源匹配**：先按 id 别名，再加「角色+名义+开仓分钟」的内容指纹。
   * 两版都失败了，因为两条来源在系统层面就不一致——回填事件带的是**归类那一刻**的
   * 时间戳（2026-09-01），不是开仓时刻（2025-04-29）；名义还可能差几毛钱。
   * 每修一次，只是把失效门槛从「id 不同」挪到「分钟不同」，再挪到「名义差一块钱」。
   *
   * 所以改成**结构上不可能翻倍**的做法：**按角色分，腿存在就只用腿**。
   * 事件流只在某个角色**一条腿都没有**时兜底——那对应「腿已不在、只剩事件流」的老战役。
   * 两条来源不再相加，也就不存在「有没有对上」这个问题。
   *
   * 按角色而不是整体切换，是为了兼容「主力有腿、镜像只在事件里」这种半残数据。
   */
  const collect = (entries: Array<{ role: string; notional: number }>, role: string) =>
    entries.filter(item => item.role === role).reduce((sum, item) => sum + item.notional, 0);

  // ① 腿：权威来源。腿之间天然按 id 互不相同，无需去重。
  const legEntries: Array<{ role: string; notional: number }> = [];
  for (const leg of legs) {
    if (!isInitialMainExposurePosition(campaign, leg.leg_role, leg.direction)) continue;
    const notional = firstPositiveNumber(
      openingNotionalUsd(leg.trade_record_id, settlement),
      leg.pre_position_size,
    );
    if (notional == null || !leg.leg_role) continue;
    legEntries.push({ role: leg.leg_role, notional });
  }

  // ② 事件：只在同角色没有腿时才会被用到；事件**之间**仍要去重
  //    （main_opened 与 historical_leg_attached 可能描述同一笔）。
  const eventClaimed: ClaimedPosition[] = [];
  const eventEntries: Array<{ role: string; notional: number }> = [];
  for (const event of [...(campaign.actual_evolution ?? [])]
    .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp))) {
    if (!POSITION_ENTRY_EVENT_TYPES.has(event.event_type)) continue;
    if (!isInitialMainExposurePosition(campaign, event.leg_role, event.direction)) continue;
    const record = event.trade_record_id ? recordLookup.get(event.trade_record_id) ?? null : null;
    const notional = firstPositiveNumber(
      record ? tradeRecordNotionalUsd(record, record.entryPrice) : null,
      event.size_usdt,
    );
    if (notional == null || !event.leg_role) continue;
    const aliases = positionIdentityAliases(
      record, event.trade_record_id, event.journal_id, `event:${event.id}`);
    if (!claimPosition(eventClaimed, aliases, event.leg_role, notional, true)) continue;
    eventEntries.push({ role: event.leg_role, notional });
  }

  // ③ 逐角色取用：有腿用腿，没腿才用事件。两者永不相加。
  let total = 0;
  for (const role of INITIAL_MAIN_EXPOSURE_ROLES) {
    const fromLegs = collect(legEntries, role);
    total += fromLegs > EPSILON ? fromLegs : collect(eventEntries, role);
  }

  // ④ 主力那一档两条来源都空时，退回战役级快照（老战役连腿带事件都没有）。
  const mainRole = mainLeg?.leg_role ?? 'main_open';
  const hasMain = collect(legEntries, mainRole) > EPSILON || collect(eventEntries, mainRole) > EPSILON;
  if (!hasMain) {
    const fallback = firstPositiveNumber(
      openingNotionalUsd(mainLeg?.trade_record_id, settlement),
      mainLeg?.pre_position_size,
      mainEvent?.size_usdt,
      mainRecord ? tradeRecordNotionalUsd(mainRecord, mainRecord.entryPrice) : null,
      campaign.initial_main_size_usdt,
    );
    if (fallback != null) total += fallback;
  }

  return total > EPSILON ? total : null;
}

/**
 * 把开仓敞口**按主力分组**：每笔主力 + 归属于它的镜像止盈。
 *
 * 分组前先按 positionIdentity 去重（与上面同一套身份），否则一笔镜像会被两组各记一次。
 * 镜像归属用「开仓时刻落在哪笔主力的持仓窗口里」——本场两笔镜像与各自主力**同秒**开出，
 * 分完之后 61430/(40960+61430) 与 133880/(89260+133880) 都恰好是 60.0%，
 * 正是策略写死的 40/60 分割；这证明分组是真的，不是凑出来的。
 */
function groupInitialMainExposure(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  mainLegs: TradeJournal[],
  ownerAt: (t: number | null | undefined) => TradeJournal | null,
): Map<string, number> {
  const recordLookup = buildTradeRecordLookup(tradeRecords);
  const settlement = settlementRecordsOf(tradeRecords);
  const claimed: ClaimedPosition[] = [];
  const groups = new Map<string, number>();
  const earliestKey = mainLegs[0]?.id ?? null;

  const add = (ownerId: string | null, notional: number) => {
    const key = ownerId ?? earliestKey;
    if (key == null) return;
    groups.set(key, (groups.get(key) ?? 0) + notional);
  };

  /**
   * 与 resolveInitialMainExposureNotional 同一条结构性原则：**按角色分，腿存在就只用腿**。
   * 两条来源永不相加，翻倍在结构上不可能发生（跨来源匹配为什么不管用，见那边的长注释）。
   */
  const rolesWithLegs = new Set<string>();
  for (const leg of legs) {
    if (!isInitialMainExposurePosition(campaign, leg.leg_role, leg.direction)) continue;
    const record = leg.trade_record_id ? recordLookup.get(leg.trade_record_id) ?? null : null;
    const notional = firstPositiveNumber(
      openingNotionalUsd(leg.trade_record_id, settlement),
      leg.pre_position_size,
    );
    if (notional == null || !leg.leg_role) continue;
    rolesWithLegs.add(leg.leg_role);
    // 主力自己就是自己的组;镜像按开仓时刻归属。
    const owner = leg.leg_role === 'main_open'
      ? leg
      : ownerAt(firstPositiveNumber(record?.openTime, toMs(leg.pre_simulated_time)));
    add(owner?.id ?? null, notional);
  }

  for (const event of [...(campaign.actual_evolution ?? [])]
    .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp))) {
    if (!POSITION_ENTRY_EVENT_TYPES.has(event.event_type)) continue;
    if (!isInitialMainExposurePosition(campaign, event.leg_role, event.direction)) continue;
    // 该角色已有腿 → 事件只是同一批仓位的另一种描述，整批跳过。
    if (!event.leg_role || rolesWithLegs.has(event.leg_role)) continue;
    const record = event.trade_record_id ? recordLookup.get(event.trade_record_id) ?? null : null;
    const notional = firstPositiveNumber(
      record ? tradeRecordNotionalUsd(record, record.entryPrice) : null,
      event.size_usdt,
    );
    if (notional == null) continue;
    // 事件**之间**仍要去重：main_opened 与 historical_leg_attached 可能描述同一笔。
    if (!claimPosition(
      claimed,
      positionIdentityAliases(record, event.trade_record_id, event.journal_id, `event:${event.id}`),
      event.leg_role, notional, true,
    )) continue;
    const owner = ownerAt(firstPositiveNumber(record?.openTime, toMs(event.timestamp)));
    add(owner?.id ?? null, notional);
  }

  /**
   * 战役级兜底只能落到**最早**那笔主力头上。
   * 单主力那条路径一直有这一级（firstPositiveNumber 链的最后一环），
   * 分组版漏掉它的后果是：一笔既没有 pre_position_size、也没有成交记录的主力
   * 敞口变 0 → 预期最大亏损记 0 → **盈亏比被抬高**，是往危险方向错。
   * `initial_main_size_usdt` 是按「最早那笔主力」写进库的（journalApi 的口径），
   * 所以只能给它，不能当成整组的总额。
   */
  const earliest = mainLegs[0];
  if (earliest && !(groups.get(earliest.id) ?? 0)) {
    const fallback = firstPositiveNumber(campaign.initial_main_size_usdt);
    if (fallback != null) groups.set(earliest.id, fallback);
  }

  return groups;
}

/**
 * Initial main opening notional in USDT. A long campaign sums every opening M
 * and mirror-long slice; a short campaign applies the same rule symmetrically.
 */
export function computeInitialMainExposureNotional(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
): number {
  const mainLeg = findInitialMainLeg(legs);
  const mainRecord = mainLeg ? findTradeRecord(mainLeg, tradeRecords) : null;
  const mainEvent = (campaign.actual_evolution ?? []).find(event =>
    event.leg_role === 'main_open' && firstPositiveNumber(event.entry_price, event.price) != null,
  ) ?? null;
  return resolveInitialMainExposureNotional(
    campaign,
    legs,
    tradeRecords,
    mainLeg,
    mainRecord,
    mainEvent,
  ) ?? 0;
}

/**
 * Percentage of the full initial main-side exposure closed by one mirror TP.
 *
 * The denominator follows the campaign overview's full-exposure definition:
 * initial M + the initial mirror position(s), before any mirror TP is taken.
 * This keeps historical 50/50 splits at 50% and newer 40/60 splits at 60%.
 */
export function computeMirrorTpReductionPct(
  campaign: TradeCampaign,
  mirrorLeg: TradeJournal,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
): number | null {
  if (mirrorLeg.leg_role !== 'mirror_tp') return null;

  /**
   * 分母是**这笔镜像所属的那一组**主力敞口，不是全场之和。
   * 多笔主力时用全场当分母会把 60/40 的分割算成 18.87% / 41.13%——
   * 而上面那段注释明明白白承诺「newer 40/60 splits at 60%」，
   * 那在任何两笔主力的战役上都是一句做不到的话。按组分完正好是 60.0% / 60.0%。
   */
  const fullInitialExposure = resolveMirrorGroupExposure(campaign, legs, tradeRecords, mirrorLeg)
    ?? computeInitialMainExposureNotional(campaign, legs, tradeRecords);
  if (fullInitialExposure <= EPSILON) return null;

  const mirrorRecord = findTradeRecord(mirrorLeg, tradeRecords);
  const mirrorEvents = (campaign.actual_evolution ?? [])
    .filter(event =>
      event.leg_role === 'mirror_tp'
      && (
        event.journal_id === mirrorLeg.id
        || Boolean(mirrorLeg.trade_record_id && event.trade_record_id === mirrorLeg.trade_record_id)
      ),
    )
    .sort((a, b) => {
      const priority = (event: CampaignEvent) => {
        if (event.event_type === 'mirror_tp_placed') return 0;
        if (event.event_type === 'historical_leg_attached') return 1;
        if (event.event_type === 'mirror_tp_triggered') return 2;
        return 3;
      };
      return priority(a) - priority(b) || toMs(a.timestamp) - toMs(b.timestamp);
    });
  const roleFallbackEvent = (campaign.actual_evolution ?? [])
    .filter(event => event.leg_role === 'mirror_tp' && firstPositiveNumber(event.size_usdt) != null)
    .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp))[0] ?? null;
  const mirrorNotional = firstPositiveNumber(
    openingNotionalUsd(mirrorLeg.trade_record_id, settlementRecordsOf(tradeRecords)),
    mirrorLeg.pre_position_size,
    mirrorEvents[0]?.size_usdt,
    roleFallbackEvent?.size_usdt,
  );
  if (mirrorNotional == null) return null;

  const percentage = mirrorNotional / fullInitialExposure * 100;
  return Number.isFinite(percentage) && percentage > EPSILON ? percentage : null;
}

/**
 * Resolve the shared initial risk anchor used by maximum drawdown percentage
 * and maximum expected loss. Historical role legs are reconstructed from
 * fills, so preserved order snapshots take precedence; actual fill prices are
 * only a fallback when no original snapshot survives.
 */
function resolveInitialRiskAnchor(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  reverseHedgeOrders: CampaignReverseHedgeOrder[] = [],
): InitialRiskAnchor | null {
  const mainLeg = findInitialMainLeg(legs);
  const mainRecord = mainLeg ? findTradeRecord(mainLeg, tradeRecords) : null;
  const mainEvent = (campaign.actual_evolution ?? []).find(event =>
    event.leg_role === 'main_open' && firstPositiveNumber(event.entry_price, event.price) != null,
  ) ?? null;
  // 老数据的主力记录可能是合并出来的:先试着把主力自己的开仓价解回来,
  // 解不出(新数据、没有兄弟腿、或名义对不上)就原样走今天这条链。
  const entryPrice = firstPositiveNumber(
    unblendedMainEntryPrice(campaign, mainLeg, mainRecord, legs, tradeRecords),
    mainRecord?.entryPrice,
    mainLeg?.pre_entry_price,
    mainEvent?.entry_price,
    mainEvent?.price,
  );
  const initialMainExposureNotional = resolveInitialMainExposureNotional(
    campaign,
    legs,
    tradeRecords,
    mainLeg,
    mainRecord,
    mainEvent,
  );
  if (entryPrice == null || initialMainExposureNotional == null) return null;
  const historical = isHistoricalCampaign(campaign);

  const roleHedgePrices = INITIAL_HEDGE_ROLES.flatMap(role => {
    const roleLegs = legs
      .filter(leg => leg.leg_role === role)
      .sort((a, b) => toMs(a.pre_simulated_time) - toMs(b.pre_simulated_time));
    const plannedLeg = roleLegs.find(leg => firstPositiveNumber(leg.pre_entry_price) != null) ?? null;
    const plannedPrice = firstPositiveNumber(plannedLeg?.pre_entry_price);
    if (plannedPrice != null) return [plannedPrice];

    const recordLeg = roleLegs.find(leg => findTradeRecord(leg, tradeRecords) != null) ?? null;
    const recordPrice = recordLeg
      ? firstPositiveNumber(findTradeRecord(recordLeg, tradeRecords)?.entryPrice)
      : null;
    if (recordPrice != null) return [recordPrice];

    const event = (campaign.actual_evolution ?? [])
      .filter(item => item.leg_role === role)
      .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp))
      .find(item => firstPositiveNumber(item.entry_price, item.price) != null);
    const eventPrice = firstPositiveNumber(event?.entry_price, event?.price);
    return eventPrice == null ? [] : [eventPrice];
  });
  const mainOpenedAt = firstPositiveNumber(
    mainRecord?.openTime,
    mainLeg ? toMs(mainLeg.pre_simulated_time) : null,
    mainEvent ? toMs(mainEvent.timestamp) : null,
    toMs(campaign.opened_at),
  );
  const initialReversePrices = resolveInitialReverseHedgePrices(
    campaign,
    reverseHedgeOrders,
    mainOpenedAt,
    roleHedgePrices,
  );

  // Historical A/B legs are reconstructed from fills, so their entry prices can
  // include slippage. When original order snapshots exist, those snapshots are
  // the only valid ex-ante risk boundary. Role prices remain the fallback for
  // older campaigns that have no preserved order history at all.
  const hedgePrices = historical && initialReversePrices.length > 0
    ? [...initialReversePrices]
    : [...roleHedgePrices];
  if (hedgePrices.length < INITIAL_HEDGE_ROLES.length && !historical) {
    for (const price of initialReversePrices) {
      const duplicate = hedgePrices.some(
        (existing) =>
          Math.abs(existing - price) <=
          Math.max(EPSILON, Math.abs(existing) * 1e-6),
      );
      if (!duplicate) hedgePrices.push(price);
      if (hedgePrices.length >= INITIAL_HEDGE_ROLES.length) break;
    }
  }
  if (hedgePrices.length === 0) return null;

  return {
    initialMainExposureNotional,
    drawdownFraction: Math.max(...hedgePrices.map(price => Math.abs(price - entryPrice) / entryPrice)),
  };
}

/**
 * max(|main entry - initial hedge A|, |main entry - initial hedge B|)
 * divided by the main entry price, expressed in percentage points.
 */
export function computeInitialExpectedMaxDrawdownPct(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  reverseHedgeOrders: CampaignReverseHedgeOrder[] = [],
): number {
  const risk = resolveMainRiskAnchors(campaign, legs, tradeRecords, reverseHedgeOrders);
  // 多笔主力时取**敞口加权**的等效回撤率：它是唯一能让
  // 「最大预期亏损 = 名义仓位 × 预期回撤比例」这条帮助文案继续字面成立的定义，
  // 也是唯一在单笔主力时退化回原值的定义。
  // 分母只算**锚得出跌幅**的那部分敞口：锚不出来的腿已经在分子记 0，
  // 再放进分母就是罚两次。
  // 分母取**全额**敞口——界面把「主力开仓名义仓位」和「预期回撤比例」并排印出来，
  // 中间还写着 L = 名义 × 回撤率。除以「已锚敞口」会让这条等式在有腿锚不出来时变成假话
  // （实测 13,704 vs 相乘得到的 43,570，差 3.18 倍）。宁可让 d 反映
  // 「这部分敞口没被定价」，也不要让两张卡片相乘对不上。
  if (risk.fullExposureNotional <= EPSILON) return 0;
  return (risk.expectedMaxLoss / risk.fullExposureNotional) * 100;
}

/**
 * Initial maximum expected loss used by payoff ratio:
 * full initial main exposure x initial maximum expected drawdown fraction.
 * A long campaign includes the opening M and mirror-long slices before mirror
 * TP; later additions/re-entries and reverse hedges are excluded. A short
 * campaign applies the same rule symmetrically.
 */
/** 一笔主力自己的风险锚。 */
export interface MainRiskAnchor {
  mainLegId: string;
  exposureNotional: number;
  /** 到它**自己**的初始保护线的跌幅；取不到时为 null。 */
  drawdownFraction: number | null;
  /** fraction × exposure；锚不出来时为 0（绝不借用别人的跌幅）。 */
  expectedMaxLoss: number;
}

export interface CampaignRiskAnchors {
  anchors: MainRiskAnchor[];
  /** Σ 各主力自身的预期最大亏损。 */
  expectedMaxLoss: number;
  /** 能锚出跌幅的那部分敞口之和——作为等效回撤率的分母。 */
  anchoredExposureNotional: number;
  /** 锚不出来的敞口：它在分子里记 0，所以 L 是**下限**，不是准确值。 */
  unanchoredExposureNotional: number;
  /** 界面「主力开仓名义仓位」印的那个全额，用来保住 L = 回撤率 × 名义 这条等式。 */
  fullExposureNotional: number;
}

/**
 * 逐笔主力各算各的风险锚，然后求和。
 *
 * 事故：一场战役有两笔主力时，`findInitialMainLeg` 按名义金额只挑一笔，
 * 于是**跌幅取自那一笔、敞口却是全部主力之和**——同一个数里混了两套口径。
 * 实盘那张卡：主力1 到它自己保护线的跌幅是 13.38%，主力2 是 6.81%；
 * 系统拿 6.81% 去给两笔加起来的 325,530 敞口计价，主力1 的 102,390 敞口
 * 被按别人的止损宽度算了。
 *
 * 关键分寸：**归属决定「哪一笔」，±5 分钟开仓 cohort 决定「哪些委托算 ex-ante」**——
 * 两者是相乘的关系，不能互相替代。若把「该主力持仓期内的所有委托」都算进保护线，
 * 主力2 后面那几张 0.117–0.130 的追踪单（在多单开仓价**上方**）会被 |·| 当成风险，
 * 预期最大亏损反而随着行情走对而变大、盈亏比塌到 0.67——那等于惩罚正确的移动止盈。
 */
export function resolveMainRiskAnchors(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  reverseHedgeOrders: CampaignReverseHedgeOrder[] = [],
): CampaignRiskAnchors {
  const mainLegs = legs
    .filter(leg => leg.leg_role === 'main_open')
    .sort((a, b) => toMs(a.pre_simulated_time) - toMs(b.pre_simulated_time));

  // 单笔主力（含 0 笔的纯事件战役）走原路径，逐字节不变。
  if (mainLegs.length <= 1) {
    const anchor = resolveInitialRiskAnchor(campaign, legs, tradeRecords, reverseHedgeOrders);
    if (anchor == null) {
      return {
        anchors: [], expectedMaxLoss: 0, anchoredExposureNotional: 0,
        unanchoredExposureNotional: 0, fullExposureNotional: 0,
      };
    }
    return {
      anchors: [{
        mainLegId: mainLegs[0]?.id ?? '',
        exposureNotional: anchor.initialMainExposureNotional,
        drawdownFraction: anchor.drawdownFraction,
        expectedMaxLoss: anchor.drawdownFraction * anchor.initialMainExposureNotional,
      }],
      expectedMaxLoss: anchor.drawdownFraction * anchor.initialMainExposureNotional,
      anchoredExposureNotional: anchor.initialMainExposureNotional,
      unanchoredExposureNotional: 0,
      fullExposureNotional: anchor.initialMainExposureNotional,
    };
  }

  const legWindow = (leg: TradeJournal) => {
    const rec = findTradeRecord(leg, tradeRecords);
    const exec = resolveLegExecution(leg, rec);
    return { openMs: exec.openTime ?? null, closeMs: exec.closeTime ?? null };
  };
  // 委托归属沿用金额裁决（残仓 vs 真主力）；镜像/角色腿用「开仓最接近」——它们与主力同秒开出。
  const ownerForOrder = createMainLegOwnerResolver(legs, { legWindow });
  const ownerForLeg = createMainLegOwnerResolver(legs, { legWindow, tieBreak: 'nearest-open' });
  const exposureByMain = groupInitialMainExposure(campaign, legs, tradeRecords, mainLegs, ownerForLeg);
  const historical = isHistoricalCampaign(campaign);
  const expectedSide = campaign.direction === 'main_long' ? 'SHORT' : 'LONG';

  const anchors: MainRiskAnchor[] = [];
  for (const [index, mainLeg] of mainLegs.entries()) {
    const mainRecord = findTradeRecord(mainLeg, tradeRecords);
    // 事件兜底:legs 已不在、只剩事件流的老战役靠它取开仓价与开仓时刻。
    // 单主力路径一直有这两级,多主力路径漏掉的后果是整条锚变 null → 记 0 → 抬高盈亏比。
    const mainEvent = (campaign.actual_evolution ?? [])
      .filter(event => event.leg_role === 'main_open')
      .filter(event => event.journal_id === mainLeg.id
        || ownerForLeg(toMs(event.timestamp))?.id === mainLeg.id)
      .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp))
      .find(event => firstPositiveNumber(event.entry_price, event.price) != null) ?? null;
    // 与单主力路径同一条补救,详见 unblendedMainEntryPrice。
    const entryPrice = firstPositiveNumber(
      unblendedMainEntryPrice(campaign, mainLeg, mainRecord, legs, tradeRecords),
      mainRecord?.entryPrice,
      mainLeg.pre_entry_price,
      mainEvent?.entry_price,
      mainEvent?.price,
    );
    const exposureNotional = exposureByMain.get(mainLeg.id) ?? 0;
    const openedAtMs = firstPositiveNumber(
      mainRecord?.openTime,
      toMs(mainLeg.pre_simulated_time),
      mainEvent ? toMs(mainEvent.timestamp) : null,
      // campaign.opened_at 只对**最早**那笔主力有意义
      index === 0 ? toMs(campaign.opened_at) : null,
    );

    /**
     * 只看归属于这一笔主力的反向委托——否则主力1 会拿到主力2 的保护价。
     *
     * 这里必须**直接按挂出时刻算主力归属**，不能用委托列表那张归类表：
     * 那张表对 status === 'triggered' 的委托返回的是**对冲腿 id**，
     * 拿它跟主力 id 比永远不等 → **成交过的保护单会被整批丢掉**。
     * 而保护单成交，正是亏损真正发生的那种战役；单主力路径从不按 status 筛，
     * 于是同一批数据在删掉一笔主力前后会给出两个不同的风险边界
     * （13.3842% 的委托快照 vs 12.1385% 的成交价——后者已经把滑点算了进去，
     * 违反「历史战役的委托快照是唯一有效 ex-ante 边界」那条规则）。
     */
    const ownOrders = reverseHedgeOrders.filter(order =>
      order.side === expectedSide && ownerForOrder(order.createdAt)?.id === mainLeg.id,
    );
    // 角色腿（初始对冲 A/B）同样按时间归属到各自主力。
    const roleHedgePrices = INITIAL_HEDGE_ROLES.flatMap(role => {
      const roleLegs = legs
        .filter(leg => leg.leg_role === role)
        .filter(leg => ownerForLeg(firstPositiveNumber(
          findTradeRecord(leg, tradeRecords)?.openTime,
          toMs(leg.pre_simulated_time),
        ))?.id === mainLeg.id)
        .sort((a, b) => toMs(a.pre_simulated_time) - toMs(b.pre_simulated_time));
      const plannedPrice = firstPositiveNumber(
        roleLegs.find(leg => firstPositiveNumber(leg.pre_entry_price) != null)?.pre_entry_price,
      );
      if (plannedPrice != null) return [plannedPrice];
      const recordLeg = roleLegs.find(leg => findTradeRecord(leg, tradeRecords) != null) ?? null;
      const recordPrice = recordLeg
        ? firstPositiveNumber(findTradeRecord(recordLeg, tradeRecords)?.entryPrice)
        : null;
      if (recordPrice != null) return [recordPrice];

      // 第三级兜底：legs 已经不在、只剩事件流的老战役。单主力那条路径一直有这一级，
      // 多主力路径上一版把它漏掉了——漏掉的后果是这类战役直接锚不出风险边界、
      // 预期最大亏损记 0，而 0 会**抬高**盈亏比，是往危险方向错。
      const event = (campaign.actual_evolution ?? [])
        .filter(item => item.leg_role === role)
        .filter(item => ownerForLeg(toMs(item.timestamp))?.id === mainLeg.id)
        .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp))
        .find(item => firstPositiveNumber(item.entry_price, item.price) != null);
      const eventPrice = firstPositiveNumber(event?.entry_price, event?.price);
      return eventPrice == null ? [] : [eventPrice];
    });

    const initialReversePrices = resolveInitialReverseHedgePrices(
      campaign, ownOrders, openedAtMs, roleHedgePrices,
    );
    const hedgePrices = historical && initialReversePrices.length > 0
      ? [...initialReversePrices]
      : [...roleHedgePrices];
    if (hedgePrices.length < INITIAL_HEDGE_ROLES.length && !historical) {
      for (const price of initialReversePrices) {
        const duplicate = hedgePrices.some(existing =>
          Math.abs(existing - price) <= Math.max(EPSILON, Math.abs(existing) * 1e-6));
        if (!duplicate) hedgePrices.push(price);
        if (hedgePrices.length >= INITIAL_HEDGE_ROLES.length) break;
      }
    }

    /**
     * **方向性**距离，不是绝对值。
     *
     * 多单的亏损边界只可能在开仓价**下方**；挂在上方的空单是在封顶利润，
     * 它一分钱亏损都产生不了。Math.abs 会把那一段利润距离当成风险：
     * 实测一张挂在 0.1200 的开仓空单（开仓价 0.111594、在 ±5 分钟 cohort 之内、
     * 价格又与 0.104000 不同，所以能占到第二个名额）会让这一笔的预期最大亏损
     * 凭空涨 10.7%——用户因为挂了一张利润侧的单子而被记了更多风险。
     * 角色腿那一支更是完全绕开 cohort，一个写错方向的价会直接进 max。
     *
     * 落在利润侧的线**丢掉**，而不是钳成 0：钳成 0 会让 max 取到 0，
     * 等于宣称「这笔仓位没有风险」。全部线都在利润侧时整条锚判为 null
     * （记 0 会抬高盈亏比，是往危险方向错）。
     */
    const lossSideFractions = entryPrice != null
      ? hedgePrices
        .map(price => (campaign.direction === 'main_long'
          ? (entryPrice - price)
          : (price - entryPrice)) / entryPrice)
        .filter(fraction => fraction > 0)
      : [];
    const resolvable = entryPrice != null && exposureNotional > EPSILON && lossSideFractions.length > 0;
    const drawdownFraction = resolvable ? Math.max(...lossSideFractions) : null;
    anchors.push({
      mainLegId: mainLeg.id,
      exposureNotional,
      drawdownFraction,
      // 锚不出来就记 0,绝不借用别的腿的跌幅——那等于凭空发明一条从未挂过的止损。
      expectedMaxLoss: drawdownFraction == null ? 0 : drawdownFraction * exposureNotional,
    });
  }

  const anchoredExposureNotional = anchors
    .filter(a => a.drawdownFraction != null)
    .reduce((sum, a) => sum + a.exposureNotional, 0);
  const expectedMaxLoss = anchors.reduce((sum, a) => sum + a.expectedMaxLoss, 0);
  /**
   * 锚不出来的敞口。**用全额减去已锚的**，而不是把各腿的 exposureNotional 相加——
   * 一笔连敞口都取不到的主力，它的 exposureNotional 本身就是 0，
   * 按腿相加会让它连「未计价」这个身份都没有，界面上无声消失。
   */
  const fullExposure = computeInitialMainExposureNotional(campaign, legs, tradeRecords);
  const unanchoredExposureNotional = Math.max(0, fullExposure - anchoredExposureNotional);

  return {
    anchors,
    expectedMaxLoss,
    anchoredExposureNotional,
    unanchoredExposureNotional,
    fullExposureNotional: fullExposure,
  };
}

export function computeInitialExpectedMaxLoss(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  reverseHedgeOrders: CampaignReverseHedgeOrder[] = [],
): number {
  return resolveMainRiskAnchors(campaign, legs, tradeRecords, reverseHedgeOrders).expectedMaxLoss;
}

export interface CampaignInitialRiskFraction {
  /** Initial maximum expected loss L_i in USDT. */
  initialExpectedMaxLoss: number;
  /** Account equity snapshot A_i captured immediately before the main entry. */
  accountEquityAtMainOpen: number;
  /** Actual fraction of account equity at risk: x_i = L_i / A_i. */
  drawdownFraction: number;
}

export type CampaignInitialRiskSource = 'main_open_snapshot' | 'current_account_fallback';

export interface ResolvedCampaignInitialRiskFraction extends CampaignInitialRiskFraction {
  source: CampaignInitialRiskSource;
}

/**
 * Reconstruct the actual capital fraction risked by one campaign.
 *
 * The denominator must be the immutable account-equity snapshot attached to
 * the initial main leg. Current equity and later-leg snapshots are not valid
 * substitutes because they would introduce hindsight into historical results.
 */
export function computeCampaignInitialRiskFraction(
  initialExpectedMaxLoss: number,
  legs: TradeJournal[],
): CampaignInitialRiskFraction | null {
  if (!Number.isFinite(initialExpectedMaxLoss) || initialExpectedMaxLoss <= EPSILON) return null;
  /**
   * 取**最早**那笔主力的权益快照，不是金额最大那笔。
   * 「这场战役押上了本金的百分之几」问的是入场那一刻的本金；
   * 旧写法取金额最大那笔，在实盘这场里等于用了 8 小时后、
   * 已经把主力1 的 +3268 记进去之后的权益——那是事后视角。
   */
  const mainLeg = findEarliestMainLeg(legs) ?? findInitialMainLeg(legs);
  const accountEquityAtMainOpen = Number(mainLeg?.pre_account_equity_usdt);
  if (!Number.isFinite(accountEquityAtMainOpen) || accountEquityAtMainOpen <= EPSILON) return null;
  return {
    initialExpectedMaxLoss,
    accountEquityAtMainOpen,
    drawdownFraction: initialExpectedMaxLoss / accountEquityAtMainOpen,
  };
}

/**
 * Resolve one campaign's risk fraction without overwriting historical data.
 * A saved main-entry snapshot always wins. The live-account fallback exists
 * only for legacy rows that predate that snapshot field.
 */
export function resolveCampaignInitialRiskFraction(
  initialExpectedMaxLoss: number,
  legs: TradeJournal[],
  currentAccountEquityFallback: number | null = null,
): ResolvedCampaignInitialRiskFraction | null {
  const captured = computeCampaignInitialRiskFraction(initialExpectedMaxLoss, legs);
  if (captured) {
    return { ...captured, source: 'main_open_snapshot' };
  }

  const fallbackEquity = Number(currentAccountEquityFallback);
  if (
    !Number.isFinite(initialExpectedMaxLoss)
    || initialExpectedMaxLoss <= EPSILON
    || !Number.isFinite(fallbackEquity)
    || fallbackEquity <= EPSILON
  ) {
    return null;
  }

  return {
    initialExpectedMaxLoss,
    accountEquityAtMainOpen: fallbackEquity,
    drawdownFraction: initialExpectedMaxLoss / fallbackEquity,
    source: 'current_account_fallback',
  };
}

export function computeCampaignPnlReconciliation(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  exitPriceCorrections: LegExitPriceCorrections = {},
): CampaignPnlReconciliation {
  // 唯一真源：口径写死在 campaignRealizedPnl 里。baseline 与 corrected 都出自它，
  // 差别只在要不要把平仓价校正叠进去，因此 correctedPnl ≡ Σ(该函数的 byLeg)。
  const baseline = computeCampaignRealizedPnl(campaign, legs, tradeRecords);
  const corrected = computeCampaignRealizedPnl(campaign, legs, tradeRecords, exitPriceCorrections);
  const baselinePnl = baseline.total ?? 0;
  const officialCampaignPnl = Number.isFinite(campaign.final_realized_pnl)
    ? Number(campaign.final_realized_pnl)
    : null;
  const officialLegPnl = baseline.total;
  const recordLookup = buildTradeRecordLookup(tradeRecords);
  const settlement = settlementRecordsOf(tradeRecords);
  const correctedByRecordId = new Map<string, TradeRecordPnlCorrection>();

  for (const leg of legs) {
    const exitCorrection = exitPriceCorrections[leg.id];
    if (!exitCorrection || !leg.trade_record_id) continue;
    const record = recordLookup.get(leg.trade_record_id) ?? null;
    if (!record || correctedByRecordId.has(record.id)) continue;
    const pnlCorrection = buildTradeRecordPnlCorrection(record, exitCorrection);
    if (pnlCorrection) correctedByRecordId.set(record.id, pnlCorrection);
  }

  const correctedRecords = Array.from(correctedByRecordId.values());
  // 校正总额由两次求和相减得出，而不是把 correctedRecords 的 delta 再加一遍——
  // 后者会与模块内部「一条腿只叠一次校正」的规则脱钩，重新制造两套账。
  const priceCorrectionDelta = (corrected.total ?? 0) - (baseline.total ?? 0);
  const correctedLegPnl = corrected.total;

  return {
    officialCampaignPnl,
    officialLegPnl,
    correctedLegPnl,
    baselinePnl,
    correctedPnl: corrected.total ?? 0,
    priceCorrectionDelta,
    officialVsLegDelta: officialCampaignPnl == null || officialLegPnl == null
      ? null
      : officialCampaignPnl - officialLegPnl,
    correctedRecords,
  };
}

export function computeProfitCaptureRatio(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  reverseHedgeOrders: CampaignReverseHedgeOrder[] = [],
  exitPriceCorrections: LegExitPriceCorrections = {},
): number {
  const initialExpectedMaxLoss = computeInitialExpectedMaxLoss(
    campaign,
    legs,
    tradeRecords,
    reverseHedgeOrders,
  );
  if (initialExpectedMaxLoss <= EPSILON) return 0;
  const reconciliation = computeCampaignPnlReconciliation(
    campaign,
    legs,
    tradeRecords,
    exitPriceCorrections,
  );
  return (reconciliation.correctedPnl / initialExpectedMaxLoss) * 100;
}

export function formatCampaignPayoffRatio(value: number, percentDigits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(percentDigits)}%（${(value / 100).toFixed(2)}）`;
}

function eventTradeRecord(
  event: CampaignEvent,
  tradeRecords: TradeRecord[],
  journalRecordIds: Map<string, string>,
): TradeRecord | null {
  const recordId = event.trade_record_id ?? (event.journal_id ? journalRecordIds.get(event.journal_id) ?? null : null);
  if (!recordId) return null;
  return buildTradeRecordLookup(tradeRecords).get(recordId) ?? null;
}

function isCanonicalSyntheticEvent(event: CampaignEvent, leg: TradeJournal | null): boolean {
  if (!leg?.leg_role) return false;
  if (leg.leg_role === 'mirror_tp') return event.event_type === 'mirror_tp_triggered';
  if (HEDGE_ROLES.includes(leg.leg_role)) return event.event_type === 'hedge_triggered';
  if (MAIN_ROLES.includes(leg.leg_role)) {
    return event.event_type === 'main_partial_closed' || event.event_type === 'main_fully_closed';
  }
  return false;
}

function normalizeEventSnapshotFromRecord(event: CampaignEvent, record: TradeRecord): CampaignEvent {
  const openIso = toIso(record.openTime);
  const closeIso = toIso(record.closeTime);
  const next: CampaignEvent = {
    ...event,
    trade_record_id: record.id,
    direction: record.side === 'SHORT' ? 'short' : 'long',
    leverage: record.leverage,
    open_time: openIso,
    close_time: closeIso,
    entry_price: record.entryPrice,
    exit_price: record.exitPrice,
    realized_pnl: record.pnl,
  };

  if (
    event.event_type === 'main_partial_closed' ||
    event.event_type === 'main_fully_closed' ||
    event.event_type === 'mirror_tp_triggered'
  ) {
    next.timestamp = closeIso;
    next.price = record.exitPrice;
    next.size_usdt = tradeRecordNotionalUsd(record, record.exitPrice);
  } else if (event.event_type === 'hedge_triggered') {
    next.timestamp = openIso;
    next.price = record.entryPrice;
    next.size_usdt = tradeRecordNotionalUsd(record, record.entryPrice);
  }

  return next;
}

export function buildCampaignEventStream(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
): CampaignEvent[] {
  const legByJournalId = new Map(legs.map(leg => [leg.id, leg]));
  const legByRecordId = new Map(
    legs
      .filter(leg => Boolean(leg.trade_record_id))
      .map(leg => [leg.trade_record_id as string, leg]),
  );
  const journalRecordIds = new Map(
    legs
      .filter(leg => Boolean(leg.trade_record_id))
      .map(leg => [leg.id, leg.trade_record_id as string]),
  );
  const events: CampaignEvent[] = [...(campaign.actual_evolution ?? [])].flatMap(event => {
    const record = eventTradeRecord(event, tradeRecords, journalRecordIds);
    if (!record) return [{ ...event }];
    const leg = (event.journal_id ? legByJournalId.get(event.journal_id) ?? null : null)
      ?? legByRecordId.get(record.id)
      ?? null;
    const normalized = normalizeEventSnapshotFromRecord(event, record);
    return isCanonicalSyntheticEvent(normalized, leg) ? [] : [normalized];
  });

  for (const leg of legs) {
    const tradeRecord = findTradeRecord(leg, tradeRecords);
    if (!tradeRecord) continue;
    if (leg.leg_role === 'mirror_tp') {
      events.push({
        id: `synthetic-${leg.id}-mirror-tp`,
        timestamp: new Date(tradeRecord.closeTime).toISOString(),
        event_type: 'mirror_tp_triggered',
        leg_role: leg.leg_role,
        journal_id: leg.id,
        trade_record_id: tradeRecord.id,
        pending_order_id: null,
        price: tradeRecord.exitPrice,
        size_usdt: tradeRecordNotionalUsd(tradeRecord, tradeRecord.exitPrice),
        notes: null,
        recorded_at: new Date(tradeRecord.closeTime).toISOString(),
      });
      continue;
    }

    if (leg.leg_role && HEDGE_ROLES.includes(leg.leg_role)) {
      events.push({
        id: `synthetic-${leg.id}-hedge-triggered`,
        timestamp: new Date(tradeRecord.openTime).toISOString(),
        event_type: 'hedge_triggered',
        leg_role: leg.leg_role,
        journal_id: leg.id,
        trade_record_id: tradeRecord.id,
        pending_order_id: null,
        price: tradeRecord.entryPrice,
        size_usdt: tradeRecordNotionalUsd(tradeRecord, tradeRecord.entryPrice),
        notes: null,
        recorded_at: new Date(tradeRecord.openTime).toISOString(),
      });
      continue;
    }

    if (leg.leg_role && MAIN_ROLES.includes(leg.leg_role)) {
      const mainSize = leg.pre_position_size ?? tradeRecordNotionalUsd(tradeRecord, tradeRecord.entryPrice);
      const closedNotional = tradeRecordNotionalUsd(tradeRecord, tradeRecord.exitPrice);
      const isPartial = mainSize > EPSILON && closedNotional < mainSize * 0.95;
      events.push({
        id: `synthetic-${leg.id}-${isPartial ? 'main-partial' : 'main-full'}`,
        timestamp: new Date(tradeRecord.closeTime).toISOString(),
        event_type: isPartial ? 'main_partial_closed' : 'main_fully_closed',
        leg_role: leg.leg_role,
        journal_id: leg.id,
        trade_record_id: tradeRecord.id,
        pending_order_id: null,
        price: tradeRecord.exitPrice,
        size_usdt: closedNotional,
        notes: null,
        recorded_at: new Date(tradeRecord.closeTime).toISOString(),
      });
    }
  }

  if (campaign.closed_at && !events.some(event => event.event_type === 'campaign_closed')) {
    events.push({
      id: `synthetic-${campaign.id}-closed`,
      timestamp: campaign.closed_at,
      event_type: 'campaign_closed',
      leg_role: null,
      journal_id: null,
      trade_record_id: null,
      pending_order_id: null,
      price: null,
      size_usdt: null,
      notes: campaign.notes ?? null,
      recorded_at: campaign.closed_at,
    });
  }

  return events.sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
}

function campaignEndMs(campaign: TradeCampaign, tradeRecords: TradeRecord[]) {
  const latestRecord = tradeRecords.reduce((max, record) => Math.max(max, record.closeTime, record.openTime), 0);
  return campaign.closed_at ? toMs(campaign.closed_at) : Math.max(latestRecord, toMs(campaign.opened_at));
}

export function deriveCampaignStates(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
): StateSegment[] {
  const events = buildCampaignEventStream(campaign, legs, tradeRecords);
  const startMs = toMs(campaign.opened_at);
  const endMs = campaignEndMs(campaign, tradeRecords);

  const pushSegment = (
    out: StateSegment[],
    state: StateSegment['state'],
    state_label: string,
    start: number,
    end: number,
    triggering_event: CampaignEvent | null,
  ) => {
    if (end <= start) return;
    out.push({
      state,
      state_label,
      start_time: toIso(start),
      end_time: toIso(end),
      triggering_event,
    });
  };

  const exitEvent = events.find(event => event.event_type === 'hedge_triggered' || event.event_type === 'main_fully_closed') ?? null;
  const closeEvent = events.find(event => event.event_type === 'campaign_closed') ?? null;
  const exitStartMs = exitEvent ? toMs(exitEvent.timestamp) : (closeEvent ? toMs(closeEvent.timestamp) : endMs);

  if (!usesDualHedgeSop(campaign.strategy_template)) {
    const out: StateSegment[] = [];
    pushSegment(out, 'state_0_setup', '完整结构', startMs, exitStartMs, null);
    pushSegment(out, 'state_3_exit', '已退场', exitStartMs, closeEvent ? toMs(closeEvent.timestamp) : endMs, exitEvent);
    return out;
  }

  const mirrorTpTriggered = events.find(event => event.event_type === 'mirror_tp_triggered') ?? null;
  const hedgeRollingPlaced = events.find(event => event.event_type === 'hedge_placed' && event.leg_role === 'hedge_rolling') ?? null;
  const mirrorMs = mirrorTpTriggered ? toMs(mirrorTpTriggered.timestamp) : exitStartMs;
  const rollingMs = hedgeRollingPlaced ? toMs(hedgeRollingPlaced.timestamp) : exitStartMs;
  const closeMs = closeEvent ? toMs(closeEvent.timestamp) : endMs;

  const out: StateSegment[] = [];
  pushSegment(out, 'state_0_setup', '完整结构', startMs, mirrorMs, mirrorTpTriggered);
  if (mirrorTpTriggered) {
    pushSegment(out, 'state_1_lockin', '已锁定不亏', mirrorMs, rollingMs, hedgeRollingPlaced ?? exitEvent);
  }
  if (hedgeRollingPlaced) {
    pushSegment(out, 'state_2_rolling', '滚动跟随', rollingMs, exitStartMs, exitEvent);
  }
  pushSegment(out, 'state_3_exit', '已退场', exitStartMs, closeMs, exitEvent ?? closeEvent);
  return out;
}

function getKlinesInRange(klines: KlineData[], fromMs: number, toMs: number) {
  return klines.filter(kline => kline.time >= fromMs && kline.time <= toMs);
}

interface CampaignActiveLeg {
  id: string;
  journalId: string;
  role: LegRole | null;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  startMs: number;
  endMs: number;
  realizedPnl: number | null;
  settlementMode: SettlementMode;
  contractSizeUsd: number | null;
  contracts: number | null;
}

function activeLegUnrealizedPnl(leg: CampaignActiveLeg, price: number): number {
  if (!(price > 0) || !(leg.entryPrice > 0)) return 0;
  if (leg.settlementMode === 'coin') {
    const contracts = Math.max(0, Math.round(leg.contracts ?? leg.quantity));
    const contractSizeUsd = leg.contractSizeUsd ?? 10;
    if (contracts === 0) return 0;
    const coinPnl = leg.side === 'LONG'
      ? contracts * contractSizeUsd * (1 / leg.entryPrice - 1 / price)
      : contracts * contractSizeUsd * (1 / price - 1 / leg.entryPrice);
    return coinPnl * price;
  }
  return leg.side === 'LONG'
    ? (price - leg.entryPrice) * leg.quantity
    : (leg.entryPrice - price) * leg.quantity;
}

function campaignPnlAt(
  activeLegs: CampaignActiveLeg[],
  timestamp: number,
  price: number,
): number {
  return activeLegs.reduce((total, leg) => {
    if (timestamp >= leg.endMs) {
      return total + (leg.realizedPnl ?? 0);
    }
    if (timestamp < leg.startMs) return total;
    return total + activeLegUnrealizedPnl(leg, price);
  }, 0);
}

function inferredKlineIntervalMs(klines: KlineData[]): number {
  const sortedTimes = Array.from(new Set(klines.map(kline => kline.time))).sort((a, b) => a - b);
  const intervals = sortedTimes
    .slice(1)
    .map((time, index) => time - sortedTimes[index])
    .filter(interval => interval > 0)
    .sort((a, b) => a - b);
  return intervals[Math.floor(intervals.length / 2)] ?? 60_000;
}

function computeCampaignPnlExtremes(
  activeLegs: CampaignActiveLeg[],
  klines: KlineData[],
  startMs: number,
  endMs: number,
): { maxProfit: number; maxDrawdown: number } {
  const sortedKlines = [...klines]
    .filter(kline => Number.isFinite(kline.time))
    .sort((a, b) => a.time - b.time);
  const defaultIntervalMs = inferredKlineIntervalMs(sortedKlines);
  let maxProfit = 0;
  let maxDrawdown = 0;

  sortedKlines.forEach((kline, index) => {
    const nextTime = sortedKlines[index + 1]?.time;
    const barEndMs = nextTime && nextTime > kline.time
      ? nextTime
      : kline.time + defaultIntervalMs;
    if (barEndMs <= startMs || kline.time > endMs) return;

    // Rebuild every position state that existed during this candle. This keeps
    // partial closes and banked mirror profit on the same campaign timeline.
    const stateTimes = new Set<number>([
      Math.max(startMs, kline.time),
      Math.min(endMs, barEndMs - 1),
    ]);
    for (const leg of activeLegs) {
      if (leg.startMs >= kline.time && leg.startMs < barEndMs) {
        stateTimes.add(Math.max(startMs, leg.startMs));
      }
      if (leg.endMs > kline.time && leg.endMs <= barEndMs) {
        stateTimes.add(Math.max(startMs, leg.endMs - 1));
        stateTimes.add(Math.min(endMs, leg.endMs));
      }
    }

    const prices = [kline.low, kline.high]
      .map(Number)
      .filter(price => Number.isFinite(price) && price > 0);
    for (const timestamp of stateTimes) {
      if (timestamp < startMs || timestamp > endMs) continue;
      for (const price of prices) {
        const total = campaignPnlAt(activeLegs, timestamp, price);
        maxProfit = Math.max(maxProfit, total);
        maxDrawdown = Math.min(maxDrawdown, total);
      }
    }
  });

  return { maxProfit, maxDrawdown };
}

function buildActiveLegs(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
): CampaignActiveLeg[] {
  const endMs = campaignEndMs(campaign, tradeRecords);
  const syntheticEvents = buildCampaignEventStream(campaign, legs, tradeRecords);

  const candidates = legs.flatMap(leg => {
    const record = findTradeRecord(leg, tradeRecords);

    if (record) {
      return [{
        id: record.id,
        journalId: leg.id,
        role: leg.leg_role,
        side: record.side,
        quantity: record.quantity,
        entryPrice: record.entryPrice,
        startMs: record.openTime,
        endMs: record.closeTime || endMs,
        realizedPnl: Number.isFinite(record.pnl) ? Number(record.pnl) : null,
        settlementMode: record.settlementMode ?? 'usdt',
        contractSizeUsd: Number.isFinite(record.contractSizeUsd) ? Number(record.contractSizeUsd) : null,
        contracts: Number.isFinite(record.contracts) ? Number(record.contracts) : null,
      }];
    }

    if (
      leg.leg_role
      && (MAIN_ROLES.includes(leg.leg_role) || leg.leg_role === 'mirror_tp')
      && leg.pre_entry_price != null
      && leg.pre_position_size != null
    ) {
      const closeMs = leg.post_simulated_close_time ? toMs(leg.post_simulated_close_time) : endMs;
      const settlementMode = leg.pre_settlement_mode ?? 'usdt';
      const contracts = Number.isFinite(leg.pre_contracts) ? Number(leg.pre_contracts) : null;
      return [{
        id: `open-${leg.id}`,
        journalId: leg.id,
        role: leg.leg_role,
        side: leg.direction === 'short' ? 'SHORT' : 'LONG',
        quantity: settlementMode === 'coin' && contracts != null
          ? contracts
          : leg.pre_position_size / leg.pre_entry_price,
        entryPrice: leg.pre_entry_price,
        startMs: toMs(leg.pre_simulated_time),
        endMs: Number.isFinite(closeMs) ? closeMs : endMs,
        realizedPnl: Number.isFinite(leg.post_realized_pnl) ? Number(leg.post_realized_pnl) : null,
        settlementMode,
        contractSizeUsd: Number.isFinite(leg.pre_contract_size_usd) ? Number(leg.pre_contract_size_usd) : null,
        contracts,
      }];
    }

    if (leg.leg_role && HEDGE_ROLES.includes(leg.leg_role) && leg.pre_entry_price != null && leg.pre_position_size != null) {
      const triggerEvent = syntheticEvents.find(event =>
        event.journal_id === leg.id && event.event_type === 'hedge_triggered',
      );
      if (!triggerEvent) return [];
      const side = campaign.direction === 'main_long' ? 'SHORT' : 'LONG';
      const cancelEvent = syntheticEvents.find(event =>
        event.journal_id === leg.id
        && event.event_type === 'hedge_cancelled'
        && toMs(event.timestamp) >= toMs(triggerEvent.timestamp),
      );
      const closeMs = leg.post_simulated_close_time
        ? toMs(leg.post_simulated_close_time)
        : cancelEvent
          ? toMs(cancelEvent.timestamp)
          : endMs;
      const settlementMode = leg.pre_settlement_mode ?? 'usdt';
      const contracts = Number.isFinite(leg.pre_contracts) ? Number(leg.pre_contracts) : null;
      return [{
        id: `synthetic-hedge-${leg.id}`,
        journalId: leg.id,
        role: leg.leg_role,
        side,
        quantity: settlementMode === 'coin' && contracts != null
          ? contracts
          : leg.pre_position_size / leg.pre_entry_price,
        entryPrice: leg.pre_entry_price,
        startMs: toMs(triggerEvent.timestamp),
        endMs: Number.isFinite(closeMs) ? closeMs : endMs,
        realizedPnl: Number.isFinite(leg.post_realized_pnl) ? Number(leg.post_realized_pnl) : null,
        settlementMode,
        contractSizeUsd: Number.isFinite(leg.pre_contract_size_usd) ? Number(leg.pre_contract_size_usd) : null,
        contracts,
      }];
    }

    return [];
  });

  const byIdentity = new Map(candidates.map(leg => [leg.id, leg]));
  const representedJournalIds = new Set(candidates.map(leg => leg.journalId));
  const representedRecordIds = new Set(candidates.map(leg => leg.id));

  // Some historical campaigns retain complete leg snapshots only inside
  // actual_evolution. Reconstruct those positions so old campaigns use the
  // same peak-profit formula as newly recorded campaigns.
  for (const event of syntheticEvents) {
    if (event.event_type !== 'historical_leg_attached' || event.leg_role == null) continue;
    if (event.journal_id && representedJournalIds.has(event.journal_id)) continue;
    if (event.trade_record_id && representedRecordIds.has(event.trade_record_id)) continue;
    const entryPrice = firstPositiveNumber(event.entry_price, event.price);
    const notional = firstPositiveNumber(event.size_usdt);
    const start = event.open_time ? toMs(event.open_time) : toMs(event.timestamp);
    const close = event.close_time ? toMs(event.close_time) : endMs;
    if (entryPrice == null || notional == null || !Number.isFinite(start)) continue;
    const identity = event.trade_record_id ?? event.journal_id ?? event.id;
    const fallbackSide = HEDGE_ROLES.includes(event.leg_role) || event.leg_role === 'reentry_hedge'
      ? (campaign.direction === 'main_long' ? 'SHORT' : 'LONG')
      : (campaign.direction === 'main_long' ? 'LONG' : 'SHORT');
    byIdentity.set(identity, {
      id: identity,
      journalId: event.journal_id ?? event.id,
      role: event.leg_role,
      side: event.direction === 'short'
        ? 'SHORT'
        : event.direction === 'long'
          ? 'LONG'
          : fallbackSide,
      quantity: notional / entryPrice,
      entryPrice,
      startMs: start,
      endMs: Number.isFinite(close) ? close : endMs,
      realizedPnl: Number.isFinite(event.realized_pnl) ? Number(event.realized_pnl) : null,
      settlementMode: 'usdt',
      contractSizeUsd: null,
      contracts: null,
    });
  }

  return Array.from(byIdentity.values());
}

function verdictByThresholds(value: number, thresholds: number[], labels: string[]) {
  if (value < thresholds[0]) return labels[0];
  if (value < thresholds[1]) return labels[1];
  if (value < thresholds[2]) return labels[2];
  return labels[3];
}

export function computeDecisionAccuracy(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  klines: KlineData[],
  reverseHedgeOrders: CampaignReverseHedgeOrder[] = [],
  exitPriceCorrections: LegExitPriceCorrections = {},
): DecisionAccuracyResult {
  const isLongCampaign = campaign.direction === 'main_long';
  const endMs = campaignEndMs(campaign, tradeRecords);
  const hedge_precision: HedgePrecision[] = [];

  for (const leg of legs) {
    if (!leg.leg_role || !HEDGE_ROLES.includes(leg.leg_role) || leg.pre_entry_price == null) continue;
    const record = findTradeRecord(leg, tradeRecords);
    if (record) {
      const hedgeRole = leg.leg_role as HedgePrecision['role'];
      const range = getKlinesInRange(klines, record.openTime, endMs);
      const extreme = range.length === 0
        ? leg.pre_entry_price
        : (isLongCampaign
          ? Math.min(...range.map(k => k.low))
          : Math.max(...range.map(k => k.high)));
      const excess = isLongCampaign
        ? ((leg.pre_entry_price - extreme) / leg.pre_entry_price) * 100
        : ((extreme - leg.pre_entry_price) / leg.pre_entry_price) * 100;

      hedge_precision.push({
        leg_id: leg.id,
        role: hedgeRole,
        trigger_price: leg.pre_entry_price,
        was_triggered: true,
        market_extreme_after_trigger: extreme,
        excess_depth_pct: Math.max(0, excess),
        closest_approach_pct: null,
        verdict: verdictByThresholds(
          Math.max(0, excess),
          [0.5, 3, 8],
          ['止跌精准', '小幅深探', '过早设防', '深度套牢'],
        ),
      });
    } else {
      const hedgeRole = leg.leg_role as HedgePrecision['role'];
      const cancelEvent = buildCampaignEventStream(campaign, legs, tradeRecords).find(event =>
        event.leg_role === leg.leg_role && event.event_type === 'hedge_cancelled' && event.journal_id === leg.id,
      );
      const range = getKlinesInRange(klines, toMs(leg.pre_simulated_time), cancelEvent ? toMs(cancelEvent.timestamp) : endMs);
      const extreme = range.length === 0
        ? leg.pre_entry_price
        : (isLongCampaign
          ? Math.min(...range.map(k => k.low))
          : Math.max(...range.map(k => k.high)));
      const closest = isLongCampaign
        ? ((leg.pre_entry_price - extreme) / leg.pre_entry_price) * 100
        : ((extreme - leg.pre_entry_price) / leg.pre_entry_price) * 100;
      hedge_precision.push({
        leg_id: leg.id,
        role: hedgeRole,
        trigger_price: leg.pre_entry_price,
        was_triggered: false,
        market_extreme_after_trigger: null,
        excess_depth_pct: null,
        closest_approach_pct: Math.max(0, closest),
        verdict: Math.max(0, closest) < 1 ? '险些触发' : Math.max(0, closest) <= 5 ? '保险充裕' : '设置过远',
      });
    }
  }

  const mirrorLeg = legs.find(leg => leg.leg_role === 'mirror_tp' && leg.pre_entry_price != null) ?? null;
  let mirror_tp_capture: MirrorTpCapture | null = null;
  if (mirrorLeg && mirrorLeg.pre_entry_price != null) {
    const record = findTradeRecord(mirrorLeg, tradeRecords);
    if (record) {
      const range = getKlinesInRange(klines, record.closeTime, endMs);
      const extreme = range.length === 0
        ? mirrorLeg.pre_entry_price
        : (isLongCampaign
          ? Math.max(...range.map(k => k.high))
          : Math.min(...range.map(k => k.low)));
      const foregone = isLongCampaign
        ? ((extreme - mirrorLeg.pre_entry_price) / mirrorLeg.pre_entry_price) * 100
        : ((mirrorLeg.pre_entry_price - extreme) / mirrorLeg.pre_entry_price) * 100;
      mirror_tp_capture = {
        tp_price: mirrorLeg.pre_entry_price,
        was_triggered: true,
        market_extreme_after_trigger: extreme,
        foregone_profit_pct: Math.max(0, foregone),
        closest_approach_pct: null,
        verdict: Math.max(0, foregone) < 2 ? '精准锁利' : Math.max(0, foregone) <= 10 ? '部分让利' : '过早止盈',
      };
    } else {
      const range = getKlinesInRange(klines, toMs(mirrorLeg.pre_simulated_time), endMs);
      const extreme = range.length === 0
        ? mirrorLeg.pre_entry_price
        : (isLongCampaign
          ? Math.max(...range.map(k => k.high))
          : Math.min(...range.map(k => k.low)));
      const closest = isLongCampaign
        ? ((extreme - mirrorLeg.pre_entry_price) / mirrorLeg.pre_entry_price) * 100
        : ((mirrorLeg.pre_entry_price - extreme) / mirrorLeg.pre_entry_price) * 100;
      mirror_tp_capture = {
        tp_price: mirrorLeg.pre_entry_price,
        was_triggered: false,
        market_extreme_after_trigger: null,
        foregone_profit_pct: null,
        closest_approach_pct: closest,
        verdict: '未触发',
      };
    }
  }

  const activeLegs = buildActiveLegs(campaign, legs, tradeRecords);
  const startMs = toMs(campaign.opened_at);
  const extremes = computeCampaignPnlExtremes(activeLegs, klines, startMs, endMs);
  let { maxProfit, maxDrawdown } = extremes;
  const finalRealizedPnl = computeCampaignPnlReconciliation(
    campaign,
    legs,
    tradeRecords,
    exitPriceCorrections,
  ).correctedPnl;
  maxProfit = Math.max(maxProfit, finalRealizedPnl);
  maxDrawdown = Math.min(maxDrawdown, finalRealizedPnl);

  const initial_expected_max_loss = computeInitialExpectedMaxLoss(
    campaign,
    legs,
    tradeRecords,
    reverseHedgeOrders,
  );
  const profit_capture_ratio = computeProfitCaptureRatio(
    campaign,
    legs,
    tradeRecords,
    reverseHedgeOrders,
    exitPriceCorrections,
  );

  return {
    hedge_precision,
    mirror_tp_capture,
    initial_expected_max_loss,
    profit_capture_ratio,
    campaign_max_drawdown_real: Math.abs(maxDrawdown),
    campaign_max_profit_real: maxProfit,
  };
}

function gradeForScore(score: number): SopDeviationResult['grade'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function toleranceEqual(value: number | null, target: number | null, tolerancePct: number) {
  if (value == null || target == null || Math.abs(target) < EPSILON) return false;
  return Math.abs(value - target) / target <= tolerancePct;
}

function deductionCategoryForLeg(role: LegRole | null): Deduction['category'] {
  if (role === 'mirror_tp') return 'lockin';
  if (role === 'hedge_rolling') return 'rolling';
  if (role === 'reentry_main' || role === 'reentry_hedge') return 'exit';
  return 'setup';
}

export function computeSopDeviation(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
): SopDeviationResult {
  if (campaign.strategy_template === 'custom') {
    return {
      is_applicable: false,
      score: null,
      grade: null,
      deductions: [],
      total_deductions: 0,
      retroactive_leg_count: 0,
    };
  }

  const events = buildCampaignEventStream(campaign, legs, tradeRecords);
  const deductions: Deduction[] = [];
  const addDeduction = (category: Deduction['category'], points: number, reason: string, related_event_ids: string[]) => {
    deductions.push({ category, points, reason, related_event_ids });
  };
  const retroactiveLegs = legs.filter(leg => leg.source === 'retroactive_from_record');
  const retroactiveLegIds = new Set(retroactiveLegs.map(leg => leg.id));
  const liveLegs = legs.filter(leg => leg.source !== 'retroactive_from_record');

  for (const retroLeg of retroactiveLegs) {
    addDeduction(
      deductionCategoryForLeg(retroLeg.leg_role),
      0,
      `${retroLeg.leg_role ?? 'unknown'} 为历史回填，本项扣分跳过`,
      [retroLeg.id],
    );
  }

  const mainLeg = liveLegs.find(leg => leg.leg_role === 'main_open') ?? liveLegs.find(leg => leg.leg_role === 'reentry_main') ?? null;
  const mainSize = mainLeg ? legSize(mainLeg) : null;
  const mainLeverage = mainLeg?.leverage ?? campaign.initial_leverage ?? null;
  const requiredSetupRoles: LegRole[] = campaign.strategy_template === 'main_only'
    ? ['main_open']
    : ['main_open', 'hedge_initial_a', 'hedge_initial_b', 'mirror_tp'];
  for (const role of requiredSetupRoles) {
    if (!legs.some(leg => leg.leg_role === role)) {
      const points = role === 'main_open' ? 30 : 10;
      addDeduction('setup', points, `缺少 ${role === 'main_open' ? '主力开仓' : role === 'mirror_tp' ? 'mirror_tp' : LEGEND[role]}`, []);
    }
  }

  if (usesDualHedgeSop(campaign.strategy_template) && mainSize != null) {
    for (const role of ['hedge_initial_a', 'hedge_initial_b'] as const) {
      const leg = liveLegs.find(item => item.leg_role === role) ?? null;
      if (leg && !toleranceEqual(legSize(leg), mainSize * (INITIAL_HEDGE_SIZE_PCT / 100), 0.05)) {
        addDeduction('setup', 3, `${LEGEND[role]}仓位大小未对齐主仓 ${INITIAL_HEDGE_SIZE_PCT}%`, [leg.id]);
      }
    }
    const mirrorLeg = liveLegs.find(item => item.leg_role === 'mirror_tp') ?? null;
    if (mirrorLeg && !toleranceEqual(legSize(mirrorLeg), mainSize * (MIRROR_TP_REDUCTION_PCT / 100), 0.05)) {
      addDeduction('setup', 3, `mirror_tp 仓位大小未对齐主仓 ${MIRROR_TP_REDUCTION_PCT}%`, [mirrorLeg.id]);
    }
  }

  const setupLegs = liveLegs.filter(leg =>
    leg.leg_role === 'main_open' ||
    leg.leg_role === 'hedge_initial_a' ||
    leg.leg_role === 'hedge_initial_b' ||
    leg.leg_role === 'mirror_tp',
  );
  if (setupLegs.length > 1) {
    const times = setupLegs.map(leg => toMs(leg.pre_simulated_time)).sort((a, b) => a - b);
    if (times[times.length - 1] - times[0] > 10 * 60_000) {
      addDeduction('setup', 5, '整套 setup 用时超过 10 分钟', setupLegs.map(leg => leg.id));
    }
  }

  const mirrorTriggered = events.find(event => event.event_type === 'mirror_tp_triggered' && (!event.journal_id || !retroactiveLegIds.has(event.journal_id))) ?? null;
  if (usesDualHedgeSop(campaign.strategy_template) && mirrorTriggered) {
    const tpMs = toMs(mirrorTriggered.timestamp);
    const cancelWithinFive = events.filter(event =>
      event.event_type === 'hedge_cancelled' &&
      toMs(event.timestamp) >= tpMs &&
      toMs(event.timestamp) <= tpMs + 5 * 60_000,
    );
    if (cancelWithinFive.length === 0) {
      addDeduction('lockin', 10, 'mirror_tp 触发后 5 分钟内未取消任一 hedge', [mirrorTriggered.id]);
    }
    if (cancelWithinFive.length >= 2) {
      addDeduction('lockin', 15, 'mirror_tp 触发后取消了 2 个 hedge', cancelWithinFive.map(event => event.id));
    }
    const mirrorLeg = liveLegs.find(leg => leg.leg_role === 'mirror_tp') ?? null;
    if (
      mirrorLeg &&
      mainSize != null &&
      !toleranceEqual(legSize(mirrorLeg), mainSize * (MIRROR_TP_REDUCTION_PCT / 100), 0.05)
    ) {
      addDeduction('lockin', 5, `主力部分平仓比例不等于 ${MIRROR_TP_REDUCTION_PCT}%`, [mirrorLeg.id]);
    }
  }

  if (usesDualHedgeSop(campaign.strategy_template)) {
    const rollingLegs = liveLegs.filter(leg => leg.leg_role === 'hedge_rolling').sort((a, b) => toMs(a.pre_simulated_time) - toMs(b.pre_simulated_time));
    const orderedHedges = liveLegs
      .filter(leg => leg.leg_role && [...HEDGE_ROLES, 'reentry_hedge'].includes(leg.leg_role))
      .sort((a, b) => toMs(a.pre_simulated_time) - toMs(b.pre_simulated_time));
    for (const rollingLeg of rollingLegs) {
      const rollingPrice = rollingLeg.pre_entry_price;
      const previousHedge = orderedHedges
        .filter(leg => leg.id !== rollingLeg.id && toMs(leg.pre_simulated_time) < toMs(rollingLeg.pre_simulated_time))
        .slice(-1)[0];
      if (rollingPrice != null && previousHedge?.pre_entry_price != null) {
        const wrongDirection = campaign.direction === 'main_long'
          ? rollingPrice <= previousHedge.pre_entry_price
          : rollingPrice >= previousHedge.pre_entry_price;
        if (wrongDirection) {
          addDeduction('rolling', 5, '新 hedge 价格相对旧 hedge 发生反向滚动', [rollingLeg.id, previousHedge.id]);
        }
      }
      const cancelEvent = events.find(event =>
        event.event_type === 'hedge_cancelled' &&
        toMs(event.timestamp) < toMs(rollingLeg.pre_simulated_time),
      );
      if (cancelEvent) {
        addDeduction('rolling', 3, '旧 hedge 取消时间早于新 hedge 挂出时间，存在敞口空窗', [cancelEvent.id, rollingLeg.id]);
      }
      if (mainSize != null && !toleranceEqual(legSize(rollingLeg), mainSize, 0.05)) {
        addDeduction('rolling', 3, '新 hedge 仓位大小不等于当前主仓', [rollingLeg.id]);
      }
    }
  }

  const exitTrigger = events.find(event =>
    (event.event_type === 'hedge_triggered' || event.event_type === 'main_fully_closed') &&
    (!event.journal_id || !retroactiveLegIds.has(event.journal_id)),
  ) ?? null;
  if (exitTrigger) {
    const triggerMs = toMs(exitTrigger.timestamp);
    const nextDecision = events.find(event =>
      toMs(event.timestamp) > triggerMs &&
      toMs(event.timestamp) <= triggerMs + 30 * 60_000 &&
      (
        event.event_type === 'main_fully_closed' ||
        event.event_type === 'hedge_cancelled' ||
        event.event_type === 'hedge_placed' ||
        event.event_type === 'campaign_closed'
      ),
    );
    if (!nextDecision) {
      addDeduction('exit', 10, '触发 exit 事件后 30 分钟内未做出处置决策', [exitTrigger.id]);
    }
  }

  const observedEndMs = Math.max(
    toMs(campaign.opened_at),
    ...legs.map(leg => toMs(leg.pre_simulated_time)),
    ...tradeRecords.flatMap(record => [record.openTime, record.closeTime]),
    ...events.map(event => toMs(event.timestamp)),
  );
  if (campaign.status === 'active' && (observedEndMs - toMs(campaign.opened_at)) > 7 * 24 * 60 * 60_000) {
    addDeduction('exit', 10, '战役 active 状态超过 7 天未结束', []);
  }

  if (campaign.peak_drawdown != null && mainSize != null && mainLeverage != null && mainLeverage > 0) {
    const initialMargin = mainSize / mainLeverage;
    if (initialMargin > EPSILON && (campaign.peak_drawdown / initialMargin) > 0.1) {
      addDeduction('exit', 5, '最终账户层级的 max_drawdown 占初始保证金超过 10%', []);
    }
  }

  const maxScore = campaign.strategy_template === 'main_only' ? 50 : 100;
  const rawScore = Math.max(0, maxScore - deductions.reduce((sum, deduction) => sum + deduction.points, 0));
  const normalizedScore = campaign.strategy_template === 'main_only'
    ? Math.round((rawScore / 50) * 100)
    : rawScore;

  return {
    is_applicable: true,
    score: normalizedScore,
    grade: gradeForScore(normalizedScore),
    deductions,
    total_deductions: deductions.reduce((sum, deduction) => sum + deduction.points, 0),
      retroactive_leg_count: retroactiveLegs.length,
  };
}

export function shouldSuggestCampaignEnd(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  pendingOrders: PendingOrder[],
  referenceTimeMs?: number,
): boolean {
  if (campaign.status !== 'active') return false;
  const mainLegs = legs.filter(leg => leg.leg_role && MAIN_ROLES.includes(leg.leg_role));
  const hedgeLegs = legs.filter(leg => leg.leg_role && HEDGE_ROLES.includes(leg.leg_role));
  const mainAllClosed = mainLegs.length > 0 && mainLegs.every(leg => !!findTradeRecord(leg, tradeRecords));
  const noPendingHedge = pendingOrders.length === 0;
  if (mainAllClosed && noPendingHedge) return true;

  const allHedgesTriggered = hedgeLegs.length > 0 && hedgeLegs.every(leg => !!findTradeRecord(leg, tradeRecords));
  const lastOpMs = Math.max(
    toMs(campaign.opened_at),
    ...legs.map(leg => toMs(leg.pre_simulated_time)),
    ...tradeRecords.flatMap(record => [record.openTime, record.closeTime]),
  );
  const nowMs = referenceTimeMs ?? lastOpMs;
  return allHedgesTriggered && (nowMs - lastOpMs) >= 24 * 60 * 60_000;
}

const LEGEND: Record<Exclude<LegRole, 'standalone'>, string> = {
  main_open: '主力开仓',
  main_add_1: '加仓1',
  main_add_2: '加仓2',
  main_add_3: '加仓3',
  main_add_4: '加仓4',
  main_add_5: '加仓5',
  main_add_6: '加仓6',
  hedge_initial_a: '初始对冲 A',
  hedge_initial_b: '初始对冲 B',
  hedge_rolling: '滚动对冲',
  mirror_tp: '镜像止盈',
  reentry_main: '重新入场主力',
  reentry_hedge: '重新入场对冲',
};
