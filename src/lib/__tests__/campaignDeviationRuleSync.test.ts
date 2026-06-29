import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradingRule } from '@/types/journal';

const mocks = vi.hoisted(() => {
  let nextId = 1;
  const tables = {
    trading_rules: [] as TradingRule[],
  };

  const from = vi.fn((table: string) => {
    if (table !== 'trading_rules') throw new Error(`Unexpected table ${table}`);

    return {
      select: vi.fn(() => ({
        eq: vi.fn((_column: string, userId: string) => ({
          order: vi.fn(async () => ({
            data: tables.trading_rules.filter(rule => rule.user_id === userId),
            error: null,
          })),
        })),
      })),
      insert: vi.fn((payload: Partial<TradingRule>) => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => {
            const now = '2026-06-29T07:07:38.000Z';
            const row = {
              id: `rule-${nextId++}`,
              user_id: payload.user_id ?? 'user-1',
              source_pattern_id: null,
              principle_id: null,
              rule_text: payload.rule_text ?? '',
              is_active: payload.is_active ?? false,
              added_to_checklist: payload.added_to_checklist ?? false,
              required: payload.required ?? false,
              rule_category: payload.rule_category ?? 'core',
              weight: payload.weight ?? 50,
              evolution_level: payload.evolution_level ?? 3,
              trigger_threshold: null,
              ui_order: 0,
              snooze_until: null,
              activated_at: payload.activated_at ?? null,
              created_at: now,
              updated_at: now,
            } satisfies TradingRule;
            tables.trading_rules.unshift(row);
            return { data: row, error: null };
          }),
        })),
      })),
    };
  });

  return {
    from,
    tables,
    reset: () => {
      nextId = 1;
      tables.trading_rules = [];
      from.mockClear();
    },
  };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: mocks.from,
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(),
    },
  },
}));

import { syncCampaignDeviationRulesToChecklist } from '@/lib/journalApi';

describe('syncCampaignDeviationRulesToChecklist', () => {
  beforeEach(() => {
    mocks.reset();
  });

  it('把偏离明细里的修正规则写入交易规则 checklist', async () => {
    const result = await syncCampaignDeviationRulesToChecklist(
      'user-1',
      {
        'leg-1': {
          category: '滚动对冲',
          reason: '触发后手动拆掉太早',
          fix: '触发后的委托空只延续到手动拆掉时间点',
        },
      },
      [{ legId: 'leg-1', leg_role: 'Hedge_rolling', cost_usdt: 963.64 }],
    );

    expect(result).toEqual({ drafts: 1, created: 1, skipped: 0 });
    expect(mocks.tables.trading_rules).toHaveLength(1);
    expect(mocks.tables.trading_rules[0]).toMatchObject({
      user_id: 'user-1',
      rule_text: '【战役偏离】违规操作：滚动对冲：触发后手动拆掉太早。修正后的规则：触发后的委托空只延续到手动拆掉时间点',
      is_active: true,
      added_to_checklist: true,
      required: false,
      rule_category: 'core',
      weight: 70,
      evolution_level: 3,
    });
    expect(mocks.tables.trading_rules[0].activated_at).toBeTruthy();
  });

  it('再次同步同一条规则时不重复创建', async () => {
    const notes = {
      'leg-1': {
        fix: '当前偏离必须先写成可检查规则',
      },
    };
    const costs = [{ legId: 'leg-1', leg_role: 'Hedge_rolling', cost_usdt: 100 }];

    await syncCampaignDeviationRulesToChecklist('user-1', notes, costs);
    const result = await syncCampaignDeviationRulesToChecklist('user-1', notes, costs);

    expect(result).toEqual({ drafts: 1, created: 0, skipped: 1 });
    expect(mocks.tables.trading_rules).toHaveLength(1);
  });
});
