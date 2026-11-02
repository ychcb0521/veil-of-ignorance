/**
 * 【用户要求】2026-11-02 持仓监测战役的「委托」里放进加仓所参考的支撑线 K：K 是加仓那一刻就挂上的保护整个仓位的卖出止损，
 * 与提前挂好的对冲空单目的、作用一致。状态：下一次加仓把止损上移 → 已上移；支撑线下移减仓把止损挪到 K′ → 已下移；
 * 价格碰到 K 卖出 → 已触发；因其它原因卖出 → 已撤；仍持有 → 挂单中。
 */
import type { TradeCampaign, TradeJournal } from '@/types/journal';
export type AdditionStopStatus = 'pending' | 'triggered' | 'replaced' | 'lowered' | 'cancelled';
export interface AdditionStopOrder { price: number; placedAt: number; status: AdditionStopStatus; endedAt: number | null; label: string; detail: string }
export const additionStopStatusText = (s: AdditionStopStatus) => ({ pending: '挂单中', triggered: '已触发', replaced: '已上移', lowered: '已下移', cancelled: '已撤' })[s];
export const additionStopEndVerb = (s: AdditionStopStatus) => s === 'triggered' ? '触' : s === 'replaced' || s === 'lowered' ? '换' : '撤';
const pct = (x: number) => `${+(x * 100).toFixed(2)}%`;

/** 这条加仓腿挂过的全部止损：加仓时的 K，以及其后每次支撑下移减仓挪到的 K′（按时间先后）。 */
export function qualityAdditionStopOrders(leg: Pick<TradeJournal, 'quality_addition_fill'>, campaign?: Pick<TradeCampaign, 'closed_at' | 'comparison'> | null): AdditionStopOrder[] {
  const fill = leg.quality_addition_fill, K = fill?.sizing?.support;
  if (!fill || K == null || !(K > 0) || !Number.isFinite(K)) return [];
  const evidence = campaign?.comparison?.sellEvidence, guard = fill.structureEvidence?.guardCloses;
  const label = guard ? '防守线 K' : '支撑线 K', detail = guard ? `5 分钟收盘连续 ${guard} 根低于 K 才卖出` : '价格碰到 K 即卖出全部持仓';
  const fills = evidence?.additionFills ?? [], index = fills.findIndex(f => f.at === fill.at), next = index >= 0 ? fills[index + 1] : undefined;
  const moves = (evidence?.additionReductions ?? []).filter(r => r.at > fill.at && (!next || r.at < next.at) && r.newK > 0 && Number.isFinite(r.newK));
  const chain: Omit<AdditionStopOrder, 'status' | 'endedAt'>[] = [{ price: K, placedAt: fill.at, label, detail },
    ...moves.map(r => ({ price: r.newK, placedAt: r.at, label: label.replace('K', 'K′'),
      detail: `支撑线从 ${+r.previousSupport.toPrecision(8)} 下移到 ${+r.newSupport.toPrecision(8)}（${+((r.previousSupport - r.newSupport) / r.atr).toFixed(2)} ATR），止损从 ${+r.previousK.toPrecision(8)} 挪到 ${+r.newK.toPrecision(8)}；${r.fraction > 0 ? `按减仓计算器在 ${+r.price.toPrecision(8)} 减仓 ${pct(r.fraction)}，碰到 K′ 时整笔约保本` : '整笔保本价已低于 K′，无需减仓'}。${detail}` }))];
  const closedAt = campaign?.closed_at ? Date.parse(campaign.closed_at) : null;
  return chain.map((o, i): AdditionStopOrder => {
    const after = chain[i + 1];
    if (after) return { ...o, status: 'lowered', endedAt: after.placedAt };
    if (next) return { ...o, status: 'replaced', endedAt: next.at };
    if (closedAt == null || !Number.isFinite(closedAt)) return { ...o, status: 'pending', endedAt: null };
    const cause = evidence?.triggerCause, hit = cause?.kind === 'addition-support' && Math.abs(Number(cause.threshold) - o.price) <= Math.max(1e-12, o.price * 1e-9);
    return { ...o, status: hit ? 'triggered' : 'cancelled', endedAt: closedAt };
  });
}
/** 加仓那一刻挂上的 K（兼容只看第一张委托的调用方）。 */
export const qualityAdditionStopOrder = (leg: Pick<TradeJournal, 'quality_addition_fill'>, campaign?: Pick<TradeCampaign, 'closed_at' | 'comparison'> | null): AdditionStopOrder | undefined => qualityAdditionStopOrders(leg, campaign)[0];
