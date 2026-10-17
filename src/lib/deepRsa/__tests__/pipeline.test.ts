import { beforeEach, describe, expect, it } from 'vitest';
import { clearMarketDataCache, fetchFundingHistory, fetchResearchKlines, mapLimit, MarketDataError, type FetchFn } from '@/lib/deepRsa/marketData';
import { buildRunItems, runDeepRsa } from '@/lib/deepRsa/pipeline';
import type { CampaignGroupReport, CampaignGroupRow } from '@/lib/deepRsa/report';
import type { DeepRsaGroup } from '@/lib/deepRsa/grouping';
import { BAR_MS } from '@/lib/deepRsa/window';
import { collectDeepDigData, collectDeepDigRun } from '@/lib/deepDig/analysis';
import { valueAt } from '@/lib/deepDig/series';
import { DRIFT_SPEED_DEF } from '@/lib/deepDig/features';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const T_START = Date.parse('2026-01-05T00:00:00Z');

type Planted = { symbol: string; anchorMs: number; label: 'positive' | 'control' };

/**
 * 模拟币安 /fapi/v1/klines：价格与主动买入量由植入事件决定——
 * 正样本：t₀ 前 6h 主动买入占 80%，t₀ 后 24h 每根涨 0.3%；对照：前 6h 主动买入占 20%，之后每根跌 0.1%。
 */
function fakeMarket(planted: readonly Planted[], options: { failSymbol?: string; quote?: boolean } = {}) {
  const calls: string[] = [];
  const logPrice = (symbol: string, t: number) => {
    let lp = Math.log(100) + 0.002 * Math.sin(t / (7 * BAR_MS) + symbol.length);
    for (const e of planted) {
      if (e.symbol !== symbol) continue;
      const steps = Math.max(0, Math.min(288, (t - e.anchorMs) / BAR_MS));
      lp += steps * (e.label === 'positive' ? 0.003 : -0.001);
    }
    return lp;
  };
  const takerRatio = (symbol: string, t: number) => {
    for (const e of planted) {
      if (e.symbol === symbol && t >= e.anchorMs - 6 * HOUR && t < e.anchorMs) return e.label === 'positive' ? 0.8 : 0.2;
    }
    return 0.5 + 0.05 * Math.sin(t / (3 * BAR_MS));
  };
  const fetchFn: FetchFn = async url => {
    calls.push(url);
    const u = new URL(url);
    const symbol = u.searchParams.get('symbol')!;
    if (symbol === options.failSymbol) return { ok: false, status: 400, json: async () => ({}) };
    if (u.pathname.endsWith('/fundingRate')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    const start = Number(u.searchParams.get('startTime'));
    const end = Number(u.searchParams.get('endTime'));
    const limit = Number(u.searchParams.get('limit'));
    const rows: unknown[] = [];
    const step = BAR_MS * ({ '15m': 3, '1h': 12 } as Record<string, number>)[u.searchParams.get('interval') ?? ''] || BAR_MS;
    for (let t = Math.ceil(start / step) * step; t <= end && rows.length < limit; t += step) {
      const o = Math.exp(logPrice(symbol, t));
      const c = Math.exp(logPrice(symbol, t + step));
      const v = (100 + 10 * Math.sin(t / (11 * BAR_MS))) * (step / BAR_MS);
      rows.push([t, String(o), String(Math.max(o, c) * 1.0005), String(Math.min(o, c) * 0.9995), String(c), String(v), t + step - 1, options.quote ? String(v * c) : '0', 1, String(v * takerRatio(symbol, t)), options.quote ? String(v * c * takerRatio(symbol, t)) : '0', '0']);
    }
    return { ok: true, status: 200, json: async () => rows };
  };
  return { fetchFn, calls };
}

function reportOf(planted: readonly Planted[], extra: { symbol: string; anchorMs: number; group: DeepRsaGroup }[] = []): CampaignGroupReport {
  const rows: CampaignGroupRow[] = [...planted.map(p => ({ ...p, group: p.label as DeepRsaGroup })), ...extra].map((p, i) => ({
    campaignId: `c${i}`, symbol: p.symbol, title: p.symbol, anchorMs: p.anchorMs, theoreticalB: null, payoffRatio: null,
    grouping: {
      campaignId: `c${i}`, group: p.group, theoreticalB: 'na', payoff: 'mid', positiveTriggered: false, controlTriggered: false,
      pendingReasons: [], excludedReasons: p.group === 'excluded' ? ['deleted'] : [],
    },
  }));
  return {
    rows, counts: { positive: 0, control: 0, conflict: 0, middle: 0, pending: 0, excluded: 0 },
    breakdown: { theoreticalB: { gt3: 0, lt05: 0, mid: 0, missing: 0, na: 0 }, payoff: { gt3: 0, lt05: 0, mid: 0, missing: 0, na: 0 } },
    pendingReasons: {}, clusters: 0, conflictingClusters: 0,
  };
}

beforeEach(() => clearMarketDataCache());

describe('行情：浏览器里直接取币安公开接口', () => {
  it('分页取 5m K 线、保留主动买入量；同一会话缓存', async () => {
    const { fetchFn, calls } = fakeMarket([]);
    const bars = await fetchResearchKlines('AAAUSDT', T_START, T_START + 6 * DAY, fetchFn);
    expect(bars).toHaveLength(6 * 288);
    expect(calls.length).toBe(2); // 1728 根 → 1500 + 228
    expect(bars.every(b => b.takerBuyVolume != null)).toBe(true);
    await fetchResearchKlines('AAAUSDT', T_START, T_START + 6 * DAY, fetchFn);
    expect(calls.length).toBe(2);
  });

  it('主域名失败换备用域名；无此合约直接报错不重试', async () => {
    const { fetchFn } = fakeMarket([]);
    const hosts: string[] = [];
    const flaky: FetchFn = async (url, init) => {
      hosts.push(new URL(url).host);
      if (hosts.length === 1) return { ok: false, status: 502, json: async () => ({}) };
      return fetchFn(url, init);
    };
    await fetchResearchKlines('AAAUSDT', T_START, T_START + HOUR, flaky);
    expect(hosts).toEqual(['fapi.binance.com', 'www.binance.com']);
    const missing = fakeMarket([], { failSymbol: 'NOPEUSDT' });
    await expect(fetchResearchKlines('NOPEUSDT', T_START, T_START + HOUR, missing.fetchFn)).rejects.toMatchObject({ kind: 'no_symbol' });
    expect(missing.calls).toHaveLength(1);
  });

  it('资金费：只收区间内的结算', async () => {
    const fetchFn: FetchFn = async () => ({
      ok: true, status: 200,
      json: async () => [{ fundingTime: T_START, fundingRate: '0.01' }, { fundingTime: T_START + 8 * HOUR, fundingRate: '-0.0002' }],
    });
    expect(await fetchFundingHistory('AAAUSDT', T_START, T_START + DAY, fetchFn)).toEqual([{ fundingTime: T_START + 8 * HOUR, rate: -0.0002 }]);
  });

  it('有限并发：单个失败不打断其他', async () => {
    const res = await mapLimit([1, 2, 3], 2, async x => { if (x === 2) throw new MarketDataError('x', 'network'); return x * 10; });
    expect(res.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});

describe('事件：去重成簇 + 背景时点', () => {
  it('同标的 48h 内的战役合成一簇；含冲突组或一正一负的簇不进标签目标；排除组不进', () => {
    const t = T_START + 10 * DAY;
    const report = reportOf([], [
      { symbol: 'AAAUSDT', anchorMs: t, group: 'positive' },
      { symbol: 'AAAUSDT', anchorMs: t + 2 * HOUR, group: 'middle' },
      { symbol: 'BBBUSDT', anchorMs: t, group: 'positive' },
      { symbol: 'BBBUSDT', anchorMs: t + HOUR, group: 'control' },
      { symbol: 'CCCUSDT', anchorMs: t, group: 'conflict' },
      { symbol: 'DDDUSDT', anchorMs: t, group: 'excluded' },
    ]);
    const { items, campaigns, clusters } = buildRunItems(report, 1);
    expect(campaigns).toBe(5);
    expect(clusters).toBe(3);
    const events = items.filter(i => i.kind === 'event');
    expect(events.find(e => e.symbol === 'AAAUSDT')).toMatchObject({ label: 'positive', memberIds: ['c0', 'c1'] });
    expect(events.find(e => e.symbol === 'BBBUSDT')!.label).toBeNull();
    expect(events.find(e => e.symbol === 'CCCUSDT')!.label).toBeNull();
  });
});

describe('一键流程：植入结构能被检出，且全程不看未来', () => {
  // 3 个标的、每个标的每 3 天一个事件，正 / 对照交替错开
  const planted: Planted[] = [];
  ['AAAUSDT', 'BBBUSDT', 'CCCUSDT'].forEach((symbol, s) => {
    for (let k = 0; k < 16; k++) {
      planted.push({ symbol, anchorMs: T_START + 3 * DAY + k * 3 * DAY + s * 4 * HOUR, label: (k + s) % 2 ? 'positive' : 'control' });
    }
  });

  it('订单流表征在训练、测试上都通过，进入回测；覆盖率、切分、面板如实给出', async () => {
    const { fetchFn } = fakeMarket(planted);
    const stages = new Set<string>();
    const result = await runDeepRsa(reportOf(planted), {
      fetchFn, permutations: 999, seed: 7, backgroundCap: 0, onProgress: p => stages.add(p.stage),
    });
    expect(result.coverage).toMatchObject({ campaigns: 48, clusters: 48, labeled: { positive: 24, control: 24 }, failed: [], lowCoverage: 0 });
    expect(result.split.train + result.split.val + result.split.test + result.split.embargoed).toBe(48);
    expect(result.panel).toHaveLength(3 * 3 * 2);
    expect(result.selection).toHaveLength(3 * 2);
    const flowLabel = result.panel.find(r => r.representation === 'orderFlow' && r.target === 'label' && r.halfLifeHours === 2)!;
    expect(flowLabel.rho).toBeGreaterThan(0);
    expect(flowLabel.pHolm).toBeLessThan(0.05);
    expect(result.oos.some(r => r.representation === 'orderFlow' && r.target === 'label' && r.verdict === '已验证')).toBe(true);
    expect(result.conclusions.rsa).toBe('已验证');
    expect(result.backtest.skippedReason).toBeNull();
    expect(result.backtest.scenarios!.map(s => s.slippage)).toEqual([0, 0.0005, 0.001]);
    expect(result.backtest.scenarios![1].strategies.map(s => s.name)).toEqual(['模型', '48h 动量', '定期买入']);
    // 描述性对比：正样本主动买入失衡更高
    const imb = result.featureContrast.rows.find(r => r.key === 'taker_imb_w')!;
    expect(imb.smd!).toBeGreaterThan(0);
    expect([...stages]).toEqual(expect.arrayContaining(['fetch', 'features', 'rsa', 'oos', 'robustness', 'backtest_fetch', 'backtest']));
    // 稳健性检验：测试集检验过的每个「结果」项各 5 项 × 发现 / 测试两期；⑤ 每个表征一行，计数用全部时间段
    const outcomeTested = result.oos.filter(r => r.target === 'outcome');
    expect(result.robustness!.rows.map(r => r.representation)).toEqual(outcomeTested.map(r => r.representation));
    for (const row of result.robustness!.rows) expect(row.checks).toHaveLength(10);
    expect(result.robustness!.labelsAllPeriods.rsa.map(r => r.representation)).toEqual(['price', 'orderFlow', 'schelling']);
    expect(result.robustness!.labelsAllPeriods.rsa[0]).toMatchObject({ nPos: 24, nCtl: 24 });
    expect(result.conclusions.rsa).toBe('已验证');
    expect(JSON.parse(JSON.stringify(result)).codeVersion).toBe(result.codeVersion);
  }, 60_000);

  it('没有结构（标签随机）→ 训练集不通过，不进样本外与回测，结论「检验未获支持」', async () => {
    const shuffled = planted.map((p, i) => ({ ...p, label: (i * 7919) % 3 === 0 ? 'positive' as const : 'control' as const }));
    const { fetchFn } = fakeMarket(planted); // 行情仍按原结构生成，标签却与之无关
    const result = await runDeepRsa(reportOf(shuffled), { fetchFn, permutations: 99, seed: 3, backgroundCap: 0 });
    expect(result.selection.filter(s => s.target === 'label' && s.trainPassed)).toEqual([]);
    expect(result.oos.filter(r => r.target === 'label')).toEqual([]);
    expect(result.backtest.skippedReason).toContain('不进入交易回测');
    expect(result.conclusions.backtest).toBe('检验未获支持');
  }, 60_000);

  it('拉不到的标的记为失败，不影响其他', async () => {
    const { fetchFn } = fakeMarket(planted, { failSymbol: 'CCCUSDT' });
    const result = await runDeepRsa(reportOf(planted.filter(p => p.symbol !== 'BBBUSDT')), { fetchFn, permutations: 49, seed: 1, backgroundCap: 0 });
    expect(result.coverage.failed.map(f => f.symbol)).toEqual(Array(16).fill('CCCUSDT'));
    expect(result.coverage.fetched).toBe(16);
  }, 60_000);

  it('取消：中止后抛出「已取消」', async () => {
    const { fetchFn } = fakeMarket(planted);
    const controller = new AbortController();
    controller.abort();
    await expect(runDeepRsa(reportOf(planted), { fetchFn, signal: controller.signal, backgroundCap: 0 })).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('Deep dig：周期、半衰期可选', () => {
  const planted: Planted[] = [
    { symbol: 'AAAUSDT', anchorMs: T_START + 3 * DAY, label: 'positive' },
    { symbol: 'BBBUSDT', anchorMs: T_START + 5 * DAY, label: 'control' },
  ];

  it('【用户要求】选 15 分钟：另取 15m K 线算特征值（观察窗 48 小时）；24h 结果仍按 5m；默认 5m 不多取', async () => {
    const m15 = fakeMarket(planted, { quote: true });
    const d15 = await collectDeepDigData(reportOf(planted), { ...DRIFT_SPEED_DEF, interval: '15m' }, { fetchFn: m15.fetchFn, backgroundCap: 0 });
    expect(m15.calls.filter(u => u.includes('interval=15m'))).toHaveLength(2);
    expect(m15.calls.filter(u => u.includes('interval=5m')).length).toBeGreaterThanOrEqual(2);
    expect(d15.definition).toMatchObject({ interval: '15m', halfLifeHours: 6 });
    // 公式里每个变量都存下来（推断统计选因变量用）；最后一句 V 就是特征值
    expect(Object.keys(d15.rows[0].vars ?? {})).toEqual(['N', 'F', 'A', 'G', 'R', 'U', 'V']);
    expect(d15.rows.every(r => r.vars?.V === r.v)).toBe(true);
    clearMarketDataCache();
    const m5 = fakeMarket(planted, { quote: true });
    const d5 = await collectDeepDigData(reportOf(planted), DRIFT_SPEED_DEF, { fetchFn: m5.fetchFn, backgroundCap: 0 });
    expect(m5.calls.some(u => u.includes('interval=15m'))).toBe(false);
    const v = (d: typeof d5) => d.rows.map(r => r.v);
    expect(v(d15).every(x => x != null && Number.isFinite(x))).toBe(true);
    expect(v(d5).every(x => x != null && Number.isFinite(x))).toBe(true);
    expect(v(d15)[0]).not.toBeCloseTo(v(d5)[0]!, 10);
    // 24h 结果两边一样（都按 5m）
    expect(d15.rows.map(r => r.endRet)).toEqual(d5.rows.map(r => r.endRet));
  });

  it('半衰期 12 小时：观察窗放到 96 小时，同一周期结果和 6 小时不同', async () => {
    const m = fakeMarket(planted, { quote: true });
    const d12 = await collectDeepDigData(reportOf(planted), { ...DRIFT_SPEED_DEF, halfLifeHours: 12 }, { fetchFn: m.fetchFn, backgroundCap: 0 });
    const featureCall = m.calls.find(u => u.includes('interval=5m') && Number(new URL(u).searchParams.get('startTime')) <= T_START + 3 * DAY - 96 * HOUR);
    expect(featureCall).toBeDefined();
    clearMarketDataCache();
    const d6 = await collectDeepDigData(reportOf(planted), DRIFT_SPEED_DEF, { fetchFn: fakeMarket(planted, { quote: true }).fetchFn, backgroundCap: 0 });
    expect(d12.rows.every(r => r.v != null) && d6.rows.every(r => r.v != null)).toBe(true);
    expect(d12.rows[0].v).not.toBeCloseTo(d6.rows[0].v!, 10);
  });

  it('【用户要求】时间序列曲线：K 线往前多取 24 小时、往后到进场后 24 小时；每个有特征值的事件一条曲线，τ = 0 ≈ 特征值', async () => {
    const m = fakeMarket(planted, { quote: true });
    const { data, series } = await collectDeepDigRun(reportOf(planted), DRIFT_SPEED_DEF, { fetchFn: m.fetchFn, backgroundCap: 0 });
    const a = planted[0].anchorMs;
    expect(m.calls.some(u => Number(new URL(u).searchParams.get('startTime')) <= a - 72 * HOUR)).toBe(true);
    expect(series.finishedAt).toBe(data.finishedAt);
    expect(series.offsets).toHaveLength(49);
    expect(series.names).toEqual(['N', 'F', 'A', 'G', 'R', 'U', 'V']);
    expect(Object.keys(series.byEvent).sort()).toEqual(data.rows.filter(r => r.v != null).map(r => r.id).sort());
    for (const r of data.rows) expect(valueAt(series, r.id, 'V')!).toBeCloseTo(r.v!, 6);
    // 进场后的点也有值（描述进场后怎么走）
    expect(Number.isFinite(valueAt(series, data.rows[0].id, 'V', 24 * HOUR)!)).toBe(true);
  });
});
