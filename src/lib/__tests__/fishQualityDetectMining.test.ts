// 比较探测：挖到的鱼自动勾选评估；买入过滤不挡固定卖出方案；战役带「探测信号类别」
import { expect, it, vi } from 'vitest';
import { BSS_DEF, CBI2_DEF, definitionKey } from '@/lib/deepDig/features';
import { collectFishQuality, importQualityFish, newQualityStudy, qualityComparisonRows, qualityDisplayRows, qualityFilterReadingKey, qualityResultKey, selectMinedRows, type QualityGroup, type QualityResult } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { archiveQualityStudy, markQualityDetection } from '@/lib/fish/qualityCampaignArchive';
import { qualityCampaignDataFromStudy, qualityDetectorCategory } from '@/lib/fish/qualityCampaigns';
import { makeQualityBuyFilter } from '@/lib/fish/qualityFilters';
import { detectCategoryStats } from '@/components/DetectCategoryStats';
import type { TradeSignal } from '@/lib/signalLibrary';

const T = Date.UTC(2026, 3, 2), M = 60_000;
const member = (def: typeof CBI2_DEF, short: string, threshold: number) => ({ featureId: def.id, featureShort: short, definitionKey: definitionKey(def), statistic: '结果', cutoffMs: T, threshold, average: 1, cbi2: 1, startAverage: 1, previousAverage: 0, direction: '>' as const, scale: 1, interval: '5m' as const });
const mined = (symbol: string, hits: number[]): TradeSignal => {
  const algorithms = [member(CBI2_DEF, 'CBI-2', .04), member(BSS_DEF, 'BSS', .12)];
  return { id: symbol, symbol, timeMs: T - 600_000, timeLabel: '', fallbackZone: '', mined: { anchorMs: T }, fishArchive: { id: `mine-${T}`, at: T },
    fish: { ...algorithms[0], algorithms, combination: 'or', hitAlgorithms: hits } as never };
};
const study = () => enableQualityComparison(importQualityFish(newQualityStudy(T), [mined('AAAUSDT', [1, 2]), mined('BBBUSDT', [2]), { id: 'manual', symbol: 'CCCUSDT', timeMs: T, timeLabel: '', fallbackZone: '', fish: member(CBI2_DEF, 'CBI-2', .04) as never }]));

it('auto-selects every detector row of mined fish once, leaving manual fish and later deselections alone', () => {
  const s = study(), picked = selectMinedRows(s);
  const rows = qualityDisplayRows(picked), minedRows = rows.filter(r => r.source.mined);
  expect(minedRows).toHaveLength(3); // AAA 两个算法 + BBB 一个
  expect(new Set(picked.selectedRowIds)).toEqual(new Set(minedRows.map(r => r.id)));
  expect(selectMinedRows(picked)).toBe(picked);
  expect(selectMinedRows({ ...picked, selectedRowIds: [] }).selectedRowIds).toEqual([]); // 用户取消后不再勾回
});
it('still evaluates the fixed sell plan for signals the buy filter rejects', async () => {
  let s = selectMinedRows(study());
  s.sellPlans!.forEach(p => { p.rule = { metric: p.metric, direction: '<', threshold: -1e9 }; });
  s = { ...s, selectedSellId: s.sellPlans![1].id };
  const f = makeQualityBuyFilter('state:state', '>', .7), rows = qualityComparisonRows(s);
  s = { ...s, buyFilters: [f], filterReadings: rows.map(r => ({ key: qualityFilterReadingKey(r, f), value: .1 })) };
  const results: QualityResult[] = [], load = vi.fn(async (_r, from: number, cut: number, plan) => Array.from({ length: (cut - from) / plan.step }, (_, i) => ({ openTime: from + i * plan.step, open: 1, high: 1, low: 1, close: 1, volume: 1, quoteVolume: 100, takerBuyQuoteVolume: 50, takerBuyVolume: .5 })));
  await collectFishQuality({ study: s, signal: new AbortController().signal, onProgress: vi.fn(), onResult: r => results.push(r) }, load, T + 30 * M);
  expect(results.length).toBeGreaterThan(0);
  expect(results.every(r => r.groupId === s.selectedSellId)).toBe(true); // 只评估固定的那套
});
it('labels each detect campaign with the combination of detectors that caught it and summarises by category', () => {
  const groups = (labels: string[]) => labels.map(label => ({ id: label, label, metric: '', snapshot: { featureId: label.startsWith('BSS') ? 'bss' : label.startsWith('S') ? 'state' : 'cbi2' } } as unknown as QualityGroup));
  expect(qualityDetectorCategory(groups(['BSS·avg₂', 'CBI-2·avg₂']))).toBe('CBI-2·avg₂ + BSS·avg₂'); // 按默认算法顺序
  expect(qualityDetectorCategory(groups(['S·avg₂', 'CBI-2·avg₂']))).toBe('CBI-2·avg₂ + S·avg₂');
  expect(qualityDetectorCategory([])).toBe('无探测算法');
  // 端到端：挖到的鱼评估后进探测比较，带类别
  let s = selectMinedRows(study());
  const plan = s.sellPlans![0]; plan.rule = { metric: plan.metric, direction: '<', threshold: .5 };
  s = markQualityDetection({ ...s, selectedSellId: plan.id }, plan.id);
  s.results = qualityComparisonRows(s).filter(r => r.source.mined).map((row, i) => ({ key: qualityResultKey(row, plan, 0), sampleId: row.id, groupId: plan.id, evaluatedAt: T + 3600_000, status: 'closed', complete: true,
    entryTime: T, entryPrice: 10, endTime: T + 600_000, endPrice: i ? 9 : 12, pnl: i ? -10 : 20, returnPct: i ? -10 : 20 }));
  const data = qualityCampaignDataFromStudy('owner', archiveQualityStudy(s), 'detect');
  const bySymbol = Object.fromEntries(data.map(d => [d.campaign.symbol, d.campaign.comparison!.category]));
  expect(Object.keys(bySymbol).sort()).toEqual(['AAAUSDT', 'BBBUSDT']);
  expect(bySymbol.AAAUSDT).toContain(' + '); expect(bySymbol.BBBUSDT).not.toContain(' + ');
  const stats = detectCategoryStats(data);
  expect(stats.map(x => x.total)).toEqual([1, 1]);
  expect(stats.find(x => x.category === bySymbol.AAAUSDT)).toMatchObject({ detectors: 2, closed: 1, mean: 20, winRate: 100 });
});
