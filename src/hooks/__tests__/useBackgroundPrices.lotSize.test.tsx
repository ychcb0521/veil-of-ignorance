import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, profile: null }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(() => ({ upsert: vi.fn(async () => ({ error: null })) })) },
}));
vi.mock('@/lib/canonicalTimePrice', () => ({
  fetchCanonicalTimePriceAt: vi.fn(),
}));

import { TradingProvider, useTradingContext } from '@/contexts/TradingContext';
import { useBackgroundPrices } from '@/hooks/useBackgroundPrices';
import { fetchCanonicalTimePriceAt } from '@/lib/canonicalTimePrice';
import { toast } from '@/lib/notificationCenter';

/**
 * 后台标的（不在图表上的那个）同样按单笔市价上限在触发时再判：走真实的 TradingProvider 与 useBackgroundPrices，
 * 触发之后超过上限的单撤掉留痕、消息中心说清，止损不会悄悄没了。
 * 场景：快照刷新后上限变小 / 合成币本位的张数上限随价变小——挂着的单到触发时放不下。
 */

const T0 = Date.parse('2026-09-23T00:00:00Z');
const SIM0 = Date.parse('2025-03-01T08:00:00Z');
const SYMBOL = 'KAITOUSDT';
const KEY = (k: string) => `sim_anon_${k}`;

const wrapper = ({ children }: { children: React.ReactNode }) => <TradingProvider>{children}</TradingProvider>;

const coinPosition = {
  id: 'long', side: 'LONG', entryPrice: 1.1, quantity: 40_000, contracts: 40_000, contractSizeUsd: 10, leverage: 2,
  openLeverage: 2, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'KAITO', margin: 200_000,
  isolatedMargin: 200_000, marginCoin: 181_818.18, openTime: SIM0 - 60_000, riskModel: 'binance-tiers-v1', riskSymbol: SYMBOL,
};
const coinOrder = {
  price: 0, contractSizeUsd: 10, leverage: 2, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'KAITO',
  status: 'PENDING', createdAt: SIM0 - 30_000, triggerDirection: 'DOWN', operator: '<=', lotSizeRule: 'binance-lot-size-v1',
};

function mountWith(positions: unknown[], orders: unknown[]) {
  localStorage.setItem(KEY('positions_map'), JSON.stringify(positions.length ? { [SYMBOL]: positions } : {}));
  localStorage.setItem(KEY('orders_map'), JSON.stringify({ [SYMBOL]: orders }));
  const view = renderHook(() => { useBackgroundPrices(); return useTradingContext(); }, { wrapper });
  act(() => {
    view.result.current.forkReplayTimeline(SYMBOL, 'start', SIM0);
    view.result.current.sim.startSimulation(SIM0);
  });
  return view;
}

async function poll() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(T0);
  // 这一根 K 线穿过 1.0：两张单都在 1.0 上触发，合成币本位在 1.0 上一笔最多 20,000 张
  vi.mocked(fetchCanonicalTimePriceAt).mockResolvedValue({ high: 1.02, low: 0.99, close: 1.0 } as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('后台标的：触发时超过单笔市价上限', () => {
  it('开仓条件单（23,000 张 @1.0）：撤单留痕、不建仓，消息中心说「触发时超过单笔市价上限」', async () => {
    const view = mountWith([], [{ ...coinOrder, id: 'bg-cond', side: 'LONG', type: 'CONDITIONAL', stopPrice: 1.0, quantity: 23_000, contracts: 23_000, riskModel: 'binance-tiers-v1' }]);
    const error = vi.spyOn(toast, 'error');
    await poll();
    expect(error.mock.calls.map(c => String(c[0]))).toContain('触发时超过单笔市价上限，委托已撤销');
    expect(view.result.current.ordersMap[SYMBOL] ?? []).toHaveLength(0);
    expect((view.result.current.positionsMap[SYMBOL] ?? []).filter(p => (p.contracts ?? 0) > 0)).toHaveLength(0);
    const cancelled = JSON.parse(localStorage.getItem(KEY('cancelled_orders')) ?? '[]') as { id: string }[];
    expect(cancelled.map(c => c.id)).toContain('bg-cond');
    act(() => view.result.current.sim.stopSimulation());
    view.unmount();
  });

  it('按成数（50%）的止损（20,001 张 @1.0）：撤单留痕，说清仓位此刻没有这张止损的保护；仓位原样', async () => {
    const view = mountWith([coinPosition], [{
      ...coinOrder, id: 'bg-sl', side: 'SHORT', type: 'CONDITIONAL', stopPrice: 1.0, quantity: 20_001, contracts: 20_001,
      conditionalExecType: 'MARKET', reduceOnly: true, reduceSymbol: SYMBOL, reducePositionSide: 'LONG',
      linkedPositionId: 'long', reduceKind: 'SL', reducePercentage: 50,
    }]);
    const error = vi.spyOn(toast, 'error');
    await poll();
    const call = error.mock.calls.find(c => String(c[0]) === '止损触发时超过单笔市价上限，委托已撤销');
    expect(call).toBeDefined();
    expect(String((call?.[1] as { description?: string })?.description)).toContain('这个仓位此刻没有这张止损的保护');
    expect(view.result.current.ordersMap[SYMBOL] ?? []).toHaveLength(0);
    expect((view.result.current.positionsMap[SYMBOL] ?? []).map(p => p.contracts)).toEqual([40_000]);
    act(() => view.result.current.sim.stopSimulation());
    view.unmount();
  });

  it('100% 的止损（40,000 张，平掉整个仓位）：不受单笔上限约束，照常触发平光', async () => {
    const view = mountWith([coinPosition], [{
      ...coinOrder, id: 'bg-sl-all', side: 'SHORT', type: 'CONDITIONAL', stopPrice: 1.0, quantity: 40_000, contracts: 40_000,
      conditionalExecType: 'MARKET', reduceOnly: true, reduceSymbol: SYMBOL, reducePositionSide: 'LONG',
      linkedPositionId: 'long', reduceKind: 'SL', reducePercentage: 100,
    }]);
    const error = vi.spyOn(toast, 'error');
    await poll();
    expect(error.mock.calls.map(c => String(c[0]))).not.toContain('止损触发时超过单笔市价上限，委托已撤销');
    expect((view.result.current.positionsMap[SYMBOL] ?? []).filter(p => (p.contracts ?? 0) > 0)).toHaveLength(0);
    act(() => view.result.current.sim.stopSimulation());
    view.unmount();
  });
});
