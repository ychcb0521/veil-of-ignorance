/**
 * 【用户要求】2026-11-02 持仓监测战役的「委托」里放进加仓所参考的支撑线 K：K 是加仓那一刻就挂上的保护整个仓位的卖出止损，
 * 与提前挂好的对冲空单目的、作用一致。状态：下一次加仓把止损上移 → 已替换；价格碰到 K 卖出 → 已触发；
 * 因其它原因卖出 → 已撤；仍持有 → 挂单中。
 */
import type { TradeCampaign, TradeJournal } from '@/types/journal';
export interface AdditionStopOrder { price: number; placedAt: number; status: 'pending' | 'triggered' | 'replaced' | 'cancelled'; endedAt: number | null; label: string; detail: string }
export function qualityAdditionStopOrder(leg: Pick<TradeJournal, 'quality_addition_fill'>, campaign?: Pick<TradeCampaign, 'closed_at' | 'comparison'> | null): AdditionStopOrder | undefined {
  const fill = leg.quality_addition_fill, K = fill?.sizing?.support;
  if (!fill || K == null || !(K > 0) || !Number.isFinite(K)) return;
  const evidence = campaign?.comparison?.sellEvidence, guard = fill.structureEvidence?.guardCloses;
  const label = guard ? '防守线 K' : '支撑线 K', detail = guard ? `5 分钟收盘连续 ${guard} 根低于 K 才卖出` : '价格碰到 K 即卖出全部持仓';
  const fills = evidence?.additionFills ?? [], index = fills.findIndex(f => f.at === fill.at), next = index >= 0 ? fills[index + 1] : undefined;
  if (next) return { price: K, placedAt: fill.at, status: 'replaced', endedAt: next.at, label, detail };
  const closedAt = campaign?.closed_at ? Date.parse(campaign.closed_at) : null;
  if (closedAt == null || !Number.isFinite(closedAt)) return { price: K, placedAt: fill.at, status: 'pending', endedAt: null, label, detail };
  const cause = evidence?.triggerCause, hit = cause?.kind === 'addition-support' && Math.abs(Number(cause.threshold) - K) <= Math.max(1e-12, K * 1e-9);
  return { price: K, placedAt: fill.at, status: hit ? 'triggered' : 'cancelled', endedAt: closedAt, label, detail };
}
