import { expect, it, vi } from 'vitest';
import { loadQualityScanChunk } from '../qualityScanChunk';
import { compileFishProgram } from '../algorithm';
import { FishError, validateFishBars } from '../shared';
import type { FishReconstructionLoader } from '../reconstruction';

const step = 60_000, start = Date.UTC(2026, 2, 29, 5);
const plan = compileFishProgram({ id: 'price', name: 'price', short: 'price', definition: '', formula: 'C', scale: 1, unit: '', positive: '1', control: '0', interval: '1m' }, { statistic: '结果', direction: '>', threshold: 0, constraints: [] });
const source = { id: 's', symbol: 'TURING:TURING 50', timeMs: start + 100 * step, timeLabel: '', fallbackZone: '' };
const loader: FishReconstructionLoader = async (_row, from, to) => {
  const bars = Array.from({ length: (to - from) / step }, (_, i) => ({ openTime: from + i * step, open: 10, high: 11, low: 9, close: 10, volume: 1, takerBuyVolume: .5 })).filter(b => b.openTime !== start + 9 * step);
  validateFishBars(bars, to, (to - from) / step, step);
  return bars;
};
it('keeps all warmup and returns a contiguous prefix before a later offline gap', async () => {
  const result = await loadQualityScanChunk(loader, source, start, start + 2 * step, start + 20 * step, plan, new AbortController().signal);
  expect(result.cut).toBeLessThanOrEqual(start + 9 * step);
  expect(result.cut).toBeGreaterThan(start + 2 * step);
  expect(result.bars[0].openTime).toBe(start);
  validateFishBars(result.bars, result.cut, (result.cut - start) / step, step);
});
it('still fails when the next candle itself is missing; never advances over a gap', async () => {
  await expect(loadQualityScanChunk(loader, source, start + 8 * step, start + 9 * step, start + 20 * step, plan, new AbortController().signal)).rejects.toMatchObject({ kind: 'gap' });
});
it('does not retry a missing dependency or alter ordinary exchange requests', async () => {
  const missing = vi.fn(async () => { throw new FishError('BTC dependency missing', 'readings'); });
  await expect(loadQualityScanChunk(missing, source, start, start + step, start + 20 * step, plan, new AbortController().signal)).rejects.toThrow('BTC');
  expect(missing).toHaveBeenCalledOnce();
  const online = vi.fn(loader);
  await expect(loadQualityScanChunk(online, { ...source, symbol: 'BTCUSDT' }, start, start + step, start + 20 * step, plan, new AbortController().signal)).rejects.toMatchObject({ kind: 'gap' });
  expect(online).toHaveBeenCalledOnce();
});
