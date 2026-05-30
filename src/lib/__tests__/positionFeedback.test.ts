import { describe, expect, it } from 'vitest';

import {
  analyzePositionFeedback,
  type ExistingPositionLite,
  type PositionFeedbackInput,
} from '../positionFeedback';

const NOW = new Date('2024-06-01T12:00:00Z').getTime();

function base(overrides: Partial<PositionFeedbackInput> = {}): PositionFeedbackInput {
  return {
    proposedSide: 'LONG',
    proposedLeverage: 10,
    markPrice: 100,
    positions: [],
    recentCloses: [],
    nowMs: NOW,
    ...overrides,
  };
}

function pos(overrides: Partial<ExistingPositionLite> = {}): ExistingPositionLite {
  return { side: 'LONG', entryPrice: 100, quantity: 1, leverage: 10, ...overrides };
}

describe('analyzePositionFeedback', () => {
  it('flags averaging down when adding to a losing same-side position', () => {
    const r = analyzePositionFeedback(base({
      proposedSide: 'LONG',
      positions: [pos({ side: 'LONG', entryPrice: 120 })], // entry above mark 100 → LONG in loss
      markPrice: 100,
    }));
    expect(r.signals.map(s => s.kind)).toContain('averaging_down');
    expect(r.signals.find(s => s.kind === 'averaging_down')?.polarity).toBe('danger');
    expect(r.sameSideUnrealizedPnl).toBeLessThan(0);
  });

  it('marks healthy pyramiding when adding to a winning same-side position', () => {
    const r = analyzePositionFeedback(base({
      proposedSide: 'LONG',
      positions: [pos({ side: 'LONG', entryPrice: 80 })], // entry below mark 100 → LONG in profit
      markPrice: 100,
    }));
    const pyramid = r.signals.find(s => s.kind === 'healthy_pyramid');
    expect(pyramid).toBeDefined();
    expect(pyramid?.polarity).toBe('healthy');
    expect(r.sameSideUnrealizedPnl).toBeGreaterThan(0);
  });

  it('suggests add/roll when a two-sided structure has already locked in mathematical profit', () => {
    const r = analyzePositionFeedback(base({
      proposedSide: 'LONG',
      proposedOrderKind: 'hedge',
      recommendedMaxLossUsdt: 300,
      positions: [
        pos({ side: 'LONG', entryPrice: 80, quantity: 3 }),
        pos({ side: 'SHORT', entryPrice: 110, quantity: 1 }),
      ],
      markPrice: 100,
    }));
    const lockin = r.signals.find(s => s.kind === 'mathematical_lockin');
    expect(lockin).toBeDefined();
    expect(lockin?.title).toContain('滚仓');
    expect(r.hasTwoSidedStructure).toBe(true);
    expect(r.totalUnrealizedPnl).toBeGreaterThan(0);
  });

  it('flags a leverage spiral when the new order out-levers existing positions', () => {
    const r = analyzePositionFeedback(base({
      proposedLeverage: 25,
      positions: [pos({ leverage: 10 })],
    }));
    const spiral = r.signals.find(s => s.kind === 'leverage_spiral');
    expect(spiral).toBeDefined();
    expect(spiral?.polarity).toBe('caution');
  });

  it('flags a revenge trade when a recent loss sits inside the window', () => {
    const r = analyzePositionFeedback(base({
      recentCloses: [{ pnlUsdt: -250, closeTimeMs: NOW - 60 * 60_000 }], // 1h ago, inside 4h window
    }));
    const revenge = r.signals.find(s => s.kind === 'revenge_trade');
    expect(revenge).toBeDefined();
    expect(revenge?.polarity).toBe('danger');
  });

  it('does not flag revenge for losses outside the window or for wins', () => {
    const r = analyzePositionFeedback(base({
      recentCloses: [
        { pnlUsdt: -250, closeTimeMs: NOW - 10 * 60 * 60_000 }, // 10h ago, outside window
        { pnlUsdt: 400, closeTimeMs: NOW - 30 * 60_000 }, // a win
      ],
    }));
    expect(r.signals.map(s => s.kind)).not.toContain('revenge_trade');
  });

  it('returns no signals for a clean first entry', () => {
    const r = analyzePositionFeedback(base());
    expect(r.signals).toHaveLength(0);
    expect(r.hasExistingPosition).toBe(false);
    expect(r.sameSideUnrealizedPnl).toBeNull();
  });

  it('orders danger signals before caution and healthy', () => {
    const r = analyzePositionFeedback(base({
      proposedSide: 'LONG',
      proposedLeverage: 25,
      positions: [pos({ side: 'LONG', entryPrice: 120, leverage: 10 })], // losing + lower leverage
      markPrice: 100,
      recentCloses: [{ pnlUsdt: -100, closeTimeMs: NOW - 30 * 60_000 }],
    }));
    const ranks = r.signals.map(s => s.polarity);
    const dangerIdx = ranks.lastIndexOf('danger');
    const cautionIdx = ranks.indexOf('caution');
    expect(dangerIdx).toBeLessThan(cautionIdx);
  });
});
