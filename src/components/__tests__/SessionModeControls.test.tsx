import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SessionModeControls } from '../SessionModeControls';
import type { CoinTimelinesMap } from '@/contexts/TradingContext';

vi.mock('@/contexts/TradingContext', async () => {
  const actual = await vi.importActual<typeof import('@/contexts/TradingContext')>('@/contexts/TradingContext');
  return {
    ...actual,
    useTradingContext: () => ({
      tradingMode: 'direct',
      setTradingMode: vi.fn(),
    }),
  };
});

function runningCoinTimelines(count: number): CoinTimelinesMap {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `COIN${index + 1}USDT`,
      {
        status: index % 2 === 0 ? 'playing' : 'paused',
        time: 1,
        speed: 1,
        historicalAnchorTime: null,
        realStartTime: null,
        originTime: null,
      },
    ]),
  );
}

describe('SessionModeControls', () => {
  it('keeps the isolated-to-synced guard dialog scrollable for long running coin lists', () => {
    render(
      <SessionModeControls
        timeMode="isolated"
        onSetTimeMode={vi.fn()}
        onStopAllAndSwitchToSynced={vi.fn()}
        coinTimelines={runningCoinTimelines(30)}
      />,
    );

    fireEvent.click(screen.getByTitle(/时间模式：当前隔离/));
    fireEvent.click(screen.getByRole('button', { name: '同步' }));

    const dialogTitle = screen.getByText('无法切换模式');
    const dialogContent = dialogTitle.closest('[role="dialog"]');
    expect(dialogContent).toHaveClass('max-h-[calc(100vh-32px)]', 'overflow-hidden');

    const coinListRegion = screen.getByText('运行中的币种').closest('.overflow-y-auto');
    expect(coinListRegion).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
    expect(screen.getByText('COIN30USDT')).toBeInTheDocument();
  });
});
