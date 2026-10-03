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
  const subscriptionRef = useRef<{ node: T; observer: ResizeObserver } | null>(null);
  const [size, setSize] = useState<ChartSize>(CHART_FALLBACK_SIZE);

  // 空图没有绘图节点；每次提交检查 ref，节点稍后出现或被替换时才重新订阅。
  // 保留 object ref 接口，调用方仍可直接读取 ref.current 的滚动位置。
  useIsomorphicLayoutEffect(() => {
    const node = ref.current;
    if (subscriptionRef.current?.node === node) return;
    subscriptionRef.current?.observer.disconnect();
    subscriptionRef.current = null;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const apply = (width: number, height: number) => {
      const next = { width: Math.round(width), height: Math.round(height) };
      if (next.width <= 0 || next.height <= 0) return;
      setSize(prev => (prev.width === next.width && prev.height === next.height ? prev : next));
    };

    apply(node.clientWidth, node.clientHeight);
    const observer = new ResizeObserver(entries => {
      // 已断开节点的回调可能排在队列里，不能覆盖新节点的尺寸。
      if (subscriptionRef.current?.observer !== observer || ref.current !== node) return;
      const entry = entries.find(entry => entry.target === node);
      if (!entry) return;
      apply(entry.contentRect.width, entry.contentRect.height);
    });
    subscriptionRef.current = { node, observer };
    observer.observe(node);
  });

  useIsomorphicLayoutEffect(() => () => {
    subscriptionRef.current?.observer.disconnect();
    subscriptionRef.current = null;
  }, []);

  return { ref, size };
}
