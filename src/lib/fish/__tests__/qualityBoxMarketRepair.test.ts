import { expect, it } from 'vitest';
import { dbl5PriceTicks } from '@/lib/dbl5m';
import { CDA_DEF } from '@/lib/deepDig/features';
import { makeQualityBuyFilter } from '../qualityFilters';
import { defaultBoxStop, selectBoxStopTimeframe } from '../qualityBoxStop';
import { archivedBoxMarketRepair, ARCHIVED_BOX_TICK_VERSION, BOX_MARKET_REPAIR_VERSION, BOX_STOP_INVALID_DATA, BULLA_BOX_MARKET_REPAIR_VERSION, HISTORICAL_BOX_MARKET_REPAIR_VERSION, qualityBoxMarketRepair } from '../qualityBoxMarketRepair';
import { evaluateQualitySample, evaluateQualitySampleWithMarketRepair, type QualityGroup, type QualitySample } from '../quality';
import { freezeQualityPlan, planVersionChanges } from '../qualityPlanVersions';
import type { FishReconstructionLoader } from '../reconstruction';

const minute = 60_000;
const config = [
  ['STABLEUSDT', Date.UTC(2026, 1, 25, 14, 10), '0.031237', '0.00001', '5m', ARCHIVED_BOX_TICK_VERSION],
  ['SOLUSDT', Date.UTC(2025, 1, 14, 10, 25), '192.271', '0.01', '5m', ARCHIVED_BOX_TICK_VERSION],
  ['ONUSDT', Date.UTC(2026, 4, 8, 18, 20), '0.13552', '0.0001', '5m', HISTORICAL_BOX_MARKET_REPAIR_VERSION],
  ['币安人生USDT', Date.UTC(2026, 3, 8, 10, 5), '0.07106', '0.0001', '5m', HISTORICAL_BOX_MARKET_REPAIR_VERSION],
  ['SOONUSDT', Date.UTC(2025, 7, 9, 6, 25), '0.18972', '0.0001', '5m', HISTORICAL_BOX_MARKET_REPAIR_VERSION],
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
  expect(await evaluateQualitySample(sample, plan, 0, end, load, signal)).toMatchObject({ status: 'error', reason: expect.stringContaining(BOX_STOP_INVALID_DATA) });
  const recovered = await evaluateQualitySampleWithMarketRepair(sample, plan, 0, end, load, signal);
  expect(recovered).toMatchObject({ status: 'open', boxMarketRepair: repairVersion, entryPrice: Number(originalPrice) });
  expect(await evaluateQualitySampleWithMarketRepair(sample, plan, 0, end + minute, load, signal, recovered))
    .toMatchObject({ status: 'open', boxMarketRepair: repairVersion, endTime: end + minute });
  expect(await evaluateQualitySampleWithMarketRepair(sample, plan, 0, end, createLoad(true), signal)).toMatchObject({ status: 'error' });
  expect(await evaluateQualitySampleWithMarketRepair(sample, plan, 0, end, createLoad(false, true), signal)).toMatchObject({ status: 'error' });
  if (repairVersion === ARCHIVED_BOX_TICK_VERSION) {
    expect(await evaluateQualitySampleWithMarketRepair(sample, plan, 0, end, load, signal, undefined, 100, end))
      .toMatchObject({ status: 'error', reason: expect.stringContaining(symbol) });
  }
  expect(plan).toEqual(frozen);
  expect(planVersionChanges(plan)).toEqual([]);
});

it('keeps FIL trade precision separate from order precision and rejects unverified prices', async () => {
  const symbol = 'FILUSDT';
  const step = 5 * minute;
  const at = Date.UTC(2026, 7, 31, 23, 50);
  const source = { id: symbol, symbol, timeMs: at + step, timeLabel: '', fallbackZone: '' };
  const plan = { step, compiled: { usesDbl5: true } } as Parameters<FishReconstructionLoader>[3];
  const signal = new AbortController().signal;
  let high = '0.682248', evidence = 'binance-usdm';
  const load: FishReconstructionLoader = async (_row, from) => [{
    openTime: from, open: 0.6808, high: Number(high), low: 0.6804, close: 0.6822,
    volume: 1, takerBuyVolume: 0.5, PRS6H_tick_size: 0.0001, PRS6H_data_source: evidence,
    DBL5_prices: { open: '0.680800', high, low: '0.680400', close: '0.682200' },
  }];
  const repaired = qualityBoxMarketRepair(load, symbol)!.load;
  const read = repaired.boxStopMarketLoad!;
  expect(repaired.boxAdditionMarketLoad).toBe(read);
  const candle = (time: number) => read(source, time, time + step, plan, signal);
  expect((await candle(at))[0]).toMatchObject({ high: 0.682248, DBL5_tick_size: '0.000001', DBL5_order_tick_size: '0.0001' });
  const [otherTime] = await candle(at + step);
  expect(() => dbl5PriceTicks(otherTime.DBL5_prices!.high, otherTime.DBL5_tick_size ?? otherTime.PRS6H_tick_size!)).toThrow('整数tick');
  high = '0.682247';
  expect((await candle(at))[0].DBL5_tick_size).toBeUndefined();
  evidence = 'other';
  expect((await candle(at))[0].DBL5_tick_size).toBeUndefined();
});

it('does not reinterpret unverified off-grid prices after an order-rule change', async () => {
  const at = Date.UTC(2026, 7, 15, 6);
  const load: FishReconstructionLoader = async (_row, from) => [{
    openTime: from, open: 0.13552, high: 0.13577, low: 0.13552, close: 0.13561, volume: 1, takerBuyVolume: 0.5,
    DBL5_prices: { open: '0.13552', high: '0.13577', low: '0.13552', close: '0.13561' },
    PRS6H_tick_size: 0.0001, PRS6H_data_source: 'binance-usdm',
  }];
  const read = qualityBoxMarketRepair(load, 'ONUSDT')!.load.boxStopMarketLoad!;
  const source = { id: 'on', symbol: 'ONUSDT', timeMs: at, timeLabel: '', fallbackZone: '' };
  const plan = { step: 5 * minute, compiled: { usesDbl5: true } } as Parameters<FishReconstructionLoader>[3];
  const [bar] = await read(source, at, at + plan.step, plan, new AbortController().signal);
  expect(bar.DBL5_tick_size).toBe('0.0001');
  expect(() => dbl5PriceTicks(bar.DBL5_prices!.open, bar.DBL5_tick_size!)).toThrow('整数tick');
});

it('uses only wholly covered native Binance candles and applies the order step to both box readers', async () => {
  const symbol = 'NXPCUSDT', step = 5 * minute, change = Date.UTC(2025, 8, 3, 7);
  const row = { id: symbol, symbol, timeMs: change, timeLabel: '', fallbackZone: '' };
  const price = '0.69283';
  const bar = { openTime: change, open: +price, high: +price, low: +price, close: +price, volume: 1, takerBuyVolume: 0.5,
    DBL5_prices: { open: price, high: price, low: price, close: price }, PRS6H_symbol: symbol, PRS6H_data_source: 'binance-usdm' };
  const base: FishReconstructionLoader = async (_row, from) => [{ ...bar, openTime: from }];
  const repaired = archivedBoxMarketRepair(base, symbol)!;
  const plan = { step, compiled: { usesDbl5: true } } as Parameters<FishReconstructionLoader>[3];
  const abort = new AbortController().signal;
  const read = (from: number, reader = repaired.boxStopMarketLoad!, source = row) => reader(source, from, from + step, plan, abort);
  expect(repaired.boxAdditionMarketLoad).toBe(repaired.boxStopMarketLoad);
  expect((await read(change - step))[0]).toMatchObject({ DBL5_tick_size: '0.00001', DBL5_order_tick_size: '0.00001' });
  expect((await read(change))[0]).toMatchObject({ DBL5_tick_size: '0.00001', DBL5_order_tick_size: '0.0001', DBL5_prices: bar.DBL5_prices });
  expect((await read(change, repaired))[0]).toEqual(bar);
  expect((await read(change - minute))[0].DBL5_order_tick_size).toBeUndefined();
  expect((await read(Date.UTC(2027, 0, 1)))[0].DBL5_order_tick_size).toBeUndefined();
  expect((await read(change, repaired.boxStopMarketLoad, { ...row, symbol: 'OTHER' }))[0].DBL5_order_tick_size).toBeUndefined();
  bar.PRS6H_data_source = 'turing-cup';
  expect((await read(change))[0].DBL5_order_tick_size).toBeUndefined();
});
