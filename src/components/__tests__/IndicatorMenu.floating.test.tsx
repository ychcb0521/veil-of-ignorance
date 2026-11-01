import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { IndicatorMenu } from '@/components/IndicatorMenu';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));

/** 截图里的场景：页面往下滚后，「指标」按钮所在的位置已经在视口上方，图表容器还裁掉了超出部分。 */
it('floats above the clipping chart container and keeps its title bar and close button inside the viewport', () => {
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.hasAttribute('data-indicator-menu-anchor')) return rect(900, -300, 0, 0);
    if (this.hasAttribute('data-indicator-menu-panel')) { const el = this as HTMLElement; return rect(parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0, 384, 500); }
    return rect(0, -400, 1000, 1200);
  });
  render(<div data-chart-indicator-host className="relative overflow-hidden"><div data-chart-indicator-boundary/><div className="relative"><IndicatorMenu open indicators={[]} onClose={() => {}} onIndicatorsChange={() => {}}/></div></div>);
  const header = screen.getByTitle('拖动标题栏移动卡片'), panel = header.parentElement!;
  expect(panel.parentElement).toBe(document.body);
  expect(panel).toHaveClass('fixed');
  const [, y] = panel.style.transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/)!.slice(1).map(Number);
  expect(parseFloat(panel.style.top) + y).toBe(8);
  expect(parseFloat(panel.style.left)).toBe(900 - 384);
  expect(header.querySelector('button')).toBeInTheDocument();
});

it('stays in place when it is not inside a chart', () => {
  render(<div className="relative"><IndicatorMenu open indicators={[]} onClose={() => {}} onIndicatorsChange={() => {}}/></div>);
  const panel = screen.getByTitle('拖动标题栏移动卡片').parentElement!;
  expect(panel.parentElement).not.toBe(document.body);
  expect(panel).toHaveClass('absolute');
});
