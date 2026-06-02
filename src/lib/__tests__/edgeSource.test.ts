import { describe, expect, it } from 'vitest';

import {
  aggregateEdgeSourcePnl,
  aggregateEdgeSourceUsage,
  findSameSourceEdge,
  EDGE_SOURCE_OPTIONS,
  EDGE_SOURCE_LABELS,
  HAMMER_DOMINANCE_THRESHOLD,
  HAMMER_MIN_SAMPLES,
  type EdgeSourceJournalLite,
  type EdgeSourceUsageLite,
} from '../edgeSource';

function j(
  edge: EdgeSourceJournalLite['pre_edge_source'],
  outcome: EdgeSourceJournalLite['post_outcome'],
  pnl: number,
): EdgeSourceJournalLite {
  return { pre_edge_source: edge, post_outcome: outcome, post_realized_pnl: pnl };
}

describe('EDGE_SOURCE_OPTIONS', () => {
  it('every option id has a matching label', () => {
    for (const opt of EDGE_SOURCE_OPTIONS) {
      expect(EDGE_SOURCE_LABELS[opt.id]).toBe(opt.label);
    }
  });

  it('renders the five source checks in the new snapshot', () => {
    expect(EDGE_SOURCE_OPTIONS.map((o) => o.id)).toEqual([
      'trend_follow',
      'breakout',
      'mean_reversion',
      'squeeze_release',
      'no_clear_edge',
    ]);
    expect(EDGE_SOURCE_OPTIONS.filter((o) => o.isWarning).map((o) => o.id)).toEqual(['no_clear_edge']);
  });
});

describe('aggregateEdgeSourcePnl', () => {
  it('groups wins/losses/PnL by edge and ignores untagged / non-decisive trades', () => {
    const stats = aggregateEdgeSourcePnl([
      j('against_crowd', 'win', 100),
      j('against_crowd', 'loss', -40),
      j('against_crowd', 'win', 60),
      j('trend_follow', 'loss', -20),
      j(null, 'win', 999), // untagged → ignored
      j('breakout', 'breakeven', 0), // not decisive → ignored
      j('breakout', 'no_entry', 0), // not decisive → ignored
    ]);

    const ac = stats.find((s) => s.edge === 'against_crowd')!;
    expect(ac.trades).toBe(3);
    expect(ac.wins).toBe(2);
    expect(ac.losses).toBe(1);
    expect(ac.netPnl).toBe(120);
    expect(ac.totalWinPnl).toBe(160);
    expect(ac.totalLossPnl).toBe(-40);

    // breakeven/no_entry produced no bucket for breakout
    expect(stats.find((s) => s.edge === 'breakout')).toBeUndefined();
  });

  it('sorts by trade count descending', () => {
    const stats = aggregateEdgeSourcePnl([
      j('trend_follow', 'win', 10),
      j('against_crowd', 'win', 10),
      j('against_crowd', 'loss', -5),
    ]);
    expect(stats[0].edge).toBe('against_crowd');
  });
});

describe('aggregateEdgeSourceUsage', () => {
  function u(
    edge: EdgeSourceUsageLite['pre_edge_source'],
    extra: Partial<EdgeSourceUsageLite> = {},
  ): EdgeSourceUsageLite {
    return { pre_edge_source: edge, order_kind: 'main', direction: 'long', ...extra };
  }

  it('counts main-order entered trades by edge and excludes hedge / no_entry / untagged', () => {
    const c = aggregateEdgeSourceUsage([
      u('trend_follow'),
      u('trend_follow'),
      u('trend_follow'),
      u('breakout'),
      u('trend_follow', { order_kind: 'hedge' }), // hedge → excluded
      u('trend_follow', { direction: 'no_entry' }), // no_entry → excluded
      u(null), // untagged → excluded
      u('mean_reversion', { journal_kind: 'no_trade' }), // not a trade → excluded
    ]);

    expect(c.total).toBe(4);
    expect(c.usage[0]).toMatchObject({ edge: 'trend_follow', count: 3 });
    expect(c.usage[0].share).toBeCloseTo(0.75, 5);
    expect(c.dominant?.edge).toBe('trend_follow');
  });

  it('flags 铁锤人 when the dominant edge passes the threshold with enough samples', () => {
    const journals = Array.from({ length: HAMMER_MIN_SAMPLES }, () => u('trend_follow'));
    const c = aggregateEdgeSourceUsage(journals);
    expect(c.dominant?.share).toBe(1);
    expect(c.dominant!.share).toBeGreaterThanOrEqual(HAMMER_DOMINANCE_THRESHOLD);
    expect(c.isConcentrated).toBe(true);
  });

  it('does not flag concentration below the minimum sample size', () => {
    const c = aggregateEdgeSourceUsage([u('trend_follow'), u('trend_follow')]);
    expect(c.dominant?.share).toBe(1);
    expect(c.total).toBeLessThan(HAMMER_MIN_SAMPLES);
    expect(c.isConcentrated).toBe(false);
  });

  it('does not flag when usage is spread across sources', () => {
    const c = aggregateEdgeSourceUsage([
      u('trend_follow'),
      u('trend_follow'),
      u('breakout'),
      u('mean_reversion'),
      u('squeeze_release'),
      u('breakout'),
    ]);
    expect(c.total).toBe(6);
    expect(c.isConcentrated).toBe(false);
  });

  it('returns an empty profile with no qualifying trades', () => {
    const c = aggregateEdgeSourceUsage([]);
    expect(c.total).toBe(0);
    expect(c.usage).toEqual([]);
    expect(c.dominant).toBeNull();
    expect(c.isConcentrated).toBe(false);
  });
});

describe('findSameSourceEdge', () => {
  it('flags the edge that is BOTH the biggest winner and biggest loser (盈亏同源)', () => {
    const stats = aggregateEdgeSourcePnl([
      j('against_crowd', 'win', 200),
      j('against_crowd', 'loss', -150),
      j('trend_follow', 'win', 30),
      j('trend_follow', 'loss', -10),
    ]);
    expect(findSameSourceEdge(stats)).toBe('against_crowd');
  });

  it('returns null when winners and losers come from different sources', () => {
    const stats = aggregateEdgeSourcePnl([
      j('against_crowd', 'win', 200),
      j('trend_follow', 'loss', -150),
    ]);
    expect(findSameSourceEdge(stats)).toBeNull();
  });

  it('returns null with no decisive trades', () => {
    expect(findSameSourceEdge([])).toBeNull();
  });
});
