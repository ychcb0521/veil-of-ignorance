import { describe, it, expect } from 'vitest';
import { runCounterfactual } from '../counterfactualEngine';
import type { KlineData } from '@/hooks/useBinanceData';
import type { CounterfactualBranchParams } from '@/types/journal';

const MIN = 60_000;
const t0 = new Date('2024-01-01T00:00:00Z').getTime();

function k(i: number, o: number, h: number, l: number, c: number): KlineData {
  return { time: t0 + i * MIN, open: o, high: h, low: l, close: c, volume: 0 };
}

const baseParams = (over: Partial<CounterfactualBranchParams> = {}): CounterfactualBranchParams => ({
  direction: 'long',
  entry_price: 100,
  stop_loss: 95,
  take_profits: [{ price: 110, size_pct: 100 }],
  position_size_usdt: 1000,
  leverage: 1,
  entry_time: new Date(t0).toISOString(),
  max_hold_minutes: 60,
  ...over,
});

describe('runCounterfactual', () => {
  it('long hits TP1', () => {
    const klines = [
      k(0, 100, 105, 99, 104),
      k(1, 104, 112, 103, 110), // hits TP 110
    ];
    const r = runCounterfactual(klines, baseParams());
    expect(r.exit_reason).toBe('tp1_hit');
    expect(r.realized_pnl_usdt).toBeCloseTo(100, 1); // (110-100) * 10qty = 100
    expect(r.r_multiple).toBeCloseTo(100 / 50, 1); // planned loss=5*10=50
  });

  it('long hits SL', () => {
    const klines = [
      k(0, 100, 101, 99, 100),
      k(1, 100, 102, 94, 95), // low 94 < SL 95
    ];
    const r = runCounterfactual(klines, baseParams());
    expect(r.exit_reason).toBe('sl_hit');
    expect(r.realized_pnl_usdt).toBeCloseTo(-50, 1);
  });

  it('same-candle SL+TP picks SL conservatively', () => {
    const klines = [
      k(0, 100, 100, 100, 100),
      k(1, 100, 115, 94, 100), // hits both 95 SL and 110 TP — SL must win
    ];
    const r = runCounterfactual(klines, baseParams());
    expect(r.exit_reason).toBe('sl_hit');
    expect(r.realized_pnl_usdt).toBeLessThan(0);
  });

  it('short hits 2 partial TPs', () => {
    const klines = [
      k(0, 100, 100, 100, 100),
      k(1, 100, 100, 95, 96), // hits TP1 95 — short, low<=95
      k(2, 96, 96, 90, 91),   // hits TP2 90
    ];
    const r = runCounterfactual(klines, baseParams({
      direction: 'short',
      entry_price: 100,
      stop_loss: 105,
      take_profits: [{ price: 95, size_pct: 50 }, { price: 90, size_pct: 50 }],
    }));
    expect(r.exit_reason).toBe('tp2_hit');
    expect(r.realized_pnl_usdt).toBeGreaterThan(0);
  });

  it('timeout force-closes at last close', () => {
    const klines = [
      k(0, 100, 101, 99, 100),
      k(1, 100, 102, 98, 101),
      k(2, 101, 103, 99, 102),
    ];
    const r = runCounterfactual(klines, baseParams({ max_hold_minutes: 2 }));
    expect(r.exit_reason).toBe('timeout');
  });

  it('no_entry returns zero', () => {
    const r = runCounterfactual([], baseParams({ direction: 'no_entry' }));
    expect(r.exit_reason).toBe('no_entry');
    expect(r.realized_pnl_usdt).toBe(0);
  });

  it('no_data when klines empty', () => {
    const r = runCounterfactual([], baseParams());
    expect(r.exit_reason).toBe('no_data');
  });
});
