import { describe, expect, it } from 'vitest';
import { computeFeatures } from '../features';
import { computeEntrySnapshot, formatEntryDeviation, formatEntryPrice } from '../entrySnapshot';
import { mulberry32 } from '../grouping';
import { BAR_MS, extractWindow, type ResearchBar } from '../window';

function bars(anchorMs: number, n = 600, seed = 3): ResearchBar[] {
  const rand = mulberry32(seed);
  let price = 1;
  return Array.from({ length: n }, (_, i) => {
    const openTime = anchorMs - (n - i) * BAR_MS;
    const open = price;
    price *= Math.exp(0.004 * (rand() - 0.45));
    const close = price;
    const high = Math.max(open, close) * (1 + 0.002 * rand());
    const low = Math.min(open, close) * (1 - 0.002 * rand());
    const volume = 100 + 900 * rand();
    return { openTime, open, high, low, close, volume, takerBuyVolume: volume * rand() };
  });
}

describe('进场时的谢林偏离', () => {
  const anchor = Date.parse('2026-04-12T05:05:00Z');

  it('与 Deep RSA 特征同一个数：偏离 12h VWAP = vwap12_dev，偏离 POC = poc_dev_w（h = 6）；只用 t₀ 之前已收盘的 K 线', () => {
    const all = [...bars(anchor), ...bars(anchor + 12 * BAR_MS, 12, 9).map(b => ({ ...b, close: b.close * 50 }))];
    const snap = computeEntrySnapshot(all, anchor)!;
    const f = computeFeatures(extractWindow(all, anchor), { halfLifeHours: 6 });
    expect(snap.vwapDev).toBeCloseTo(f.vwap12_dev!, 12);
    expect(snap.pocDev).toBeCloseTo(f.poc_dev_w!, 12);
    expect(snap.closeTimeMs).toBe(anchor);
    expect(Math.log(snap.close / snap.vwap!)).toBeCloseTo(snap.vwapDev!, 12);
    expect(snap.coverage).toBe(1);
  });

  it('窗口里没有 K 线 → null；缺一半 → 照算并如实给出覆盖率', () => {
    expect(computeEntrySnapshot([], anchor)).toBeNull();
    const half = bars(anchor).filter((_, i) => i % 2 === 0);
    expect(computeEntrySnapshot(half, anchor)!.coverage).toBeCloseTo(0.5, 1);
  });

  it('读数：对数偏离换算成百分比，带符号一位小数；价格按量级保留有效位', () => {
    expect(formatEntryDeviation(0.0555)).toBe('+5.7%');
    expect(formatEntryDeviation(-0.02)).toBe('−2.0%');
    expect(formatEntryDeviation(0.00001)).toBe('0.0%');
    expect(formatEntryDeviation(1)).toBe('+172%');
    expect(formatEntryDeviation(null)).toBe('—');
    expect(formatEntryPrice(0.000481)).toBe('0.000481');
    expect(formatEntryPrice(0.13554)).toBe('0.1355');
    expect(formatEntryPrice(105.234567)).toBe('105.2346');
    expect(formatEntryPrice(63250.27)).toBe('63250.3');
  });
});
