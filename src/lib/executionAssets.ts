export const EXECUTION_DECISION_REWARD = 999;
export const EXECUTION_DIRECT_REWARD = 99;
export const EXECUTION_NO_TRADE_PENALTY = 500;

export type ExecutionTradingMode = 'decision' | 'direct';

export type ExecutionAssetEventType = 'decision_reward' | 'direct_reward' | 'no_trade_penalty';

export interface ExecutionTradeSnapshot {
  symbol: string;
  side: string;
  orderType: string;
  entryPrice: number;
  quantity: number;
  leverage: number;
  marginMode: string;
  margin?: number | null;
  notional?: number | null;
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
}

export interface ExecutionAssetState {
  points: number;
  decisionTradeCount: number;
  directTradeCount: number;
  penaltyDays: number;
  tradedDates: Record<string, true>;
  lastDailyCheckDate: string | null;
  events: ExecutionAssetEvent[];
}

export function createDefaultExecutionAssetState(today: Date = new Date()): ExecutionAssetState {
  return {
    points: 0,
    decisionTradeCount: 0,
    directTradeCount: 0,
    penaltyDays: 0,
    tradedDates: {},
    lastDailyCheckDate: localDateKey(today),
    events: [],
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
  return {
    points: Number.isFinite(base.points) ? base.points : 0,
    decisionTradeCount: Number.isFinite(base.decisionTradeCount) ? base.decisionTradeCount : 0,
    directTradeCount: Number.isFinite(base.directTradeCount) ? base.directTradeCount : 0,
    penaltyDays: Number.isFinite(base.penaltyDays) ? base.penaltyDays : 0,
    tradedDates: base.tradedDates ?? {},
    lastDailyCheckDate: base.lastDailyCheckDate ?? localDateKey(today),
    events: Array.isArray(base.events) ? base.events : [],
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

export function executionTradeCount(state: ExecutionAssetState): number {
  return (state.decisionTradeCount ?? 0) + (state.directTradeCount ?? 0);
}
