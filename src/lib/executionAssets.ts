export const EXECUTION_DECISION_REWARD = 999;
export const EXECUTION_DIRECT_REWARD = 99;
export const EXECUTION_NO_TRADE_PENALTY = 500;
export const EXECUTION_CAMPAIGN_REWARD = 1500;
export const EXECUTION_REVIEW_REWARD = 666;

export type ExecutionTradingMode = 'decision' | 'direct';

export type ExecutionAssetEventType =
  | 'decision_reward'
  | 'direct_reward'
  | 'no_trade_penalty'
  | 'campaign_reward'
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
  tradedDates: Record<string, true>;
  lastDailyCheckDate: string | null;
  events: ExecutionAssetEvent[];
  /** 已发过 +1500 的战役 ID，避免对账时重复加分。 */
  rewardedCampaignIds: string[];
  /** 已发过 +666 的平仓评价 journal ID，避免编辑评价时重复加分。 */
  rewardedReviewJournalIds: string[];
}

export interface CompletedExecutionReview {
  journalId: string;
  reviewedAt?: Date | number | string | null;
}

export function createDefaultExecutionAssetState(today: Date = new Date()): ExecutionAssetState {
  return {
    points: 0,
    decisionTradeCount: 0,
    directTradeCount: 0,
    campaignCount: 0,
    reviewCount: 0,
    penaltyDays: 0,
    tradedDates: {},
    lastDailyCheckDate: localDateKey(today),
    events: [],
    rewardedCampaignIds: [],
    rewardedReviewJournalIds: [],
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
    tradedDates: base.tradedDates ?? {},
    lastDailyCheckDate: base.lastDailyCheckDate ?? localDateKey(today),
    events,
    rewardedCampaignIds: Array.isArray(base.rewardedCampaignIds) ? Array.from(new Set(base.rewardedCampaignIds)) : [],
    rewardedReviewJournalIds,
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
        label: `${cursor} 未交易，执行力资产扣分`,
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

export function recordExecutionTrade(
  rawState: ExecutionAssetState,
  mode: ExecutionTradingMode,
  today: Date = new Date(),
  trade?: ExecutionTradeSnapshot | null,
): ExecutionAssetState {
  const settled = settleNoTradePenalties(rawState, today);
  const date = localDateKey(today);
  const isDecision = mode === 'decision';
  const points = isDecision ? EXECUTION_DECISION_REWARD : EXECUTION_DIRECT_REWARD;
  const type: ExecutionAssetEventType = isDecision ? 'decision_reward' : 'direct_reward';
  const event: ExecutionAssetEvent = {
    id: eventId(type, date),
    type,
    points,
    date,
    createdAt: today.getTime(),
    label: isDecision ? '决策记录交易奖励' : '直接交易奖励',
    trade: trade ?? null,
  };

  return {
    ...settled,
    points: settled.points + points,
    decisionTradeCount: settled.decisionTradeCount + (isDecision ? 1 : 0),
    directTradeCount: settled.directTradeCount + (isDecision ? 0 : 1),
    tradedDates: { ...settled.tradedDates, [date]: true },
    lastDailyCheckDate: date,
    events: pushEvent(settled, event),
  };
}

function campaignRewardEvent(campaignId: string | null, today: Date): ExecutionAssetEvent {
  const date = localDateKey(today);
  return {
    id: eventId('campaign_reward', date),
    type: 'campaign_reward',
    points: EXECUTION_CAMPAIGN_REWARD,
    date,
    createdAt: today.getTime(),
    label: '创建交易战役奖励',
    campaignId,
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
 * 用「用户实际拥有的战役 ID 列表」对账，自愈任何漏记的 +1500：
 * 每个还没奖励过的战役补一笔，幂等（已奖励的不再加）。
 * 历史上通过事件计过分但未记 ID 的（campaignCount > 已记 ID 数），按数量补种为已奖励，避免重复加分。
 * 在执行力资产页加载时调用即可，让「建战役」积分始终等于真实战役数。
 */
export function reconcileCampaignRewards(
  rawState: ExecutionAssetState,
  campaignIds: string[],
  today: Date = new Date(),
): ExecutionAssetState {
  const state = normalizeState(rawState, today);
  const known = new Set(state.rewardedCampaignIds);
  const untrackedRewarded = Math.max(0, state.campaignCount - known.size);
  const uniqueCampaignIds = Array.from(new Set(campaignIds.filter(Boolean)));
  const candidates = uniqueCampaignIds.filter(id => !known.has(id));
  // 旧版只计了数没记 ID 的那部分，先按数量补种为已奖励，绝不重复加分。
  for (const id of candidates.slice(0, untrackedRewarded)) known.add(id);
  const toAward = candidates.slice(untrackedRewarded);

  if (toAward.length === 0) {
    const nextCount = Math.max(state.campaignCount, known.size);
    if (known.size === state.rewardedCampaignIds.length && nextCount === state.campaignCount) return state;
    return { ...state, campaignCount: nextCount, rewardedCampaignIds: [...known] };
  }

  const events: ExecutionAssetEvent[] = [];
  for (const id of toAward) {
    known.add(id);
    events.push(campaignRewardEvent(id, today));
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

/** 完成一笔平仓评价 +666；同一个 journal 无论后续编辑多少次都只奖励一次。 */
export function recordPostTradeReviewCompleted(
  rawState: ExecutionAssetState,
  journalId: string,
  reviewedAt: Date | number | string | null = new Date(),
): ExecutionAssetState {
  const completedAt = validEventDate(reviewedAt, new Date());
  const state = normalizeState(rawState, completedAt);
  if (!journalId || state.rewardedReviewJournalIds.includes(journalId)) return state;
  return {
    ...state,
    points: state.points + EXECUTION_REVIEW_REWARD,
    reviewCount: state.reviewCount + 1,
    rewardedReviewJournalIds: [...state.rewardedReviewJournalIds, journalId],
    events: pushEvent(state, reviewRewardEvent(journalId, completedAt)),
  };
}

/**
 * 用数据库中已完成的平仓评价对账，给历史漏记记录补 +666。
 * journal ID 是唯一凭证，评价文字后续修改不会影响奖励归属，也不会重复计分。
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
