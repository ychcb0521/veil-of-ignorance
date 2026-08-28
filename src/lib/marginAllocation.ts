import type { Position } from '@/types/trading';
import { getPositionNotionalUsd } from '@/lib/tradingSettlement';
import { removableMarginUsd } from '@/lib/positionGroupRisk';

/**
 * 把一笔保证金增减，摊到合并卡下面的各笔逐仓仓位上。
 *
 * 为什么需要摊：逐仓的保证金是**逐仓位**记的，爆仓也是逐仓位判的。
 * 合并卡只是一个显示层，钱最终必须落到某几笔具体仓位上。
 *
 * 口径：**按名义等比**。追加 10 万、两腿各占一半，就各得 5 万。
 * 一句话能说清、每一笔都变好、加进来第三笔时行为也不会突变。
 *
 * 我一度想改成"补到各腿强平价相等"（水位法）——那样同样的钱能把最先爆的那一腿
 * 往外推得更远（这张卡上是 1.5–2 倍的效率差）。放弃了，两个理由：
 *   · 它把一个**阶梯**变成一道**悬崖**：原本一笔先爆、其余幸存，改完是全组同一跳一起死。
 *     逐仓 + 损失有界的结构里，最弱那笔先爆既是有界损失、也是一个信号；
 *   · 我当初的理由是"这样卡上那个强平价才成立"——那是**倒因为果**：
 *     卡上的数不对就去改卡上的数，不该去挪用户的钱。那条已经单独修了
 *     （见 positionGroupRisk.firstLiquidationPrice）。
 * 水位法作为**可选口径**另立一项，不做默认。
 */
export type MarginAllocationMode = 'proportional';

export interface MarginAllocationItem {
  positionId: string;
  deltaUsd: number;
}

const positive = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/**
 * 追加：按名义等比分。
 * 减少：按**各自还能减多少**等比分——名义大但已经贴着地板的那笔，不该被要求多吐。
 *
 * 两种情况都保证 Σdelta 与请求值相等（最后一笔吸收舍入残差），
 * 且减少时每一笔都不会被减到初始保证金以下。
 */
export function allocateMarginUsd(args: {
  symbol: string;
  positions: Position[];
  deltaUsd: number;
  markPrice: number;
}): MarginAllocationItem[] {
  const { symbol, positions, deltaUsd, markPrice } = args;
  if (!Number.isFinite(deltaUsd) || deltaUsd === 0 || positions.length === 0) return [];
  if (positions.length === 1) return [{ positionId: positions[0].id, deltaUsd }];

  const adding = deltaUsd > 0;
  const weights = positions.map(p => adding
    ? positive(getPositionNotionalUsd(symbol, p, markPrice > 0 ? markPrice : p.entryPrice))
    : positive(removableMarginUsd(symbol, p)));

  const total = weights.reduce((a, b) => a + b, 0);
  // 权重全为 0：追加时退回等分（名义算不出来也不该整笔丢掉）；减少时无处可减。
  if (!(total > 0)) {
    if (!adding) return [];
    const each = deltaUsd / positions.length;
    return positions.map((p, i) => ({
      positionId: p.id,
      deltaUsd: i === positions.length - 1 ? deltaUsd - each * (positions.length - 1) : each,
    }));
  }

  let assigned = 0;
  const out: MarginAllocationItem[] = [];
  for (let i = 0; i < positions.length; i++) {
    const isLast = i === positions.length - 1;
    // 最后一笔吸收舍入残差，保证总额精确等于请求值。
    const share = isLast ? deltaUsd - assigned : (deltaUsd * weights[i]) / total;
    assigned += share;
    if (share !== 0) out.push({ positionId: positions[i].id, deltaUsd: share });
  }
  return out;
}
