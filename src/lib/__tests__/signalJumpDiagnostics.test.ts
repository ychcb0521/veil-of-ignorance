import { describe, expect, it, vi } from "vitest";
import {
  diagnoseSignalJump,
  hasKlineCoveringSignalTime,
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
