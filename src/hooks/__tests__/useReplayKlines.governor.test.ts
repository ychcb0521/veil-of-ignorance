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
});
