import { expect, it, vi } from 'vitest';
import { CDA_DEF } from '@/lib/deepDig/features';
import { makeQualityBuyFilter } from '../qualityFilters';
import { freezeQualityPlan } from '../qualityPlanVersions';
import { type QualityGroup, type QualityResult } from '../quality';
import { emptyPreEntryThreeStage, signalAnchoredPreEntryThreeStage } from '../preEntryThreeStage';
import { instantMonitorSale, evaluateInstantMonitor, manualInstantMonitorClose } from '../instantMonitorExecution';
import { INSTANT_TEMPLATE_MONITOR, instantMonitorTemplateIssue } from '../instantMonitorSettings';
import { buildInstantCampaignData, freezeInstantCampaign, instantCampaignInput } from '../instantCampaign';
import { qualityCampaignStaticRisk } from '../qualityCampaignRisk';
import type { PreEntryRecord, PreEntryRound } from '../preEntryMonitor';
import type { FishReconstructionLoader } from '../reconstruction';

const m = 60_000, entry = Date.UTC(2026, 10, 13, 1, 20);
const { snapshot } = makeQualityBuyFilter('cda:CDA', '<', -15, true, [CDA_DEF]);
const template = freezeQualityPlan({ id: 'hold', label: '持仓原始模板', snapshot, metric: 'CDA', vetoFill: 'stop',
  mirrorTakeProfit: { enabled: true, gainPct: 2, sellPct: 50 },
  holdingVetoes: [{ id: 'static', kind: 'static-drawdown', label: '静态最大回撤', direction: '>=', threshold: 5, enabled: true }],
} satisfies QualityGroup);
const monitor = { version: INSTANT_TEMPLATE_MONITOR, templateId: 'template-1', name: '持仓快照', plan: template };
const sample: PreEntryRecord['sample'] = { id: 'sample', groups: [], basis: 'signal', enteredAt: entry, importedAt: entry,
  source: { id: 'capture', symbol: 'TESTUSDT', timeMs: entry - m, timeLabel: '', fallbackZone: '', fish: {
    ...snapshot, combination: 'or', hitAlgorithms: [1, 2], algorithms: [
      { ...snapshot, featureShort: 'CDA', average: 0.125, scale: 100 },
      { ...snapshot, featureShort: '状态 S', average: 0.95, scale: 1 },
      { ...snapshot, featureShort: 'BSS', average: 2, scale: 1 },
    ],
  } },
};
const screening = freezeQualityPlan({ ...template, id: 'entry', label: '独立三阶方案',
  preEntryThreeStage: signalAnchoredPreEntryThreeStage(emptyPreEntryThreeStage()),
});
const round: PreEntryRound = { id: 'auto', startedAt: entry - m, updatedAt: entry, hours: 4, state: 'complete',
  filters: [], plans: [screening], instantMonitor: monitor };
const record: PreEntryRecord = { id: 'auto:0:entry', roundId: round.id, planId: 'entry', sample,
  status: 'matched', readings: [], matchedAt: entry, startTime: entry - m, cursor: entry, updatedAt: entry };
const load: FishReconstructionLoader = async (_source, from, end, plan) => Array.from({ length: (end - from) / plan.step }, (_, index) => {
  const openTime = from + index * plan.step;
  return { openTime, open: 100, high: openTime === entry ? 103 : 101, low: openTime >= entry + 2*m ? 94 : 99, close: 100,
    volume: 1, takerBuyVolume: .5 };
});
const signal = new AbortController().signal;

it('freezes the original template, applies its mirror and stop to the 200 USDT simulation, and projects a complete campaign', async () => {
  const before = structuredClone(template);
  const at = entry + 2*m;
  const open = await evaluateInstantMonitor(sample, monitor, at, load, signal);
  expect(open).toMatchObject({ status: 'open', initialNotional: 200, mirrorFill: { price: 102, fraction: .5 }, remainingFraction: .5 });
  const closed = await evaluateInstantMonitor(sample, monitor, at + m, load, signal, open);
  expect(closed).toMatchObject({ status: 'closed', endTime: at, endPrice: 95, pnl: expect.closeTo(-3) });
  const input = instantCampaignInput(record, round, instantMonitorSale(closed), closed)!;
  const unexpectedLoad = vi.fn(async () => { throw Error('closed campaign already contains its fills'); });
  const frozen = await freezeInstantCampaign(input, unexpectedLoad, signal);
  expect(unexpectedLoad).not.toHaveBeenCalled();
  const data = buildInstantCampaignData('account', frozen);
  expect(data.campaign).toMatchObject({ initial_main_size_usdt: 200, initial_leverage: 5,
    comparison: { section: 'instant', monitorPlan: before, instant: { metadata: {
      fishing: { combination: 'or', algorithms: [{ reading: 12.5 }, { reading: .95 }] },
      screening: { plan: screening, hours: 4, matchedAt: entry },
    } } } });
  expect(data.tradeRecords.map(row => [row.quantity, row.leverage, row.exitPrice])).toEqual([[1, 5, 102], [1, 5, 95]]);
  expect(qualityCampaignStaticRisk(data.campaign)?.loss).toBe(10);
  expect(template).toEqual(before);
  expect(instantMonitorTemplateIssue({ id: 'entry', name: 'Entry', plan: screening, savedAt: entry, updatedAt: entry })).toBeDefined();
});

it('uses the same remaining quantity on manual close and keeps the actual adds and reductions in the campaign', async () => {
  const open = await evaluateInstantMonitor(sample, monitor, entry + 2*m, load, signal);
  const addition = { at: entry+m, price: 100, quantity: 2, notional: 200, label: '附加', reading: 2, threshold: 1, direction: '>' as const, scanFrom: entry, metric: 'CDA', barOpenTime: entry };
  const reduction = { at: entry+m+1, price: 105, fraction: .5, previousK: 99, newK: 95, quantity: 1.5,
    costRemoved: 150, realizedPnl: 7.5, breakeven: 100, previousSupport: 99, newSupport: 95, atr: 1 } satisfies NonNullable<QualityResult['additionReductions']>[number];
  const state = { ...open, additionFill: addition, additionFills: [addition], additionReductions: [reduction] };
  const closed = manualInstantMonitorClose(state, monitor, entry+2*m, 110);
  expect(closed).toMatchObject({ status: 'closed', reason: '手动卖出', remainingQuantity: 0, pnl: expect.closeTo(24.5) });
  const input = instantCampaignInput(record, round, instantMonitorSale(closed), closed)!;
  const data = buildInstantCampaignData('account', await freezeInstantCampaign(input, load, signal));
  expect(data.legs.map(leg => leg.pre_position_size)).toEqual([100, 100, 200]);
  expect(data.tradeRecords.filter(row => row.exitPrice === 105)).toHaveLength(2);
  expect(data.tradeRecords.reduce((pnl, row) => pnl + row.pnl, 0)).toBeCloseTo(24.5);
  expect(data.campaign.comparison?.sellEvidence?.exitReason).toBe('手动卖出');
});
