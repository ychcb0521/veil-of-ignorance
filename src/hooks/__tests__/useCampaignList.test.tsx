import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeCampaign } from '@/types/journal';
import type { CampaignWithLegs, UserLocalSnapshot } from '@/lib/journalApi';
import { clearCampaignListCaches } from '@/lib/campaignListCache';
import { assembleCampaignsWithLegs, fetchCampaignSourceRows } from '@/lib/journalApi';
import { useCampaignList } from '../useCampaignList';

const data = vi.hoisted(() => ({
  sources: [] as CampaignWithLegs[],
  local: {} as UserLocalSnapshot,
  /** 与真实读取器同一约定：页面给的内存数据优先，其余键才读本地存储（这里就是 data.local）。 */
  read: vi.fn((overrides: Partial<UserLocalSnapshot> = {}) => ({ ...data.local, ...overrides })),
}));
vi.mock('@/lib/journalApi', () => ({
  fetchCampaignSourceRows: vi.fn(async () => data.sources),
  assembleCampaignsWithLegs: vi.fn((_userId: string, rows: CampaignWithLegs[]) => rows),
  createUserLocalSnapshotReader: () => ({ read: data.read }),
  getCampaignFullData: vi.fn(async (_id: string, { source, local }: { source: CampaignWithLegs; local: UserLocalSnapshot }) => ({
    ...source, tradeRecords: local.tradeHistory, pendingOrders: [], reverseHedgeOrders: [],
  })),
}));
vi.mock('@/lib/campaignLegExecution', () => ({ fetchLegExitPriceCorrections: vi.fn(async () => ({})) }));
vi.mock('@/lib/campaignRealizedPnl', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/campaignRealizedPnl')>(),
  computeCampaignRealizedPnl: () => ({ total: 10, settled: true, byLeg: [] }),
}));

function source(id: string, symbol = 'BTCUSDT'): CampaignWithLegs {
  return {
    campaign: {
      id, user_id: 'user-1', symbol, title: id, status: 'closed_profit', actual_evolution: [],
      opened_at: '2026-01-01T00:00:00Z', closed_at: '2026-01-02T00:00:00Z',
      initial_main_size_usdt: 100, initial_leverage: 1, strategy_template: 'custom', direction: 'main_long',
    } as TradeCampaign,
    legs: [],
  };
}

const baseInputs = { tradeHistory: [], ordersMap: {}, filledOrders: [], positionsMap: {} };

beforeEach(() => {
  vi.clearAllMocks();
  clearCampaignListCaches();
  data.sources = [source('one'), source('two', 'ETHUSDT')];
  data.local = { tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [], positionsMap: {} };
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useCampaignList triggers', () => {
  it('mount reads the remote once; focus / visibility within a minute do not read again, a later focus does', async () => {
    const { result } = renderHook(() => useCampaignList('user-1', baseInputs));
    await waitFor(() => expect(result.current.complete).toBe(true));
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(1);

    act(() => { window.dispatchEvent(new Event('focus')); });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    act(() => { window.dispatchEvent(new Event('online')); });
    await act(async () => { await Promise.resolve(); });
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 61_000);
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(2));
    act(() => { window.dispatchEvent(new Event('focus')); });
    await act(async () => { await Promise.resolve(); });
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(2);
  });

  it('a changed trade-data reference reconciles locally from the in-memory data (no storage parse, no network); price ticks do nothing', async () => {
    const { result, rerender } = renderHook(({ inputs }) => useCampaignList('user-1', inputs), { initialProps: { inputs: baseInputs } });
    await waitFor(() => expect(result.current.complete).toBe(true));
    expect(assembleCampaignsWithLegs).toHaveBeenCalledTimes(1);
    // 挂载那次核对就带着页面手里的内存数据
    expect(data.read).toHaveBeenLastCalledWith(baseInputs);

    // 同一批引用（行情 tick 只换 priceMap）：什么都不触发
    rerender({ inputs: { ...baseInputs } });
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(assembleCampaignsWithLegs).toHaveBeenCalledTimes(1);
    expect(data.read).toHaveBeenCalledTimes(1);

    // 内存里的成交记录换了引用：核对用的就是这份引用（不解析本地存储），装配跟着重做，远端不读
    const tradeHistory = [{ id: 'r1', symbol: 'BTCUSDT', action: 'CLOSE' } as never];
    rerender({ inputs: { ...baseInputs, tradeHistory } });
    await waitFor(() => expect(assembleCampaignsWithLegs).toHaveBeenCalledTimes(2));
    expect(vi.mocked(assembleCampaignsWithLegs).mock.calls[1][2]).toEqual({ tradeHistory });
    expect(data.read).toHaveBeenLastCalledWith({ ...baseInputs, tradeHistory });
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(1);

    // 只换委托引用、成交没换：不重新装配（装配只依赖远端行与成交），也不读远端
    rerender({ inputs: { ...baseInputs, tradeHistory, ordersMap: { BTCUSDT: [] } } });
    await waitFor(() => expect(data.read).toHaveBeenCalledTimes(3));
    expect(assembleCampaignsWithLegs).toHaveBeenCalledTimes(2);
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(1);
  });

  it('storage events from another tab: trade keys reconcile locally (still from this tab\'s memory), campaign keys read the remote', async () => {
    const { result } = renderHook(() => useCampaignList('user-1', baseInputs));
    await waitFor(() => expect(result.current.complete).toBe(true));
    expect(data.read).toHaveBeenCalledTimes(1);

    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'sim_user-1_trade_history' })); });
    await waitFor(() => expect(data.read).toHaveBeenCalledTimes(2));
    // 本标签页的内存数据仍是权威（交易状态不跟别的标签页走），只有撤单快照从本地存储补
    expect(data.read).toHaveBeenLastCalledWith(baseInputs);
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(1);

    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'sim_user-1_trade_campaign_preferences' })); });
    await waitFor(() => expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(2));
  });

  it('a failed read is retried on the next online event within the minute; the gate re-arms after success', async () => {
    vi.mocked(fetchCampaignSourceRows).mockRejectedValueOnce(new Error('Failed to fetch'));
    const { result } = renderHook(() => useCampaignList('user-1', baseInputs));
    await waitFor(() => expect(result.current.error).toBe('Failed to fetch'));
    expect(result.current.complete).toBe(false);
    vi.setSystemTime(Date.now() + 5_000);
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(result.current.complete).toBe(true));
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    act(() => { window.dispatchEvent(new Event('focus')); });
    await act(async () => { await Promise.resolve(); });
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(2);
  });

  it('a mutation end reconciles with the remote once, and unmounting keeps the finished snapshot for the next mount', async () => {
    const first = renderHook(() => useCampaignList('user-1', baseInputs));
    await waitFor(() => expect(first.result.current.complete).toBe(true));
    const finish = first.result.current.beginMutation();
    finish();
    await waitFor(() => expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(2));
    const rows = first.result.current.rows;
    first.unmount();

    const second = renderHook(() => useCampaignList('user-1', baseInputs));
    expect(second.result.current.complete).toBe(true);
    expect(second.result.current.rows).toBe(rows);
  });
});
