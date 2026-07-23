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
  it("shows synchronized timeframe and speed controls in fullscreen", () => {
    const onMainIntervalChange = vi.fn();
    const onSetSpeed = vi.fn();

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
        speed={30}
        onSetSpeed={onSetSpeed}
      />,
    );

    expect(screen.queryByText("当前周期 1m")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("加速器，当前 30 倍")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("全屏"));

    expect(screen.getByRole("group", { name: "周期选择" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "倍速选择" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "视图布局" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("当前周期 1m"));

    expect(onMainIntervalChange).toHaveBeenCalledWith("5m");

    fireEvent.click(screen.getByLabelText("加速器，当前 30 倍"));
    const speedOption = screen.getByText("180x");
    fireEvent.pointerDown(speedOption, { button: 0 });
    fireEvent.click(speedOption);

    expect(onSetSpeed).toHaveBeenCalledWith(180);
    expect(onSetSpeed).toHaveBeenCalledTimes(1);
  });
});
