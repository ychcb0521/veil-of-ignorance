// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignCounterfactualParams, CampaignCounterfactualResult } from '@/types/journal';

const mocks = vi.hoisted(() => {
  const missingCounterfactualsTable = {
    code: 'PGRST205',
    message: "Could not find the table 'public.campaign_counterfactuals' in the schema cache",
  };

  return {
    getUser: vi.fn(),
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: { initial_capital: 10_000 }, error: null })),
            })),
          })),
        };
      }

      if (table === 'campaign_counterfactuals') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: missingCounterfactualsTable })),
            })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(async () => ({ data: null, error: missingCounterfactualsTable })),
            })),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: missingCounterfactualsTable })),
          })),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: mocks.getUser,
    },
    from: mocks.from,
  },
}));

import {
  createCounterfactual,
  deleteCounterfactual,
  listCounterfactuals,
} from '@/lib/journalApi';

const params: CampaignCounterfactualParams = {
  entry: {
    time: '2026-06-20T01:00:00.000Z',
    price: 1,
    size_usdt: 1000,
    direction: 'long',
    leverage: 5,
  },
  hedge_a: { offset_pct: 0.05, size_pct: 0.5 },
  hedge_b: { offset_pct: 0.1, size_pct: 0.5 },
  mirror_tp: { offset_pct: 0.1, size_pct: 0.5 },
  rolling: {
    enabled: false,
    trigger_rise_pct: 0,
    min_interval_minutes: 0,
    new_hedge_offset_pct: 0,
    rolling_hedge_size_pct: 0,
  },
  exit_rule: 'manual_only',
};

const result: CampaignCounterfactualResult = {
  final_realized_pnl: 0,
  final_r_multiple: 0,
  peak_unrealized_pnl: 0,
  peak_drawdown: 0,
  profit_capture_ratio: 0,
  events: [],
  legs_summary: [],
  state_segments: [],
  sop_score: 100,
};

describe('journalApi campaign counterfactual local fallback', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  });

  it('在远端反事实表缺失时仍可创建、加载、删除分支', async () => {
    const branch = await createCounterfactual({
      campaign_id: 'campaign-1',
      label: '手动反事实测试',
      branch_kind: 'custom_what_if',
      params,
      result,
    });

    expect(branch.id).toEqual(expect.any(String));
    expect(branch.user_id).toBe('user-1');
    expect(branch.campaign_id).toBe('campaign-1');

    const rows = await listCounterfactuals('campaign-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(branch.id);
    expect(rows[0].label).toBe('手动反事实测试');

    await deleteCounterfactual(branch.id);

    expect(await listCounterfactuals('campaign-1')).toEqual([]);
  });
});
