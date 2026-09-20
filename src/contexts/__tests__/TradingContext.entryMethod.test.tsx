import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, profile: null }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(() => ({ upsert: vi.fn(async () => ({ error: null })) })) },
}));

import { TradingProvider, useTradingContext, type PlaceOrderParams } from '@/contexts/TradingContext';
import type { TradeRecord } from '@/types/trading';

const wrapper = ({ children }: { children: React.ReactNode }) => <TradingProvider>{children}</TradingProvider>;
const T0 = Date.parse('2026-09-20T00:00:00Z');
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(T0);
});
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

describe('手动开仓方式 JSON 持久化', () => {
  it.each(['MARKET', 'BEST'] as const)('%s 直接成交保留手动来源到逐笔平仓记录', async (priceSelection) => {
    const { result, unmount } = renderHook(() => useTradingContext(), { wrapper });
    await act(async () => {});
    act(() => { result.current.setPriceMap({ ETHUSDT: 100 }); result.current.sim.startSimulation(T0); });
    const order: PlaceOrderParams = {
      side: 'SHORT', type: 'MARKET', price: 0, stopPrice: 0, quantity: 10, leverage: 10,
      marginMode: 'isolated', priceSelection, triggerType: 'LAST', currencyUnit: 'BASE',
      usdtInputMode: 'ORDER_VALUE', inputAmount: 10, settlementMode: 'usdt', latestPrice: 100,
    };
    act(() => { result.current.handlePlaceOrder('ETHUSDT', order); });
    expect(result.current.positionsMap.ETHUSDT[0].entry_method).toBe('manual');
    expect(result.current.positionsMap.ETHUSDT[0].fills?.[0].entry_method).toBe('manual');
    act(() => { result.current.handleClosePosition('ETHUSDT', 0, 1); });
    const saved = JSON.parse(localStorage.getItem('sim_anon_trade_history') ?? '[]') as TradeRecord[];
    expect(saved.filter(record => record.action === 'CLOSE').map(record => [record.entry_method, record.exit_method])).toEqual([
      ['manual', 'manual'],
    ]);
    unmount();
    const remount = renderHook(() => useTradingContext(), { wrapper });
    await act(async () => {});
    expect(remount.result.current.tradeHistory.find(record => record.action === 'CLOSE')?.entry_method).toBe('manual');
  });
});
