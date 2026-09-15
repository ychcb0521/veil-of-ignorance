/**
 * 委托按**回放时间线登记表**归属战役——精确判定（Phase 1：影子读取）。
 *
 * 今天的归属靠「现实时间 + 模拟时间回落」事后去猜哪几笔属于同一次回放
 * （campaignOrderRealTime.buildReplaySessionFilter）。Phase 0 起，每次开始 / 跳转 / 翻转方向都分出一条
 * 时间线，委托、成交、平仓写入时盖上所在时间线的 id（lib/replayTimeline）。这里把章读回来：
 * 先框出本场的时间线集合 O，再逐张委托判 'in' / 'out'，判不了的给 'defer'（退回启发式）。
 *
 * 本期只做影子比对：getCampaignFullData 照旧用启发式的结论，这里的结论只进 timelineDiagnostics。
 * Phase 2（精确结论生效）不在本期。
 *
 * 规则（与 buildReplaySessionFilter 的规则一一对应，只是证据从两只钟换成了章）：
 *
 * 0. 锚点：本场自己的操作所在的时间线——已选中成交的开 / 平章、本场仓位每笔成交的章、
 *    实时腿记录决策时的章、战役事件带的章。一个盖了章的锚点都没有 → 返回 null（老战役，只有启发式）。
 *    有锚点没盖章（上线之前的操作、老页面写的）→ 'mixed'：本场的时间线可能不全，能确定的才下结论。
 *
 * 1. 本场时间线 O：锚点所在的时间线，加上「带着本场仓位分叉出去」的后代里
 *      - 往前一跳回到本场停下处接着打的（forkSimTime 不低于上一条本场时间线的活动上限）；
 *      - 进行中的战役里、与某个锚点同一次坐下来的倒回 / 跳转（仓位还开着，倒回不平仓，那一遍是本场的延续）；
 *      - 本场停下的地方被之后接上的：与锚点同一次坐下来里倒回出来、本场就停在它上面的那一遍（之后同一次坐下来里
 *        没有再倒回），之后某次坐下来里的本场时间线从它停下处往前接着打（当天带着主力倒回、隔两天回来接着打到平仓）
 *        ——已结束的战役也算，与启发式「回到本场时只与本场停下的那一段比」同一口径。
 *    夹在中间、隔了一次坐下来另起的一遍（隔天回放同一段行情）虽然带着本场仓位，不算本场，也不取代本场的单
 *    （与启发式的规则 0 同一口径）。已结束的战役不含锚点、也没被之后接上的那一遍是被放弃的时间线。
 *
 * 2. 成员资格：挂单章在 O 里的委托是本场的。挂在 O 之外（祖先、或另一条线）却**活进了** O 的某条时间线
 *    ——分叉时带进去的（carried）、在那条线上成交的、在那条线走回它挂单时刻之后才撤的、至今挂着的——
 *    也算，但只认与那条线**同一次坐下来**挂的（倒回之前那一遍）：隔天回放留下、至今挂着的旧单不借这条路混进来。
 *    「走回它挂单时刻」以挂单那条线的播放方向为准：那条线从挂单时刻**之前**起步、撤单时还没走到，才算没走回；
 *    起步就在挂单时刻之后（往前一跳、翻转方向）的线从一开始就看得见它——翻转后的倒放没有「还没走到」的空档。
 *
 * 3. 取代（用户政策 a）：仓位跨过倒回时，第一遍的前置对冲**照算**，除非之后的某条本场时间线
 *    **有章为证**地重走到了它挂单的时刻、而它没有活进那条线。「重走」只认盖了章的活动
 *    （这个标的上委托的挂 / 撤 / 成交、成交记录的开 / 平、战役事件），不用分叉点与走到哪的区间——
 *    与今天 replaySim 的判据同源：那条线在本线起点之后最早的活动时刻 ≤ 挂单时刻 + 容差。
 *    倒放的时间线（direction −1）照样撮合、照样下单（Index 的撮合引擎按方向换数据集），
 *    翻转方向是分叉，重走判据按方向镜像：从上往下走，最早的活动是它走到过的最高时刻。
 *
 * 4. 没盖章的委托：
 *      - 只有在某条 **bootstrap** 本场时间线分叉时被带进去（carried）才算本场——新代码第一次看见在跑的钟时
 *        它已经挂着；'start' 起步的根也会带上仍挂着的旧单，那是上一次回放留下的，不算。
 *        只认这只钟在本场里**最早**的那个 bootstrap：跑到一半指针被清掉（远端的结束合并进来、整理时丢了指针）
 *        再补出来的 bootstrap 带着的是更早那条本场时间线早就带着的旧单，不能借它混进来。
 *      - 'mixed' 战役：其余一律 'defer'（本场自己也有没盖章的操作，分不清）。
 *      - 'exact' 战役（锚点全盖了章）：其余 'out'；但它的挂单现实时刻晚于本场时间线开始（老标签页 / 漏盖章的写入路径）
 *        或它的撤单 / 成交也没盖章却晚于本场开始 → 'defer'（拿不准就不判）。
 *        本场最早的时间线是 bootstrap 根、而它挂在那个根开始之前的同一次坐下来里（新代码上线前几分钟老代码写的，
 *        没等到 bootstrap 就撤了 / 成交了）→ 同样 'defer'：登记表分不出它与残单的区别，就不下结论。
 *
 * 5. 登记表里找不到章指向的节点（登记表丢了、另一台设备的节点还没同步过来）→ 'defer'。
 *    'mixed' 战役里比较「是不是同一棵树」时，任何一边的祖先链断在一个找不到的节点上也 → 'defer'。
 */
import { REPLAY_SIM_DROP_TOLERANCE_MS, REPLAY_SITTING_GAP_MS } from '@/lib/campaignOrderRealTime';
import { journalCloseOperationTime, journalOpenOperationTime, tradeRecordOperationTime } from '@/lib/objectiveOperationTime';
import type { ReplayDirection, ReplayTimelineNode, ReplayTimelineRegistry } from '@/lib/replayTimeline';
import type { CampaignEvent, TradeJournal } from '@/types/journal';
import type { CancelledOrderSnapshot, FilledOrderSnapshot, PendingOrder, TradeRecord } from '@/types/trading';

export type CampaignTimelineVerdict = 'in' | 'out' | 'defer';

/** exact：本场锚点全盖了章；mixed：有锚点没盖章（或章指向的节点不在登记表里）。 */
export type CampaignTimelineScopeMode = 'exact' | 'mixed';

export type CampaignTimelineAnchorKind =
  | 'record-open'
  | 'record-close'
  | 'position-fill'
  | 'leg-open'
  | 'leg-close'
  | 'event';

/** 本场自己的一次操作。timelineId 为 null = 这次操作没有章。 */
export interface CampaignTimelineAnchor {
  kind: CampaignTimelineAnchorKind;
  timelineId: string | null;
  /** 操作的现实时刻；「同一次坐下来」的判断要用。事件流补出来的锚点没有。 */
  realAt?: number | null;
  /** 操作的模拟时刻；作为那条时间线的活动证据。 */
  simAt?: number | null;
}

/** 某条时间线上盖过章的一次写入：这个标的上的委托挂 / 撤 / 成交、成交记录的开 / 平、战役事件。 */
export interface CampaignTimelineActivity {
  timelineId: string;
  simAt: number | null | undefined;
  realAt: number | null | undefined;
}

/** 判一张委托所需的字段：三种快照（挂着 / 撤掉 / 成交）都满足。 */
export interface CampaignTimelineOrderLike {
  id?: string;
  createdAt: number;
  createdRealAt?: number | null;
  cancelledAt?: number | null;
  cancelledRealAt?: number | null;
  filledAt?: number | null;
  filledRealAt?: number | null;
  createdTimelineId?: string | null;
  cancelledTimelineId?: string | null;
  filledTimelineId?: string | null;
  positionId?: string | null;
}

export interface CampaignTimelineOrderOptions {
  /** 委托至今仍挂着（ordersMap 里）。成交快照传 true 时按仓位是否被带过分叉判，不当挂单看。 */
  live?: boolean;
}

export interface BuildCampaignTimelineScopeInput {
  registry: ReplayTimelineRegistry | null | undefined;
  symbol: string;
  anchors: CampaignTimelineAnchor[];
  /** 这个标的上所有盖了章的活动（不只本场的）：取代规则的「重走」证据、坐下来的链条都从它来。 */
  activity: CampaignTimelineActivity[];
  /** 本场仓位与每笔成交的 id（含还开着的）。分叉时 carried 里有它们 = 那条时间线带着本场仓位。 */
  campaignPositionIds: Iterable<string>;
  /** 战役仍在进行（closed_at 为空）：同一次坐下来里的倒回是本场的延续。 */
  campaignOpen: boolean;
  /** 模拟时刻的容差，默认与切段 / 取代同源（REPLAY_SIM_DROP_TOLERANCE_MS）。 */
  toleranceMs?: number;
}

export interface CampaignTimelineScope {
  mode: CampaignTimelineScopeMode;
  /** 本场时间线集合 O（排序后）。 */
  timelineIds: string[];
  anchorTimelineIds: string[];
  /** 没盖章的本场操作数。 */
  unstampedAnchors: number;
  /** 章指向、登记表里却没有的节点。 */
  missingAnchorNodes: string[];
  verdict: (order: CampaignTimelineOrderLike, options?: CampaignTimelineOrderOptions) => CampaignTimelineVerdict;
}

/** 一张委托的两个结论：启发式（本期生效的）与精确判定（影子）。exempt：成交开出的仓位就是本场选中的，两边都不用判。 */
export interface CampaignTimelineOrderDiagnostic {
  heuristic: boolean;
  exact: CampaignTimelineVerdict;
  exempt?: boolean;
}

export interface CampaignTimelineDisagreement {
  orderId: string;
  heuristic: boolean;
  exact: 'in' | 'out';
}

/**
 * getCampaignFullData 随结果一起返回的影子比对。heuristic 模式 = 本场没有任何盖了章的锚点（老战役），
 * 精确判定没有开工，verdicts 为空。'defer' 不算分歧——它的意思就是退回启发式。
 */
export interface CampaignTimelineDiagnostics {
  mode: 'heuristic' | CampaignTimelineScopeMode;
  timelineIds: string[];
  anchorTimelineIds: string[];
  unstampedAnchors: number;
  missingAnchorNodes: string[];
  verdicts: Record<string, CampaignTimelineOrderDiagnostic>;
  disagreements: CampaignTimelineDisagreement[];
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const finitePositive = (v: unknown): v is number => finite(v) && v > 0;

/** 委托任何一个有效的现实时刻：挂单 → 撤单 → 成交。 */
function bestRealAt(order: CampaignTimelineOrderLike): number | null {
  for (const stamp of [order.createdRealAt, order.cancelledRealAt, order.filledRealAt]) {
    if (finitePositive(stamp)) return stamp;
  }
  return null;
}

export function buildCampaignTimelineScope(input: BuildCampaignTimelineScopeInput): CampaignTimelineScope | null {
  const toleranceMs = input.toleranceMs ?? REPLAY_SIM_DROP_TOLERANCE_MS;
  const { symbol, campaignOpen } = input;
  const nodes: Record<string, ReplayTimelineNode> = input.registry?.nodes ?? {};

  const anchorTimelineIds = Array.from(new Set(
    input.anchors.map(anchor => anchor.timelineId).filter((id): id is string => Boolean(id)),
  )).sort();
  // 本场一个盖了章的操作都没有：老战役，只有启发式
  if (anchorTimelineIds.length === 0) return null;
  const unstampedAnchors = input.anchors.filter(anchor => !anchor.timelineId).length;
  const missingAnchorNodes = anchorTimelineIds.filter(id => !nodes[id]);
  const mode: CampaignTimelineScopeMode = unstampedAnchors > 0 || missingAnchorNodes.length > 0 ? 'mixed' : 'exact';
  const campaignPositionIds = new Set(input.campaignPositionIds);

  // ===== 树 =====
  const childrenOf = new Map<string, ReplayTimelineNode[]>();
  for (const node of Object.values(nodes)) {
    if (node.parentId && nodes[node.parentId]) {
      const siblings = childrenOf.get(node.parentId) ?? [];
      siblings.push(node);
      childrenOf.set(node.parentId, siblings);
    }
  }
  /** 沿 parentId 往上走；坏数据可能成环，走过的不再走。 */
  const ancestorsOf = (id: string): ReplayTimelineNode[] => {
    const out: ReplayTimelineNode[] = [];
    const seen = new Set<string>([id]);
    let cursor = nodes[id]?.parentId ?? null;
    while (cursor && !seen.has(cursor) && nodes[cursor]) {
      seen.add(cursor);
      out.push(nodes[cursor]);
      cursor = nodes[cursor].parentId;
    }
    return out;
  };
  const isAncestorOrSelf = (maybeAncestor: string, id: string) =>
    maybeAncestor === id || ancestorsOf(id).some(node => node.id === maybeAncestor);
  const rootOf = (id: string) => {
    const chain = ancestorsOf(id);
    return chain.length > 0 ? chain[chain.length - 1].id : id;
  };
  /** 祖先链断在登记表里没有的节点上（另一台设备的节点还没同步过来）：它的根是谁不知道。 */
  const chainDangles = (id: string) => {
    const top = nodes[rootOf(id)];
    return Boolean(top?.parentId) && !nodes[top.parentId as string];
  };

  // ===== 活动证据（按节点）与现实时刻链条 =====
  const activityByNode = new Map<string, { sims: number[]; reals: number[] }>();
  const realTimes: number[] = [];
  const addActivity = (timelineId: string | null | undefined, simAt: unknown, realAt: unknown) => {
    if (finitePositive(realAt)) realTimes.push(realAt);
    if (!timelineId) return;
    const bucket = activityByNode.get(timelineId) ?? { sims: [], reals: [] };
    if (finitePositive(simAt)) bucket.sims.push(simAt);
    if (finitePositive(realAt)) bucket.reals.push(realAt);
    activityByNode.set(timelineId, bucket);
  };
  for (const item of input.activity) addActivity(item.timelineId, item.simAt, item.realAt);
  for (const anchor of input.anchors) addActivity(anchor.timelineId, anchor.simAt, anchor.realAt);
  for (const node of Object.values(nodes)) {
    for (const t of [node.startedRealAt, node.lastRealAt, node.endedRealAt]) if (finitePositive(t)) realTimes.push(t);
  }
  realTimes.sort((a, b) => a - b);
  /** 从 t 往前，每两件事之间现实间隔都不超过一次坐下来，能回溯到的最早时刻。 */
  const sittingStart = (t: number): number => {
    let lo = 0;
    let hi = realTimes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (realTimes[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    let start = t;
    for (let index = lo - 1; index >= 0 && start - realTimes[index] <= REPLAY_SITTING_GAP_MS; index -= 1) {
      start = realTimes[index];
    }
    return start;
  };
  const anchorRealTimes = input.anchors
    .map(anchor => anchor.realAt)
    .filter((t): t is number => finitePositive(t))
    .sort((a, b) => a - b);
  /** t 之前、与 t 同一次坐下来里有本场的锚点操作。 */
  const sameSittingAsAnchor = (t: number) => {
    const start = sittingStart(t);
    return anchorRealTimes.some(a => a >= start && a <= t);
  };
  /** 从 t 往后，每两件事之间现实间隔都不超过一次坐下来，能延伸到的最晚时刻。 */
  const sittingEnd = (t: number): number => {
    let lo = 0;
    let hi = realTimes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (realTimes[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    let end = t;
    for (let index = lo; index < realTimes.length && realTimes[index] - end <= REPLAY_SITTING_GAP_MS; index += 1) {
      end = realTimes[index];
    }
    return end;
  };
  /** t 所在的那次坐下来里（不论先后）有本场的锚点操作。 */
  const sittingHasAnchor = (t: number) => {
    const start = sittingStart(t);
    const end = sittingEnd(t);
    return anchorRealTimes.some(a => a >= start && a <= end);
  };

  /**
   * 一条时间线自己走过的模拟区间：分叉点、它上面的活动、最近一次盖章 / 结束时的钟。
   * 这是它**自己**的范围（本场停在哪、之后的线从哪算重走本线），不是「之后的线重走了多远」——
   * 后者只认之后那条线上的活动（见 rewalked），不拿它的分叉点或走到哪当证据。
   */
  const spanOf = (node: ReplayTimelineNode) => {
    const sims = [node.forkSimTime, ...(activityByNode.get(node.id)?.sims ?? [])];
    for (const t of [node.lastSimTime, node.endSimTime]) if (finite(t)) sims.push(t);
    return { lo: Math.min(...sims), hi: Math.max(...sims) };
  };
  /** 「本场停在哪」：按播放方向取活动的上限（正放）或下限（倒放）。 */
  const stopSimOf = (node: ReplayTimelineNode) => (node.direction === -1 ? spanOf(node).lo : spanOf(node).hi);

  // ===== 本场时间线 O =====
  const carriedOf = (node: ReplayTimelineNode) => node.carried?.[symbol];
  const carriesCampaignPosition = (node: ReplayTimelineNode) => {
    const carried = carriedOf(node);
    if (!carried) return false;
    return carried.positionIds.some(id => campaignPositionIds.has(id))
      || carried.fillIds.some(id => campaignPositionIds.has(id))
      // 主力还是一张挂着的条件单（实时腿存的是委托 id）：带着这张单分叉出去的线同样带着本场
      || carried.orderIds.some(id => campaignPositionIds.has(id));
  };
  const anchorSet = new Set(anchorTimelineIds.filter(id => nodes[id]));
  // 带着本场仓位相连的那一片：从锚点出发，孩子带着仓位往下走，自己带着仓位往上走
  const lineage = new Map<string, ReplayTimelineNode>();
  const queue = Array.from(anchorSet);
  while (queue.length > 0) {
    const id = queue.pop() as string;
    const node = nodes[id];
    if (!node || lineage.has(id)) continue;
    lineage.set(id, node);
    for (const child of childrenOf.get(id) ?? []) {
      if (carriesCampaignPosition(child) && !lineage.has(child.id)) queue.push(child.id);
    }
    if (carriesCampaignPosition(node) && node.parentId && nodes[node.parentId] && !lineage.has(node.parentId)) {
      queue.push(node.parentId);
    }
  }
  const scope = new Set<string>(anchorSet);
  const nearestScopeAncestor = (id: string) => ancestorsOf(id).find(node => scope.has(node.id)) ?? null;
  /** 从 stop 处往前接着打：分叉点不低于（倒放：不高于）那里。 */
  const continuesFrom = (node: ReplayTimelineNode, stop: number, direction: ReplayDirection) => (
    direction === -1 ? node.forkSimTime <= stop + toleranceMs : node.forkSimTime >= stop - toleranceMs
  );
  /** 往前一跳回到本场停下处接着打：分叉点不低于（倒放：不高于）上一条本场时间线的活动上限。 */
  const continuesForward = (node: ReplayTimelineNode, ancestor: ReplayTimelineNode) =>
    continuesFrom(node, stopSimOf(ancestor), ancestor.direction);
  /**
   * 本场停在这条线上、之后又从这里接着打的（已结束的战役也算）：
   * 它所在的那次坐下来有本场的操作，之后同一次坐下来里只有从它往前接着打的分叉、没有再倒回（本场就停在这一串的末尾），
   * 而之后某次坐下来里的本场时间线从这里停下处往前接着打——与启发式「回到本场时只与本场停下的那一段比」同一口径：
   * 接上了，它就是本场那条时间线的一段，哪怕它自己没有锚点（当天带着主力倒回出来的一遍，隔两天回来接着打到平仓）。
   * 同一次坐下来里再倒回出来的、隔了一次坐下来另起的，都不是本场停下的地方。
   */
  const resumedLater = (node: ReplayTimelineNode): boolean => {
    if (!sittingHasAnchor(node.startedRealAt)) return false;
    const sittingEndsAt = sittingEnd(node.startedRealAt);
    const chain = [node];
    for (const later of lineage.values()) {
      if (later.id === node.id || later.startedRealAt <= node.startedRealAt || later.startedRealAt > sittingEndsAt) continue;
      const parent = later.parentId ? nodes[later.parentId] : null;
      if (!parent || !isAncestorOrSelf(node.id, later.id) || !continuesForward(later, parent)) return false;
      chain.push(later);
    }
    chain.sort((a, b) => a.startedRealAt - b.startedRealAt);
    const last = chain[chain.length - 1];
    const stop = stopSimOf(last);
    return Array.from(scope).some(id => {
      const resumed = nodes[id];
      return resumed.startedRealAt > sittingEndsAt && isAncestorOrSelf(node.id, id) && continuesFrom(resumed, stop, last.direction);
    });
  };
  // 父先于子：一条线是不是本场，要看它上面最近的本场时间线。
  // 停下处被之后接上的那条线（resumedLater）加入后，它下面的线要按它重判，循环到没有新线加入为止。
  const ordered = Array.from(lineage.values()).sort((a, b) =>
    ancestorsOf(a.id).length - ancestorsOf(b.id).length || a.startedRealAt - b.startedRealAt);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of ordered) {
      if (scope.has(node.id)) continue;
      const ancestor = nearestScopeAncestor(node.id);
      if (!ancestor) continue;
      if (continuesForward(node, ancestor) || (campaignOpen && sameSittingAsAnchor(node.startedRealAt)) || resumedLater(node)) {
        scope.add(node.id);
        grew = true;
      }
    }
  }
  const timelineIds = Array.from(scope).sort();
  const scopeNodes = timelineIds.map(id => nodes[id]);
  const earliestScopeNode = scopeNodes.reduce<ReplayTimelineNode | null>(
    (earliest, node) => (earliest == null || node.startedRealAt < earliest.startedRealAt ? node : earliest), null);
  const scopeStartRealAt = earliestScopeNode?.startedRealAt ?? null;
  const scopeRoots = new Set(timelineIds.map(rootOf));

  // ===== 逐张判 =====
  const orderCarriedBy = (node: ReplayTimelineNode, order: CampaignTimelineOrderLike) =>
    Boolean(order.id) && Boolean(carriedOf(node)?.orderIds.includes(order.id as string));
  const positionCarriedBy = (node: ReplayTimelineNode, order: CampaignTimelineOrderLike) => {
    const carried = carriedOf(node);
    if (!carried || !order.positionId) return false;
    return carried.positionIds.includes(order.positionId) || carried.fillIds.includes(order.positionId);
  };
  const hasFill = (order: CampaignTimelineOrderLike) =>
    Boolean(order.filledTimelineId) || finitePositive(order.filledAt) || finitePositive(order.filledRealAt);
  /**
   * 撤单那一刻这条线已经走到了它挂单的时刻——没走到就撤的，那条线从没把它当成一张活单看过（清理上一遍的残单）。
   * 「还没走到」以**挂单那条线**的播放方向定义：正放挂的单，模拟时刻早于挂单时刻的行情是它的「之前」，倒放挂的反过来。
   * 这条线从「之前」起步、撤单时还在「之前」→ 没走到。起步就不在「之前」（往前一跳、翻转方向）→ 从一开始就看得见它：
   * 正放里挂的单、翻转后从翻转点往下走，中间没有「还没走到」的空档，撤在哪都算走到过。
   */
  const walkedToOrderBeforeCancel = (node: ReplayTimelineNode, order: CampaignTimelineOrderLike) => {
    const { cancelledAt, createdAt } = order;
    if (!finitePositive(cancelledAt) || !finitePositive(createdAt)) return true;
    const homeDirection = (order.createdTimelineId && nodes[order.createdTimelineId]?.direction) || 1;
    const before = (t: number) => (homeDirection === -1 ? t > createdAt + toleranceMs : t < createdAt - toleranceMs);
    return !(before(node.forkSimTime) && before(cancelledAt));
  };
  /**
   * 委托活进了 node 这条时间线（与 buildReplaySessionFilter 的 livesInto 同一口径）：
   * 在这条线上成交；活过了整条线（在它的后代上才结束、或至今挂着）；在这条线走回它挂单时刻之后才撤；
   * 成交开出的仓位被这条线带着。结束没盖章时只看分叉时是否带着它。
   */
  const livesInto = (node: ReplayTimelineNode, order: CampaignTimelineOrderLike, live: boolean): boolean => {
    const endId = order.cancelledTimelineId || order.filledTimelineId || null;
    const filled = hasFill(order);
    if (endId === node.id) return filled || walkedToOrderBeforeCancel(node, order);
    if (endId && nodes[endId]) {
      if (isAncestorOrSelf(node.id, endId)) return true;
      return filled && positionCarriedBy(node, order);
    }
    if (filled) return positionCarriedBy(node, order);
    if (orderCarriedBy(node, order)) return true;
    // 这条线没有这个标的的分叉快照（老节点）：至今挂着的按分叉先后判
    if (live && !carriedOf(node) && finitePositive(order.createdRealAt)) return node.startedRealAt >= order.createdRealAt;
    return false;
  };
  /** 之后的那条线有章为证地重走到了挂单时刻：它在本线起点之后最早的活动 ≤ 挂单时刻 + 容差（倒放镜像）。 */
  const rewalked = (later: ReplayTimelineNode, home: ReplayTimelineNode, createdAt: number) => {
    const sims = activityByNode.get(later.id)?.sims ?? [];
    // 这张委托本身就是本线上的活动：它的挂单时刻一定在本线的范围里
    const homeSpan = spanOf(home);
    const span = { lo: Math.min(homeSpan.lo, createdAt), hi: Math.max(homeSpan.hi, createdAt) };
    if (later.direction === -1) {
      const first = sims.reduce<number | null>((max, s) => (s <= span.hi && (max == null || s > max) ? s : max), null);
      return first != null && first >= createdAt - toleranceMs;
    }
    const first = sims.reduce<number | null>((min, s) => (s >= span.lo && (min == null || s < min) ? s : min), null);
    return first != null && first <= createdAt + toleranceMs;
  };
  /** 用户政策 a：它没有活进之后的某条本场时间线，而那条线有证据重走到了它挂单的时刻 → 被放弃的时间线。 */
  const superseded = (home: ReplayTimelineNode, order: CampaignTimelineOrderLike, live: boolean) => {
    if (!finitePositive(order.createdAt)) return false;
    return scopeNodes.some(later =>
      later.id !== home.id
      && later.startedRealAt > home.startedRealAt
      && !isAncestorOrSelf(later.id, home.id)
      && !livesInto(later, order, live)
      && rewalked(later, home, order.createdAt));
  };
  /** 挂在 O 之外的委托只认与那条线同一次坐下来里挂的（倒回之前那一遍）。 */
  const reaches = (node: ReplayTimelineNode, order: CampaignTimelineOrderLike) => {
    const createdRealAt = order.createdRealAt;
    if (!finitePositive(createdRealAt) || createdRealAt > node.startedRealAt) return false;
    return createdRealAt >= sittingStart(node.startedRealAt);
  };
  /** 这只钟在本场里更早就有时间线：跑到一半指针被清掉再补出来的 bootstrap，不是「新代码第一次看见在跑的钟」。 */
  const scopeStartedEarlier = (node: ReplayTimelineNode) =>
    scopeNodes.some(other => other.scope === node.scope && other.startedRealAt < node.startedRealAt);
  const carriedByBootstrap = (order: CampaignTimelineOrderLike) =>
    scopeNodes.some(node =>
      node.cause === 'bootstrap'
      && !scopeStartedEarlier(node)
      && (orderCarriedBy(node, order) || positionCarriedBy(node, order)));
  /** 没盖章、挂在本场最早的 bootstrap 根开始之前的同一次坐下来里：老代码写的，登记表分不出它与残单，不判。 */
  const placedJustBeforeBootstrap = (realAt: number) =>
    earliestScopeNode?.cause === 'bootstrap'
    && realAt < earliestScopeNode.startedRealAt
    && realAt >= earliestScopeNode.startedRealAt - REPLAY_SITTING_GAP_MS;

  const verdict = (order: CampaignTimelineOrderLike, options: CampaignTimelineOrderOptions = {}): CampaignTimelineVerdict => {
    const live = Boolean(options.live) && !hasFill(order);
    const createdId = order.createdTimelineId || null;
    const endId = order.cancelledTimelineId || order.filledTimelineId || null;
    if ((createdId && !nodes[createdId]) || (endId && !nodes[endId])) return 'defer';

    if (!createdId) {
      // 没盖章的挂单
      if (carriedByBootstrap(order)) return 'in';
      if (mode === 'mixed') return 'defer';
      if (scopeStartRealAt == null) return 'defer';
      if (finitePositive(order.createdRealAt)) {
        if (order.createdRealAt >= scopeStartRealAt || placedJustBeforeBootstrap(order.createdRealAt)) return 'defer';
        return 'out';
      }
      // 挂单时刻也没有：撤单 / 成交盖了章就能判，没盖章却晚于本场开始就是老标签页写的
      if (endId) return 'out';
      const realAt = bestRealAt(order);
      if (realAt == null) return 'out';
      return realAt >= scopeStartRealAt || placedJustBeforeBootstrap(realAt) ? 'defer' : 'out';
    }

    if (scope.has(createdId)) {
      return superseded(nodes[createdId], order, live) ? 'out' : 'in';
    }
    const homes = scopeNodes.filter(node => reaches(node, order) && livesInto(node, order, live));
    if (homes.length > 0) {
      return homes.some(home => !superseded(home, order, live)) ? 'in' : 'out';
    }
    if (mode === 'exact') return 'out';
    // 另一棵树上的单才 'out'；任何一边的祖先链断在找不到的节点上，是不是同一棵树就不知道
    if (chainDangles(createdId) || timelineIds.some(chainDangles)) return 'defer';
    return scopeRoots.size > 0 && !scopeRoots.has(rootOf(createdId)) ? 'out' : 'defer';
  };

  return { mode, timelineIds, anchorTimelineIds, unstampedAnchors, missingAnchorNodes, verdict };
}

// ===== 从战役数据里收集锚点 / 活动 / 仓位 id =====

/** 还开着的仓位（positions_map）里用到的字段。openedRealAt：真实钱包时钟下的开仓时刻，「同一次坐下来」的判断要用。 */
export interface OpenPositionTimelineLike {
  id: string;
  openTime?: number;
  openedRealAt?: number;
  openTimelineId?: string | null;
  fills?: { id: string; openTime?: number; openedRealAt?: number; timelineId?: string | null }[];
}

export interface CampaignTimelineEvidenceInput {
  symbol: string;
  campaignEvents: CampaignEvent[];
  legs: TradeJournal[];
  /** 本场选中的成交记录。 */
  selectedRecords: TradeRecord[];
  /** 这个标的的全部成交记录（资金费不作证据）。 */
  tradeHistory: TradeRecord[];
  openPositions: OpenPositionTimelineLike[];
  pendingOrders: PendingOrder[];
  cancelledOrders: CancelledOrderSnapshot[];
  filledOrders: FilledOrderSnapshot[];
}

export interface CampaignTimelineEvidence {
  anchors: CampaignTimelineAnchor[];
  activity: CampaignTimelineActivity[];
  campaignPositionIds: Set<string>;
}

const isoMs = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return finitePositive(ms) ? ms : null;
};

/**
 * 锚点与启发式的锚点同源（成交的开 / 平、实时腿的记录决策、腿的平仓操作），外加本场还开着的仓位每笔成交的章
 * 与战役事件带的章。没盖章的锚点照样列出（timelineId 为 null）——它们决定 exact / mixed。
 * 战役事件没带章不算「没盖章的锚点」：老事件（归类创建、备注……）本来就没有章，否则每场都是 mixed。
 * 腿的平仓操作没有自己的章（trade_journals 没这一列）：本地成交还在就由成交的平仓章代表；
 * 成交被清掉时，看关联的战役事件有没有章（事件从成交上抄来的），没有才算没盖章。
 */
export function collectCampaignTimelineEvidence(input: CampaignTimelineEvidenceInput): CampaignTimelineEvidence {
  const anchors: CampaignTimelineAnchor[] = [];
  const activity: CampaignTimelineActivity[] = [];
  const campaignPositionIds = new Set<string>();
  const { symbol } = input;

  for (const record of input.selectedRecords) {
    if (record.symbol !== symbol || record.action === 'FUNDING') continue;
    if (record.positionId) campaignPositionIds.add(record.positionId);
    if (record.fillId) campaignPositionIds.add(record.fillId);
    anchors.push({ kind: 'record-open', timelineId: record.openedTimelineId ?? null, realAt: record.openedRealAt, simAt: record.openTime });
    anchors.push({ kind: 'record-close', timelineId: record.closedTimelineId ?? null, realAt: record.closedRealAt, simAt: record.closeTime });
  }

  const selectedById = new Map<string, TradeRecord>();
  for (const record of input.selectedRecords) {
    selectedById.set(record.id, record);
    if (record.positionId && !selectedById.has(record.positionId)) selectedById.set(record.positionId, record);
  }
  const filledById = new Map(input.filledOrders.map(order => [order.id, order] as const));
  for (const leg of input.legs) {
    if (leg.trade_record_id) {
      campaignPositionIds.add(leg.trade_record_id);
      // 实时腿存的是下单时返回的 id：条件单是委托 id，成交后开出的仓位 id 在成交快照上
      const filled = filledById.get(leg.trade_record_id);
      if (filled?.positionId) campaignPositionIds.add(filled.positionId);
    }
    if (journalOpenOperationTime(leg) != null) {
      anchors.push({
        kind: 'leg-open',
        timelineId: leg.pre_timeline_id ?? null,
        realAt: isoMs(leg.pre_real_time),
        simAt: isoMs(leg.pre_simulated_time),
      });
    }
    const record = leg.trade_record_id ? selectedById.get(leg.trade_record_id) : undefined;
    if (tradeRecordOperationTime(record) != null) continue;
    const closeRealAt = journalCloseOperationTime(leg);
    if (closeRealAt == null) continue;
    const eventTimelineId = input.campaignEvents.find(event =>
      Boolean(event.timeline_id)
      && (event.journal_id === leg.id || (Boolean(leg.trade_record_id) && event.trade_record_id === leg.trade_record_id)))
      ?.timeline_id ?? null;
    anchors.push({ kind: 'leg-close', timelineId: eventTimelineId, realAt: closeRealAt, simAt: isoMs(leg.post_simulated_close_time) });
  }

  for (const event of input.campaignEvents) {
    if (event.trade_record_id) campaignPositionIds.add(event.trade_record_id);
    if (!event.timeline_id) continue;
    // operation_time 是这条腿平仓操作的真实时刻（只有平仓事件带）：本场在那一刻操作过，坐下来的链条要它
    anchors.push({ kind: 'event', timelineId: event.timeline_id, realAt: isoMs(event.operation_time), simAt: isoMs(event.timestamp) });
  }

  for (const position of input.openPositions) {
    const fillIds = (position.fills ?? []).map(fill => fill.id);
    const mine = campaignPositionIds.has(position.id) || fillIds.some(id => campaignPositionIds.has(id));
    if (!mine) continue;
    campaignPositionIds.add(position.id);
    for (const id of fillIds) campaignPositionIds.add(id);
    // 还开着的仓位每笔成交的真实时刻也是本场的操作时刻：没有它，只靠成交撑着的那次坐下来（主力还没平）
    // 在 sameSittingAsAnchor / resumedLater 眼里是空的，同一次坐下来里带着主力倒回的那一遍就进不了本场。
    if (position.fills && position.fills.length > 0) {
      for (const fill of position.fills) {
        anchors.push({
          kind: 'position-fill',
          timelineId: fill.timelineId ?? null,
          realAt: finitePositive(fill.openedRealAt) ? fill.openedRealAt : (fill.id === position.id && finitePositive(position.openedRealAt) ? position.openedRealAt : null),
          simAt: fill.openTime,
        });
      }
    } else {
      anchors.push({
        kind: 'position-fill',
        timelineId: position.openTimelineId ?? null,
        realAt: finitePositive(position.openedRealAt) ? position.openedRealAt : null,
        simAt: position.openTime,
      });
    }
  }

  const push = (timelineId: string | null | undefined, simAt: unknown, realAt: unknown) => {
    if (timelineId) activity.push({ timelineId, simAt: finite(simAt) ? simAt : null, realAt: finite(realAt) ? realAt : null });
  };
  for (const order of input.pendingOrders) push(order.createdTimelineId, order.createdAt, order.createdRealAt);
  for (const order of input.cancelledOrders) {
    if (order.symbol !== symbol) continue;
    push(order.createdTimelineId, order.createdAt, order.createdRealAt);
    push(order.cancelledTimelineId, order.cancelledAt, order.cancelledRealAt);
  }
  for (const order of input.filledOrders) {
    if (order.symbol !== symbol) continue;
    push(order.createdTimelineId, order.createdAt, order.createdRealAt);
    push(order.filledTimelineId, order.filledAt, order.filledRealAt);
  }
  for (const record of input.tradeHistory) {
    // 资金费结算不是操作，与启发式同一口径不作证据（它带的 closedTimelineId 也不是锚点）
    if (record.symbol !== symbol || record.action === 'FUNDING') continue;
    push(record.openedTimelineId, record.openTime, record.openedRealAt);
    push(record.closedTimelineId, record.closeTime, record.closedRealAt);
  }

  return { anchors, activity, campaignPositionIds };
}
