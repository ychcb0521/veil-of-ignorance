/**
 * 主力腿的阶段拆解，与每条腿 / 每个阶段对盈亏比 b 的增减（Δb）。
 *
 * 交易语义：持仓不是铁板一块——每笔对冲的开仓与平仓都会改变净暴露状态。
 * 按这些时刻切成「纯多头 / 对冲 N」阶段，才能看清
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
  /** 同场对冲的完整存续窗口；开仓与平仓都是阶段边界。 */
  hedges: Array<{
    legId: string;
    ordinal?: number;
    openTime?: number | null;
    openPrice?: number | null;
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
  /** 兼容旧调用：结束该段的对冲腿 id。 */
  boundaryLegId: string | null;
  /** 本区间内正在生效的对冲编号；空数组即纯多头阶段。 */
  activeHedgeOrdinals: number[];
  label: string;
}

/** 主力（多 / 空）以及其他多单都显示阶段；空单对冲等辅助腿不显示。 */
export function legSupportsPhases(leg: { leg_role?: string | null; direction?: string | null }): boolean {
  return leg.leg_role === 'main_open'
    || leg.leg_role === 'reentry_main'
    || leg.direction === 'long';
}

/** 没有任何对冲参与时不重复展示整腿；只要存在对冲，前后纯多头区间也完整呈现。 */
export function visibleLegPhases(phases: MainLegPhase[]): MainLegPhase[] {
  return phases.some(phase => phase.activeHedgeOrdinals.length > 0) ? phases : [];
}

const EPS = 1e-12;
/**
 * 小于一分钟的暴露切换通常只是多空腿在同一次平仓操作里的成交先后，
 * 分钟级表格既无法把它读成独立决策，也不应把它误画成一个真实持仓阶段。
 */
export const MIN_VISIBLE_PHASE_DURATION_MS = 60_000;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 把持仓按对冲开仓 / 平仓时刻切成暴露状态阶段。
 * 无有效边界时返回单一阶段（即整腿本身）。
 */
export function splitMainLegPhases(input: MainPhaseInput): MainLegPhase[] {
  const { pnl, entryPrice, exitPrice, openTime, closeTime, hedges } = input;
  if (!isFiniteNumber(entryPrice) || entryPrice <= 0 || !isFiniteNumber(exitPrice) || exitPrice <= 0) {
    return [];
  }

  const validHedges = hedges.filter(h => (
    isFiniteNumber(h.openTime) && isFiniteNumber(h.openPrice) && h.openPrice > 0
    && isFiniteNumber(h.closeTime) && isFiniteNumber(h.closePrice) && h.closePrice > 0
    && h.closeTime > h.openTime
    && (openTime == null || h.closeTime > openTime)
    && (closeTime == null || h.openTime < closeTime)
  ));
  const active = new Set<number>(validHedges
    .filter(h => openTime != null && h.openTime <= openTime && h.closeTime > openTime)
    .map(h => h.ordinal ?? 0));
  const events = validHedges.flatMap(h => [
    { time: h.openTime as number, price: h.openPrice as number, kind: 'open' as const, ordinal: h.ordinal ?? 0, legId: h.legId },
    { time: h.closeTime as number, price: h.closePrice as number, kind: 'close' as const, ordinal: h.ordinal ?? 0, legId: h.legId },
  ]).filter(event => (
    (openTime == null || event.time > openTime) && (closeTime == null || event.time < closeTime)
  )).sort((a, b) => a.time - b.time || (a.kind === 'close' ? -1 : 1));

  const points: Array<{ time: number | null; price: number; active: number[]; boundaryLegId: string | null }> = [];
  let cursorTime = openTime;
  let cursorPrice = entryPrice;
  let index = 0;
  while (index < events.length) {
    const time = events[index].time;
    const sameTime = events.slice(index).filter(event => event.time === time);
    const price = sameTime[0].price;
    points.push({ time: cursorTime, price: cursorPrice, active: [...active].sort((a, b) => a - b), boundaryLegId: sameTime[0].legId });
    for (const event of sameTime) {
      if (event.kind === 'close') active.delete(event.ordinal);
      else active.add(event.ordinal);
    }
    cursorTime = time;
    cursorPrice = price;
    index += sameTime.length;
  }
  points.push({ time: cursorTime, price: cursorPrice, active: [...active].sort((a, b) => a - b), boundaryLegId: null });
  const endpoints = [...points.map(point => ({ time: point.time, price: point.price })), { time: closeTime, price: exitPrice }];

  // 各阶段的原始价差权重（带方向）；Σ权重 = dir × (exit − entry)，telescoping
  const dir = input.side === 'short' ? -1 : 1;
  const rawWeights: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    rawWeights.push(dir * (endpoints[i + 1].price - endpoints[i].price));
  }
  const totalWeight = rawWeights.reduce((sum, w) => sum + w, 0);

  const phases: MainLegPhase[] = [];
  let allocated = 0;
  for (let i = 0; i < points.length; i += 1) {
    const isLast = i === points.length - 1;
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
      endTime: endpoints[i + 1].time,
      startPrice: points[i].price,
      endPrice: endpoints[i + 1].price,
      pnl: phasePnl,
      boundaryLegId: points[i].boundaryLegId,
      activeHedgeOrdinals: points[i].active,
      label: points[i].active.length === 0
        ? input.side === 'short' ? '纯空头阶段' : '纯多头阶段'
        : `对冲${points[i].active.join('+')}阶段`,
    });
  }
  const compacted: MainLegPhase[] = [];
  for (const phase of phases) {
    const duration = phase.startTime == null || phase.endTime == null
      ? null
      : phase.endTime - phase.startTime;
    const isTransient = duration != null && duration >= 0 && duration < MIN_VISIBLE_PHASE_DURATION_MS;
    if (isTransient && compacted.length > 0) {
      const previous = compacted[compacted.length - 1];
      previous.endTime = phase.endTime;
      previous.endPrice = phase.endPrice;
      previous.pnl += phase.pnl;
      previous.boundaryLegId = phase.boundaryLegId;
      continue;
    }
    compacted.push({ ...phase, activeHedgeOrdinals: [...phase.activeHedgeOrdinals] });
  }

  // 极短段若正好出现在开头，只能并入后一段；同时把被极短切换隔开的相同暴露重新接成一段。
  if (compacted.length > 1) {
    const first = compacted[0];
    const duration = first.startTime == null || first.endTime == null ? null : first.endTime - first.startTime;
    if (duration != null && duration >= 0 && duration < MIN_VISIBLE_PHASE_DURATION_MS) {
      const next = compacted[1];
      next.startTime = first.startTime;
      next.startPrice = first.startPrice;
      next.pnl += first.pnl;
      compacted.shift();
    }
  }

  const merged: MainLegPhase[] = [];
  for (const phase of compacted) {
    const previous = merged[merged.length - 1];
    if (previous && previous.label === phase.label) {
      previous.endTime = phase.endTime;
      previous.endPrice = phase.endPrice;
      previous.pnl += phase.pnl;
      previous.boundaryLegId = phase.boundaryLegId;
    } else {
      merged.push(phase);
    }
  }
  return merged.map((phase, phaseIndex) => ({ ...phase, index: phaseIndex + 1 }));
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

/** 两位小数下取不到半个刻度的值就是 0：否则会印出「−0.00」这种自相矛盾的读数。 */
export function roundedDeltaB(delta: number): number {
  const rounded = Number(delta.toFixed(2));
  return rounded === 0 ? 0 : rounded;
}

/** 「+0.43」「-0.06」「0.00」。页面与 PNG 导出共用这一个，两边不许各印各的。 */
export function formatDeltaB(delta: number | null): string {
  if (delta == null) return '—';
  const value = roundedDeltaB(delta);
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}
