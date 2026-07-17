import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeCampaign } from '@/types/journal';

let remoteCampaigns: Array<Record<string, unknown>> = [];
let schemaHasDeletedAt = true;

const missingDeletedAtError = {
  code: 'PGRST204',
  message: "Could not find the 'deleted_at' column of 'trade_campaigns' in the schema cache",
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }),
    },
    from: (table: string) => {
      let operation: 'select' | 'update' | 'delete' = 'select';
      let payload: Record<string, unknown> = {};
      const filters: Record<string, unknown> = {};

      const matchingRows = () => remoteCampaigns.filter(row => (
        Object.entries(filters).every(([key, value]) => row[key] === value)
      ));

      const resolveResult = () => {
        if (table !== 'trade_campaigns') return { data: [], error: null };
        if (operation === 'update') {
          if ('deleted_at' in payload && !schemaHasDeletedAt) {
            return { data: null, error: missingDeletedAtError };
          }
          remoteCampaigns = remoteCampaigns.map(row => (
            Object.entries(filters).every(([key, value]) => row[key] === value)
              ? { ...row, ...payload }
              : row
          ));
          return { data: null, error: null };
        }
        if (operation === 'delete') {
          remoteCampaigns = remoteCampaigns.filter(row => (
            !Object.entries(filters).every(([key, value]) => row[key] === value)
          ));
          return { data: null, error: null };
        }
        return { data: matchingRows(), error: null };
      };

      const builder = {
        select() {
          operation = 'select' as const;
          return builder;
        },
        update(nextPayload: Record<string, unknown>) {
          operation = 'update' as const;
          payload = nextPayload;
          return builder;
        },
        delete() {
          operation = 'delete' as const;
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        order() {
          return builder;
        },
        maybeSingle() {
          const result = resolveResult();
          const rows = Array.isArray(result.data) ? result.data : [];
          return Promise.resolve({ data: rows[0] ?? null, error: result.error });
        },
        then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
          return Promise.resolve(resolveResult()).then(resolve);
        },
      };
      return builder;
    },
  },
}));

import {
  deleteCampaign,
  listAllCampaigns,
  listDeletedCampaigns,
  permanentlyDeleteCampaign,
  restoreCampaign,
} from '../journalApi';

function campaignRow(overrides: Partial<TradeCampaign> = {}): TradeCampaign {
  const now = '2026-07-17T00:00:00.000Z';
  return {
    id: 'campaign-1',
    user_id: 'user-1',
    campaign_code: 'C-TEST',
    symbol: 'BTCUSDT',
    direction: 'main_long',
    status: 'closed_profit',
    strategy_template: 'custom',
    title: 'BTCUSDT test campaign',
    opened_at: now,
    closed_at: now,
    initial_main_size_usdt: 100,
    initial_leverage: 1,
    final_realized_pnl: 10,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: [],
    deviation_notes: {},
    deleted_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('trade campaign soft delete', () => {
  beforeEach(() => {
    localStorage.clear();
    schemaHasDeletedAt = true;
    remoteCampaigns = [{ ...campaignRow() }];
  });

  it('moves, restores, and permanently deletes campaigns when the column is deployed', async () => {
    await deleteCampaign('campaign-1');
    expect(await listAllCampaigns('user-1')).toHaveLength(0);
    expect(await listDeletedCampaigns('user-1')).toMatchObject([{ id: 'campaign-1' }]);

    await restoreCampaign('campaign-1');
    expect(await listDeletedCampaigns('user-1')).toHaveLength(0);
    expect(await listAllCampaigns('user-1')).toMatchObject([{ id: 'campaign-1', deleted_at: null }]);

    await deleteCampaign('campaign-1');
    await permanentlyDeleteCampaign('campaign-1');
    expect(remoteCampaigns).toHaveLength(0);
    expect(await listDeletedCampaigns('user-1')).toHaveLength(0);
  });

  it('uses a local tombstone until the remote deleted_at migration is available', async () => {
    schemaHasDeletedAt = false;
    remoteCampaigns = [
      Object.fromEntries(Object.entries(campaignRow()).filter(([key]) => key !== 'deleted_at')),
    ];

    await deleteCampaign('campaign-1');
    expect(await listAllCampaigns('user-1')).toHaveLength(0);
    expect(await listDeletedCampaigns('user-1')).toMatchObject([
      { id: 'campaign-1', deleted_at: expect.any(String) },
    ]);

    await restoreCampaign('campaign-1');
    expect(await listDeletedCampaigns('user-1')).toHaveLength(0);
    expect(await listAllCampaigns('user-1')).toMatchObject([{ id: 'campaign-1', deleted_at: null }]);
  });
});
