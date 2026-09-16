import type { CancelledOrderSnapshot, FilledOrderSnapshot, PendingOrder } from '@/types/trading';

/**
 * 委托归属到战役时共用的几条口径。
 * 单独成一个小模块：getCampaignFullData（journalApi）与列表页缓存的本地增量核对（campaignListCache）都要用，
 * 而页面测试整个替换 journalApi，这几条纯函数不该跟着被替换掉。
 */

/** 委托按模拟挂单时刻归属到战役的窗口下沿：开主力之前这么久挂的前置对冲也算本场（上沿是平仓时刻）。 */
export const CAMPAIGN_ORDER_WINDOW_LOOKBACK_MS = 5 * 60_000;

/**
 * 成交快照接回平仓记录时按模拟时间兜底的最宽容差（老数据：快照没有仓位 id、或记录没有 fillId）：
 * 记录的开仓模拟时刻与快照的成交模拟时刻相差不超过它才可能接上（getCampaignFullData 的 legacyCandidates）。
 */
export const CAMPAIGN_LEGACY_ORDER_RECORD_MATCH_MS = 15 * 60_000;

/** 委托快照里判「开仓性质」要看的几个字段（挂着的 / 撤掉的 / 成交的三种快照都有）。 */
export type CampaignOrderSnapshotLike = Pick<PendingOrder | CancelledOrderSnapshot | FilledOrderSnapshot, 'side'> & {
  type?: PendingOrder['type'];
  reduceOnly?: boolean;
  reduceKind?: 'TP' | 'SL' | null;
  linkedPositionId?: string | null;
  reducePositionSide?: PendingOrder['reducePositionSide'] | null;
};

/** 止盈 / 止损等平仓性质的委托：黄色委托层与反向对冲都不收它。 */
export function isCampaignPositionClosingOrder(order: CampaignOrderSnapshotLike): boolean {
  return order.reduceOnly === true
    || order.reduceKind != null
    || Boolean(order.linkedPositionId)
    || Boolean(order.reducePositionSide)
    || order.type === 'LIMIT_TP_SL'
    || order.type === 'MARKET_TP_SL';
}

/** 开仓性质的委托空单：战役盘面上唯一记录的委托类型（列表页的本地增量核对也靠它判相关性）。 */
export function isCampaignOpeningShortOrder(order: CampaignOrderSnapshotLike): boolean {
  return order.side === 'SHORT' && !isCampaignPositionClosingOrder(order);
}

/** 至今仍挂着、或已撤掉的委托状态：这张委托没有成交过。 */
const NEVER_FILLED_ORDER_STATUSES = new Set<PendingOrder['status']>(['NEW', 'PENDING', 'ACTIVE', 'CANCELED']);

/**
 * 腿 / 归类事件上挂着的 id 里，本地委托快照能证明**从未成交**的那些委托 id。
 *
 * 通过「记录决策」挂出的保护单，腿上的 trade_record_id 存的是**委托** id（handlePlaceOrder 对挂单返回的是委托 id，
 * 成交后开出的仓位是另一个新 id），从日志腿归类时事件也照抄这个 id。于是「挂着成交 id」不等于「成交过」：
 *   · 本地有这张委托的成交快照（filled_orders）、挂单表里它已触发 / 已成交，或 id 就是本场选中的成交记录 / 仓位 / 成交 id
 *     → 成交过（或可能成交过），不在结果里；
 *   · 本地有它的撤单快照（cancelled_orders），或它仍在挂单表里（orders_map，挂着 / 已撤）→ 从未成交，在结果里；
 *   · 本地都查不到（换了浏览器、老快照被条数上限淘汰）→ 不下结论，不在结果里（照旧当作成交过）。
 * 战役页的权益路径与「Legs 副本」读同一份结果，两边对「挂单中」的判断不会分叉。
 */
export function resolveNeverFilledOrderIds(input: {
  referencedIds: Iterable<string | null | undefined>;
  filledOrders: ReadonlyArray<Pick<FilledOrderSnapshot, 'id'>>;
  cancelledOrders: ReadonlyArray<Pick<CancelledOrderSnapshot, 'id'>>;
  pendingOrders: ReadonlyArray<Pick<PendingOrder, 'id' | 'status'>>;
  /** 本场选中的成交记录上的 id（记录 id、仓位 id、成交 id）：它们本身就证明成交过。 */
  filledRecordIds?: Iterable<string | null | undefined>;
}): string[] {
  const filled = new Set<string>();
  for (const order of input.filledOrders) if (order.id) filled.add(order.id);
  for (const id of input.filledRecordIds ?? []) if (id) filled.add(id);
  const neverFilled = new Set<string>();
  for (const order of input.cancelledOrders) if (order.id) neverFilled.add(order.id);
  for (const order of input.pendingOrders) {
    if (!order.id) continue;
    // 已触发 / 已成交的挂单表条目不下「未成交」的结论
    if (NEVER_FILLED_ORDER_STATUSES.has(order.status)) neverFilled.add(order.id);
    else filled.add(order.id);
  }
  const out = new Set<string>();
  for (const id of input.referencedIds) {
    if (id && neverFilled.has(id) && !filled.has(id)) out.add(id);
  }
  return Array.from(out).sort();
}
