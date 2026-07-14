export const EXECUTION_DECISION_REWARD = 600;
/** 直接交易（未走决策模块）按「当日标的」去重后，每个标的扣的分。 */
export const EXECUTION_DIRECT_PENALTY = 600;
export const EXECUTION_NO_TRADE_PENALTY = 1000;
export const EXECUTION_CAMPAIGN_REWARD = 300;
export const EXECUTION_REVIEW_REWARD = 1000;
/** 当天交易过的标的若当天没为它新建战役，每个标的扣的分。 */
export const EXECUTION_CAMPAIGN_MISSING_PENALTY = 300;
/** 计分口径版本。旧状态(≤1)首次加载时会把历史事件按当前权重重算一次。 */
export const EXECUTION_SCORING_VERSION = 2;

export type ExecutionTradingMode = 'decision' | 'direct';

export type ExecutionAssetEventType =
  | 'decision_reward'
  | 'direct_reward'
  | 'no_trade_penalty'
  | 'campaign_reward'
  | 'campaign_missing_penalty'
  | 'review_reward';

export interface ExecutionTradeSnapshot {
  symbol: string;
  side: string;
  orderType: string;
  entryPrice: number;
  quantity: number;
  leverage: number;
  marginMode: string;
  settlementMode?: 'usdt' | 'coin';
  settlementAsset?: string;
  contractSizeUsd?: number;
  contracts?: number;
  marginCoin?: number | null;
  margin?: number | null;
  notional?: number | null;
  notionalUsd?: number | null;
  simulatedTime?: number | null;
  positionId?: string | null;
}

export interface ExecutionAssetEvent {
  id: string;
  type: ExecutionAssetEventType;
  points: number;
  date: string;
  createdAt: number;
  label: string;
  trade?: ExecutionTradeSnapshot | null;
  /** campaign_reward 事件归属的战役 ID，用于幂等与可追溯。 */
  campaignId?: string | null;
  /** review_reward 事件归属的 journal ID，用于幂等与可追溯。 */
  journalId?: string | null;
}

export interface ExecutionAssetState {
  points: number;
  decisionTradeCount: number;
  directTradeCount: number;
  campaignCount: number;
  reviewCount: number;
  penaltyDays: number;
  /** 缺战役扣分的「标的×日」笔数（用于展示）。 */
  campaignMissingCount: number;
  tradedDates: Record<string, true>;
  /** 每个自然日交易过的去重标的（决策/直接都记），供缺战役结算 + 直接交易按标的去重。 */
  tradedSymbolsByDate: Record<string, string[]>;
  /** 每个自然日已经扣过「直接交易」罚的标的，用于同标的当天只罚一次。 */
  directPenalizedByDate: Record<string, string[]>;
  lastDailyCheckDate: string | null;
  /** 「缺战役扣分」的独立结算游标，与未交易结算互不影响。 */
  lastCampaignCheckDate: string | null;
  events: ExecutionAssetEvent[];
  /** 已发过 +EXECUTION_CAMPAIGN_REWARD 的战役 ID，避免对账时重复加分。 */
  rewardedCampaignIds: string[];
  /** 已发过 +EXECUTION_REVIEW_REWARD 的平仓评价 journal ID，避免编辑评价时重复加分。 */
  rewardedReviewJournalIds: string[];
  /** 计分口径版本；缺省(旧状态)按 1 处理，触发一次历史重算迁移。 */
  scoringVersion?: number;
}

export interface CompletedExecutionReview {
  journalId: string;
  reviewedAt?: Date | number | string | null;
}

/** 权威战役列表里用于「当天是否为某标的建过战役」判定的最小信息。 */
export interface CampaignCreationRef {
  symbol: string;
  createdAt: Date | number | string | null;
}

/** 创建战役奖励对账所需的稳定标识与客观创建时间。 */
export interface CampaignRewardRef {
  id: string;
  createdAt?: Date | number | string | null;
}

export function createDefaultExecutionAssetState(today: Date = new Date()): ExecutionAssetState {
  return {
    points: 0,
    decisionTradeCount: 0,
    directTradeCount: 0,
    campaignCount: 0,
    reviewCount: 0,
    penaltyDays: 0,
    campaignMissingCount: 0,
    tradedDates: {},
    tradedSymbolsByDate: {},
    directPenalizedByDate: {},
    lastDailyCheckDate: localDateKey(today),
    lastCampaignCheckDate: localDateKey(today),
    events: [],
    rewardedCampaignIds: [],
    rewardedReviewJournalIds: [],
    scoringVersion: EXECUTION_SCORING_VERSION,
  };
}

export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(key: string, days: number): string {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function compareDateKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function eventId(type: ExecutionAssetEventType, date: string): string {
  return `${type}-${date}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pushEvent(state: ExecutionAssetState, event: ExecutionAssetEvent): ExecutionAssetEvent[] {
  return [event, ...(state.events ?? [])];
}

function normalizeState(state: ExecutionAssetState | null | undefined, today: Date = new Date()): ExecutionAssetState {
  const base = state ?? createDefaultExecutionAssetState(today);
  const events = Array.isArray(base.events) ? base.events : [];
  const reviewIdsFromEvents = events
    .filter(event => event.type === 'review_reward' && event.journalId)
    .map(event => event.journalId as string);
  const rewardedReviewJournalIds = Array.from(new Set([
    ...(Array.isArray(base.rewardedReviewJournalIds) ? base.rewardedReviewJournalIds : []),
    ...reviewIdsFromEvents,
  ]));
  return {
    points: Number.isFinite(base.points) ? base.points : 0,
    decisionTradeCount: Number.isFinite(base.decisionTradeCount) ? base.decisionTradeCount : 0,
    directTradeCount: Number.isFinite(base.directTradeCount) ? base.directTradeCount : 0,
    campaignCount: Number.isFinite(base.campaignCount) ? base.campaignCount : 0,
    reviewCount: Math.max(
      Number.isFinite(base.reviewCount) ? base.reviewCount : 0,
      rewardedReviewJournalIds.length,
    ),
    penaltyDays: Number.isFinite(base.penaltyDays) ? base.penaltyDays : 0,
    campaignMissingCount: Number.isFinite(base.campaignMissingCount) ? base.campaignMissingCount : 0,
    tradedDates: base.tradedDates ?? {},
    tradedSymbolsByDate: base.tradedSymbolsByDate ?? {},
    directPenalizedByDate: base.directPenalizedByDate ?? {},
    lastDailyCheckDate: base.lastDailyCheckDate ?? localDateKey(today),
    lastCampaignCheckDate: base.lastCampaignCheckDate ?? base.lastDailyCheckDate ?? localDateKey(today),
    events,
    rewardedCampaignIds: Array.isArray(base.rewardedCampaignIds) ? Array.from(new Set(base.rewardedCampaignIds)) : [],
    rewardedReviewJournalIds,
    scoringVersion: base.scoringVersion,
  };
}

export function settleNoTradePenalties(
  rawState: ExecutionAssetState,
  today: Date = new Date(),
): ExecutionAssetState {
  let state = normalizeState(rawState, today);
  const todayKey = localDateKey(today);
  const startKey = state.lastDailyCheckDate ?? todayKey;

  if (compareDateKeys(startKey, todayKey) >= 0) {
    return { ...state, lastDailyCheckDate: todayKey };
  }

  let cursor = startKey;
  while (compareDateKeys(cursor, todayKey) < 0) {
    if (!state.tradedDates[cursor]) {
      const event: ExecutionAssetEvent = {
        id: eventId('no_trade_penalty', cursor),
        type: 'no_trade_penalty',
        points: -EXECUTION_NO_TRADE_PENALTY,
        date: cursor,
        createdAt: today.getTime(),
        label: `${cursor} 未练习，执行力资产扣分`,
      };
      state = {
        ...state,
        points: state.points - EXECUTION_NO_TRADE_PENALTY,
        penaltyDays: state.penaltyDays + 1,
        events: pushEvent(state, event),
      };
    }
    cursor = addDays(cursor, 1);
  }

  return { ...state, lastDailyCheckDate: todayKey };
}

/**
 * 缺战役结算：某个已过去的自然日交易过的标的，若当天没有为它新建战役 → 每个标的 −EXECUTION_CAMPAIGN_MISSING_PENALTY。
 * 战役覆盖以权威 campaign 列表为准（symbol + created_at 落在当天），而非状态钩子，避免漏记造成永久误罚。
 * 走独立游标 lastCampaignCheckDate，只结算 < today 的自然日，一天只结算一次（永久、幂等）。
 */
export function settleCampaignMissingPenalties(
  rawState: ExecutionAssetState,
  campaigns: CampaignCreationRef[],
  today: Date = new Date(),
): ExecutionAssetState {
  let state = normalizeState(rawState, today);
  const todayKey = localDateKey(today);
  const startKey = state.lastCampaignCheckDate ?? todayKey;

  if (compareDateKeys(startKey, todayKey) >= 0) {
    return { ...state, lastCampaignCheckDate: todayKey };
  }

  // 「某日为某标的建过战役」的集合，供 O(1) 判定。
  const createdByDate = new Map<string, Set<string>>();
  for (const campaign of campaigns ?? []) {
    if (!campaign || !campaign.symbol) continue;
    const key = localDateKey(validEventDate(campaign.createdAt, today));
    const set = createdByDate.get(key) ?? new Set<string>();
    set.add(campaign.symbol);
    createdByDate.set(key, set);
  }

  let cursor = startKey;
  while (compareDateKeys(cursor, todayKey) < 0) {
    const traded = state.tradedSymbolsByDate[cursor] ?? [];
    if (traded.length > 0) {
      const created = createdByDate.get(cursor) ?? new Set<string>();
      for (const symbol of traded) {
        if (created.has(symbol)) continue;
        const event: ExecutionAssetEvent = {
          id: eventId('campaign_missing_penalty', cursor),
          type: 'campaign_missing_penalty',
          points: -EXECUTION_CAMPAIGN_MISSING_PENALTY,
          date: cursor,
          createdAt: today.getTime(),
          label: `${cursor} ${symbol} 未建战役，执行力资产扣分`,
        };
        state = {
          ...state,
          points: state.points - EXECUTION_CAMPAIGN_MISSING_PENALTY,
          campaignMissingCount: state.campaignMissingCount + 1,
          events: pushEvent(state, event),
        };
      }
    }
    cursor = addDays(cursor, 1);
  }

  return { ...state, lastCampaignCheckDate: todayKey };
}

export function recordExecutionTrade(
  rawState: ExecutionAssetState,
  mode: ExecutionTradingMode,
  today: Date = new Date(),
  trade?: ExecutionTradeSnapshot | null,
): ExecutionAssetState {
  const settled = settleNoTradePenalties(rawState, today);
  const date = localDateKey(today);
  const isDecision = mode === 'decision';
  const symbol = trade?.symbol ?? null;

  // 交易过的标的当天去重登记（供缺战役结算）；直接交易的按标的去重另用 directPenalizedByDate。
  const daySymbols = settled.tradedSymbolsByDate[date] ?? [];
  const nextDaySymbols = symbol && !daySymbols.includes(symbol) ? [...daySymbols, symbol] : daySymbols;

  const base: ExecutionAssetState = {
    ...settled,
    tradedDates: { ...settled.tradedDates, [date]: true },
    tradedSymbolsByDate: { ...settled.tradedSymbolsByDate, [date]: nextDaySymbols },
    lastDailyCheckDate: date,
  };

  // 决策记录交易：每笔都 +EXECUTION_DECISION_REWARD（不按标的去重）。
  if (isDecision) {
    const event: ExecutionAssetEvent = {
      id: eventId('decision_reward', date),
      type: 'decision_reward',
      points: EXECUTION_DECISION_REWARD,
      date,
      createdAt: today.getTime(),
      label: '决策记录交易奖励',
      trade: trade ?? null,
    };
    return {
      ...base,
      points: settled.points + EXECUTION_DECISION_REWARD,
      decisionTradeCount: settled.decisionTradeCount + 1,
      events: pushEvent(settled, event),
    };
  }

  // 直接交易：同一标的当天只扣一次 −EXECUTION_DIRECT_PENALTY；再次交易只算练习、不重复扣分。
  const penalizedToday = settled.directPenalizedByDate[date] ?? [];
  if (symbol != null && penalizedToday.includes(symbol)) {
    return base;
  }
  const event: ExecutionAssetEvent = {
    id: eventId('direct_reward', date),
    type: 'direct_reward',
    points: -EXECUTION_DIRECT_PENALTY,
    date,
    createdAt: today.getTime(),
    label: '直接交易扣分',
    trade: trade ?? null,
  };
  return {
    ...base,
    points: settled.points - EXECUTION_DIRECT_PENALTY,
    directTradeCount: settled.directTradeCount + 1,
    directPenalizedByDate: {
      ...settled.directPenalizedByDate,
      [date]: symbol != null ? [...penalizedToday, symbol] : penalizedToday,
    },
    events: pushEvent(settled, event),
  };
}

function campaignRewardEvent(campaignId: string | null, createdAt: Date): ExecutionAssetEvent {
  const date = localDateKey(createdAt);
  return {
    id: eventId('campaign_reward', date),
    type: 'campaign_reward',
    points: EXECUTION_CAMPAIGN_REWARD,
    date,
    createdAt: createdAt.getTime(),
    label: '创建交易战役奖励',
    campaignId,
  };
}

function normalizeCampaignRewardRefs(
  campaigns: Array<string | CampaignRewardRef>,
  fallback: Date,
): Array<{ id: string; createdAt: Date }> {
  const byId = new Map<string, { id: string; createdAt: Date }>();
  for (const campaign of campaigns) {
    const id = typeof campaign === 'string' ? campaign : campaign?.id;
    if (!id || byId.has(id)) continue;
    const rawCreatedAt = typeof campaign === 'string' ? null : campaign.createdAt;
    byId.set(id, { id, createdAt: validEventDate(rawCreatedAt, fallback) });
  }
  return [...byId.values()];
}

/**
 * 旧版 campaign_reward 只记录了加分时间，没有保存战役 ID。
 * 以同一自然日优先、客观创建时间最近为次序做一对一匹配；写回 ID 后，后续跳转不再依赖文字。
 */
function bindLegacyCampaignRewardEvents(
  events: ExecutionAssetEvent[],
  campaigns: Array<{ id: string; createdAt: Date }>,
  rewardedCampaignIds: string[],
): { events: ExecutionAssetEvent[]; changed: boolean } {
  const linkedIds = new Set(
    events
      .filter(event => event.type === 'campaign_reward' && event.campaignId)
      .map(event => event.campaignId as string),
  );
  const rewardedIds = new Set(rewardedCampaignIds);
  const preferred = campaigns.filter(campaign => rewardedIds.has(campaign.id) && !linkedIds.has(campaign.id));
  const fallback = campaigns.filter(campaign => !rewardedIds.has(campaign.id) && !linkedIds.has(campaign.id));
  const unbound = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === 'campaign_reward' && !event.campaignId)
    .sort((a, b) => a.event.createdAt - b.event.createdAt || a.index - b.index);

  if ((preferred.length === 0 && fallback.length === 0) || unbound.length === 0) {
    return { events, changed: false };
  }

  const assignments = new Map<number, string>();
  for (const { event, index } of unbound) {
    const available = preferred.length > 0 ? preferred : fallback;
    if (available.length === 0) break;
    const eventTime = Number.isFinite(event.createdAt)
      ? event.createdAt
      : new Date(`${event.date}T00:00:00+08:00`).getTime();
    const sameDayIndexes = available
      .map((campaign, candidateIndex) => ({ campaign, candidateIndex }))
      .filter(({ campaign }) => localDateKey(campaign.createdAt) === event.date);
    const candidates = sameDayIndexes.length > 0
      ? sameDayIndexes
      : available.map((campaign, candidateIndex) => ({ campaign, candidateIndex }));
    candidates.sort((a, b) => (
      Math.abs(a.campaign.createdAt.getTime() - eventTime)
      - Math.abs(b.campaign.createdAt.getTime() - eventTime)
      || a.campaign.createdAt.getTime() - b.campaign.createdAt.getTime()
      || a.campaign.id.localeCompare(b.campaign.id)
    ));
    const match = candidates[0];
    assignments.set(index, match.campaign.id);
    available.splice(match.candidateIndex, 1);
  }

  if (assignments.size === 0) return { events, changed: false };
  return {
    events: events.map((event, index) => (
      assignments.has(index) ? { ...event, campaignId: assignments.get(index) } : event
    )),
    changed: true,
  };
}

/**
 * 每创建一次交易战役 +EXECUTION_CAMPAIGN_REWARD 分。只加分、记一笔 campaign_reward 事件，
 * 不触碰每日「未交易扣分」逻辑（建战役不算当日交易，其余规则不变）。
 * 传入 campaignId 时按 ID 幂等：同一场战役只加一次（防止重复触发 / 与对账重复）。
 */
export function recordCampaignCreated(
  rawState: ExecutionAssetState,
  campaignId: string | null = null,
  today: Date = new Date(),
): ExecutionAssetState {
  const state = normalizeState(rawState, today);
  if (campaignId && state.rewardedCampaignIds.includes(campaignId)) return state;
  return {
    ...state,
    points: state.points + EXECUTION_CAMPAIGN_REWARD,
    campaignCount: state.campaignCount + 1,
    rewardedCampaignIds: campaignId ? [...state.rewardedCampaignIds, campaignId] : state.rewardedCampaignIds,
    events: pushEvent(state, campaignRewardEvent(campaignId, today)),
  };
}

/**
 * 用用户实际拥有的战役 ID + 创建时间对账，自愈任何漏记的 +EXECUTION_CAMPAIGN_REWARD：
 * 每个还没奖励过的战役补一笔，幂等（已奖励的不再加）。
 * 历史上通过事件计过分但未记 ID 的（campaignCount > 已记 ID 数），按数量补种为已奖励，避免重复加分。
 * 旧版无 ID 的奖励流水会按客观创建时间绑定到战役，之后永久按 ID 跳转。
 * 在执行力资产页加载时调用即可，让「建战役」积分始终等于真实战役数。
 */
export function reconcileCampaignRewards(
  rawState: ExecutionAssetState,
  campaigns: Array<string | CampaignRewardRef>,
  today: Date = new Date(),
): ExecutionAssetState {
  const normalized = normalizeState(rawState, today);
  const campaignRefs = normalizeCampaignRewardRefs(campaigns, today);
  const legacyBinding = bindLegacyCampaignRewardEvents(
    normalized.events,
    campaignRefs,
    normalized.rewardedCampaignIds,
  );
  const state = legacyBinding.changed ? { ...normalized, events: legacyBinding.events } : normalized;
  const eventCampaignIds = state.events
    .filter(event => event.type === 'campaign_reward' && event.campaignId)
    .map(event => event.campaignId as string);
  const known = new Set([...state.rewardedCampaignIds, ...eventCampaignIds]);
  const untrackedRewarded = Math.max(0, state.campaignCount - known.size);
  const candidates = campaignRefs.filter(campaign => !known.has(campaign.id));
  // 旧版只计了数没记 ID 的那部分，先按数量补种为已奖励，绝不重复加分。
  for (const campaign of candidates.slice(0, untrackedRewarded)) known.add(campaign.id);
  const toAward = candidates.slice(untrackedRewarded);

  if (toAward.length === 0) {
    const nextCount = Math.max(state.campaignCount, known.size);
    if (
      !legacyBinding.changed
      && known.size === state.rewardedCampaignIds.length
      && nextCount === state.campaignCount
    ) return state;
    return { ...state, campaignCount: nextCount, rewardedCampaignIds: [...known] };
  }

  const events: ExecutionAssetEvent[] = [];
  for (const campaign of toAward) {
    known.add(campaign.id);
    events.push(campaignRewardEvent(campaign.id, campaign.createdAt));
  }
  return {
    ...state,
    points: state.points + EXECUTION_CAMPAIGN_REWARD * toAward.length,
    campaignCount: Math.max(state.campaignCount, known.size),
    rewardedCampaignIds: [...known],
    events: [...events, ...state.events],
  };
}

function validEventDate(value: Date | number | string | null | undefined, fallback: Date): Date {
  const date = value instanceof Date ? value : value == null ? fallback : new Date(value);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

function reviewRewardEvent(journalId: string, reviewedAt: Date): ExecutionAssetEvent {
  const date = localDateKey(reviewedAt);
  return {
    id: eventId('review_reward', date),
    type: 'review_reward',
    points: EXECUTION_REVIEW_REWARD,
    date,
    createdAt: reviewedAt.getTime(),
    label: '完成平仓评价奖励',
    journalId,
  };
}

/**
 * 完成一笔平仓评价 +EXECUTION_REVIEW_REWARD；同一个 journal 无论后续编辑多少次都只奖励一次。
 * 完成复盘 = 当天有练习：给评价当天打上练习标记，从而清掉当天的「未交易 −1000」（Option A）。
 * 只有这条实时路径打练习标记；对账 reconcile 绝不打标（守「永久不回填」）。
 */
export function recordPostTradeReviewCompleted(
  rawState: ExecutionAssetState,
  journalId: string,
  reviewedAt: Date | number | string | null = new Date(),
): ExecutionAssetState {
  const completedAt = validEventDate(reviewedAt, new Date());
  const state = normalizeState(rawState, completedAt);
  if (!journalId || state.rewardedReviewJournalIds.includes(journalId)) return state;
  const date = localDateKey(completedAt);
  return {
    ...state,
    points: state.points + EXECUTION_REVIEW_REWARD,
    reviewCount: state.reviewCount + 1,
    tradedDates: { ...state.tradedDates, [date]: true },
    rewardedReviewJournalIds: [...state.rewardedReviewJournalIds, journalId],
    events: pushEvent(state, reviewRewardEvent(journalId, completedAt)),
  };
}

/**
 * 弃单 / 空仓观察 = 当天有练习：给当天打练习标记，从而清掉「未交易 −1000」（Option A）。
 * 不加分、不登记交易标的、不涉及战役——它就是「到场了、分析了、纪律性地决定不下场」。
 */
export function recordPracticeLogged(
  rawState: ExecutionAssetState,
  today: Date = new Date(),
): ExecutionAssetState {
  const state = normalizeState(rawState, today);
  const date = localDateKey(today);
  if (state.tradedDates[date]) return state;
  return {
    ...state,
    tradedDates: { ...state.tradedDates, [date]: true },
  };
}

/**
 * 用数据库中已完成的平仓评价对账，给历史漏记记录补 +EXECUTION_REVIEW_REWARD。
 * journal ID 是唯一凭证，评价文字后续修改不会影响奖励归属，也不会重复计分。
 * 注意：对账绝不打「练习标记」，以免回填历史某天、变相撤销已成立的未交易扣分。
 */
export function reconcilePostTradeReviewRewards(
  rawState: ExecutionAssetState,
  reviews: CompletedExecutionReview[],
  today: Date = new Date(),
): ExecutionAssetState {
  const state = normalizeState(rawState, today);
  const known = new Set(state.rewardedReviewJournalIds);
  const untrackedRewarded = Math.max(0, state.reviewCount - known.size);
  const uniqueReviews = Array.from(
    new Map(reviews.filter(review => review.journalId).map(review => [review.journalId, review])).values(),
  );
  const candidates = uniqueReviews.filter(review => !known.has(review.journalId));

  for (const review of candidates.slice(0, untrackedRewarded)) known.add(review.journalId);
  const toAward = candidates.slice(untrackedRewarded);

  if (toAward.length === 0) {
    const nextCount = Math.max(state.reviewCount, known.size);
    if (known.size === state.rewardedReviewJournalIds.length && nextCount === state.reviewCount) return state;
    return { ...state, reviewCount: nextCount, rewardedReviewJournalIds: [...known] };
  }

  const events = toAward
    .map(review => reviewRewardEvent(review.journalId, validEventDate(review.reviewedAt, today)))
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const review of toAward) known.add(review.journalId);

  return {
    ...state,
    points: state.points + EXECUTION_REVIEW_REWARD * toAward.length,
    reviewCount: Math.max(state.reviewCount, known.size),
    rewardedReviewJournalIds: [...known],
    events: [...events, ...state.events],
  };
}

export function executionTradeCount(state: ExecutionAssetState): number {
  return (state.decisionTradeCount ?? 0) + (state.directTradeCount ?? 0);
}

/**
 * 历史重算迁移(v1 → v2):把旧权重下记录的历史事件按当前权重重新定价、并重算总分。
 *   复盘 +1000 · 决策 +600 · 建战役 +300 · 未练习 −1000 · 缺战役 −300
 *   直接交易：从「每一笔订单」改为「每当日标的一笔 −600」——同一标的当天多笔,只保留最早一笔扣分、其余置 0。
 * 「缺战役 −300」是新规,只从新数据起算、不追溯(用户定:只重算已有类型)。
 * 靠 `scoringVersion` 幂等,只在旧状态首次加载时跑一次;每次点数变动本就配一条事件,故 Σevent = 总分,可从事件流重建。
 */
export function migrateExecutionAssetScoringV2(rawState: ExecutionAssetState): ExecutionAssetState {
  const state = normalizeState(rawState);
  if ((state.scoringVersion ?? 1) >= EXECUTION_SCORING_VERSION) {
    return state.scoringVersion === EXECUTION_SCORING_VERSION ? state : { ...state, scoringVersion: EXECUTION_SCORING_VERSION };
  }

  const seenDirect = new Set<string>(); // `${date}|${symbol}`：当日该标的是否已计过直接交易罚
  let points = 0;
  let directTradeCount = 0;

  // events 是「新在前」；按时间正序遍历以对直接交易「保留当日该标的最早一笔」。
  const repriced = [...state.events].reverse().map(event => {
    switch (event.type) {
      case 'decision_reward':
        points += EXECUTION_DECISION_REWARD;
        return { ...event, points: EXECUTION_DECISION_REWARD };
      case 'campaign_reward':
        points += EXECUTION_CAMPAIGN_REWARD;
        return { ...event, points: EXECUTION_CAMPAIGN_REWARD };
      case 'review_reward':
        points += EXECUTION_REVIEW_REWARD;
        return { ...event, points: EXECUTION_REVIEW_REWARD };
      case 'no_trade_penalty':
        points -= EXECUTION_NO_TRADE_PENALTY;
        return { ...event, points: -EXECUTION_NO_TRADE_PENALTY };
      case 'campaign_missing_penalty':
        points -= EXECUTION_CAMPAIGN_MISSING_PENALTY;
        return { ...event, points: -EXECUTION_CAMPAIGN_MISSING_PENALTY };
      case 'direct_reward': {
        const key = `${event.date}|${event.trade?.symbol ?? '__nosym__'}`;
        // 同标的当天多笔并作一笔：丢弃重复,只留最早那笔扣 −EXECUTION_DIRECT_PENALTY(流水每条=一次计分动作)。
        if (seenDirect.has(key)) return null;
        seenDirect.add(key);
        directTradeCount += 1;
        points -= EXECUTION_DIRECT_PENALTY;
        return { ...event, points: -EXECUTION_DIRECT_PENALTY, label: '直接交易扣分' };
      }
      default:
        points += event.points;
        return event;
    }
  }).filter(Boolean).reverse() as ExecutionAssetEvent[]; // 去掉被并笔的重复,复原「新在前」

  return {
    ...state,
    points,
    directTradeCount,
    events: repriced,
    scoringVersion: EXECUTION_SCORING_VERSION,
  };
}
