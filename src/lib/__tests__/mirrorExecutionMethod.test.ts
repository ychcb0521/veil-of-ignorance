import { describe, expect, it } from 'vitest';
import { resolveMirrorCloseRatio } from '@/lib/mirrorExecutionMethod';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const openTime = Date.parse('2026-05-01T00:00:00Z');
const campaign = { direction: 'main_long', symbol: 'TESTUSDT' } as TradeCampaign;
const record = (id: string, quantity: number, extra: Partial<TradeRecord> = {}): TradeRecord => ({
  id, fillId: 'fill', positionId: 'position', symbol: 'TESTUSDT', side: 'LONG', action: 'CLOSE',
  entryPrice: 100, exitPrice: 105, quantity, openTime, closeTime: openTime + 60_000,
  ...extra,
} as TradeRecord);
const leg = (id: string, role: TradeJournal['leg_role'], extra: Partial<TradeJournal> = {}): TradeJournal => ({
  id, leg_role: role, symbol: 'TESTUSDT', direction: 'long', trade_record_id: id,
  pre_simulated_time: new Date(openTime).toISOString(), ...extra,
} as TradeJournal);
const main = leg('main', 'main_open');
const mirror = leg('mirror', 'mirror_tp');
const compute = (records: TradeRecord[], legs = [main, mirror], target = mirror) =>
  resolveMirrorCloseRatio(campaign, target, legs, records);

describe('strict mirror execution ratio', () => {
  it('recognizes actual 40/60 slices once, excluding funding, opens and hedges', () => {
    const result = compute([
      record('main', 4), record('mirror', 6), record('funding', 100, { action: 'FUNDING' }),
      record('open', 100, { action: 'OPEN' }), record('hedge', 100, { side: 'SHORT' }),
    ]);
    expect(result).toMatchObject({ reductionPct: 60, isStrict60Pct: true, openingUnits: 10, closedUnits: 6 });
  });

  it.each([50, 59.99, 60.01, 59.99999999, 60.00000001])('does not label %s%% as strict 60%%', pct => {
    expect(compute([record('main', 100 - pct), record('mirror', pct)]))
      .toMatchObject({ reductionPct: pct, isStrict60Pct: false });
  });

  it('accepts only arithmetic noise, without rounding ratios', () => {
    expect(compute([record('main', .1 + .1), record('mirror', .1 + .2)]))
      .toMatchObject({ isStrict60Pct: true });
  });

  it('keeps unclaimed partial-close slices in the full opening denominator', () => {
    expect(compute([record('main', 2), record('mirror', 6), record('unclaimed', 2)]))
      .toMatchObject({ reductionPct: 60, isStrict60Pct: true, openingUnits: 10 });
  });

  it('does not include later additions sharing a positionId', () => {
    expect(compute([
      record('main', 4), record('mirror', 6),
      record('add', 100, { fillId: 'add-fill', openTime: openTime + 1_000 }),
    ], [main, mirror, leg('add', 'main_add_1')]))
      .toMatchObject({ reductionPct: 60, openingUnits: 10 });
  });

  it('handles legacy partial closes without fillId, excluding a later opening', () => {
    expect(compute([
      record('main', 4, { fillId: undefined }), record('mirror', 6, { fillId: undefined }),
      record('add', 100, { fillId: undefined, openTime: openTime + 1_000 }),
    ])).toMatchObject({ reductionPct: 60, openingUnits: 10 });
  });

  it('is symmetric for short campaigns', () => {
    const shortMain = { ...main, direction: 'short' as const };
    const shortMirror = { ...mirror, direction: 'short' as const };
    expect(resolveMirrorCloseRatio(
      { ...campaign, direction: 'main_short' }, shortMirror, [shortMain, shortMirror],
      [record('main', 4, { side: 'SHORT' }), record('mirror', 6, { side: 'SHORT' })],
    )).toMatchObject({ reductionPct: 60, isStrict60Pct: true });
  });

  it('uses each actual opening group instead of all campaign mains', () => {
    const main2 = leg('main2', 'main_open');
    const mirror2 = leg('mirror2', 'mirror_tp');
    const records = [record('main', 4), record('mirror', 6), record('main2', 40, { fillId: 'fill2' }), record('mirror2', 60, { fillId: 'fill2' })];
    const legs = [main, mirror, main2, mirror2];
    expect(compute(records, legs, mirror)).toMatchObject({ reductionPct: 60, openingUnits: 10 });
    expect(compute(records, legs, mirror2)).toMatchObject({ reductionPct: 60, openingUnits: 100 });
  });

  it('recognizes independent positions in one exact opening cohort using quantity, not prices', () => {
    expect(compute([
      record('main', 4, { fillId: 'main-fill', entryPrice: 100 }),
      record('mirror', 6, { fillId: 'mirror-fill', entryPrice: 101 }),
    ])).toMatchObject({ reductionPct: 60, isStrict60Pct: true });
  });

  it('sums partial closes of one independently recorded mirror position', () => {
    expect(compute([
      record('main', 4, { fillId: 'main-fill' }),
      record('mirror', 3, { fillId: 'mirror-fill' }),
      record('mirror-cut-2', 3, { fillId: 'mirror-fill' }),
    ])).toMatchObject({ reductionPct: 60, closedUnits: 6 });
  });

  it('separate mirror legs on shared fill describe their individual cuts', () => {
    const mirror2 = leg('mirror2', 'mirror_tp');
    const records = [record('main', 4), record('mirror', 3), record('mirror2', 3)];
    expect(compute(records, [main, mirror, mirror2])).toMatchObject({ reductionPct: 30, isStrict60Pct: false });
  });

  it('uses contracts for coin settlement, including strict non-60 contract rounding', () => {
    const coin = { settlementMode: 'coin', contractSizeUsd: 10 } as const;
    expect(compute([record('main', 999, { ...coin, contracts: 4 }), record('mirror', 1, { ...coin, contracts: 6 })]))
      .toMatchObject({ reductionPct: 60, isStrict60Pct: true });
    expect(compute([record('main', 1, { ...coin, contracts: 26_943 }), record('mirror', 1, { ...coin, contracts: 40_415 })])?.isStrict60Pct)
      .toBe(false);
  });

  it('keeps records-free snapshots and ambiguous simultaneous mains unknown', () => {
    expect(compute([], [{ ...main, pre_position_size: 400 }, { ...mirror, pre_position_size: 600 }])).toBeNull();
    expect(compute([
      record('main', 4, { fillId: 'main-fill' }), record('mirror', 6, { fillId: 'mirror-fill' }),
      record('main2', 10, { fillId: 'main2-fill' }),
    ], [main, mirror, leg('main2', 'main_open')])).toBeNull();
  });

  it('does not pool different replay sessions, or pretend a missing leg is zero', () => {
    expect(compute([
      record('main', 4, { fillId: 'main-fill', openedTimelineId: 'one' }),
      record('mirror', 6, { fillId: 'mirror-fill', openedTimelineId: 'two' }),
    ])).toBeNull();
    expect(compute([record('mirror', 6, { fillId: 'mirror-fill' })])).toBeNull();
  });

  it('does not treat position-only aliases as known individual mirror cuts', () => {
    const aliasedMirror = { ...mirror, trade_record_id: 'fill' };
    expect(compute([record('main', 4), record('mirror', 6)], [main, aliasedMirror], aliasedMirror))
      .toBeNull();
  });
});
