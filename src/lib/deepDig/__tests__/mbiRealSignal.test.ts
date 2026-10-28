import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { CBI2_DEF, computeFeatureValues, compileFeatureFormula, featureWindowMs, MBI_DEF } from '../features';
import { collectDeepDigRun } from '../analysis';
import { clearMarketDataCache, type FetchFn } from '@/lib/deepRsa/marketData';
import { extractWindow, type ResearchBar } from '@/lib/deepRsa/window';
import { fishFeatureDefinitions } from '@/lib/fish/features';
import { deepDigCsv } from '../export';
import type { CampaignGroupReport } from '@/lib/deepRsa/report';
import type { TradeSignal } from '@/lib/signalLibrary';

/** Optional frozen user archive, never fetched or overwritten by CI. See acceptance report. */
it.skipIf(!process.env.MBI_REAL_INPUT)('real ORDI signal: common collection pipeline, CBI2 and MBI side by side', async () => {
  const input = JSON.parse(readFileSync(process.env.MBI_REAL_INPUT!, 'utf8')) as { metadata: { symbol: string; anchorMs: number; quality: number }; bars: ResearchBar[] };
  const { symbol, anchorMs, quality } = input.metadata;
  const fetchFn: FetchFn = async url => {
    const parsed = new URL(url), start = Number(parsed.searchParams.get('startTime')), end = Number(parsed.searchParams.get('endTime')), limit = Number(parsed.searchParams.get('limit'));
    const rows = input.bars.filter(b => b.openTime >= start && b.openTime <= end).slice(0, limit).map(b => [b.openTime, b.open, b.high, b.low, b.close, b.volume, b.openTime + 299999, b.quoteVolume, 1, b.takerBuyVolume, b.takerBuyQuoteVolume, 0]);
    return { ok: true, status: 200, json: async () => rows };
  };
  clearMarketDataCache();
  const signal = { id: 'mbi-real-ORDI-20260415', symbol, timeMs: anchorMs, quality } as TradeSignal;
  const { data, series } = await collectDeepDigRun({ rows: [] } as unknown as CampaignGroupReport, { ...MBI_DEF, source: 'signals', positive: 's >= 3', control: 's < 3' }, { signals: [signal], fetchFn, backgroundCap: 0 });
  expect(data.rows).toHaveLength(1); expect(data.rows[0].group).toBe('positive');
  expect(data.coverage.featureMissing).toBe(0); expect(series.byEvent[data.rows[0].id]).toBeInstanceOf(Float64Array);
  const cbi2 = computeFeatureValues(extractWindow(input.bars, anchorMs, featureWindowMs(CBI2_DEF)), compileFeatureFormula(CBI2_DEF.formula), CBI2_DEF);
  const prepared = fishFeatureDefinitions([CBI2_DEF])[0];
  const averages = computeFeatureValues(extractWindow(input.bars, anchorMs, featureWindowMs(prepared)), compileFeatureFormula(prepared.formula), prepared);
  const row = data.rows[0];
  const comparison = { CBI2: cbi2.vars.CBI2, avg_CBI2_2: averages.vars.avg_CBI2_2, MBI: row.vars!.MBI, avg_MBI_2: row.vars!.avg_MBI_2 };
  for (const value of Object.values(comparison)) expect(Number.isFinite(value)).toBe(true);
  const window = extractWindow(input.bars, anchorMs, featureWindowMs(MBI_DEF));
  expect(window.bars).toHaveLength(701); expect(window.bars.at(-1)!.openTime + 300000).toBe(anchorMs);
  const result = { metadata: input.metadata, comparison, window: { bars: window.bars.length, lastCloseMs: window.bars.at(-1)!.openTime + 300000, coverage: window.coverage }, data, series: { ...series, byEvent: Object.fromEntries(Object.entries(series.byEvent).map(([key, value]) => [key, Array.from(value)])) } };
  if (process.env.MBI_REAL_OUTPUT) { writeFileSync(process.env.MBI_REAL_OUTPUT, JSON.stringify(result, null, 2)); writeFileSync(process.env.MBI_REAL_OUTPUT.replace(/\.json$/, '.csv'), deepDigCsv(data)); }
  console.info('MBI real signal', JSON.stringify({ metadata: input.metadata, comparison, window: result.window }));
});
