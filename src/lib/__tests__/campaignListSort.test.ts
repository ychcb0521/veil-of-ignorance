import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendSortLevel,
  CAMPAIGN_SORT_MODES,
  CONTINUOUS_SORT_MODES,
  buildCampaignSortKeys,
  clearSortChain,
  DEFAULT_CAMPAIGN_SORT_CHAIN,
  describeSortLevelEffects,
  parseCampaignSortChain,
  quartileOf,
  quartileThresholds,
  removeSortLevel,
  resolveSortBinning,
  selectSortMode,
  sortBinValue,
  sortCampaignRows,
  sortChainBinsFirstLevel,
  sortChainKey,
  summarizeSortCrossTab,
  summarizeSortGroups,
  toggleSortLevel,
  writeCampaignSortParams,
  type CampaignSortChain,
  type CampaignSortRow,
} from '@/lib/campaignListSort';
import { formatCampaignPayoffRatio } from '@/lib/campaignAnalysis';
import { formatEfficiency } from '@/lib/campaignMainPriceChange';
import { formatArithmeticExpectancy, formatGeometricExpectancy } from '@/lib/campaignMetrics';
import { formatLegPriceChangePct } from '@/lib/legPriceChange';
import { makeSortRow } from '@/test/fixtures/campaignSortRows';

const ids = (rows: readonly CampaignSortRow[]) => rows.map(row => row.campaign.id);

/**
 * 与 harness 同一套战役：镜像止盈三档（已实现·盈利 / 已实现·亏损 / 未实现）各有多场，
 * 同一档里有的有加仓效用、有的没有（没加仓，或涨跌幅倍数不为正）。
 * 加仓效用 = 盈亏比 ÷（涨跌幅 ÷ 预期回撤）。
 */
const ROWS = [
  // 已实现·盈利：盈亏顺序 BTC > SOL > ETH > BNB，加仓效用顺序 ETH 2.50 > BTC 1.50 > SOL 1.40 > BNB —
  makeSortRow({ id: 'sol', pnl: 420, tp: true, add: true, pcr: 420, dd: 2, mpc: 6 }),
  makeSortRow({ id: 'eth', pnl: 250, tp: true, add: true, pcr: 250, dd: 2.5, mpc: 2.5 }),
  makeSortRow({ id: 'bnb', pnl: 180, tp: true, pcr: 180, dd: 2, mpc: 3.6 }),
  makeSortRow({ id: 'btc', pnl: 600, tp: true, add: true, pcr: 600, dd: 1.5, mpc: 6 }),
  // 已实现·亏损：DOGE 有加仓效用 -1.20，AVAX 没加仓
  makeSortRow({ id: 'doge', pnl: -60, tp: true, add: true, pcr: -60, dd: 2, mpc: 1 }),
  makeSortRow({ id: 'avax', pnl: -90, tp: true, pcr: -90, dd: 3, mpc: -0.4 }),
  // 未实现·盈利：盈亏顺序 TIA > LINK > ARB，加仓效用 LINK 1.80 > TIA 1.05 > ARB —
  makeSortRow({ id: 'link', pnl: 120, add: true, pcr: 120, dd: 3, mpc: 2 }),
  makeSortRow({ id: 'arb', pnl: 80, pcr: 80, dd: 2.5, mpc: 2 }),
  makeSortRow({ id: 'tia', pnl: 210, add: true, pcr: 210, dd: 1.4, mpc: 2.8 }),
  // 未实现·亏损：两场都算不出加仓效用（APT 加过仓但涨跌幅为负）
  makeSortRow({ id: 'op', pnl: -100, pcr: -100, dd: 2, mpc: -2 }),
  makeSortRow({ id: 'apt', pnl: -130, add: true, pcr: -130, dd: 2.5, mpc: -1.5 }),
];

describe('排序链：依次比较', () => {
  it('只按镜像止盈：同档按原来的并列裁决（盈亏从大到小）', () => {
    expect(ids(sortCampaignRows(ROWS, [{ mode: 'mirrorTp', direction: 'desc' }]))).toEqual([
      'btc', 'sol', 'eth', 'bnb', 'doge', 'avax', 'tia', 'link', 'arb', 'op', 'apt',
    ]);
  });

  it('【用户要求】镜像止盈 ↓ › 加仓效用 ↓：同一档里按加仓效用从大到小，算不出的留在本档末尾', () => {
    const chain: CampaignSortChain = [{ mode: 'mirrorTp', direction: 'desc' }, { mode: 'addEfficiency', direction: 'desc' }];
    expect(ids(sortCampaignRows(ROWS, chain))).toEqual([
      'eth', 'btc', 'sol', 'bnb', // 已实现·盈利：2.50 > 1.50 > 1.40，BNB 没加仓 → 档尾
      'doge', 'avax', // 已实现·亏损
      'link', 'tia', 'arb', // 未实现·盈利：1.80 > 1.05，ARB → 档尾
      'op', 'apt', // 未实现·亏损：都算不出，按镜像止盈原有的并列裁决（盈亏从大到小）
    ]);
  });

  it('第二级升序时，算不出的仍排在本档末尾（不因升序跑到最前）', () => {
    const chain: CampaignSortChain = [{ mode: 'mirrorTp', direction: 'desc' }, { mode: 'addEfficiency', direction: 'asc' }];
    expect(ids(sortCampaignRows(ROWS, chain))).toEqual([
      'sol', 'btc', 'eth', 'bnb',
      'doge', 'avax',
      'tia', 'link', 'arb',
      'op', 'apt',
    ]);
  });

  it('进不进列表只由第一级决定：第二级算不出的战役不会被筛掉', () => {
    const single = sortCampaignRows(ROWS, [{ mode: 'mirrorTp', direction: 'desc' }]);
    const chained = sortCampaignRows(ROWS, [{ mode: 'mirrorTp', direction: 'desc' }, { mode: 'addEfficiency', direction: 'desc' }]);
    expect(chained).toHaveLength(single.length);
    // 反过来：第一级是加仓效用时，只收算得出的六场；加仓效用是连续指标、链上有两级 → 按四分位分档：
    // Q4 {ETH 2.50, LINK 1.80}、Q3 {BTC 1.50}、Q2 {SOL 1.40, TIA 1.05}、Q1 {DOGE −1.20}：
    // 四分位的 Q1 本是 {TIA, DOGE}，一正一负不能同档，0 成为档界，TIA 并入 Q2；Q2 里已实现的 SOL 排到 TIA 之前
    expect(ids(sortCampaignRows(ROWS, [{ mode: 'addEfficiency', direction: 'desc' }, { mode: 'mirrorTp', direction: 'desc' }])))
      .toEqual(['eth', 'link', 'btc', 'sol', 'tia', 'doge']);
  });

  it('三级链：前两级都打平时由第三级定先后，方向按第三级自己的', () => {
    // 未实现·亏损那一档：OP、APT 都算不出加仓效用 → 第三级盈亏比升序：APT -1.30 在 OP -1.00 之前
    const chain: CampaignSortChain = [
      { mode: 'mirrorTp', direction: 'desc' },
      { mode: 'addEfficiency', direction: 'desc' },
      { mode: 'captureRate', direction: 'asc' },
    ];
    const order = ids(sortCampaignRows(ROWS, chain));
    expect(order.slice(-2)).toEqual(['apt', 'op']);
    // 第三级降序：回到 OP、APT
    expect(ids(sortCampaignRows(ROWS, toggleSortLevel(chain, 2))).slice(-2)).toEqual(['op', 'apt']);
    // 前两级已分出先后的地方，第三级不起作用
    expect(order.slice(0, 4)).toEqual(['eth', 'btc', 'sol', 'bnb']);
  });

  it('各级都打平后退回第一级原有的并列裁决（带第一级的方向），不是后面各级的', () => {
    // 盈亏比相同、杠杆相同：盈亏比这一项原有的并列裁决是「盈亏按第一级方向」→ 升序时盈亏小的在前
    const rows = [
      makeSortRow({ id: 'x', pnl: 30, pcr: 100, leverage: 10 }),
      makeSortRow({ id: 'y', pnl: 10, pcr: 100, leverage: 10 }),
      makeSortRow({ id: 'z', pnl: 20, pcr: 100, leverage: 10 }),
    ];
    expect(ids(sortCampaignRows(rows, [{ mode: 'captureRate', direction: 'asc' }, { mode: 'leverage', direction: 'desc' }])))
      .toEqual(['y', 'z', 'x']);
    expect(ids(sortCampaignRows(rows, [{ mode: 'captureRate', direction: 'desc' }, { mode: 'leverage', direction: 'asc' }])))
      .toEqual(['x', 'z', 'y']);
  });

  it('第二级起的缺值：没有操作时间、没记杠杆、算不出预期回撤、没有盈亏比，不论方向都排在本档末尾', () => {
    const rows = [
      makeSortRow({ id: 'none', importance: 3, time: null, leverage: null, dd: 0, pcr: null }),
      makeSortRow({ id: 'low', importance: 3, time: '2026-01-01T00:00:00.000Z', leverage: 2, dd: 1, pcr: -50 }),
      makeSortRow({ id: 'high', importance: 3, time: '2026-06-01T00:00:00.000Z', leverage: 20, dd: 4, pcr: 300 }),
    ];
    for (const mode of ['time', 'leverage', 'expectedDrawdownPct', 'captureRate'] as const) {
      expect(ids(sortCampaignRows(rows, [{ mode: 'importance', direction: 'desc' }, { mode, direction: 'desc' }])), `${mode}.desc`)
        .toEqual(['high', 'low', 'none']);
      expect(ids(sortCampaignRows(rows, [{ mode: 'importance', direction: 'desc' }, { mode, direction: 'asc' }])), `${mode}.asc`)
        .toEqual(['low', 'high', 'none']);
    }
  });

  it('操作时间作第一级时沿用原口径：缺时间的记作最早（升序在最前），不按缺值处理', () => {
    const rows = [
      makeSortRow({ id: 'none', time: null }),
      makeSortRow({ id: 'jan', time: '2026-01-01T00:00:00.000Z' }),
      makeSortRow({ id: 'jun', time: '2026-06-01T00:00:00.000Z' }),
    ];
    expect(ids(sortCampaignRows(rows, [{ mode: 'time', direction: 'asc' }]))).toEqual(['none', 'jan', 'jun']);
    expect(ids(sortCampaignRows(rows, [{ mode: 'time', direction: 'desc' }]))).toEqual(['jun', 'jan', 'none']);
  });

  it('空链按默认（操作时间从新到旧）', () => {
    expect(ids(sortCampaignRows(ROWS, []))).toEqual(ids(sortCampaignRows(ROWS, DEFAULT_CAMPAIGN_SORT_CHAIN)));
  });
});

describe('每个排序项的独立比较器', () => {
  const keys = buildCampaignSortKeys<CampaignSortRow>();
  const withValue = makeSortRow({ id: 'v', time: '2026-01-01T00:00:00.000Z', leverage: 5, dd: 2, pcr: 100, mpc: 2, add: true, arith: 0.5, geo: 1.1 });
  const empty = makeSortRow({ id: 'e', time: null, leverage: null, dd: 0, pcr: null, mpc: null, arith: null, geo: null });

  it('缺值的判定与第一级的过滤一致（镜像止盈、重要性、字母没有缺值）', () => {
    for (const [mode, key] of Object.entries(keys)) {
      if (mode === 'time') {
        // 操作时间第一级不过滤（缺时间记 0），第二级起才算缺值
        expect(key.include(empty)).toBe(true);
        expect(key.missing(empty)).toBe(true);
        continue;
      }
      expect(key.missing(withValue), `${mode} 有读数`).toBe(false);
      expect(key.missing(empty), `${mode} 缺值`).toBe(!key.include(empty));
    }
    expect(keys.mirrorTp.missing(empty)).toBe(false);
    expect(keys.importance.missing(empty)).toBe(false);
    expect(keys.alpha.missing(empty)).toBe(false);
  });

  it('方向：desc 大的在前、asc 小的在前；字母按标题', () => {
    const small = makeSortRow({ id: 's', title: 'Alpha', leverage: 2, importance: 1 });
    const big = makeSortRow({ id: 'b', title: 'Beta', leverage: 20, importance: 4 });
    expect(keys.leverage.compare(small, big, 'desc')).toBeGreaterThan(0);
    expect(keys.leverage.compare(small, big, 'asc')).toBeLessThan(0);
    expect(keys.importance.compare(small, big, 'desc')).toBeGreaterThan(0);
    expect(keys.alpha.compare(small, big, 'asc')).toBeLessThan(0);
    expect(keys.alpha.compare(small, big, 'desc')).toBeGreaterThan(0);
  });
});

describe('排序链的操作', () => {
  const two: CampaignSortChain = [{ mode: 'mirrorTp', direction: 'desc' }, { mode: 'addEfficiency', direction: 'asc' }];

  it('单击：已经只按这一项排 → 切方向；它在多级链里 → 收成单级、保留方向；其它项 → 换成它（默认方向）', () => {
    expect(selectSortMode([{ mode: 'time', direction: 'desc' }], 'time')).toEqual([{ mode: 'time', direction: 'asc' }]);
    expect(selectSortMode(two, 'mirrorTp')).toEqual([{ mode: 'mirrorTp', direction: 'desc' }]);
    expect(selectSortMode(two, 'addEfficiency')).toEqual([{ mode: 'addEfficiency', direction: 'asc' }]);
    expect(selectSortMode(two, 'captureRate')).toEqual([{ mode: 'captureRate', direction: 'desc' }]);
    expect(selectSortMode(two, 'alpha')).toEqual([{ mode: 'alpha', direction: 'asc' }]);
  });

  it('「+」追加为下一级（默认方向），已在链里的不重复加', () => {
    expect(appendSortLevel([{ mode: 'mirrorTp', direction: 'desc' }], 'addEfficiency'))
      .toEqual([{ mode: 'mirrorTp', direction: 'desc' }, { mode: 'addEfficiency', direction: 'desc' }]);
    expect(appendSortLevel(two, 'alpha').at(-1)).toEqual({ mode: 'alpha', direction: 'asc' });
    expect(appendSortLevel(two, 'mirrorTp')).toBe(two);
  });

  it('链上单独切方向、单独移除（至少留一级）、清除（保留第一级）', () => {
    expect(toggleSortLevel(two, 1)).toEqual([{ mode: 'mirrorTp', direction: 'desc' }, { mode: 'addEfficiency', direction: 'desc' }]);
    expect(toggleSortLevel(two, 0)[0]).toEqual({ mode: 'mirrorTp', direction: 'asc' });
    expect(removeSortLevel(two, 0)).toEqual([{ mode: 'addEfficiency', direction: 'asc' }]);
    expect(removeSortLevel(two, 1)).toEqual([{ mode: 'mirrorTp', direction: 'desc' }]);
    const single: CampaignSortChain = [{ mode: 'time', direction: 'desc' }];
    expect(removeSortLevel(single, 0)).toBe(single);
    const three = appendSortLevel(two, 'captureRate');
    expect(clearSortChain(three)).toEqual([{ mode: 'mirrorTp', direction: 'desc' }]);
    expect(clearSortChain(single)).toBe(single);
  });
});

describe('URL 参数', () => {
  it('旧链接（只有 sort / direction）照样能读', () => {
    expect(parseCampaignSortChain('?sort=importance&direction=asc')).toEqual([{ mode: 'importance', direction: 'asc' }]);
    expect(parseCampaignSortChain('?sort=alpha')).toEqual([{ mode: 'alpha', direction: 'asc' }]);
    expect(parseCampaignSortChain('?sort=nope&direction=up')).toEqual([{ mode: 'time', direction: 'desc' }]);
    expect(parseCampaignSortChain('')).toEqual(DEFAULT_CAMPAIGN_SORT_CHAIN);
  });
  it('【用户要求】删掉的「DSI 贡献」「USI 贡献」：旧链接整条退回默认（操作时间从新到旧），then 里的直接忽略，不报错', () => {
    expect(CAMPAIGN_SORT_MODES).not.toContain('dsiContribution');
    expect(CAMPAIGN_SORT_MODES).not.toContain('usiContribution');
    expect(parseCampaignSortChain('?sort=dsiContribution&direction=asc')).toEqual(DEFAULT_CAMPAIGN_SORT_CHAIN);
    expect(parseCampaignSortChain('?sort=usiContribution&direction=desc&then=mirrorTp.asc')).toEqual(DEFAULT_CAMPAIGN_SORT_CHAIN);
    expect(parseCampaignSortChain('?sort=mirrorTp&direction=desc&then=dsiContribution.desc&then=usiContribution.asc&then=captureRate.asc')).toEqual([
      { mode: 'mirrorTp', direction: 'desc' },
      { mode: 'captureRate', direction: 'asc' },
    ]);
  });

  it('then=项.方向 读成后续各级：缺方向取默认，认不出的、重复的、与第一级相同的都忽略', () => {
    expect(parseCampaignSortChain('?sort=mirrorTp&direction=desc&then=addEfficiency.asc&then=alpha&then=bogus.desc&then=mirrorTp.asc&then=addEfficiency.desc&then=captureRate.sideways'))
      .toEqual([
        { mode: 'mirrorTp', direction: 'desc' },
        { mode: 'addEfficiency', direction: 'asc' },
        { mode: 'alpha', direction: 'asc' },
        { mode: 'captureRate', direction: 'desc' },
      ]);
  });

  it('只有一级时写出来与原来逐字相同；多级时第一级之后逐级追加 then，其余参数原样保留', () => {
    const params = new URLSearchParams('chart=mirrorTpBars&from=2026-01-01&then=stale.desc');
    writeCampaignSortParams(params, [{ mode: 'captureRate', direction: 'desc' }]);
    expect(params.toString()).toBe('chart=mirrorTpBars&from=2026-01-01&sort=captureRate&direction=desc');
    writeCampaignSortParams(params, [
      { mode: 'mirrorTp', direction: 'desc' },
      { mode: 'addEfficiency', direction: 'desc' },
      { mode: 'captureRate', direction: 'asc' },
    ]);
    expect(params.toString()).toBe('chart=mirrorTpBars&from=2026-01-01&sort=mirrorTp&direction=desc&then=addEfficiency.desc&then=captureRate.asc');
  });

  it('写出再读回一字不差', () => {
    const chain: CampaignSortChain = [
      { mode: 'geometricExpectancy', direction: 'asc' },
      { mode: 'leverage', direction: 'desc' },
      { mode: 'alpha', direction: 'desc' },
    ];
    const params = new URLSearchParams();
    writeCampaignSortParams(params, chain);
    expect(parseCampaignSortChain(`?${params.toString()}`)).toEqual(chain);
    expect(sortChainKey(parseCampaignSortChain(params))).toBe('geometricExpectancy.asc,leverage.desc,alpha.desc');
  });
});

describe('【用户已定】连续指标作第一级时按四分位分档', () => {
  it('四分位档界按 type 7（位置 (n−1)·p，线性插值）；值 ≥ q₃ 为 Q4、≥ q₂ 为 Q3、≥ q₁ 为 Q2，其余 Q1', () => {
    const thresholds = quartileThresholds([8, 1, 3, 7, 2, 6, 5, 4]);
    // 插值落在 2.75 / 4.5 / 6.25：归档不变，但档界写成那一档里最小的读数（3 / 5 / 7），显示出来与封面对得上
    expect(thresholds).toEqual([3, 5, 7]);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(value => quartileOf(value, thresholds!))).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    // 单个值：三条档界都是它，落在 Q4；没有值：null
    expect(quartileThresholds([3])).toEqual([3, 3, 3]);
    expect(quartileOf(3, [3, 3, 3])).toBe(4);
    expect(quartileThresholds([])).toBeNull();
    expect(quartileThresholds([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
  });

  it('相等的值必然同档（并列值不会被档界劈开）', () => {
    const thresholds = quartileThresholds([1, 1, 1, 1, 5, 5, 5, 5])!;
    expect(new Set([1, 1, 1, 1].map(value => quartileOf(value, thresholds))).size).toBe(1);
    expect(new Set([5, 5, 5, 5].map(value => quartileOf(value, thresholds))).size).toBe(1);
    expect(quartileOf(1, thresholds)).toBeLessThan(quartileOf(5, thresholds));
  });

  it('档界就是那一档里最小的读数：插值落在两个读数之间时取上面那个，归档与插值档界完全相同', () => {
    const values = [10, 20, 30, 40, 50, 60];
    // type 7：位置 1.25 / 2.5 / 3.75 → 22.5 / 35 / 47.5；取档内最小读数 → 30 / 40 / 50
    const thresholds = quartileThresholds(values)!;
    expect(thresholds).toEqual([30, 40, 50]);
    const byInterpolated = values.map(value => (value >= 47.5 ? 4 : value >= 35 ? 3 : value >= 22.5 ? 2 : 1));
    expect(values.map(value => quartileOf(value, thresholds))).toEqual(byInterpolated);
    // 档界落在某个读数上时就是它
    expect(quartileThresholds([1, 2, 3, 4, 5])).toEqual([2, 3, 4]);
  });

  it('【复核】分档按封面精度：显示相同的读数必然同档；档界的显示值 = 档内最小读数的显示值', () => {
    // 线上复现：档界 −71.9625 显示「-0.72」，−72.48 也显示「-0.72」却落在低一档；231.93 / 231.94 都显示 2.32 却被 231.935 劈开
    const pcrs = [-72.48, -71.79, -71.9625, -30, 18.75, 19.54, 100, 231.93, 231.94, 232.21, 500, 800];
    const rows = pcrs.map((pcr, index) => makeSortRow({ id: `p${index}`, pnl: pcr, pcr }));
    const chain: CampaignSortChain = [{ mode: 'captureRate', direction: 'desc' }, { mode: 'mirrorTp', direction: 'desc' }];
    const binning = resolveSortBinning(rows, chain)!;
    const shown = (pcr: number) => formatCampaignPayoffRatio(pcr);
    const bandOf = (pcr: number) => quartileOf(sortBinValue('captureRate', pcr), binning.thresholds);
    // 显示相同 → 同档
    for (const [a, b] of [[-72.48, -71.79], [-72.48, -71.9625], [231.93, 231.94]] as const) {
      expect(shown(a)).toBe(shown(b));
      expect(bandOf(a)).toBe(bandOf(b));
    }
    // 每一档的档界显示值就是这一档里最小的封面读数；每张封面的读数字面上 ≥ 本档档界、< 上一档档界
    const [q1, q2, q3] = binning.thresholds;
    for (const [band, threshold] of [[2, q1], [3, q2], [4, q3]] as const) {
      const members = pcrs.filter(pcr => bandOf(pcr) === band);
      expect(members.length).toBeGreaterThan(0);
      const smallest = Math.min(...members.map(pcr => Number(shown(pcr))));
      // 正负分界那条档界是 0（例外），其余档界就是档内最小读数
      if (threshold !== 0) expect(shown(threshold)).toBe(smallest.toFixed(2));
      for (const pcr of pcrs) {
        if (bandOf(pcr) >= band) expect(Number(shown(pcr))).toBeGreaterThanOrEqual(Number(shown(threshold)));
        else expect(Number(shown(pcr))).toBeLessThan(Number(shown(threshold)));
      }
    }
    // 排序本身不受影响：各级都打平后仍按盈亏比原值（−71.79 在 −72.48 之前）
    const order = ids(sortCampaignRows(rows, chain));
    expect(order.indexOf('p1')).toBeLessThan(order.indexOf('p0'));
  });

  it('sortBinValue：七个连续指标都按封面同一精度取整（显示相同 ⇔ 取整后相同）', () => {
    const sweep = Array.from({ length: 801 }, (_, index) => (index - 400) * 0.0337);
    // 各项只扫自己的取值域：预期回撤只在 > 0 时进列表，几何期望 = 增长因子 − 1、因子恒为正
    const signed = (raw: number) => raw;
    const nonNegative = (raw: number) => Math.abs(raw);
    const pairs: [Parameters<typeof sortBinValue>[0], (value: number) => string, (raw: number) => number][] = [
      ['captureRate', formatCampaignPayoffRatio, signed],
      ['mainPriceChange', formatLegPriceChangePct, signed],
      ['mainPriceEfficiency', formatEfficiency, signed],
      ['addEfficiency', formatEfficiency, signed],
      ['geometricExpectancy', formatGeometricExpectancy, raw => Math.abs(raw) - 0.99],
      ['arithmeticExpectancy', formatArithmeticExpectancy, signed],
      ['expectedDrawdownPct', value => `${value.toFixed(2)}%`, nonNegative],
    ];
    for (const [mode, format, domain] of pairs) {
      const byShown = new Map<string, Set<number>>();
      for (const raw of sweep) {
        const value = domain(raw);
        const rounded = sortBinValue(mode, value);
        expect(format(rounded), `${mode} ${value}`).toBe(format(value));
        const set = byShown.get(format(value)) ?? new Set<number>();
        set.add(rounded);
        byShown.set(format(value), set);
      }
      for (const [text, set] of byShown) expect(set.size, `${mode} ${text}`).toBe(1);
    }
    // 分档指标没有精度可言：原样返回
    expect(sortBinValue('mirrorTp', 4.2)).toBe(4.2);
  });

  /** 九场：盈亏比 1.00 … 8.00（含 7.50），奇数场镜像止盈成交；预期回撤 2、涨跌幅 4 → 涨跌幅倍数 2。 */
  const BINNED = [
    makeSortRow({ id: 'r1', pnl: 100, tp: true, pcr: 100, dd: 2, mpc: 4 }),
    makeSortRow({ id: 'r2', pnl: 200, pcr: 200, dd: 2, mpc: 4 }),
    makeSortRow({ id: 'r3', pnl: 300, tp: true, pcr: 300, dd: 2, mpc: 4 }),
    makeSortRow({ id: 'r4', pnl: 400, pcr: 400, dd: 2, mpc: 4 }),
    makeSortRow({ id: 'r5', pnl: 500, tp: true, pcr: 500, dd: 2, mpc: 4 }),
    makeSortRow({ id: 'r6', pnl: 600, pcr: 600, dd: 2, mpc: 4 }),
    makeSortRow({ id: 'r7', pnl: 700, tp: true, pcr: 700, dd: 2, mpc: 4 }),
    makeSortRow({ id: 'r8', pnl: 800, add: true, pcr: 800, dd: 2, mpc: 4 }),
    makeSortRow({ id: 'r9', pnl: 750, tp: true, pcr: 750, dd: 2, mpc: 4 }),
  ];

  it('链上不止一级且第一级是连续指标时才分档：档界按进入列表的战役算', () => {
    const binning = resolveSortBinning(BINNED, [{ mode: 'captureRate', direction: 'desc' }, { mode: 'mirrorTp', direction: 'desc' }]);
    expect(binning).toEqual({ mode: 'captureRate', thresholds: [300, 500, 700], counts: [2, 2, 2, 3], total: 9 });
    // 只有一级：永远不分档
    expect(resolveSortBinning(BINNED, [{ mode: 'captureRate', direction: 'desc' }])).toBeNull();
    expect(sortChainBinsFirstLevel([{ mode: 'captureRate', direction: 'desc' }])).toBe(false);
    // 分档指标作第一级：不分档
    for (const mode of ['mirrorTp', 'importance', 'leverage', 'alpha', 'time'] as const) {
      expect(resolveSortBinning(BINNED, [{ mode, direction: 'desc' }, { mode: 'captureRate', direction: 'desc' }]), mode).toBeNull();
      expect(CONTINUOUS_SORT_MODES.has(mode)).toBe(false);
    }
    // 七个连续指标都分档（DSI / USI 贡献已从排序栏删掉）
    expect([...CONTINUOUS_SORT_MODES].sort()).toEqual([
      'addEfficiency', 'arithmeticExpectancy', 'captureRate', 'expectedDrawdownPct',
      'geometricExpectancy', 'mainPriceChange', 'mainPriceEfficiency',
    ]);
    // 第一级算不出的战役本来就不进列表，也不参与档界
    const withMissing = [...BINNED, makeSortRow({ id: 'none', pcr: null })];
    expect(resolveSortBinning(withMissing, [{ mode: 'captureRate', direction: 'desc' }, { mode: 'mirrorTp', direction: 'desc' }])?.total).toBe(9);
  });

  it('盈亏比 ↓ › 镜像止盈 ↓：Q4 在前；同档内按镜像止盈，再打平按盈亏比本身', () => {
    expect(ids(sortCampaignRows(BINNED, [{ mode: 'captureRate', direction: 'desc' }, { mode: 'mirrorTp', direction: 'desc' }])))
      .toEqual(['r9', 'r7', 'r8', 'r5', 'r6', 'r3', 'r4', 'r1', 'r2']);
    // 只有一级时不分档：与原来一样纯按盈亏比
    expect(ids(sortCampaignRows(BINNED, [{ mode: 'captureRate', direction: 'desc' }])))
      .toEqual(['r8', 'r9', 'r7', 'r6', 'r5', 'r4', 'r3', 'r2', 'r1']);
  });

  it('第一级升序时 Q1 在前；第二级的方向仍是它自己的', () => {
    expect(ids(sortCampaignRows(BINNED, [{ mode: 'captureRate', direction: 'asc' }, { mode: 'mirrorTp', direction: 'asc' }])))
      .toEqual(['r2', 'r1', 'r4', 'r3', 'r6', 'r5', 'r8', 'r7', 'r9']);
    expect(ids(sortCampaignRows(BINNED, [{ mode: 'captureRate', direction: 'asc' }, { mode: 'mirrorTp', direction: 'desc' }])))
      .toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r9', 'r8']);
  });

  it('分档后第二级算不出的战役留在本档末尾；第一级进不进列表的口径不变', () => {
    // Q4 = {r7, r8, r9}：只有 r8 有加仓效用 → r8 在前，其余两场按盈亏比本身从大到小
    const chain: CampaignSortChain = [{ mode: 'captureRate', direction: 'desc' }, { mode: 'addEfficiency', direction: 'desc' }];
    expect(ids(sortCampaignRows(BINNED, chain)).slice(0, 3)).toEqual(['r8', 'r9', 'r7']);
    const withMissing = [...BINNED, makeSortRow({ id: 'none', pcr: null })];
    expect(ids(sortCampaignRows(withMissing, chain))).not.toContain('none');
    expect(ids(sortCampaignRows(withMissing, chain))).toHaveLength(9);
  });

  it('全部并列（同一个值）时只有一档：第二级排整个列表', () => {
    const rows = [
      makeSortRow({ id: 'a', pnl: 100, pcr: 100 }),
      makeSortRow({ id: 'b', pnl: 100, tp: true, pcr: 100 }),
      makeSortRow({ id: 'c', pnl: 100, pcr: 100, importance: 5 }),
    ];
    const chain: CampaignSortChain = [{ mode: 'captureRate', direction: 'desc' }, { mode: 'mirrorTp', direction: 'desc' }, { mode: 'importance', direction: 'desc' }];
    expect(resolveSortBinning(rows, chain)?.counts).toEqual([0, 0, 0, 3]);
    expect(ids(sortCampaignRows(rows, chain))).toEqual(['b', 'c', 'a']);
  });
});

describe('排序链每一级的作用（芯片反馈）', () => {
  it('第二级起：前面各级并列的组里按读数排了几场、几场算不出；第一级记 null', () => {
    const chain: CampaignSortChain = [{ mode: 'mirrorTp', direction: 'desc' }, { mode: 'addEfficiency', direction: 'desc' }, { mode: 'captureRate', direction: 'asc' }];
    const sorted = sortCampaignRows(ROWS, chain);
    expect(describeSortLevelEffects(sorted, chain)).toEqual([
      null,
      // 四档都有并列：已实现·盈利 4 场（BNB 算不出）、已实现·亏损 2（AVAX 算不出）、未实现·盈利 3（ARB 算不出）、未实现·亏损 2（都算不出）
      { groups: 4, rows: 11, sorted: 6, tied: 0, missing: 5 },
      // 前两级都打平的只有未实现·亏损那一档（OP、APT 都算不出加仓效用）
      { groups: 1, rows: 2, sorted: 2, tied: 0, missing: 0 },
    ]);
  });

  it('前一级没有并列：groups = 0（本级未起作用）；并列的都算不出：sorted = 0', () => {
    const alphaChain: CampaignSortChain = [{ mode: 'alpha', direction: 'asc' }, { mode: 'captureRate', direction: 'desc' }];
    expect(describeSortLevelEffects(sortCampaignRows(ROWS, alphaChain), alphaChain)[1]).toEqual({ groups: 0, rows: 0, sorted: 0, tied: 0, missing: 0 });
    const rows = [makeSortRow({ id: 'x', importance: 5 }), makeSortRow({ id: 'y', importance: 5 })];
    const chain: CampaignSortChain = [{ mode: 'importance', direction: 'desc' }, { mode: 'addEfficiency', direction: 'desc' }];
    expect(describeSortLevelEffects(sortCampaignRows(rows, chain), chain)[1]).toEqual({ groups: 1, rows: 2, sorted: 0, tied: 0, missing: 2 });
  });

  it('【复核】并列组里本级读数全相同：这一组没有分出先后，不算「排了」（sorted = 0、tied = N → 芯片标「未起作用」）', () => {
    // 线上复现：镜像止盈 › 杠杆倍数，300 场全是 10x → 顺序与只按镜像止盈逐位相同，芯片却报「排了 300 场」
    const uniform = [
      makeSortRow({ id: 'a', pnl: 100, tp: true, pcr: 100, leverage: 10 }),
      makeSortRow({ id: 'b', pnl: 50, tp: true, pcr: 50, leverage: 10 }),
      makeSortRow({ id: 'c', pnl: 80, pcr: 80, leverage: 10 }),
      makeSortRow({ id: 'd', pnl: 20, pcr: 20, leverage: 10 }),
    ];
    const chain: CampaignSortChain = [{ mode: 'mirrorTp', direction: 'desc' }, { mode: 'leverage', direction: 'desc' }];
    const sorted = sortCampaignRows(uniform, chain);
    expect(ids(sorted)).toEqual(ids(sortCampaignRows(uniform, [{ mode: 'mirrorTp', direction: 'desc' }])));
    expect(describeSortLevelEffects(sorted, chain)[1]).toEqual({ groups: 2, rows: 4, sorted: 0, tied: 4, missing: 0 });
    // 一组全 5 星（tied）、另一组 5 星 / 0 星（sorted）、再一组一场有读数一场算不出（有读数的排到了算不出的前面：算排了）
    const mixed = [
      makeSortRow({ id: 'w1', pnl: 100, tp: true, pcr: 100, importance: 5 }),
      makeSortRow({ id: 'w2', pnl: 50, tp: true, pcr: 50, importance: 5 }),
      makeSortRow({ id: 'l1', pnl: -100, tp: true, pcr: -100, importance: 5 }),
      makeSortRow({ id: 'l2', pnl: -50, tp: true, pcr: -50, importance: 0 }),
    ];
    const importanceChain: CampaignSortChain = [{ mode: 'mirrorTp', direction: 'desc' }, { mode: 'importance', direction: 'desc' }];
    expect(describeSortLevelEffects(sortCampaignRows(mixed, importanceChain), importanceChain)[1]).toEqual({ groups: 2, rows: 4, sorted: 2, tied: 2, missing: 0 });
    const half = [
      makeSortRow({ id: 'h1', pnl: 100, tp: true, pcr: 100, add: true, dd: 2, mpc: 4 }),
      makeSortRow({ id: 'h2', pnl: 50, tp: true, pcr: 50 }),
    ];
    const addChain: CampaignSortChain = [{ mode: 'mirrorTp', direction: 'desc' }, { mode: 'addEfficiency', direction: 'desc' }];
    expect(describeSortLevelEffects(sortCampaignRows(half, addChain), addChain)[1]).toEqual({ groups: 1, rows: 2, sorted: 1, tied: 0, missing: 1 });
  });

  it('只有一级：[null]；分档的第一级按档算并列', () => {
    expect(describeSortLevelEffects(sortCampaignRows(ROWS, [{ mode: 'captureRate', direction: 'desc' }]), [{ mode: 'captureRate', direction: 'desc' }])).toEqual([null]);
    const chain: CampaignSortChain = [{ mode: 'captureRate', direction: 'desc' }, { mode: 'mirrorTp', direction: 'desc' }];
    const sorted = sortCampaignRows(ROWS, chain);
    // 十一场分四档：Q4 {BTC, SOL, ETH}、Q3 {TIA, BNB, LINK, ARB}、Q2 {DOGE}（负值不与 ARB 同档）、Q1 {AVAX, OP, APT}；
    // Q2 只有一场不进比较；Q4 三场都是已实现·盈利（读数相同，tied），Q3、Q1 分出了先后
    expect(describeSortLevelEffects(sorted, chain)[1]).toEqual({ groups: 3, rows: 10, sorted: 7, tied: 3, missing: 0 });
  });
});

describe('排序项清单只有一份来源', () => {
  it('CAMPAIGN_SORT_MODES 与页面 SORT_OPTIONS 的 value 集合一致（新增排序项两边都要加，否则 URL 会悄悄退回操作时间）', () => {
    const page = readFileSync(join(process.cwd(), 'src/pages/JournalCampaignsPage.tsx'), 'utf8');
    const block = /const SORT_OPTIONS[^=]*= \[([\s\S]*?)\n\];/.exec(page)?.[1] ?? '';
    const values = [...block.matchAll(/value: '([A-Za-z]+)'/g)].map(match => match[1]);
    expect(values.length).toBeGreaterThan(0);
    expect([...CAMPAIGN_SORT_MODES].sort()).toEqual([...values].sort());
  });
});

describe('【用户要求】排序后的分组统计', () => {
  it('第一级分档时一档一组（顺序同列表）：场数、胜率、平均 b，后面各级报本组概况', () => {
    const chain: CampaignSortChain = [{ mode: 'captureRate', direction: 'desc' }, { mode: 'mirrorTp', direction: 'desc' }];
    const groups = summarizeSortGroups(sortCampaignRows(ROWS, chain), chain);
    expect(groups.map(group => group.key)).toEqual([
      { kind: 'quartile', quartile: 4, lower: 250 },
      { kind: 'quartile', quartile: 3, lower: 0 },
      { kind: 'quartile', quartile: 2, lower: -60 },
      { kind: 'quartile', quartile: 1, lower: null },
    ]);
    expect(groups.map(group => group.count)).toEqual([3, 4, 1, 3]);
    expect(groups.map(group => group.wins)).toEqual([3, 4, 0, 0]);
    expect(groups[0].meanPayoff).toBeCloseTo((6 + 4.2 + 2.5) / 3);
    // 第二级镜像止盈：本组已实现（生效）几场
    expect(groups.map(group => group.levels[1])).toEqual([
      { kind: 'achieved', hits: 3, count: 3 },
      { kind: 'achieved', hits: 1, count: 4 },
      { kind: 'achieved', hits: 1, count: 1 },
      { kind: 'achieved', hits: 1, count: 3 },
    ]);
    // 第一级自己：本档读数的平均值（600、420、250）
    expect(groups[0].levels[0]).toMatchObject({ kind: 'average', count: 3 });
    expect((groups[0].levels[0] as { value: number }).value).toBeCloseTo((600 + 420 + 250) / 3);
  });

  it('第一级是镜像止盈时一个档位一组；后面的连续指标报平均值，本组算不出时为 none', () => {
    const chain: CampaignSortChain = [{ mode: 'mirrorTp', direction: 'desc' }, { mode: 'addEfficiency', direction: 'desc' }];
    const groups = summarizeSortGroups(sortCampaignRows(ROWS, chain), chain);
    expect(groups.every(group => group.key.kind === 'value')).toBe(true);
    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(ROWS.length);
    const unrealizedLoss = groups.find(group => group.key.kind === 'value' && group.key.value === 0);
    expect(unrealizedLoss?.levels[1]).toEqual({ kind: 'none' });
  });

  it('第一级是字母 / 操作时间：只给一组「全部」', () => {
    const chain: CampaignSortChain = [{ mode: 'alpha', direction: 'asc' }, { mode: 'captureRate', direction: 'desc' }];
    const groups = summarizeSortGroups(sortCampaignRows(ROWS, chain), chain);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toEqual({ kind: 'all' });
    expect(groups[0].count).toBe(ROWS.length);
  });
});

describe('【用户要求】第一级每一档里第二级的分布（交叉表）', () => {
  it('连续 × 连续：第二级按整张列表统一分四档，列按第二级方向，格子数加起来等于每行场数', () => {
    const chain: CampaignSortChain = [{ mode: 'mirrorTp', direction: 'desc' }, { mode: 'captureRate', direction: 'desc' }];
    const crossTab = summarizeSortCrossTab(sortCampaignRows(ROWS, chain), chain, 1)!;
    expect(crossTab.thresholds).not.toBeNull();
    expect(crossTab.columns.map(column => (column.kind === 'quartile' ? column.quartile : column.kind))).toEqual([4, 3, 2, 1]);
    crossTab.rows.forEach(row => expect(row.counts.reduce((sum, count) => sum + count, 0)).toBe(row.count));
    expect(crossTab.totals).toEqual([3, 4, 1, 3]);
    // 行与分组统计同一套（镜像止盈一个档位一行）
    expect(crossTab.rows.map(row => row.key)).toEqual(
      summarizeSortGroups(sortCampaignRows(ROWS, chain), chain).map(group => group.key),
    );
  });

  it('第二级有算不出的战役时另起一列「算不出」；升序时 Q1 在左', () => {
    const chain: CampaignSortChain = [{ mode: 'captureRate', direction: 'desc' }, { mode: 'addEfficiency', direction: 'asc' }];
    const crossTab = summarizeSortCrossTab(sortCampaignRows(ROWS, chain), chain, 1)!;
    const kinds = crossTab.columns.map(column => (column.kind === 'quartile' ? `q${column.quartile}` : column.kind));
    expect(kinds[kinds.length - 1]).toBe('missing');
    expect(kinds[0]).toBe('q1');
    expect(crossTab.totals.reduce((sum, count) => sum + count, 0)).toBe(ROWS.length);
  });

  it('第二级是镜像止盈：一个档位一列；字母没法分档返回 null', () => {
    const chain: CampaignSortChain = [{ mode: 'captureRate', direction: 'desc' }, { mode: 'mirrorTp', direction: 'desc' }];
    const crossTab = summarizeSortCrossTab(sortCampaignRows(ROWS, chain), chain, 1)!;
    expect(crossTab.columns.every(column => column.kind === 'value')).toBe(true);
    expect(crossTab.rows[0].counts.reduce((sum, count) => sum + count, 0)).toBe(3);
    const alpha: CampaignSortChain = [{ mode: 'captureRate', direction: 'desc' }, { mode: 'alpha', direction: 'asc' }];
    expect(summarizeSortCrossTab(sortCampaignRows(ROWS, alpha), alpha, 1)).toBeNull();
  });
});

describe('【用户要求】分档时负值与正值不同档：0 一定是档界', () => {
  const signOf = (value: number) => (value < 0 ? 'neg' : 'nonneg');
  const assertNoMixedBin = (values: number[]) => {
    const thresholds = quartileThresholds(values)!;
    for (const quartile of [1, 2, 3, 4]) {
      const signs = new Set(values.filter(value => quartileOf(value, thresholds) === quartile).map(signOf));
      expect(signs.size).toBeLessThanOrEqual(1);
    }
    return thresholds;
  };

  it('中间档跨 0：负值多就把上界挪到 0，否则把下界挪到 0', () => {
    // 原档界 [-0.30, 0.42, 2] 的 Q2 = {-0.30, -0.1, 0.2}：负值多 → 上界挪到 0
    expect(assertNoMixedBin([-2, -1, -0.5, -0.3, -0.1, 0.2, 0.42, 0.6, 1, 2, 3, 4])).toEqual([-0.3, 0, 2]);
    // Q2 = {-0.3, 0.1, 0.2}：非负多 → 下界挪到 0，-0.3 并入 Q1
    expect(assertNoMixedBin([-2, -1, -0.5, -0.3, 0.1, 0.2, 0.42, 0.6, 1, 2, 3, 4])).toEqual([0, 0.42, 2]);
  });

  it('Q1 / Q4 跨 0 时只能挪有的那条档界；恰好为 0 的读数归非负一侧', () => {
    expect(assertNoMixedBin([-1, 0, 1, 2, 3, 4, 5, 6])[0]).toBe(0);
    expect(assertNoMixedBin([-6, -5, -4, -3, -2, -1, 0, 1])[2]).toBe(0);
    expect(quartileOf(0, quartileThresholds([-1, 0, 1, 2, 3, 4, 5, 6])!)).toBeGreaterThan(1);
  });

  it('全正或全负时档界不变', () => {
    expect(quartileThresholds([8, 1, 3, 7, 2, 6, 5, 4])).toEqual([3, 5, 7]);
    expect(quartileThresholds([-8, -1, -3, -7, -2, -6, -5, -4])).toEqual([-6, -4, -2]);
  });
});
