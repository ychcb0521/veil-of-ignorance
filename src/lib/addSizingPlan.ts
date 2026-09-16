/**
 * 加仓计算器的「当前计划」：计算器 → 下单面板 / 下单入口之间唯一的传递通道。
 *
 * 计算器是顶栏的模态弹窗，下单面板在右侧、下单入口在 TradingContext——三者没有共同的父级状态。
 * 与 notificationCenter 同一种做法：模块级快照 + useSyncExternalStore，调用点只 import 函数。
 *
 * 一个计划就是一份 AddSizingSnapshot（计算器当时的输入与输出）。它在三处被消费：
 *   · 计算器每次算出可用的上限就发布一次（publishAddSizingPlan）；算不出就清掉；
 *   · 「按上限下单」把整张的上限连同下单方式交给下单面板预填（requestAddSizingPrefill）；
 *   · 下单面板在点「开多 / 开空」那一刻就看一眼（peekAddSizingSnapshotForOrder）放进单子参数——
 *     决策模式要先填下单前快照，填得再久计划也不会在半路过期；
 *     handlePlaceOrder 在同标的、同方向、同结算方式的开仓单上用它（没带就自己取），单子真的挂出 / 成交才消费，钉到委托 / 成交上；
 *   · 挂出去的限价 / 条件单被撤掉，计划仍在保鲜期、没有更新的计划、也没有在计划之后分过场，就放回来（restoreAddSizingPlan）；
 *     下单入口另要求这个标的仍持有同方向仓位、这条仓位不晚于计划开出、撤单与挂单在同一场回放里
 *     （同一条时间线，或只隔着正放 ↔ 倒放的翻转——翻转不分场，计划与挂单都原样带过去）——
 *     停止回放先平仓再撤单、跳到信号时刻把旧挂单带进新的一场、平掉又重开，计划都不该漏过去。
 *
 * 计算器重新打开时从仍在保鲜期、且仍属于当前持仓周期的计划种回 S₁ / 下单方式（限价 / 条件单计划连同锁住的价），
 * 而不是从空白开始把计划清掉——下单面板里预填好的那张单还指望着它。G 与 X₁ / S̄ 照当下重读（本场落袋变了就换成新的）。
 * 开始回放 / 跳到信号时刻（分叉出新的一场）、停止回放、合并时间轴、彻底清除标的数据时清掉（clearAddSizingPlan），计划不跨场。
 *
 * **按标的各存一份**：在 A 上算完、切到 B 再开一次计算器，A 的计划与未应用的预填都还在，
 * 回到 A 下单照样带得上。
 *
 * 取走即消费：一份计划只钉一张单，第二张加仓单没有重新打开计算器就不带计划——
 * 带一份陈旧的计划比不带更糟，校验会拿它解释一笔与它无关的成交。
 * 同理，计划有保鲜期（ADD_SIZING_PLAN_TTL_MS）：昨天算的上限不该钉在今天的单上。
 * 保鲜期从计划**最后一次仍然现行**的时刻算起——发布时、以及计算器关闭时（touchAddSizingPlan）：
 * 回放暂停时价不动、计划不变、不会重新发布，弹窗开得再久，关掉之后也还有整整半小时。
 */
import { useSyncExternalStore } from 'react';
import type { AddSizingSnapshot, OrderSide, OrderType, SettlementMode } from '@/types/trading';

/** 计划的保鲜期（真实时间）：超过就当没有。半小时足够从计算器走到下单，又不至于跨场。 */
export const ADD_SIZING_PLAN_TTL_MS = 30 * 60_000;

export interface AddSizingPrefill {
  /** 预填给下单面板的量：币本位整张、U 本位币数（面板再按数量精度向下取整）。 */
  contracts: number | null;
  coins: number;
  /**
   * 计划的下单方式：市价含滑点 → MARKET；限价 @S₂ → LIMIT 并带上挂单价；
   * 条件单 @S₂ → CONDITIONAL 并带上触发价（触发后按市价成交，计算器已按触发价上的滑点定量）。
   */
  orderType: 'MARKET' | 'LIMIT' | 'CONDITIONAL';
  limitPrice: number | null;
  /** 条件单的触发价（已按面板价格精度取整）；其余为 null / 缺省。 */
  triggerPrice?: number | null;
  side: OrderSide;
  /** 计划的结算方式（跟被加仓的仓位走）。面板不同就先切过去，再预填。 */
  settlement: SettlementMode;
}

export interface AddSizingPlanEntry {
  symbol: string;
  snapshot: AddSizingSnapshot;
  /** 「按上限下单」的请求；面板消费一次后清掉，计划本身留着给下单入口。 */
  prefill: AddSizingPrefill | null;
  /** 每次请求预填递增，面板据此只应用一次。 */
  prefillSeq: number;
}

/** 按标的存；每次变化都换一张新表，useSyncExternalStore 靠引用判断变没变。 */
let entries: ReadonlyMap<string, AddSizingPlanEntry> = new Map();
let prefillSeq = 0;
/**
 * 分场水位：clearAddSizingPlan 按标的记下最后一次清除的真实时刻（不给标的的清除记在 clearedAllAt）。
 * 计划的 at 不晚于它，就是上一场的计划——撤单时不许放回（分叉时带过来的旧挂单还钉着它）。
 */
const clearedAtBySymbol = new Map<string, number>();
let clearedAllAt = Number.NEGATIVE_INFINITY;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function write(symbol: string, next: AddSizingPlanEntry | null): void {
  const map = new Map(entries);
  if (next) map.set(symbol, next);
  else map.delete(symbol);
  entries = map;
  emit();
}

function fresh(e: AddSizingPlanEntry | undefined, now: number): e is AddSizingPlanEntry {
  return !!e && now - e.snapshot.at <= ADD_SIZING_PLAN_TTL_MS;
}

/**
 * 计算器发布当前计划；传 null 表示当前没有可用计划（S₁ 没填、没有额度……），清掉这个标的的旧计划。
 * 只在内容真的变了时才通知订阅者：计算器每次重渲染都会调用它。
 */
export function publishAddSizingPlan(symbol: string, snapshot: Omit<AddSizingSnapshot, 'at'> | null): void {
  const current = entries.get(symbol);
  if (!snapshot) {
    if (current) write(symbol, null);
    return;
  }
  const prev = current?.snapshot ?? null;
  const same = prev != null && (Object.keys(snapshot) as Array<keyof typeof snapshot>)
    .every(k => Object.is(prev[k], snapshot[k]));
  if (same) return;
  write(symbol, { symbol, snapshot: { ...snapshot, at: Date.now() }, prefill: null, prefillSeq: current?.prefillSeq ?? prefillSeq });
}

/**
 * 计划仍然现行：把保鲜期续到现在（计算器关闭时调用）。换一个新的快照对象（useSyncExternalStore 靠引用判变化）；
 * 内容没变，已经被某张单取走的旧对象消费时仍认作同一份（consumeAddSizingPlan 按内容比）。
 */
export function touchAddSizingPlan(symbol: string, now: number = Date.now()): void {
  const current = entries.get(symbol);
  if (!current) return;
  write(symbol, { ...current, snapshot: { ...current.snapshot, at: now } });
}

/** 「按上限下单」：发布计划并请求面板预填。 */
export function requestAddSizingPrefill(symbol: string, snapshot: Omit<AddSizingSnapshot, 'at'>, prefill: AddSizingPrefill): void {
  prefillSeq += 1;
  write(symbol, { symbol, snapshot: { ...snapshot, at: Date.now() }, prefill, prefillSeq });
}

/** 面板应用过（或放弃了）这次预填之后调用；计划本身留着给下单入口。 */
export function consumeAddSizingPrefill(seq: number, symbol?: string): void {
  for (const [key, e] of entries) {
    if (symbol != null && key !== symbol) continue;
    if (e.prefillSeq !== seq || !e.prefill) continue;
    write(key, { ...e, prefill: null });
    return;
  }
}

/** 某个标的的计划；不给标的时返回最近一次请求预填 / 发布的那一份（仅供测试与诊断）。 */
export function getAddSizingPlan(symbol?: string): AddSizingPlanEntry | null {
  if (symbol != null) return entries.get(symbol) ?? null;
  let latest: AddSizingPlanEntry | null = null;
  for (const e of entries.values()) {
    if (!latest || e.snapshot.at > latest.snapshot.at || (e.snapshot.at === latest.snapshot.at && e.prefillSeq >= latest.prefillSeq)) latest = e;
  }
  return latest;
}

/**
 * 分场时清掉计划（开始回放、跳到信号时刻、停止回放、合并时间轴、彻底清除标的数据），并记下分场水位：
 * 此刻以前的计划从此不属于当前这一场，撤单也不会把它放回来。
 */
export function clearAddSizingPlan(symbol?: string, now: number = Date.now()): void {
  if (symbol != null) {
    clearedAtBySymbol.set(symbol, Math.max(clearedAtBySymbol.get(symbol) ?? Number.NEGATIVE_INFINITY, now));
    if (entries.has(symbol)) write(symbol, null);
    return;
  }
  clearedAllAt = Math.max(clearedAllAt, now);
  if (entries.size === 0) return;
  entries = new Map();
  emit();
}

/** 只有会立刻或将来**开仓**的类型才配得上计划；分段 / TWAP / 跟踪把一份计划拆成多笔成交，不钉。 */
const PLANNABLE_TYPES: ReadonlySet<OrderType> = new Set<OrderType>(['MARKET', 'LIMIT', 'POST_ONLY', 'CONDITIONAL']);

interface OrderMatch {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  /** 单子的结算方式；计划是按被加仓那条仓位的口径算的，结算方式不同就是另一张合约，不钉。 */
  settlement?: SettlementMode | null;
  now?: number;
}

/**
 * 下单入口先看：同标的、同方向、同结算方式、可钉的类型、仍在保鲜期，才给；**不消费**。
 * 单子可能在后面的校验里被拒（余额不足、保护价方向不对……），拒了计划得留着，改完再下还带得上。
 * 过期的计划顺手清掉。纯函数式地按 now 判保鲜，方便测试。
 */
export function peekAddSizingSnapshotForOrder(args: OrderMatch): AddSizingSnapshot | null {
  const now = args.now ?? Date.now();
  const current = entries.get(args.symbol);
  if (!fresh(current, now)) {
    if (current) write(args.symbol, null);
    return null;
  }
  if (current.snapshot.side !== args.side || !PLANNABLE_TYPES.has(args.type)) return null;
  if (args.settlement != null && current.snapshot.settlement !== args.settlement) return null;
  return current.snapshot;
}

/**
 * 两份快照是不是**同一个计划**：同一个对象，或者除了时刻（at，关弹窗续期会换）与这张单自己的下单参考价（s2AtOrder）之外逐项相同。
 * 下单面板在点「开多 / 开空」那一刻就把计划取走放进单子参数，下单前快照可能填上半小时；
 * 其间计划若被续期换了对象，内容没变仍是同一份。
 */
function samePlan(a: AddSizingSnapshot, b: AddSizingSnapshot): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as Array<keyof AddSizingSnapshot>);
  for (const k of keys) {
    if (k === 'at' || k === 's2AtOrder') continue;
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

/**
 * 单子真的挂出 / 成交了才消费：只清掉**这一份**计划（同一个对象，或内容相同的续期版本），
 * 期间计算器若已发布了不同的新计划就不动。
 */
export function consumeAddSizingPlan(snapshot: AddSizingSnapshot): void {
  for (const [key, e] of entries) {
    if (!samePlan(e.snapshot, snapshot)) continue;
    write(key, null);
    return;
  }
}

/**
 * 撤掉一张带着计划的限价 / 条件委托（手动撤单、成交时保证金不足被撤）：把计划放回去，
 * 紧接着追价下的同向单还带得上它、成交后照样复判——否则撤单等于悄悄扔掉了计划。
 * 只在三件事都成立时放回：计划仍在保鲜期（从它原来的时刻算，不续期）；计划晚于这个标的最后一次分场清除
 * （跳到信号时刻会把旧挂单带进新的一场，那张单上钉的是上一场的计划）；这个标的也没有同样新或更新的计划
 * （放回会覆盖掉它——标的只存一份）。放回去的是计划本身：去掉那张单自己的 s2AtOrder，下一张单会盖上它自己的。
 * 持仓周期与回放时间线由下单入口判（它手里有持仓与时间线）。返回是否放回。
 */
export function restoreAddSizingPlan(symbol: string, snapshot: AddSizingSnapshot | null | undefined, now: number = Date.now()): boolean {
  if (!snapshot || !Number.isFinite(snapshot.at) || !(now - snapshot.at <= ADD_SIZING_PLAN_TTL_MS)) return false;
  if (snapshot.at <= Math.max(clearedAllAt, clearedAtBySymbol.get(symbol) ?? Number.NEGATIVE_INFINITY)) return false;
  const current = entries.get(symbol);
  if (fresh(current, now) && current.snapshot.at >= snapshot.at) return false;
  const { s2AtOrder: _ownOrderPrice, ...plan } = snapshot;
  write(symbol, { symbol, snapshot: plan, prefill: null, prefillSeq: current?.prefillSeq ?? prefillSeq });
  return true;
}

/** 某个标的仍在保鲜期内的计划（计算器重新打开时据此种回输入）；没有或已过期为 null，不清理。 */
export function getFreshAddSizingPlan(symbol: string, now: number = Date.now()): AddSizingSnapshot | null {
  const current = entries.get(symbol);
  return fresh(current, now) ? current.snapshot : null;
}

/** 看 + 消费一步到位；调用方确知单子一定会被接受时用。 */
export function takeAddSizingSnapshotForOrder(args: OrderMatch): AddSizingSnapshot | null {
  const snapshot = peekAddSizingSnapshotForOrder(args);
  if (snapshot) consumeAddSizingPlan(snapshot);
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const getEntries = () => entries;

/** 下单面板订阅：拿到本标的的预填请求（没有则 null）。 */
export function useAddSizingPrefill(symbol: string): { seq: number; prefill: AddSizingPrefill } | null {
  const map = useSyncExternalStore(subscribe, getEntries, getEntries);
  const current = map.get(symbol);
  if (!current || !current.prefill) return null;
  return { seq: current.prefillSeq, prefill: current.prefill };
}

/** 仅供测试。 */
export function __resetAddSizingPlanForTests(): void {
  entries = new Map();
  prefillSeq = 0;
  clearedAtBySymbol.clear();
  clearedAllAt = Number.NEGATIVE_INFINITY;
  listeners.clear();
}
