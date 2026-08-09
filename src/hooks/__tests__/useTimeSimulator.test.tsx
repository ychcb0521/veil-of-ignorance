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

describe("useTimeSimulator 倒叙播放", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("方向为 -1 时时钟随真实时间倒退，且与倍速相乘", () => {
    const { result } = renderHook(() => useTimeSimulator());

    act(() => result.current.startSimulation(100_000));
    act(() => result.current.setDirection(-1));
    act(() => result.current.setSpeed(10));

    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    expect(result.current.getSimTime()).toBe(100_000 - 2_000 * 10);
  });

  it("播放中翻转方向：切换瞬间时钟连续、不跳变", () => {
    const { result } = renderHook(() => useTimeSimulator());

    act(() => result.current.startSimulation(50_000));
    vi.setSystemTime(new Date("2026-01-01T00:00:03.000Z"));
    // 正走 3 秒 → 53_000；此刻翻转
    act(() => result.current.setDirection(-1));
    expect(result.current.currentSimulatedTime).toBe(53_000);

    vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
    // 再倒走 2 秒 → 51_000
    expect(result.current.getSimTime()).toBe(51_000);

    // 翻回正序同样无跳变
    act(() => result.current.setDirection(1));
    expect(result.current.currentSimulatedTime).toBe(51_000);
    vi.setSystemTime(new Date("2026-01-01T00:00:06.000Z"));
    expect(result.current.getSimTime()).toBe(52_000);
  });

  it("倒放中暂停会冻结在倒退后的时刻，恢复后继续倒走", () => {
    const { result } = renderHook(() => useTimeSimulator());

    act(() => result.current.startSimulation(100_000));
    act(() => result.current.setDirection(-1));
    vi.setSystemTime(new Date("2026-01-01T00:00:04.000Z"));
    act(() => result.current.pauseSimulation());
    expect(result.current.currentSimulatedTime).toBe(96_000);

    vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));
    act(() => result.current.resumeSimulation());
    vi.setSystemTime(new Date("2026-01-01T00:00:11.000Z"));
    expect(result.current.getSimTime()).toBe(95_000);
  });

  it("倒放中改倍速：先按旧方向×旧倍速冻结，再按新倍速倒走", () => {
    const { result } = renderHook(() => useTimeSimulator());

    act(() => result.current.startSimulation(100_000));
    act(() => result.current.setDirection(-1));
    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    act(() => result.current.setSpeed(5));
    expect(result.current.currentSimulatedTime).toBe(98_000);

    vi.setSystemTime(new Date("2026-01-01T00:00:03.000Z"));
    expect(result.current.getSimTime()).toBe(98_000 - 1_000 * 5);
  });

  it("方向在 stop / start 之间保持，作为一种模式而非单次会话状态", () => {
    const { result } = renderHook(() => useTimeSimulator());

    act(() => result.current.setDirection(-1));
    act(() => result.current.startSimulation(70_000));
    expect(result.current.direction).toBe(-1);

    act(() => result.current.stopSimulation());
    expect(result.current.direction).toBe(-1);

    act(() => result.current.startSimulation(80_000));
    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    expect(result.current.getSimTime()).toBe(79_000);
  });

  it("从持久化状态恢复方向；缺省视为正序", () => {
    const restored = renderHook(() => useTimeSimulator({
      status: "paused",
      historicalAnchorTime: 60_000,
      realStartTime: null,
      currentSimulatedTime: 60_000,
      speed: 3,
      direction: -1,
    }));
    expect(restored.result.current.direction).toBe(-1);

    const legacy = renderHook(() => useTimeSimulator({
      status: "paused",
      historicalAnchorTime: 60_000,
      realStartTime: null,
      currentSimulatedTime: 60_000,
      speed: 3,
    }));
    expect(legacy.result.current.direction).toBe(1);
  });
});
