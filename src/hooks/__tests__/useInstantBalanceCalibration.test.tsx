import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useInstantBalanceCalibration } from '../useInstantBalanceCalibration';
import { freezeCalibratedLivePositionBudget } from '@/lib/fish/instantBalanceCalibration';
import { DEFAULT_INSTANT_POSITION } from '@/lib/fish/instantPositionSettings';

vi.mock('@/lib/fish/fishPreferencesDb', () => ({ writeFishPreference: async () => {} }));
afterEach(cleanup);

it('initializes once, refreshes a real close, and serves future admissions without a new quote', async () => {
  const readDeskQuote = vi.fn().mockResolvedValue({ available: '1000' });
  const follow = { connected: true, orderDesk: 1 as const, startedAt: 1, statuses: [], readDeskQuote };
  const page = renderHook(({ following }) => useInstantBalanceCalibration('owner', following), { initialProps: { following: follow } });
  await waitFor(() => expect(page.result.current.ready).toBe(true));
  expect(freezeCalibratedLivePositionBudget('owner', DEFAULT_INSTANT_POSITION).availableUsdt).toBe(1000);
  expect(readDeskQuote).toHaveBeenCalledTimes(1);
  readDeskQuote.mockResolvedValue({ available: '1200' });
  page.rerender({ following: { ...follow, statuses: [{ id: 'closed', state: 'closed' }] } });
  await waitFor(() => expect(page.result.current.availableUsdt).toBe(1200));
  expect(freezeCalibratedLivePositionBudget('owner', DEFAULT_INSTANT_POSITION).availableUsdt).toBe(1200);
  expect(readDeskQuote).toHaveBeenCalledTimes(2);
  page.rerender({ following: { ...follow, statuses: [{ id: 'closed', state: 'closed' }] } });
  expect(readDeskQuote).toHaveBeenCalledTimes(2);
});

it('requires the replacement connection to finish its own calibration before exposing its balance', async () => {
  const readDeskQuote = vi.fn().mockResolvedValue({ available: '1000' });
  const follow = { connected: true, orderDesk: 1 as const, startedAt: 1, statuses: [], readDeskQuote };
  const page = renderHook(({ following }) => useInstantBalanceCalibration('owner', following), { initialProps: { following: follow } });
  await waitFor(() => expect(page.result.current.ready).toBe(true));
  page.rerender({ following: { ...follow, connected: false } });
  expect(page.result.current.ready).toBe(false);
  expect(freezeCalibratedLivePositionBudget('owner', DEFAULT_INSTANT_POSITION).balanceObservedAt).toBeUndefined();
  let finish!: (value: { available: string }) => void;
  readDeskQuote.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  page.rerender({ following: { ...follow, startedAt: 2 } });
  expect(page.result.current.ready).toBe(false);
  expect(() => freezeCalibratedLivePositionBudget('owner', DEFAULT_INSTANT_POSITION)).toThrow();
  await act(async () => finish({ available: '500' }));
  expect(page.result.current.ready).toBe(true);
  expect(freezeCalibratedLivePositionBudget('owner', DEFAULT_INSTANT_POSITION).availableUsdt).toBe(500);
});
