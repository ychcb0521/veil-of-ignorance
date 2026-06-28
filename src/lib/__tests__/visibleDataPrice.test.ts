import { describe, expect, it } from "vitest";
import { applyCurrentPriceToVisibleData } from "@/lib/visibleDataPrice";

describe("applyCurrentPriceToVisibleData", () => {
  it("applies the shared latest price even when a long timeframe candle has a huge old wick", () => {
    const visible = [
      { time: 1, open: 0.02, high: 2.9451, low: 0.01645, close: 0.020193, volume: 1 },
    ];

    const result = applyCurrentPriceToVisibleData(visible, 0.04492);

    expect(result).not.toBe(visible);
    expect(result[0].close).toBe(0.04492);
    expect(result[0].high).toBe(2.9451);
    expect(result[0].low).toBe(0.01645);
  });

  it("does not apply a clearly polluted cross-symbol price", () => {
    const visible = [
      { time: 1, open: 0.02, high: 0.023, low: 0.018, close: 0.020193, volume: 1 },
    ];

    const result = applyCurrentPriceToVisibleData(visible, 10);

    expect(result).toBe(visible);
    expect(result[0].close).toBe(0.020193);
  });
});
