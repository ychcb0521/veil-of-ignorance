import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBinanceData, intervalToMs } from "@/hooks/useBinanceData";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("intervalToMs", () => {
  it("returns correct milliseconds for all supported intervals", () => {
    expect(intervalToMs("1m")).toBe(60_000);
    expect(intervalToMs("3m")).toBe(180_000);
    expect(intervalToMs("5m")).toBe(300_000);
    expect(intervalToMs("15m")).toBe(900_000);
    expect(intervalToMs("30m")).toBe(1_800_000);
    expect(intervalToMs("1h")).toBe(3_600_000);
    expect(intervalToMs("2h")).toBe(7_200_000);
    expect(intervalToMs("4h")).toBe(14_400_000);
    expect(intervalToMs("6h")).toBe(21_600_000);
    expect(intervalToMs("8h")).toBe(28_800_000);
    expect(intervalToMs("12h")).toBe(43_200_000);
    expect(intervalToMs("1d")).toBe(86_400_000);
    expect(intervalToMs("3d")).toBe(259_200_000);
    expect(intervalToMs("1w")).toBe(604_800_000);
  });

  it("returns default 60s for unknown intervals", () => {
    expect(intervalToMs("unknown")).toBe(60_000);
  });
});

describe("useBinanceData", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("has correct initial state", () => {
    const { result } = renderHook(() => useBinanceData());

    expect(result.current.allData).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.loadingOlder).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.allDataRef.current).toEqual([]);
  });

  it("sets loading state during initLoad", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    const { result } = renderHook(() => useBinanceData());

    act(() => {
      result.current.initLoad("BTCUSDT", "1m", Date.now());
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });
  });

  it("successfully loads and merges history + future data", async () => {
    const now = 1_700_000_000_000;
    const historyData = [
      [now - 120_000, "100", "110", "90", "105", "1000"],
      [now - 60_000, "105", "115", "95", "110", "2000"],
    ];
    const futureData = [
      [now + 60_000, "110", "120", "100", "115", "3000"],
    ];

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(historyData),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(futureData),
      });

    const { result } = renderHook(() => useBinanceData());

    await act(async () => {
      await result.current.initLoad("BTCUSDT", "1m", now);
    });

    await waitFor(() => {
      expect(result.current.allData).toHaveLength(3);
    });

    expect(result.current.allData[0].time).toBe(now - 120_000);
    expect(result.current.allData[1].time).toBe(now - 60_000);
    expect(result.current.allData[2].time).toBe(now + 60_000);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("handles API errors gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
    });

    const { result } = renderHook(() => useBinanceData());

    await act(async () => {
      await result.current.initLoad("BTCUSDT", "1m", Date.now());
    });

    expect(result.current.error).toBe("API 429");
    expect(result.current.loading).toBe(false);
  });

  it("handles empty data response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    const { result } = renderHook(() => useBinanceData());

    await act(async () => {
      await result.current.initLoad("BTCUSDT", "1m", Date.now());
    });

    expect(result.current.error).toBe("No data returned");
  });

  it("loads older data and prepends to existing data", async () => {
    const now = 1_700_000_000_000;
    const initialData = [
      [now - 60_000, "105", "115", "95", "110", "2000"],
      [now, "110", "120", "100", "115", "3000"],
    ];
    const olderData = [
      [now - 180_000, "95", "105", "85", "100", "500"],
      [now - 120_000, "100", "110", "90", "105", "1000"],
    ];

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(initialData),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(olderData),
      });

    const { result } = renderHook(() => useBinanceData());

    await act(async () => {
      await result.current.initLoad("BTCUSDT", "1m", now);
    });

    await waitFor(() => {
      expect(result.current.allData).toHaveLength(2);
    });

    const loadedCount = await act(async () => {
      return await result.current.loadOlder();
    });

    expect(loadedCount).toBe(2);
    expect(result.current.allData).toHaveLength(4);
    expect(result.current.allData[0].time).toBe(now - 180_000);
    expect(result.current.allData[3].time).toBe(now);
    expect(result.current.loadingOlder).toBe(false);
  });

  it("prevents concurrent loadOlder calls", async () => {
    const now = 1_700_000_000_000;
    const initialData = [[now - 60_000, "105", "115", "95", "110", "2000"]];
    const olderData = [[now - 120_000, "100", "110", "90", "105", "1000"]];

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(initialData),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      .mockImplementationOnce(() =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ ok: true, json: () => Promise.resolve(olderData) }), 50),
        ),
      );

    const { result } = renderHook(() => useBinanceData());

    await act(async () => {
      await result.current.initLoad("BTCUSDT", "1m", now);
    });

    await waitFor(() => {
      expect(result.current.allData).toHaveLength(1);
    });

    // Start first loadOlder (it will be pending for 50ms)
    const promise1 = act(async () => {
      return await result.current.loadOlder();
    });

    // Second call should return 0 immediately because loadingOlder is true
    const result2 = await act(async () => {
      return await result.current.loadOlder();
    });

    expect(result2).toBe(0);

    const result1 = await promise1;
    expect(result1).toBe(1);
    expect(result.current.allData).toHaveLength(2);
  });

  it("returns visible data up to current sim time", async () => {
    const now = 1_700_000_000_000;
    const data = [
      [now - 120_000, "100", "110", "90", "105", "1000"],
      [now - 60_000, "105", "115", "95", "110", "2000"],
      [now, "110", "120", "100", "115", "3000"],
      [now + 60_000, "115", "125", "105", "120", "4000"],
    ];

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

    const { result } = renderHook(() => useBinanceData());

    await act(async () => {
      await result.current.initLoad("BTCUSDT", "1m", now);
    });

    await waitFor(() => {
      expect(result.current.allData).toHaveLength(4);
    });

    const visible = result.current.getVisibleData(now + 30_000);

    expect(visible).toHaveLength(3);
    expect(visible[visible.length - 1].time).toBe(now);
  });

  it("interpolates forming candle when sim time is within candle interval", async () => {
    const now = 1_700_000_000_000;
    const data = [
      [now - 60_000, "100", "110", "90", "100", "1000"],
      [now, "110", "120", "100", "120", "2000"],
    ];

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

    const { result } = renderHook(() => useBinanceData());

    await act(async () => {
      await result.current.initLoad("BTCUSDT", "1m", now);
    });

    await waitFor(() => {
      expect(result.current.allData).toHaveLength(2);
    });

    // Sim time is halfway through the second candle
    const simTime = now + 30_000;
    const visible = result.current.getVisibleData(simTime, 60_000);

    expect(visible).toHaveLength(2);
    const lastCandle = visible[visible.length - 1];
    expect(lastCandle.time).toBe(now);
    // Close should be interpolated between open (110) and close (120)
    expect(lastCandle.close).toBeGreaterThan(110);
    expect(lastCandle.close).toBeLessThan(120);
    expect(lastCandle.volume).toBeLessThan(2000);
  });

  it("does not interpolate when intervalMs is not provided", async () => {
    const now = 1_700_000_000_000;
    const data = [
      [now - 60_000, "100", "110", "90", "100", "1000"],
      [now, "110", "120", "100", "120", "2000"],
    ];

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

    const { result } = renderHook(() => useBinanceData());

    await act(async () => {
      await result.current.initLoad("BTCUSDT", "1m", now);
    });

    await waitFor(() => {
      expect(result.current.allData).toHaveLength(2);
    });

    const simTime = now + 30_000;
    const visible = result.current.getVisibleData(simTime);

    expect(visible).toHaveLength(2);
    expect(visible[visible.length - 1].close).toBe(120);
    expect(visible[visible.length - 1].volume).toBe(2000);
  });

  it("does not interpolate when sim time has passed candle end", async () => {
    const now = 1_700_000_000_000;
    const data = [
      [now - 60_000, "100", "110", "90", "100", "1000"],
      [now, "110", "120", "100", "120", "2000"],
    ];

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

    const { result } = renderHook(() => useBinanceData());

    await act(async () => {
      await result.current.initLoad("BTCUSDT", "1m", now);
    });

    await waitFor(() => {
      expect(result.current.allData).toHaveLength(2);
    });

    // Sim time is after the candle should have closed
    const simTime = now + 70_000;
    const visible = result.current.getVisibleData(simTime, 60_000);

    expect(visible).toHaveLength(2);
    expect(visible[visible.length - 1].close).toBe(120);
  });

  it("keeps allDataRef in sync with allData state", async () => {
    const now = 1_700_000_000_000;
    const data = [
      [now - 60_000, "100", "110", "90", "100", "1000"],
      [now, "110", "120", "100", "120", "2000"],
    ];

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

    const { result } = renderHook(() => useBinanceData());

    await act(async () => {
      await result.current.initLoad("BTCUSDT", "1m", now);
    });

    await waitFor(() => {
      expect(result.current.allData).toHaveLength(2);
    });

    expect(result.current.allDataRef.current).toEqual(result.current.allData);
  });

  it("resets all state when reset is called", async () => {
    const now = 1_700_000_000_000;
    const data = [
      [now - 60_000, "100", "110", "90", "100", "1000"],
    ];

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(data),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

    const { result } = renderHook(() => useBinanceData());

    await act(async () => {
      await result.current.initLoad("BTCUSDT", "1m", now);
    });

    await waitFor(() => {
      expect(result.current.allData).toHaveLength(1);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.allData).toEqual([]);
    expect(result.current.allDataRef.current).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("deduplicates future data that overlaps with history", async () => {
    const now = 1_700_000_000_000;
    // History already contains the current candle
    const historyData = [
      [now - 60_000, "100", "110", "90", "100", "1000"],
      [now, "110", "120", "100", "120", "2000"],
    ];
    // Future data tries to add the same candle again
    const futureData = [
      [now, "110", "120", "100", "120", "2000"],
      [now + 60_000, "115", "125", "105", "125", "3000"],
    ];

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(historyData),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(futureData),
      });

    const { result } = renderHook(() => useBinanceData());

    await act(async () => {
      await result.current.initLoad("BTCUSDT", "1m", now);
    });

    await waitFor(() => {
      expect(result.current.allData).toHaveLength(3);
    });

    // Should only have 3 unique candles, not 4
    const times = result.current.allData.map((d) => d.time);
    expect(new Set(times).size).toBe(3);
  });

  it("stops loading older when no more data is available", async () => {
    const now = 1_700_000_000_000;
    const initialData = [[now - 60_000, "105", "115", "95", "110", "2000"]];
    // Less than 1000 items signals no more data
    const olderData = [[now - 120_000, "100", "110", "90", "105", "1000"]];

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(initialData),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(olderData),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

    const { result } = renderHook(() => useBinanceData());

    await act(async () => {
      await result.current.initLoad("BTCUSDT", "1m", now);
    });

    await waitFor(() => {
      expect(result.current.allData).toHaveLength(1);
    });

    const firstLoad = await act(async () => {
      return await result.current.loadOlder();
    });

    expect(firstLoad).toBe(1);

    // Second load should return 0 because noMore is set
    const secondLoad = await act(async () => {
      return await result.current.loadOlder();
    });

    expect(secondLoad).toBe(0);
  });

  it("ignores stale initLoad responses (requestId mismatch)", async () => {
    const now = 1_700_000_000_000;
    const btcData = [[now - 60_000, "100", "110", "90", "100", "1000"]];
    const ethData = [[now - 60_000, "200", "220", "180", "210", "5000"]];

    // Delay the first initLoad's history fetch so it resolves after the second initLoad
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(btcData), 100),
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ethData),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

    const { result } = renderHook(() => useBinanceData());

    // Start first initLoad (BTC) — it will take 100ms to resolve
    const firstInit = act(async () => {
      await result.current.initLoad("BTCUSDT", "1m", now);
    });

    // Start and await second initLoad (ETH) — it should complete first
    await act(async () => {
      await result.current.initLoad("ETHUSDT", "1m", now);
    });

    await waitFor(() => {
      expect(result.current.allData).toHaveLength(1);
    });

    // Verify ETH data is present
    expect(result.current.allData[0].close).toBe(210);

    // Now the first initLoad finally resolves
    await firstInit;

    // Stale BTC data should NOT overwrite ETH data
    expect(result.current.allData).toHaveLength(1);
    expect(result.current.allData[0].close).toBe(210);
  });
});
