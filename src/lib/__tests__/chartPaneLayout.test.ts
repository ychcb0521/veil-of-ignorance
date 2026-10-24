import { describe, expect, it, vi } from 'vitest';
import type { Chart } from 'klinecharts';
import { createChartPaneLayout, synchronizeChartPaneCanvases } from '@/lib/chartPaneLayout';

// Reproduce native resize: indicator heights are allocated first, candles get
// the remainder even when the candle pane has a larger minHeight option.
function nativeLayout(height: number, count = 4) {
  const ids = Array.from({ length: count }, (_, i) => `indicator_${i}`);
  const sizes = new Map(ids.map(id => [id, 80]));
  const options = new Map<string, { height?: number; minHeight?: number }>();
  const chart = {
    getStyles: () => ({ separator: { size: 4 } }),
    getSize: (id: string) => ({ height: id === 'x_axis_pane' ? 24 : sizes.get(id) ?? 0 }),
    setPaneOptions: (option: { id: string; height?: number; minHeight?: number }) => {
      options.set(option.id, option);
      if (option.height != null) sizes.set(option.id, Math.max(option.height, option.minHeight ?? 30));
    },
  } as unknown as Chart;
  const available = () => height - 24 - count * 4;
  return { chart, ids, sizes, options, available, resize: (next: number) => { height = next; } };
}

describe('responsive candle / indicator pane allocation', () => {
  it('reserves most of a compact chart for candles with four visible subpanes', () => {
    const native = nativeLayout(360);
    createChartPaneLayout().apply(native.chart, 360, native.ids);
    const indicators = [...native.sizes.values()].reduce((a, b) => a + b, 0);
    expect(indicators).toBeLessThanOrEqual(native.available() * 0.45);
    expect(native.available() - indicators).toBeGreaterThanOrEqual(180);
    expect([...native.sizes.values()]).toEqual([35, 35, 35, 35]);
  });

  it('restores preferred heights after repeated fullscreen and compact transitions', () => {
    const native = nativeLayout(360);
    const layout = createChartPaneLayout();
    for (const height of [360, 850, 360, 850]) {
      native.resize(height);
      layout.apply(native.chart, height, native.ids);
      expect([...native.sizes.values()]).toEqual(height === 850 ? [80, 80, 80, 80] : [35, 35, 35, 35]);
    }
  });

  it('deduplicates pane IDs and excludes overlays and the time axis', () => {
    const native = nativeLayout(360);
    const layout = createChartPaneLayout();
    layout.apply(native.chart, 360, [null, 'candle_pane', 'x_axis_pane', ...native.ids, ...native.ids]);
    expect([...native.sizes.values()]).toEqual([35, 35, 35, 35]);
    expect(native.options.get('candle_pane')?.minHeight).toBe(180);
  });

  it('reduces native minimum heights for many panes in a small split view', () => {
    const native = nativeLayout(240, 8);
    createChartPaneLayout().apply(native.chart, 240, native.ids);
    const indicators = [...native.sizes.values()].reduce((a, b) => a + b, 0);
    expect(indicators).toBeLessThanOrEqual(native.available() * 0.45);
    expect(native.available() - indicators).toBeGreaterThan(100);
    expect([...native.sizes.values()].every(height => height > 0 && height < 30)).toBe(true);
  });

  it('retains manually adjusted heights when space permits, and reclaims closed panes', () => {
    const native = nativeLayout(850);
    const layout = createChartPaneLayout();
    native.sizes.set(native.ids[0], 120);
    native.sizes.set(native.ids[1], 40);
    layout.remember(native.chart, native.ids);
    layout.apply(native.chart, 850, native.ids);
    expect([...native.sizes.values()]).toEqual([120, 40, 80, 80]);
    layout.apply(native.chart, 850, native.ids.slice(1));
    layout.apply(native.chart, 850, native.ids);
    expect(native.sizes.get(native.ids[0])).toBe(80);
  });
});

describe('native canvas pixels after pane resizing', () => {
  function canvas(bitmapHeight: number, displayedHeight = 80) {
    const element = document.createElement('canvas');
    Object.defineProperties(element, { clientWidth: { value: 400 }, clientHeight: { value: displayedHeight } });
    element.width = 400 * window.devicePixelRatio;
    element.height = bitmapHeight * window.devicePixelRatio;
    return { _element: element, _mediaQueryListener: vi.fn() };
  }

  it('retries native pixel sizing for stretched main, overlay and axis canvases', () => {
    const stale = [canvas(37), canvas(37), canvas(37), canvas(37)];
    synchronizeChartPaneCanvases({ _drawPanes: [{
      _mainWidget: { _mainCanvas: stale[0], _overlayCanvas: stale[1] },
      _yAxisWidget: { _mainCanvas: stale[2], _overlayCanvas: stale[3] },
    }] } as unknown as Chart);
    stale.forEach(item => expect(item._mediaQueryListener).toHaveBeenCalledOnce());
  });

  it('does not repaint matching canvases or hidden zero-height panes', () => {
    const matching = canvas(80), hidden = canvas(37, 0);
    synchronizeChartPaneCanvases({ _drawPanes: [{ _mainWidget: { _mainCanvas: matching, _overlayCanvas: hidden } }] } as unknown as Chart);
    expect(matching._mediaQueryListener).not.toHaveBeenCalled();
    expect(hidden._mediaQueryListener).not.toHaveBeenCalled();
    expect(() => synchronizeChartPaneCanvases({} as Chart)).not.toThrow();
  });

  it('replaces a queued replay paint so the native reset cannot be dropped', () => {
    const stale = { ...canvas(76, 35), _requestAnimationId: 123 };
    stale._mediaQueryListener.mockImplementation(() => {
      // Native Canvas ignores a reset while a plain paint remains queued.
      if (stale._requestAnimationId === -1) stale._element.height = 35 * window.devicePixelRatio;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    try {
      synchronizeChartPaneCanvases({ _drawPanes: [{ _mainWidget: { _mainCanvas: stale } }] } as unknown as Chart);
      expect(cancel).toHaveBeenCalledWith(123);
      expect(stale._element.height).toBe(35 * window.devicePixelRatio);
    } finally { cancel.mockRestore(); }
  });
});
