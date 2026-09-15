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
  type CampaignRealizedPnl,
} from '@/lib/campaignRealizedPnl';
import { resolveCampaignOpportunityQuality } from '@/lib/campaignMetrics';
import { fetchLegExitPriceCorrections, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';
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
  /** null = 还没取到（或上次取失败），下次重算这一场时再取。 */
  corrections: LegExitPriceCorrections | null;
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

export interface CampaignListCacheOptions {
  /** 连续计算多久让出一次主线程。 */
  sliceMs?: number;
  /** 首次加载期间至少隔多久才向页面提交一次进度：每次提交都会重排已有卡片。 */
  publishMs?: number;
  /** 远端读取多久没回应算失败。 */
  remoteTimeoutMs?: number;
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
 */
export function createCampaignListCache(userId: string, options: CampaignListCacheOptions = {}) {
  const sliceMs = options.sliceMs ?? 40;
  const publishMs = options.publishMs ?? 200;
  const remoteTimeoutMs = options.remoteTimeoutMs ?? CAMPAIGN_LIST_REMOTE_TIMEOUT_MS;
  let snapshot: CampaignListSnapshot = {
    rows: [], complete: false, refreshing: false, loaded: 0, total: 0, failedCount: 0, error: null,
  };
  const listeners = new Set<() => void>();
  const cachedRows = new Map<string, CachedRow>();
  const localGroups = new Map<string, SymbolLocalState>();
  const optimistic = new Map<string, OptimisticEntry>();
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
        } else {
          try {
            const details = await getCampaignFullData(campaign.id, { source, local, heal: false });
            // 腿与成交都没变：平仓价校正是它们的确定函数，沿用——不再取一次，也不会先跳回未校正的数再跳回来。
            const corrections = cached?.corrections
              && deepEqual(cached.details.legs, details.legs)
              && deepEqual(cached.details.tradeRecords, details.tradeRecords)
              ? cached.corrections
              : null;
            let row = buildCampaignCardData(details, corrections ?? {});
            // 逐字段相同就沿用原对象：卡片与散点图不为一次无差别的重算重绘。
            if (cached && deepEqual(cached.row, row)) row = cached.row;
            const entry: CachedRow = { source, crossRecords, localVersion, details, corrections, row };
            nextCache.set(campaign.id, entry);
            nextEntries.push(entry);
            if (!corrections) correctionsNeeded.push(entry);
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

      // 不阻塞基础快照/下次刷新；过期校正由缓存条目身份拦截，不能覆盖新编辑或复活已删战役。
      void Promise.all(correctionsNeeded.map(async entry => {
        try {
          const { details } = entry;
          return { entry, corrections: await fetchLegExitPriceCorrections(details.campaign.symbol, details.legs, details.tradeRecords) };
        } catch {
          return null;
        }
      })).then(results => {
        const changed = new Map<string, CampaignCardData>();
        for (const result of results) {
          if (!result) continue;
          const { entry, corrections } = result;
          const id = entry.details.campaign.id;
          if (cachedRows.get(id) !== entry) continue;
          entry.corrections = corrections;
          if (Object.keys(corrections).length === 0) continue;
          entry.row = buildCampaignCardData(entry.details, corrections);
          changed.set(id, entry.row);
        }
        if (changed.size > 0) publish({ rows: snapshot.rows.map(row => changed.get(row.campaign.id) ?? row) });
      });
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
}
