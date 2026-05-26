/**
 * Focused tests for the two trigger paths in evaluateCriticalPatterns.
 * We mock the supabase client at module-load time and feed back tables.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type {
  ErrorTagPattern,
  TradeJournal,
  JournalTagAssignment,
  TradingRule,
} from '@/types/journal';

interface MockTables {
  error_tag_patterns: ErrorTagPattern[];
  journal_tag_assignments: JournalTagAssignment[];
  trade_journals: TradeJournal[];
  trading_rules: TradingRule[];
}

const tables: MockTables = {
  error_tag_patterns: [],
  journal_tag_assignments: [],
  trade_journals: [],
  trading_rules: [],
};

vi.mock('@/integrations/supabase/client', () => {
  function from(table: keyof MockTables) {
    const builder = {
      _filtered: tables[table] as unknown[],
      select() { return this; },
      eq(col: string, val: unknown) {
        this._filtered = (this._filtered as Record<string, unknown>[]).filter(r => r[col] === val);
        return this;
      },
      then(resolve: (v: { data: unknown[]; error: null }) => void) {
        resolve({ data: this._filtered, error: null });
      },
    };
    return builder;
  }
  return { supabase: { from } };
});

// Import after the mock is registered
import { evaluateCriticalPatterns, CATASTROPHIC_LOSS_R_MULTIPLE } from '../criticalPatternDetector';

const userId = 'user-1';
const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86400_000).toISOString();

function journal(overrides: Partial<TradeJournal>): TradeJournal {
  return {
    id: `j-${Math.random()}`,
    user_id: userId,
    trade_record_id: null,
    campaign_id: null,
    leg_role: null,
    leg_sequence: null,
    source: 'live',
    symbol: 'BTCUSDT',
    direction: 'long',
    leverage: 10,
    position_mode: 'isolated',
    order_kind: 'main',
    pre_simulated_time: daysAgo(5),
    pre_real_time: daysAgo(5),
    pre_entry_price: 50000,
    pre_planned_stop_loss: null,
    pre_planned_take_profit: null,
    pre_entry_reason: 'reason',
    pre_mental_state: 4,
    pre_mental_trigger: null,
    pre_risk_awareness: null,
    pre_risk_management: null,
    pre_checklist_items: null,
    pre_checklist_passed: true,
    pre_position_size: 1000,
    pre_max_loss_usdt: 100,
    post_outcome: 'loss',
    post_realized_pnl: -50,
    post_r_multiple: -0.5,
    post_reflection: null,
    post_correct_action: null,
    post_reviewed_at: daysAgo(4),
    reason_was_rewritten: false,
    created_at: daysAgo(5),
    updated_at: daysAgo(4),
    ...overrides,
  };
}

function pattern(id: string, name: string): ErrorTagPattern {
  return {
    id,
    user_id: userId,
    category_id: 'c1',
    pattern_name: name,
    operational_definition: 'def',
    parent_id: null,
    occurrence_count: 0,
    last_seen_at: null,
    is_archived: false,
    created_at: daysAgo(30),
    updated_at: daysAgo(30),
  };
}

function assignment(journalId: string, patternId: string): JournalTagAssignment {
  return {
    id: `a-${Math.random()}`,
    user_id: userId,
    journal_id: journalId,
    pattern_id: patternId,
    tagged_phase: 'post',
    note: null,
    created_at: daysAgo(4),
  };
}

beforeEach(() => {
  tables.error_tag_patterns = [];
  tables.journal_tag_assignments = [];
  tables.trade_journals = [];
  tables.trading_rules = [];
});

describe('evaluateCriticalPatterns - frequency trigger', () => {
  it('fires when same pattern reached 3 losing journals in 30 days', async () => {
    const p = pattern('p1', 'rev-rev');
    const j1 = journal({ id: 'j1' });
    const j2 = journal({ id: 'j2' });
    const j3 = journal({ id: 'j3' });
    tables.error_tag_patterns = [p];
    tables.trade_journals = [j1, j2, j3];
    tables.journal_tag_assignments = [
      assignment('j1', 'p1'), assignment('j2', 'p1'), assignment('j3', 'p1'),
    ];
    const results = await evaluateCriticalPatterns(userId);
    expect(results).toHaveLength(1);
    expect(results[0].trigger).toBe('frequency');
    expect(results[0].pattern?.id).toBe('p1');
    expect(results[0].last_30d_count).toBe(3);
  });

  it('does not fire below threshold', async () => {
    const p = pattern('p1', 'rev-rev');
    tables.error_tag_patterns = [p];
    tables.trade_journals = [journal({ id: 'j1' }), journal({ id: 'j2' })];
    tables.journal_tag_assignments = [assignment('j1', 'p1'), assignment('j2', 'p1')];
    const results = await evaluateCriticalPatterns(userId);
    expect(results).toHaveLength(0);
  });
});

describe('evaluateCriticalPatterns - catastrophic trigger', () => {
  it('fires on a single trade where realized loss >= 2x planned max loss', async () => {
    const j = journal({
      id: 'jc',
      pre_max_loss_usdt: 100,
      post_realized_pnl: -250, // 2.5R loss → exceeds 2R threshold
    });
    tables.trade_journals = [j];
    const results = await evaluateCriticalPatterns(userId);
    expect(results).toHaveLength(1);
    expect(results[0].trigger).toBe('catastrophic');
    expect(results[0].pattern).toBeNull();
    expect(results[0].loss_r_multiple).toBeCloseTo(2.5, 5);
    expect(CATASTROPHIC_LOSS_R_MULTIPLE).toBe(2);
  });

  it('does not fire when loss is within planned budget', async () => {
    const j = journal({
      id: 'jc',
      pre_max_loss_usdt: 100,
      post_realized_pnl: -90, // 0.9R — within budget
    });
    tables.trade_journals = [j];
    const results = await evaluateCriticalPatterns(userId);
    expect(results).toHaveLength(0);
  });

  it('does not fire when journal is unreviewed (no post_reviewed_at)', async () => {
    const j = journal({
      id: 'jc',
      pre_max_loss_usdt: 100,
      post_realized_pnl: -300,
      post_reviewed_at: null,
    });
    tables.trade_journals = [j];
    const results = await evaluateCriticalPatterns(userId);
    expect(results).toHaveLength(0);
  });

  it('does not fire when an active rule already covers a tagged pattern on this journal', async () => {
    const p = pattern('p1', 'stop-loss-failed');
    const j = journal({
      id: 'jc',
      pre_max_loss_usdt: 100,
      post_realized_pnl: -300,
    });
    tables.error_tag_patterns = [p];
    tables.trade_journals = [j];
    tables.journal_tag_assignments = [assignment('jc', 'p1')];
    tables.trading_rules = [{
      id: 'r1',
      user_id: userId,
      source_pattern_id: 'p1',
      rule_text: 'always honor stop',
      is_active: true,
      added_to_checklist: true,
      trigger_threshold: null,
      required: true,
      ui_order: 0,
      snooze_until: null,
      activated_at: daysAgo(2),
      created_at: daysAgo(2),
      updated_at: daysAgo(2),
    }];
    const results = await evaluateCriticalPatterns(userId);
    expect(results).toHaveLength(0);
  });
});
