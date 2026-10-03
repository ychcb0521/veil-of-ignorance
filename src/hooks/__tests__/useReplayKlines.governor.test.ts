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
    await vi.advanceTimersByTimeAsync(1_499);
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
