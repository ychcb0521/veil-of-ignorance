// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MultiChartLayout } from "@/components/MultiChartLayout";

vi.mock("@/components/CandlestickChart", () => ({
  CandlestickChart: ({ viewportRevision }: { viewportRevision?: string | number }) => (
    <div
      data-testid="candlestick-chart"
      data-viewport-revision={String(viewportRevision)}
    />
  ),
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
  beforeEach(() => {
    window.sessionStorage.clear();
  });

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
    expect(screen.getByTestId("candlestick-chart")).toHaveAttribute(
      "data-viewport-revision",
      "embedded:1x1",
    );

    fireEvent.click(screen.getByTitle("全屏"));

    expect(screen.getByRole("group", { name: "周期选择" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "倍速选择" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "视图布局" })).toBeInTheDocument();
    expect(screen.getByTestId("candlestick-chart")).toHaveAttribute(
      "data-viewport-revision",
      "fullscreen:1x1",
    );

    fireEvent.click(screen.getByText("当前周期 1m"));

    expect(onMainIntervalChange).toHaveBeenCalledWith("5m");

    fireEvent.click(screen.getByLabelText("加速器，当前 30 倍"));
    const speedOption = screen.getByText("180x");
    fireEvent.pointerDown(speedOption, { button: 0 });
    fireEvent.click(speedOption);

    expect(onSetSpeed).toHaveBeenCalledWith(180);
    expect(onSetSpeed).toHaveBeenCalledTimes(1);
  });

  it("restores the adaptive fullscreen layout after a page refresh", () => {
    const props = {
      mainData: [],
      mainSymbol: "BTC/USDT",
      rawSymbol: "BTCUSDT",
      onLoadOlder: vi.fn(),
      loadingOlder: false,
      tradeHistory: [],
      isRunning: true,
      currentSimulatedTime: Date.now(),
      mainInterval: "1m",
      onMainIntervalChange: vi.fn(),
    };
    const firstRender = render(<MultiChartLayout {...props} />);

    fireEvent.click(screen.getByTitle("全屏"));
    expect(window.sessionStorage.getItem("veil.mainChart.fullscreen")).toBe("1");
    expect(screen.getByTestId("candlestick-chart")).toHaveAttribute(
      "data-viewport-revision",
      "fullscreen:1x1",
    );

    firstRender.unmount();
    render(<MultiChartLayout {...props} />);

    expect(screen.getByTitle("退出全屏 (Esc)")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "周期选择" })).toBeInTheDocument();
    expect(screen.getByTestId("candlestick-chart")).toHaveAttribute(
      "data-viewport-revision",
      "fullscreen:1x1",
    );
  });

  it("only leaves the restored fullscreen layout through minimize or Escape", () => {
    window.sessionStorage.setItem("veil.mainChart.fullscreen", "1");
    const props = {
      mainData: [],
      mainSymbol: "BTC/USDT",
      rawSymbol: "BTCUSDT",
      onLoadOlder: vi.fn(),
      loadingOlder: false,
      tradeHistory: [],
      isRunning: true,
      currentSimulatedTime: Date.now(),
      mainInterval: "1m",
      onMainIntervalChange: vi.fn(),
    };
    const minimized = render(<MultiChartLayout {...props} />);

    fireEvent.click(screen.getByTitle("退出全屏 (Esc)"));
    expect(window.sessionStorage.getItem("veil.mainChart.fullscreen")).toBeNull();
    expect(screen.getByTitle("全屏")).toHaveAttribute("aria-pressed", "false");

    minimized.unmount();
    window.sessionStorage.setItem("veil.mainChart.fullscreen", "1");
    const escaped = render(<MultiChartLayout {...props} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(window.sessionStorage.getItem("veil.mainChart.fullscreen")).toBeNull();
    expect(screen.getByTitle("全屏")).toHaveAttribute("aria-pressed", "false");

    escaped.unmount();
    render(<MultiChartLayout {...props} />);
    expect(screen.getByTestId("candlestick-chart")).toHaveAttribute(
      "data-viewport-revision",
      "embedded:1x1",
    );
  });
});
