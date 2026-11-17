import { expect, it } from 'vitest';
import { CDA_DEF } from '@/lib/deepDig/features';
import { makeQualityBuyFilter } from '../qualityFilters';
import { defaultBoxStop, selectBoxStopTimeframe } from '../qualityBoxStop';
import { BOX_MARKET_REPAIR_VERSION, BOX_STOP_INVALID_DATA, BULLA_BOX_MARKET_REPAIR_VERSION } from '../qualityBoxMarketRepair';
import { evaluateQualitySample, evaluateQualitySampleWithMarketRepair, type QualityGroup, type QualitySample } from '../quality';
import { freezeQualityPlan, planVersionChanges } from '../qualityPlanVersions';
import type { FishReconstructionLoader } from '../reconstruction';

const minute = 60_000;
const config = [
  ['AKEUSDT', Date.UTC(2026, 7, 15, 6), '0.0097692', '0.000001', '5m', BOX_MARKET_REPAIR_VERSION],
  ['RAVEUSDT', Date.UTC(2026, 3, 27, 6, 30), '0.8665000', '0.0001', '5m', BOX_MARKET_REPAIR_VERSION],
  ['BULLAUSDT', Date.UTC(2026, 10, 16, 19, 25), '0.0124210', '0.00001', '5m', BULLA_BOX_MARKET_REPAIR_VERSION],
  ['BULLAUSDT', Date.UTC(2026, 10, 16, 20, 25), '0.0706460', '0.00001', '1h', BULLA_BOX_MARKET_REPAIR_VERSION],
] as const;

it.each(config)('recovers %s (%s, %s, tick %s, %s) without changing the frozen plan', async (symbol, entry, raw, tick, timeframe, repairVersion) => {
  const snapshot = makeQualityBuyFilter('cda:CDA', '<', -15, true, [CDA_DEF]).snapshot;
  const boxStop = selectBoxStopTimeframe(defaultBoxStop(), timeframe);
  const plan = freezeQualityPlan({ id: 'holding', label: 'holding', snapshot, metric: 'CDA',
    holdingVetoes: [{ id: 'box', label: 'box', kind: 'box-stop', threshold: 0, direction: '<=', enabled: true, boxStop }],
  } satisfies QualityGroup);
  const frozen = structuredClone(plan);
  const sample: QualitySample = { id: 's', enteredAt: entry, basis: 'signal', importedAt: entry, groups: [],
    source: { id: 's', timeMs: entry, symbol, timeLabel: '', fallbackZone: '' } };
  const signal = new AbortController().signal;
  const p = Number(raw) + (symbol === 'RAVEUSDT' ? 0.00001 : 0);
  const originalPrice = String(p.toFixed(7));
  const nativeStep = timeframe === '5m' ? 5 * minute : 60 * minute;
  const createLoad = (gap = false, unsupported = false): FishReconstructionLoader => async (_row, from, cut, program) => {
    const bars = Array.from({ length: (cut - from) / program.step }, (_, i) => {
      const price = unsupported && program.step === nativeStep ? originalPrice + '1' : originalPrice;
      return { openTime: from + i * program.step, open: Number(price), high: Number(price), low: Number(price), close: Number(price),
        volume: 1, takerBuyVolume: 0.5, PRS6H_data_source: 'binance-usdm', PRS6H_tick_size: Number(tick),
        DBL5_prices: { open: price, high: price, low: price, close: price } };
    });
    return gap && program.step === nativeStep ? bars.slice(1) : bars;
  };
  const end = entry + 10 * minute, load = createLoad();
  expect(await evaluateQualitySample(sample, plan, 0, end, load, signal)).toMatchObject({ status: 'error', reason: BOX_STOP_INVALID_DATA });
  const recovered = await evaluateQualitySampleWithMarketRepair(sample, plan, 0, end, load, signal);
  expect(recovered).toMatchObject({ status: 'open', boxMarketRepair: repairVersion, entryPrice: Number(originalPrice) });
  expect(await evaluateQualitySampleWithMarketRepair(sample, plan, 0, end + minute, load, signal, recovered))
    .toMatchObject({ status: 'open', boxMarketRepair: repairVersion, endTime: end + minute });
  expect(await evaluateQualitySampleWithMarketRepair(sample, plan, 0, end, createLoad(true), signal)).toMatchObject({ status: 'error' });
  expect(await evaluateQualitySampleWithMarketRepair(sample, plan, 0, end, createLoad(false, true), signal)).toMatchObject({ status: 'error' });
  expect(plan).toEqual(frozen);
  expect(planVersionChanges(plan)).toEqual([]);
});
