import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackgroundPrices } from '@/hooks/useBackgroundPrices';
import { fetchCanonicalTimePriceAt } from '@/lib/canonicalTimePrice';
import { useTradingContext } from '@/contexts/TradingContext';

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
    } as unknown as ReturnType<typeof useTradingContext>);

    render(<Harness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchCanonicalTimePriceAt).toHaveBeenCalledWith('ALPACAUSDT', 1_745_653_020_000);
    expect(fetchCanonicalTimePriceAt).toHaveBeenCalledWith('EVAAUSDT', 1_783_466_400_000);
    expect(fetchCanonicalTimePriceAt).not.toHaveBeenCalledWith(expect.any(String), 9_999_999_999_999);
  });
});
