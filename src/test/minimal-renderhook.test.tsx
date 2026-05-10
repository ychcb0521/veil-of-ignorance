import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";

function useCounter() {
  const [count, setCount] = useState(0);
  const increment = () => setCount((c) => c + 1);
  return { count, increment };
}

describe("minimal renderHook", () => {
  it("sync act works", () => {
    const { result } = renderHook(() => useCounter());
    act(() => {
      result.current.increment();
    });
    expect(result.current.count).toBe(1);
  });

  it("async act works", async () => {
    const { result } = renderHook(() => useCounter());
    await act(async () => {
      await Promise.resolve();
      result.current.increment();
    });
    expect(result.current.count).toBe(1);
  });
});
