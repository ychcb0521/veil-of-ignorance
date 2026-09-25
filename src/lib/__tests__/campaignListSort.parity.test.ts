import { describe, expect, it } from 'vitest';
import type { CampaignCardData } from '@/lib/campaignListCache';
import { campaignHasMainAdd, computeAddEfficiency, computeMainPriceEfficiency } from '@/lib/campaignMainPriceChange';
import { campaignAchievedMirrorTp, mirrorTpRank } from '@/lib/mirrorTpSummary';
import { campaignOperationTime } from '@/lib/objectiveOperationTime';
import {
  CAMPAIGN_SORT_MODES,
  sortCampaignRows,
  type CampaignSortDirection,
  type CampaignSortMode,
  type CampaignSortRow,
} from '@/lib/campaignListSort';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import { makeSortRow, randomSortRows } from '@/test/fixtures/campaignSortRows';

/**
 * 【硬性要求】只有一级时，排序结果必须与改动前的单级排序逐位相同。
 * 下面是改动前（c51c45f2）战役列表页里那一整段排序代码的原样拷贝（只把函数名改成 legacySortCampaignRows），
 * 作为冻结的对照实现：新实现（排序链只有一级）与它在同一批战役上排出的顺序必须完全一致。
 * 这段拷贝不要跟着新实现改——它存在的意义就是「旧版长什么样」。
 */
type CampaignDisplayData = CampaignSortRow;
type CampaignSortState = { mode: CampaignSortMode; direction: CampaignSortDirection };

// ─── 以下为改动前的原样拷贝 ───────────────────────────────────────────────

const CAMPAIGN_TITLE_COLLATOR = new Intl.Collator(['zh-Hans-CN', 'en'], {
  numeric: true,
  sensitivity: 'base',
});

function importanceValue(campaign: Pick<TradeCampaign, 'importance_weight'>): number {
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

/** 每场战役的实际盈亏比 b = 已实现盈亏 ÷ 初始最大预期亏损（列表口径 = 利润捕获率 ÷ 100）。 */
function rowPayoffRatio(row: { profitCaptureRatio: number | null }): number | null {
  return row.profitCaptureRatio == null ? null : row.profitCaptureRatio / 100;
}

/** 每场战役的镜像止盈排序权重（成交判定 + 盈亏比 → mirrorTpRank）。 */
function rowMirrorTpRank(row: CampaignCardData): number {
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
function campaignLeverage(campaign: TradeCampaign, legs: TradeJournal[]): number {
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
function rowMainPriceEfficiency(row: Pick<CampaignCardData, 'mainPriceChangePct' | 'initialExpectedMaxDrawdownPct'>): number | null {
  return computeMainPriceEfficiency(row.mainPriceChangePct, row.initialExpectedMaxDrawdownPct);
}

/** 加仓效用 = 盈亏比 ÷ 涨跌幅倍数（见 computeAddEfficiency）。 */
function rowAddEfficiency(row: Pick<CampaignCardData, 'legs' | 'mainPriceChangePct' | 'initialExpectedMaxDrawdownPct' | 'profitCaptureRatio'>): number | null {
  // 【用户要求】没有加仓的战役不算加仓效用（campaignHasMainAdd，与盈亏概览同一个判断）
  if (!campaignHasMainAdd(row.legs)) return null;
  return computeAddEfficiency(rowPayoffRatio(row), rowMainPriceEfficiency(row));
}

function legacySortCampaignRows(rows: CampaignDisplayData[], sort: CampaignSortState): CampaignDisplayData[] {
  const visibleRows = rows.filter(row => {
    if (sort.mode === 'captureRate') {
      return row.profitCaptureRatio != null && Number.isFinite(row.profitCaptureRatio);
    }
    if (sort.mode === 'expectedDrawdownPct') {
      return Number.isFinite(row.initialExpectedMaxDrawdownPct)
        && row.initialExpectedMaxDrawdownPct > 0;
    }
    if (sort.mode === 'arithmeticExpectancy') {
      return row.arithmeticExpectancy != null && Number.isFinite(row.arithmeticExpectancy);
    }
    if (sort.mode === 'geometricExpectancy') {
      return row.geometricExpectancy != null && Number.isFinite(row.geometricExpectancy);
    }
    // 贡献率两档天然只含一侧样本：DSI 只有亏损战役、USI 只有盈利战役。
    if (sort.mode === 'dsiContribution') {
      return row.dsiContributionPct != null && Number.isFinite(row.dsiContributionPct);
    }
    if (sort.mode === 'usiContribution') {
      return row.usiContributionPct != null && Number.isFinite(row.usiContributionPct);
    }
    if (sort.mode === 'leverage') {
      return campaignLeverage(row.campaign, row.legs) > 0;
    }
    if (sort.mode === 'mainPriceChange') {
      return row.mainPriceChangePct != null && Number.isFinite(row.mainPriceChangePct);
    }
    if (sort.mode === 'mainPriceEfficiency') {
      return rowMainPriceEfficiency(row) != null;
    }
    if (sort.mode === 'addEfficiency') {
      return rowAddEfficiency(row) != null;
    }
    return true;
  });
  return [...visibleRows].sort((a, b) => {
    const importanceDesc = compareNumber(importanceValue(a.campaign), importanceValue(b.campaign), 'desc');
    const timeDesc = compareNumber(campaignSortTime(a), campaignSortTime(b), 'desc');
    const pnlDesc = comparePnl(a.campaign, b.campaign, 'desc');
    const alphaAsc = compareAlpha(a.campaign, b.campaign, 'asc');

    if (sort.mode === 'time') {
      return compareNumber(campaignSortTime(a), campaignSortTime(b), sort.direction)
        || importanceDesc
        || pnlDesc
        || alphaAsc;
    }
    if (sort.mode === 'captureRate') {
      return compareFiniteMetric(
        a.profitCaptureRatio ?? Number.NaN,
        b.profitCaptureRatio ?? Number.NaN,
        sort.direction,
      )
        || comparePnl(a.campaign, b.campaign, sort.direction)
        || importanceDesc
        || timeDesc
        || alphaAsc;
    }
    if (sort.mode === 'expectedDrawdownPct') {
      return compareNumber(
        a.initialExpectedMaxDrawdownPct,
        b.initialExpectedMaxDrawdownPct,
        sort.direction,
      )
        || importanceDesc
        || timeDesc
        || alphaAsc;
    }
    if (sort.mode === 'arithmeticExpectancy') {
      return compareFiniteMetric(
        a.arithmeticExpectancy ?? Number.NaN,
        b.arithmeticExpectancy ?? Number.NaN,
        sort.direction,
      )
        || compareFiniteMetric(
          a.geometricExpectancy ?? Number.NaN,
          b.geometricExpectancy ?? Number.NaN,
          sort.direction,
        )
        || importanceDesc
        || timeDesc
        || alphaAsc;
    }
    if (sort.mode === 'geometricExpectancy') {
      return compareFiniteMetric(
        a.geometricExpectancy ?? Number.NaN,
        b.geometricExpectancy ?? Number.NaN,
        sort.direction,
      )
        || compareFiniteMetric(
          a.arithmeticExpectancy ?? Number.NaN,
          b.arithmeticExpectancy ?? Number.NaN,
          sort.direction,
        )
        || importanceDesc
        || timeDesc
        || alphaAsc;
    }
    if (sort.mode === 'mirrorTp') {
      return compareNumber(rowMirrorTpRank(a), rowMirrorTpRank(b), sort.direction)
        || pnlDesc
        || importanceDesc
        || timeDesc
        || alphaAsc;
    }
    if (sort.mode === 'dsiContribution') {
      return compareFiniteMetric(
        a.dsiContributionPct ?? Number.NaN,
        b.dsiContributionPct ?? Number.NaN,
        sort.direction,
      )
        || importanceDesc
        || timeDesc
        || alphaAsc;
    }
    if (sort.mode === 'usiContribution') {
      return compareFiniteMetric(
        a.usiContributionPct ?? Number.NaN,
        b.usiContributionPct ?? Number.NaN,
        sort.direction,
      )
        || importanceDesc
        || timeDesc
        || alphaAsc;
    }
    if (sort.mode === 'leverage') {
      return compareNumber(
        campaignLeverage(a.campaign, a.legs),
        campaignLeverage(b.campaign, b.legs),
        sort.direction,
      )
        || importanceDesc
        || timeDesc
        || alphaAsc;
    }
    if (sort.mode === 'mainPriceChange') {
      return compareFiniteMetric(
        a.mainPriceChangePct ?? Number.NaN,
        b.mainPriceChangePct ?? Number.NaN,
        sort.direction,
      )
        || comparePnl(a.campaign, b.campaign, sort.direction)
        || importanceDesc
        || timeDesc
        || alphaAsc;
    }
    if (sort.mode === 'mainPriceEfficiency') {
      return compareFiniteMetric(
        rowMainPriceEfficiency(a) ?? Number.NaN,
        rowMainPriceEfficiency(b) ?? Number.NaN,
        sort.direction,
      )
        || compareFiniteMetric(a.mainPriceChangePct ?? Number.NaN, b.mainPriceChangePct ?? Number.NaN, sort.direction)
        || importanceDesc
        || timeDesc
        || alphaAsc;
    }
    if (sort.mode === 'addEfficiency') {
      return compareFiniteMetric(
        rowAddEfficiency(a) ?? Number.NaN,
        rowAddEfficiency(b) ?? Number.NaN,
        sort.direction,
      )
        || compareFiniteMetric(a.profitCaptureRatio ?? Number.NaN, b.profitCaptureRatio ?? Number.NaN, sort.direction)
        || importanceDesc
        || timeDesc
        || alphaAsc;
    }
    if (sort.mode === 'alpha') {
      return compareAlpha(a.campaign, b.campaign, sort.direction)
        || timeDesc
        || importanceDesc
        || pnlDesc;
    }
    return compareNumber(importanceValue(a.campaign), importanceValue(b.campaign), sort.direction)
      || timeDesc
      || pnlDesc
      || alphaAsc;
  });
}

// ─── 原样拷贝到此为止 ─────────────────────────────────────────────────────

const ids = (rows: readonly CampaignSortRow[]) => rows.map(row => row.campaign.id);
const DIRECTIONS: CampaignSortDirection[] = ['desc', 'asc'];

/** 手写的一批：每一项都有并列、有缺值，镜像止盈六档与有无加仓都覆盖到。 */
const HANDPICKED: CampaignSortRow[] = [
  makeSortRow({ id: 'a', title: 'SOL 趋势回踩', pnl: 420, importance: 3, leverage: 10, time: '2026-09-03T08:00:00.000Z', tp: true, add: true, pcr: 420, dd: 2, mpc: 6, arith: 1.6, geo: 1.42, usi: 30 }),
  makeSortRow({ id: 'b', title: 'ETH 突破加仓', pnl: 250, leverage: 20, time: '2026-09-09T08:00:00.000Z', tp: true, add: true, pcr: 250, dd: 2.5, mpc: 2.5, arith: 0.75, geo: 1.25, usi: 18 }),
  makeSortRow({ id: 'c', title: 'BNB 镜像止盈', pnl: 180, leverage: 5, time: '2026-09-12T08:00:00.000Z', tp: true, pcr: 180, dd: 2, mpc: 3.6, arith: 0.4, geo: 1.18, usi: 12 }),
  makeSortRow({ id: 'd', title: 'BTC 周线共振', pnl: 600, importance: 5, leverage: 15, time: '2026-09-05T08:00:00.000Z', tp: true, add: true, pcr: 600, dd: 1.5, mpc: 6, arith: 2.5, geo: 1.6, usi: 40 }),
  makeSortRow({ id: 'e', title: 'DOGE 假突破', pnl: -60, leverage: 10, time: '2026-09-07T08:00:00.000Z', tp: true, add: true, pcr: -60, dd: 2, mpc: 1, arith: -0.8, geo: 0.94, dsi: 30 }),
  makeSortRow({ id: 'f', title: 'AVAX 反抽', pnl: -90, time: '2026-09-14T08:00:00.000Z', tp: true, pcr: -90, dd: 3, mpc: -0.4, arith: -0.95, geo: 0.91, dsi: 45 }),
  makeSortRow({ id: 'g', title: 'SUI 打平离场', pnl: 5, time: '2026-09-04T08:00:00.000Z', tp: true, add: true, pcr: 5, dd: 2, mpc: 0.2, arith: -0.47, geo: 1 }),
  makeSortRow({ id: 'h', title: 'LINK 区间', pnl: 120, leverage: 8, time: '2026-09-11T08:00:00.000Z', add: true, pcr: 120, dd: 3, mpc: 2, arith: 0.1, geo: 1.12, usi: 10 }),
  makeSortRow({ id: 'i', title: 'ARB 回踩', pnl: 80, time: '2026-09-02T08:00:00.000Z', pcr: 80, dd: 2.5, mpc: 2, arith: -0.1, geo: 1.08 }),
  makeSortRow({ id: 'j', title: 'TIA 二次加仓', pnl: 210, leverage: 12, time: '2026-09-08T08:00:00.000Z', add: true, pcr: 210, dd: 1.4, mpc: 2.8, arith: 0.55, geo: 1.21, usi: 20 }),
  makeSortRow({ id: 'k', title: 'OP 追高', pnl: -100, time: '2026-09-06T08:00:00.000Z', pcr: -100, dd: 2, mpc: -2, arith: -1, geo: 0.9, dsi: 25 }),
  makeSortRow({ id: 'l', title: 'APT 抄底', pnl: -130, importance: 2, time: '2026-09-10T08:00:00.000Z', add: true, pcr: -130, dd: 2.5, mpc: -1.5, arith: -1.15, geo: 0.87 }),
  // 缺值与并列：没有初始最大预期亏损、没有操作时间、没有杠杆、盈亏为空、同名
  makeSortRow({ id: 'm', title: 'SOL 趋势回踩', pnl: null, time: null }),
  makeSortRow({ id: 'n', title: 'ETH 突破加仓', pnl: 250, leverage: null, legLeverage: 20, time: '2026-09-09T08:00:00.000Z', tp: true, add: true, pcr: 250, dd: 2.5, mpc: 2.5, arith: 0.75, geo: 1.25 }),
  makeSortRow({ id: 'o', title: '', symbol: 'XRPUSDT', pnl: 0, time: null, add: true, pcr: 0, dd: 0, mpc: 0 }),
];

describe('排序链只有一级时与改动前的单级排序逐位相同', () => {
  it('十四个排序项 × 两个方向，手写的一批战役', () => {
    for (const mode of CAMPAIGN_SORT_MODES) {
      for (const direction of DIRECTIONS) {
        const legacy = ids(legacySortCampaignRows(HANDPICKED, { mode, direction }));
        const next = ids(sortCampaignRows(HANDPICKED, [{ mode, direction }]));
        expect(next, `${mode}.${direction}`).toEqual(legacy);
      }
    }
  });

  it('十四个排序项 × 两个方向，六批各 80 场的随机战役（大量并列与缺值）', () => {
    for (const seed of [1, 7, 42, 2026, 31337, 65535]) {
      const rows = randomSortRows(80, seed);
      for (const mode of CAMPAIGN_SORT_MODES) {
        for (const direction of DIRECTIONS) {
          const legacy = ids(legacySortCampaignRows(rows, { mode, direction }));
          const next = ids(sortCampaignRows(rows, [{ mode, direction }]));
          expect(next, `seed ${seed} · ${mode}.${direction}`).toEqual(legacy);
        }
      }
    }
  });

  it('输入顺序打乱后仍一致（排序稳定性不掩盖差别）', () => {
    const rows = randomSortRows(60, 99);
    const reversed = [...rows].reverse();
    for (const mode of CAMPAIGN_SORT_MODES) {
      for (const direction of DIRECTIONS) {
        expect(ids(sortCampaignRows(reversed, [{ mode, direction }])), `${mode}.${direction}`)
          .toEqual(ids(legacySortCampaignRows(reversed, { mode, direction })));
      }
    }
  });
});
