import { expect, it } from 'vitest';
import { makeQualitySellPlan } from '../qualitySellPlans';
import { LIMITED_PAYOFF_RISK_VERSION } from '../qualityVeto';
import { STATIC_DRAWDOWN_SELL_CHOICE } from '../qualityStaticDrawdownSell';
import { evaluateQualitySample, importQualityLibrary, newQualityStudy, qualityComparisonRows, qualityResultKey, qualityRunSamples } from '../quality';
import { freezeQualityPlan, planVersionChanges } from '../qualityPlanVersions';
import { buildQualityCampaignData } from '../qualityCampaignProjection';
import { beginQualityMonitorRound } from '../qualityMonitorLibrary';
import { qualityPayoffRatio } from '../qualityPresentation';
import { evaluateInstantMonitor, instantMonitorSize } from '../instantMonitorExecution';
import { INSTANT_TEMPLATE_MONITOR } from '../instantMonitorSettings';
import { DEFAULT_QUALITY_POSITION_MANAGEMENT } from '../qualityPositionManagement';
import type { FishReconstructionLoader } from '../reconstruction';

const entry = Date.UTC(2026, 10, 14);
const minute = 60_000;
const old = freezeQualityPlan({
  ...makeQualitySellPlan(STATIC_DRAWDOWN_SELL_CHOICE, '>=', 3, [], undefined, 'test-plan'),
  mirrorTakeProfit: { enabled: true, gainPct: 2.5, sellPct: 50 },
  payoffRiskVersion: LIMITED_PAYOFF_RISK_VERSION,
});
const load: FishReconstructionLoader = async (_row, from, to, { step }) =>
  Array.from({ length: (to - from) / step }, (_, index) => {
    const openTime = from + index * step;
    const high = openTime === entry ? 103 : 100;
    const low = openTime === entry + step ? 96 : 100;
    return { openTime, high, low, open: 100, close: 100, volume: 1, takerBuyVolume: .5 };
  });

it('freezes the configured sizing, applies it to mirror and stop fills, and carries it through a monitoring record and campaign', async () => {
  const plan = freezeQualityPlan({ ...old, positionManagement: DEFAULT_QUALITY_POSITION_MANAGEMENT });
  const next = { ...plan, positionManagement: { ...plan.positionManagement!, leverage: 8 } };
  expect(planVersionChanges(plan)).toEqual([]);
  expect(planVersionChanges(next).map(entry => entry.key)).toEqual(['position-management']);
  expect(planVersionChanges(old)).toEqual([]);
  const imported = importQualityLibrary(newQualityStudy(entry), [{ id: 's', symbol: 'XYZUSDT', timeMs: entry, timeLabel: '', fallbackZone: '' }]);
  const study = { ...imported, sellPlans: [plan], selectedRowIds: qualityComparisonRows(imported).map(row => row.id) };
  const sample = qualityRunSamples(study)[0];
  expect(qualityResultKey(sample, plan, 0)).not.toBe(qualityResultKey(sample, old, 0));
  const result = await evaluateQualitySample(sample, plan, 0, entry + 3 * minute, load, new AbortController().signal);
  expect(result).toMatchObject({ status: 'closed', initialNotional: 333, endPrice: 97 });
  expect(result.mirrorRealizedPnl).toBeCloseTo(4.1625);
  expect(result.pnl).toBeCloseTo(-.8325);
  expect(qualityPayoffRatio(plan, result).value).toBeCloseTo(-1 / 12);
  const data = buildQualityCampaignData('u', { sample, plan, result, observeHours: 0, firstEvaluatedAt: entry, detectors: [] }, 'sell');
  expect(data.campaign).toMatchObject({ initial_main_size_usdt: 333, initial_leverage: 5 });
  expect(data.legs.map(leg => leg.leverage)).toEqual([5, 5]);
  expect(data.legs.reduce((sum, leg) => sum + leg.pre_position_size!, 0)).toBe(333);
  expect(data.legs[0].pre_account_equity_usdt).toBe(66.6);
  expect(data.tradeRecords.map(row => [row.quantity, row.leverage])).toEqual([[1.665, 5], [1.665, 5]]);
  const captured = beginQualityMonitorRound(study, study, entry);
  expect(captured.study.monitorLibrary?.settings[0]).toMatchObject({ notional: 333, leverage: 5 });

  const previous = await evaluateQualitySample(sample, old, 0, entry + 3 * minute, load, new AbortController().signal);
  expect(previous.initialNotional).toBe(100);
  expect(previous.pnl).toBeCloseTo(-.25);
  const monitor = { version: INSTANT_TEMPLATE_MONITOR, templateId: 'f', name: plan.label, plan };
  expect(instantMonitorSize(monitor)).toMatchObject({ marginUsdt: 66.6, leverage: 5 });
  const instant = await evaluateInstantMonitor(sample, monitor, entry + 3 * minute, load, new AbortController().signal);
  expect(instant.pnl).toBeCloseTo(result.pnl!);
});
