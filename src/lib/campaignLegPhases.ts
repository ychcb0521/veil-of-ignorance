/**
 * 主力腿的阶段拆解，与每条腿 / 每个阶段对盈亏比 b 的增减（Δb）。
 *
 * 交易语义：主力不是铁板一块——每一次滚动对冲的结束，意味着主力一个阶段的
 * 完成（主力随即进入下一阶段）。把主力按对冲结束时刻切开，才能看清
 * 「哪一段决策在挣钱、哪一段在回吐」，而不是只看主力整腿的合计。
 *
 * 阶段边界价取对冲的平仓价：对冲平仓发生在同一标的同一时刻，其成交价就是
 * 当时的市价，主力在该时刻的浮盈正是用这个价结算的。
 *
 * 盈亏分摊：线性合约的盈亏与价差成正比，因此把主力的**实际**已实现盈亏按
 * 各阶段价差权重分摊——各阶段之和严格等于主力整腿盈亏（最后一段兜浮点差），
 * 不引入任何臆造数字。
 *
 * Δb：该腿（或该阶段）的盈亏 ÷ 战役的初始最大预期亏损 L。b 的分母正是 L，
 * 所以 Δb 就是这条腿把整场 b 推高 / 拉低了多少个单位——「b 是如何被增加
 * 以及如何被削减的」由此逐腿可见，Σ(Δb) = 战役已实现 b。
 */

export interface MainPhaseInput {
  /** 主力腿的实际已实现盈亏（USDT）。 */
  pnl: number;
  entryPrice: number;
  exitPrice: number;
  openTime: number | null;
  closeTime: number | null;
  side: 'long' | 'short';
  /** 与主力同场的滚动对冲：只取「平仓时刻落在主力持仓期内」的作阶段边界。 */
  hedges: Array<{
    legId: string;
    closeTime: number | null;
    closePrice: number | null;
  }>;
}

export interface MainLegPhase {
  /** 1 起的阶段号。 */
  index: number;
  startTime: number | null;
  endTime: number | null;
  startPrice: number;
  endPrice: number;
  /** 分摊后的阶段盈亏；所有阶段之和 === 主力整腿盈亏。 */
  pnl: number;
  /** 结束该阶段的对冲腿 id；最后一段（主力自身平仓收尾）为 null。 */
  boundaryLegId: string | null;
}

const EPS = 1e-12;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 把主力腿按滚动对冲的结束时刻切成阶段。
 * 无有效边界时返回单一阶段（即整腿本身）。
 */
export function splitMainLegPhases(input: MainPhaseInput): MainLegPhase[] {
  const { pnl, entryPrice, exitPrice, openTime, closeTime, hedges } = input;
  if (!isFiniteNumber(entryPrice) || entryPrice <= 0 || !isFiniteNumber(exitPrice) || exitPrice <= 0) {
    return [];
  }

  // 有效边界：平仓时刻严格落在主力持仓期内（贴着主力平仓的不切——切出来是零长度尾段）
  const boundaries = hedges
    .filter((h): h is { legId: string; closeTime: number; closePrice: number } => (
      isFiniteNumber(h.closeTime)
      && isFiniteNumber(h.closePrice)
      && h.closePrice > 0
      && (openTime == null || h.closeTime > openTime)
      && (closeTime == null || h.closeTime < closeTime)
    ))
    .sort((a, b) => a.closeTime - b.closeTime)
    // 同一时刻多条对冲同时结束只切一次（价格相同，多切出的是零长度段）
    .filter((h, i, arr) => i === 0 || h.closeTime !== arr[i - 1].closeTime);

  // 组装阶段端点：开仓 →（各边界）→ 平仓
  const points: Array<{ time: number | null; price: number; boundaryLegId: string | null }> = [
    { time: openTime, price: entryPrice, boundaryLegId: null },
    ...boundaries.map(b => ({ time: b.closeTime as number | null, price: b.closePrice, boundaryLegId: b.legId })),
    { time: closeTime, price: exitPrice, boundaryLegId: null },
  ];

  // 各阶段的原始价差权重（带方向）；Σ权重 = dir × (exit − entry)，telescoping
  const dir = input.side === 'short' ? -1 : 1;
  const rawWeights: number[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    rawWeights.push(dir * (points[i + 1].price - points[i].price));
  }
  const totalWeight = rawWeights.reduce((sum, w) => sum + w, 0);

  const phases: MainLegPhase[] = [];
  let allocated = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const isLast = i === points.length - 2;
    // 总价差为 0（开平同价）时无法按比例分摊：盈亏全数记在最后一段
    let phasePnl: number;
    if (Math.abs(totalWeight) < EPS) {
      phasePnl = isLast ? pnl : 0;
    } else if (isLast) {
      phasePnl = pnl - allocated; // 最后一段兜浮点差，保证守恒
    } else {
      phasePnl = pnl * (rawWeights[i] / totalWeight);
    }
    allocated += phasePnl;
    phases.push({
      index: i + 1,
      startTime: points[i].time,
      endTime: points[i + 1].time,
      startPrice: points[i].price,
      endPrice: points[i + 1].price,
      pnl: phasePnl,
      boundaryLegId: points[i + 1].boundaryLegId,
    });
  }
  return phases;
}

/**
 * 该盈亏对整场 b 的增减：pnl ÷ 初始最大预期亏损 L。
 * L 无效（缺失 / 非正）时为 null——不臆造。
 */
export function legDeltaB(pnl: number | null, initialExpectedMaxLoss: number | null | undefined): number | null {
  if (pnl == null || !isFiniteNumber(pnl)) return null;
  if (!isFiniteNumber(initialExpectedMaxLoss ?? null) || (initialExpectedMaxLoss as number) <= 0) return null;
  return pnl / (initialExpectedMaxLoss as number);
}
