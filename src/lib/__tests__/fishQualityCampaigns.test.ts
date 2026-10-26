import { describe, expect, it, vi } from 'vitest';
import { STATE_DEF, CDA_DEF, BSS_DEF, definitionKey } from '@/lib/deepDig/features';
import { importQualityFish, importQualityLibrary, newQualityStudy, qualityComparisonRows, qualityDisplayRows, qualityResultKey, type QualityResult } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { archiveQualityResult, archiveQualityStudy, markQualityDetection } from '@/lib/fish/qualityCampaignArchive';
import { qualityCampaignDataFromStudy } from '@/lib/fish/qualityCampaigns';
import { buildCampaignCardData } from '@/lib/campaignListCache';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { fetchLegExitPriceCorrectionsResult } from '@/lib/campaignLegExecution';
import { buildQualitySheets } from '@/lib/fish/qualityExport';
const T = Date.UTC(2026, 9, 20);
function seed() {
  const fish = { featureId: 'bss', featureShort: 'BSS', definitionKey: definitionKey(BSS_DEF), statistic: 'BSS', cutoffMs: T, threshold: .12, average: .2, cbi2: .2, startAverage: .2, previousAverage: 0, direction: '>' as const, scale: 1 };
  let study = importQualityFish(newQualityStudy(T + 1), [.12, .15, .18].map((threshold, i) => ({ id: `fish-${i}`, symbol: 'AAAUSDT', timeMs: T, timeLabel: '', fallbackZone: '', fish: { ...fish, threshold } })));
  study = enableQualityComparison(importQualityLibrary(study, [{ id: 'library', symbol: 'BBBUSDT', timeMs: T, timeLabel: '', fallbackZone: '' }]));
  study.sellPlans![0].rule = { metric: 'state', direction: '<', threshold: .5 };
  study.sellPlans![1].rule = { metric: 'CDA', direction: '<', threshold: -8 };
  study.selectedRowIds = qualityDisplayRows(study).map(row => row.id);
  const row = qualityComparisonRows(study)[0], plan = study.sellPlans![0];
  const result: QualityResult = { key: qualityResultKey(row, plan, 0), sampleId: row.id, groupId: plan.id, evaluatedAt: T + 86400000,
    status: 'closed', complete: true, entryTime: T, entryPrice: 10, endTime: T + 600000, endPrice: 12, pnl: 20, returnPct: 20, peakPct: 30, adversePct: -5, drawdownPct: 12, uncapturedPct: 10, heldHours: 1 / 6 };
  study.results = [result];
  return { study, row, plan, result };
}
describe('fish-quality campaigns', () => {
  it('turns three detector display rows into one trade, using existing settlement and campaign metrics without fees', async () => {
    const { study } = seed(), archived = archiveQualityStudy(study);
    expect(archived.campaignRuns).toHaveLength(1);
    const data = qualityCampaignDataFromStudy('owner', archived, 'sell'); expect(data).toHaveLength(1);
    const full = data[0];
    expect(full.campaign.comparison?.detectors).toHaveLength(3);
    expect(full.legs[0]).toMatchObject({ pre_entry_price: 10, post_exit_price_snapshot: 12, leverage: 1, pre_position_size: 100 });
    expect(full.tradeRecords[0]).toMatchObject({ quantity: 10, pnl: 20, fee: 0, openFeeUsd: 0 });
    expect(computeCampaignRealizedPnl(full.campaign, full.legs, full.tradeRecords, {}).total).toBeCloseTo(20);
    const card = buildCampaignCardData(full); expect(card.settlement.total).toBeCloseTo(20); expect(card.mainPriceChangePct).toBeCloseTo(20);
    const fetch = vi.fn(); expect(await fetchLegExitPriceCorrectionsResult('AAAUSDT', full.legs, full.tradeRecords, fetch)).toEqual({ corrections: {}, complete: true, fetchFailed: false }); expect(fetch).not.toHaveBeenCalled();
  });
  it('freezes prior rules and results, updates one same-rule valuation, and retains separate horizon experiments', () => {
    const { study, result } = seed(); let archived = archiveQualityResult(study, result);
    archived = archiveQualityResult(archived, { ...result, evaluatedAt: result.evaluatedAt + 1 }); expect(archived.campaignRuns).toHaveLength(1);
    archived = { ...archived, sellPlans: archived.sellPlans!.map((plan, i) => i ? plan : { ...plan, rule: { metric: 'state', direction: '<', threshold: .4 } }) };
    const nextResult = { ...result, key: qualityResultKey(qualityComparisonRows(archived)[0], archived.sellPlans![0], 0), pnl: -5, returnPct: -5, endPrice: 9.5 };
    archived = archiveQualityResult(archived, nextResult);
    expect(archived.campaignRuns).toHaveLength(2); expect(archived.campaignRuns![0].plan.rule?.threshold).toBe(.5); expect(archived.campaignRuns![0].result.pnl).toBe(20);
    const changed = { ...archived, observeHours: 12 };
    expect(archiveQualityResult(changed, { ...nextResult, key: qualityResultKey(qualityComparisonRows(changed)[0], changed.sellPlans![0], 12) }).campaignRuns).toHaveLength(3);
    expect(study.sellPlans![0].snapshot.definitionKey).toBe(definitionKey({ ...STATE_DEF, interval: '5m' }));
    expect(study.sellPlans![1].snapshot.definitionKey).toBe(definitionKey({ ...CDA_DEF, interval: '5m' }));
  });
  it('only creates detector-comparison campaigns after a sell choice and excludes library-only signals', () => {
    const { study, result } = seed(); let archived = archiveQualityStudy(study);
    expect(qualityCampaignDataFromStudy('owner', archived, 'detect')).toHaveLength(0);
    const library = qualityComparisonRows(study).find(row => row.origin === 'library')!;
    archived = archiveQualityResult(archived, { ...result, sampleId: library.id, key: qualityResultKey(library, study.sellPlans![0], 0) });
    archived = markQualityDetection(archived, study.sellPlans![0].id);
    expect(qualityCampaignDataFromStudy('owner', archived, 'sell')).toHaveLength(2);
    const detect = qualityCampaignDataFromStudy('owner', archived, 'detect'); expect(detect).toHaveLength(1); expect(detect[0].campaign.comparison?.section).toBe('detect');
    expect(detect[0].tradeRecords[0].pnl).toBe(20);
  });
  it('does not manufacture a trade for failed or missing entries; preserves open trades without pretending they have closed', () => {
    const { study, result } = seed();
    expect(archiveQualityResult(study, { ...result, status: 'error' }).campaignRuns).toBeUndefined();
    expect(archiveQualityResult(study, { ...result, entryPrice: undefined }).campaignRuns).toBeUndefined();
    const open = archiveQualityResult(study, { ...result, status: 'open' }); const full = qualityCampaignDataFromStudy('other-owner', open, 'sell')[0];
    expect(full.campaign.user_id).toBe('other-owner'); expect(full.campaign.status).toBe('active'); expect(full.campaign.closed_at).toBeNull(); expect(full.tradeRecords).toEqual([]);
    expect(full.campaign.comparison?.valuedAt).toBe(result.endTime);
  });
  it('exports the simple displayed table plus frozen evaluated prices, results and metrics, with one detailed row per trade', () => {
    const { study } = seed(); const sheets = buildQualitySheets(study, qualityDisplayRows(study));
    expect(sheets.map(sheet => sheet.name)).toEqual(['鱼质量', '运行结果']); expect(sheets[0].rows).toHaveLength(4); expect(sheets[1].rows).toHaveLength(1);
    const columns = sheets[1].columns.map(column => column.header), row = sheets[1].rows[0];
    for (const [name, value] of [['状态', '已卖出'], ['收益率 %', 20], ['盈亏 USDT', 20], ['最大涨幅 %', 30], ['最大回撤 %', 12], ['买入价', 10], ['卖出 / 估值价', 12]] as const) expect(row[columns.indexOf(name)]).toBe(value);
  });
});
