import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runAccountSyncRequest, __resetAccountSyncTransportForTests } from '../accountSyncTransport';

beforeEach(() => { vi.useFakeTimers(); __resetAccountSyncTransportForTests(); });
afterEach(() => { vi.useRealTimers(); });

it('a burst of independent account writes uses one database connection at a time', async () => {
  let active = 0, peak = 0, saved = 0;
  const writes = Array.from({length: 100}, () => runAccountSyncRequest(async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--; saved++; return {error: null};
  }));
  await vi.runAllTimersAsync(); await Promise.all(writes);
  expect(peak).toBe(1); expect(saved).toBe(100);
});

it('paces archive bytes so sequential chunks cannot immediately saturate disk IO again', async () => {
  const send = vi.fn(async () => ({error: null}));
  const first = runAccountSyncRequest(send, {bytes: 256 * 1024});
  const second = runAccountSyncRequest(send, {bytes: 256 * 1024});
  await vi.advanceTimersByTimeAsync(0); await first;
  expect(send).toHaveBeenCalledTimes(1);
  const urgent = runAccountSyncRequest(async () => ({error: null}));
  await vi.advanceTimersByTimeAsync(0); await urgent;
  await vi.advanceTimersByTimeAsync(1_999); expect(send).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); await second; expect(send).toHaveBeenCalledTimes(2);
});

it('all callers share exponential outage backoff instead of independent retry storms', async () => {
  const times: number[] = [], start = Date.now();
  const writes = Array.from({length: 4}, () => runAccountSyncRequest(async () => {
    times.push(Date.now() - start); return {error: {message: 'database unavailable'}};
  }));
  await vi.runAllTimersAsync(); await Promise.all(writes);
  expect(times).toEqual([0, 3_000, 9_000, 21_000]);
});

it('rechecks generations after waiting and never dispatches obsolete saves', async () => {
  let generation = 1;
  const old = vi.fn(async () => ({error: null}));
  const first = runAccountSyncRequest(async () => ({error: null}), {bytes: 128 * 1024});
  const stale = runAccountSyncRequest(old, {bytes: 128 * 1024, current: () => generation === 1});
  await vi.advanceTimersByTimeAsync(0); await first; generation = 2;
  await vi.runAllTimersAsync(); expect(await stale).toBeUndefined(); expect(old).not.toHaveBeenCalled();
});

it('aborts stalled requests, retains the shared cooldown, and allows later recovery', async () => {
  let signal: AbortSignal | undefined;
  const hanging = Object.assign(new Promise<{error: null}>(() => {}), {abortSignal: (value: AbortSignal) => {
    signal = value; return hanging;
  }});
  const failed = runAccountSyncRequest(() => hanging);
  const failure = expect(failed).rejects.toThrow('本机存档仍保留');
  const recovered = vi.fn(async () => ({error: null}));
  const next = runAccountSyncRequest(recovered);
  await vi.advanceTimersByTimeAsync(20_000); await failure;
  expect(signal?.aborted).toBe(true); expect(recovered).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(3_000); await next; expect(recovered).toHaveBeenCalledTimes(1);
});
