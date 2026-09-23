/**
 * Legs 表「占比」列与合计行的多、空两组 Σ：每条腿的币量 / 名义仓位各占**同方向**各腿合计的百分比。
 *
 * 多单与空单分开算：多单各腿占多单合计，空单各腿占空单合计；另一方向从不进这一方向的分母。
 * 页面与 PNG 只有**一列**占比（点列头排序）——【用户要求】不给两列；这一列
 * **按战役主方向取一侧**：主多战役看多单、主空战役看空单（【用户要求】「主空战役里，这一列改成按战役主方向算」），
 * 主力那一侧才是要读的仓位分布；另一侧（对冲）的行留空，也不进分母。
 * 另一侧那一组合计照算，写在合计行「币量 / 仓位」格里（对冲一共开了多大）。
 * 这里的计算、排序与说明按方向对称地写（side 参数），调用方传 resolveLegPositionShareSide 取到的那一侧。
 * 分组按这条腿**实际的持仓方向**（与「涨跌幅」列同一个方向来源），不按角色——
 * 主空战役里的对冲是多单，它就进多单那一组。
 *
 * 上行 = 本腿币量 ÷ Σ同方向各腿币量 × 100%；下行 = 本腿名义仓位 ÷ Σ同方向各腿名义仓位 × 100%。
 * 同一方向里两个分母**各算各的**：缺开仓价的腿没有币量，但名义仓位照样进下行的分母。
 *
 * 页面与 PNG 导出共用这一份。调用方必须传入「币量 / 仓位」格**显示所依据的同一组数**
 * （币量 = 名义 ÷ 开仓价，逐腿只算一次，格子与分母读的是同一份），
 * 以及这条腿是不是真的成了仓位——状态为「挂单中」的腿（对冲 / 镜像腿还没有成交）由调用方按 Legs 表的状态规则判定，
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

/** 按方向的占比列名：页面（读屏名）与 PNG 表头取战役主方向那一侧——主多是「多单占比」，主空是「空单占比」。 */
export const LEG_POSITION_SHARE_COLUMN_TITLES: Record<LegPositionSide, string> = { long: '多单占比', short: '空单占比' };

/** 方向标签的颜色：与币安仓位方向同色（多绿空红）。只给标签用，百分数本身保持中性色。 */
export const LEG_POSITION_SIDE_COLORS: Record<LegPositionSide, string> = { long: '#0ECB81', short: '#F6465D' };

/**
 * 腿的持仓方向 → 分组。与「涨跌幅」列同一个判定：`direction === 'short'` 是空单，其余一律按多单。
 */
export function legPositionSideFromDirection(direction: string | null | undefined): LegPositionSide {
  return direction === 'short' ? 'short' : 'long';
}

/** 主力腿的角色：主力、重新入场主力、各次加仓——它们的方向就是战役的主方向。 */
function isMainLegRole(role: string | null | undefined): boolean {
  return role === 'main_open' || role === 'reentry_main' || (typeof role === 'string' && role.startsWith('main_add_'));
}

/**
 * 「占比」这一列看哪一方向的腿：**按战役主方向**取一侧——主多看多单、主空看空单
 * （【用户要求】「主空战役里，这一列改成按战役主方向算（主多看多单、主空看空单）」）。
 * 主力那一侧才是要读的仓位分布；另一侧是对冲，行留空、也不进分母。
 *
 * 页面与 PNG 共用这一份，两处不可能取到不同的一侧。战役方向读不到（undefined / null / 别的值）时按这个顺序兜底：
 * 1. 主力腿（主力 / 重新入场主力 / 加仓）的持仓方向——它们的方向就是主方向；列在最前的那一条说话（同一场的主力方向一致，数据自相矛盾时取先来的）；
 * 2. 还没有主力腿时，按计入的名义仓位总额取大的那一侧（挂单中的腿不算）；
 * 3. 两侧都没有可加的名义时取多单——与本列原来只算多单的行为一致。
 */
export function resolveLegPositionShareSide(
  campaignDirection: string | null | undefined,
  inputs: readonly LegPositionShareInput[],
): LegPositionSide {
  if (campaignDirection === 'main_short') return 'short';
  if (campaignDirection === 'main_long') return 'long';
  const mainLeg = inputs.find(input => isMainLegRole(input.role));
  if (mainLeg) return mainLeg.side;
  let long = 0;
  let short = 0;
  for (const input of inputs) {
    if (!input.counted || !contributes(input.notional)) continue;
    if (input.side === 'short') short += input.notional;
    else long += input.notional;
  }
  return short > long ? 'short' : 'long';
}

export interface LegPositionShareInput {
  legId: string;
  /** 这条腿实际的持仓方向（用 legPositionSideFromDirection 从 leg.direction 取）。 */
  side: LegPositionSide;
  /** 这条腿的角色（leg_role）。只在战役方向缺失时用来回推主方向（resolveLegPositionShareSide），不参与任何分组。 */
  role?: string | null;
  /** 「币量 / 仓位」格上行显示所依据的币量（未舍入）；缺开仓价时为 null。 */
  coinQty: number | null;
  /** 下行显示所依据的名义仓位（USD，未舍入）。 */
  notional: number | null;
  /** 这条腿是否计入合计：状态为「挂单中」（还没有成交）的为 false。 */
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
 * 这一行在它那个方向里有没有可显示的占比：两行至少有一行是数时返回方向；两行都是「—」（挂单中、缺值）返回 null。
 * tooltip 据此决定说「多单合计里的占比」还是说明为什么不计入。
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
 * 腿行「占比」格的 tooltip：「多单合计里的占比：币量 34.9%，名义仓位 33.6%」（主空战役里是「空单合计里的占比」）。
 * 不挂标签的行：挂单中的说明为什么不计入；其余（缺值）不给 tooltip。
 */
export function describeLegPositionShare(entry: LegPositionShareEntry | null | undefined): string | undefined {
  if (!entry) return undefined;
  const side = legPositionShareTagSide(entry);
  if (side == null) {
    return entry.counted ? undefined : '状态为「挂单中」（还没有成交），不计入多单 / 空单合计';
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
 * 合计行「币量 / 仓位」格里某一组 Σ 是什么：占比列那一侧（战役主方向）的是本列的分母，另一侧不算占比、那组只是合计。
 */
function sideTotalRole(side: LegPositionSide, columnSide: LegPositionSide): string {
  return side === columnSide
    ? `「${LEG_POSITION_SHARE_COLUMN_TITLES[side]}」的分母`
    : `${legPositionSideName(side)}各腿的合计（只看总量，不算占比）`;
}

/**
 * 合计行「币量 / 仓位」格的 tooltip：只说实际列出的那几组（「多单一组…，空单一组…」或只有一组），逐组说明是什么；
 * 一组都没有（两行「—」）时不给——不能告诉用户有一组其实没列出来的合计。
 * columnSide 是占比列当前看的那一侧（战役主方向）：这一侧的那组才是本列的分母。
 */
export function describeLegPositionDenominators(
  sides: readonly LegPositionSideTotals[],
  columnSide: LegPositionSide,
): string | undefined {
  if (sides.length === 0) return undefined;
  const groups = sides
    .map(totals => `${legPositionSideName(totals.side)}一组是${sideTotalRole(totals.side, columnSide)}`)
    .join('，');
  return `${groups}；上行 Σ币量、下行 Σ名义仓位（挂单中的腿不计入）`;
}

/** 点列头排序：降序（大的在上）/ 升序。 */
export type LegPositionShareSortDirection = 'desc' | 'asc';

/** 当前按哪个方向的占比、升还是降排；null 即默认顺序（腿传进来时的先后）。页面只有一列可排，side 恒为战役主方向那一侧。 */
export interface LegPositionShareSort {
  side: LegPositionSide;
  direction: LegPositionShareSortDirection;
}

/**
 * 这条腿按某个方向的占比排序时的键（页面按战役主方向那一侧）：上行币量占比，没有时取下行名义仓位占比。
 * 别的方向的腿（主多战役里的空单、主空战役里的多单）、挂单中的腿、两行都是「—」的腿没有值，返回 null。
 */
export function legPositionShareSortValue(
  entry: LegPositionShareEntry | null | undefined,
  side: LegPositionSide,
): number | null {
  if (!entry || entry.side !== side) return null;
  return entry.coinSharePct ?? entry.notionalSharePct ?? null;
}

/**
 * 排序时比较的键：占比（百分数）按 1e-9 个百分点取整后的整数。
 * 币量 = 名义 ÷ 开仓价，同样 1,000 币开在不同价位，算出来会是 1000、999.9999999999999、1000.0000000000001，
 * 页面上都印成一样的数；按原值比，这些读者眼里并列的行就会随尾差乱跳。
 * 尾差在 1e-13 个百分点量级，1e-9 的粒度远大于它、又远小于任何显示得出来的差别；
 * 取整后比较整数，比「差值小于某个阈值算相等」更可靠——后者不满足传递性，排序结果会不稳定。
 */
function shareSortKey(value: number): number {
  return Math.round(value * 1e9);
}

/**
 * 按某个方向的占比给行排序（页面：占比列的列头），返回新数组、不动入参。
 * 有值的行按值排，并列（取整后相等，见 shareSortKey）保持原来的先后（稳定）；没有值的行不论升降序都沉到最下面，彼此仍按原来的先后。
 * sort 为 null 时原样返回原来的先后。
 */
export function sortByLegPositionShare<T>(
  items: readonly T[],
  entryOf: (item: T) => LegPositionShareEntry | null | undefined,
  sort: LegPositionShareSort | null,
): T[] {
  if (!sort) return [...items];
  const valued: { item: T; index: number; key: number }[] = [];
  const rest: T[] = [];
  items.forEach((item, index) => {
    const value = legPositionShareSortValue(entryOf(item), sort.side);
    if (value == null) rest.push(item);
    else valued.push({ item, index, key: shareSortKey(value) });
  });
  const sign = sort.direction === 'desc' ? -1 : 1;
  valued.sort((a, b) => (a.key === b.key ? a.index - b.index : sign * (a.key - b.key)));
  return [...valued.map(entry => entry.item), ...rest];
}

/** 点一下列头之后的排序：降序 → 升序 → 默认顺序；当前按另一个方向排时，从这个方向的降序开始。 */
export function nextLegPositionShareSort(
  current: LegPositionShareSort | null,
  side: LegPositionSide,
): LegPositionShareSort | null {
  if (!current || current.side !== side) return { side, direction: 'desc' };
  return current.direction === 'desc' ? { side, direction: 'asc' } : null;
}

const SORT_DIRECTION_LABELS: Record<LegPositionShareSortDirection, string> = { desc: '降序', asc: '升序' };

/**
 * 列头按钮的读屏名：当前是什么状态、再点一下会怎样。
 * 「按多单占比排序：当前降序，点击改为升序」。
 */
export function describeLegPositionShareSort(side: LegPositionSide, current: LegPositionShareSort | null): string {
  const title = LEG_POSITION_SHARE_COLUMN_TITLES[side];
  const next = nextLegPositionShareSort(current, side);
  let state: string;
  if (!current) state = '默认顺序';
  else if (current.side === side) state = SORT_DIRECTION_LABELS[current.direction];
  else state = `按${LEG_POSITION_SHARE_COLUMN_TITLES[current.side]}排序`;
  let action: string;
  if (!next) action = '恢复默认顺序';
  else if (current && current.side !== side) action = `改为按${title}${SORT_DIRECTION_LABELS[next.direction]}`;
  else action = `改为${SORT_DIRECTION_LABELS[next.direction]}`;
  return `按${title}排序：当前${state}，点击${action}`;
}

/** 「34.9%」；取整为 0 的印「0.0%」；缺值「—」。各行分别取一位小数。 */
export function formatLegPositionSharePct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const rounded = Number(pct.toFixed(1));
  return `${(rounded === 0 ? 0 : rounded).toFixed(1)}%`;
}

/** 合计行「占比」格：分母为正时是 100.0%，否则「—」。上下两行各调一次。 */
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
