import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimeSimulator } from "@/hooks/useTimeSimulator";

describe("useTimeSimulator speed control", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("keeps a speed selected while paused and uses it after resume", () => {
    const { result } = renderHook(() => useTimeSimulator());

    act(() => result.current.startSimulation(1_000));

    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    act(() => result.current.pauseSimulation());
    expect(result.current.status).toBe("paused");
    expect(result.current.currentSimulatedTime).toBe(2_000);

    act(() => result.current.setSpeed(30));
    expect(result.current.speed).toBe(30);

    vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
    act(() => result.current.resumeSimulation());

    vi.setSystemTime(new Date("2026-01-01T00:00:06.000Z"));
    expect(result.current.getSimTime()).toBe(32_000);
  });

  it("allows changing speed when the historical anchor is zero", () => {
    const { result } = renderHook(() => useTimeSimulator());

    act(() => result.current.startSimulation(0));

    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    act(() => result.current.setSpeed(10));

    expect(result.current.speed).toBe(10);
    expect(result.current.currentSimulatedTime).toBe(1_000);
  });
});
