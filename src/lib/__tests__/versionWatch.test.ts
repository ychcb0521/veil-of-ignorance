import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { currentEntry, fetchLiveEntry, watchForNewVersion } from '../versionWatch';

const reply = (body: unknown, type = 'application/json') => Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'content-type': type } }));
beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = '<script type="module" crossorigin src="/assets/index-OLD111.js"></script>';
});
afterEach(() => { vi.useRealTimers(); document.head.innerHTML = ''; });

it('reads the entry this page was loaded from', () => {
  expect(currentEntry()).toBe('/assets/index-OLD111.js');
});

it('treats the SPA fallback page, errors and unknown formats as "no information"', async () => {
  expect(await fetchLiveEntry(() => reply('<!doctype html>', 'text/html'))).toBeNull();
  expect(await fetchLiveEntry(() => Promise.reject(new Error('offline')))).toBeNull();
  expect(await fetchLiveEntry(() => reply({ entry: 5 }))).toBeNull();
  expect(await fetchLiveEntry(() => reply({ version: 1, entry: '/assets/index-NEW222.js' }))).toBe('/assets/index-NEW222.js');
});

it('announces a new release once, only when the live entry differs, and stops checking afterwards', async () => {
  let live = '/assets/index-OLD111.js';
  const fetcher = vi.fn(() => reply({ version: 1, entry: live })), seen = vi.fn();
  watchForNewVersion(seen, fetcher as unknown as typeof fetch);
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(seen).not.toHaveBeenCalled();
  live = '/assets/index-NEW222.js';
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(seen).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(20 * 60_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(seen).toHaveBeenCalledTimes(1);
});
