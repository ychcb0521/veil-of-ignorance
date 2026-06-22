// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const missingDeviationNotesColumn = {
    code: 'PGRST204',
    message: "Could not find the 'deviation_notes' column of 'trade_campaigns' in the schema cache",
  };

  const campaignRow = {
    id: 'campaign-1',
    user_id: 'user-1',
    symbol: 'ORDIUSDT',
    direction: 'main_long',
    status: 'closed_profit',
    strategy_template: 'main_dual_hedge_mirror_tp',
    title: 'ORDIUSDT 2026-04-15 多战役',
    opened_at: '2026-04-15T14:31:00.000Z',
    closed_at: '2026-04-16T00:34:00.000Z',
    initial_main_size_usdt: null,
    initial_leverage: null,
    final_realized_pnl: 293756.34,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: [],
    created_at: '2026-04-15T14:31:00.000Z',
    updated_at: '2026-04-16T00:34:00.000Z',
  };

  return {
    getUser: vi.fn(),
    from: vi.fn((table: string) => {
      if (table === 'trade_campaigns') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: missingDeviationNotesColumn })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: campaignRow, error: null })),
            })),
          })),
        };
      }

      if (table === 'trade_journals') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(async () => ({ data: [], error: null })),
            })),
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
  getCampaignWithLegs,
  saveCampaignDeviationNotes,
} from '@/lib/journalApi';

describe('campaign deviation notes local fallback', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  });

  it('远端 deviation_notes 缺列时仍能保存，并在读取战役时合并回显', async () => {
    const notes = {
      setup_1: {
        category: 'Setup',
        reason: '止盈对冲线的位置',
        fix: '对冲位置根据实时的行情调整',
      },
    };

    await expect(saveCampaignDeviationNotes('campaign-1', notes)).resolves.toBeUndefined();

    const stored = JSON.parse(localStorage.getItem('sim_user-1_campaign_deviation_notes') ?? '{}');
    expect(stored['campaign-1']).toEqual(notes);

    const { campaign } = await getCampaignWithLegs('campaign-1');
    expect(campaign.deviation_notes).toEqual(notes);
  });
});
