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
 */
export type CampaignSortMode =
  | 'importance'
  | 'time'
  | 'captureRate'
  | 'expectedDrawdownPct'
  | 'arithmeticExpectancy'
  | 'geometricExpectancy'
  | 'mirrorTp'
  | 'dsiContribution'
  | 'usiContribution'
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
  'dsiContribution',
  'usiContribution',
  'leverage',
  'importance',
  'alpha',
];

export function isCampaignSortMode(value: unknown): value is CampaignSortMode {
  return typeof value === 'string' && (CAMPAIGN_SORT_MODES as readonly string[]).includes(value);
}

/** 新选中一项时的默认方向：字母 A→Z，其余从大到小。 */
export function defaultSortDirection(mode: CampaignSortMode): CampaignSortDirection {
  return mode === 'alpha' ? 'asc' : 'desc';
}

export const DEFAULT_CAMPAIGN_SORT_CHAIN: CampaignSortChain = [{ mode: 'time', direction: 'desc' }];

/** 列表页排序依赖的行：封面数据 + 依赖全表统计的四个数。 */
export type CampaignSortRow = CampaignCardData & {
  arithmeticExpectancy: number | null;
  geometricExpectancy: number | null;
  dsiContributionPct: number | null;
  usiContributionPct: number | null;
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
 * 十四个排序项的比较器。每次排序新建一份：读数缓存只活在这一次排序里，行对象换了不会读到旧值。
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
    // 贡献率两档天然只含一侧样本：DSI 只有亏损战役、USI 只有盈利战役。
    dsiContribution: metric(row => row.dsiContributionPct, importanceTimeAlpha),
    usiContribution: metric(row => row.usiContributionPct, importanceTimeAlpha),
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

/**
 * 按排序链排：第一级决定进不进列表；之后各级依次比较（算不出的排到本档末尾）；全部打平再用第一级原有的并列裁决。
 * 链为空时按默认（操作时间从新到旧）。
 */
export function sortCampaignRows<T extends CampaignSortRow>(rows: readonly T[], chain: CampaignSortChain): T[] {
  const levels = chain.length > 0 ? chain : DEFAULT_CAMPAIGN_SORT_CHAIN;
  const keys = buildCampaignSortKeys<T>();
  const [first, ...rest] = levels;
  const firstKey = keys[first.mode];
  const thenKeys = rest.map(level => ({ key: keys[level.mode], direction: level.direction }));
  return rows.filter(row => firstKey.include(row)).sort((a, b) => {
    // 第一级：原来的比较（缺值已被过滤；操作时间缺值按原口径记 0）
    const primary = firstKey.compare(a, b, first.direction);
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
    return firstKey.tieBreak(a, b, first.direction);
  });
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
