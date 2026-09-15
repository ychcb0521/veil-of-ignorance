/**
 * 盖了回放时间线章的确定性随机数据集：若干标的 × 若干次坐下来，每次坐下来一棵时间线树（开始 / bootstrap 根，
 * 跳转 / 翻转方向的分叉带着当时开着的仓位与挂着的单），战役的成交 / 腿 / 事件 / 委托快照带章（也有没盖章、
 * 指向登记表里没有的节点的），外加大量同标的的噪声活动。
 * 只含类型导入：影子比对的差分工具可以拿它去喂旧版本的 journalApi。
 */
import type { OpenPositionTimelineLike } from '@/lib/campaignTimelineScope';
import type { ReplayTimelineNode, ReplayTimelineRegistry } from '@/lib/replayTimeline';
import type { CampaignEvent, TradeCampaign, TradeJournal } from '@/types/journal';
import type { CancelledOrderSnapshot, FilledOrderSnapshot, PendingOrder, TradeRecord } from '@/types/trading';

export interface StampedSymbolPlan {
  symbol: string;
  sittings: number;
  campaignsPerSitting: number;
  /** 每条时间线上的噪声条数（成交记录 / 成交快照 / 撤单快照各这么多）。 */
  noisePerNode: number;
}

export interface StampedDataset {
  campaigns: TradeCampaign[];
  journals: TradeJournal[];
  tradeHistory: TradeRecord[];
  filledOrders: FilledOrderSnapshot[];
  cancelledOrders: CancelledOrderSnapshot[];
  ordersMap: Record<string, PendingOrder[]>;
  positionsMap: Record<string, OpenPositionTimelineLike[]>;
  replayTimelines: ReplayTimelineRegistry;
}

const HOUR = 3_600_000;
const MIN = 60_000;
const DAY = 24 * HOUR;
const SIM_BASE = Date.parse('2025-03-01T00:00:00.000Z');
const REAL_BASE = Date.parse('2026-09-01T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function buildStampedCampaignDataset(user: string, plans: StampedSymbolPlan[], seed = 20260915): StampedDataset {
  const rand = mulberry32(seed);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)];
  const campaigns: TradeCampaign[] = [];
  const journals: TradeJournal[] = [];
  const tradeHistory: TradeRecord[] = [];
  const filledOrders: FilledOrderSnapshot[] = [];
  const cancelledOrders: CancelledOrderSnapshot[] = [];
  const ordersMap: Record<string, PendingOrder[]> = {};
  const positionsMap: Record<string, OpenPositionTimelineLike[]> = {};
  const nodes: Record<string, ReplayTimelineNode> = {};
  let sittingCounter = 0;

  const simAt = (node: ReplayTimelineNode, frac: number) =>
    node.forkSimTime + frac * ((node.lastSimTime ?? node.forkSimTime) - node.forkSimTime);
  const realAt = (node: ReplayTimelineNode, frac: number) =>
    node.startedRealAt + frac * ((node.lastRealAt ?? node.startedRealAt) - node.startedRealAt);
  /** 八成五盖本线的章，其余没盖章或指向登记表里没有的节点。 */
  const stamp = (id: string): string | null => {
    const r = rand();
    if (r < 0.85) return id;
    return r < 0.95 ? null : `ghost-${id}`;
  };

  const record = (base: Partial<TradeRecord> & Pick<TradeRecord, 'id' | 'symbol' | 'side' | 'action' | 'openTime' | 'closeTime'>): TradeRecord => ({
    fillId: base.id, positionId: base.id, type: 'MARKET', quantity: 100, leverage: 5, entryPrice: 1, exitPrice: 1.01,
    pnl: 1, fee: 0.1, slippage: 0,
    ...base,
  } as TradeRecord);
  const leg = (base: Partial<TradeJournal> & Pick<TradeJournal, 'id' | 'campaign_id' | 'symbol' | 'leg_role' | 'direction' | 'order_kind' | 'pre_real_time' | 'pre_simulated_time'>): TradeJournal => ({
    user_id: user, trade_record_id: null, leg_sequence: null, source: 'live', leverage: 5, position_mode: 'isolated',
    pre_entry_price: 1, pre_planned_stop_loss: 0.98, pre_planned_take_profit: null, pre_entry_reason: null,
    pre_mental_state: 3, pre_mental_trigger: null, pre_risk_awareness: null, pre_risk_management: null,
    pre_checklist_items: null, pre_checklist_passed: null, pre_position_size: 500, pre_max_loss_usdt: 10,
    pre_account_equity_usdt: 10_000, created_at: base.pre_real_time, updated_at: base.pre_real_time,
    ...base,
  } as TradeJournal);
  const event = (base: Partial<CampaignEvent> & Pick<CampaignEvent, 'id' | 'timestamp' | 'event_type' | 'recorded_at'>): CampaignEvent => ({
    leg_role: null, journal_id: null, trade_record_id: null, pending_order_id: null, price: null, size_usdt: null, notes: null,
    ...base,
  } as CampaignEvent);

  for (const [symbolIndex, plan] of plans.entries()) {
    const { symbol } = plan;
    const symbolNodes: ReplayTimelineNode[] = [];
    const simBase = SIM_BASE + symbolIndex * 90 * DAY;
    /** 分叉节点带着什么，等本次坐下来的仓位与委托都生成完再填。 */
    const carriedLater: Array<{ node: ReplayTimelineNode; positions: Array<{ id: string; realAt: number }>; orders: Array<{ id: string; realAt: number }> }> = [];
    let previousSitting: ReplayTimelineNode[] = [];
    let previousSittingPositions: Array<{ id: string; realAt: number }> = [];

    for (let s = 0; s < plan.sittings; s += 1) {
      // 两次坐下来之间隔 6 小时；模拟时段只在前几成的日子里挑，隔天回放同一段行情很常见
      const realStart = REAL_BASE + sittingCounter * 6 * HOUR;
      sittingCounter += 1;
      const simStart = simBase + Math.floor(rand() * Math.max(1, plan.sittings * 0.4)) * DAY + Math.floor(rand() * 6) * HOUR;
      const resumeFrom = previousSitting.length > 0 && rand() < 0.25 ? pick(previousSitting) : null;
      const sittingNodes: ReplayTimelineNode[] = [];
      const rootId = `${symbol}-s${s}-n0`;
      const rootDirection = 1;
      const rootSpan = between(2, 8) * HOUR;
      const root: ReplayTimelineNode = {
        id: rootId,
        scope: rand() < 0.5 ? 'synced' : `coin:${symbol}`,
        parentId: resumeFrom ? resumeFrom.id : (rand() < 0.05 ? `ghost-parent-${symbol}-${s}` : null),
        cause: resumeFrom ? 'jump' : (rand() < 0.3 ? 'bootstrap' : 'start'),
        direction: rootDirection,
        forkSimTime: resumeFrom ? (resumeFrom.lastSimTime ?? resumeFrom.forkSimTime) + between(-10, 30) * MIN : simStart,
        startedRealAt: realStart,
        endSimTime: null,
        endedRealAt: null,
        carried: {},
        lastSimTime: null,
        lastRealAt: realStart + between(20, 50) * MIN,
      } as ReplayTimelineNode;
      root.lastSimTime = root.forkSimTime + rootSpan;
      sittingNodes.push(root);
      const forks = 1 + Math.floor(rand() * 4);
      let cursorReal = realStart;
      for (let f = 1; f <= forks; f += 1) {
        const parent = pick(sittingNodes);
        const flip = rand() < 0.2;
        const direction = (flip ? -parent.direction : parent.direction) as ReplayTimelineNode['direction'];
        cursorReal += between(2, 20) * MIN;
        const parentLast = parent.lastSimTime ?? parent.forkSimTime;
        const forkSimTime = flip ? parentLast : parent.forkSimTime + between(-0.4, 1.1) * (parentLast - parent.forkSimTime);
        const span = between(1, 5) * HOUR;
        const node = {
          id: `${symbol}-s${s}-n${f}`,
          scope: rand() < 0.85 ? parent.scope : (parent.scope === 'synced' ? `coin:${symbol}` : 'synced'),
          parentId: parent.id,
          cause: flip ? 'flip' : 'jump',
          direction,
          forkSimTime,
          startedRealAt: cursorReal,
          endSimTime: null,
          endedRealAt: null,
          carried: {},
          lastSimTime: forkSimTime + direction * span,
          lastRealAt: cursorReal + between(5, 25) * MIN,
        } as ReplayTimelineNode;
        if (rand() < 0.4) {
          node.endSimTime = node.lastSimTime ?? null;
          node.endedRealAt = node.lastRealAt ?? null;
        }
        sittingNodes.push(node);
        carriedLater.push({ node, positions: [], orders: [] });
      }
      if (resumeFrom) carriedLater.push({ node: root, positions: [], orders: [] });
      for (const node of sittingNodes) nodes[node.id] = node;
      symbolNodes.push(...sittingNodes);
      const sittingPositions: Array<{ id: string; realAt: number }> = [];
      const sittingOrders: Array<{ id: string; realAt: number }> = [];
      const anyNode = () => (rand() < 0.75 ? pick(sittingNodes) : pick(symbolNodes));

      // ===== 本次坐下来里的战役 =====
      for (let c = 0; c < plan.campaignsPerSitting; c += 1) {
        const id = `${symbol}-s${s}-c${c}`;
        const home = pick(sittingNodes);
        const later = rand() < 0.4 ? pick(sittingNodes) : null;
        const isOpen = rand() < 0.2;
        const openTime = Math.round(simAt(home, between(0.05, 0.4)));
        const openedRealAt = Math.round(realAt(home, between(0.05, 0.4)));
        const closeTime = openTime + Math.round(between(1, 6) * HOUR);
        const closedRealAt = openedRealAt + Math.round(between(5, 40) * MIN);
        const closeNode = later ?? home;
        const mainId = `${id}-main`;
        const mainLegId = `${id}-leg-main`;
        const conditionalMain = rand() < 0.15;
        // 一成多的战役是盖章上线之前的老战役：本场自己的操作一个章都没有（委托快照照样带章，那是别的活动）
        const legacy = rand() < 0.12;
        const own = (timelineId: string) => (legacy ? null : stamp(timelineId));
        const events: CampaignEvent[] = [
          event({ id: `${id}-e-open`, timestamp: iso(openTime - 2 * MIN), event_type: 'campaign_opened', recorded_at: iso(openedRealAt - MIN) }),
        ];
        sittingPositions.push({ id: mainId, realAt: openedRealAt });
        if (isOpen) {
          const fills = [{ id: mainId, openTime, openedRealAt, timelineId: own(home.id) }];
          if (rand() < 0.5) {
            const addNode = anyNode();
            fills.push({ id: `${id}-add`, openTime: Math.round(simAt(addNode, rand())), openedRealAt: Math.round(realAt(addNode, rand())), timelineId: own(addNode.id) });
          }
          (positionsMap[symbol] ??= []).push({ id: mainId, openTime, openedRealAt, openTimelineId: own(home.id), fills });
          for (let q = 0; q < 3; q += 1) {
            const node = anyNode();
            const createdRealAt = Math.round(realAt(node, rand()));
            const orderId = `${id}-live${q}`;
            sittingOrders.push({ id: orderId, realAt: createdRealAt });
            (ordersMap[symbol] ??= []).push({
              id: orderId, symbol, side: 'SHORT', type: 'CONDITIONAL', price: 0.98, stopPrice: 0.98, quantity: 50, leverage: 5,
              marginMode: 'isolated', status: 'NEW', reduceOnly: false,
              createdAt: openTime + Math.round(between(-4, 120) * MIN),
              ...(rand() < 0.9 ? { createdRealAt } : {}),
              createdTimelineId: stamp(node.id),
            } as unknown as PendingOrder);
          }
        } else {
          tradeHistory.push(record({
            id: mainId, symbol, side: 'LONG', action: 'CLOSE', openTime, closeTime,
            openedRealAt, closedRealAt: later && later.startedRealAt > openedRealAt ? Math.round(realAt(later, between(0.5, 1))) : closedRealAt,
            openedTimelineId: own(home.id), closedTimelineId: own(closeNode.id), exit_method: 'manual',
          } as Partial<TradeRecord> as TradeRecord));
          // 资金费：只有平仓侧的钟，不作证据
          tradeHistory.push(record({
            id: `${id}-fund`, positionId: mainId, symbol, side: 'LONG', action: 'FUNDING', type: 'FUNDING' as never,
            openTime: openTime + HOUR, closeTime: openTime + HOUR, closedRealAt: openedRealAt + 3 * MIN,
            closedTimelineId: stamp(home.id),
          } as Partial<TradeRecord> as TradeRecord));
        }
        if (conditionalMain) {
          filledOrders.push({
            id: `${id}-cond`, symbol, side: 'LONG', type: 'CONDITIONAL', reduceOnly: false, price: 1, triggerPrice: 1, quantity: 100, leverage: 5,
            createdAt: openTime - 3 * MIN, filledAt: openTime, createdRealAt: openedRealAt - 30_000, filledRealAt: openedRealAt,
            positionId: mainId, createdTimelineId: own(home.id), filledTimelineId: own(home.id),
          } as FilledOrderSnapshot);
        }
        journals.push(leg({
          id: mainLegId, campaign_id: id, symbol, leg_role: 'main_open', leg_sequence: 1, direction: 'long', order_kind: 'main',
          trade_record_id: conditionalMain ? `${id}-cond` : mainId,
          pre_real_time: iso(openedRealAt), pre_simulated_time: iso(openTime),
          ...(rand() < 0.7 ? { pre_timeline_id: own(home.id) } : {}),
          ...(isOpen ? {} : {
            post_exit_price_snapshot: 1.01, post_realized_pnl: 1,
            post_simulated_close_time: iso(closeTime), post_real_close_time: iso(closedRealAt),
          }),
        } as Parameters<typeof leg>[0]));
        const mainEventStamp = rand() < 0.5 ? own(home.id) : null;
        events.push(event({
          id: `${id}-e-main`, timestamp: iso(openTime), event_type: 'main_opened', recorded_at: iso(openedRealAt),
          leg_role: 'main_open', journal_id: mainLegId, trade_record_id: mainId, price: 1, size_usdt: 500,
          ...(mainEventStamp ? { timeline_id: mainEventStamp } : {}),
          operation_time: iso(openedRealAt),
        } as Parameters<typeof event>[0]));

        const hedges = Math.floor(rand() * 4);
        for (let k = 0; k < hedges; k += 1) {
          const createdNode = anyNode();
          const fillNode = rand() < 0.7 ? createdNode : anyNode();
          const orderId = `${id}-o${k}`;
          const hedgeId = `${id}-h${k}`;
          const createdAt = openTime + Math.round(between(-4, 90) * MIN);
          const filledAt = createdAt + Math.round(between(5, 60) * MIN);
          const createdRealAt = Math.round(realAt(createdNode, rand()));
          const filledRealAt = Math.round(Math.max(createdRealAt + 20_000, realAt(fillNode, rand())));
          sittingOrders.push({ id: orderId, realAt: createdRealAt });
          sittingPositions.push({ id: hedgeId, realAt: filledRealAt });
          filledOrders.push({
            id: orderId, symbol, side: 'SHORT', type: 'CONDITIONAL', reduceOnly: false, price: 0.99, triggerPrice: 0.99,
            quantity: 100, leverage: 5, createdAt, filledAt, createdRealAt, filledRealAt, positionId: hedgeId,
            createdTimelineId: stamp(createdNode.id), filledTimelineId: stamp(fillNode.id),
          } as FilledOrderSnapshot);
          tradeHistory.push(record({
            id: hedgeId, symbol, side: 'SHORT', action: 'CLOSE', openTime: filledAt, closeTime: filledAt + HOUR,
            openedRealAt: filledRealAt, closedRealAt: filledRealAt + 2 * MIN,
            openedTimelineId: own(fillNode.id), closedTimelineId: own(fillNode.id), exit_method: 'manual',
          } as Partial<TradeRecord> as TradeRecord));
          journals.push(leg({
            id: `${id}-leg-h${k}`, campaign_id: id, symbol, leg_role: k === 0 ? 'hedge_initial_a' : 'hedge_rolling', leg_sequence: k + 2,
            direction: 'short', order_kind: 'hedge', trade_record_id: hedgeId,
            pre_real_time: iso(filledRealAt), pre_simulated_time: iso(filledAt),
            post_exit_price_snapshot: 0.98, post_realized_pnl: 1,
            post_simulated_close_time: iso(filledAt + HOUR), post_real_close_time: iso(filledRealAt + 2 * MIN),
          }));
          const triggerStamp = rand() < 0.5 ? own(fillNode.id) : null;
          events.push(event({
            id: `${id}-e-ht${k}`, timestamp: iso(filledAt), event_type: 'hedge_triggered', recorded_at: iso(filledRealAt),
            leg_role: k === 0 ? 'hedge_initial_a' : 'hedge_rolling', journal_id: `${id}-leg-h${k}`, trade_record_id: hedgeId,
            pending_order_id: orderId, price: 0.99, size_usdt: 500,
            ...(triggerStamp ? { timeline_id: triggerStamp } : {}),
          } as Parameters<typeof event>[0]));
        }

        const cancelled = 2 + Math.floor(rand() * 7);
        for (let m = 0; m < cancelled; m += 1) {
          const createdNode = anyNode();
          const cancelNode = rand() < 0.6 ? createdNode : anyNode();
          const createdAt = openTime + Math.round(between(-4, 300) * MIN);
          const createdRealAt = Math.round(realAt(createdNode, rand()));
          const orderId = `${id}-c${m}`;
          sittingOrders.push({ id: orderId, realAt: createdRealAt });
          const opening = m % 4 !== 3;
          cancelledOrders.push({
            id: orderId, symbol, side: opening ? 'SHORT' : 'LONG', type: opening ? 'CONDITIONAL' : 'TRAILING_STOP',
            reduceOnly: !opening, linkedPositionId: opening ? null : mainId, price: 0.985, quantity: 100, leverage: 5,
            createdAt, cancelledAt: createdAt + Math.round(between(1, 45) * MIN),
            ...(rand() < 0.92 ? { createdRealAt } : {}),
            cancelledRealAt: Math.round(Math.max(createdRealAt + 5_000, realAt(cancelNode, rand()))),
            createdTimelineId: stamp(createdNode.id), cancelledTimelineId: stamp(cancelNode.id),
          } as CancelledOrderSnapshot);
        }

        if (!isOpen) {
          const closeStamp = rand() < 0.5 ? own(closeNode.id) : null;
          events.push(event({
            id: `${id}-e-close`, timestamp: iso(closeTime), event_type: 'campaign_closed', recorded_at: iso(closedRealAt),
            ...(closeStamp ? { timeline_id: closeStamp } : {}), operation_time: iso(closedRealAt),
          } as Parameters<typeof event>[0]));
        }
        campaigns.push({
          id, user_id: user, campaign_code: `C-${id}`, symbol, direction: 'main_long',
          status: isOpen ? 'active' : 'closed_profit', strategy_template: 'custom', title: id,
          opened_at: iso(openTime - 2 * MIN), closed_at: isOpen ? null : iso(closeTime + 5 * MIN),
          initial_main_size_usdt: 500, initial_leverage: 5, final_realized_pnl: null, final_r_multiple: null,
          peak_unrealized_pnl: null, peak_drawdown: null, importance_weight: c % 3, notes: null,
          actual_evolution: events, deviation_notes: {}, deleted_at: null,
          created_at: iso(openedRealAt), updated_at: iso(closedRealAt),
        } as TradeCampaign);
      }

      // ===== 每条时间线上的噪声活动（不属于任何战役） =====
      for (const node of sittingNodes) {
        for (let n = 0; n < plan.noisePerNode; n += 1) {
          const at = Math.round(simAt(node, rand()));
          const real = Math.round(realAt(node, rand()));
          const tag = `${node.id}-z${n}`;
          const stamped = rand() < 0.9 ? node.id : null;
          tradeHistory.push(record({
            id: `${tag}-r`, symbol, side: n % 2 ? 'LONG' : 'SHORT', action: n % 9 === 0 ? 'FUNDING' : 'CLOSE',
            openTime: at, closeTime: at + Math.round(between(5, 120) * MIN),
            ...(n % 7 === 0 ? {} : { openedRealAt: real, openedTimelineId: stamped }),
            closedRealAt: real + Math.round(between(1, 10) * MIN), closedTimelineId: stamped,
          } as Partial<TradeRecord> as TradeRecord));
          filledOrders.push({
            id: `${tag}-f`, symbol, side: n % 2 ? 'LONG' : 'SHORT', type: 'CONDITIONAL', reduceOnly: n % 3 === 0,
            price: 1, triggerPrice: 1, quantity: 50, leverage: 5, createdAt: at, filledAt: at + 10 * MIN,
            createdRealAt: real, filledRealAt: real + 30_000, createdTimelineId: stamped, filledTimelineId: stamped,
          } as FilledOrderSnapshot);
          cancelledOrders.push({
            id: `${tag}-c`, symbol, side: 'SHORT', type: 'CONDITIONAL', reduceOnly: false, price: 1, quantity: 50, leverage: 5,
            createdAt: at, cancelledAt: at + 5 * MIN, createdRealAt: real, cancelledRealAt: real + 10_000,
            createdTimelineId: stamped, cancelledTimelineId: rand() < 0.5 ? stamped : null,
          } as CancelledOrderSnapshot);
        }
      }

      for (const entry of carriedLater) {
        if (!sittingNodes.includes(entry.node)) continue;
        entry.positions = sittingPositions.filter(p => p.realAt < entry.node.startedRealAt && rand() < 0.7);
        entry.orders = sittingOrders.filter(o => o.realAt < entry.node.startedRealAt && rand() < 0.4);
        if (entry.node === root && resumeFrom) {
          // 隔了一次坐下来接着打：带着上一次坐下来开着的仓位
          entry.positions = previousSittingPositions.filter(() => rand() < 0.6);
        }
        if (rand() < 0.1) continue; // 老节点：这个标的没有分叉快照
        const ids = entry.positions.map(p => p.id);
        entry.node.carried = {
          [symbol]: { positionIds: ids, fillIds: ids, orderIds: entry.orders.map(o => o.id) },
        } as ReplayTimelineNode['carried'];
      }
      previousSitting = sittingNodes;
      previousSittingPositions = sittingPositions;
    }
  }

  // 跨标的：第二个标的的第一场有一条腿引用的 id，同 id 的成交快照先写在本标的、最后写在第一个标的上（以后写的为准）
  if (plans.length > 1) {
    const [first, second] = plans;
    const target = campaigns.find(item => item.symbol === second.symbol);
    const donor = campaigns.find(item => item.symbol === first.symbol && item.closed_at);
    if (target && donor) {
      const donorRecord = tradeHistory.find(item => item.id === `${donor.id}-main`);
      const base = { side: 'LONG', type: 'CONDITIONAL', reduceOnly: false, price: 1, triggerPrice: 1, quantity: 100, leverage: 5 } as const;
      filledOrders.push({
        ...base, id: 'cross-dup', symbol: second.symbol, createdAt: 1, filledAt: 2, positionId: 'nowhere',
      } as FilledOrderSnapshot);
      filledOrders.push({
        ...base, id: 'cross-dup', symbol: first.symbol,
        createdAt: donorRecord?.openTime ?? 1, filledAt: donorRecord?.openTime ?? 2, positionId: `${donor.id}-main`,
        createdRealAt: donorRecord?.openedRealAt, filledRealAt: donorRecord?.openedRealAt,
        createdTimelineId: donorRecord?.openedTimelineId ?? null, filledTimelineId: donorRecord?.openedTimelineId ?? null,
      } as FilledOrderSnapshot);
      const mainLeg = journals.find(item => item.id === `${target.id}-leg-main`) as TradeJournal;
      journals.push({ ...mainLeg, id: `${target.id}-leg-cross`, leg_role: 'standalone', leg_sequence: 9, trade_record_id: 'cross-dup' } as TradeJournal);
    }
  }

  const shuffle = <T,>(items: T[]) => {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  };
  shuffle(tradeHistory);
  shuffle(filledOrders);
  shuffle(cancelledOrders);
  return {
    campaigns, journals, tradeHistory, filledOrders, cancelledOrders, ordersMap, positionsMap,
    replayTimelines: { v: 1, nodes, current: {} },
  };
}

/** 差分与金样本共用的数据规模：两个标的、盖章 / 没盖章 / 找不到节点三种锚点都有。 */
export const TIMELINE_PARITY_PLAN: StampedSymbolPlan[] = [
  { symbol: 'AAAUSDT', sittings: 6, campaignsPerSitting: 3, noisePerNode: 10 },
  { symbol: 'BBBUSDT', sittings: 4, campaignsPerSitting: 2, noisePerNode: 6 },
];

export interface TimelineProjectable {
  pendingOrders: Array<{ id: string }>;
  reverseHedgeOrders: Array<{ id: string; status?: string }>;
  foreignLiveOrders?: Array<{ id: string }>;
  timelineDiagnostics: unknown;
}

/** 对象键排序后的深拷贝：比较 / 取摘要时不受记录的插入顺序影响。 */
export function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map(key => [key, canonicalJson((value as Record<string, unknown>)[key])]));
  }
  return value;
}

/** 影子比对与它牵涉的归属结果（ab1fc4df 起就有的字段）。 */
export function projectTimelineResult(id: string, result: TimelineProjectable) {
  return {
    id,
    pending: result.pendingOrders.map(order => order.id),
    reverse: result.reverseHedgeOrders.map(order => `${order.id}:${order.status ?? '-'}`),
    foreign: (result.foreignLiveOrders ?? []).map(order => order.id),
    diagnostics: canonicalJson(result.timelineDiagnostics),
  };
}

/** cyrb53：把一大段投影压成一个能写进测试的摘要。 */
export function digestOf(value: unknown): string {
  const text = JSON.stringify(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}
