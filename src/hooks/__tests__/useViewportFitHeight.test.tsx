/**
 * 战役详情页 K 线盘面「竖向拉到屏幕能容纳的最大，既要大、又要完整」。
 *
 * 高度 = 可视区 − 吸顶页眉 − 上下各 8px 空隙 − 面板在盘面上方的占位（工具栏）− 下方的占位（常驻图例 + 内边距），
 * 矮屏不低于最小值。下面的几何数字取自真机实测（1440×900：页眉 67、工具栏 45、图例 + 内边距 36，
 * 反事实图例一行连间距 25，「管理」色块一行 25 + 间距 6；最小值 360 = 主图 172 + VOL / HV 各 80 + 分隔线 2 + 时间轴 24 + 边框 2）。
 */
import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIEWPORT_FIT_EXCLUDE_ATTR, computeViewportFitHeight, useViewportFitHeight } from '../useViewportFitHeight';

const HEADER = 67;
const ABOVE = 45;
const BELOW = 36;
const GAP = 8;
const MIN = 360;
const CF_LINE = 25;
const CHIP_ROW = 25;
const ROW_GAP = 6;

describe('computeViewportFitHeight', () => {
  const base = { stickyOffset: HEADER, chromeAbove: ABOVE, chromeBelow: BELOW, gap: GAP, minHeight: MIN };

  it.each([
    [720, 556],
    [900, 736],
    [1080, 916],
    [1440, 1276],
    [600, 436],
  ])('可视区 %ipx → 盘面 %ipx，面板上下各留 8px 恰好铺满', (viewportHeight, expected) => {
    const height = computeViewportFitHeight({ ...base, viewportHeight });
    expect(height).toBe(expected);
    // 面板顶边贴在页眉下 8px 时，面板底边离可视区底边同样是 8px
    const panelBottom = HEADER + GAP + ABOVE + height + BELOW;
    expect(viewportHeight - panelBottom).toBe(GAP);
  });

  it('常驻反事实图例多一行：1280×600 仍放得下（411px），约 550px 才贴到最小值', () => {
    const withCf = { ...base, chromeBelow: BELOW + CF_LINE };
    expect(computeViewportFitHeight({ ...withCf, viewportHeight: 600 })).toBe(411);
    expect(computeViewportFitHeight({ ...withCf, viewportHeight: 550 })).toBe(361);
    expect(computeViewportFitHeight({ ...withCf, viewportHeight: 540 })).toBe(MIN);
  });

  it('矮屏取最小值：宁可页面滚动，也不把盘面压扁', () => {
    expect(computeViewportFitHeight({ ...base, viewportHeight: 480 })).toBe(MIN);
    expect(computeViewportFitHeight({ ...base, viewportHeight: 0 })).toBe(MIN);
  });

  it('测量值异常（NaN / 负数）按 0 计，不产生 NaN 高度', () => {
    expect(computeViewportFitHeight({
      viewportHeight: 900,
      stickyOffset: Number.NaN,
      chromeAbove: -12,
      chromeBelow: Number.POSITIVE_INFINITY,
      gap: GAP,
      minHeight: MIN,
    })).toBe(884);
  });

  it('小数像素向下取整，保证不会多出 1px 把底边挤出可视区', () => {
    expect(computeViewportFitHeight({ ...base, viewportHeight: 900.6, stickyOffset: 67.4 })).toBe(736);
  });
});

type Rect = { top: number; height: number };

function rect({ top, height }: Rect): DOMRect {
  return {
    x: 0, y: top, left: 0, right: 1000, width: 1000, top, height, bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

interface HarnessProps {
  mounted?: boolean;
  /** 常驻图例多一行（如已保存的反事实被自动选中） */
  cfRow?: boolean;
  /** 用户点开的块（「管理」色块 / 「标记说明」） */
  expanded?: boolean;
  onRender?: () => void;
}

function Harness({ mounted = true, cfRow = false, expanded = false, onRender }: HarnessProps) {
  const headerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const height = useViewportFitHeight({ stickyRef: headerRef, panelRef, targetRef, minHeight: MIN });
  onRender?.();
  return (
    <div>
      <header ref={headerRef} data-testid="header" />
      {mounted ? (
        <div ref={panelRef} data-testid="panel">
          <div ref={targetRef} data-testid="target" style={{ height: height ?? 480 }} />
          <div data-testid="legend">
            <div data-testid="order-row" />
            {expanded && (
              <div data-testid="chips" {...{ [VIEWPORT_FIT_EXCLUDE_ATTR]: '' }} style={{ marginTop: ROW_GAP }}>
                <div data-testid="nested-note" {...{ [VIEWPORT_FIT_EXCLUDE_ATTR]: '' }} />
              </div>
            )}
            {cfRow && <div data-testid="cf-row" />}
          </div>
        </div>
      ) : (
        <div data-testid="skeleton" />
      )}
    </div>
  );
}

describe('useViewportFitHeight', () => {
  let viewportHeight = 900;
  let rafQueue: FrameRequestCallback[] = [];
  let observed: Array<{ callback: () => void; targets: Element[] }> = [];

  const flushFrames = () => act(() => {
    const queue = rafQueue;
    rafQueue = [];
    queue.forEach(callback => callback(0));
  });

  beforeEach(() => {
    viewportHeight = 900;
    rafQueue = [];
    observed = [];
    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      get: () => viewportHeight,
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    // 模拟真实排版：面板顶边在滚动后贴在页眉下，面板高度 = 工具栏 + 盘面 + 图例（常驻行 + 点开的块）
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const target = document.querySelector<HTMLElement>('[data-testid="target"]');
      const targetHeight = Number.parseFloat(target?.style.height ?? '0') || 0;
      const expanded = document.querySelector('[data-testid="chips"]') ? ROW_GAP + CHIP_ROW : 0;
      const cf = document.querySelector('[data-testid="cf-row"]') ? CF_LINE : 0;
      const panelTop = 400;
      const targetBottom = panelTop + ABOVE + targetHeight;
      switch (this.dataset.testid) {
        case 'header': return rect({ top: 0, height: HEADER });
        case 'panel': return rect({ top: panelTop, height: ABOVE + targetHeight + BELOW + expanded + cf });
        case 'target': return rect({ top: panelTop + ABOVE, height: targetHeight });
        case 'chips': return rect({ top: targetBottom + 20 + ROW_GAP, height: CHIP_ROW });
        case 'nested-note': return rect({ top: targetBottom + 20 + ROW_GAP, height: 12 });
        default: return rect({ top: 0, height: 0 });
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (document.documentElement as unknown as { clientHeight?: number }).clientHeight;
  });

  it('首帧即按可视区算好高度（布局阶段测量，不先闪一下 480）', () => {
    render(<Harness />);
    expect(screen.getByTestId('target').style.height).toBe('736px');
  });

  it('窗口缩放后重算：主图随之变高 / 变矮，并守住最小值', () => {
    render(<Harness />);
    expect(screen.getByTestId('target').style.height).toBe('736px');

    viewportHeight = 1440;
    act(() => { window.dispatchEvent(new Event('resize')); });
    flushFrames();
    expect(screen.getByTestId('target').style.height).toBe('1276px');

    viewportHeight = 500;
    act(() => { window.dispatchEvent(new Event('resize')); });
    flushFrames();
    expect(screen.getByTestId('target').style.height).toBe(`${MIN}px`);
  });

  it('骨架屏阶段面板还没挂载：先用兜底高度，挂载后立刻绑定并测量', () => {
    const view = render(<Harness mounted={false} />);
    expect(screen.queryByTestId('target')).toBeNull();

    view.rerender(<Harness mounted />);
    expect(screen.getByTestId('target').style.height).toBe('736px');
  });

  const stubResizeObserver = () => {
    vi.stubGlobal('ResizeObserver', class {
      private entry: { callback: () => void; targets: Element[] };
      constructor(callback: () => void) {
        this.entry = { callback, targets: [] };
        observed.push(this.entry);
      }
      observe(target: Element) { this.entry.targets.push(target); }
      unobserve() {}
      disconnect() { this.entry.targets = []; }
    });
  };
  const notifyPanelResize = () => {
    act(() => { observed.forEach(entry => entry.callback()); });
    flushFrames();
  };

  it('常驻图例多一行（如自动选中已保存的反事实）：盘面让出同样高度，面板总高不变、整块仍在可视区内', () => {
    stubResizeObserver();
    const view = render(<Harness />);
    expect(screen.getByTestId('target').style.height).toBe('736px');
    expect(observed.flatMap(entry => entry.targets).map(el => (el as HTMLElement).dataset.testid).sort())
      .toEqual(['header', 'panel']);
    const panelHeight = () => screen.getByTestId('panel').getBoundingClientRect().height;
    const before = panelHeight();

    view.rerender(<Harness cfRow />);
    notifyPanelResize();
    expect(screen.getByTestId('target').style.height).toBe(`${736 - CF_LINE}px`);
    expect(panelHeight()).toBe(before);

    // 盘面变矮又触发一次面板尺寸变化：结果不变，不再抖动
    notifyPanelResize();
    expect(screen.getByTestId('target').style.height).toBe(`${736 - CF_LINE}px`);
  });

  it('点开「管理」色块 / 「标记说明」：盘面高度不变、不重渲染，点开的内容往下推（刚点的按钮不跳位）', () => {
    stubResizeObserver();
    let renders = 0;
    const onRender = () => { renders += 1; };
    const view = render(<Harness cfRow onRender={onRender} />);
    const fitted = `${736 - CF_LINE}px`;
    expect(screen.getByTestId('target').style.height).toBe(fitted);

    view.rerender(<Harness cfRow expanded onRender={onRender} />);
    const rendersAfterOpen = renders;
    notifyPanelResize();
    expect(screen.getByTestId('target').style.height).toBe(fitted);
    expect(renders).toBe(rendersAfterOpen);

    // 展开状态下缩放窗口：仍按收起时的排版贴合
    viewportHeight = 1080;
    act(() => { window.dispatchEvent(new Event('resize')); });
    flushFrames();
    expect(screen.getByTestId('target').style.height).toBe(`${916 - CF_LINE}px`);

    view.rerender(<Harness cfRow onRender={onRender} />);
    notifyPanelResize();
    expect(screen.getByTestId('target').style.height).toBe(`${916 - CF_LINE}px`);
  });

  it('卸载后不再监听窗口缩放', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const view = render(<Harness />);
    view.unmount();
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});
