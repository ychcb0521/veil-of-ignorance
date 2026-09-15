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
