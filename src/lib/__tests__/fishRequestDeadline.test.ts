import { afterEach, expect, it, vi } from 'vitest';
import { fishTransport } from '@/lib/fish/adapters';
import { FishRequestPool, FishWeightBudget, FISH_REQUEST_TIMEOUT_MS } from '@/lib/fish/shared';
afterEach(() => vi.useRealTimers());
it('times out hung fetches and releases all network slots, even if fetch ignores cancellation', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(() => new Promise<Response>(() => {}));
  const request = fishTransport('binance', fetcher as typeof fetch, new FishWeightBudget(), new FishRequestPool());
  const promises = Array.from({ length: 4 }, () => request('time', 1, new AbortController().signal).catch(e => e));
  await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(FISH_REQUEST_TIMEOUT_MS);
  expect(fetcher).toHaveBeenCalledTimes(4); // A timeout must free its slot for the waiting request.
  expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].signal!.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(FISH_REQUEST_TIMEOUT_MS);
  for (const error of await Promise.all(promises)) expect(error).toMatchObject({ message: expect.stringContaining('超过 30 秒') });
});
it('bounds response-body reads and cancels promptly without waiting for the timeout', async () => {
  vi.useFakeTimers();
  const request = fishTransport('binance', vi.fn(async () => ({ status: 200, ok: true, json: () => new Promise(() => {}) })) as unknown as typeof fetch, new FishWeightBudget());
  const parent = new AbortController(), cancelled = request('time', 1, parent.signal).catch(e => e);
  await vi.advanceTimersByTimeAsync(1); parent.abort();
  expect(await cancelled).toMatchObject({ name: 'AbortError' });
  const stalled = request('time', 1, new AbortController().signal).catch(e => e);
  await vi.advanceTimersByTimeAsync(FISH_REQUEST_TIMEOUT_MS);
  expect(await stalled).toMatchObject({ message: expect.stringContaining('超过 30 秒') }); expect(vi.getTimerCount()).toBe(0);
});
