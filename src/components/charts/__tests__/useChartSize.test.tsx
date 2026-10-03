import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHART_FALLBACK_SIZE } from '@/lib/chartTokens';
import { useChartSize } from '../useChartSize';

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(private callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this);
  }

  resize(target: Element, width: number, height: number) {
    this.callback([
      { target, contentRect: { width, height } } as ResizeObserverEntry,
    ], this as unknown as ResizeObserver);
  }
}

function Chart({ visible, nodeKey = 'plot', width = 320, height = 200 }: {
  visible: boolean;
  nodeKey?: string;
  width?: number;
  height?: number;
}) {
  const { ref, size } = useChartSize<HTMLDivElement>();
  return <>
    <output data-testid="size">{size.width}×{size.height}</output>
    {visible ? <div key={nodeKey} ref={ref} data-testid="plot" data-width={width} data-height={height} /> : null}
  </>;
}

beforeEach(() => {
  MockResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
    return Number(this.dataset.width ?? 0);
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () {
    return Number(this.dataset.height ?? 0);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useChartSize', () => {
  it('measures a plot that appears after the empty state, then observes its size without resubscribing on renders', () => {
    const view = render(<Chart visible={false} />);
    expect(screen.getByTestId('size')).toHaveTextContent(`${CHART_FALLBACK_SIZE.width}×${CHART_FALLBACK_SIZE.height}`);
    expect(MockResizeObserver.instances).toHaveLength(0);

    view.rerender(<Chart visible />);
    const node = screen.getByTestId('plot');
    expect(screen.getByTestId('size')).toHaveTextContent('320×200');
    expect(MockResizeObserver.instances).toHaveLength(1);
    const observer = MockResizeObserver.instances[0];
    expect(observer.observe).toHaveBeenCalledExactlyOnceWith(node);

    act(() => observer.resize(node, 416.4, 260.6));
    expect(screen.getByTestId('size')).toHaveTextContent('416×261');
    view.rerender(<Chart visible />);
    expect(MockResizeObserver.instances).toHaveLength(1);
    expect(observer.disconnect).not.toHaveBeenCalled();

    act(() => observer.resize(node, 0, 0));
    expect(screen.getByTestId('size')).toHaveTextContent('416×261');
  });

  it('disconnects removed or replaced nodes, measures the new node, and ignores late callbacks', () => {
    const view = render(<Chart visible />);
    const firstNode = screen.getByTestId('plot');
    const firstObserver = MockResizeObserver.instances[0];

    view.rerender(<Chart visible={false} />);
    expect(firstObserver.disconnect).toHaveBeenCalledTimes(1);
    act(() => firstObserver.resize(firstNode, 999, 999));
    expect(screen.getByTestId('size')).toHaveTextContent('320×200');

    view.rerender(<Chart visible nodeKey="second" width={700} height={400} />);
    const secondNode = screen.getByTestId('plot');
    const secondObserver = MockResizeObserver.instances[1];
    expect(screen.getByTestId('size')).toHaveTextContent('700×400');
    expect(secondObserver.observe).toHaveBeenCalledExactlyOnceWith(secondNode);
    act(() => firstObserver.resize(firstNode, 999, 999));
    expect(screen.getByTestId('size')).toHaveTextContent('700×400');
    act(() => secondObserver.resize(secondNode, 720, 420));
    expect(screen.getByTestId('size')).toHaveTextContent('720×420');

    view.rerender(<Chart visible nodeKey="third" width={500} height={300} />);
    const thirdNode = screen.getByTestId('plot');
    const thirdObserver = MockResizeObserver.instances[2];
    expect(secondObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(thirdObserver.observe).toHaveBeenCalledExactlyOnceWith(thirdNode);
    expect(screen.getByTestId('size')).toHaveTextContent('500×300');

    view.unmount();
    expect(thirdObserver.disconnect).toHaveBeenCalledTimes(1);
  });

  it('resubscribes after StrictMode cleanup and disconnects the active observer on unmount', () => {
    const view = render(<StrictMode><Chart visible /></StrictMode>);
    const node = screen.getByTestId('plot');
    expect(MockResizeObserver.instances).toHaveLength(2);
    const [first, current] = MockResizeObserver.instances;
    expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(current.observe).toHaveBeenCalledExactlyOnceWith(node);

    act(() => current.resize(node, 600, 380));
    act(() => first.resize(node, 999, 999));
    expect(screen.getByTestId('size')).toHaveTextContent('600×380');

    view.unmount();
    expect(current.disconnect).toHaveBeenCalledTimes(1);
  });

  it('keeps the fallback when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const view = render(<Chart visible={false} />);
    view.rerender(<Chart visible />);
    expect(screen.getByTestId('size')).toHaveTextContent(`${CHART_FALLBACK_SIZE.width}×${CHART_FALLBACK_SIZE.height}`);
    expect(MockResizeObserver.instances).toHaveLength(0);
  });
});
