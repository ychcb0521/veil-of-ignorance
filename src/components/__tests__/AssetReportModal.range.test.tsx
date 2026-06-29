import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AssetReportModal } from '../AssetReportModal';
import type { AssetState } from '@/types/assets';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('recharts', () => ({
  Area: () => null,
  AreaChart: () => <div data-testid="mock-area-chart" />,
  CartesianGrid: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

function makeAssets(): AssetState {
  return {
    totalBalance: 1_400,
    todayPnl: 0,
    todayPnlPct: 0,
    accounts: [],
    history: [
      { timestamp: Date.parse('2026-04-10T00:00:00.000Z'), totalBalance: 1_100 },
      { timestamp: Date.parse('2026-06-23T10:00:00.000Z'), totalBalance: 1_300 },
      { timestamp: Date.parse('2026-06-29T10:00:00.000Z'), totalBalance: 1_400 },
    ],
    dailyPnl: [],
    dailyPnlDetails: [],
  };
}

function chartText(): string {
  return within(screen.getByTestId('asset-report-chart'))
    .getByText('资产变化曲线')
    .closest('[data-testid="asset-report-chart"]')!
    .textContent ?? '';
}

describe('AssetReportModal range chart', () => {
  it('refreshes the asset curve date window when switching report ranges', () => {
    render(
      <MemoryRouter>
        <AssetReportModal open onClose={() => undefined} assets={makeAssets()} />
      </MemoryRouter>,
    );

    expect(chartText()).toContain('2026-05-30:');
    expect(chartText()).toContain('2026-06-29:');

    fireEvent.click(screen.getByRole('button', { name: '7天' }));
    expect(chartText()).toContain('2026-06-22:');
    expect(chartText()).toContain('2026-06-29:');

    fireEvent.click(screen.getByRole('button', { name: '90天' }));
    expect(chartText()).toContain('2026-04-10:');
    expect(chartText()).toContain('2026-06-29:');

    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(chartText()).toContain('2026-04-10:');
    expect(chartText()).toContain('2026-06-29:');
  });
});
