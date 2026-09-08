import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CHART_FALLBACK_SIZE } from '@/lib/chartTokens';

type ChartSize = { width: number; height: number };

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * 用真实像素测量绘图盒，让 SVG 的 viewBox 单位 = 1 CSS px。
 * 这是「r=4 真的等于 8px」的前提：固定 viewBox 会被容器缩放，
 * 旧的侧栏图 r=2.5 在 240 单位盒里渲染出来只有 4.3px。
 *
 * jsdom 没有 ResizeObserver、盒子恒为 0×0，此时退回确定尺寸，
 * 保证测试里刻度、网格、点位百分比位置全部可算且只渲染一次。
 */
export function useChartSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<ChartSize>(CHART_FALLBACK_SIZE);

  useIsomorphicLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const apply = (width: number, height: number) => {
      const next = { width: Math.round(width), height: Math.round(height) };
      if (next.width <= 0 || next.height <= 0) return;
      setSize(prev => (prev.width === next.width && prev.height === next.height ? prev : next));
    };

    apply(node.clientWidth, node.clientHeight);
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      apply(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}
