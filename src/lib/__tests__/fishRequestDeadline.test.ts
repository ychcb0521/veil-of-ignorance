import { afterEach, expect, it, vi } from 'vitest';
import { fishTransport } from '@/lib/fish/adapters';
import { FishRequestPool, FishWeightBudget, FISH_REQUEST_TIMEOUT_MS, FISH_TIMEOUT_RETRIES } from '@/lib/fish/shared';
/** 超时后自动重试：总共 1 + FISH_TIMEOUT_RETRIES 次，每次之间等 1、2 秒。 */
const ALL_ATTEMPTS = (FISH_TIMEOUT_RETRIES + 1) * FISH_REQUEST_TIMEOUT_MS + 10_000;
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
  await vi.advanceTimersByTimeAsync(2 * ALL_ATTEMPTS);
  for (const error of await Promise.all(promises)) expect(error).toMatchObject({ message: expect.stringContaining('连续 3 次超过 30 秒') });
  expect(fetcher).toHaveBeenCalledTimes(4 * (FISH_TIMEOUT_RETRIES + 1));
});
it('bounds response-body reads and cancels promptly without waiting for the timeout', async () => {
  vi.useFakeTimers();
  const request = fishTransport('binance', vi.fn(async () => ({ status: 200, ok: true, json: () => new Promise(() => {}) })) as unknown as typeof fetch, new FishWeightBudget());
  const parent = new AbortController(), cancelled = request('time', 1, parent.signal).catch(e => e);
  await vi.advanceTimersByTimeAsync(1); parent.abort();
  expect(await cancelled).toMatchObject({ name: 'AbortError' });
  const stalled = request('time', 1, new AbortController().signal).catch(e => e);
  await vi.advanceTimersByTimeAsync(ALL_ATTEMPTS);
  expect(await stalled).toMatchObject({ message: expect.stringContaining('超过 30 秒') }); expect(vi.getTimerCount()).toBe(0);
});
// 【用户要求】2026-11-04「按照模版选的算法，运行不出来」：经代理偶尔一次请求卡住，换个新请求就能回来
it('retries a timed-out request with a fresh one and returns its data instead of failing the whole run', async () => {
  vi.useFakeTimers();
  let calls = 0;
  const fetcher = vi.fn(() => ++calls === 1 ? new Promise<Response>(() => {}) : Promise.resolve(new Response(JSON.stringify({ serverTime: 1 }), { status: 200 })));
  const request = fishTransport('binance', fetcher as typeof fetch, new FishWeightBudget());
  const result = request('time', 1, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(FISH_REQUEST_TIMEOUT_MS + 1_500);
  expect(await result).toEqual({ serverTime: 1 });
  expect(fetcher).toHaveBeenCalledTimes(2);
  // 其它失败（如 HTTP 错误）不重试
  const failing = fishTransport('binance', vi.fn(async () => new Response(JSON.stringify({ msg: 'bad' }), { status: 400 })) as typeof fetch, new FishWeightBudget());
  await expect(failing('time', 1, new AbortController().signal)).rejects.toMatchObject({ message: expect.stringContaining('HTTP 400') });
});
