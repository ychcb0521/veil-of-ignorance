// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MultiChartLayout } from "@/components/MultiChartLayout";

vi.mock("@/components/CandlestickChart", () => ({
  CandlestickChart: () => <div data-testid="candlestick-chart" />,
}));

vi.mock("@/components/TimeframeSelector", () => ({
  TimeframeSelector: ({
    interval,
    onIntervalChange,
  }: {
    interval: string;
    onIntervalChange: (interval: string) => void;
  }) => (
    <button type="button" onClick={() => onIntervalChange("5m")}>
      当前周期 {interval}
    </button>
  ),
}));

describe("MultiChartLayout fullscreen timeframe selector", () => {
  it("shows the main timeframe selector in fullscreen and keeps the existing change callback", () => {
    const onMainIntervalChange = vi.fn();

    render(
      <MultiChartLayout
        mainData={[]}
        mainSymbol="BTC/USDT"
        rawSymbol="BTCUSDT"
        onLoadOlder={vi.fn()}
        loadingOlder={false}
        tradeHistory={[]}
        isRunning
        currentSimulatedTime={Date.now()}
        mainInterval="1m"
        onMainIntervalChange={onMainIntervalChange}
      />,
    );

    expect(screen.queryByText("当前周期 1m")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("全屏"));
    fireEvent.click(screen.getByText("当前周期 1m"));

    expect(onMainIntervalChange).toHaveBeenCalledWith("5m");
  });
});
