import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JournalPlaybackPage from '../JournalPlaybackPage';
import type { TradeJournal } from '@/types/journal';

const { journalState, mockGetJournalById } = vi.hoisted(() => ({
  journalState: { current: null as TradeJournal | null },
  mockGetJournalById: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({ tradeHistory: [] }),
}));

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

vi.mock('@/lib/journalApi', () => ({
  getJournalById: mockGetJournalById,
  listAssignmentsForJournal: vi.fn(async () => []),
  listPatterns: vi.fn(async () => []),
  listAllJournalDataForUser: vi.fn(async () => ({ journals: [] })),
}));

vi.mock('@/contexts/ReplayContext', () => ({
  ReplayProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/journal/ReplayChartView', () => ({ ReplayChartView: () => <div>K line</div> }));
vi.mock('@/components/journal/ContextChannelsStack', () => ({ ContextChannelsStack: () => <div>Channels</div> }));
vi.mock('@/components/journal/BackButton', () => ({ BackButton: () => <button type="button">Back</button> }));

vi.mock('@/components/journal/PostTradeReviewSheet', () => ({
  PostTradeReviewSheet: ({
    isOpen,
    onOpenChange,
    journal,
    onReviewed,
    requireSaveBeforeClose,
  }: {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    journal: TradeJournal | null;
    onReviewed?: (updated: TradeJournal) => void;
    requireSaveBeforeClose?: boolean;
  }) => isOpen && journal ? (
    <div
      data-testid="review-editor"
      data-required={String(Boolean(requireSaveBeforeClose))}
      data-reflection={journal.post_reflection ?? ''}
    >
      <button type="button" onClick={() => onOpenChange(false)}>close review</button>
      <button
        type="button"
        onClick={() => {
          onReviewed?.({
            ...journal,
            post_reviewed_at: '2026-07-15T04:00:00.000Z',
            post_reflection: 'saved review',
          });
          onOpenChange(false);
        }}
      >
        save review
      </button>
    </div>
  ) : null,
}));

function journal(overrides: Partial<TradeJournal> = {}): TradeJournal {
  return {
    id: 'journal-1',
    user_id: 'user-1',
    symbol: 'BTCUSDT',
    direction: 'long',
    leverage: 5,
    pre_simulated_time: '2026-07-15T01:00:00.000Z',
    pre_real_time: '2026-07-15T01:00:00.000Z',
    post_reviewed_at: null,
    ...overrides,
  } as TradeJournal;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}{location.search}</div>;
}

function renderRoute(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/journal/journal-1${search}`]}>
      <Routes>
        <Route
          path="/journal/:id"
          element={<><JournalPlaybackPage /><LocationProbe /></>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('JournalPlaybackPage review deep links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetJournalById.mockImplementation(async () => journalState.current);
  });

  it('opens the completed review with its saved content and allows a normal close', async () => {
    journalState.current = journal({
      post_reviewed_at: '2026-07-15T03:00:00.000Z',
      post_reflection: 'original complete review',
    });
    renderRoute('?review=edit&from=execution-assets');

    const editor = await screen.findByTestId('review-editor');
    expect(editor).toHaveAttribute('data-required', 'false');
    expect(editor).toHaveAttribute('data-reflection', 'original complete review');

    fireEvent.click(screen.getByRole('button', { name: 'close review' }));
    await waitFor(() => expect(screen.queryByTestId('review-editor')).not.toBeInTheDocument());
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/journal/journal-1');
  });

  it('keeps a missing review open until it is saved', async () => {
    journalState.current = journal();
    renderRoute('?review=required&from=execution-assets');

    const editor = await screen.findByTestId('review-editor');
    expect(editor).toHaveAttribute('data-required', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'close review' }));
    expect(screen.getByTestId('review-editor')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent(
      '/journal/journal-1?review=required&from=execution-assets',
    );

    fireEvent.click(screen.getByRole('button', { name: 'save review' }));
    await waitFor(() => expect(screen.queryByTestId('review-editor')).not.toBeInTheDocument());
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/journal/journal-1');
  });
});
