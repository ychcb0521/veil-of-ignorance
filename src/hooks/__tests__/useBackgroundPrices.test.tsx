import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackgroundPrices } from '@/hooks/useBackgroundPrices';
import { fetchCanonicalTimePriceAt } from '@/lib/canonicalTimePrice';
import { useTradingContext } from '@/contexts/TradingContext';
import type { PendingOrder } from '@/types/trading';

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: vi.fn(),
}));

vi.mock('@/lib/canonicalTimePrice', () => ({
  fetchCanonicalTimePriceAt: vi.fn(),
}));

function Harness() {
  useBackgroundPrices();
  return null;
}

describe('useBackgroundPrices', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetchCanonicalTimePriceAt).mockResolvedValue({
      high: 1,
      low: 1,
      close: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('fetches each symbol at its own effective replay time', async () => {
    const setPriceMap = vi.fn((updater: (prev: Record<string, number>) => Record<string, number>) => updater({}));
    const getEffectiveTime = vi.fn((symbol?: string) => {
      if (symbol === 'ALPACAUSDT') return 1_745_653_020_000;
      if (symbol === 'EVAAUSDT') return 1_783_466_400_000;
      return 0;
    });

    vi.mocked(useTradingContext).mockReturnValue({
      sim: { isRunning: true, currentSimulatedTime: 9_999_999_999_999 },
      activeSymbol: 'EVAAUSDT',
      activeSymbols: ['ALPACAUSDT'],
      setPriceMap,
      ordersMap: {},
      positionsMap: {},
      setOrdersMap: vi.fn(),
      setPositionsMap: vi.fn(),
      setBalance: vi.fn(),
      setTradeHistory: vi.fn(),
      tradingMode: 'direct',
      getEffectiveTime,
      recordExecutionTrade: vi.fn(),
      executeReduceOnlyTrigger: vi.fn(),
    } as unknown as ReturnType<typeof useTradingContext>);

    render(<Harness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchCanonicalTimePriceAt).toHaveBeenCalledWith('ALPACAUSDT', 1_745_653_020_000);
    expect(fetchCanonicalTimePriceAt).toHaveBeenCalledWith('EVAAUSDT', 1_783_466_400_000);
    expect(fetchCanonicalTimePriceAt).not.toHaveBeenCalledWith(expect.any(String), 9_999_999_999_999);
  });

  it('matches reduce-only orders only for background symbols through the shared executor', async () => {
    const executeReduceOnlyTrigger = vi.fn(() => ({ ok: true }));
    const makeOrder = (id: string): PendingOrder => ({
      id,
      side: 'SHORT',
      type: 'CONDITIONAL',
      price: 0,
      stopPrice: 1,
      quantity: 1,
      leverage: 5,
      marginMode: 'cross',
      status: 'PENDING',
      createdAt: 100,
      operator: '>=',
      triggerDirection: 'UP',
      reduceOnly: true,
      reduceSymbol: id === 'active-tp' ? 'ACTIVEUSDT' : 'BACKGROUNDUSDT',
      reducePositionSide: 'LONG',
      linkedPositionId: `${id}-position`,
      reduceKind: 'TP',
    });
    const activeOrder = makeOrder('active-tp');
    const backgroundOrder = makeOrder('background-tp');

    vi.mocked(useTradingContext).mockReturnValue({
      sim: { isRunning: true },
      activeSymbol: 'ACTIVEUSDT',
      activeSymbols: ['ACTIVEUSDT', 'BACKGROUNDUSDT'],
      setPriceMap: vi.fn(),
      ordersMap: {
        ACTIVEUSDT: [activeOrder],
        BACKGROUNDUSDT: [backgroundOrder],
      },
      setOrdersMap: vi.fn(),
      setPositionsMap: vi.fn(),
      setBalance: vi.fn(),
      tradingMode: 'direct',
      getEffectiveTime: vi.fn(() => 1_000),
      recordExecutionTrade: vi.fn(),
      executeReduceOnlyTrigger,
    } as unknown as ReturnType<typeof useTradingContext>);

    render(<Harness />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(executeReduceOnlyTrigger).toHaveBeenCalledTimes(1);
    expect(executeReduceOnlyTrigger).toHaveBeenCalledWith(
      'BACKGROUNDUSDT',
      backgroundOrder,
      1,
      1_000,
    );
    expect(executeReduceOnlyTrigger).not.toHaveBeenCalledWith(
      'ACTIVEUSDT',
      activeOrder,
      expect.any(Number),
      expect.any(Number),
    );
  });
});
