import { afterEach, describe, expect, it, vi } from 'vitest';

const candle = (time: number) => [time, '1', '2', '0.5', '1.5', '10'];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('replay K-line request governor', () => {
  it('paces every pagination page for background list calculations', async () => {
    vi.useFakeTimers();
    const firstPage = Array.from({ length: 1_500 }, (_, index) => candle(index * 60_000));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(firstPage), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchReplayKlineRange } = await import('@/hooks/useReplayKlines');

    const result = fetchReplayKlineRange('BTCUSDT', '1m', 0, 100_000_000, undefined, { priority: 'background' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(749);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('opens the circuit on 418 so queued background work does not keep hitting Binance', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 418 }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchReplayKlineRange } = await import('@/hooks/useReplayKlines');

    await expect(fetchReplayKlineRange('BTCUSDT', '5m', 0, 60_000, undefined, { priority: 'background' }))
      .rejects.toThrow('API 418');
    await expect(fetchReplayKlineRange('ETHUSDT', '5m', 0, 60_000, undefined, { priority: 'background' }))
      .rejects.toThrow('API 429');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lets detail requests interrupt a background pacing wait without increasing concurrency', async () => {
    vi.useFakeTimers();
    const requested: string[] = [];
    let active = 0;
    let maximumActive = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      requested.push(new URL(url).searchParams.get('symbol')!);
      await Promise.resolve();
      active--;
      return new Response(JSON.stringify([candle(0)]), { status: 200 });
    }));
    const { fetchReplayKlineRange } = await import('@/hooks/useReplayKlines');
    await fetchReplayKlineRange('FIRST', '1m', 0, 60_000, undefined, { priority: 'background' });
    const background = fetchReplayKlineRange('QUEUED', '1m', 0, 60_000, undefined, { priority: 'background' });
    await vi.advanceTimersByTimeAsync(100);
    await fetchReplayKlineRange('DETAIL', '1m', 0, 60_000);
    expect(requested).toEqual(['FIRST', 'DETAIL']);
    await vi.advanceTimersByTimeAsync(650);
    await background;
    expect(requested).toEqual(['FIRST', 'DETAIL', 'QUEUED']);
    expect(maximumActive).toBe(1);
  });

  it('rejects an aborted paginated range instead of returning its incomplete first page', async () => {
    vi.useFakeTimers();
    const firstPage = Array.from({ length: 1_500 }, (_, index) => candle(index * 60_000));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(firstPage), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchReplayKlineRange } = await import('@/hooks/useReplayKlines');
    const controller = new AbortController();
    const result = fetchReplayKlineRange('BTCUSDT', '1m', 0, 100_000_000, controller.signal, { priority: 'background' });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(750);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('times out a stalled body, frees the queue, and reports a retryable timeout after both endpoints stall', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url: string) => Promise.resolve({
      ok: true,
      status: 200,
      json: () => new URL(url).searchParams.get('symbol') === 'STALLED'
        ? new Promise(() => undefined)
        : Promise.resolve([candle(0)]),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchReplayKlineRange } = await import('@/hooks/useReplayKlines');
    const result = fetchReplayKlineRange('STALLED', '1m', 0, 60_000, undefined, { priority: 'background' });
    const rejected = expect(result).rejects.toMatchObject({ kind: 'timeout', retryable: true });
    const detail = fetchReplayKlineRange('DETAIL', '1m', 0, 60_000);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(detail).resolves.toHaveLength(1);
    await vi.advanceTimersByTimeAsync(750 + 15_000);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('cancels an active stalled body immediately and allows the following detail request to proceed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => new Promise(() => undefined) })
      .mockResolvedValueOnce(new Response(JSON.stringify([candle(0)]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchReplayKlineRange } = await import('@/hooks/useReplayKlines');
    const controller = new AbortController();
    const result = fetchReplayKlineRange('STALLED', '1m', 0, 60_000, controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    await rejected;
    await expect(fetchReplayKlineRange('DETAIL', '1m', 0, 60_000)).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves Retry-After metadata and scopes the background circuit to background work', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T13:00:00Z'));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '60' } }))
      .mockResolvedValueOnce(new Response('', { status: 418, headers: { 'retry-after': 'Sat, 03 Oct 2026 13:02:00 GMT' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([candle(0)]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchReplayKlineRange } = await import('@/hooks/useReplayKlines');
    const result = fetchReplayKlineRange('BACKGROUND', '1m', 0, 60_000, undefined, { priority: 'background' });
    const rejected = expect(result).rejects.toMatchObject({ kind: 'rate-limit', status: 418, retryAfterMs: 119_250 });
    await vi.advanceTimersByTimeAsync(750);
    await rejected;
    await expect(fetchReplayKlineRange('WAITING', '1m', 0, 60_000, undefined, { priority: 'background' }))
      .rejects.toMatchObject({ kind: 'rate-limit', retryAfterMs: 119_250 });
    await expect(fetchReplayKlineRange('DETAIL', '1m', 0, 60_000)).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(['network', 'server'] as const)('retains a primary rate-limit cooldown when the alternate fails with a %s error', async (failure) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 418, headers: { 'retry-after': '90' } }));
    if (failure === 'network') fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    else fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchReplayKlineRange } = await import('@/hooks/useReplayKlines');
    const result = fetchReplayKlineRange('BACKGROUND', '1m', 0, 60_000, undefined, { priority: 'background' });
    const rejected = expect(result).rejects.toMatchObject({ kind: 'rate-limit', status: 418, retryAfterMs: 90_000 });
    await vi.advanceTimersByTimeAsync(750);
    await rejected;
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(fetchReplayKlineRange('NEXT', '1m', 0, 60_000, undefined, { priority: 'background' }))
      .rejects.toMatchObject({ kind: 'rate-limit', retryAfterMs: 88_000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed candle responses as retryable instead of caching a truncated range', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify([candle(0), [60_000, 'NaN']]), { status: 200 })));
    const { fetchReplayKlineRange } = await import('@/hooks/useReplayKlines');
    await expect(fetchReplayKlineRange('BTCUSDT', '1m', 0, 120_000))
      .rejects.toMatchObject({ kind: 'invalid-response', retryable: true });
  });

  it('switches to the alternate Binance futures endpoint after direct API 418', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 418 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([candle(0)]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchReplayKlineRange } = await import('@/hooks/useReplayKlines');

    const result = await fetchReplayKlineRange('BNBUSDT', '1h', 0, 60_000);
    expect(result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('fapi.binance.com/fapi/v1/klines');
    expect(String(fetchMock.mock.calls[1][0])).toContain('www.binance.com/fapi/v1/klines');
  });

  it('tries the primary endpoint when the preferred alternate endpoint later fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 418 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([candle(0)]), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([candle(0)]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchReplayKlineRange } = await import('@/hooks/useReplayKlines');
    await fetchReplayKlineRange('FIRST', '1h', 0, 60_000);
    await expect(fetchReplayKlineRange('SECOND', '1h', 0, 60_000)).resolves.toHaveLength(1);
    expect(fetchMock.mock.calls.map(call => new URL(String(call[0])).hostname)).toEqual([
      'fapi.binance.com', 'www.binance.com', 'www.binance.com', 'fapi.binance.com',
    ]);
  });
});
