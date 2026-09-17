/**
 * Legs 表「占比」列：每条腿的币量 / 名义仓位各占**同方向**各腿合计的百分比。
 *
 * 多单与空单分开算：多单各腿占多单合计，空单各腿占空单合计（对冲通常是空单）。
 * 分组按这条腿**实际的持仓方向**（与「涨跌幅」列同一个方向来源），不按角色——
 * 主空战役里的对冲是多单，它就进多单那一组。
 *
 * 上行 = 本腿币量 ÷ Σ同方向各腿币量 × 100%；下行 = 本腿名义仓位 ÷ Σ同方向各腿名义仓位 × 100%。
 * 同一方向里两个分母**各算各的**：缺开仓价的腿没有币量，但名义仓位照样进下行的分母。
 *
 * 页面与 PNG 导出共用这一份。调用方必须传入「币量 / 仓位」格**显示所依据的同一组数**
 * （币量 = 名义 ÷ 开仓价，逐腿只算一次，格子与分母读的是同一份），
 * 以及这条腿是不是真的成了仓位——状态为「挂单中」的腿（对冲 / 镜像腿还没有成交或平仓记录）由调用方按 Legs 表的状态规则判定，
 * 不进任何分母，两行都显示「—」。
 *
 * 分母按未舍入的原值相加，各行与合计行各自取两位小数：把各行印出来的数手工相加，
 * 末位可能与合计行差几分。
 */

/** 仓位方向：多单 / 空单。 */
export type LegPositionSide = 'long' | 'short';

/** 合计行里两个方向的先后：先多后空，固定不变。 */
export const LEG_POSITION_SIDES: readonly LegPositionSide[] = ['long', 'short'];

/** 方向标签的字：「多」/「空」。 */
export const LEG_POSITION_SIDE_LABELS: Record<LegPositionSide, string> = { long: '多', short: '空' };

/** 方向标签的颜色：与币安仓位方向同色（多绿空红）。只给标签用，百分数本身保持中性色。 */
export const LEG_POSITION_SIDE_COLORS: Record<LegPositionSide, string> = { long: '#0ECB81', short: '#F6465D' };

/**
 * 腿的持仓方向 → 分组。与「涨跌幅」列同一个判定：`direction === 'short'` 是空单，其余一律按多单。
 */
export function legPositionSideFromDirection(direction: string | null | undefined): LegPositionSide {
  return direction === 'short' ? 'short' : 'long';
}

export interface LegPositionShareInput {
  legId: string;
  /** 这条腿实际的持仓方向（用 legPositionSideFromDirection 从 leg.direction 取）。 */
  side: LegPositionSide;
  /** 「币量 / 仓位」格上行显示所依据的币量（未舍入）；缺开仓价时为 null。 */
  coinQty: number | null;
  /** 下行显示所依据的名义仓位（USD，未舍入）。 */
  notional: number | null;
  /** 这条腿是否计入合计：状态为「挂单中」（还没有成交或平仓记录）的为 false。 */
  counted: boolean;
}

export interface LegPositionShareEntry {
  /** 这条腿归入哪一组（多单 / 空单）。 */
  side: LegPositionSide;
  /** 原样带回的显示值：格子与分母读同一份。 */
  coinQty: number | null;
  notional: number | null;
  counted: boolean;
  /** 同方向内的币量占比，百分数（34.9 表示 34.9%）；不计入、缺值或不为正时为 null。 */
  coinSharePct: number | null;
  /** 同方向内的名义仓位占比，百分数；不计入、缺值或不为正时为 null。 */
  notionalSharePct: number | null;
}

export interface LegPositionSideTotals {
  side: LegPositionSide;
  /** 这一方向的 Σ币量：只含计入、且币量为正的腿；一条都没有时为 null。 */
  totalCoins: number | null;
  /** 这一方向的 Σ名义仓位：只含计入、且名义为正的腿；一条都没有时为 null。 */
  totalNotional: number | null;
}

export interface LegPositionShares {
  byLeg: Map<string, LegPositionShareEntry>;
  /** 多、空两个方向各自的两个分母。 */
  bySide: Record<LegPositionSide, LegPositionSideTotals>;
  /**
   * 合计行要列出的方向：先多后空，只含至少有一个分母为正的方向（即有计入、且带数值的腿）。
   * 两个方向都没有时为空数组——合计行照旧印「—」。
   */
  sides: LegPositionSideTotals[];
}

/** 只有正的有限数才进分母：null、0、负数、NaN 都不猜，这一行显示「—」。 */
function contributes(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function computeLegPositionShares(inputs: readonly LegPositionShareInput[]): LegPositionShares {
  const sums: Record<LegPositionSide, { coins: number; coinLegs: number; notional: number; notionalLegs: number }> = {
    long: { coins: 0, coinLegs: 0, notional: 0, notionalLegs: 0 },
    short: { coins: 0, coinLegs: 0, notional: 0, notionalLegs: 0 },
  };
  for (const input of inputs) {
    if (!input.counted) continue;
    const sum = sums[input.side];
    if (contributes(input.coinQty)) {
      sum.coins += input.coinQty;
      sum.coinLegs += 1;
    }
    if (contributes(input.notional)) {
      sum.notional += input.notional;
      sum.notionalLegs += 1;
    }
  }
  const totalsFor = (side: LegPositionSide): LegPositionSideTotals => {
    const sum = sums[side];
    return {
      side,
      totalCoins: sum.coinLegs > 0 && sum.coins > 0 ? sum.coins : null,
      totalNotional: sum.notionalLegs > 0 && sum.notional > 0 ? sum.notional : null,
    };
  };
  const bySide: Record<LegPositionSide, LegPositionSideTotals> = { long: totalsFor('long'), short: totalsFor('short') };

  const byLeg = new Map<string, LegPositionShareEntry>();
  for (const input of inputs) {
    const totals = bySide[input.side];
    const share = (value: number | null, total: number | null) => (
      input.counted && contributes(value) && total != null ? (value / total) * 100 : null
    );
    byLeg.set(input.legId, {
      side: input.side,
      coinQty: input.coinQty,
      notional: input.notional,
      counted: input.counted,
      coinSharePct: share(input.coinQty, totals.totalCoins),
      notionalSharePct: share(input.notional, totals.totalNotional),
    });
  }
  const sides = LEG_POSITION_SIDES
    .map(side => bySide[side])
    .filter(totals => totals.totalCoins != null || totals.totalNotional != null);
  return { byLeg, bySide, sides };
}

/**
 * 这一行要不要挂「多 / 空」标签：两行占比至少有一行是数时才挂；两行都是「—」（挂单中、缺值）不挂。
 */
export function legPositionShareTagSide(entry: LegPositionShareEntry | null | undefined): LegPositionSide | null {
  if (!entry) return null;
  return entry.coinSharePct != null || entry.notionalSharePct != null ? entry.side : null;
}

/** 「多单」/「空单」。 */
export function legPositionSideName(side: LegPositionSide): string {
  return `${LEG_POSITION_SIDE_LABELS[side]}单`;
}

/**
 * 腿行「占比」格的 tooltip：「多单合计里的占比：币量 34.9%，名义仓位 33.6%」。
 * 不挂标签的行：挂单中的说明为什么不计入；其余（缺值）不给 tooltip。
 */
export function describeLegPositionShare(entry: LegPositionShareEntry | null | undefined): string | undefined {
  if (!entry) return undefined;
  const side = legPositionShareTagSide(entry);
  if (side == null) {
    return entry.counted ? undefined : '状态为「挂单中」（还没有成交或平仓记录），不计入多单 / 空单合计';
  }
  return `${legPositionSideName(side)}合计里的占比：币量 ${formatLegPositionSharePct(entry.coinSharePct)}，`
    + `名义仓位 ${formatLegPositionSharePct(entry.notionalSharePct)}`;
}

/**
 * 合计行「占比」格的 tooltip，一个方向一句：两行都有分母时「多单各腿合计为 100%」；
 * 只有一行有分母时只说那一行——这一方向计入的腿都缺开仓价，币量那行印的是「—」，不能说它合计为 100%。
 */
export function describeLegPositionSideTotal(totals: LegPositionSideTotals): string {
  const name = legPositionSideName(totals.side);
  const hasCoins = contributes(totals.totalCoins);
  const hasNotional = contributes(totals.totalNotional);
  if (hasCoins && hasNotional) return `${name}各腿合计为 100%`;
  if (hasNotional) return `${name}各腿的名义仓位合计为 100%（币量缺开仓价，没有分母）`;
  if (hasCoins) return `${name}各腿的币量合计为 100%（名义仓位缺值，没有分母）`;
  return `${name}没有计入的腿`;
}

/**
 * 合计行「币量 / 仓位」格的 tooltip：只说实际列出的那几组分母（「多单一组、空单一组」或只有一组）；
 * 一组都没有（两行「—」）时不给——不能告诉用户有一组其实没列出来的分母。
 */
export function describeLegPositionDenominators(sides: readonly LegPositionSideTotals[]): string | undefined {
  if (sides.length === 0) return undefined;
  const groups = sides.map(totals => `${legPositionSideName(totals.side)}一组`).join('、');
  return `占比的分母：${groups}，上行 Σ币量、下行 Σ名义仓位（挂单中的腿不计入）`;
}

/** 「34.9%」；取整为 0 的印「0.0%」；缺值「—」。各行分别取一位小数。 */
export function formatLegPositionSharePct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const rounded = Number(pct.toFixed(1));
  return `${(rounded === 0 ? 0 : rounded).toFixed(1)}%`;
}

/** 合计行「占比」格：分母为正时是 100.0%，否则「—」。多、空两组各调一次。 */
export function formatLegPositionShareTotal(total: number | null | undefined): string {
  return contributes(total) ? formatLegPositionSharePct(100) : '—';
}

/** 「币量 / 仓位」格上行：千分位、至多两位小数（1,171,163,720.54）；缺值「—」。腿行与合计行共用。 */
export function formatLegCoinQuantity(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** 「币量 / 仓位」格下行：名义仓位两位小数；缺值「—」。腿行与合计行共用。 */
export function formatLegNotional(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}
