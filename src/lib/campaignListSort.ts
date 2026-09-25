import type { CampaignCardData } from '@/lib/campaignListCache';
import { campaignHasMainAdd, computeAddEfficiency, computeMainPriceEfficiency } from '@/lib/campaignMainPriceChange';
import { campaignAchievedMirrorTp, mirrorTpRank } from '@/lib/mirrorTpSummary';
import { campaignOperationTime } from '@/lib/objectiveOperationTime';
import type { TradeCampaign, TradeJournal } from '@/types/journal';

/**
 * 交易战役列表的排序：每个排序项是一个独立的比较器，排序链按次序依次比较。
 *
 * 【用户要求】「排序方式那里的功能更全面一些，比如可以同时选用两个（及以上）……先让镜像止盈的排序固定下来，
 * 然后在此基础上再排序『加仓效用』」。规则：
 *   · 进不进列表只由第一级决定（与原来单级排序的过滤完全一致）；
 *   · 第一级打平时按第二级比较，再打平看第三级……各级都打平后，退回第一级原有的那串并列裁决；
 *   · 第二级起算不出的战役留在本档、排到本档末尾（不论这一级是升序还是降序）；
 *   · 只有一级时，结果与原来的单级排序逐位相同（见 campaignListSort.parity 测试）。
 *
 * 【用户反馈】「多级排序从第二级开始，排序似乎不起作用了」——线上约 300 场逐位核对过，排序本身没有错：
 * 第一级是连续数值指标（盈亏比、涨跌幅……）时几乎没有并列（274 场 273 档），第二级根本没有可排的余地；
 * 第一级是镜像止盈 / 重要性 / 杠杆时第二级在档内起作用，但加仓效用这类只有四成战役算得出的项，其余六成都在档尾显示「—」。
 * 【用户已定】连续指标作第一级、链上不止一级时先按四分位分成四档（resolveSortBinning），同档内再按后面各级排；
 * 分档按封面显示精度取整（sortBinValue），档界就是那一档里最小的读数（quartileThresholds）——封面读数相同的战役必在同一档，
 * 档界显示出来对每张封面都字面成立。
 * 排序链上每一级标出「本级排了 N 场」（describeSortLevelEffects），一眼看得出第二级有没有起作用：
 * 只数真分出了先后的组，并列的一组读数全相同（镜像止盈某档里全是 5 星、全是 10x）不算排了，记进 tied。
 */
export type CampaignSortMode =
  | 'importance'
  | 'time'
  | 'captureRate'
  | 'expectedDrawdownPct'
  | 'arithmeticExpectancy'
  | 'geometricExpectancy'
  | 'mirrorTp'
  | 'leverage'
  | 'mainPriceChange'
  | 'mainPriceEfficiency'
  | 'addEfficiency'
  | 'alpha';
export type CampaignSortDirection = 'asc' | 'desc';

/** 排序链的一级：按哪一项、哪个方向。 */
export type CampaignSortLevel = {
  mode: CampaignSortMode;
  direction: CampaignSortDirection;
};

/** 排序链：至少一级，各级的排序项互不重复；第一级就是原来单级排序的 mode / direction。 */
export type CampaignSortChain = readonly CampaignSortLevel[];

export const CAMPAIGN_SORT_MODES: readonly CampaignSortMode[] = [
  'time',
  'mirrorTp',
  'expectedDrawdownPct',
  'mainPriceChange',
  'mainPriceEfficiency',
  'captureRate',
  'addEfficiency',
  'geometricExpectancy',
  'arithmeticExpectancy',
  'leverage',
  'importance',
  'alpha',
];

export function isCampaignSortMode(value: unknown): value is CampaignSortMode {
  return typeof value === 'string' && (CAMPAIGN_SORT_MODES as readonly string[]).includes(value);
}

/**
 * 连续数值指标：作第一级且链上不止一级时先按四分位分档（见 resolveSortBinning）。
 * 镜像止盈 / 重要性 / 杠杆倍数 / 字母本来就是分档的；操作时间按【用户已定】的清单不在其列。
 */
export const CONTINUOUS_SORT_MODES: ReadonlySet<CampaignSortMode> = new Set<CampaignSortMode>([
  'expectedDrawdownPct',
  'mainPriceChange',
  'mainPriceEfficiency',
  'captureRate',
  'addEfficiency',
  'geometricExpectancy',
  'arithmeticExpectancy',
]);

export function isContinuousSortMode(mode: CampaignSortMode): boolean {
  return CONTINUOUS_SORT_MODES.has(mode);
}

/** 这条链要不要给第一级分档：链上不止一级，且第一级是连续数值指标。只有一级时永远不分档。 */
export function sortChainBinsFirstLevel(chain: CampaignSortChain): boolean {
  return chain.length > 1 && isContinuousSortMode(chain[0].mode);
}

/** 新选中一项时的默认方向：字母 A→Z，其余从大到小。 */
export function defaultSortDirection(mode: CampaignSortMode): CampaignSortDirection {
  return mode === 'alpha' ? 'asc' : 'desc';
}

export const DEFAULT_CAMPAIGN_SORT_CHAIN: CampaignSortChain = [{ mode: 'time', direction: 'desc' }];

/** 列表页排序依赖的行：封面数据 + 依赖全表统计的两个期望。 */
export type CampaignSortRow = CampaignCardData & {
  arithmeticExpectancy: number | null;
  geometricExpectancy: number | null;
};

// ─── 单场读数（卡片、散点图与排序共用） ─────────────────────────────────────────

export function importanceValue(campaign: Pick<TradeCampaign, 'importance_weight'>): number {
  const value = Number(campaign.importance_weight);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.round(value)));
}

function campaignSortTime(row: CampaignCardData): number {
  return campaignOperationTime(row.legs, row.tradeRecords) ?? 0;
}

function pnlSortValue(campaign: Pick<TradeCampaign, 'final_realized_pnl'>): number {
  const value = Number(campaign.final_realized_pnl);
  return Number.isFinite(value) ? value : Number.NaN;
}

/** 每场战役的实际盈亏比 b = 已实现盈亏 ÷ 初始最大预期亏损（列表口径 = 利润捕获率 ÷ 100）。 */
export function rowPayoffRatio(row: { profitCaptureRatio: number | null }): number | null {
  return row.profitCaptureRatio == null ? null : row.profitCaptureRatio / 100;
}

/** 每场战役的镜像止盈排序权重（成交判定 + 盈亏比 → mirrorTpRank）。 */
export function rowMirrorTpRank(row: CampaignCardData): number {
  return mirrorTpRank(
    campaignAchievedMirrorTp(row.legs, row.tradeRecords),
    rowPayoffRatio(row),
    row.campaign.final_realized_pnl ?? null,
  );
}

/**
 * 战役的杠杆倍数：以主力开仓那一刻记下的初始杠杆为准。
 * 老战役没记这个字段时退回各腿里最大的那个——持仓期内提过杠杆的，按它真正承担过的风险排。
 */
export function campaignLeverage(campaign: TradeCampaign, legs: TradeJournal[]): number {
  const initial = Number(campaign.initial_leverage);
  if (Number.isFinite(initial) && initial > 0) return initial;
  let max = 0;
  for (const leg of legs) {
    const value = Number(leg.leverage);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max;
}

/** 涨跌幅倍数 = 主力涨跌幅 ÷ 预期回撤（公式与说明见 computeMainPriceEfficiency，盈亏概览同一个函数）。 */
export function rowMainPriceEfficiency(row: Pick<CampaignCardData, 'mainPriceChangePct' | 'initialExpectedMaxDrawdownPct'>): number | null {
  return computeMainPriceEfficiency(row.mainPriceChangePct, row.initialExpectedMaxDrawdownPct);
}

/** 加仓效用 = 盈亏比 ÷ 涨跌幅倍数（见 computeAddEfficiency）。 */
export function rowAddEfficiency(row: Pick<CampaignCardData, 'legs' | 'mainPriceChangePct' | 'initialExpectedMaxDrawdownPct' | 'profitCaptureRatio'>): number | null {
  // 【用户要求】没有加仓的战役不算加仓效用（campaignHasMainAdd，与盈亏概览同一个判断）
  if (!campaignHasMainAdd(row.legs)) return null;
  return computeAddEfficiency(rowPayoffRatio(row), rowMainPriceEfficiency(row));
}

// ─── 比较的基本件 ─────────────────────────────────────────────────────────────

const CAMPAIGN_TITLE_COLLATOR = new Intl.Collator(['zh-Hans-CN', 'en'], {
  numeric: true,
  sensitivity: 'base',
});

function compareNumber(a: number, b: number, direction: CampaignSortDirection): number {
  return direction === 'asc' ? a - b : b - a;
}

function compareAlpha(
  a: Pick<TradeCampaign, 'title' | 'symbol'>,
  b: Pick<TradeCampaign, 'title' | 'symbol'>,
  direction: CampaignSortDirection,
): number {
  const aValue = (a.title || a.symbol || '').trim();
  const bValue = (b.title || b.symbol || '').trim();
  const result = CAMPAIGN_TITLE_COLLATOR.compare(aValue, bValue);
  return direction === 'asc' ? result : -result;
}

/** 两侧都有读数才按方向比；缺值（NaN / ±∞）不论方向都排在后面。 */
function compareFiniteMetric(
  aValue: number,
  bValue: number,
  direction: CampaignSortDirection,
): number {
  const aFinite = Number.isFinite(aValue);
  const bFinite = Number.isFinite(bValue);
  if (!aFinite && !bFinite) return 0;
  if (!aFinite) return 1;
  if (!bFinite) return -1;
  return compareNumber(aValue, bValue, direction);
}

function comparePnl(
  a: Pick<TradeCampaign, 'final_realized_pnl'>,
  b: Pick<TradeCampaign, 'final_realized_pnl'>,
  direction: CampaignSortDirection,
): number {
  return compareFiniteMetric(pnlSortValue(a), pnlSortValue(b), direction);
}

// ─── 每个排序项的独立比较器 ───────────────────────────────────────────────────

type RowCompare<T> = (a: T, b: T, direction: CampaignSortDirection) => number;

export type CampaignSortKey<T extends CampaignSortRow = CampaignSortRow> = {
  /** 作为第一级时这场战役进不进列表（与原来单级排序的过滤一致）。 */
  include: (row: T) => boolean;
  /** 这一项算不出：作为第二级及以后时排到本档末尾（不论方向）。 */
  missing: (row: T) => boolean;
  /** 这一项本身的比较（带方向）。 */
  compare: RowCompare<T>;
  /** 这一项作为第一级时原有的并列裁决（链上各级都打平后才用，方向取第一级的）。 */
  tieBreak: RowCompare<T>;
  /** 连续数值指标的读数（分档用）；算不出时 null。分档指标（镜像止盈 / 重要性 / 杠杆 / 字母 / 操作时间）没有。 */
  value?: (row: T) => number | null;
};

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

/** 一次排序内按行缓存读数：比较器会对同一行反复取值（镜像止盈档位、加仓效用都要扫一遍腿）。 */
function memoizeByRow<T extends object, V>(read: (row: T) => V): (row: T) => V {
  const cache = new Map<T, V>();
  return row => {
    if (cache.has(row)) return cache.get(row) as V;
    const value = read(row);
    cache.set(row, value);
    return value;
  };
}

/**
 * 十二个排序项的比较器。每次排序新建一份：读数缓存只活在这一次排序里，行对象换了不会读到旧值。
 * compare + tieBreak 连起来，就是原来单级排序里这一项的那一整串比较，一个字不差。
 */
export function buildCampaignSortKeys<T extends CampaignSortRow>(): Record<CampaignSortMode, CampaignSortKey<T>> {
  const operationTime = memoizeByRow<T, number | null>(row => campaignOperationTime(row.legs, row.tradeRecords));
  // 第一级沿用原口径：没有客观操作时间的战役记作 0（最早）
  const sortTime = (row: T) => operationTime(row) ?? 0;
  const importance = memoizeByRow<T, number>(row => importanceValue(row.campaign));
  const mirrorRank = memoizeByRow<T, number>(rowMirrorTpRank);
  const leverage = memoizeByRow<T, number>(row => campaignLeverage(row.campaign, row.legs));
  const mainPriceEfficiency = memoizeByRow<T, number | null>(rowMainPriceEfficiency);
  const addEfficiency = memoizeByRow<T, number | null>(rowAddEfficiency);

  const importanceDesc = (a: T, b: T) => compareNumber(importance(a), importance(b), 'desc');
  const timeDesc = (a: T, b: T) => compareNumber(sortTime(a), sortTime(b), 'desc');
  const pnlDesc = (a: T, b: T) => comparePnl(a.campaign, b.campaign, 'desc');
  const alphaAsc = (a: T, b: T) => compareAlpha(a.campaign, b.campaign, 'asc');
  /** 大多数项的收尾：重要性 → 操作时间 → 字母。 */
  const importanceTimeAlpha = (a: T, b: T) => importanceDesc(a, b) || timeDesc(a, b) || alphaAsc(a, b);

  /** 数值项：缺值 = 读不出有限数；进列表 = 有读数。 */
  const metric = (
    read: (row: T) => number | null | undefined,
    tieBreak: RowCompare<T>,
  ): CampaignSortKey<T> => ({
    include: row => finite(read(row)),
    missing: row => !finite(read(row)),
    compare: (a, b, direction) => compareFiniteMetric(read(a) ?? Number.NaN, read(b) ?? Number.NaN, direction),
    tieBreak,
    value: row => {
      const value = read(row);
      return finite(value) ? value : null;
    },
  });

  const never = () => false;
  const always = () => true;

  return {
    time: {
      include: always,
      missing: row => operationTime(row) == null,
      compare: (a, b, direction) => compareNumber(sortTime(a), sortTime(b), direction),
      tieBreak: (a, b) => importanceDesc(a, b) || pnlDesc(a, b) || alphaAsc(a, b),
    },
    captureRate: metric(
      row => row.profitCaptureRatio,
      (a, b, direction) => comparePnl(a.campaign, b.campaign, direction) || importanceTimeAlpha(a, b),
    ),
    expectedDrawdownPct: {
      include: row => Number.isFinite(row.initialExpectedMaxDrawdownPct) && row.initialExpectedMaxDrawdownPct > 0,
      missing: row => !(Number.isFinite(row.initialExpectedMaxDrawdownPct) && row.initialExpectedMaxDrawdownPct > 0),
      compare: (a, b, direction) => compareNumber(a.initialExpectedMaxDrawdownPct, b.initialExpectedMaxDrawdownPct, direction),
      tieBreak: importanceTimeAlpha,
      value: row => (Number.isFinite(row.initialExpectedMaxDrawdownPct) && row.initialExpectedMaxDrawdownPct > 0
        ? row.initialExpectedMaxDrawdownPct
        : null),
    },
    arithmeticExpectancy: metric(
      row => row.arithmeticExpectancy,
      (a, b, direction) => compareFiniteMetric(a.geometricExpectancy ?? Number.NaN, b.geometricExpectancy ?? Number.NaN, direction)
        || importanceTimeAlpha(a, b),
    ),
    geometricExpectancy: metric(
      row => row.geometricExpectancy,
      (a, b, direction) => compareFiniteMetric(a.arithmeticExpectancy ?? Number.NaN, b.arithmeticExpectancy ?? Number.NaN, direction)
        || importanceTimeAlpha(a, b),
    ),
    mirrorTp: {
      // 六档每一场都有：没有「算不出」
      include: always,
      missing: never,
      compare: (a, b, direction) => compareNumber(mirrorRank(a), mirrorRank(b), direction),
      tieBreak: (a, b) => pnlDesc(a, b) || importanceTimeAlpha(a, b),
    },
    leverage: {
      include: row => leverage(row) > 0,
      missing: row => !(leverage(row) > 0),
      compare: (a, b, direction) => compareNumber(leverage(a), leverage(b), direction),
      tieBreak: importanceTimeAlpha,
    },
    mainPriceChange: metric(
      row => row.mainPriceChangePct,
      (a, b, direction) => comparePnl(a.campaign, b.campaign, direction) || importanceTimeAlpha(a, b),
    ),
    mainPriceEfficiency: metric(
      mainPriceEfficiency,
      (a, b, direction) => compareFiniteMetric(a.mainPriceChangePct ?? Number.NaN, b.mainPriceChangePct ?? Number.NaN, direction)
        || importanceTimeAlpha(a, b),
    ),
    addEfficiency: metric(
      addEfficiency,
      (a, b, direction) => compareFiniteMetric(a.profitCaptureRatio ?? Number.NaN, b.profitCaptureRatio ?? Number.NaN, direction)
        || importanceTimeAlpha(a, b),
    ),
    alpha: {
      include: always,
      missing: never,
      compare: (a, b, direction) => compareAlpha(a.campaign, b.campaign, direction),
      tieBreak: (a, b) => timeDesc(a, b) || importanceDesc(a, b) || pnlDesc(a, b),
    },
    importance: {
      include: always,
      missing: never,
      compare: (a, b, direction) => compareNumber(importance(a), importance(b), direction),
      tieBreak: (a, b) => timeDesc(a, b) || pnlDesc(a, b) || alphaAsc(a, b),
    },
  };
}

// ─── 连续指标作第一级时的四分位分档 ──────────────────────────────────────────

/** 四分位档：1 = Q1（最低四分之一）… 4 = Q4（最高四分之一）。 */
export type SortQuartile = 1 | 2 | 3 | 4;

/** 第一级的分档结果：档界按进入列表的战役算，同一个值一定落在同一档。 */
export type CampaignSortBinning = {
  mode: CampaignSortMode;
  /** 档界 [q₁, q₂, q₃]：值 ≥ q₃ 为 Q4，≥ q₂ 为 Q3，≥ q₁ 为 Q2，其余 Q1。 */
  thresholds: readonly [number, number, number];
  /** 各档场数，下标 0..3 对应 Q1..Q4。 */
  counts: readonly [number, number, number, number];
  total: number;
};

/**
 * 分档用的读数：按封面显示精度取整，取整表达式与各自的封面格式化函数逐字相同——
 *   · 盈亏比封面写 b = pct ÷ 100 保留两位（campaignPayoffRatioMultiple）→ pct 取整到 1；
 *   · 涨跌幅（roundedPct）、涨跌幅倍数 / 加仓效用（formatEfficiency）、预期回撤、算术期望两位小数；
 *   · 几何期望封面写因子 1 + v 两位小数（formatGeometricExpectancy）→ 取整后再减回 1；
 * 于是封面显示相同的读数必然取整成同一个数、必然同档；档界显示出来对每张封面都字面成立。
 * 分档指标（镜像止盈 / 重要性 / 杠杆 / 字母 / 操作时间）原样返回。
 */
export function sortBinValue(mode: CampaignSortMode, value: number): number {
  switch (mode) {
    case 'captureRate': return Math.round(Number((value / 100).toFixed(2)) * 100);
    case 'geometricExpectancy': return Number((1 + (Math.abs(value) < 0.0005 ? 0 : value)).toFixed(2)) - 1;
    case 'arithmeticExpectancy': {
      const normalized = Math.abs(value) < 0.0005 ? 0 : value;
      const rounded = Number(normalized.toFixed(2));
      // (−0.005, −0.0005] 在封面上写成「-0.00R」：取整到 −0 会变成「+0.00R」，给它一个仍显示「-0.00R」的固定代表值
      return Object.is(rounded, -0) ? -0.001 : rounded;
    }
    case 'expectedDrawdownPct':
    case 'mainPriceChange':
    case 'mainPriceEfficiency':
    case 'addEfficiency': return Number(value.toFixed(2));
    default: return value;
  }
}

/**
 * 四分位档界（R 的默认 type 7 / Excel 的 PERCENTILE.INC：位置 (n−1)·p，落在两个值之间时线性插值），
 * 再把每条档界抬到「≥ 它的最小读数」上：归档一场不变（值 ≥ 档界的集合完全相同），档界却成了那一档里最小的读数，
 * 显示出来与封面对得上（「Q4 ≥ 2.32」= Q4 里最小的一场就是 2.32），不会出现谁也不是的 2.315。
 * 一个值也没有时为 null；只有一个值时三条档界都等于它（全部落在 Q4）。
 */
export function quartileThresholds(values: readonly number[]): readonly [number, number, number] | null {
  const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const at = (p: number) => {
    const position = (sorted.length - 1) * p;
    const lower = Math.floor(position);
    const upper = Math.min(sorted.length - 1, lower + 1);
    return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
  };
  // 插值点夹在 sorted[lower] 与 sorted[upper] 之间，≥ 它的最小读数一定存在
  const snap = (threshold: number) => sorted.find(value => value >= threshold) ?? sorted[sorted.length - 1];
  return [snap(at(0.25)), snap(at(0.5)), snap(at(0.75))];
}

/** 一个值落在哪一档：≥ q₃ → Q4，≥ q₂ → Q3，≥ q₁ → Q2，否则 Q1。相等的值必然同档。 */
export function quartileOf(value: number, thresholds: readonly [number, number, number]): SortQuartile {
  if (value >= thresholds[2]) return 4;
  if (value >= thresholds[1]) return 3;
  if (value >= thresholds[0]) return 2;
  return 1;
}

/**
 * 这条链要给第一级分档时（链上不止一级且第一级是连续指标），按进入列表的战役算出档界；否则 null。
 * 只有一级时永远 null——单级排序与原来逐位相同。
 */
export function resolveSortBinning<T extends CampaignSortRow>(
  rows: readonly T[],
  chain: CampaignSortChain,
  keys: Record<CampaignSortMode, CampaignSortKey<T>> = buildCampaignSortKeys<T>(),
): CampaignSortBinning | null {
  if (!sortChainBinsFirstLevel(chain)) return null;
  const first = chain[0];
  const key = keys[first.mode];
  if (!key.value) return null;
  const values: number[] = [];
  for (const row of rows) {
    if (!key.include(row)) continue;
    const value = key.value(row);
    // 档界与归档都按封面精度取整后的读数算（sortBinValue）
    if (value != null) values.push(sortBinValue(first.mode, value));
  }
  const thresholds = quartileThresholds(values);
  if (!thresholds) return null;
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const value of values) counts[quartileOf(value, thresholds) - 1] += 1;
  return { mode: first.mode, thresholds, counts, total: values.length };
}

/** 第一级带分档时的比较：先比档（方向取第一级的），同档算打平。归档按封面精度取整后的读数（与档界同一口径）。 */
function binnedCompare<T extends CampaignSortRow>(
  key: CampaignSortKey<T>,
  binning: CampaignSortBinning,
  direction: CampaignSortDirection,
): RowCompare<T> {
  const read = key.value as (row: T) => number | null;
  const bin = memoizeByRow<T, SortQuartile>(row => {
    const value = read(row);
    return quartileOf(value == null ? Number.NaN : sortBinValue(binning.mode, value), binning.thresholds);
  });
  return (a, b) => compareNumber(bin(a), bin(b), direction);
}

/**
 * 按排序链排：第一级决定进不进列表；之后各级依次比较（算不出的排到本档末尾）；全部打平再用第一级原有的并列裁决。
 * 链为空时按默认（操作时间从新到旧）。
 * 第一级是连续指标且链上不止一级时，第一级改为按四分位档比较（resolveSortBinning）：同档内按后面各级排，
 * 各级都打平再按第一级本身的数值、最后才是它原有的并列裁决。
 */
export function sortCampaignRows<T extends CampaignSortRow>(rows: readonly T[], chain: CampaignSortChain): T[] {
  const levels = chain.length > 0 ? chain : DEFAULT_CAMPAIGN_SORT_CHAIN;
  const keys = buildCampaignSortKeys<T>();
  const [first, ...rest] = levels;
  const firstKey = keys[first.mode];
  const thenKeys = rest.map(level => ({ key: keys[level.mode], direction: level.direction }));
  const included = rows.filter(row => firstKey.include(row));
  const binning = resolveSortBinning(included, levels, keys);
  const primaryCompare: RowCompare<T> = binning
    ? binnedCompare(firstKey, binning, first.direction)
    : (a, b, direction) => firstKey.compare(a, b, direction);
  return included.sort((a, b) => {
    // 第一级：原来的比较（缺值已被过滤；操作时间缺值按原口径记 0）；分档时先比档
    const primary = primaryCompare(a, b, first.direction);
    if (primary) return primary;
    for (const { key, direction } of thenKeys) {
      const aMissing = key.missing(a);
      const bMissing = key.missing(b);
      if (aMissing || bMissing) {
        if (aMissing && bMissing) continue;
        return aMissing ? 1 : -1;
      }
      const result = key.compare(a, b, direction);
      if (result) return result;
    }
    // 分档时各级都打平：再按第一级本身的数值（保持原有并列裁决在最后）
    if (binning) {
      const own = firstKey.compare(a, b, first.direction);
      if (own) return own;
    }
    return firstKey.tieBreak(a, b, first.direction);
  });
}

// ─── 排序链每一级的作用（排序链芯片上的反馈） ────────────────────────────────

/**
 * 第二级起某一级的作用：前面各级都打平的那些组（≥ 2 场）里，这一级按读数排了几场、几场读数全相同没排、几场算不出。
 * 一组算「本级排了」= 这一组里本级真分出了先后：有读数的行读数不全相同，或有读数的行被排到了算不出的前面。
 *   · groups = 0：前一级没有并列，本级未起作用；
 *   · sorted = 0：并列的各组读数全相同（tied）、或都算不出（missing），一场的先后都没改，本级未起作用。
 */
export type SortLevelEffect = {
  /** 进入本级比较的并列组数（前面各级都打平、且至少两场的组）。 */
  groups: number;
  /** 这些组里的战役总数。 */
  rows: number;
  /** 其中有读数、所在组由本级排出了先后的战役数。 */
  sorted: number;
  /** 其中有读数、但所在组读数全相同（本级没改一场先后）的战役数。 */
  tied: number;
  /** 其中算不出本项、留在组尾的战役数。 */
  missing: number;
};

/**
 * 逐级统计排序链的作用。入参是 sortCampaignRows 排好的行（同一条链）；第一级没有「作用」可言，记 null。
 * 相邻两行前面各级都打平就属于同一组，扫一遍即可。
 */
export function describeSortLevelEffects<T extends CampaignSortRow>(
  sortedRows: readonly T[],
  chain: CampaignSortChain,
): (SortLevelEffect | null)[] {
  const levels = chain.length > 0 ? chain : DEFAULT_CAMPAIGN_SORT_CHAIN;
  if (levels.length <= 1) return levels.map(() => null);
  const keys = buildCampaignSortKeys<T>();
  const [first, ...rest] = levels;
  const firstKey = keys[first.mode];
  const binning = resolveSortBinning(sortedRows, levels, keys);
  const primaryCompare: RowCompare<T> = binning
    ? binnedCompare(firstKey, binning, first.direction)
    : (a, b, direction) => firstKey.compare(a, b, direction);
  const thenKeys = rest.map(level => ({ key: keys[level.mode], direction: level.direction }));
  /** 第 level 级（0 = 第一级）上两行是否打平。 */
  const tiedAt = (a: T, b: T, level: number): boolean => {
    if (level === 0) return primaryCompare(a, b, first.direction) === 0;
    const { key, direction } = thenKeys[level - 1];
    const aMissing = key.missing(a);
    const bMissing = key.missing(b);
    if (aMissing || bMissing) return aMissing && bMissing;
    return key.compare(a, b, direction) === 0;
  };
  const effects: (SortLevelEffect | null)[] = [null];
  for (let level = 1; level < levels.length; level += 1) {
    const { key, direction } = thenKeys[level - 1];
    const effect: SortLevelEffect = { groups: 0, rows: 0, sorted: 0, tied: 0, missing: 0 };
    let start = 0;
    for (let index = 1; index <= sortedRows.length; index += 1) {
      let boundary = index === sortedRows.length;
      if (!boundary) {
        for (let before = 0; before < level; before += 1) {
          if (!tiedAt(sortedRows[index - 1], sortedRows[index], before)) { boundary = true; break; }
        }
      }
      if (!boundary) continue;
      const size = index - start;
      if (size >= 2) {
        effect.groups += 1;
        effect.rows += size;
        // 这一组本级有没有分出先后：有读数的行（已按本级排好，相邻比较即可）读数不全相同，或有读数的行排到了算不出的前面
        let present = 0;
        let missing = 0;
        let distinct = false;
        let previous: T | null = null;
        for (let at = start; at < index; at += 1) {
          const row = sortedRows[at];
          if (key.missing(row)) { missing += 1; continue; }
          present += 1;
          if (previous && key.compare(previous, row, direction) !== 0) distinct = true;
          previous = row;
        }
        if (distinct || (present > 0 && missing > 0)) effect.sorted += present; else effect.tied += present;
        effect.missing += missing;
      }
      start = index;
    }
    effects.push(effect);
  }
  return effects;
}

// ─── 排序链的操作 ─────────────────────────────────────────────────────────────

function flipDirection(direction: CampaignSortDirection): CampaignSortDirection {
  return direction === 'desc' ? 'asc' : 'desc';
}

/**
 * 单击排序项：只按这一项排。
 *   · 已经只按这一项排：再单击切换方向（与原来的单级排序完全一样）；
 *   · 这一项已在多级链里：收成只按它排，保留它当前的方向（再单击才切方向）；
 *   · 其它项：换成它，方向取默认。
 */
export function selectSortMode(chain: CampaignSortChain, mode: CampaignSortMode): CampaignSortChain {
  const existing = chain.find(level => level.mode === mode);
  if (existing && chain.length === 1) return [{ mode, direction: flipDirection(existing.direction) }];
  if (existing) return [{ mode, direction: existing.direction }];
  return [{ mode, direction: defaultSortDirection(mode) }];
}

/** 「+」：把这一项追加为下一级（方向取默认）；已在链里的不重复加。 */
export function appendSortLevel(chain: CampaignSortChain, mode: CampaignSortMode): CampaignSortChain {
  if (chain.some(level => level.mode === mode)) return chain;
  return [...chain, { mode, direction: defaultSortDirection(mode) }];
}

/** 排序链上单独切换某一级的方向。 */
export function toggleSortLevel(chain: CampaignSortChain, index: number): CampaignSortChain {
  if (index < 0 || index >= chain.length) return chain;
  return chain.map((level, at) => (at === index ? { ...level, direction: flipDirection(level.direction) } : level));
}

/** 排序链上单独移除某一级；只剩一级时不再移除（总得按某一项排）。 */
export function removeSortLevel(chain: CampaignSortChain, index: number): CampaignSortChain {
  if (chain.length <= 1 || index < 0 || index >= chain.length) return chain;
  return chain.filter((_, at) => at !== index);
}

/** 「清除」：回到单级，保留第一级（连同它的方向）。 */
export function clearSortChain(chain: CampaignSortChain): CampaignSortChain {
  return chain.length <= 1 ? chain : [chain[0]];
}

/** 排序链的签名：比较两条链是否相同。 */
export function sortChainKey(chain: CampaignSortChain): string {
  return chain.map(level => `${level.mode}.${level.direction}`).join(',');
}

// ─── URL 参数 ─────────────────────────────────────────────────────────────────

/**
 * URL 里的排序链：第一级沿用原来的 sort / direction 两个参数（旧链接照样能读，只有一级时写出来与原来逐字相同），
 * 第二级起每级一个 then 参数，写成「项.方向」，例如
 *   ?sort=mirrorTp&direction=desc&then=addEfficiency.desc&then=captureRate.asc
 * then 缺方向时取默认方向；认不出的项、与前面重复的项一律忽略。
 */
export function parseCampaignSortChain(search: string | URLSearchParams): CampaignSortChain {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const requestedMode = params.get('sort');
  // 认不出的 sort（含已删除的 dsiContribution / usiContribution 旧链接）整条退回默认：操作时间从新到旧，不沿用它的方向与 then
  if (requestedMode != null && !isCampaignSortMode(requestedMode)) return DEFAULT_CAMPAIGN_SORT_CHAIN;
  const mode: CampaignSortMode = isCampaignSortMode(requestedMode) ? requestedMode : DEFAULT_CAMPAIGN_SORT_CHAIN[0].mode;
  const requestedDirection = params.get('direction');
  const direction: CampaignSortDirection = requestedDirection === 'asc' || requestedDirection === 'desc'
    ? requestedDirection
    : defaultSortDirection(mode);
  const chain: CampaignSortLevel[] = [{ mode, direction }];
  for (const raw of params.getAll('then')) {
    const [thenMode, thenDirection] = raw.split('.');
    if (!isCampaignSortMode(thenMode) || chain.some(level => level.mode === thenMode)) continue;
    chain.push({
      mode: thenMode,
      direction: thenDirection === 'asc' || thenDirection === 'desc' ? thenDirection : defaultSortDirection(thenMode),
    });
  }
  return chain;
}

/** 把排序链写回 URL 参数（原地修改）：sort / direction 是第一级，then 是之后各级。 */
export function writeCampaignSortParams(params: URLSearchParams, chain: CampaignSortChain): void {
  const [first, ...rest] = chain.length > 0 ? chain : DEFAULT_CAMPAIGN_SORT_CHAIN;
  params.set('sort', first.mode);
  params.set('direction', first.direction);
  params.delete('then');
  for (const level of rest) params.append('then', `${level.mode}.${level.direction}`);
}
