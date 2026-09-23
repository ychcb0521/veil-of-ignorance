import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * 面板里由用户点开 / 收起的块（如委托「管理」色块、「标记说明」注释）挂上这个属性，就不计入贴合：
 * 目标高度只按常驻内容算，点开时内容往下推、页面滚动，目标高度不变，刚点的按钮也不会跳位。
 */
export const VIEWPORT_FIT_EXCLUDE_ATTR = 'data-viewport-fit-exclude';

export interface ViewportFitHeightInput {
  /** 可视区高度（px）。 */
  viewportHeight: number;
  /** 吸顶页眉的高度：面板顶边贴在它下方。 */
  stickyOffset: number;
  /** 面板顶边到目标元素顶边的距离（边框 + 内边距 + 工具栏）。 */
  chromeAbove: number;
  /** 目标元素底边到面板底边的距离（常驻图例 + 内边距 + 边框；可展开的块不算）。 */
  chromeBelow: number;
  /** 面板与页眉、与可视区底边各留的空隙。 */
  gap: number;
  /** 矮屏兜底：再矮就不压了，宁可滚动也要保证盘面可读。 */
  minHeight: number;
}

/**
 * 让目标元素（如 K 线盘面）在「面板顶边贴在吸顶页眉下方」时恰好撑满可视区：
 * 可视区 − 页眉 − 上下空隙 − 面板自身的上下装饰 = 目标高度，不足最小值时取最小值。
 */
export function computeViewportFitHeight({
  viewportHeight,
  stickyOffset,
  chromeAbove,
  chromeBelow,
  gap,
  minHeight,
}: ViewportFitHeightInput): number {
  const finite = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);
  const available = finite(viewportHeight)
    - finite(stickyOffset)
    - finite(gap) * 2
    - finite(chromeAbove)
    - finite(chromeBelow);
  // 留 0.01px 容差：小数像素相加减的浮点误差（如 735.9999…）不该让结果少掉 1px。
  return Math.max(Math.round(minHeight), Math.floor(available + 0.01));
}

/**
 * 面板里可展开块（带 VIEWPORT_FIT_EXCLUDE_ATTR）此刻占的总高度，含各自的上下外边距
 * （space-y 的间距挂在块自己的 margin-top 上，一并扣掉才能还原收起时的排版）。
 */
function measureExcludedHeight(panel: HTMLElement): number {
  const selector = `[${VIEWPORT_FIT_EXCLUDE_ATTR}]`;
  let total = 0;
  panel.querySelectorAll<HTMLElement>(selector).forEach(block => {
    // 嵌套的只算最外层，避免重复扣
    const outer = block.parentElement?.closest(selector);
    if (outer && panel.contains(outer)) return;
    const rect = block.getBoundingClientRect();
    // display: none 的块不占位
    if (rect.width === 0 && rect.height === 0) return;
    const style = window.getComputedStyle(block);
    total += rect.height + (Number.parseFloat(style.marginTop) || 0) + (Number.parseFloat(style.marginBottom) || 0);
  });
  return total;
}

/**
 * 可视区高度取 documentElement.clientHeight：桌面端等于窗口内高（且扣掉横向滚动条），
 * 移动端是地址栏展开时的「小视口」，滚动时地址栏伸缩不会让盘面跟着抖。
 */
function readViewportHeight(): number {
  const client = document.documentElement?.clientHeight ?? 0;
  return client > 0 ? client : window.innerHeight;
}

interface Options {
  /** 吸顶页眉；没有时按 0 计。 */
  stickyRef: RefObject<HTMLElement | null>;
  /** 需要整体露在可视区内的面板（工具栏 + 目标元素 + 常驻图例）；其中可展开的块用 VIEWPORT_FIT_EXCLUDE_ATTR 标出。 */
  panelRef: RefObject<HTMLElement | null>;
  /** 高度由本 hook 决定的元素。 */
  targetRef: RefObject<HTMLElement | null>;
  gap?: number;
  minHeight: number;
}

/**
 * 按实测的页眉高度、面板上下占位与可视区高度，算出目标元素能取的最大高度；
 * 窗口缩放、页眉或面板尺寸变化时重算。元素尚未挂载时返回 null，由调用方给兜底高度。
 */
export function useViewportFitHeight({ stickyRef, panelRef, targetRef, gap = 8, minHeight }: Options): number | null {
  const [height, setHeight] = useState<number | null>(null);
  const bindingRef = useRef<{
    sticky: HTMLElement | null;
    panel: HTMLElement;
    target: HTMLElement;
    gap: number;
    minHeight: number;
    release: () => void;
  } | null>(null);

  // 不带依赖：详情页先渲染骨架屏，面板要等数据到了才挂载，
  // 所以每次提交都核对一下元素与参数是否换了，换了才重新绑定（只比引用，不读布局）。
  useLayoutEffect(() => {
    const sticky = stickyRef.current;
    const panel = panelRef.current;
    const target = targetRef.current;
    const bound = bindingRef.current;
    if (
      bound
      && bound.sticky === sticky
      && bound.panel === panel
      && bound.target === target
      && bound.gap === gap
      && bound.minHeight === minHeight
    ) return;
    bound?.release();
    bindingRef.current = null;
    if (!panel || !target) return;

    const measure = () => {
      const panelRect = panel.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      // 上下占位都与目标自身高度无关：目标变高只会把面板撑高，重算结果不变，一轮即收敛。
      // 下方只算常驻内容：可展开的块点开 / 收起时面板尺寸虽变，扣掉它们后结果不变，不会重渲染。
      const next = computeViewportFitHeight({
        viewportHeight: readViewportHeight(),
        stickyOffset: sticky ? sticky.getBoundingClientRect().height : 0,
        chromeAbove: targetRect.top - panelRect.top,
        chromeBelow: panelRect.bottom - targetRect.bottom - measureExcludedHeight(panel),
        gap,
        minHeight,
      });
      setHeight(previous => (previous === next ? previous : next));
    };
    // 同一帧内的多次缩放只量一次；pending 先于 rAF 置位，rAF 被同步调用（测试替身）时也不会卡死。
    let frame = 0;
    let pending = false;
    const flush = () => {
      pending = false;
      measure();
    };
    const schedule = () => {
      if (pending) return;
      pending = true;
      frame = window.requestAnimationFrame(flush);
    };

    measure();
    window.addEventListener('resize', schedule);
    // 工具栏换行、页眉折行、常驻图例增减或折行都会改变占位：页眉或面板尺寸一变就重算（结果不变不重渲染）。
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (sticky) observer?.observe(sticky);
    observer?.observe(panel);

    bindingRef.current = {
      sticky,
      panel,
      target,
      gap,
      minHeight,
      release: () => {
        window.removeEventListener('resize', schedule);
        observer?.disconnect();
        if (pending) window.cancelAnimationFrame(frame);
        pending = false;
      },
    };
  });

  useLayoutEffect(() => () => {
    bindingRef.current?.release();
    bindingRef.current = null;
  }, []);

  return height;
}
