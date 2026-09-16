/**
 * 回放时间线登记表——纯类型与纯归约，不碰 React、不碰存储。
 *
 * 为什么要有它：同一段历史行情可以被回放很多次（倒回去重打、跳到信号、倒叙播放），
 * 几次回放的委托在模拟时间轴上完全重合。今天战役归属靠「现实时间 + 模拟时间回落」
 * 事后去猜哪几笔属于同一次回放（campaignOrderRealTime.buildReplaySessionFilter）。
 * 猜总有猜不准的时候；而「此刻跑的是哪一条时间线」在**写入那一刻**是确定知道的。
 * 这里把它记下来：每次开始 / 跳转 / 翻转方向都分出一条新时间线，
 * 委托、成交、平仓写入时顺手盖上所在时间线的 id。
 *
 * 本期（Phase 0）只负责「写」：登记表 + 盖章。归属逻辑一行不改——老数据没有章，
 * 照旧走启发式；新数据的章要等读取侧（Phase 1 影子比对）验证过才会参与判定。
 *
 * 结构：
 *   node      一条时间线。scope 是它所属的时钟：同步模式全局一只钟（'synced'），
 *             隔离模式每个币一只钟（'coin:<symbol>'）。parentId 指向分叉之前正在跑的那条
 *             （同一次坐下来里的倒回 / 跳转 / 翻转），从停着的钟起步就是新的根。
 *   carried   分叉那一刻已经开着的仓位（含每笔成交）与挂着的委托——它们「活进」了这条时间线。
 *   current   每只钟此刻指向哪条时间线；结束后置 null。
 */
import { REPLAY_CLOCK_LAG_BUDGET_MS, REPLAY_SIM_DROP_TOLERANCE_MS } from '@/lib/campaignOrderRealTime';
import { MAX_SIMULATION_SPEED } from '@/lib/simulationSpeeds';

/** usePersistedState 的逻辑键；云端同步对这个键按节点 id 做并集合并（见 simStateSync）。 */
export const REPLAY_TIMELINES_STORAGE_KEY = 'replay_timelines_v1';

/**
 * 盖章（只改 lastSimTime / lastRealAt）攒多久才落一次盘。
 * 每一笔成交、撤单、平仓、每个仓位的资金费都盖章，逐次落盘等于每秒把整张登记表序列化几次、
 * 再推一次云端；分叉 / 结束照旧立刻落盘，顺带把攒着的章一起冲出去。关页面时最多丢这几秒的章——
 * lastSimTime 本来就只是「没正常结束的时间线至少知道走到了哪」的近似值。
 */
export const REPLAY_STAMP_PERSIST_THROTTLE_MS = 5_000;

/**
 * 登记表的体量上限（见 pruneReplayTimelineRegistry）。localStorage 的整站配额约 5 MB，
 * 与 positions_map / trade_history 共用；写满之后 usePersistedState 的写入静默失败，仓位从此不再落盘。
 * 一条时间线几百字节到几 KB（同步模式分叉时快照所有标的的仓位与挂单），一天二三十次分叉，
 * 不修剪一年就是好几 MB。修剪掉的老节点在读取侧退回 'defer'（登记表里找不到章指向的节点）。
 */
export const REPLAY_TIMELINE_MAX_AGE_MS = 120 * 24 * 60 * 60_000;
export const REPLAY_TIMELINE_MAX_NODES = 1_500;

export type ReplayTimelineScope = 'synced' | `coin:${string}`;

/**
 * 时间线从哪来：
 *   bootstrap  新代码第一次看见一只已经在跑、却没有时间线的钟（上线前开着的会话、登记表丢失）
 *   start      手动启动时间机器
 *   jump       信号库跳转
 *   direction  正放 ↔ 倒放（倒放里照样撮合、照样下单，同一段行情被反着再走一遍）
 *   implicit   兜底：写入时发现时钟逆着播放方向明显回落，却没有任何显式分叉
 */
export type ReplayTimelineCause = 'bootstrap' | 'start' | 'jump' | 'direction' | 'implicit';

export type ReplayDirection = 1 | -1;

export interface ReplayTimelineCarriedIds {
  positionIds: string[];
  /** 合并仓位里每一笔成交的 id（fills[0].id 恒等于 position.id，这里照样列出）。 */
  fillIds: string[];
  orderIds: string[];
}

export interface ReplayTimelineNode {
  id: string;
  scope: ReplayTimelineScope;
  parentId: string | null;
  cause: ReplayTimelineCause;
  direction: ReplayDirection;
  /** 分叉时刻（模拟时钟）。倒放时已对齐到 K 线开盘，与镜面 cap 同一个数。 */
  forkSimTime: number;
  startedRealAt: number;
  endSimTime: number | null;
  endedRealAt: number | null;
  /** 按标的分组的「活进这条时间线」的仓位 / 成交 / 委托。 */
  carried: Record<string, ReplayTimelineCarriedIds>;
  /**
   * 最近一次盖章时的撮合时钟与现实时刻。两个用途：
   *   · 兜底分叉的比较基准（isImplicitReplayFork）；
   *   · 没有正常结束的时间线（关页面、崩溃）至少知道自己走到了哪。
   * 老节点（或刚分叉还没盖过章）等于分叉时刻。
   */
  lastSimTime?: number | null;
  lastRealAt?: number | null;
}

export interface ReplayTimelineRegistry {
  v: 1;
  nodes: Record<string, ReplayTimelineNode>;
  /** scope → 此刻指向的时间线 id；结束后为 null。 */
  current: Record<string, string | null>;
}

export function createReplayTimelineRegistry(): ReplayTimelineRegistry {
  return { v: 1, nodes: {}, current: {} };
}

export function replayTimelineScope(mode: 'synced' | 'isolated', symbol: string): ReplayTimelineScope {
  return mode === 'synced' ? 'synced' : `coin:${symbol}`;
}

/** 'coin:BTCUSDT' → 'BTCUSDT'；同步时钟不属于单个标的，返回 null。 */
export function replayTimelineScopeSymbol(scope: ReplayTimelineScope | string): string | null {
  return scope.startsWith('coin:') ? scope.slice('coin:'.length) : null;
}

/**
 * 隔离模式下一只币的钟算不算「在跑」（播放或暂停）。
 *
 * 不能只看 status !== 'stopped'：隔离模式下在一个从没启动过的币上调倍速，
 * handleSetSpeed 会给它造一个 status 'paused'、time 0、没有锚点的占位条目——
 * 那不是一次回放，不该给它登记时间线。
 */
export function isCoinTimelineClockActive(
  ct: { status: string; historicalAnchorTime: number | null; originTime: number | null } | null | undefined,
): boolean {
  if (!ct || ct.status === 'stopped') return false;
  return ct.historicalAnchorTime != null || ct.originTime != null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function normalizeCarried(raw: unknown): Record<string, ReplayTimelineCarriedIds> {
  const out: Record<string, ReplayTimelineCarriedIds> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [symbol, ids] of Object.entries(raw as Record<string, unknown>)) {
    if (!ids || typeof ids !== 'object') continue;
    const item = ids as Record<string, unknown>;
    out[symbol] = {
      positionIds: stringList(item.positionIds),
      fillIds: stringList(item.fillIds),
      orderIds: stringList(item.orderIds),
    };
  }
  return out;
}

function normalizeNode(id: string, raw: unknown): ReplayTimelineNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const node = raw as Record<string, unknown>;
  const scope = typeof node.scope === 'string' && (node.scope === 'synced' || node.scope.startsWith('coin:'))
    ? node.scope as ReplayTimelineScope
    : null;
  const forkSimTime = finiteNumber(node.forkSimTime);
  const startedRealAt = finiteNumber(node.startedRealAt);
  if (!scope || forkSimTime == null || startedRealAt == null) return null;
  const causes: ReplayTimelineCause[] = ['bootstrap', 'start', 'jump', 'direction', 'implicit'];
  return {
    id,
    scope,
    parentId: typeof node.parentId === 'string' && node.parentId ? node.parentId : null,
    cause: causes.includes(node.cause as ReplayTimelineCause) ? node.cause as ReplayTimelineCause : 'implicit',
    direction: node.direction === -1 ? -1 : 1,
    forkSimTime,
    startedRealAt,
    endSimTime: finiteNumber(node.endSimTime),
    endedRealAt: finiteNumber(node.endedRealAt),
    carried: normalizeCarried(node.carried),
    lastSimTime: finiteNumber(node.lastSimTime),
    lastRealAt: finiteNumber(node.lastRealAt),
  };
}

/**
 * 从存储 / 云端读回的任意值整理成合法登记表。
 * 这份数据会跨设备合并、会被旧版本页面读写，坏节点（缺 scope、缺分叉时刻）直接丢掉，
 * 指向不存在节点的 current 置 null——宁可让下一次写入补一个 bootstrap，也不要盖一个悬空的章。
 */
export function normalizeReplayTimelineRegistry(raw: unknown): ReplayTimelineRegistry {
  const registry = createReplayTimelineRegistry();
  if (!raw || typeof raw !== 'object') return registry;
  const source = raw as { nodes?: unknown; current?: unknown };
  if (source.nodes && typeof source.nodes === 'object') {
    for (const [id, value] of Object.entries(source.nodes as Record<string, unknown>)) {
      const node = normalizeNode(id, value);
      if (node) registry.nodes[id] = node;
    }
  }
  if (source.current && typeof source.current === 'object') {
    for (const [scope, id] of Object.entries(source.current as Record<string, unknown>)) {
      registry.current[scope] = typeof id === 'string' && registry.nodes[id] ? id : null;
    }
  }
  return registry;
}

/** scope 此刻指向、且尚未结束的那条时间线。 */
export function currentReplayTimeline(
  registry: ReplayTimelineRegistry,
  scope: ReplayTimelineScope,
): ReplayTimelineNode | null {
  const id = registry.current[scope];
  const node = id ? registry.nodes[id] : null;
  return node && node.endedRealAt == null ? node : null;
}

interface CarriedPositionLike {
  id: string;
  fills?: { id: string }[];
}

/**
 * 分叉那一刻「活进」新时间线的东西。symbols 为 null 表示全部标的（同步时钟），
 * 否则只取这几个标的（隔离模式一只币一只钟）。只记 id——内容此后还会变，身份不会。
 */
export function snapshotReplayCarried(
  positionsMap: Record<string, CarriedPositionLike[]>,
  ordersMap: Record<string, { id: string }[]>,
  symbols: string[] | null,
): Record<string, ReplayTimelineCarriedIds> {
  const wanted = symbols ? new Set(symbols) : null;
  const out: Record<string, ReplayTimelineCarriedIds> = {};
  const entry = (symbol: string) => {
    out[symbol] ??= { positionIds: [], fillIds: [], orderIds: [] };
    return out[symbol];
  };
  for (const [symbol, positions] of Object.entries(positionsMap ?? {})) {
    if (wanted && !wanted.has(symbol)) continue;
    for (const position of positions ?? []) {
      if (!position?.id) continue;
      const item = entry(symbol);
      item.positionIds.push(position.id);
      const fillIds = (position.fills ?? []).map(fill => fill.id).filter(Boolean);
      // 旧仓位没有 fills：它自己就是唯一的一笔成交（与 mergeFilledPosition 的推导一致）。
      item.fillIds.push(...(fillIds.length > 0 ? fillIds : [position.id]));
    }
  }
  for (const [symbol, orders] of Object.entries(ordersMap ?? {})) {
    if (wanted && !wanted.has(symbol)) continue;
    for (const order of orders ?? []) {
      if (order?.id) entry(symbol).orderIds.push(order.id);
    }
  }
  return out;
}

export interface ForkReplayTimelineInput {
  id: string;
  scope: ReplayTimelineScope;
  cause: ReplayTimelineCause;
  direction: ReplayDirection;
  forkSimTime: number;
  realAt: number;
  carried: Record<string, ReplayTimelineCarriedIds>;
  /**
   * 分叉之前这只钟是不是在跑（播放或暂停）。在跑 = 同一次坐下来里的倒回 / 跳转 / 翻转，
   * 新时间线挂在当前那条下面；从停着的钟起步是新的根——哪怕登记表里还留着一条没正常结束的旧指针
   * （关页面、崩溃、另一台设备同步过来的指针），也不能把两次坐下来接成一次。
   */
  continuing: boolean;
  /**
   * 分叉那一刻父时间线的撮合时钟（改钟之前现算）。有父时间线就先给它盖一个章：
   * 翻转方向、往回跳都是在父线走到某处时发生的，父线自己却不会为此盖章——最近一次盖章可能远在之前。
   * 读取侧拿父线的活动上限当「本场停在哪」、当重走判据的比较范围，缺了这一笔，
   * 同一张委托的结论会随父线上一次无关的盖章而变。兜底分叉（implicit）时钟已经拨过去了，传 null。
   */
  parentSimTime?: number | null;
}

export function forkReplayTimeline(
  registry: ReplayTimelineRegistry,
  input: ForkReplayTimelineInput,
): ReplayTimelineRegistry {
  const parent = input.continuing ? currentReplayTimeline(registry, input.scope) : null;
  if (parent && finiteNumber(input.parentSimTime) != null) {
    registry = recordReplayTimelineStamp(registry, parent.id, input.parentSimTime as number, input.realAt);
  }
  const node: ReplayTimelineNode = {
    id: input.id,
    scope: input.scope,
    parentId: parent?.id ?? null,
    cause: input.cause,
    direction: input.direction,
    forkSimTime: input.forkSimTime,
    startedRealAt: input.realAt,
    endSimTime: null,
    endedRealAt: null,
    carried: input.carried,
    lastSimTime: input.forkSimTime,
    lastRealAt: input.realAt,
  };
  return {
    v: 1,
    nodes: { ...registry.nodes, [node.id]: node },
    current: { ...registry.current, [input.scope]: node.id },
  };
}

/**
 * 结束 scope 当前的时间线。endSimTime 缺省取最近一次盖章的时刻。
 * 没有当前时间线就原样返回（重复结束、从没开始过都不是错误）。
 */
export function endReplayTimeline(
  registry: ReplayTimelineRegistry,
  scope: ReplayTimelineScope,
  end: { simTime?: number | null; realAt: number },
): ReplayTimelineRegistry {
  const node = currentReplayTimeline(registry, scope);
  if (!node) {
    return registry.current[scope] == null ? registry : { ...registry, current: { ...registry.current, [scope]: null } };
  }
  const endSimTime = finiteNumber(end.simTime) ?? node.lastSimTime ?? node.forkSimTime;
  return {
    v: 1,
    nodes: { ...registry.nodes, [node.id]: { ...node, endSimTime, endedRealAt: end.realAt } },
    current: { ...registry.current, [scope]: null },
  };
}

/**
 * later 是不是 earlier 只隔着「翻转方向」分出来的时间线（含同一条）：从 later 沿 parentId 往上走，
 * 只穿过 cause 为 'direction' 的节点，走得到 earlier 就是。
 * 翻转方向不换场——仓位、挂单、计算器的计划都原样带过去；开始 / 跳转 / 兜底分叉（钟被拨回）才是新的一场。
 * 节点找不到（修剪掉、别的设备的章）按不是处理。
 */
export function isWithinDirectionFlips(
  registry: ReplayTimelineRegistry,
  earlierId: string,
  laterId: string,
): boolean {
  const seen = new Set<string>();
  for (let id: string | null = laterId; id && !seen.has(id);) {
    if (id === earlierId) return true;
    seen.add(id);
    const node: ReplayTimelineNode | undefined = registry.nodes[id];
    if (!node || node.cause !== 'direction') return false;
    id = node.parentId;
  }
  return false;
}

/** 记下一次盖章的时钟；时钟没动就返回同一个对象（调用方据此跳过持久化）。 */
export function recordReplayTimelineStamp(
  registry: ReplayTimelineRegistry,
  id: string,
  simTime: number,
  realAt: number,
): ReplayTimelineRegistry {
  const node = registry.nodes[id];
  if (!node || !Number.isFinite(simTime) || node.lastSimTime === simTime) return registry;
  return {
    ...registry,
    nodes: { ...registry.nodes, [id]: { ...node, lastSimTime: simTime, lastRealAt: realAt } },
  };
}

/**
 * 兜底分叉判据：这次盖章时的撮合时钟，是否逆着时间线的播放方向明显回落了。
 *
 * 显式分叉（开始 / 跳转 / 翻转）都有入口；这里兜的是没有入口的那些——
 * 将来新加的改钟路径、另一台设备同步过来的钟、恢复会话时钟被拨回去。
 *
 * 容差与 campaignOrderRealTime 的切段判据同源：超过 REPLAY_SIM_DROP_TOLERANCE_MS，
 * 且超过「现实里几乎同时发生的两次读钟之间，钟落后能造成的回落」
 * MAX_SIMULATION_SPEED × max(0, 预算 − 现实间隔)。
 * restored：这是本次页面加载后这条时间线的第一次盖章——恢复会话的钟来自 500ms 一次的心跳，
 * 崩溃后可能落后一个心跳，按「现实间隔为 0」给足整份预算，不把一次刷新误判成倒回。
 */
export function isImplicitReplayFork(input: {
  direction: ReplayDirection;
  lastSimTime: number | null | undefined;
  lastRealAt: number | null | undefined;
  simTime: number;
  realAt: number;
  restored?: boolean;
}): boolean {
  const { direction, lastSimTime, lastRealAt, simTime, realAt } = input;
  if (lastSimTime == null || !Number.isFinite(lastSimTime) || !Number.isFinite(simTime)) return false;
  const dropMs = (lastSimTime - simTime) * (direction === -1 ? -1 : 1);
  if (dropMs <= REPLAY_SIM_DROP_TOLERANCE_MS) return false;
  const realGapMs = input.restored || lastRealAt == null || !Number.isFinite(lastRealAt)
    ? 0
    : Math.max(0, realAt - lastRealAt);
  const clockLagNoiseMs = MAX_SIMULATION_SPEED * Math.max(0, REPLAY_CLOCK_LAG_BUDGET_MS - realGapMs);
  return dropMs > clockLagNoiseMs;
}

function nodeActivityRealAt(node: ReplayTimelineNode): number {
  return Math.max(node.lastRealAt ?? 0, node.endedRealAt ?? 0, node.startedRealAt);
}

/**
 * 修剪登记表：丢掉太老或太多的**已结束**时间线，让体量有上界（REPLAY_TIMELINE_MAX_AGE_MS / MAX_NODES）。
 *
 * 一条时间线的「新鲜度」取它和它全部后代里最近的动静——祖先至少与后代一样新鲜，
 * 于是按新鲜度从旧到新丢，留下的节点永远不会失去祖先（parentId 悬空会让读取侧的祖先链断掉）。
 * 没结束的、被 current 指着的及其祖先一律保留：那是还在跑的钟。
 * 修剪是本机的事：云端水化按并集合并会把远端还留着的老节点并回来，下一次分叉再修一遍即可。
 */
export function pruneReplayTimelineRegistry(
  registry: ReplayTimelineRegistry,
  options: { now: number; maxAgeMs?: number; maxNodes?: number },
): ReplayTimelineRegistry {
  const maxAgeMs = options.maxAgeMs ?? REPLAY_TIMELINE_MAX_AGE_MS;
  const maxNodes = options.maxNodes ?? REPLAY_TIMELINE_MAX_NODES;
  const nodes = registry.nodes;
  const ids = Object.keys(nodes);
  if (ids.length === 0) return registry;

  const childrenOf = new Map<string, string[]>();
  for (const node of Object.values(nodes)) {
    if (node.parentId && nodes[node.parentId]) {
      childrenOf.set(node.parentId, [...(childrenOf.get(node.parentId) ?? []), node.id]);
    }
  }
  // 还在跑的钟（及其祖先）永不修剪
  const pinned = new Set<string>();
  const pin = (id: string | null) => {
    const seen = new Set<string>();
    for (let cursor = id; cursor && nodes[cursor] && !seen.has(cursor); cursor = nodes[cursor].parentId) {
      seen.add(cursor);
      pinned.add(cursor);
    }
  };
  for (const node of Object.values(nodes)) if (node.endedRealAt == null) pin(node.id);
  for (const id of Object.values(registry.current)) pin(id);

  // 新鲜度 = 自己与全部后代里最近的动静；后序遍历，记过的不再算
  const freshness = new Map<string, number>();
  const freshnessOf = (id: string): number => {
    const known = freshness.get(id);
    if (known != null) return known;
    freshness.set(id, Number.NEGATIVE_INFINITY); // 环保护
    let value = pinned.has(id) ? Number.POSITIVE_INFINITY : nodeActivityRealAt(nodes[id]);
    for (const child of childrenOf.get(id) ?? []) value = Math.max(value, freshnessOf(child));
    freshness.set(id, value);
    return value;
  };
  for (const id of ids) freshnessOf(id);

  const dropped = new Set<string>();
  const cutoff = options.now - maxAgeMs;
  for (const id of ids) if (freshnessOf(id) < cutoff) dropped.add(id);
  if (ids.length - dropped.size > maxNodes) {
    const survivors = ids.filter(id => !dropped.has(id)).sort((a, b) => freshnessOf(a) - freshnessOf(b) || a.localeCompare(b));
    for (const id of survivors.slice(0, survivors.length - maxNodes)) {
      if (freshnessOf(id) !== Number.POSITIVE_INFINITY) dropped.add(id);
    }
  }
  if (dropped.size === 0) return registry;

  const kept: Record<string, ReplayTimelineNode> = {};
  for (const id of ids) if (!dropped.has(id)) kept[id] = nodes[id];
  return { v: 1, nodes: kept, current: { ...registry.current } };
}

function mergeNode(a: ReplayTimelineNode, b: ReplayTimelineNode): ReplayTimelineNode {
  const [newer, older] = nodeActivityRealAt(a) >= nodeActivityRealAt(b) ? [a, b] : [b, a];
  const merged: ReplayTimelineNode = { ...newer };
  // 结束是终态：任何一边结束过，合并结果就是结束的。
  if (merged.endedRealAt == null && older.endedRealAt != null) {
    merged.endedRealAt = older.endedRealAt;
    merged.endSimTime = older.endSimTime;
  }
  return merged;
}

/**
 * 云端水化时的合并：**按节点 id 取并集**，不是「谁更新谁覆盖」。
 *
 * 其余键按整键写者胜没问题——它们描述的是「此刻的状态」。登记表描述的是**历史**：
 * 两台设备各自分叉出来的时间线都真实发生过，整键覆盖会把其中一台的节点整个抹掉，
 * 那台设备上盖过章的委托从此指向一个不存在的节点。
 *
 * 同一 id 两边都有：取最近有动静的那份，结束是终态。
 * current 指针优先本地——驱动它的时钟（同步模式的 sim_state）只存在本机；
 * 本地从没登记过的 scope 才采用远端的（隔离模式各币时钟 coin_timelines_v2 本身随账号同步）。
 * 指向已结束或不存在节点的指针置 null。
 */
export function mergeReplayTimelineRegistries(localRaw: unknown, remoteRaw: unknown): ReplayTimelineRegistry {
  const local = normalizeReplayTimelineRegistry(localRaw);
  const remote = normalizeReplayTimelineRegistry(remoteRaw);
  const nodes: Record<string, ReplayTimelineNode> = { ...remote.nodes };
  for (const [id, node] of Object.entries(local.nodes)) {
    nodes[id] = nodes[id] ? mergeNode(node, nodes[id]) : node;
  }
  const sortedNodes: Record<string, ReplayTimelineNode> = {};
  for (const id of Object.keys(nodes).sort()) sortedNodes[id] = nodes[id];

  const current: Record<string, string | null> = {};
  for (const scope of new Set([...Object.keys(remote.current), ...Object.keys(local.current)])) {
    const id = scope in local.current ? local.current[scope] : remote.current[scope];
    const node = id ? sortedNodes[id] : null;
    current[scope] = node && node.endedRealAt == null ? node.id : null;
  }
  return { v: 1, nodes: sortedNodes, current };
}
