import { describe, expect, it } from "vitest";
import { buildAnalysisOrderPriceBounds } from "@/lib/analysisAutoFitPriceRange";

describe("buildAnalysisOrderPriceBounds", () => {
  it("only includes pending-order lines crossing the visible time window", () => {
    expect(buildAnalysisOrderPriceBounds({
      visibleStartTime: 1_000,
      visibleEndTime: 3_000,
      lines: [
        { price: 0.4, startTime: 500, endTime: 1_500 },
        { price: 0.8, startTime: 2_000, endTime: 2_500 },
        { price: 9, startTime: 4_000, endTime: 5_000 },
      ],
    })).toEqual({ min: 0.4, max: 0.8 });
  });

  it("normalizes reversed line times and ignores invalid values", () => {
    expect(buildAnalysisOrderPriceBounds({
      visibleStartTime: 1_000,
      visibleEndTime: 2_000,
      lines: [
        { price: 0.6, startTime: 2_500, endTime: 1_500 },
        { price: Number.NaN, startTime: 1_000, endTime: 2_000 },
        { price: 0.2, startTime: Number.NaN, endTime: 2_000 },
      ],
    })).toEqual({ min: 0.6, max: 0.6 });
  });

  it("returns null when no pending-order price contributes to the window", () => {
    expect(buildAnalysisOrderPriceBounds({
      visibleStartTime: 1_000,
      visibleEndTime: 2_000,
      lines: [{ price: 0.4, startTime: 3_000, endTime: 4_000 }],
    })).toBeNull();
    expect(buildAnalysisOrderPriceBounds({ lines: [] })).toBeNull();
  });
});
