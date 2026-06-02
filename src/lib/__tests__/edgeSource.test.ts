import { describe, expect, it } from 'vitest';

import {
  aggregateEdgeSourcePnl,
  findSameSourceEdge,
  EDGE_SOURCE_OPTIONS,
  EDGE_SOURCE_LABELS,
  type EdgeSourceJournalLite,
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

  it('only no_clear_edge is flagged as a warning', () => {
    const warnings = EDGE_SOURCE_OPTIONS.filter((o) => o.isWarning);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].id).toBe('no_clear_edge');
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
