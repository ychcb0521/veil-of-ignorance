/**
 * 每条 leg 的已实现盈亏，及其对整场战役的贡献率。
 *
 * 取值优先级：成交记录 record.pnl（引擎撮合出来的真账）→ leg.post_realized_pnl
 * （复盘时人工填的快照）。前者是事实，后者是回填，事实优先。两者都没有就是 null
 * ——未平仓的腿本就没有已实现盈亏，显示「—」而不是 0，0 会被误读成「打平」。
 *
 * 贡献率的分母刻意取「各腿盈亏绝对值之和」，而不是战役净盈亏：
 * 一场有对冲的战役里，主力赚 +1000、对冲亏 −200，净额 800。若按净额算，
 * 主力贡献 125%、对冲 −25%，读起来别扭且会超过 100%；按绝对值之和（1200）算，
 * 主力 +83.3%、对冲 −16.7%，各腿份额之和恒为 100%，「谁占了多大分量」一目了然。
 * 符号保留，因此正负一眼可分。
 */
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

export interface LegPnlEntry {
  legId: string;
  /** 已实现盈亏（USDT）；未平仓或无数据时为 null。 */
  pnl: number | null;
  /** 对整场战役的贡献率（小数，1 = 100%）；无法计算时为 null。 */
  contribution: number | null;
}

function resolveLegPnl(leg: TradeJournal, record: TradeRecord | null): number | null {
  const fromRecord = record?.pnl;
  if (typeof fromRecord === 'number' && Number.isFinite(fromRecord)) return fromRecord;
  const fromLeg = leg.post_realized_pnl;
  if (typeof fromLeg === 'number' && Number.isFinite(fromLeg)) return fromLeg;
  return null;
}

/**
 * 一次算出所有腿的盈亏与贡献率。必须整体计算——贡献率的分母依赖全部腿，
 * 逐行独立算不出来。
 */
export function computeLegPnlContributions(
  legs: TradeJournal[],
  recordFor: (leg: TradeJournal) => TradeRecord | null,
): Map<string, LegPnlEntry> {
  const pnls = legs.map(leg => ({ leg, pnl: resolveLegPnl(leg, recordFor(leg)) }));
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
