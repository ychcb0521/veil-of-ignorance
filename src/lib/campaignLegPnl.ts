/**
 * 每条 leg 的已实现盈亏，及其对整场战役的贡献率。
 *
 * 本模块只负责「贡献率」这一层。每条腿的盈亏取值口径统一在
 * campaignRealizedPnl.computeCampaignRealizedPnl 里（成交记录优先于复盘快照，
 * 一个仓位的每一刀都算），由调用方把 byLeg 传进来——曾经这里自己算一套、
 * 战役总额另算一套，同一场战役于是有了两个数。未结算的腿是 null 而不是 0，
 * 0 会被误读成「打平」。
 *
 * 贡献率的分母刻意取「各腿盈亏绝对值之和」，而不是战役净盈亏：
 * 一场有对冲的战役里，主力赚 +1000、对冲亏 −200，净额 800。若按净额算，
 * 主力贡献 125%、对冲 −25%，读起来别扭且会超过 100%；按绝对值之和（1200）算，
 * 主力 +83.3%、对冲 −16.7%，各腿份额之和恒为 100%，「谁占了多大分量」一目了然。
 * 符号保留，因此正负一眼可分。
 */
import type { TradeJournal } from '@/types/journal';

export interface LegPnlEntry {
  legId: string;
  /** 已实现盈亏（USDT）；未平仓或无数据时为 null。 */
  pnl: number | null;
  /** 对整场战役的贡献率（小数，1 = 100%）；无法计算时为 null。 */
  contribution: number | null;
}

/**
 * 一次算出所有腿的盈亏与贡献率。必须整体计算——贡献率的分母依赖全部腿，
 * 逐行独立算不出来。
 */
export function computeLegPnlContributions(
  legs: TradeJournal[],
  pnlFor: (leg: TradeJournal) => number | null,
): Map<string, LegPnlEntry> {
  const pnls = legs.map(leg => ({ leg, pnl: pnlFor(leg) }));
  const denominator = pnls.reduce(
    (sum, item) => sum + (item.pnl == null ? 0 : Math.abs(item.pnl)),
    0,
  );
  const result = new Map<string, LegPnlEntry>();
  for (const { leg, pnl } of pnls) {
    result.set(leg.id, {
      legId: leg.id,
      pnl,
      // 分母为 0（全部腿都打平或都没数据）时不出贡献率——除以 0 只会得到 NaN/Infinity
      contribution: pnl == null || denominator <= 0 ? null : pnl / denominator,
    });
  }
  return result;
}

/** 已实现盈亏合计，仅计入有数据的腿。 */
export function sumLegPnl(entries: Iterable<LegPnlEntry>): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.pnl != null) total += entry.pnl;
  }
  return total;
}
