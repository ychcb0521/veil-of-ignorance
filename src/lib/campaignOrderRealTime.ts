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
