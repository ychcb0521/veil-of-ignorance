/**
 * Deep RSA · 第 4 步：独立于交易行为的未来结果（只当「结果 RDM」的标签，绝不进特征）。
 *
 * 战役标签（理论 b、盈亏比）掺了你的操作：加仓、对冲、止盈时机。为了检验
 * 「表征相似 ↔ 行情结果相似」而不是「↔ 操作结果相似」，另用同一套客观定义：
 * 从 t₀ 后第一根完整 5m K 线的开盘价进场，看结果期内最高 / 最低 / 期末。
 * 背景时点也用同一定义，因此不需要预设它们是失败样本。
 */
import { BAR_MS, type ResearchBar } from '@/lib/deepRsa/window';

/** 默认结果期 24h；是否改用 12h / 48h 由训练 / 验证集决定后冻结。 */
export const OUTCOME_HORIZON_MS = 24 * 60 * 60_000;

export interface ForwardOutcome {
  /** 进场价：openTime = ceil(t₀ / 5m) 那根的开盘价。 */
  entry: number;
  /** ln(结果期内最高价 / 进场价)：多头最大有利波动。 */
  maxUp: number;
  /** ln(结果期内最低价 / 进场价)：多头最大不利波动（≤ 0）。 */
  maxDown: number;
  /** ln(结果期末收盘 / 进场价)。 */
  endRet: number;
  coverage: number;
}

/** 算不出来（进场那根缺失、结果期一根都没有）→ null。结果期不完整时照算，但如实报告覆盖率。 */
export function forwardOutcome(bars: readonly ResearchBar[], anchorMs: number, horizonMs = OUTCOME_HORIZON_MS): ForwardOutcome | null {
  const start = Math.ceil(anchorMs / BAR_MS) * BAR_MS;
  const end = start + horizonMs;
  const byOpen = new Map<number, ResearchBar>();
  for (const bar of bars) {
    if (bar.openTime < start || bar.openTime + BAR_MS > end || bar.openTime % BAR_MS !== 0) continue;
    if (!byOpen.has(bar.openTime)) byOpen.set(bar.openTime, bar);
  }
  const inHorizon = [...byOpen.values()].sort((a, b) => a.openTime - b.openTime);
  if (!inHorizon.length || inHorizon[0].openTime !== start) return null;
  const entry = inHorizon[0].open;
  const maxH = Math.max(...inHorizon.map(b => b.high));
  const minL = Math.min(...inHorizon.map(b => b.low));
  return {
    entry,
    maxUp: Math.log(maxH / entry),
    maxDown: Math.log(minL / entry),
    endRet: Math.log(inHorizon[inHorizon.length - 1].close / entry),
    coverage: inHorizon.length / (horizonMs / BAR_MS),
  };
}
