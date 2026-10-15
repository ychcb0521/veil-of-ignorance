import { describe, expect, it } from 'vitest';
import {
  clusterEvents, clusterLabelConflict, conditionBreakdown, conditionStateOf, countGroups, groupCampaign, groupSignal,
  normalizeResearchSymbol, sampleBackgroundAnchors, WINDOW_MS, type CampaignLabelInput,
} from '@/lib/deepRsa/grouping';

const HOUR = 60 * 60_000;

function campaign(over: Partial<CampaignLabelInput> = {}): CampaignLabelInput {
  return {
    campaignId: 'c', symbol: 'BTCUSDT', direction: 'main_long', deleted: false,
    status: 'closed_profit', settled: true, payoffBasis: 'records', correctionsComplete: true,
    anchorMs: Date.parse('2026-01-01T00:00:00Z'),
    theoreticalB: 1, theoreticalBApplicable: true, payoffRatio: 1, initialExpectedMaxLoss: 100,
    ...over,
  };
}

describe('【用户指令】阈值严格按表：>3 正样本、<0.5 对照；等于 3、等于 0.5 都不算', () => {
  it.each([
    [3, 'mid'], [3.0000001, 'gt3'], [0.5, 'mid'], [0.4999999, 'lt05'], [-2, 'lt05'], [1, 'mid'],
    [null, 'missing'], [Number.NaN, 'missing'], [Number.POSITIVE_INFINITY, 'missing'],
  ] as const)('%s → %s', (value, state) => {
    expect(conditionStateOf(value as number | null)).toBe(state);
  });

  it('结构上没有的条件记 na，不是缺失', () => {
    expect(conditionStateOf(null, false)).toBe('na');
  });
});

describe('交易战役分组：严格保留 OR', () => {
  it('理论 b > 3 或 盈亏比 > 3 任一成立即正样本', () => {
    expect(groupCampaign(campaign({ theoreticalB: 3.5, payoffRatio: 1 })).group).toBe('positive');
    expect(groupCampaign(campaign({ theoreticalB: 1, payoffRatio: 4 })).group).toBe('positive');
  });

  it('理论 b < 0.5 或 盈亏比 < 0.5 任一成立即对照', () => {
    expect(groupCampaign(campaign({ theoreticalB: 0.2, payoffRatio: 1 })).group).toBe('control');
    expect(groupCampaign(campaign({ theoreticalB: 2, payoffRatio: -1 })).group).toBe('control');
  });

  it('等于 3、等于 0.5 落在中间组', () => {
    expect(groupCampaign(campaign({ theoreticalB: 3, payoffRatio: 0.5 })).group).toBe('middle');
  });

  it('同时满足两边（理论 b = 4、盈亏比 = 0.3）单列冲突组，记录两条件各自触发', () => {
    const g = groupCampaign(campaign({ theoreticalB: 4, payoffRatio: 0.3 }));
    expect(g.group).toBe('conflict');
    expect(g).toMatchObject({ theoreticalB: 'gt3', payoff: 'lt05', positiveTriggered: true, controlTriggered: true });
  });

  it('没有成交加仓的战役：理论 b 记 na，只按盈亏比分组', () => {
    expect(groupCampaign(campaign({ theoreticalB: null, theoreticalBApplicable: false, payoffRatio: 5 }))).toMatchObject({ group: 'positive', theoreticalB: 'na' });
    expect(groupCampaign(campaign({ theoreticalB: null, theoreticalBApplicable: false, payoffRatio: 1 })).group).toBe('middle');
  });

  it('理论 b 该有却缺：已知条件保留，最终分组可能翻转 → 待判定', () => {
    const g = groupCampaign(campaign({ theoreticalB: null, payoffRatio: 5 }));
    expect(g).toMatchObject({ group: 'pending', theoreticalB: 'missing', payoff: 'gt3', positiveTriggered: true });
    expect(g.pendingReasons).toContain('condition_missing');
    expect(groupCampaign(campaign({ theoreticalB: null, payoffRatio: 1 })).group).toBe('pending');
  });

  it('缺失不当作 0：盈亏比分子来自落库缓存或无数据、L₀ 无效时，盈亏比条件记 missing', () => {
    const weak = groupCampaign(campaign({ payoffBasis: 'campaign_summary', payoffRatio: 0, theoreticalB: 1 }));
    expect(weak.payoff).toBe('missing');
    expect(weak.group).toBe('pending');
    expect(weak.pendingReasons).toEqual(expect.arrayContaining(['payoff_basis_weak', 'condition_missing']));
    const badL0 = groupCampaign(campaign({ initialExpectedMaxLoss: 0.00005, payoffRatio: 9 }));
    expect(badL0.payoff).toBe('missing');
    expect(badL0.pendingReasons).toContain('invalid_l0');
  });

  it('未结束、未全部结算、无锚点、校正未拉齐或未知：一律待判定（读数还可能变）', () => {
    expect(groupCampaign(campaign({ status: 'active', payoffRatio: 5 })).pendingReasons).toContain('unresolved_status');
    expect(groupCampaign(campaign({ settled: false, payoffRatio: 5 })).group).toBe('pending');
    expect(groupCampaign(campaign({ anchorMs: null, payoffRatio: 5 })).pendingReasons).toContain('no_anchor');
    expect(groupCampaign(campaign({ correctionsComplete: false, payoffRatio: 5 })).pendingReasons).toContain('corrections_incomplete');
    expect(groupCampaign(campaign({ correctionsComplete: null, payoffRatio: 5 })).pendingReasons).toContain('corrections_unknown');
    // 冲突的读数在数据不硬时同样归待判定，但条件触发记录保留
    const unsettledConflict = groupCampaign(campaign({ settled: false, theoreticalB: 4, payoffRatio: 0.3 }));
    expect(unsettledConflict).toMatchObject({ group: 'pending', positiveTriggered: true, controlTriggered: true });
  });

  it('回收站、主空战役排除', () => {
    expect(groupCampaign(campaign({ deleted: true })).excludedReasons).toEqual(['deleted']);
    expect(groupCampaign(campaign({ direction: 'main_short', payoffRatio: 9 })).group).toBe('excluded');
  });

  it('两种口径分别计数', () => {
    const rows = [
      groupCampaign(campaign({ theoreticalB: 4, payoffRatio: 1 })),
      groupCampaign(campaign({ theoreticalB: null, theoreticalBApplicable: false, payoffRatio: 0.1 })),
      groupCampaign(campaign({ theoreticalB: null, payoffRatio: 2 })),
    ];
    expect(conditionBreakdown(rows)).toEqual({
      theoreticalB: { gt3: 1, lt05: 0, mid: 0, missing: 1, na: 1 },
      payoff: { gt3: 0, lt05: 1, mid: 2, missing: 0, na: 0 },
    });
    expect(countGroups(rows)).toEqual({ positive: 1, control: 1, conflict: 0, middle: 0, pending: 1, excluded: 0 });
  });
});

describe('信号库分组：星级 ≥ 3 正样本（三星算），< 3 对照，未评分待判定', () => {
  const sig = (quality: unknown, over: Record<string, unknown> = {}) => groupSignal({
    signalId: 's', symbol: 'TONUSDT', anchorMs: 1, quality, fallbackZone: '2.38', ...over,
  });

  it.each([[5, 'positive'], [3, 'positive'], [2, 'control'], [1, 'control']] as const)('%s 星 → %s', (stars, group) => {
    expect(sig(stars).group).toBe(group);
  });

  it('未评分、0、越界、非整数都不当作评分：待判定（不沿用 Math.round）', () => {
    expect(sig(undefined)).toMatchObject({ group: 'pending', pendingReasons: ['unrated'] });
    expect(sig(0).pendingReasons).toEqual(['invalid_rating']);
    expect(sig(6).group).toBe('pending');
    expect(sig(2.5)).toMatchObject({ group: 'pending', stars: null });
  });

  it('不可跳转、探顶区、写着事后结果的跟进记录：排除，不作独立锚点', () => {
    expect(sig(4, { jumpIssue: { code: 'missing_kline' } }).excludedReasons).toEqual(['no_market_data']);
    expect(sig(4, { fallbackZone: '探顶区 0.549' }).excludedReasons).toEqual(['top_zone']);
    expect(sig(4, { fallbackZone: '2.38 触发 涨至2.907' }).excludedReasons).toEqual(['followup_outcome_note']);
    expect(sig(4, { fallbackZone: '0.00018 成功触发' }).group).toBe('excluded');
  });
});

describe('同一行情的关联：同标的、锚点相距不到 48 小时串成一簇', () => {
  const t0 = Date.parse('2026-05-06T13:36:00Z');

  it('TON 两条相隔约 20 小时 → 一簇，代表取最早；相隔整 48 小时 → 分开', () => {
    const clusters = clusterEvents([
      { id: 'b', symbol: 'tonusdt', anchorMs: t0 + 20 * HOUR },
      { id: 'a', symbol: 'TON', anchorMs: t0 },
      { id: 'c', symbol: 'TONUSDT', anchorMs: t0 + 20 * HOUR + WINDOW_MS },
      { id: 'x', symbol: 'IMXUSDT', anchorMs: t0 },
    ]);
    const ton = clusters.filter(c => c.symbol === 'TONUSDT');
    expect(ton.map(c => c.memberIds)).toEqual([['a', 'b'], ['c']]);
    expect(ton[0].representativeId).toBe('a');
    expect(clusters.find(c => c.symbol === 'IMXUSDT')!.memberIds).toEqual(['x']);
  });

  it('单链：相邻都不足 48 小时就串在一起（即使首尾超过 48 小时）', () => {
    const clusters = clusterEvents([0, 40, 80].map((h, i) => ({ id: String(i), symbol: 'PHA', anchorMs: t0 + h * HOUR })));
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIds).toEqual(['0', '1', '2']);
  });

  it('簇内一正一负 → 标签冲突（例如 FIS 同时段一盈一亏两场）', () => {
    expect(clusterLabelConflict(['positive', 'control'])).toBe(true);
    expect(clusterLabelConflict(['positive', 'middle', 'pending'])).toBe(false);
  });

  it('标的归一化与信号库同口径', () => {
    expect(normalizeResearchSymbol(' fis/usdt ')).toBe('FISUSDT');
    expect(normalizeResearchSymbol('naoris')).toBe('NAORISUSDT');
  });
});

describe('随机背景时点：可复现、5 分钟整点、避开已有事件的观察窗', () => {
  const from = Date.parse('2026-01-01T00:00:00Z');
  const to = from + 30 * 24 * HOUR;

  it('同一 seed 结果相同，不同 seed 不同；全部落在 5 分钟整点与区间内', () => {
    const a = sampleBackgroundAnchors({ symbols: ['BTC', 'ETHUSDT'], fromMs: from, toMs: to, count: 20, seed: 7 });
    const b = sampleBackgroundAnchors({ symbols: ['ETHUSDT', 'BTC'], fromMs: from, toMs: to, count: 20, seed: 7 });
    const c = sampleBackgroundAnchors({ symbols: ['BTC', 'ETHUSDT'], fromMs: from, toMs: to, count: 20, seed: 8 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toHaveLength(20);
    for (const p of a) {
      expect(p.anchorMs % (5 * 60_000)).toBe(0);
      expect(p.anchorMs).toBeGreaterThanOrEqual(from);
      expect(p.anchorMs).toBeLessThanOrEqual(to);
    }
  });

  it('离同标的事件锚点不足 48 小时的候选点被丢弃', () => {
    const avoid = [{ id: 'e', symbol: 'BTCUSDT', anchorMs: from + 15 * 24 * HOUR }];
    const pts = sampleBackgroundAnchors({ symbols: ['BTCUSDT'], fromMs: from, toMs: to, count: 50, seed: 1, avoid });
    for (const p of pts) expect(Math.abs(p.anchorMs - avoid[0].anchorMs)).toBeGreaterThanOrEqual(WINDOW_MS);
  });
});
