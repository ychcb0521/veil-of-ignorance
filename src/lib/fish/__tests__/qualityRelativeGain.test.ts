import { expect, it } from 'vitest';
import { newQualityStudy, importQualityLibrary, qualityComparisonRows, type QualityResult, type QualityGroup } from '../quality';
import { enableQualityComparison } from '../qualityComparison';
import { defaultQualityAddition } from '../qualityAddition';
import { buildQualityCampaignData } from '../qualityCampaigns';
import { qualityRelativeGain, qualityRelativeGainText } from '../qualityPresentation';
import { computeCampaignGeometricMetrics } from '@/lib/campaignGeometricMetrics';

const T = Date.UTC(2026, 9, 29), M = 60000;
function trade(holdingVetoes: QualityGroup['holdingVetoes'], fills = true) {
  const study = enableQualityComparison(importQualityLibrary(newQualityStudy(T), [{ id: 'g', symbol: 'TESTUSDT', timeMs: T, timeLabel: '', fallbackZone: '' }]));
  const sample = qualityComparisonRows(study)[0], plan: QualityGroup = { ...study.sellPlans![0], holdingVetoes, mirrorTakeProfit: { enabled: true, gainPct: 5, sellPct: 50 }, addition: { ...defaultQualityAddition(), enabled: true } };
  const addition = { at: T + 2 * M, price: 110, notional: 220, quantity: 2, scanFrom: T, reading: 1, threshold: .5, direction: '>' as const, metric: 'raw', label: '探测', barOpenTime: T + M, sizing: { support: 107, previousSupport: 100, atr: 2, atrAt: T, coinsBefore: .5, realAverageBefore: 100, baseCoins: 7 / 6, mirrorCoins: 5 / 6, mirrorUsed: 2.5 } };
  const result: QualityResult = { key: 'g', sampleId: sample.id, groupId: plan.id, status: 'closed', entryTime: T, entryPrice: 100, endTime: T + 10 * M, endPrice: 120, evaluatedAt: T + 10 * M,
    mirrorFill: { at: T + M, price: 105, fraction: .5, gainPct: 5, atOpen: false }, ...(fills ? { additionFill: addition, additionFills: [addition], totalInvested: 320, averageEntryPrice: 108 } : {}), initialNotional: 100,
    remainingQuantity: 0, remainingCost: 0, pnl: 32.5, returnPct: 10, mirrorRealizedPnl: 2.5, remainingPnl: 30, realizedPnl: 32.5, reason: '算法达标，全部卖出', exitReading: .4 };
  return { plan, result, data: buildQualityCampaignData('g', { sample, plan, result, detectors: [], observeHours: 0, firstEvaluatedAt: T }, 'sell') };
}
const stop = (threshold: number, enabled = true) => ({ id: 's' + threshold, kind: 'static-drawdown' as const, label: '静态回撤', direction: '>=' as const, threshold, enabled });

it('matches the trade campaign\'s 相对涨幅 for the same paper trade', () => {
  const { plan, result, data } = trade([stop(10), stop(20)]);
  const own = qualityRelativeGain(plan, result).value!, campaign = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords).effectivePriceChangePct!;
  expect(own).toBeCloseTo((120 - 107) / (100 - 90) * 100);
  expect(campaign).not.toBeNull();expect(own).toBeCloseTo(campaign);
  expect(qualityRelativeGainText(own)).toBe('1.30×');
});
it('is empty, with a reason, when the campaign would have none', () => {
  expect(qualityRelativeGain(trade([stop(10)], false).plan, trade([stop(10)], false).result)).toMatchObject({ value: null, reason: expect.stringContaining('没有实际加仓') });
  const none = trade([stop(10, false)]);expect(qualityRelativeGain(none.plan, none.result)).toMatchObject({ value: null, reason: expect.stringContaining('静态回撤') });
  expect(qualityRelativeGain(none.plan, { ...none.result, status: 'open' }).value).toBeNull();
  expect(qualityRelativeGainText(null)).toBe('—');
});

it('几何仓位 follows the campaign formula; without additions it equals the campaign value', async () => {
  const { qualityGeometricPosition, qualityGeometricPositionText } = await import('../qualityPresentation');
  const withAdd = trade([stop(10)]), noAdd = trade([stop(10)], false);
  const campaignM = (t: ReturnType<typeof trade>) => computeCampaignGeometricMetrics(t.data.campaign, t.data.legs, t.data.tradeRecords).positionGeometricMultiple;
  expect(qualityGeometricPosition(withAdd.result)).toBeCloseTo(.5 * (1 + 2 / .5));
  // 镜像在加仓前卖出 50%，加仓前持币 0.5：交易战役与组合表都应为 2.5（投影的实际时间 = 模拟成交时间）。
  expect(campaignM(withAdd)).toBeCloseTo(2.5);
  expect(qualityGeometricPosition(withAdd.result)).toBeCloseTo(campaignM(withAdd)!);
  expect(qualityGeometricPosition(noAdd.result)).toBeCloseTo(campaignM(noAdd)!);
  expect(qualityGeometricPosition(noAdd.result)).toBeCloseTo(.5);
  const plain = { ...noAdd.result, mirrorFill: undefined };expect(qualityGeometricPosition(plain)).toBe(1);
  expect(qualityGeometricPosition({ ...noAdd.result, status: 'open' })).toBe(1);
  expect(qualityGeometricPositionText(2.5)).toBe('2.50x');expect(qualityGeometricPositionText(null)).toBe('—');
});
