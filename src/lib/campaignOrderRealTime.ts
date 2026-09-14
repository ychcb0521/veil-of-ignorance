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
 *
 * 2026-09-14 修订：能按回放分段（buildReplaySessionFilter）时，以分段为准、不再叠加本窗口——
 * 本窗口的 5 分钟是**现实**回看，开主力前停下来想了十分钟的前置对冲会被误踢；
 * 分段过滤同时补上了「缺真实时刻一律放行」的漏洞（见 allowsOrder）。本窗口只在分段建不起来时兜底。
 */

import { MAX_SIMULATION_SPEED } from '@/lib/simulationSpeeds';
import {
  journalCloseOperationTime,
  journalOpenOperationTime,
  journalSimulatedCloseTime,
} from '@/lib/objectiveOperationTime';
import type { TradeJournal } from '@/types/journal';

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
 * 与模拟窗口相与使用；能建起来时**取代** campaignRealTimeWindow（后者只在没有锚点时兜底）：
 *   - 模拟窗口分开同一次回放里前后相继的两场战役；
 *   - 本过滤分开两次回放同一段行情；
 *   - 同一次回放里若为了重做而把时间机器倒回去，含本场操作的每一段都保留，
 *     但较早那段被后一段重走过的部分（取代规则）与不含本场操作的段都不算进本场。
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

/**
 * 一次坐下来连着操作，事件之间的现实间隔不会超过它；超过就是另一次坐下来。
 *
 * 只按模拟回落切段时，另一天在同一信号上挂了前置对冲又放弃的那次尝试，模拟时刻不晚于本场起点，
 * 不会切开，于是与本场并成一段、它的委托全数算进本场（前置对冲至今挂着的还会出现在持仓面板）。
 * 它只用来修剪本场**开始之前**与**结束之后**（见 buildReplaySessionFilter），战役中途停多久都不切。
 * 取 2 小时：挂好前置对冲后停下来想、再开主力，远用不了这么久（C 要求的是 5 分钟以上照样保留）；
 * 同一天两小时内的重试分不开，接受。
 */
export const REPLAY_SITTING_GAP_MS = 2 * 60 * 60_000;

/** 委托 / 开仓的真实时刻开始记录的那次提交（f916893，2026-09-07 09:47 北京）。早于它的事件必然是上线之前的操作。 */
export const STAMP_ROLLOUT_REAL_AT = Date.parse('2026-09-07T01:47:12.000Z');
/**
 * 晚于它的任何带真实时刻的事件（平仓、腿的操作时刻……）都证明当时跑的已是盖章代码。
 * 比提交晚半天多，留给还开着旧页面、没刷新的那段时间；盖章本身（委托 createdRealAt、成交 openedRealAt）不受这个限制。
 */
export const STAMP_ROLLOUT_SETTLED_AT = Date.parse('2026-09-07T16:00:00.000Z');

function isReplayBreak(simDropMs: number, realGapMs: number, toleranceMs: number): boolean {
  if (simDropMs <= toleranceMs) return false;
  const clockLagNoiseMs = MAX_SIMULATION_SPEED * Math.max(0, REPLAY_CLOCK_LAG_BUDGET_MS - realGapMs);
  return simDropMs > clockLagNoiseMs;
}

/**
 * 事件的来历。分段本身不看它（切段只看两只钟），归属规则要看：
 *   - record-open  ：成交记录的 openedRealAt（盖章时代才有）
 *   - record-close ：成交记录的 closedRealAt
 *   - leg-open     ：实时腿自己的「记录决策」时刻（pre_real_time），战役还没有任何平仓时也在
 *   - leg-close    ：腿自己的平仓操作时刻（post_real_close_time），本地成交记录丢了也还在
 *   - order-create ：委托（含仍挂着的）的 createdRealAt（盖章时代才有）
 *   - order-end    ：委托的 cancelledRealAt / filledRealAt
 * 不带 kind 的事件照常参与切段，但不能证明任何事。
 */
export type ReplayEventKind = 'record-open' | 'record-close' | 'leg-open' | 'leg-close' | 'order-create' | 'order-end';

export interface ReplayEvent {
  /** 真实钱包时钟（Date.now()）。 */
  realAt: number;
  /** 模拟 K 线时钟。 */
  simAt: number;
  /** 本场自己的操作（已选中成交的开 / 平、本场腿的平仓操作）：它所在的那次回放就是本场。 */
  anchor?: boolean;
  kind?: ReplayEventKind;
  /**
   * 仅 record-close：这条成交没有 openedRealAt——所有开仓路径盖章上线后都写它，缺它说明是上线之前开的仓。
   * 于是这一段跨过了上线那一刻（见盖章时代规则的「跨上线」放行）。
   */
  unstampedOpen?: boolean;
}

/**
 * 判一张委托归不归本场所需的钟。成员资格看真实时刻，取代判断看模拟委托时刻；
 * 后两个字段可省略（只传前两个时按「最保守」理解），从委托快照构造请用 orderClockStamp。
 */
export interface OrderClockStamp {
  /** 见 bestOrderRealStamp。没有任何真实时刻为 null。 */
  realAt: number | null | undefined;
  /** 委托的模拟 createdAt。 */
  simAt: number | null | undefined;
  /**
   * 盖章之前的代码最后一次经手这张委托的模拟时刻（见盖章时代规则）：
   * 挂单没有 createdRealAt 取 createdAt；撤单 / 成交也没盖章时取撤单 / 成交的模拟时刻。挂单盖了章为 null。
   * 省略时：realAt 无效（一个真实时刻都没有）视为 simAt，否则视为 null。
   */
  preStampSimAt?: number | null;
  /**
   * 这张委托活到的真实时刻（撤单 / 成交），仍挂着为 +Infinity。
   * 省略或 null：视为在它所属那一段里就结束了——之后的重走可以取代它。
   */
  endRealAt?: number | null;
  /**
   * 与 endRealAt 成对的结束模拟时刻（撤单 / 成交），仍挂着或未知为 null。
   * 用来判它是否真的活进了之后那一遍：倒回之后、那一遍走回它的挂单模拟时刻之前就撤掉的，那一遍从没见过它。
   * 省略或 null：只按 endRealAt 判。
   */
  endSimAt?: number | null;
}

export interface ReplaySessionFilter {
  /**
   * 仅判「该真实时刻落在含本场操作的某一段里」——不含取代与盖章时代规则，没有真实时刻一律放行。
   * 只供排查与分段本身的测试；委托归属一律走 allowsOrder。
   */
  allows: (realAt: number | null | undefined) => boolean;
  /** 一张委托是否属于本场的回放时间线（成员资格 + 盖章时代 + 取代，见 buildReplaySessionFilter）。 */
  allowsOrder: (order: OrderClockStamp) => boolean;
  /** 识别出的回放段数（含不属于本场的），供排查。 */
  sessionCount: number;
  /**
   * 保留的段里有上线之后的证据（委托 createdRealAt、成交 openedRealAt，或晚于 STAMP_ROLLOUT_SETTLED_AT 的真实时刻），供排查。
   * 它本身不决定拒绝：跨上线的那一段里早于证据的无章委托仍放行（见盖章时代规则）。
   */
  stampEra: boolean;
}

/**
 * 从委托快照（挂着的 / 撤掉的 / 成交的）取出 allowsOrder 需要的钟。
 * live：仍在 ordersMap 里挂着——它活过了之后每一次倒回，不会被重走取代。
 */
export function orderClockStamp(
  order: {
    createdAt: number;
    createdRealAt?: number | null;
    cancelledAt?: number | null;
    cancelledRealAt?: number | null;
    filledAt?: number | null;
    filledRealAt?: number | null;
  },
  options: { live?: boolean } = {},
): OrderClockStamp {
  let preStampSimAt: number | null = null;
  if (!finitePositive(order.createdRealAt)) {
    preStampSimAt = order.createdAt;
    // 挂单早于盖章上线时，撤单 / 成交若也没盖章，同样发生在上线之前——取更晚的那个模拟时刻，界更紧。
    // 挂单盖了章的委托不这样取：减仓单成交快照（reduceOnlyOrderExecution）至今不写 filledRealAt，缺它不说明早于上线。
    for (const [simAt, realAt] of [
      [order.cancelledAt, order.cancelledRealAt],
      [order.filledAt, order.filledRealAt],
    ] as const) {
      if (finitePositive(simAt) && !finitePositive(realAt)) preStampSimAt = Math.max(preStampSimAt, simAt);
    }
  }
  let endRealAt: number | null = options.live ? Number.POSITIVE_INFINITY : null;
  let endSimAt: number | null = null;
  if (!options.live) {
    for (const [simAt, realAt] of [
      [order.cancelledAt, order.cancelledRealAt],
      [order.filledAt, order.filledRealAt],
    ] as const) {
      if (!finitePositive(realAt)) continue;
      endRealAt = realAt;
      endSimAt = finitePositive(simAt) ? simAt : null;
      break;
    }
  }
  return {
    realAt: bestOrderRealStamp(order),
    simAt: order.createdAt,
    preStampSimAt,
    endRealAt,
    endSimAt,
  };
}

/**
 * 委托用于分段成员资格的真实时刻：挂单 → 撤单 → 成交，取第一个有效的。
 *
 * 只看 createdRealAt 时，「挂单早于盖章上线、撤单 / 成交在上线之后」的委托没有挂单时刻，
 * 被当成老数据一律放行（L2）；它的撤单 / 成交时刻同样落在某一次回放里，足以判归属。
 */
export function bestOrderRealStamp(order: {
  createdRealAt?: number | null;
  cancelledRealAt?: number | null;
  filledRealAt?: number | null;
}): number | null {
  for (const stamp of [order.createdRealAt, order.cancelledRealAt, order.filledRealAt]) {
    if (finitePositive(stamp)) return stamp;
  }
  return null;
}

/**
 * 本场一条腿自己的平仓操作，作为回放锚点。
 *
 * 本地 trade_history 里本场的成交可能已经不在了（「清除标的数据」只删成交不删委托快照；
 * 云端水合后写者胜），此时成交锚点一个都没有、分段过滤整个失效，另一次回放的委托全数混进来——
 * 而 Legs 表照样按腿上的 post_real_close_time 显示「操作」时间（L3）。
 * 有效性与界面显示同一口径（journalCloseOperationTime / journalSimulatedCloseTime）：
 * 回填腿的 post_real_close_time 曾被模拟时间污染，必须有独立的模拟平仓时刻且两者不同才可信。
 */
export function legCloseReplayEvent(
  leg: Pick<TradeJournal, 'source' | 'post_real_close_time' | 'post_simulated_close_time'>,
): ReplayEvent | null {
  const realAt = journalCloseOperationTime(leg);
  const simAt = journalSimulatedCloseTime(leg);
  if (realAt == null || simAt == null) return null;
  return { realAt, simAt, anchor: true, kind: 'leg-close' };
}

/**
 * 本场一条实时腿自己的「记录决策」操作，作为回放锚点。
 *
 * 成交 / 平仓侧的锚点要等仓位平掉才有：进行中的战役主力还没平，本地一条本场成交都没有，
 * 分段建不起来，只能退回 campaignRealTimeWindow——它的 5 分钟是**现实**回看，挂好前置对冲、
 * 停下来想了 5 分钟以上才记录决策开主力，同一遍回放里的对冲就被踢掉（C）。
 * 只认实时腿（journalOpenOperationTime 的白名单）：回填腿的 pre_real_time 是归类那一刻，与模拟时刻不成对。
 */
export function legOpenReplayEvent(
  leg: Pick<TradeJournal, 'source' | 'pre_real_time' | 'pre_simulated_time'>,
): ReplayEvent | null {
  const realAt = journalOpenOperationTime(leg);
  const simAt = parseIso(leg.pre_simulated_time);
  if (realAt == null || simAt == null) return null;
  return { realAt, simAt, anchor: true, kind: 'leg-open' };
}

export interface ReplaySessionOptions {
  /** 模拟回落的容差，默认 REPLAY_SIM_DROP_TOLERANCE_MS；同时是取代规则的容差。 */
  toleranceMs?: number;
  /** 战役仍在进行（closed_at 为空）：最晚锚点之后的延续算本场，见 buildReplaySessionFilter 规则 0。 */
  campaignOpen?: boolean;
}

const OPEN_SIDE_KINDS: ReadonlySet<ReplayEventKind | undefined> = new Set(['record-open', 'leg-open']);
const CLOSE_SIDE_KINDS: ReadonlySet<ReplayEventKind | undefined> = new Set(['record-close', 'leg-close']);

/**
 * 按回放分段判委托归属。先框出本场的时间线，再逐张判，缺一条都有真实的混入：
 *
 * 0. 时间线：按模拟回落切成回放段（isReplayBreak），保留含本场锚点的段，再按「坐下来」修剪两头——
 *    - 开头（L1'）：本场最早的锚点若是开仓侧（record-open / leg-open），战役就是从它开始的；
 *      同一段里在它之前、隔着一次坐下来（REPLAY_SITTING_GAP_MS）的事件属于更早的另一次尝试，不算。
 *      最早的锚点是平仓侧（本地成交被清掉、只剩腿的平仓时刻）时不知道战役从哪开始，不修剪。
 *    - 结尾：已结束的战役，最晚的锚点是平仓侧时战役就结束在它；之后隔着一次坐下来的事件不算。
 *    - 进行中的战役（campaignOpen）：仓位还开着、没有平仓锚点来收尾，时间机器倒回也不平仓不撤单，
 *      每个锚点之后的段哪怕不含锚点也是本场的延续（L4 带着仓位倒回之后挂的对冲；两次记录决策之间倒回出来的那一遍同理）——
 *      到隔开一次坐下来为止，不论坐下来后的第一件事是否还在锚点所在段里（隔天回来先撤掉前一天的旧单、再倒回另起一遍，
 *      与一回来就倒回是同一件事）。锚点所在段本身因含锚点整段保留、不修剪：隔天回来接着往后打（没有倒回）还是这场。
 *    中间不修剪：战役途中停多久都还是这场。
 *
 * 1. 成员资格：委托的真实时刻（bestOrderRealStamp）必须落在保留的某一段里。
 *    或者挂在保留段之前、与**那一段**同一次坐下来里（倒回之前那一遍），且活进了那一段（见 livesInto：撤单 / 成交晚于段起点、
 *    且那一段已走回它的挂单模拟时刻，或活过了整段 / 至今仍挂着）：倒回不撤单，它在那一段的时间线里真实存在。
 *    在倒回之前那一遍里就结束了的、倒回后没等走回它挂单的时刻就撤掉的，都不算。
 *    一个真实时刻都没有的委托不知道在哪一段，保留的每一段都是候选，任一段容得下即可。
 *
 * 2. 盖章时代（L1）：委托 / 开仓的真实时刻 2026-09-07 才开始记录。挂单没有 createdRealAt 的委托
 *    必然是上线之前挂的（preStampSimAt：它最后一次被盖章前的代码经手的模拟时刻）。
 *    这一段里只要有上线之后的证据（委托 createdRealAt、成交 openedRealAt，或任何晚于 STAMP_ROLLOUT_SETTLED_AT
 *    的真实时刻——腿 / 成交的平仓操作时刻也算），它就只能是**跨上线**打的那一遍留下的：
 *      - 这一段必须有上线之前的证据（早于上线的真实时刻，或没有 openedRealAt 的成交），
 *      - 且它的模拟时刻早于这一段最早的上线后证据（同一段里模拟时间只往前走）。
 *    否则只能是更早某次回放同一段行情留下的，拒绝——开主力前 5 分钟回看窗里的也一样。
 *    撤单 / 成交盖了章也一样拒（⏹ 停止会把挂着的老委托统统撤掉并盖上撤单时刻，不能凭这个混进来）。
 *    没有上线后证据的段（老战役）照旧放行，不因缺字段误踢。
 *
 * 3. 取代（L4）：同一个仓位可以跨过一次倒回——在第 A 遍回放里开主力，时间机器跳回去
 *    （跳转信号 / 重新启动都不平仓、也不撤单），在第 B 遍里才平掉。A、B 两段都保留；
 *    但 B 把 A 的一部分**重新走了一遍**，A 在那部分挂出、又在 A 里就结束了的委托属于被放弃的时间线，
 *    与 B 在同一模拟分钟、同一价格各挂一张，于是盘面成对出现（TUTUSDT：两张 0.0300500 都是 委 08-07 19:42）。
 *    「重走」只认有事件为证的部分：replaySim = B 在 A 的起点（A 段最小模拟时刻）之后最早的一个事件时刻，
 *    A 的委托模拟时刻 ≥ replaySim − 容差才算被重走。容差与切段同一口径：两遍各自读的模拟时钟都可能落后，
 *    同一分钟里 A 那张比 B 那张早几秒还是晚几秒是随机的。不用 B 的起点：往前跳不切段，B 先绕去更早的历史、
 *    再一跳越过 A 的整段时，B 的起点远早于 A，却从没重走过 A 挂单的那几个小时。
 *    倒回点之前挂的单子没有被重走，保留；活过了倒回的委托（撤单 / 成交落在 B 开始之后、且 B 已走回它的挂单模拟时刻，
 *    或活过了整个 B / 至今仍挂着）在 B 的时间线里真实存在，同样保留。倒回后看见旧单、在 B 走回它之前就撤掉的
 *    （撤单模拟时刻早于挂单）不算活进 B，照样被取代。不保留的段既不算本场、也不取代别人。
 *
 * 本场自己的锚点一个都没有 → 返回 null，调用方退回 campaignRealTimeWindow。
 */
export function buildReplaySessionFilter(
  events: ReplayEvent[],
  options: ReplaySessionOptions = {},
): ReplaySessionFilter | null {
  const toleranceMs = options.toleranceMs ?? REPLAY_SIM_DROP_TOLERANCE_MS;
  const campaignOpen = Boolean(options.campaignOpen);
  const points = events
    .filter(event => finitePositive(event.realAt) && finitePositive(event.simAt))
    .sort((a, b) => a.realAt - b.realAt || a.simAt - b.simAt);
  const anchorIndexes = points.flatMap((point, index) => (point.anchor ? [index] : []));
  // 本场自己的操作一个带真实时刻的都没有：拿不到证据就不判断
  if (anchorIndexes.length === 0) return null;

  const INF = Number.POSITIVE_INFINITY;

  // 按模拟回落切段。与这一段已经走到的最远模拟时刻比，而不是与上一个点比：事件落库顺序的小抖动不该切段；
  // 现实间隔取与这一段最后一个事件之间的距离（见 isReplayBreak）
  const segmentOf: number[] = [];
  let segmentCount = 0;
  let segmentMaxSim = 0;
  points.forEach((point, index) => {
    const previous = points[index - 1];
    if (!previous || isReplayBreak(segmentMaxSim - point.simAt, point.realAt - previous.realAt, toleranceMs)) {
      segmentCount += 1;
      segmentMaxSim = point.simAt;
    } else {
      segmentMaxSim = Math.max(segmentMaxSim, point.simAt);
    }
    segmentOf.push(segmentCount - 1);
  });

  // 规则 0：框出本场的时间线 [from, to]
  const sittingBreakBefore = (index: number) =>
    index > 0 && points[index].realAt - points[index - 1].realAt > REPLAY_SITTING_GAP_MS;
  const firstAnchor = anchorIndexes[0];
  const lastAnchor = anchorIndexes[anchorIndexes.length - 1];
  let from = 0;
  if (OPEN_SIDE_KINDS.has(points[firstAnchor].kind)) {
    from = firstAnchor;
    while (from > 0 && segmentOf[from - 1] === segmentOf[firstAnchor] && !sittingBreakBefore(from)) from -= 1;
  }
  let to = points.length - 1;
  if (!campaignOpen && CLOSE_SIDE_KINDS.has(points[lastAnchor].kind)) {
    to = lastAnchor;
    while (to + 1 < points.length && !sittingBreakBefore(to + 1) && segmentOf[to + 1] === segmentOf[lastAnchor]) to += 1;
  }
  const anchoredSegments = new Set(anchorIndexes.map(index => segmentOf[index]));
  // 进行中的战役：每个锚点之后的延续（含两个锚点之间倒回出来的那几遍）——隔开一次坐下来就断。
  // 断在锚点所在段里的事件上也一样：锚点所在段本身靠 anchoredSegments 整段保留，断的只是之后倒回出来的那几遍
  const continuesAnchor = points.map(() => false);
  if (campaignOpen) {
    let anchorSegment: number | null = null;
    for (let index = firstAnchor; index < points.length; index += 1) {
      if (points[index].anchor) anchorSegment = segmentOf[index];
      else if (anchorSegment !== null && sittingBreakBefore(index)) anchorSegment = null;
      continuesAnchor[index] = anchorSegment !== null;
    }
  }

  interface Session {
    start: number;
    end: number;
    /** 这一段第一个保留的事件在 points 里的下标：从它往前找这一段在现实里能回溯到哪。 */
    firstIndex: number;
    /** 这一段走到过的最早模拟时刻：后面的段从它之后才算重走本段。 */
    minSim: number;
    /** 这一段每个事件的模拟时刻。 */
    sims: number[];
    /** 这一段最早的上线后证据的模拟时刻，没有为 +Infinity。 */
    firstStampSim: number;
    /** 这一段有上线之前的证据。 */
    preRollout: boolean;
  }
  const stampSimOf = (point: ReplayEvent) => (
    point.kind === 'order-create' || point.kind === 'record-open' || point.realAt >= STAMP_ROLLOUT_SETTLED_AT
      ? point.simAt
      : INF
  );
  // 一段内保留下来的点在下标上连续，所以每段至多一个 session；sessions 按现实时间先后生成
  const sessionsBySegment = new Map<number, Session>();
  for (let index = from; index <= to; index += 1) {
    const segment = segmentOf[index];
    if (!anchoredSegments.has(segment) && !continuesAnchor[index]) continue;
    const point = points[index];
    const current = sessionsBySegment.get(segment);
    const preRollout = point.realAt < STAMP_ROLLOUT_REAL_AT || Boolean(point.unstampedOpen);
    if (current) {
      current.end = point.realAt;
      current.minSim = Math.min(current.minSim, point.simAt);
      current.sims.push(point.simAt);
      current.firstStampSim = Math.min(current.firstStampSim, stampSimOf(point));
      current.preRollout = current.preRollout || preRollout;
    } else {
      sessionsBySegment.set(segment, {
        start: point.realAt,
        end: point.realAt,
        firstIndex: index,
        minSim: point.simAt,
        sims: [point.simAt],
        firstStampSim: stampSimOf(point),
        preRollout,
      });
    }
  }

  const sessions = Array.from(sessionsBySegment.values());
  const kept = sessions.map((session, index) => {
    // 这一段在现实里最早能回溯到哪：它第一个保留的事件往前、不隔开一次坐下来（倒回之前那一遍也算）。
    // 每段各算各的：都从本场第一段算起时，夹在两段之间另一次坐下来挂的单会被当成后一段的候选
    let reachIndex = session.firstIndex;
    while (reachIndex > 0 && !sittingBreakBefore(reachIndex)) reachIndex -= 1;
    return {
      ...session,
      reachRealAt: points[reachIndex].realAt,
      /** 之后每个保留的段：它现实里的起止、有事件为证地重走到本段的最早模拟时刻（没重走到为 +Infinity）。 */
      replayedBy: sessions.slice(index + 1).map(later => ({
        start: later.start,
        end: later.end,
        replaySim: later.sims.reduce((min, simAt) => (simAt >= session.minSim && simAt < min ? simAt : min), INF),
      })),
    };
  });
  const stampEra = kept.some(session => session.firstStampSim < INF);
  const orderEndRealAt = (order: OrderClockStamp) => (
    typeof order.endRealAt === 'number' && order.endRealAt > 0 ? order.endRealAt : Number.NEGATIVE_INFINITY
  );
  /**
   * 委托活进了 span 那一段的时间线：结束晚于那一段起点，且活过了整段，或结束时那一段已走回（或越过）它的挂单模拟时刻。
   * 倒回后看见旧单、没等走回它挂单的时刻就撤掉（撤单模拟时刻早于挂单），那一段从没见过它挂在那里——仍是被放弃的时间线。
   * 结束的模拟时刻未知时只看真实时刻。
   */
  const livesInto = (span: { start: number; end: number }, order: OrderClockStamp) => {
    const endRealAt = orderEndRealAt(order);
    if (endRealAt < span.start) return false;
    const { simAt, endSimAt } = order;
    return endRealAt > span.end
      || !finitePositive(endSimAt)
      || !finitePositive(simAt)
      || endSimAt >= simAt - toleranceMs;
  };

  const fitsSession = (session: (typeof kept)[number], order: OrderClockStamp) => {
    // 盖章时代：上线之前经手过的委托，只能是跨上线那一遍里、早于这一段第一个上线后证据的
    const preStampSimAt = order.preStampSimAt === undefined
      ? (finitePositive(order.realAt) ? null : order.simAt)
      : order.preStampSimAt;
    if (preStampSimAt !== null && session.firstStampSim < INF
      && !(session.preRollout && finitePositive(preStampSimAt) && preStampSimAt < session.firstStampSim)) {
      return false;
    }
    // 取代：它没有活进之后的某一段，且那一段重走到了它挂单的模拟时刻 → 被放弃的时间线
    const { simAt } = order;
    return session.replayedBy.every(later =>
      livesInto(later, order)
      || later.replaySim === INF
      || (finitePositive(simAt) && simAt < later.replaySim - toleranceMs));
  };

  return {
    sessionCount: segmentCount,
    stampEra,
    allows: realAt => {
      if (!finitePositive(realAt)) return true;
      return kept.some(session => realAt >= session.start && realAt <= session.end);
    },
    allowsOrder: order => {
      const { realAt } = order;
      // 挂在保留段之外、却活进了某个保留段的委托（倒回之前挂的、倒回不撤）：在那一段的时间线里真实存在，按那一段判
      const candidates = finitePositive(realAt)
        ? kept.filter(session => (realAt >= session.start && realAt <= session.end)
          || (realAt < session.start && realAt >= session.reachRealAt && livesInto(session, order)))
        : kept;
      return candidates.some(session => fitsSession(session, order));
    },
  };
}
