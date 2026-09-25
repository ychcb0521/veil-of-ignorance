import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendSortLevel,
  CAMPAIGN_SORT_MODES,
  buildCampaignSortKeys,
  clearSortChain,
  DEFAULT_CAMPAIGN_SORT_CHAIN,
  parseCampaignSortChain,
  removeSortLevel,
  selectSortMode,
  sortCampaignRows,
  sortChainKey,
  toggleSortLevel,
  writeCampaignSortParams,
  type CampaignSortChain,
  type CampaignSortRow,
} from '@/lib/campaignListSort';
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
    // 反过来：第一级是加仓效用时，只收算得出的五场
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
  const withValue = makeSortRow({ id: 'v', time: '2026-01-01T00:00:00.000Z', leverage: 5, dd: 2, pcr: 100, mpc: 2, add: true, arith: 0.5, geo: 1.1, dsi: 10, usi: 10 });
  const empty = makeSortRow({ id: 'e', time: null, leverage: null, dd: 0, pcr: null, mpc: null, arith: null, geo: null, dsi: null, usi: null });

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

describe('排序项清单只有一份来源', () => {
  it('CAMPAIGN_SORT_MODES 与页面 SORT_OPTIONS 的 value 集合一致（新增排序项两边都要加，否则 URL 会悄悄退回操作时间）', () => {
    const page = readFileSync(join(process.cwd(), 'src/pages/JournalCampaignsPage.tsx'), 'utf8');
    const block = /const SORT_OPTIONS[^=]*= \[([\s\S]*?)\n\];/.exec(page)?.[1] ?? '';
    const values = [...block.matchAll(/value: '([A-Za-z]+)'/g)].map(match => match[1]);
    expect(values.length).toBeGreaterThan(0);
    expect([...CAMPAIGN_SORT_MODES].sort()).toEqual([...values].sort());
  });
});
