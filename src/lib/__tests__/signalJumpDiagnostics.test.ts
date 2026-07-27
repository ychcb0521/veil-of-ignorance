import { describe, expect, it, vi } from "vitest";
import {
  diagnoseSignalJump,
  hasKlineCoveringSignalTime,
  preflightSignalJumpIssues,
} from "@/lib/signalJumpDiagnostics";

const MINUTE = 60_000;

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function kline(openTime: number): unknown[] {
  return [openTime, "1", "1", "1", "1", "1"];
}

describe("hasKlineCoveringSignalTime", () => {
  it("requires a candle that actually covers the signal instant", () => {
    expect(hasKlineCoveringSignalTime([{ time: 1_000 }], 1_030, 60)).toBe(true);
    expect(hasKlineCoveringSignalTime([{ time: 1_000 }], 1_060, 60)).toBe(false);
    expect(hasKlineCoveringSignalTime([{ time: 500 }], 1_030, 60)).toBe(false);
  });
});

describe("diagnoseSignalJump", () => {
  it("reports available when the returned candle covers the signal instant", async () => {
    const signalTime = 1_000_030;
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(200, [kline(1_000_000)]));

    await expect(diagnoseSignalJump(
      "BTCUSDT",
      signalTime,
      "1m",
      MINUTE,
      { fetchImpl, now: 2_000_000 },
    )).resolves.toEqual({ status: "available" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("marks an invalid futures symbol as fatal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(400, { code: -1121, msg: "Invalid symbol." }),
    );

    const result = await diagnoseSignalJump(
      "SOXLUSDT",
      1_000_000,
      "1m",
      MINUTE,
      { fetchImpl, now: 9_999 },
    );
    expect(result).toMatchObject({
      status: "fatal",
      issue: {
        code: "invalid_symbol",
        checkedAt: 9_999,
      },
    });
  });

  it("marks a signal before the first listed candle", async () => {
    const signalTime = 1_000_000;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, []))
      .mockResolvedValueOnce(mockResponse(200, [kline(2_000_000)]))
      .mockResolvedValueOnce(mockResponse(200, [kline(5_000_000)]));

    const result = await diagnoseSignalJump(
      "NEWUSDT",
      signalTime,
      "1m",
      MINUTE,
      { fetchImpl, now: 6_000_000 },
    );
    expect(result).toMatchObject({
      status: "fatal",
      issue: { code: "before_listing" },
    });
  });

  it("marks a signal after the final available candle", async () => {
    const signalTime = 5_000_000;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, [kline(2_000_000)]))
      .mockResolvedValueOnce(mockResponse(200, [kline(1_000_000)]))
      .mockResolvedValueOnce(mockResponse(200, [kline(2_000_000)]));

    const result = await diagnoseSignalJump(
      "OLDUSDT",
      signalTime,
      "1m",
      MINUTE,
      { fetchImpl, now: 6_000_000 },
    );
    expect(result).toMatchObject({
      status: "fatal",
      issue: { code: "after_delisting" },
    });
  });

  it("marks a permanent historical gap when first and last data straddle the signal", async () => {
    const signalTime = 3_000_000;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, [kline(2_000_000)]))
      .mockResolvedValueOnce(mockResponse(200, [kline(1_000_000)]))
      .mockResolvedValueOnce(mockResponse(200, [kline(5_000_000)]));

    const result = await diagnoseSignalJump(
      "GAPUSDT",
      signalTime,
      "1m",
      MINUTE,
      { fetchImpl, now: 6_000_000 },
    );
    expect(result).toMatchObject({
      status: "fatal",
      issue: { code: "missing_kline" },
    });
  });

  it("keeps rate limits and service restrictions retryable", async () => {
    const rateLimited = vi.fn().mockResolvedValue(
      mockResponse(429, { code: -1003, msg: "Too many requests" }),
    );
    const restricted = vi.fn().mockResolvedValue(
      mockResponse(200, { code: 0, msg: "Service unavailable from a restricted location" }),
    );

    await expect(diagnoseSignalJump(
      "BTCUSDT",
      1_000_000,
      "1m",
      MINUTE,
      { fetchImpl: rateLimited },
    )).resolves.toMatchObject({ status: "retryable" });
    await expect(diagnoseSignalJump(
      "BTCUSDT",
      1_000_000,
      "1m",
      MINUTE,
      { fetchImpl: restricted },
    )).resolves.toMatchObject({ status: "retryable" });
  });
});

describe("preflightSignalJumpIssues", () => {
  it("uses exchange metadata to mark pre-listing signals before a row is clicked", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(200, {
      symbols: [
        {
          symbol: "BTCUSDT",
          onboardDate: 2_000_000,
          deliveryDate: 4_133_404_800_000,
        },
      ],
    }));
    const progress = vi.fn();

    const summary = await preflightSignalJumpIssues(
      [
        { id: "old", symbol: "BTCUSDT", timeMs: 1_000_000 },
        { id: "valid", symbol: "BTCUSDT", timeMs: 3_000_000 },
      ],
      "1m",
      MINUTE,
      { fetchImpl, now: 5_000_000, onProgress: progress },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({
      checkedSymbols: 1,
      totalSymbols: 1,
      fatalIssueCount: 1,
      retryableSymbols: 0,
    });
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      checkedSymbols: 1,
      totalSymbols: 1,
      fatalIssues: [
        expect.objectContaining({
          id: "old",
          issue: expect.objectContaining({ code: "before_listing" }),
        }),
      ],
    }));
  });

  it("groups absent historical symbols and fetches their bounds only once per symbol", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/exchangeInfo")) {
        return mockResponse(200, { symbols: [] });
      }
      if (url.includes("startTime=0")) {
        return mockResponse(200, [kline(1_000_000)]);
      }
      return mockResponse(200, [kline(2_000_000)]);
    });
    const batches: Array<{ id: string; code: string }> = [];

    const summary = await preflightSignalJumpIssues(
      [
        { id: "available", symbol: "OLDUSDT", timeMs: 1_500_000 },
        { id: "too-late", symbol: "OLDUSDT", timeMs: 3_000_000 },
      ],
      "1m",
      MINUTE,
      {
        fetchImpl,
        now: 4_000_000,
        onProgress: ({ fatalIssues }) => {
          batches.push(...fatalIssues.map(item => ({
            id: item.id,
            code: item.issue.code,
          })));
        },
      },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(summary).toMatchObject({
      checkedSymbols: 1,
      totalSymbols: 1,
      fatalIssueCount: 1,
      retryableSymbols: 0,
    });
    expect(batches).toEqual([{ id: "too-late", code: "after_delisting" }]);
  });

  it("does not persist fatal labels when the bulk metadata request is transiently unavailable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(429, { code: -1003, msg: "Too many requests" }),
    );
    const progress = vi.fn();

    const summary = await preflightSignalJumpIssues(
      [{ id: "btc", symbol: "BTCUSDT", timeMs: 1_000_000 }],
      "1m",
      MINUTE,
      { fetchImpl, onProgress: progress },
    );

    expect(summary.retryableSymbols).toBe(1);
    expect(summary.retryableReason).toContain("Too many requests");
    expect(progress).not.toHaveBeenCalled();
  });
});
