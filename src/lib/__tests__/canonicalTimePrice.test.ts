import { describe, expect, it, vi } from "vitest";
import {
  CANONICAL_PRICE_INTERVAL_MS,
  deriveCanonicalTimePrice,
  fetchCanonicalTimePriceAt,
} from "@/lib/canonicalTimePrice";

describe("canonical time price", () => {
  it("derives one canonical sub-minute price from a 1m candle", () => {
    const price = deriveCanonicalTimePrice(
      {
        time: 1_000_000,
        open: 10,
        high: 16,
        low: 8,
        close: 14,
        volume: 100,
      },
      1_000_000 + CANONICAL_PRICE_INTERVAL_MS / 2,
      CANONICAL_PRICE_INTERVAL_MS,
      2_000_000,
    );

    expect(price.close).toBe(12);
    expect(price.high).toBe(14.5);
    expect(price.low).toBe(8.5);
  });

  it("fetches the exact 1m candle containing the requested time", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get("interval")).toBe("1m");
      expect(parsed.searchParams.get("startTime")).toBe("1020000");
      expect(parsed.searchParams.get("endTime")).toBe("1079999");

      return {
        ok: true,
        json: async () => [[1_020_000, "10", "20", "8", "16", "1"]],
      } as Response;
    });

    const price = await fetchCanonicalTimePriceAt("SAGAUSDT", 1_041_000, fetchFn as unknown as typeof fetch);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(price?.close).toBeCloseTo(12.1);
  });
});
