import {
  assembleCampaignsWithLegs,
  createUserLocalSnapshotReader,
  fetchCampaignSourceRows,
  getCampaignFullData,
  type CampaignSourceRows,
  type CampaignWithLegs,
  type UserLocalSnapshot,
} from '@/lib/journalApi';
import {
  CAMPAIGN_LEGACY_ORDER_RECORD_MATCH_MS,
  CAMPAIGN_ORDER_WINDOW_LOOKBACK_MS,
  isCampaignOpeningShortOrder,
} from '@/lib/campaignOrderAttribution';
import { bestOrderRealStamp, REPLAY_SITTING_GAP_MS } from '@/lib/campaignOrderRealTime';
import {
  computeInitialExpectedMaxDrawdownPct,
  computeInitialExpectedMaxLoss,
  computeProfitCaptureRatio,
} from '@/lib/campaignAnalysis';
import {
  campaignStatusFromRealizedPnl,
  computeCampaignRealizedPnl,
  materiallyDifferentPnl,
  type CampaignRealizedPnl,
} from '@/lib/campaignRealizedPnl';
import { campaignMainLegPriceChangePct } from '@/lib/campaignMainPriceChange';
import { resolveCampaignOpportunityQuality } from '@/lib/campaignMetrics';
import {
  fetchLegExitPriceCorrectionsResult,
  type LegExitPriceCorrections,
  type LegExitPriceCorrectionsResult,
} from '@/lib/campaignLegExecution';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CancelledOrderSnapshot, FilledOrderSnapshot, PendingOrder, TradeRecord } from '@/types/trading';

export type CampaignCardData = {
  campaign: TradeCampaign;
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
  /** 列表、散点图、一键结束共用包含平仓价校正的同一份结算。 */
  settlement: CampaignRealizedPnl;
  profitCaptureRatio: number | null;
  initialExpectedMaxLoss: number;
  initialExpectedMaxDrawdownPct: number;
  opportunityQuality: number | null;
  /** 主力那条腿的涨跌幅（%，按方向计，与 Legs 表同一个数）；主力未平仓时为 null。「涨幅」排序与卡片读数用它。 */
  mainPriceChangePct: number | null;
};

type CampaignDetails = Awaited<ReturnType<typeof getCampaignFullData>>;

export function buildCampaignCardData(
  details: CampaignDetails,
  corrections: LegExitPriceCorrections = {},
): CampaignCardData {
  const { campaign, legs, tradeRecords, reverseHedgeOrders } = details;
  const settlement = computeCampaignRealizedPnl(campaign, legs, tradeRecords, corrections);
  const reconciledCampaign = {
    ...campaign,
    final_realized_pnl: settlement.total ?? campaign.final_realized_pnl,
    status: settlement.settled
      ? campaignStatusFromRealizedPnl(settlement, campaign.closed_at)
      : campaign.status,
  };
  const initialExpectedMaxLoss = computeInitialExpectedMaxLoss(campaign, legs, tradeRecords, reverseHedgeOrders);
  const initialExpectedMaxDrawdownPct = computeInitialExpectedMaxDrawdownPct(campaign, legs, tradeRecords, reverseHedgeOrders);
  const profitCaptureRatio = Number.isFinite(initialExpectedMaxLoss) && initialExpectedMaxLoss > 0
    ? computeProfitCaptureRatio(campaign, legs, tradeRecords, reverseHedgeOrders, corrections)
    : null;
  return {
    campaign: reconciledCampaign,
    legs,
    tradeRecords,
    settlement,
    initialExpectedMaxLoss,
    initialExpectedMaxDrawdownPct,
    profitCaptureRatio,
    opportunityQuality: resolveCampaignOpportunityQuality(reconciledCampaign, profitCaptureRatio, initialExpectedMaxDrawdownPct),
    mainPriceChangePct: campaignMainLegPriceChangePct(legs, tradeRecords, corrections),
  };
}

/**
 * 结构相等（可枚举自有属性逐层比较，引用相同立即返回）。
 * 代替 JSON.stringify 签名：237 场 × 2 万条事件的签名要拼 11 MB 字符串、每次核对 150 ms 主线程；
 * 这里没变的数组按引用短路，变了的也只是走一遍对象，不分配。
 * 值为 undefined 的属性视同不存在：内存里的委托 / 成交（`peakPrice: undefined`）与从本地存储解析回来的
 * 同一条（JSON 丢掉了这个键）要判成相等，两种来源换着用不会误判成变化。
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    if (a.length !== other.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!deepEqual(a[index], other[index])) return false;
    }
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  let defined = 0;
  for (const key of Object.keys(left)) {
    const value = left[key];
    if (value === undefined) continue;
    defined += 1;
    if (!Object.prototype.hasOwnProperty.call(right, key) || !deepEqual(value, right[key])) return false;
  }
  for (const key of Object.keys(right)) {
    if (right[key] !== undefined) defined -= 1;
  }
  return defined === 0;
}

export interface CampaignListSnapshot {
  rows: CampaignCardData[];
  /** 首次加载是否已经把每一场都尝试过；之后永远为 true，后台核对只用 refreshing。 */
  complete: boolean;
  /** 正在读远端。本地核对（成交 / 委托变化）不亮它：几十毫秒就完，闪一下只会分心。 */
  refreshing: boolean;
  loaded: number;
  total: number;
  failedCount: number;
  error: string | null;
}

export type CampaignListRefreshKind = 'remote' | 'local';

/** 交易上下文里已经在内存中的那几份本地数据；撤单快照上下文不暴露，仍从本地存储读。 */
export type CampaignListLocalInputs = Pick<UserLocalSnapshot, 'tradeHistory' | 'ordersMap' | 'filledOrders'> & {
  positionsMap: NonNullable<UserLocalSnapshot['positionsMap']>;
};

export interface CampaignListRefreshOptions {
  /** 距上次远端读取开始不足这么久就不再读（窗口焦点回来时用）；本地核对不受此限。 */
  maxAgeMs?: number;
  /**
   * 页面手里的内存数据：给了就记住，之后每次核对（含排队的、写入结束后的）都直接用这几份引用，
   * 不再解析本地存储里的几 MB 成交记录；没变的记录连对象都是同一个，比较按引用短路。
   */
  local?: CampaignListLocalInputs;
}

type OrderSnapshot = PendingOrder | CancelledOrderSnapshot | FilledOrderSnapshot;
type OrderSnapshotKind = 'live' | 'cancelled' | 'filled';

/**
 * 一场战役从本地数据里取用了什么（由上次算出的 details 推得），本地增量核对据此判一处变化碰不碰得到它。
 * 见 localChangeTouchesCampaign。
 */
interface CampaignLocalProfile {
  /** 腿引用的成交 / 仓位 id：getCampaignFullData 按它们选本场成交。 */
  recordIds: Set<string>;
  /** 本场成交的仓位 id / 成交 id：成交快照凭它免过回放时间线。 */
  selectedPositionIds: Set<string>;
  /** 事件流里记的委托 id：本地快照按 id 查它们的存亡。 */
  eventOrderIds: Set<string>;
  /** 委托按模拟挂单时刻归属的窗口 [开主力 − 5 min, 平仓]。 */
  simStart: number;
  simEnd: number;
  /** 建起了回放分段：同标的事件才参与它的切段。 */
  anchored: boolean;
  /** 真实时刻界（含一次坐下来的余量）：晚于它的事件碰不到本场的归属；无界为 +∞。 */
  bound: number;
}

type CachedRow = {
  source: CampaignWithLegs;
  /** 腿引用的别的标的的成交（异常归类）：不在本标的的本地分组里，单独比较。 */
  crossRecords: TradeRecord[];
  localVersion: number;
  details: CampaignDetails;
  /** null = 还没取到（或上次取抛错）。拉到一部分（correctionsComplete 为 false）时照样放在这里，供显示。 */
  corrections: LegExitPriceCorrections | null;
  /**
   * 每条挂成交的腿都查到了记录、拿到了 K 线结论（见 fetchLegExitPriceCorrectionsResult）。
   * false 的校正不可信：按退避在之后的远端核对里重拉（失败的分钟不进 K 线缓存，见 correctionRetries），
   * 也不拿它判定落库结果偏不偏离。
   */
  correctionsComplete: boolean;
  row: CampaignCardData;
  profile?: CampaignLocalProfile;
};

type OptimisticEntry = {
  /** null = 本地已删掉这一行。 */
  row: CampaignCardData | null;
  revision: number;
};

type SymbolLocalGroup = {
  trades: TradeRecord[];
  orders: PendingOrder[];
  cancelled: CancelledOrderSnapshot[];
  filled: FilledOrderSnapshot[];
  /** 仓位只用到 id（见 UserLocalSnapshot.positionsMap）：行情 tick 改动仓位对象不算本地变化。 */
  positionIds: string[];
};

/** 一个标的的本地分组从上一版到这一版改了什么；每条改动都标注它是否动了回放事件流的两只钟。 */
interface SymbolGroupDiff {
  records: Array<{ record: TradeRecord; lane: boolean }>;
  orders: Array<{ order: OrderSnapshot; kind: OrderSnapshotKind; lane: boolean }>;
  /** 新开 / 已平仓位（及并入的成交）的 id。 */
  positionIds: string[];
  /** 前后两版的成交快照：判平仓记录 / 仓位变化是否牵涉本场的成交委托时按它扫。 */
  filled: FilledOrderSnapshot[];
}

type SymbolLocalState = {
  group: SymbolLocalGroup;
  version: number;
  /** 从 version − 1 到 version 的改动；分组没变过为 null。 */
  diff: SymbolGroupDiff | null;
};

const EMPTY: never[] = [];

/**
 * 按标的分组，以数组身份记住结果：页面给的内存数组没换引用（只改了委托）时，几千条成交不再重新分一遍，
 * 每个标的的分组还是上次那个数组，分组比较与差异按引用短路。
 */
const symbolGroupsByArray = new WeakMap<object, Map<string, unknown[]>>();
function groupBySymbol<T extends { symbol: string }>(items: T[]): Map<string, T[]> {
  const known = symbolGroupsByArray.get(items) as Map<string, T[]> | undefined;
  if (known) return known;
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const rows = groups.get(item.symbol);
    if (rows) rows.push(item);
    else groups.set(item.symbol, [item]);
  }
  symbolGroupsByArray.set(items, groups);
  return groups;
}

/** 委托的回放归属依赖同标的其他成交，不能只比较本场已选的记录，所以按标的整组比较。 */
function groupLocalBySymbol(local: UserLocalSnapshot, symbols: Iterable<string>) {
  const trades = groupBySymbol(local.tradeHistory);
  const cancelled = groupBySymbol(local.cancelledOrders);
  const filled = groupBySymbol(local.filledOrders);
  return new Map<string, SymbolLocalGroup>(Array.from(new Set(symbols), symbol => [symbol, {
    trades: trades.get(symbol) ?? EMPTY,
    orders: local.ordersMap[symbol] ?? EMPTY,
    cancelled: cancelled.get(symbol) ?? EMPTY,
    filled: filled.get(symbol) ?? EMPTY,
    positionIds: (local.positionsMap?.[symbol] ?? [])
      .flatMap(position => [position.id, ...(position.fills ?? []).map(fill => fill.id)])
      .filter((id): id is string => Boolean(id)),
  }]));
}

/** 回放事件流只读这几个字段（symbolLocalIndex）：别的字段变了，事件流的两只钟一个都没动。 */
const RECORD_CLOCK_KEYS = ['action', 'openTime', 'closeTime', 'openedRealAt', 'closedRealAt'] as const;
const ORDER_CLOCK_KEYS = ['createdAt', 'createdRealAt', 'cancelledAt', 'cancelledRealAt', 'filledAt', 'filledRealAt'] as const;
const RECORD_REAL_KEYS = ['openedRealAt', 'closedRealAt'] as const;
const ORDER_REAL_KEYS = ['createdRealAt', 'cancelledRealAt', 'filledRealAt'] as const;

const finiteStamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** 一条记录最早的真实时刻；一个都没有（没盖章的老数据、资金费）为 +∞——它不在回放事件流里。 */
function earliestRealStamp(item: object, keys: readonly string[]): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const key of keys) {
    const value = (item as Record<string, unknown>)[key];
    if (finiteStamp(value) && value < earliest) earliest = value;
  }
  return earliest;
}

/**
 * 按 id 找出两版之间增、删、改的条目。改了的两版都交出去（两版各自可能牵涉不同战役），
 * 并标注两只钟是否有变——跟踪止损每根 K 线改 peakPrice，但它的挂单时刻没动，事件流就没动。
 */
function diffById<T extends { id: string }>(
  before: T[],
  after: T[],
  clockKeys: readonly string[],
  push: (item: T, lane: boolean) => void,
) {
  if (before === after) return;
  const group = (items: T[]) => {
    const byId = new Map<string, T[]>();
    for (const item of items) {
      const list = byId.get(item.id);
      if (list) list.push(item);
      else byId.set(item.id, [item]);
    }
    return byId;
  };
  const left = group(before);
  const right = group(after);
  for (const [id, olds] of left) {
    const news = right.get(id);
    if (!news || news.length !== olds.length) {
      olds.forEach(item => push(item, true));
      news?.forEach(item => push(item, true));
      continue;
    }
    for (let index = 0; index < olds.length; index += 1) {
      if (deepEqual(olds[index], news[index])) continue;
      const lane = clockKeys.some(key => !Object.is(
        (olds[index] as Record<string, unknown>)[key],
        (news[index] as Record<string, unknown>)[key],
      ));
      push(olds[index], lane);
      push(news[index], lane);
    }
  }
  for (const [id, news] of right) {
    if (!left.has(id)) news.forEach(item => push(item, true));
  }
}

function diffSymbolGroup(before: SymbolLocalGroup, after: SymbolLocalGroup): SymbolGroupDiff {
  const diff: SymbolGroupDiff = { records: [], orders: [], positionIds: [], filled: [...before.filled, ...after.filled] };
  diffById(before.trades, after.trades, RECORD_CLOCK_KEYS, (record, lane) => diff.records.push({ record, lane }));
  const orders = (kind: OrderSnapshotKind, left: OrderSnapshot[], right: OrderSnapshot[]) => (
    diffById(left, right, ORDER_CLOCK_KEYS, (order, lane) => diff.orders.push({ order, kind, lane }))
  );
  orders('live', before.orders, after.orders);
  orders('cancelled', before.cancelled, after.cancelled);
  orders('filled', before.filled, after.filled);
  const beforeIds = new Set(before.positionIds);
  const afterIds = new Set(after.positionIds);
  for (const id of beforeIds) if (!afterIds.has(id)) diff.positionIds.push(id);
  for (const id of afterIds) if (!beforeIds.has(id)) diff.positionIds.push(id);
  return diff;
}

function campaignLocalProfile(entry: CachedRow): CampaignLocalProfile {
  if (entry.profile) return entry.profile;
  const { campaign, legs, tradeRecords } = entry.details;
  const openedAtMs = new Date(campaign.opened_at).getTime();
  const end = entry.details.replayEndRealAt ?? null;
  entry.profile = {
    recordIds: new Set(legs.map(leg => leg.trade_record_id).filter((id): id is string => Boolean(id))),
    selectedPositionIds: new Set(
      tradeRecords.flatMap(record => [record.positionId, record.fillId]).filter((id): id is string => Boolean(id)),
    ),
    eventOrderIds: new Set(
      (campaign.actual_evolution ?? []).map(event => event.pending_order_id).filter((id): id is string => Boolean(id)),
    ),
    simStart: openedAtMs - CAMPAIGN_ORDER_WINDOW_LOOKBACK_MS,
    simEnd: campaign.closed_at ? new Date(campaign.closed_at).getTime() : Number.POSITIVE_INFINITY,
    // 替身没给这两个字段时按最保守的「无界」：任何同标的变化都重算
    anchored: entry.details.replayAnchored ?? true,
    bound: end === null ? Number.POSITIVE_INFINITY : end + REPLAY_SITTING_GAP_MS,
  };
  return entry.profile;
}

/**
 * 一个标的的本地改动碰不碰得到这一场——只有确定碰不到才沿用上次结果，拿不准就重算。
 * 逐条对照 getCampaignFullData 从本地快照取用的每一处：
 *   · 本场成交：按腿引用的 id / 仓位 id 选（recordIds）；
 *   · 回放分段：同标的所有带两只钟的成交 / 委托事件（资金费除外）都参与切段——但已结束的战役窗口在最后一个
 *     平仓侧锚点之后被一次坐下来截断，晚于界 bound 的事件进不了它的段（replayEndRealAt）；没盖章的事件不在流里；
 *     只改了别的字段、两只钟没动的条目（跟踪止损每根 K 线的 peakPrice）也没动事件流；
 *   · 反向委托：模拟挂单时刻落在窗口里的开仓性质空单（挂着的 / 撤掉的 / 成交的），再过时间线——时间线只在界内，
 *     真实时刻晚于界的单子一定过不了；没有任何真实时刻的老单子一律候选；
 *   · 成交快照接回平仓记录：按仓位 id / fillId 找同向的平仓记录，老快照没有仓位 id（或记录没有 fillId）时
 *     按模拟时间（最宽 15 分钟）+ 价格找，所以同标的 SHORT 平仓记录的增删改要看本场有没有那样的成交委托
 *     （窗口里、时间线到得了、成交时刻挨得够近的）；
 *   · 仓位存亡：至今开着的仓位 id 决定成交快照是否「活着」，只关乎本场窗口里成交委托开出的仓位。
 * 事件流里记了 id 的委托快照，不论怎么变都算本场的（快照按 id 查）。
 */
function localChangeTouchesCampaign(entry: CachedRow, diff: SymbolGroupDiff): boolean {
  const profile = campaignLocalProfile(entry);
  const { anchored, bound } = profile;
  const inSimWindow = (at: unknown) => (
    typeof at === 'number' && Number.isFinite(at) && at >= profile.simStart && at <= profile.simEnd
  );
  let filledMatch: {
    /** 本场窗口里（时间线到得了的）开仓空单成交开出的仓位 id。 */
    shortPositionIds: Set<string>;
    /** 同上，但不限开仓空单：仓位存亡只关乎这些仓位。 */
    allPositionIds: Set<string>;
    /** 这些成交的模拟成交时刻：没有仓位 id / fillId 的老口径按它与记录开仓时刻的距离接回。 */
    shortFilledAts: number[];
    /** 其中快照没有仓位 id 的（老快照）：任何 SHORT 平仓记录都可能按时间 + 价格接上它。 */
    legacyShortFilledAts: number[];
  } | null = null;
  const matchProfile = () => {
    if (filledMatch) return filledMatch;
    filledMatch = { shortPositionIds: new Set(), allPositionIds: new Set(), shortFilledAts: [], legacyShortFilledAts: [] };
    for (const order of diff.filled) {
      const inWindow = inSimWindow(order.createdAt);
      const named = profile.eventOrderIds.has(order.id);
      if (!inWindow && !named) continue;
      // 真实时刻晚于界的成交委托过不了本场的时间线（今天回放同一段行情成交的单子）：它开出的仓位与本场无关
      const stamp = bestOrderRealStamp(order);
      if (!named && stamp !== null && stamp > bound) continue;
      if (order.positionId) filledMatch.allPositionIds.add(order.positionId);
      if (!inWindow || !isCampaignOpeningShortOrder(order)) continue;
      filledMatch.shortFilledAts.push(order.filledAt);
      if (order.positionId) filledMatch.shortPositionIds.add(order.positionId);
      else filledMatch.legacyShortFilledAts.push(order.filledAt);
    }
    return filledMatch;
  };
  const nearAnyFill = (record: TradeRecord, filledAts: number[]) => (
    filledAts.some(filledAt => Math.abs(record.openTime - filledAt) <= CAMPAIGN_LEGACY_ORDER_RECORD_MATCH_MS)
  );
  for (const { record, lane } of diff.records) {
    if (profile.recordIds.has(record.id) || (record.positionId && profile.recordIds.has(record.positionId))) return true;
    if (record.action === 'FUNDING') continue;
    if (anchored && lane && earliestRealStamp(record, RECORD_REAL_KEYS) <= bound) return true;
    if ((record.action === 'CLOSE' || record.action === 'LIQUIDATION') && record.side === 'SHORT') {
      const match = matchProfile();
      if ((record.positionId && match.shortPositionIds.has(record.positionId))
        || (record.fillId && match.shortPositionIds.has(record.fillId))
        || nearAnyFill(record, record.fillId ? match.legacyShortFilledAts : match.shortFilledAts)) return true;
    }
  }
  for (const { order, kind, lane } of diff.orders) {
    if (profile.eventOrderIds.has(order.id)) return true;
    if (anchored && lane && earliestRealStamp(order, ORDER_REAL_KEYS) <= bound) return true;
    if (kind === 'filled') {
      const positionId = (order as FilledOrderSnapshot).positionId;
      if (positionId && profile.selectedPositionIds.has(positionId)) return true;
    }
    if (inSimWindow(order.createdAt) && isCampaignOpeningShortOrder(order)) {
      const stamp = bestOrderRealStamp(order);
      if (stamp === null || stamp <= bound) return true;
    }
  }
  if (diff.positionIds.length > 0) {
    const match = matchProfile();
    if (diff.positionIds.some(id => match.allPositionIds.has(id))) return true;
  }
  return false;
}

/** getCampaignFullData 按 id / 仓位 id 接入成交；跨标的的那几条也纳入签名，避免漏更新。 */
function indexRecordsByKey(records: TradeRecord[]) {
  const byKey = new Map<string, Array<{ record: TradeRecord; position: number }>>();
  const add = (key: string, entry: { record: TradeRecord; position: number }) => {
    const list = byKey.get(key);
    if (list) list.push(entry);
    else byKey.set(key, [entry]);
  };
  records.forEach((record, position) => {
    add(record.id, { record, position });
    if (record.positionId && record.positionId !== record.id) add(record.positionId, { record, position });
  });
  return byKey;
}

function crossSymbolRecords(
  byKey: ReturnType<typeof indexRecordsByKey>,
  legs: TradeJournal[],
  symbol: string,
): TradeRecord[] {
  const found = new Map<number, TradeRecord>();
  for (const leg of legs) {
    if (!leg.trade_record_id) continue;
    for (const { record, position } of byKey.get(leg.trade_record_id) ?? []) {
      if (record.symbol !== symbol) found.set(position, record);
    }
  }
  if (found.size === 0) return EMPTY;
  return Array.from(found.keys()).sort((a, b) => a - b).map(position => found.get(position)!);
}

/**
 * 已结束的战役，落库结果（status / final_realized_pnl）与列表手里校正后的结果不一致：
 * 元监控等直接读落库值的统计会算错，值得在后台跑一遍详情页的自愈。
 * 只看已经拿到平仓价校正、已结算、落库与现算都是结束状态的场次；纯内存判断，不碰网络。
 */
function storedOutcomeDiverges(entry: CachedRow): boolean {
  const { row, source } = entry;
  const stored = source.campaign;
  // 已软删的行不自愈：远端核对读回带 deleted_at 的行后，排队与排到时都跳过
  if (stored.deleted_at) return false;
  // 校正拉不齐（K 线限流 / 断网、本地查不到成交）时的「没有校正」不可信：既可能掩盖偏离，也可能把已收敛的场次看成偏离
  if (!entry.correctionsComplete || !row.settlement.settled) return false;
  // 已结算的「放弃」照样算：详情自愈会按校正后的盈亏把它改写成对应的结束状态（结束对话框也只给未结算的战役留「放弃」）
  if (!stored.closed_at || stored.status === 'active' || stored.status === 'planned') return false;
  if (row.campaign.status === 'active' || row.campaign.status === 'planned') return false;
  // 自愈只有在每条腿都挂着成交 id、且本地查得到成交记录时才拉得齐校正、才可能写；
  // 否则（换了浏览器、清过成交、纯复盘快照）排进去也是一次注定不写的完整详情读取，每个会话重来一遍。
  if (row.settlement.basis !== 'records' || !row.legs.every(leg => leg.trade_record_id)) return false;
  return row.campaign.status !== stored.status
    || materiallyDifferentPnl(stored.final_realized_pnl ?? null, row.settlement.total ?? null);
}

/**
 * 平仓价校正只取决于标的、每条腿的 id 与挂的成交 id、以及成交记录（见 fetchLegExitPriceCorrectionsResult）。
 * 腿上的复盘快照（post_*）不参与：详情页 / 后台自愈回填快照后，下一次核对照旧沿用校正，
 * 不会先按未校正的数画一遍（状态反号）、等校正回来再翻回去。
 */
function sameCorrectionInputs(a: CampaignDetails, b: CampaignDetails): boolean {
  return a.campaign.symbol === b.campaign.symbol
    && a.legs.length === b.legs.length
    && a.legs.every((leg, index) => leg.id === b.legs[index].id && leg.trade_record_id === b.legs[index].trade_record_id)
    && deepEqual(a.tradeRecords, b.tradeRecords);
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** 让出主线程但不排进定时器队列：嵌套 setTimeout 会被钳到 4 ms，几十片下来白等半秒。 */
const yieldToMainThread = typeof MessageChannel === 'function'
  ? () => new Promise<void>(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  })
  : () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** 远端读取封顶：睡醒后的死连接不会永远占着「正在读」，让错误路径（保留旧行、可重试）接手。 */
export const CAMPAIGN_LIST_REMOTE_TIMEOUT_MS = 30_000;

const withTimeout = <T>(promise: Promise<T>, ms: number) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`读取战役列表超时（${Math.round(ms / 1000)} 秒没有回应）`)), ms);
  promise.then(
    value => { clearTimeout(timer); resolve(value); },
    error => { clearTimeout(timer); reject(error); },
  );
});

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 后台自愈相邻两场之间至少歇多久（上一场结束到下一场开始；读取完成后的第一场同样先歇一次）。 */
export const CAMPAIGN_LIST_HEAL_GAP_MS = 250;

/**
 * 页面闸最多等后台自愈多久（见 waitForCampaignListHeal）。supabase 请求没有超时，睡醒后的死连接会让一场自愈永远不结束：
 * 那只让后台队列停一个看门狗（CAMPAIGN_LIST_HEAL_SINGLE_FLIGHT_WAIT_MS），页面到点照常往下走。
 */
export const CAMPAIGN_LIST_HEAL_PAGE_WAIT_MS = 2_000;

/**
 * 没拉齐（或抛错）的平仓价校正多久之后才重拉：从这个间隔起，每再没拉齐一次翻倍，封顶 CAMPAIGN_LIST_CORRECTIONS_RETRY_MAX_MS。
 * 只在远端核对里重拉，按战役 id 计时，拉齐时清掉（见 createCampaignListCache 里的 correctionRetries）。
 */
export const CAMPAIGN_LIST_CORRECTIONS_RETRY_MS = 60_000;
export const CAMPAIGN_LIST_CORRECTIONS_RETRY_MAX_MS = 600_000;

/**
 * 后台队列最多等**别的缓存**那一场自愈多久。supabase 请求没有超时：睡醒后的死连接会让一场自愈永远不落定，
 * 而它占着全模块唯一的单飞位——上一个用户留下的那一场会把这个标签页之后的每一个队列（登出换用户后新建的也在内）
 * 永久锁死，那个用户的统计再也收敛不了。到点之后队列不再等它，但它随时可能写：它挪进 healAbandoned，
 * 不设上限的 whenCampaignListHealIdle 照旧等它落定。
 * 必须 ≥ CAMPAIGN_LIST_HEAL_PAGE_WAIT_MS：页面闸只看当前那一场，挪走的那一场早已过了页面闸的上限。
 */
export const CAMPAIGN_LIST_HEAL_SINGLE_FLIGHT_WAIT_MS = 30_000;

type HealTurn = { campaignId: string; startedAt: number; done: Promise<void> };

/**
 * 正在跑的那一场后台自愈。全模块至多一场：拆除的缓存、上一个用户留下的也算，别的缓存排到时先等它落定。
 * done 只在自愈本身结束（成功或出错）时落定，从不失败；不设超时——落定之前它随时可能写。
 */
let healInFlight: HealTurn | null = null;

/**
 * 过了看门狗、后台队列已经不再等的那些自愈（见 CAMPAIGN_LIST_HEAL_SINGLE_FLIGHT_WAIT_MS）。
 * 它们随时可能写，所以不设上限的让出闸照旧等它们落定；落定时自己退出这个集合。
 */
const healAbandoned = new Set<HealTurn>();

/** 还可能写的自愈：当前这一场 + 已放弃等待但没落定的。不带 id 就是全部，带 id 只看这一场。 */
const blockingHealTurns = (campaignId?: string): HealTurn[] => {
  const turns = healInFlight ? [...healAbandoned, healInFlight] : [...healAbandoned];
  return campaignId === undefined ? turns : turns.filter(turn => turn.campaignId === campaignId);
};

/**
 * 队列等别的缓存那一场自愈让出，最多等 watchdogMs：到点仍没落定就把它挪出单飞位（让出闸照旧等它），
 * 队列接着往下排。挪走之后它自己落定时不会再动 healInFlight——那时占着位子的已经不是它了（见 runHealTurn）。
 */
const waitForOtherHeal = (turn: HealTurn, watchdogMs: number) => new Promise<void>(resolve => {
  const timer = setTimeout(() => {
    if (healInFlight === turn) {
      healInFlight = null;
      healAbandoned.add(turn);
      void turn.done.then(() => healAbandoned.delete(turn));
    }
    resolve();
  }, watchdogMs);
  void turn.done.then(() => {
    clearTimeout(timer);
    resolve();
  });
});

/**
 * 等后台自愈让出（不设上限：还可能写的那些落定之前不报让出）。自愈写的是它开头读到的战役与腿推出的补丁——
 * 晚于用户的写入落地，就会把刚解除的腿算回去、把刚改的汇总盖回去。
 * 不带 id：还有可能写的自愈才等，没有就立即放行；带 id：可能写的正是这一场才等。页面用 waitForCampaignListHeal。
 */
export function whenCampaignListHealIdle(campaignId?: string): Promise<void> {
  const turns = blockingHealTurns(campaignId);
  if (turns.length === 0) return Promise.resolve();
  if (turns.length === 1) return turns[0].done;
  return Promise.all(turns.map(turn => turn.done)).then(() => undefined);
}

/**
 * 页面的闸：与 whenCampaignListHealIdle 相同，但最多等 maxWaitMs——挂死的自愈至多卡住后台队列一个看门狗，从不卡页面。
 *   · 列表页的删除 / 恢复 / 永久删除 / 点星 / 一键结束：beginMutation（不再排新的一场）之后、调写接口之前等；
 *   · 详情页打开时传 campaignId：正好是后台在自愈的那一场才等（读到的就是收敛后的行），别的场次立即放行；
 *   · 归类页解除归属：刚离开列表页时可能还有一场在跑。
 * 到点放行后那一场若再写，竞态与两个标签页同时操作同一场相同（它只写汇总字段，见 queueDivergedCampaigns 上的说明）。
 * 上限从那一场**开始**算起：supabase 请求没有超时，挂死的那一场会一直占着 healInFlight，
 * 若每次都从现在起再等一个上限，这个标签页之后的每一次写入（乃至登出换用户之后）都要白赔一次。
 */
export function waitForCampaignListHeal(campaignId?: string, maxWaitMs = CAMPAIGN_LIST_HEAL_PAGE_WAIT_MS): Promise<void> {
  // 只看当前这一场：被队列放弃等待的那些已经跑满了一个看门狗（≥ 本上限），按下面的算法本来就到点、立即放行。
  const turn = healInFlight;
  if (!turn || (campaignId !== undefined && turn.campaignId !== campaignId)) return Promise.resolve();
  const waitMs = Math.min(maxWaitMs, turn.startedAt + maxWaitMs - Date.now());
  if (waitMs <= 0) return Promise.resolve();
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, waitMs);
    void turn.done.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** clearCampaignListCaches 每调用一次加一：之前建的缓存算已拆除，后台自愈不再排下一场。 */
let cacheGeneration = 0;
/** 最近一次取缓存的用户（getCampaignListCache）；换了用户 / 登出，别的用户的后台自愈不再排下一场。null = 还没人取过。 */
let activeUserId: string | null = null;

export interface CampaignListCacheOptions {
  /** 连续计算多久让出一次主线程。 */
  sliceMs?: number;
  /** 首次加载期间至少隔多久才向页面提交一次进度：每次提交都会重排已有卡片。 */
  publishMs?: number;
  /** 远端读取多久没回应算失败。 */
  remoteTimeoutMs?: number;
  /** 后台自愈相邻两场的间隔，见 CAMPAIGN_LIST_HEAL_GAP_MS。 */
  healGapMs?: number;
  /** 后台队列最多等别的缓存那一场自愈多久，见 CAMPAIGN_LIST_HEAL_SINGLE_FLIGHT_WAIT_MS。 */
  healWatchdogMs?: number;
  /** 没拉齐的平仓价校正第一次重拉前至少等多久，见 CAMPAIGN_LIST_CORRECTIONS_RETRY_MS。 */
  correctionsRetryMs?: number;
  /** 重拉间隔翻倍的上限，见 CAMPAIGN_LIST_CORRECTIONS_RETRY_MAX_MS。 */
  correctionsRetryMaxMs?: number;
}

/**
 * 用户级内存缓存，生命周期不依附列表组件：离开继续加载，返回同步读快照。
 *
 * 规则：
 *   · 正在进行的读取一定跑完，不会因为成交变化 / 窗口焦点 / 点星被打断从 0 重来；期间的请求合并成**一次**后续核对。
 *   · 首次加载完成后 complete 永远为 true，之后只用 refreshing（远端读取）表示后台在忙，不再出现进度条。
 *   · 远端核对只读变了的行（fetchCampaignSourceRows 增量）；本地成交 / 委托变化只做本地核对：
 *     沿用上次远端行重新装配，只重算本地改动真的碰得到的那几场（localChangeTouchesCampaign），不碰网络。
 *   · 输入没变的场次保留 row 引用与已完成的平仓价校正；重算结果逐字段相同时也保留原对象，卡片与散点图不重绘。
 *   · 乐观编辑（点星 / 删除 / 恢复）在写入结束前不会被正在收尾的读取盖掉——首载中途的进度提交也不会；
 *     写入结束后以远端为准核对一次。晚到的平仓价校正按缓存条目落地，正在收尾的读取提交时按条目取行，不会盖回去。
 *   · 更新失败保留最后可用结果并显式提示，不把失败当成零战役；远端读不回来时仍用最新本地数据核对一遍。
 *   · 列表本身不写库（读取走 heal: false）。已结束的战役落库结果与校正后结果不一致时，只把它排进后台队列，
 *     逐场、一次一场地调用详情页打开时的同一个自愈（getCampaignFullData 默认 heal），见 queueDivergedCampaigns；
 *     只在列表页开着时排下一场，同一时刻全模块至多一场；页面写入前用 waitForCampaignListHeal 等在跑的那一场落地（有上限）。
 *   · 没拉齐的平仓价校正只在远端核对里、按每场的退避间隔重拉（见 correctionRetries），本地核对从不重拉；
 *     同一场同时至多一次拉取（correctionsInFlight），落地时按当时的校正输入归到当前条目上。
 */
export function createCampaignListCache(userId: string, options: CampaignListCacheOptions = {}) {
  const sliceMs = options.sliceMs ?? 40;
  const publishMs = options.publishMs ?? 200;
  const remoteTimeoutMs = options.remoteTimeoutMs ?? CAMPAIGN_LIST_REMOTE_TIMEOUT_MS;
  const healGapMs = options.healGapMs ?? CAMPAIGN_LIST_HEAL_GAP_MS;
  const healWatchdogMs = options.healWatchdogMs ?? CAMPAIGN_LIST_HEAL_SINGLE_FLIGHT_WAIT_MS;
  const correctionsRetryMs = options.correctionsRetryMs ?? CAMPAIGN_LIST_CORRECTIONS_RETRY_MS;
  const correctionsRetryMaxMs = options.correctionsRetryMaxMs ?? CAMPAIGN_LIST_CORRECTIONS_RETRY_MAX_MS;
  const generation = cacheGeneration;
  let snapshot: CampaignListSnapshot = {
    rows: [], complete: false, refreshing: false, loaded: 0, total: 0, failedCount: 0, error: null,
  };
  const listeners = new Set<() => void>();
  const cachedRows = new Map<string, CachedRow>();
  const localGroups = new Map<string, SymbolLocalState>();
  const optimistic = new Map<string, OptimisticEntry>();
  /**
   * 没拉齐（或抛错）的平仓价校正的重拉退避，按战役 id 记：条目重建（改标题、本地核对重算）不重置它，拉齐时删掉。
   * 有记录的场次只在远端核对里、且过了 notBefore 才重拉；跨标签页 storage 事件、交易状态变化驱动的本地核对一律不重拉——
   * 否则 K 线限流 / 断网时，每次核对都会把失败的那几分钟再打一遍。间隔从 correctionsRetryMs 起，每再没拉齐一次翻倍，封顶 correctionsRetryMaxMs。
   * 没有记录（从没拉过、或上次拉齐）的照旧随读取拉；校正输入变了（换了挂的成交、没有旧条目）是新的问题，也立即拉，只是计时接着算。
   */
  const correctionRetries = new Map<string, { intervalMs: number; notBefore: number }>();
  const correctionRetryAllowed = (id: string, remote: boolean) => {
    const retry = correctionRetries.get(id);
    return !retry || (remote && Date.now() >= retry.notBefore);
  };
  /**
   * 正在拉的平仓价校正，按**战役 id** 记（不是按缓存条目），值是发起时的那份 details。
   * 条目重建（本地重算）后校正输入没变的不再为同一个问题发第二次，落地时的退避也只记一次——
   * 否则一次失败会被每个重建过的条目各记一遍，间隔一步跳到封顶。
   * 校正输入变了（换了挂的成交）是另一个问题：另发起一次并接手这个槽位，先前那次的结果作废。
   */
  const correctionsInFlight = new Map<string, CampaignDetails>();
  const correctionsFetching = (entry: CachedRow) => {
    const pending = correctionsInFlight.get(entry.details.campaign.id);
    return Boolean(pending) && sameCorrectionInputs(pending!, entry.details);
  };
  const recordCorrectionOutcome = (id: string, complete: boolean) => {
    if (complete) {
      correctionRetries.delete(id);
      return;
    }
    const previous = correctionRetries.get(id);
    const intervalMs = Math.min(previous ? previous.intervalMs * 2 : correctionsRetryMs, correctionsRetryMaxMs);
    correctionRetries.set(id, { intervalMs, notBefore: Date.now() + intervalMs });
  };
  const localReader = createUserLocalSnapshotReader(userId);
  let localInputs: CampaignListLocalInputs | null = null;
  let remoteRows: CampaignSourceRows | null = null;
  let remoteStartedAt: number | null = null;
  let inFlight: Promise<void> | null = null;
  /** 正在进行的读取还在等远端返回：它读回来的就是最新的，这期间的请求跟着它即可，不必再排一次。 */
  let fetchPending = false;
  let pending: CampaignListRefreshKind | null = null;
  let revision = 0;
  let mutations = 0;
  const publish = (patch: Partial<CampaignListSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener());
  };
  const retainRowReferences = (rows: CampaignCardData[]) => (
    rows.length === snapshot.rows.length && rows.every((row, index) => row === snapshot.rows[index])
      ? snapshot.rows : rows
  );
  /** 提交时才从条目取行：晚到的平仓价校正改的是条目上的 row，循环里早先拿到的引用可能已经过时。 */
  const rowsOf = (entries: CachedRow[]) => entries.map(entry => entry.row);

  /** 远端行与成交记录都没换引用时沿用上次装配的结果（偏好 / 镜像只会随远端核对一起变，那时总会重新装配）。 */
  let assembled: { rows: CampaignSourceRows; tradeHistory: TradeRecord[]; sources: CampaignWithLegs[] } | null = null;
  const assembleSources = (rows: CampaignSourceRows, local: UserLocalSnapshot, remote: boolean) => {
    if (!remote && assembled && assembled.rows.campaigns === rows.campaigns
      && assembled.rows.journals === rows.journals && assembled.tradeHistory === local.tradeHistory) {
      return assembled.sources;
    }
    const sources = assembleCampaignsWithLegs(userId, rows, { tradeHistory: local.tradeHistory });
    assembled = { rows, tradeHistory: local.tradeHistory, sources };
    return sources;
  };
  let recordsIndex: { tradeHistory: TradeRecord[]; byKey: ReturnType<typeof indexRecordsByKey> } | null = null;
  const recordsByKeyOf = (tradeHistory: TradeRecord[]) => {
    if (!recordsIndex || recordsIndex.tradeHistory !== tradeHistory) {
      recordsIndex = { tradeHistory, byKey: indexRecordsByKey(tradeHistory) };
    }
    return recordsIndex.byKey;
  };

  /**
   * 乐观编辑覆盖读取结果：写入还没结束、或编辑晚于这次读取开始时，本地为准；
   * 更早的编辑已经进了远端，这次读到的就是它，条目作废。
   */
  const applyOptimistic = (rows: CampaignCardData[], startRevision: number) => {
    const overridden = new Set<string>();
    if (optimistic.size === 0) return { rows, overridden };
    const holds = (entry: OptimisticEntry) => mutations > 0 || entry.revision > startRevision;
    const result: CampaignCardData[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const id = row.campaign.id;
      const entry = optimistic.get(id);
      if (!entry) {
        result.push(row);
        continue;
      }
      if (!holds(entry)) {
        optimistic.delete(id);
        result.push(row);
        continue;
      }
      overridden.add(id);
      seen.add(id);
      if (entry.row) result.push(entry.row);
    }
    // 本地刚恢复的行：这次读取开始时远端还没有它
    for (const [id, entry] of optimistic) {
      if (seen.has(id)) continue;
      if (!holds(entry)) {
        optimistic.delete(id);
        continue;
      }
      overridden.add(id);
      if (entry.row) result.unshift(entry.row);
    }
    return { rows: result, overridden };
  };

  /**
   * 后台自愈队列。落库的 status / final_realized_pnl 以前只在打开详情页时收敛，元监控等读落库值的地方
   * 会把一场校正后反号却从没点开过的战役算错；这里替用户「逐场点开」一次：
   *   · 只检测、不推补丁：排到时调用 getCampaignFullData(id, { local })（默认 heal），与详情页打开时是同一条路——
   *     战役、腿在那一刻现读，本地成交由自愈专用读取器在那一刻现读 localStorage，写不写、写什么全由详情自愈决定；
   *   · 只凭拉齐了的校正判定偏离（correctionsComplete）：拉不齐的按退避重拉（correctionRetries），拉齐后再判；
   *   · 一次一场，相邻两场之间歇 healGapMs；每场每个缓存生命周期至多真正调用一次（调用了才算，出错也算，静默）；
   *   · 单飞：全模块同一时刻至多一场在跑，别的缓存留下的那一场没落定就先等它，但至多等一个看门狗
   *     （CAMPAIGN_LIST_HEAL_SINGLE_FLIGHT_WAIT_MS：那一场永远不落定时，登出换用户后的队列也要能往下走）；
   *     不设单场超时——落定之前它随时可能写，whenCampaignListHealIdle 不能提前报让出。
   *     挂死的请求至多让后台队列停一个看门狗，页面闸 waitForCampaignListHeal 到点照常放行；
   *   · 排到时写入没收尾、列表页不在（没有订阅者：详情 / 归类 / 交易页可能正在改战役）、这一场有乐观编辑、
   *     已不在列表里或已经不再偏离：让路、不算尝试过，下一次读取完成时重判（回到列表页挂载时就会读一次）；
   *   · 判定「写入没收尾」与登记 healInFlight 在同一个同步段里：列表页的写入 beginMutation 之后等 waitForCampaignListHeal，
   *     要么先于这一场开始（这一场让路），要么排在这一场落地之后（至多等页面闸的上限）；
   *   · 已软删（缓存行带 deleted_at）或已不在列表里的场次不排、排到也跳过。自愈进行中在别处软删 / 恢复无害：
   *     远端补丁只改汇总字段（状态、平仓时间、已实现盈亏等，不碰 deleted_at），回写成功时只更新本地已有的镜像行、
   *     不插整行，于是不会留下一条带 deleted_at、压住远端恢复的本地副本；云端没有这一行时的兜底同样只把补丁
   *     打在此刻的镜像行上、已带 deleted_at 的一个字都不写（见 healCampaignSummarySnapshots），
   *     所以页面闸到点放行之后它也复活不了刚删掉的本地战役；
   *   · 从不触发读取，也不重建 / 重新提交行（行上本来就是校正后的数）；落库行的 updated_at 变了，
   *     下一次正常的远端核对按增量读回它，行逐字段比较后不闪；
   *   · 缓存被拆除（clearCampaignListCaches）或换了用户：不再排下一场。
   */
  const healAttempted = new Set<string>();
  const healQueue = new Set<string>();
  /**
   * 自愈专用的本地快照读取器：与详情页的 readUserLocalSnapshot 同键、同兜底，每场排到时现读 localStorage；
   * 只是原文没变的键不再 JSON.parse，同一份快照上的索引也跟着复用——几 MB 的成交记录不必每场重解析一遍。
   * 不与列表读取共用读取器：那边带着页面内存里的覆盖值，这里只认落了盘的数据，与打开详情页时一致。
   */
  const healLocalReader = createUserLocalSnapshotReader(userId);
  let healTimer: ReturnType<typeof setTimeout> | null = null;
  let healing = false;
  const healAlive = () => Boolean(userId) && generation === cacheGeneration
    && (activeUserId === null || activeUserId === userId);
  const scheduleHeal = () => {
    if (healing || healTimer !== null || healQueue.size === 0) return;
    healTimer = setTimeout(() => { void runHealTurn(); }, healGapMs);
  };
  async function runHealTurn() {
    healTimer = null;
    if (!healAlive()) {
      healQueue.clear();
      return;
    }
    // 单飞：别的缓存（已拆除的、上一个用户的）那一场还没落定，等它落定、再歇一个间隔重判；
    // 它永远不落定时最多等一个看门狗，之后把它挪进 healAbandoned（让出闸照旧等它）再往下走
    const other = healInFlight;
    if (other) {
      healing = true;
      await waitForOtherHeal(other, healWatchdogMs);
      healing = false;
      scheduleHeal();
      return;
    }
    for (const id of healQueue) {
      healQueue.delete(id);
      const entry = cachedRows.get(id);
      if (mutations > 0 || listeners.size === 0 || optimistic.has(id) || !entry
        || healAttempted.has(id) || !storedOutcomeDiverges(entry)) continue;
      healAttempted.add(id);
      healing = true;
      // 静默：出错不重试（本缓存生命周期内），留给详情页或下一次会话。不与定时器赛跑：落定之前不排下一场
      const done = getCampaignFullData(id, { local: healLocalReader.read() }).then(() => undefined, () => undefined);
      const turn = { campaignId: id, startedAt: Date.now(), done };
      healInFlight = turn;
      await done;
      if (healInFlight === turn) healInFlight = null;
      healing = false;
      break;
    }
    scheduleHeal();
  }
  /** 读取完成 / 晚到的校正落地时调用：只做 O(行数) 的内存判断与入队。 */
  const queueDivergedCampaigns = () => {
    if (!healAlive()) return;
    for (const [id, entry] of cachedRows) {
      if (!healAttempted.has(id) && storedOutcomeDiverges(entry)) healQueue.add(id);
    }
    scheduleHeal();
  };

  /**
   * 晚到的校正落到条目上；提交快照与重判偏离攒到同一个微任务里。
   * 每一场各自落地是为了不被同批挂死的那一场拖住（见下面发起拉取的地方），不是为了把一次提交拆成上百次：
   * 同一轮里一起落定的几十上百场仍然只提交一次、只扫一遍偏离，订阅者不会被通知上百遍。
   */
  const correctionRows = new Map<string, CampaignCardData>();
  let correctionsLanded = false;
  let correctionFlushScheduled = false;
  const flushCorrections = () => {
    correctionFlushScheduled = false;
    if (correctionRows.size > 0) {
      const changed = new Map(correctionRows);
      correctionRows.clear();
      publish({ rows: snapshot.rows.map(row => changed.get(row.campaign.id) ?? row) });
    }
    if (correctionsLanded) {
      correctionsLanded = false;
      queueDivergedCampaigns();
    }
  };
  const applyCorrections = (details: CampaignDetails, result: LegExitPriceCorrectionsResult | null) => {
    correctionsLanded = true;
    if (!correctionFlushScheduled) {
      correctionFlushScheduled = true;
      queueMicrotask(flushCorrections);
    }
    if (!result) return;
    const { corrections, complete } = result;
    // 拉取期间条目可能被重建（本地重算）：校正输入没变就落在当前条目上。
    // 丢掉它的代价是这一场既不会重拉（退避挡着）也不会再判一次偏离，要等下一次读取才恢复。
    const entry = cachedRows.get(details.campaign.id);
    if (!entry || !sameCorrectionInputs(details, entry.details)) return;
    const previous = entry.corrections;
    entry.corrections = corrections;
    entry.correctionsComplete = complete;
    // 行是按上一份校正（没有就是空表）画的：校正没变（重拉到同样的一部分、或本来就无需校正）就不重画
    if (deepEqual(previous ?? {}, corrections)) return;
    const row = buildCampaignCardData(entry.details, corrections);
    if (deepEqual(entry.row, row)) return;
    entry.row = row;
    correctionRows.set(details.campaign.id, row);
  };

  async function load(kind: CampaignListRefreshKind) {
    const firstLoad = !snapshot.complete;
    const startRevision = revision;
    const remote = kind === 'remote' || remoteRows === null;
    let remoteError: string | null = null;
    if (remote) {
      remoteStartedAt = Date.now();
      publish({ refreshing: true, error: null });
    }
    try {
      if (remote) {
        fetchPending = true;
        try {
          remoteRows = await withTimeout(
            fetchCampaignSourceRows(userId, { previous: remoteRows ?? undefined }),
            remoteTimeoutMs,
          );
        } catch (error) {
          // 读失败不算「刚读过」：下一次焦点 / 联网立刻重读，不用等满一分钟
          remoteStartedAt = null;
          if (remoteRows === null) throw error;
          // 有上次的行：照样用最新的本地数据核对一遍（等远端期间的成交变化不能丢），失败留到最后提示
          remoteError = errorMessage(error);
        } finally {
          fetchPending = false;
        }
      }
      // 后台核对是从合并定时器 / 写入收尾里发起的：先让那个任务结束，读快照、装配、分组另起一个任务。
      // 首载的这一段本来就跑在网络回调之后的新任务里，不必再让。
      if (!firstLoad) await yieldToMainThread();
      // 快照要在远端读完后取，减少网络等待期间交易变化带来的陈旧窗口。
      const local = localReader.read(localInputs ?? undefined);
      const sources = assembleSources(remoteRows as CampaignSourceRows, local, remote);
      if (firstLoad) publish({ total: sources.length });
      for (const [symbol, group] of groupLocalBySymbol(local, sources.map(source => source.campaign.symbol))) {
        const previous = localGroups.get(symbol);
        if (previous && deepEqual(previous.group, group)) continue;
        localGroups.set(symbol, {
          group,
          version: (previous?.version ?? 0) + 1,
          diff: previous ? diffSymbolGroup(previous.group, group) : null,
        });
      }
      const recordsByKey = recordsByKeyOf(local.tradeHistory);
      const nextEntries: CachedRow[] = [];
      const nextCache = new Map<string, CachedRow>();
      const correctionsNeeded: CachedRow[] = [];
      let failedCount = 0;
      // 按时间分片让出主线程：首屏第一片一到就提交，之后每隔 publishMs 提交一次；后台核对静默、片更细。
      const slice = firstLoad ? sliceMs : Math.min(sliceMs, 16);
      if (!firstLoad) await yieldToMainThread();
      let sliceStart = now();
      let lastPublish = sliceStart;
      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        const { campaign, legs } = source;
        const crossRecords = crossSymbolRecords(recordsByKey, legs, campaign.symbol);
        const symbolState = localGroups.get(campaign.symbol);
        const localVersion = symbolState?.version ?? 0;
        const cached = cachedRows.get(campaign.id);
        let reusable = Boolean(cached)
          && (cached!.source === source || deepEqual(cached!.source, source))
          && deepEqual(cached!.crossRecords, crossRecords);
        if (reusable && cached!.localVersion !== localVersion) {
          // 本标的的本地数据变了，但这一场用到的那部分没变：不重算，只把版本记到最新
          reusable = cached!.localVersion === localVersion - 1
            && Boolean(symbolState?.diff)
            && !localChangeTouchesCampaign(cached!, symbolState!.diff!);
          if (reusable) cached!.localVersion = localVersion;
        }
        if (cached && reusable) {
          nextCache.set(campaign.id, cached);
          nextEntries.push(cached);
          // 上次没拉齐（或抛错）：输入没变也要重拉，否则一次 429 会让这一场整个会话停在未校正的数上；
          // 只是按退避来——远端核对、过了间隔（correctionRetries）
          if (!cached.correctionsComplete && !correctionsFetching(cached)
            && correctionRetryAllowed(campaign.id, remote)) correctionsNeeded.push(cached);
        } else {
          try {
            const details = await getCampaignFullData(campaign.id, { source, local, heal: false });
            // 平仓价校正输入没变：它是这些输入的确定函数，沿用——不会先跳回未校正的数再跳回来；
            // 只有拉齐了的才算定论，没拉齐的先照旧显示、再按退避重拉。输入变了（或没有旧条目）是新的问题，立即拉。
            const sameInputs = Boolean(cached) && sameCorrectionInputs(cached!.details, details);
            const corrections = sameInputs ? cached!.corrections : null;
            const correctionsComplete = sameInputs && cached!.correctionsComplete;
            let row = buildCampaignCardData(details, corrections ?? {});
            // 逐字段相同就沿用原对象：卡片与散点图不为一次无差别的重算重绘。
            if (cached && deepEqual(cached.row, row)) row = cached.row;
            const entry: CachedRow = { source, crossRecords, localVersion, details, corrections, correctionsComplete, row };
            nextCache.set(campaign.id, entry);
            nextEntries.push(entry);
            if (!correctionsComplete && !correctionsFetching(entry)
              && (!sameInputs || correctionRetryAllowed(campaign.id, remote))) {
              correctionsNeeded.push(entry);
            }
          } catch {
            failedCount += 1;
            // 更新失败的场次保留旧值，但不更新签名，下次重试仍会真正读取。
            if (cached) nextEntries.push(cached);
          }
        }
        const elapsedAt = now();
        if (elapsedAt - sliceStart >= slice && index + 1 < sources.length) {
          if (firstLoad && (snapshot.rows.length === 0 || elapsedAt - lastPublish >= publishMs)) {
            // 首载中途点了星 / 删了行：进度提交也要盖上乐观编辑，不能先闪回旧值、加载完再跳回来
            publish({ rows: applyOptimistic(rowsOf(nextEntries), startRevision).rows, loaded: index + 1, total: sources.length });
            lastPublish = elapsedAt;
          }
          await yieldToMainThread();
          sliceStart = now();
        }
      }
      const activeIds = new Set(sources.map(source => source.campaign.id));
      const { rows, overridden } = applyOptimistic(rowsOf(nextEntries), startRevision);
      for (const id of cachedRows.keys()) if (!activeIds.has(id)) cachedRows.delete(id);
      for (const [id, entry] of nextCache) if (!overridden.has(id)) cachedRows.set(id, entry);
      publish({
        rows: retainRowReferences(rows),
        complete: true, loaded: sources.length,
        total: sources.length, failedCount, error: remoteError,
      });
      queueDivergedCampaigns();

      // 不阻塞基础快照/下次刷新；过期校正由校正输入拦截，不能覆盖新编辑或复活已删战役。
      // 每一场各自落地：一个永不落定的 K 线请求只耽误它自己。它们曾经挂在同一个 Promise.all 上，
      // 于是同批的场次拿到的校正被一起丢掉、在飞槽位也一起不还，整个会话再也发不出第二次。
      for (const entry of correctionsNeeded) {
        const { details } = entry;
        const id = details.campaign.id;
        correctionsInFlight.set(id, details);
        void (async () => {
          let result: LegExitPriceCorrectionsResult | null = null;
          try {
            result = await fetchLegExitPriceCorrectionsResult(details.campaign.symbol, details.legs, details.tradeRecords);
          } catch {
            // 抛错与没拉齐同等对待：条目保持 correctionsComplete === false，按退避重拉
            result = null;
          } finally {
            // 校正输入变了、已由另一次拉取接手这个槽位：这一次作废，退避与落地都由接手的那次负责
            if (correctionsInFlight.get(id) === details) {
              correctionsInFlight.delete(id);
              // 退避按 id 记，一次拉取记一次：请求确实发出去了
              recordCorrectionOutcome(id, Boolean(result?.complete));
              applyCorrections(details, result);
            }
          }
        })();
      }
    } catch (error) {
      publish({ error: errorMessage(error) });
    } finally {
      if (remote) publish({ refreshing: false });
    }
  }

  function start(kind: CampaignListRefreshKind) {
    // 新一轮读取从现在开始、用最新数据，排队的请求由它一并覆盖；只是远端请求不能被本地核对吞掉。
    if (pending === 'remote') kind = 'remote';
    pending = null;
    inFlight = load(kind).finally(() => {
      inFlight = null;
      if (pending && mutations === 0) void start(pending);
    });
    return inFlight;
  }

  function refresh(kind: CampaignListRefreshKind = 'remote', options: CampaignListRefreshOptions = {}) {
    if (!userId) return Promise.resolve();
    // 页面给的内存数据先记下：哪怕这次请求被合并进正在进行的读取，它读快照时拿到的也是最新的
    if (options.local) localInputs = options.local;
    if (remoteRows === null) kind = 'remote';
    // 首次加载进行中的焦点事件同样算「刚读过」：不排队再读一遍。
    if (kind === 'remote' && options.maxAgeMs != null
      && remoteStartedAt !== null && Date.now() - remoteStartedAt < options.maxAgeMs) {
      return inFlight ?? Promise.resolve();
    }
    // 远端还没读回来：读回来的连同其后才取的本地快照都是最新的，跟着这次即可。
    if (inFlight && fetchPending) return inFlight;
    // 正在算或正在写：排一次，算完 / 写完接着做；远端请求优先级高于本地核对。
    if (inFlight || mutations > 0) {
      pending = pending === 'remote' ? 'remote' : kind;
      return inFlight ?? Promise.resolve();
    }
    return start(kind);
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh,
    /** 首次加载期间也允许操作；写入结束后以远端为准核对一次，正在进行的读取不受影响。 */
    beginMutation: () => {
      mutations += 1;
      let finished = false;
      return () => {
        if (finished) return;
        finished = true;
        mutations -= 1;
        if (mutations === 0) void refresh('remote');
      };
    },
    setRows: (update: CampaignCardData[] | ((rows: CampaignCardData[]) => CampaignCardData[])) => {
      const nextRows = typeof update === 'function' ? update(snapshot.rows) : update;
      revision += 1;
      const previousById = new Map(snapshot.rows.map(row => [row.campaign.id, row]));
      const byId = new Map(nextRows.map(row => [row.campaign.id, row]));
      // 变了的行记成乐观编辑：正在收尾的读取与晚到的价格校正都不能把它盖掉。
      for (const row of nextRows) {
        if (previousById.get(row.campaign.id) !== row) optimistic.set(row.campaign.id, { row, revision });
      }
      for (const id of previousById.keys()) {
        if (!byId.has(id)) optimistic.set(id, { row: null, revision });
      }
      for (const [id, cached] of cachedRows) {
        if (byId.get(id) !== cached.row) cachedRows.delete(id);
      }
      publish({ rows: nextRows });
    },
  };
}

const userCaches = new Map<string, ReturnType<typeof createCampaignListCache>>();

export function getCampaignListCache(userId: string) {
  activeUserId = userId;
  let cache = userCaches.get(userId);
  if (!cache) {
    cache = createCampaignListCache(userId);
    userCaches.set(userId, cache);
  }
  return cache;
}

/** 测试及会话管理可主动释放；普通路由往返不能清除此缓存。 */
export function clearCampaignListCaches() {
  userCaches.clear();
  cacheGeneration += 1;
  activeUserId = null;
}
