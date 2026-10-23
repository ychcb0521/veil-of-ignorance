import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOM_RESEARCH_INDICATORS, researchChartSeries } from '@/lib/researchIndicators';
import { resetResearchHistory, subscribeResearchHistory, chartPrehistory } from '@/lib/researchChartHistory';
import { ingestBtcBars, resetBtcReference } from '@/lib/btcReference';
import { fetchResearchKlines } from '@/lib/deepRsa/marketData';
vi.mock('@/lib/deepRsa/marketData', async importOriginal => ({ ...await importOriginal<object>(), fetchResearchKlines: vi.fn() }));
const step = 300_000;
const full = Array.from({ length: 9000 }, (_, i) => {
  const close = 100 + Math.sin(i / 17) + i / 10000;
  return { timestamp: 1_700_000_100_000 + i * step, open: close - .01, high: close + .2, low: close - .2, close,
    volume: 100, turnover: 10000 + 1000 * Math.sin(i / 9), takerBuyTurnover: 5000 + 2000 * Math.cos(i / 7) };
});
beforeEach(() => {
  localStorage.clear(); resetResearchHistory(); resetBtcReference(); vi.mocked(fetchResearchKlines).mockReset();
  ingestBtcBars(step, full.map(b => ({ openTime: b.timestamp, close: 50000 + Math.sin(b.timestamp / step) * 100 })));
  vi.mocked(fetchResearchKlines).mockImplementation(async (_symbol, from, to) => full.filter(b => b.timestamp >= from && b.timestamp < to).map(b => ({
    openTime: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    quoteVolume: b.turnover, takerBuyQuoteVolume: b.takerBuyTurnover, takerBuyVolume: null, refClose: null,
  })));
});
describe('自制指标隐藏历史预热', () => {
  it.each(CUSTOM_RESEARCH_INDICATORS)('$id 左边第一根原值和两种均值与完整历史计算一致', async item => {
    const visible = full.slice(-240).map(b => ({ ...b, researchSymbol: 'TESTUSDT' }));
    const period = item.id === 'BSS' || item.id === 'DSS' ? 12 : item.period;
    const changed = vi.fn(), stop = subscribeResearchHistory(changed);
    researchChartSeries(visible, item, period);
    await vi.waitFor(() => expect(changed).toHaveBeenCalled()); stop();
    const actual = researchChartSeries(visible, item, period);
    const expected = researchChartSeries(full, item, period, { fetchReference: false });
    for (const key of ['core', 'avg', 'avg2'] as const) {
      expect(actual[key]).toHaveLength(240);
      expect(actual[key][0]).not.toBeNull();
      for (let i = 0; i < 240; i++) expect(actual[key][i]).toBeCloseTo(expected[key][full.length - 240 + i]!, 6);
    }
    expect(visible).toHaveLength(240);
  });
  it('多个指标共用取数，较长窗口会在短窗口完成后继续补齐', async () => {
    const data = full.slice(-10).map(b => ({ ...b, researchSymbol: 'AUSDT' }));
    const stop = subscribeResearchHistory(() => { chartPrehistory(data, 200, step); });
    chartPrehistory(data, 100, step);
    await vi.waitFor(() => expect(chartPrehistory(data, 200, step)).toHaveLength(200));
    stop();
    expect(fetchResearchKlines).toHaveBeenCalledTimes(2);
  });
  it('上市前无历史或取数失败时保留缺值，不补造曲线', async () => {
    vi.mocked(fetchResearchKlines).mockResolvedValue([]);
    const item = CUSTOM_RESEARCH_INDICATORS.find(i => i.id === 'DSS')!;
    const data = full.slice(-10).map(b => ({ ...b, researchSymbol: 'NEWUSDT' }));
    const changed = vi.fn(), stop = subscribeResearchHistory(changed);
    researchChartSeries(data, item, 12);
    await vi.waitFor(() => expect(changed).toHaveBeenCalled()); stop();
    expect(researchChartSeries(data, item, 12).avg2).toEqual(data.map(() => null));
  });
  it('标的隔离、请求去重，未标记的镜像/测试数据不请求历史', async () => {
    const data = full.slice(-10).map(b => ({ ...b, researchSymbol: 'AUSDT' }));
    chartPrehistory(data, 100, step); chartPrehistory(data, 100, step);
    expect(fetchResearchKlines).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(chartPrehistory(data, 100, step)).toHaveLength(100));
    expect(chartPrehistory(data.map(b => ({ ...b, researchSymbol: 'BUSDT' })), 100, step)).toEqual([]);
    expect(chartPrehistory(full.slice(-10), 100, step)).toEqual([]);
  });
});
