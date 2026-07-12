import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { TradeJournal } from '@/types/journal';
import { JournalSummaryView } from '../JournalSummaryView';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-path">{location.pathname}</div>;
}

describe('JournalSummaryView campaign navigation', () => {
  it('opens the stable campaign route when a history answer is clicked', async () => {
    const journal = {
      id: 'journal-1',
      campaign_id: 'campaign-1',
      symbol: 'BTCUSDT',
      direction: 'long',
      order_kind: 'main',
      journal_kind: 'trade',
      pre_simulated_time: '2026-07-12T01:00:00.000Z',
      created_at: '2026-07-12T01:00:00.000Z',
      pre_thesis_why_right: '因为结构突破',
      post_outcome: 'win',
    } as TradeJournal;

    render(
      <MemoryRouter initialEntries={['/journal']}>
        <JournalSummaryView journals={[journal]} />
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /这笔为什么会对/ }));
    const answerButton = screen.getByText('因为结构突破').closest('button');
    expect(answerButton).not.toBeNull();
    expect(answerButton).toHaveAttribute('title', '点击跳到对应交易战役');
    fireEvent.click(answerButton!);

    await waitFor(() => {
      expect(screen.getByTestId('location-path')).toHaveTextContent('/journal/campaigns/campaign-1');
    });
  });
});
