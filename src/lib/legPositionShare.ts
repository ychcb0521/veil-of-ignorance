/**
 * Legs 表「占比」列：每条腿的币量 / 名义仓位各占本场各腿合计的百分比。
 *
 * 上行 = 本腿币量 ÷ Σ各腿币量 × 100%；下行 = 本腿名义仓位 ÷ Σ各腿名义仓位 × 100%。
 * 两个分母**各算各的**：缺开仓价的腿没有币量，但名义仓位照样进下行的分母。
 *
 * 页面与 PNG 导出共用这一份。调用方必须传入「币量 / 仓位」格**显示所依据的同一组数**
 * （币量 = 名义 ÷ 开仓价，逐腿只算一次，格子与分母读的是同一份），
 * 以及这条腿是不是真的成了仓位——状态为「挂单中」的腿（对冲 / 镜像腿还没有成交或平仓记录）由调用方按 Legs 表的状态规则判定，
 * 不进任何分母，两行都显示「—」。
 *
 * 分母按未舍入的原值相加，各行与合计行各自取两位小数：把各行印出来的数手工相加，
 * 末位可能与合计行差几分。
 */

export interface LegPositionShareInput {
  legId: string;
  /** 「币量 / 仓位」格上行显示所依据的币量（未舍入）；缺开仓价时为 null。 */
  coinQty: number | null;
  /** 下行显示所依据的名义仓位（USD，未舍入）。 */
  notional: number | null;
  /** 这条腿是否计入合计：状态为「挂单中」（还没有成交或平仓记录）的为 false。 */
  counted: boolean;
}

export interface LegPositionShareEntry {
  /** 原样带回的显示值：格子与分母读同一份。 */
  coinQty: number | null;
  notional: number | null;
  counted: boolean;
  /** 币量占比，百分数（34.9 表示 34.9%）；不计入、缺值或不为正时为 null。 */
  coinSharePct: number | null;
  /** 名义仓位占比，百分数；不计入、缺值或不为正时为 null。 */
  notionalSharePct: number | null;
}

export interface LegPositionShares {
  byLeg: Map<string, LegPositionShareEntry>;
  /** Σ币量：只含计入、且币量为正的腿；一条都没有时为 null。 */
  totalCoins: number | null;
  /** Σ名义仓位：只含计入、且名义为正的腿；一条都没有时为 null。 */
  totalNotional: number | null;
}

/** 只有正的有限数才进分母：null、0、负数、NaN 都不猜，这一行显示「—」。 */
function contributes(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function computeLegPositionShares(inputs: readonly LegPositionShareInput[]): LegPositionShares {
  let coinSum = 0;
  let coinLegs = 0;
  let notionalSum = 0;
  let notionalLegs = 0;
  for (const input of inputs) {
    if (!input.counted) continue;
    if (contributes(input.coinQty)) {
      coinSum += input.coinQty;
      coinLegs += 1;
    }
    if (contributes(input.notional)) {
      notionalSum += input.notional;
      notionalLegs += 1;
    }
  }
  const totalCoins = coinLegs > 0 && coinSum > 0 ? coinSum : null;
  const totalNotional = notionalLegs > 0 && notionalSum > 0 ? notionalSum : null;

  const byLeg = new Map<string, LegPositionShareEntry>();
  for (const input of inputs) {
    const share = (value: number | null, total: number | null) => (
      input.counted && contributes(value) && total != null ? (value / total) * 100 : null
    );
    byLeg.set(input.legId, {
      coinQty: input.coinQty,
      notional: input.notional,
      counted: input.counted,
      coinSharePct: share(input.coinQty, totalCoins),
      notionalSharePct: share(input.notional, totalNotional),
    });
  }
  return { byLeg, totalCoins, totalNotional };
}

/** 「34.9%」；取整为 0 的印「0.0%」；缺值「—」。各行分别取一位小数。 */
export function formatLegPositionSharePct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const rounded = Number(pct.toFixed(1));
  return `${(rounded === 0 ? 0 : rounded).toFixed(1)}%`;
}

/** 合计行「占比」格：分母为正时是 100.0%，否则「—」。 */
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
