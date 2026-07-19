import { describe, expect, it } from 'vitest';
import { computeCurrentAccountEquity } from '@/lib/accountEquity';
import type { Position } from '@/types/trading';

function makePosition(overrides: Partial<Position>): Position {
  return {
    id: overrides.id ?? 'position',
    side: overrides.side ?? 'LONG',
    entryPrice: overrides.entryPrice ?? 100,
    quantity: overrides.quantity ?? 1,
    leverage: overrides.leverage ?? 1,
    marginMode: overrides.marginMode ?? 'cross',
    margin: overrides.margin ?? 100,
    isolatedMargin: overrides.isolatedMargin,
  };
}

describe('current account equity', () => {
  it('matches the live total-assets definition: wallet balance plus all unrealized P&L', () => {
    const positions = {
      BTCUSDT: [makePosition({ id: 'long', entryPrice: 100, quantity: 2 })],
      ETHUSDT: [makePosition({
        id: 'short',
        side: 'SHORT',
        entryPrice: 50,
        quantity: 3,
        marginMode: 'isolated',
        isolatedMargin: 500,
      })],
    };

    // Long: +20; short: +15. Reserved margin is already reflected in balance.
    expect(computeCurrentAccountEquity(10_000, positions, {
      BTCUSDT: 110,
      ETHUSDT: 45,
    })).toBe(10_035);
  });

  it('falls back to entry price for a missing mark and clamps insolvent equity at zero', () => {
    const positions = {
      BTCUSDT: [makePosition({ side: 'LONG', entryPrice: 100, quantity: 20 })],
    };

    expect(computeCurrentAccountEquity(1_000, positions, {})).toBe(1_000);
    expect(computeCurrentAccountEquity(1_000, positions, { BTCUSDT: 0 })).toBe(1_000);
    expect(computeCurrentAccountEquity(1_000, positions, { BTCUSDT: 1 })).toBe(0);
  });
});
