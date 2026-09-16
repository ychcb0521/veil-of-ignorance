// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KlineData } from '@/hooks/useBinanceData';
import type { CampaignCounterfactualParams } from '@/types/journal';

/**
 * 「一键运行」只运行、不落库；「保存」才插入。
 * 这里把 supabase 换成只记账的桩：反事实表按「缺表」回落到本地镜像，insert 被调用与否就是有没有落库。
 */
const mocks = vi.hoisted(() => {
  const missingCounterfactualsTable = {
    code: 'PGRST205',
    message: "Could not find the table 'public.campaign_counterfactuals' in the schema cache",
  };
  const insert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => ({ data: null, error: missingCounterfactualsTable })),
    })),
  }));
  return {
    insert,
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
          insert,
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(async () => ({ data: null, error: missingCounterfactualsTable })),
            })),
          })),
        };
      }
      // 手动 Legs 分支不该再拉战役（trade_campaigns / trade_journals）：拉了就是回归。
      throw new Error(`Unexpected table ${table}`);
    }),
  };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  },
}));

import {
  listCounterfactuals,
  runAndPersistCustomCounterfactual,
  runCustomCounterfactual,
} from '@/lib/journalApi';

const entryMs = Date.parse('2026-06-20T01:00:00.000Z');
const klines: KlineData[] = [0, 1, 2, 3].map(index => ({
  time: entryMs + index * 60_000,
  open: 100,
  high: 103,
  low: 98,
  close: 100 + index,
  volume: 1,
}));

const params: CampaignCounterfactualParams = {
  entry: { time: new Date(entryMs).toISOString(), price: 100, size_usdt: 1_000, direction: 'long', leverage: 5 },
  hedge_a: { offset_pct: 0.05, size_pct: 0.5 },
  hedge_b: { offset_pct: 0.1, size_pct: 0.5 },
  mirror_tp: { offset_pct: 0.1, size_pct: 0.5 },
  rolling: { enabled: false, trigger_rise_pct: 0, min_interval_minutes: 0, new_hedge_offset_pct: 0, rolling_hedge_size_pct: 0 },
  exit_rule: 'manual_only',
  manual_legs: [
    {
      id: 'main',
      leg_role: 'main_open',
      direction: 'long',
      open_time: new Date(entryMs).toISOString(),
      close_time: new Date(entryMs + 3 * 60_000).toISOString(),
      entry_price: 100,
      exit_price: 110,
      size_usdt: 1_000,
      leverage: 5,
      enabled: true,
    },
    {
      id: 'hedge-a',
      leg_role: 'hedge_initial_a',
      direction: 'short',
      open_time: new Date(entryMs + 60_000).toISOString(),
      close_time: new Date(entryMs + 3 * 60_000).toISOString(),
      entry_price: 90,
      exit_price: 90,
      size_usdt: 1_000,
      leverage: 5,
      enabled: true,
    },
  ],
};

describe('runCustomCounterfactual', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.insert.mockClear();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  });

  it('只运行不落库：结果带四个风险锚，params 带 run_context，insert 没被调用', async () => {
    const run = await runCustomCounterfactual('campaign-1', params, klines, '1m');

    expect(run.result.final_realized_pnl).toBeCloseTo(100, 4);
    expect(run.result.initial_expected_max_loss).toBeGreaterThan(0);
    expect(run.result.initial_main_exposure_notional).toBe(1_000);
    expect(run.result.main_leverage).toBe(5);
    expect(run.params.run_context).toEqual({
      interval: '1m',
      from: new Date(entryMs).toISOString(),
      to: new Date(entryMs + 3 * 60_000).toISOString(),
      kline_count: 4,
      ran_at: expect.any(String),
    });
    // 入参原样保留（manual_legs 没被改写），只是多了 run_context
    expect(run.params.manual_legs).toEqual(params.manual_legs);
    expect(params.run_context).toBeUndefined();

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(await listCounterfactuals('campaign-1')).toEqual([]);
  });

  it('没传周期时从 K 线步长反推；没有 K 线就不写 run_context', async () => {
    const inferred = await runCustomCounterfactual('campaign-1', params, klines);
    expect(inferred.params.run_context?.interval).toBe('1m');

    const hourly = klines.map((kline, index) => ({ ...kline, time: entryMs + index * 3_600_000 }));
    expect((await runCustomCounterfactual('campaign-1', params, hourly)).params.run_context?.interval).toBe('1h');

    const empty = await runCustomCounterfactual('campaign-1', params, []);
    expect(empty.params.run_context).toBeUndefined();
    expect(empty.result.final_realized_pnl).toBeCloseTo(100, 4);
  });

  it('runAndPersistCustomCounterfactual 仍是「运行 + 落库」：insert 一次，存的 params 带 run_context', async () => {
    const branch = await runAndPersistCustomCounterfactual('campaign-1', '旧入口', params, klines, '5m');

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(branch.label).toBe('旧入口');
    expect(branch.branch_kind).toBe('custom_what_if');
    expect(branch.params.run_context?.interval).toBe('5m');
    expect(branch.result.initial_expected_max_loss).toBeGreaterThan(0);

    const rows = await listCounterfactuals('campaign-1');
    expect(rows.map(row => row.id)).toEqual([branch.id]);
  });
});
