import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPERSEDED_INIT_LOAD, useBinanceData } from '@/hooks/useBinanceData';

const BASE = 1_700_000_000_000;
const MINUTE = 60_000;
const LATER = BASE + 30 * 24 * 60 * MINUTE;
const mockFetch = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function response(time?: number, price = 100): Response {
  return {
    ok: true,
    json: async () => time == null ? [] : [[time, `${price}`, `${price + 1}`, `${price - 1}`, `${price}`, '10']],
  } as Response;
}

function mockInit(time = BASE, price = 100) {
  mockFetch.mockResolvedValueOnce(response(time, price)).mockResolvedValueOnce(response());
}

describe('useBinanceData dataset generation isolation', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns no candles from an init superseded by another symbol, and keeps the latest loading state', async () => {
    const oldResponse = deferred<Response>();
    const newResponse = deferred<Response>();
    mockFetch
      .mockReturnValueOnce(oldResponse.promise).mockResolvedValueOnce(response())
      .mockReturnValueOnce(newResponse.promise).mockResolvedValueOnce(response());
    const { result } = renderHook(() => useBinanceData());
    let oldInit!: ReturnType<typeof result.current.initLoad>;
    let newInit!: ReturnType<typeof result.current.initLoad>;
    act(() => {
      oldInit = result.current.initLoad('BTCUSDT', '1m', BASE);
      newInit = result.current.initLoad('ETHUSDT', '5m', LATER);
    });
    await act(async () => {
      oldResponse.resolve(response(BASE));
      expect(await oldInit).toEqual([]);
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.allDataRef.current).toEqual([]);
    await act(async () => {
      newResponse.resolve(response(LATER, 200));
      const committed = await newInit;
      // A caller may start its RAF immediately after await, before React flushes.
      expect(result.current.allDataRef.current).toBe(committed);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.dataContextRef.current).toEqual({ symbol: 'ETHUSDT', interval: '5m', generation: 2 });
    expect(result.current.allData.map((k) => k.time)).toEqual([LATER]);
  });

  it.each(['loadOlder', 'loadNewer'] as const)('%s discards a late batch after reloading the same symbol at another date', async (method) => {
    mockInit();
    const { result } = renderHook(() => useBinanceData());
    await act(async () => { await result.current.initLoad('BTCUSDT', '1m', BASE); });
    const staleBatch = deferred<Response>();
    mockFetch.mockReturnValueOnce(staleBatch.promise);
    let oldLoad!: Promise<number>;
    act(() => { oldLoad = result.current[method](); });
    mockInit(LATER, 200);
    await act(async () => { await result.current.initLoad('BTCUSDT', '1m', LATER); });
    const activeBatch = deferred<Response>();
    mockFetch.mockReturnValueOnce(activeBatch.promise);
    let activeLoad!: Promise<number>;
    act(() => { activeLoad = result.current[method](); });

    await act(async () => {
      staleBatch.resolve(response(method === 'loadOlder' ? BASE - MINUTE : BASE + MINUTE));
      expect(await oldLoad).toBe(0);
    });
    expect(result.current.allData.map((k) => k.time)).toEqual([LATER]);
    // Old finally must not release the new generation's paging lock.
    expect(method === 'loadOlder' ? result.current.isFetchingOlder() : result.current.isFetchingNewer()).toBe(true);
    expect(method === 'loadOlder' ? result.current.loadingOlder : result.current.loadingNewer).toBe(true);
    const callsBeforeDuplicate = mockFetch.mock.calls.length;
    await act(async () => { expect(await result.current[method]()).toBe(0); });
    expect(mockFetch).toHaveBeenCalledTimes(callsBeforeDuplicate);

    const extraTime = method === 'loadOlder' ? LATER - MINUTE : LATER + MINUTE;
    await act(async () => {
      activeBatch.resolve(response(extraTime, 200));
      expect(await activeLoad).toBe(1);
    });
    expect(result.current.allData.map((k) => k.time)).toEqual([LATER, extraTime].sort((a, b) => a - b));
    expect(method === 'loadOlder' ? result.current.isFetchingOlder() : result.current.isFetchingNewer()).toBe(false);
  });

  it.each(['loadOlder', 'loadNewer'] as const)('%s cannot repopulate a reset dataset or leave a paging lock behind', async (method) => {
    mockInit();
    const { result } = renderHook(() => useBinanceData());
    await act(async () => { await result.current.initLoad('BTCUSDT', '1m', BASE); });
    const pending = deferred<Response>();
    mockFetch.mockReturnValueOnce(pending.promise);
    let page!: Promise<number>;
    act(() => { page = result.current[method](); });
    act(() => { result.current.reset(); });
    expect(result.current.isFetchingOlder()).toBe(false);
    expect(result.current.isFetchingNewer()).toBe(false);
    expect(result.current.loadingOlder).toBe(false);
    expect(result.current.loadingNewer).toBe(false);
    expect(result.current.dataContextRef.current.symbol).toBe('');
    await act(async () => {
      pending.resolve(response(method === 'loadOlder' ? BASE - MINUTE : BASE + MINUTE));
      expect(await page).toBe(0);
    });
    expect(result.current.allData).toEqual([]);
    expect(result.current.allDataRef.current).toEqual([]);
    const calls = mockFetch.mock.calls.length;
    await act(async () => { expect(await result.current[method]()).toBe(0); });
    expect(mockFetch).toHaveBeenCalledTimes(calls);
  });

  it('invalidates a pending init on reset, including its resolved return value', async () => {
    const pending = deferred<Response>();
    mockFetch.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response());
    const { result } = renderHook(() => useBinanceData());
    let init!: ReturnType<typeof result.current.initLoad>;
    act(() => { init = result.current.initLoad('BTCUSDT', '1m', BASE); });
    act(() => { result.current.reset(); });
    await act(async () => {
      pending.resolve(response(BASE));
      expect(await init).toEqual([]);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.allData).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('blocks paging during replacement, while a failed init retains the original dataset and allows paging again', async () => {
    mockInit();
    const { result } = renderHook(() => useBinanceData());
    await act(async () => { await result.current.initLoad('BTCUSDT', '1m', BASE); });
    const originalContext = result.current.dataContextRef.current;
    const pending = deferred<Response>();
    mockFetch.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response());
    let init!: ReturnType<typeof result.current.initLoad>;
    act(() => { init = result.current.initLoad('ETHUSDT', '5m', LATER); });
    const calls = mockFetch.mock.calls.length;
    await act(async () => {
      expect(await result.current.loadOlder()).toBe(0);
      expect(await result.current.loadNewer()).toBe(0);
    });
    expect(mockFetch).toHaveBeenCalledTimes(calls);
    await act(async () => {
      pending.resolve(response());
      expect(await init).toEqual([]);
    });
    expect(result.current.dataContextRef.current).toBe(originalContext);
    expect(result.current.allData.map((k) => k.time)).toEqual([BASE]);
    mockFetch.mockResolvedValueOnce(response(BASE - MINUTE));
    await act(async () => { expect(await result.current.loadOlder()).toBe(1); });
    const url = new URL(mockFetch.mock.lastCall![0]);
    expect(url.searchParams.get('symbol')).toBe('BTCUSDT');
    expect(url.searchParams.get('interval')).toBe('1m');
    expect(url.searchParams.get('endTime')).toBe(String(BASE - 1));
    expect(result.current.allData.map((k) => k.time)).toEqual([BASE - MINUTE, BASE]);
  });

  it('【评审发现】被取代的取数交回的是可按身份识别的哨兵，真失败交回普通空数组——调用方才分得清「放弃」与「报错」', async () => {
    const { result } = renderHook(() => useBinanceData());
    const slow = deferred<Response>();
    mockFetch.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(response());
    let superseded!: Promise<unknown>;
    act(() => { superseded = result.current.initLoad('OLDUSDT', '1m', BASE); });
    mockInit(LATER, 200);
    await act(async () => { await result.current.initLoad('NEWUSDT', '1m', LATER); });
    slow.resolve(response(BASE));
    await act(async () => { expect(await superseded).toBe(SUPERSEDED_INIT_LOAD); });
    expect(result.current.dataContextRef.current.symbol).toBe('NEWUSDT');

    // 真失败：没有任何 K 线
    mockFetch.mockResolvedValueOnce(response()).mockResolvedValueOnce(response());
    await act(async () => {
      const failed = await result.current.initLoad('NONEUSDT', '1m', LATER);
      expect(failed).toEqual([]);
      expect(failed).not.toBe(SUPERSEDED_INIT_LOAD);
    });
    // 失败的取数不动已提交的数据集
    expect(result.current.dataContextRef.current.symbol).toBe('NEWUSDT');
  });

  it('【评审发现】调用方先验后提交：验不过的那批 K 线原样交回，但数据层一个字不动（失败的信号跳转不把别的标的留在数据层里）', async () => {
    const { result } = renderHook(() => useBinanceData());
    mockInit(BASE, 100);
    await act(async () => { await result.current.initLoad('BTCUSDT', '1m', BASE); });
    const committed = result.current.dataContextRef.current;
    const before = result.current.allDataRef.current;
    expect(committed.symbol).toBe('BTCUSDT');

    mockInit(LATER, 0.5);
    const accept = vi.fn(() => false);
    await act(async () => {
      const rejected = await result.current.initLoad('FOOUSDT', '1m', LATER, { accept });
      expect(rejected).toHaveLength(1);
      expect(rejected[0].close).toBe(0.5);
    });
    expect(accept).toHaveBeenCalledTimes(1);
    expect(result.current.dataContextRef.current).toBe(committed);
    expect(result.current.allDataRef.current).toBe(before);
    expect(result.current.allData).toBe(before);
    expect(result.current.loading).toBe(false);

    // 验得过的照常提交，并换一代
    mockInit(LATER, 0.5);
    await act(async () => { await result.current.initLoad('FOOUSDT', '1m', LATER, { accept: () => true }); });
    expect(result.current.dataContextRef.current.symbol).toBe('FOOUSDT');
    expect(result.current.dataContextRef.current.generation).toBeGreaterThan(committed.generation);
  });
});
