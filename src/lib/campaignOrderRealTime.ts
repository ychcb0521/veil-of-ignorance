/**
 * 委托单按**真实时间**归属战役。
 *
 * 事故：WLDUSDT 2026-05-26 一场战役的委托列表里混进了另一场的委托。
 * 病根是归属只看**模拟时间**：这是个时间机器，同一段历史行情可以回放两次，
 * 两次的委托在模拟时间轴上完全重合，按「委托时间落在 [开主力−5min, 平仓]」判，
 * 两场的单子全部合格。
 *
 * 用户给出的判据：**真实操作时间不可能重叠**——人一次只能做一件事，两次回放
 * 必然发生在不同的现实时刻。于是在模拟窗口之上再加一道：委托的真实创建时刻
 * 必须落在本场已选中成交的真实时间区间内。
 *
 * 两道过滤缺一不可：只用真实时间，同一次会话里连着做两场同标的战役会互相混进；
 * 只用模拟时间，两次回放会互相混进。两者相与，才同时排除这两种情形。
 *
 * 老数据（委托没有 createdRealAt、成交没有 openedRealAt）退回今天的行为：
 * 拿不到证据就不做判断，绝不因为字段缺失而把合法委托踢掉。
 */

import { MAX_SIMULATION_SPEED } from '@/lib/simulationSpeeds';

export interface RealTimeWindow {
  /** 含前置回看：允许开主力前几分钟先挂好的对冲单。 */
  start: number;
  /** 进行中的战役为 +Infinity。 */
  end: number;
}

/**
 * 与模拟时间归属同一口径（PRE_MAIN_LOOKBACK_MS = 5 分钟）：
 * 前置对冲在真实时间里也是开主力前几秒到几分钟挂出的。
 * 两次回放之间的现实间隔通常是小时级以上，5 分钟不会把另一场放进来。
 */
export const REAL_TIME_LOOKBACK_MS = 5 * 60_000;

/**
 * 只有实时「记录决策」的腿（source === 'live'），pre_real_time 才是真下单前的现实时刻；
 * 回填的腿（retroactive_from_record）那一栏写的是**归类那一刻**，不能当下界。
 * 与 objectiveOperationTime 的既有约定一致：白名单，将来新增来源默认不信。
 */
const LIVE_SOURCE = 'live';

interface RecordLike {
  openedRealAt?: number | null;
  closedRealAt?: number | null;
}

interface LegLike {
  pre_real_time?: string | null;
  post_real_close_time?: string | null;
  source?: string | null;
}

const finitePositive = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

const parseIso = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const ms = new Date(v).getTime();
  return finitePositive(ms) ? ms : null;
};

/**
 * 从本场已选中的成交与腿里，框出这场战役在现实里发生的时间区间。
 * 拿不到任何真实开仓证据时返回 null——调用方据此退回模拟窗口，不做真实时间过滤。
 */
export function campaignRealTimeWindow(input: {
  tradeRecords: RecordLike[];
  legs: LegLike[];
  campaignClosed: boolean;
}): RealTimeWindow | null {
  const starts: number[] = [];
  const ends: number[] = [];

  for (const r of input.tradeRecords) {
    if (finitePositive(r.openedRealAt)) starts.push(r.openedRealAt);
    if (finitePositive(r.closedRealAt)) ends.push(r.closedRealAt);
  }
  for (const leg of input.legs) {
    if (leg.source === LIVE_SOURCE) {
      const t = parseIso(leg.pre_real_time);
      if (t != null) starts.push(t);
    }
    const c = parseIso(leg.post_real_close_time);
    if (c != null) ends.push(c);
  }

  if (starts.length === 0) return null;

  const start = Math.min(...starts) - REAL_TIME_LOOKBACK_MS;
  // 进行中：上界开放。已结束但没有任何真实平仓证据：同样开放，宁可多收不可误踢。
  const end = input.campaignClosed && ends.length > 0
    ? Math.max(...ends, ...starts)
    : Number.POSITIVE_INFINITY;
  return { start, end };
}

/**
 * 一张委托是否与本场的真实时间一致。
 * 窗口为 null（没证据）或委托没有真实时刻（老数据）→ 一律放行，退回模拟窗口的判断。
 */
export function orderWithinRealWindow(
  createdRealAt: number | null | undefined,
  window: RealTimeWindow | null,
): boolean {
  if (window == null) return true;
  if (!finitePositive(createdRealAt)) return true;
  return createdRealAt >= window.start && createdRealAt <= window.end;
}

/**
 * 与本场的**操作时间**对齐到同一次回放。
 *
 * campaignRealTimeWindow 只有拿到 openedRealAt（或实时腿的 pre_real_time）才起作用。
 * 回填腿 + 老成交只有 closedRealAt——也就是界面上每条腿的「操作」时间——窗口就是 null，
 * orderWithinRealWindow 一律放行，真实时间过滤整个失效：同一段行情**另一次回放**的委托
 * 在模拟时间上与本场完全重合，于是成对混进盘面（TUTUSDT 2026-08-07：同一分钟、同一价格各出现两次）。
 *
 * 判据不需要猜会话有多长：同一次回放里，现实时间往前走，模拟时间也只往前走；
 * 同一段历史被再回放一次时，模拟时间会**跳回去**，而现实时间照常往前。这一跳就是分界。
 * 把这个标的上所有带真实时刻的事件（委托的挂 / 撤 / 成交，成交记录的开 / 平）按现实时间排好，
 * 在模拟时间明显回落、且现实里并非同时发生处切开，只保留**含本场已选成交操作**的那几段。
 *
 * 与模拟窗口、campaignRealTimeWindow 相与使用：
 *   - 模拟窗口分开同一次回放里前后相继的两场战役；
 *   - 本过滤分开两次回放同一段行情；
 *   - 同一次回放里若为了重做而把时间机器倒回去，含本场成交的每一段都保留，
 *     倒回之前挂了又被放弃的那条时间线上的委托不再算进本场。
 */
export const REPLAY_SIM_DROP_TOLERANCE_MS = 60_000;

/**
 * 同一次回放里，模拟时刻在落库顺序上也会**看起来**往回走：委托的 createdAt 读 React state 里的模拟时钟
 * （约 250ms 真实时间才刷新一次，3600 倍下能落后 15 个模拟分钟），而紧挨着的成交按撮合时钟现算。
 * 这种回落只可能出现在现实里几乎同时发生的两件事之间——时钟落后多久，就只能在多短的现实间隔里造成回落。
 *
 * 所以回落的「噪声上限」随现实间隔收窄：MAX_SIMULATION_SPEED × max(0, 预算 − 现实间隔)。
 * 两件事在现实里隔开几秒以上，任何超过 1 分钟的模拟回落都只能是时间机器被倒回去了——
 * 哪怕只倒回 20 分钟重打一场 1 分钟级的短线，也能分开；固定的大容差做不到这一点。
 * 预算给 5 秒，是 250ms 刷新节拍的 20 倍，留足主线程卡顿的余量。
 */
export const REPLAY_CLOCK_LAG_BUDGET_MS = 5_000;

function isReplayBreak(simDropMs: number, realGapMs: number, toleranceMs: number): boolean {
  if (simDropMs <= toleranceMs) return false;
  const clockLagNoiseMs = MAX_SIMULATION_SPEED * Math.max(0, REPLAY_CLOCK_LAG_BUDGET_MS - realGapMs);
  return simDropMs > clockLagNoiseMs;
}

export interface ReplayEvent {
  /** 真实钱包时钟（Date.now()）。 */
  realAt: number;
  /** 模拟 K 线时钟。 */
  simAt: number;
  /** 本场自己的操作（已选中成交的开 / 平）：它所在的那次回放就是本场。 */
  anchor?: boolean;
}

export interface ReplaySessionFilter {
  /** 该真实时刻是否落在本场所在的回放里。没有真实时刻（老数据）一律放行，不因缺字段误踢。 */
  allows: (realAt: number | null | undefined) => boolean;
  /** 识别出的回放段数（含不属于本场的），供排查。 */
  sessionCount: number;
}

export function buildReplaySessionFilter(
  events: ReplayEvent[],
  toleranceMs = REPLAY_SIM_DROP_TOLERANCE_MS,
): ReplaySessionFilter | null {
  const points = events
    .filter(event => finitePositive(event.realAt) && finitePositive(event.simAt))
    .sort((a, b) => a.realAt - b.realAt || a.simAt - b.simAt);
  // 本场自己的操作一个带真实时刻的都没有：拿不到证据就不判断
  if (!points.some(point => point.anchor)) return null;

  const sessions: { start: number; end: number; maxSim: number; anchored: boolean }[] = [];
  for (const point of points) {
    const current = sessions[sessions.length - 1];
    // 与这一段已经走到的最远模拟时刻比，而不是与上一个点比：事件落库顺序的小抖动不该切段；
    // 现实间隔取与这一段最后一个事件之间的距离（见 isReplayBreak）
    if (current && !isReplayBreak(current.maxSim - point.simAt, point.realAt - current.end, toleranceMs)) {
      current.end = point.realAt;
      current.maxSim = Math.max(current.maxSim, point.simAt);
      current.anchored = current.anchored || Boolean(point.anchor);
    } else {
      sessions.push({ start: point.realAt, end: point.realAt, maxSim: point.simAt, anchored: Boolean(point.anchor) });
    }
  }

  const kept = sessions.filter(session => session.anchored);
  return {
    sessionCount: sessions.length,
    allows: realAt => {
      if (!finitePositive(realAt)) return true;
      return kept.some(session => realAt >= session.start && realAt <= session.end);
    },
  };
}
