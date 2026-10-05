/** Only explicit replay controls may carry an existing order into an earlier era. */
export function replayEventIsAfterOrigin(at: number, origin: number, direction: 1 | -1): boolean {
  if (!Number.isFinite(at) || !Number.isFinite(origin) || at <= 0 || origin <= 0) return false;
  return direction === 1 ? at >= origin : at <= origin;
}

/** 回放时间线节点里判定时序要读的那几项（lib/replayTimeline 的 ReplayTimelineNode 天然满足）。 */
export interface ReplayExecutionTimeline {
  id: string;
  cause: 'bootstrap' | 'start' | 'jump' | 'direction' | 'implicit';
  direction: 1 | -1;
  forkSimTime: number;
  carried?: Record<string, { positionIds?: string[]; fillIds?: string[]; orderIds?: string[] } | undefined> | null;
}

/** 用户亲手做的时间操作：开始、跳转、翻转方向。bootstrap（补根）与 implicit（时钟自己倒退）都不是。 */
function isExplicitReplayControl(timeline: ReplayExecutionTimeline | null | undefined): timeline is ReplayExecutionTimeline {
  return timeline != null && (timeline.cause === 'start' || timeline.cause === 'jump' || timeline.cause === 'direction');
}

/**
 * 委托在这条时间线上从哪一刻起才可能被行情触发。
 *
 *   · 在这条线上挂的：挂单时刻——早于它的行情（迟到的旧 K 线、暂停前发出的取价）一概不算数；
 *   · 用户显式开始 / 跳转 / 翻转方向时带过来的：分叉那一刻。带着挂单跳回更早的日期是正当操作，
 *     跳过去之后它照常生效，不必等时钟走回原来的挂单时刻；
 *   · 其余（时钟自己倒退补出来的 implicit 线、老数据补的 bootstrap 根、对不上的）：仍是挂单时刻。
 *     时钟倒退不是用户的操作，不能替用户把 6 月挂的单搬到 4 月去成交。
 */
export function replayOrderOrigin(
  timeline: ReplayExecutionTimeline | null | undefined,
  symbol: string,
  order: { id: string; createdAt: number; createdTimelineId?: string | null },
): number {
  if (!timeline || order.createdTimelineId === timeline.id) return order.createdAt;
  if (isExplicitReplayControl(timeline) && (timeline.carried?.[symbol]?.orderIds ?? []).includes(order.id)) {
    return timeline.forkSimTime;
  }
  return order.createdAt;
}

/**
 * 【时序校验 · 委托】at 这一刻的行情能不能触发这张委托。没有时间线（钟没在跑）时按挂单时刻与给定方向判。
 * 委托自己没有可用的挂单时刻（钟停着时挂的单记的是 0）又不是显式操作带过来的：无从比较，不加这道约束——
 * 与老仓位没有开仓时刻时的处理一致，免得它变成一张永远不成交、也没有任何提示的死单；行情时刻本身仍须有效。
 */
export function canExecuteReplayOrderAt(
  timeline: ReplayExecutionTimeline | null | undefined,
  symbol: string,
  order: { id: string; createdAt: number; createdTimelineId?: string | null },
  at: number,
  fallbackDirection: 1 | -1 = 1,
): boolean {
  const origin = replayOrderOrigin(timeline, symbol, order);
  if (!Number.isFinite(origin) || origin <= 0) return Number.isFinite(at) && at > 0;
  return replayEventIsAfterOrigin(at, origin, timeline?.direction ?? fallbackDirection);
}

/**
 * 【时序校验 · 强平】用户显式做了时间操作（开始 / 跳转 / 翻转方向）、把仓位带进了新时间线时，
 * 这副仓位在**这条线上**是从哪一刻开始承担风险的：
 *
 *   · 分叉时已经在仓位里的那几笔成交（时间线记在 carried.fillIds 里）——从分叉那一刻算。它们原来的开仓时刻
 *     属于另一段日期，拿来比只会两头错：跳回更早的日期，时钟永远到不了「开仓之后」，仓位永久免死；
 *   · 分叉之后才成交的（加仓）——照它自己的成交时刻；
 *   · 取其中按播放方向最晚的一刻：加仓改变强平价，加仓之前的价格描述的是另一副仓位。
 *
 * 结果只由仓位与时间线决定，调用方每次判定都可以照传，刷新页面之后也一样。
 * 返回 null = 不重置：时间线不是用户的显式操作（bootstrap 补根、时钟自己倒退的 implicit），
 * 或这副仓位没有哪一笔是带过来的。风险起点留在仓位形成的那一刻——迟到的旧行情、暂停恢复、
 * 时钟倒退都改不了它（BELUSDT：6 月开的仓被 4 月的 K 线强平，就是「时钟落后 → 自动重置」放进去的）。
 */
export function explicitRiskRebaseFor(
  timeline: ReplayExecutionTimeline | null | undefined,
  symbol: string,
  position: { id: string; openTime?: number | null; fills?: Array<{ id: string; openTime: number }> | null },
): { rebaseAt: number } | null {
  if (!isExplicitReplayControl(timeline)) return null;
  const fork = timeline.forkSimTime;
  if (!Number.isFinite(fork) || fork <= 0) return null;
  const carriedFillIds = new Set(timeline.carried?.[symbol]?.fillIds ?? []);
  const carriedPosition = (timeline.carried?.[symbol]?.positionIds ?? []).includes(position.id);
  // 老仓位没有 fills：它自己就是唯一的一笔成交（与 snapshotReplayCarried 的记法一致）。
  const fills = position.fills?.length
    ? position.fills
    : [{ id: position.id, openTime: Number(position.openTime) }];
  let anyCarried = false;
  const starts: number[] = [];
  for (const fill of fills) {
    // 登记表里没有逐笔 id 的老节点：仓位在名单里，就当它每一笔都是带过来的。
    const carried = carriedFillIds.size > 0 ? carriedFillIds.has(fill.id) : carriedPosition;
    if (carried) {
      anyCarried = true;
      starts.push(fork);
    } else if (Number.isFinite(fill.openTime) && fill.openTime > 0) {
      starts.push(fill.openTime);
    }
  }
  if (!anyCarried) return null;
  return { rebaseAt: timeline.direction === -1 ? Math.min(...starts) : Math.max(...starts) };
}

export interface ForwardReplayCursor {
  key: string;
  through: number;
}

/**
 * Execution follows timestamps, never array offsets. First/restored datasets seed
 * at the live clock, so late historical backfill cannot execute current positions.
 * Subsequent streaming gaps retain the last covered boundary for normal catch-up.
 */
export function planForwardReplayStep(input: {
  cursor: ForwardReplayCursor | null;
  key: string;
  data: readonly { time: number }[];
  simTime: number;
  intervalMs: number;
}) {
  const { cursor, key, data, simTime, intervalMs } = input;
  const firstEndingAfter = (time: number) => {
    let lo = 0;
    let hi = data.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (data[mid].time + intervalMs <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const seeded = !cursor || cursor.key !== key;
  const through = seeded ? simTime : cursor.through;
  const regressed = simTime < through;
  const settledEnd = firstEndingAfter(simTime);
  const settledStart = seeded || regressed ? settledEnd : Math.min(settledEnd, firstEndingAfter(through));
  const formingIndex = !regressed && settledEnd < data.length && data[settledEnd].time <= simTime
    ? settledEnd : -1;
  const coveredThrough = data.length ? Math.min(simTime, data[data.length - 1].time + intervalMs) : through;
  return {
    settledStart, settledEnd, formingIndex, regressed,
    cursor: { key, through: Math.max(through, coveredThrough) },
  };
}
