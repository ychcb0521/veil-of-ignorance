import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ScatterPlot, type ScatterSeries } from '../ScatterPlot';
import { MIN_PITCH } from '@/lib/chartTokens';

const SERIES: ScatterSeries[] = [
  { id: 'profit', label: '盈利', token: 'profit', shape: 'circle' },
  { id: 'loss', label: '亏损', token: 'loss', shape: 'diamond' },
  { id: 'flat', label: '持平', token: 'neutral', shape: 'ring' },
];

function makePoints(count: number, valueAt: (index: number) => number = index => index - count / 2) {
  return Array.from({ length: count }, (_, index) => {
    const value = valueAt(index);
    return {
      id: `p${index}`,
      x: index,
      y: value,
      seriesId: value > 0 ? 'profit' : value < 0 ? 'loss' : 'flat',
      valueText: `${value}R`,
      label: `战役 ${index}`,
      ariaLabel: `第 ${index} 场，${value}R`,
      testId: `pt-${index}`,
      dataAttrs: { 'data-campaign-id': `c${index}`, 'data-metric-value': value },
    };
  });
}

function renderOrdinal(count: number, extra: Partial<Parameters<typeof ScatterPlot>[0]> = {}) {
  const points = makePoints(count);
  return render(
    <ScatterPlot
      points={points}
      series={SERIES}
      yAxis={{
        min: -count,
        max: count,
        ticks: [count, 0, -count].map(value => ({
          value,
          label: `${value}R`,
          testId: 'tick',
          dataAttrs: { 'data-tick-value': value },
          gridTestId: 'grid',
          gridDataAttrs: { 'data-grid-value': value },
        })),
      }}
      xAxis={{ mode: 'ordinal', count, labelAt: index => `#${index}` }}
      emptyMessage="暂无数据"
      testId="plot"
      scrollAreaTestId="scroll"
      {...extra}
    />,
  );
}

describe('ScatterPlot 结构', () => {
  it('每个点位只产出一个带 data-campaign-id 的 <button>，且按输入顺序排列', () => {
    renderOrdinal(6);
    const plot = screen.getByTestId('plot');
    const tagged = [...plot.querySelectorAll('[data-campaign-id]')];
    expect(tagged).toHaveLength(6);
    expect(tagged.every(node => node.tagName.toLowerCase() === 'button')).toBe(true);
    expect(tagged.map(node => node.getAttribute('data-campaign-id')))
      .toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5']);
    // SVG 图形只挂 data-mark-for，否则 querySelectorAll 会翻倍。
    expect(plot.querySelectorAll('[data-mark-for]')).toHaveLength(6);
    expect([...plot.querySelectorAll('[data-mark-for]')].every(
      node => !node.hasAttribute('data-campaign-id'),
    )).toBe(true);
  });

  it('空数据仍渲染根 testid 与 data 属性', () => {
    render(
      <ScatterPlot
        points={[]}
        series={SERIES}
        yAxis={{ min: -1, max: 1, ticks: [] }}
        xAxis={{ mode: 'ordinal', count: 0, labelAt: () => null }}
        emptyMessage="暂无数据"
        testId="plot"
        scrollAreaTestId="scroll"
        rootDataAttrs={{ 'data-metric-key': 'odds' }}
      />,
    );
    expect(screen.getByTestId('plot')).toHaveAttribute('data-metric-key', 'odds');
    expect(screen.getByTestId('plot')).toHaveTextContent('暂无数据');
  });
});

describe('ScatterPlot 布局：尺寸恒定，让位的是排布', () => {
  it('点少时 fit，点多时滚动，两种情况下点位都是 8px', () => {
    const { unmount } = renderOrdinal(20);
    const small = screen.getByTestId('scroll');
    expect(small).toHaveAttribute('data-mark-size', '8');
    expect(small).toHaveAttribute('data-fit-mode', 'fit');
    expect(Number(small.getAttribute('data-mark-pitch'))).toBeGreaterThan(MIN_PITCH);
    unmount();

    renderOrdinal(192);
    const big = screen.getByTestId('scroll');
    expect(big).toHaveAttribute('data-mark-size', '8');
    expect(big).toHaveAttribute('data-fit-mode', 'scroll');
    expect(Number(big.getAttribute('data-mark-pitch'))).toBe(MIN_PITCH);
    expect(big).toHaveClass('aspect-[8/5]');
    expect(big).toHaveAttribute('data-layout', 'campaign-scatter-landscape');
  });

  it('相邻命中区不重叠，点位圆心永远属于自己', () => {
    renderOrdinal(192);
    const buttons = [...screen.getByTestId('plot').querySelectorAll<HTMLElement>('button[data-campaign-id]')];
    const rects = buttons.map(node => ({
      left: Number.parseFloat(node.style.left) - Number.parseFloat(node.style.width) / 2,
      right: Number.parseFloat(node.style.left) + Number.parseFloat(node.style.width) / 2,
    })).sort((a, b) => a.left - b.left);
    for (let i = 1; i < rects.length; i += 1) {
      expect(rects[i].left).toBeGreaterThanOrEqual(rects[i - 1].right - 0.001);
    }
  });

  it('纵向位置用百分比内联，数值越小越靠下', () => {
    renderOrdinal(6);
    const buttons = [...screen.getByTestId('plot').querySelectorAll<HTMLElement>('button[data-campaign-id]')];
    const lowest = buttons.reduce((best, node) => (
      Number(node.dataset.metricValue) < Number(best.dataset.metricValue) ? node : best
    ));
    const highest = buttons.reduce((best, node) => (
      Number(node.dataset.metricValue) > Number(best.dataset.metricValue) ? node : best
    ));
    expect(buttons.every(node => node.style.top.endsWith('%'))).toBe(true);
    expect(Number.parseFloat(lowest.style.top)).toBeGreaterThan(Number.parseFloat(highest.style.top));
  });
});

describe('ScatterPlot 点位绘制', () => {
  it('四种形状都是真实 SVG 几何，实心外画 2px 表面环，没有任何 border', () => {
    renderOrdinal(6);
    const marks = [...screen.getByTestId('plot').querySelectorAll<SVGElement>('[data-mark-for] > *')];
    expect(marks.length).toBe(6);
    for (const mark of marks) {
      expect(['circle', 'path']).toContain(mark.tagName.toLowerCase());
      expect(mark.getAttribute('style')).not.toMatch(/border|box-shadow/);
    }
    const filled = marks.filter(mark => mark.style.stroke === 'var(--chart-surface)');
    expect(filled.length).toBeGreaterThan(0);
    for (const mark of filled) {
      expect(mark.style.strokeWidth).toBe('4');
      // paint-order 走 SVG 表现属性，2px 环画在 8px 实心之外而不是吃掉填充。
      expect(mark.getAttribute('paint-order')).toBe('stroke');
    }
  });

  it('网格线是实线 hairline，只有 threshold 参考线走虚线', () => {
    renderOrdinal(6, {
      referenceLines: [
        { value: 0, kind: 'zero', testId: 'zero' },
        { value: -3, kind: 'threshold', testId: 'thr', dataAttrs: { 'data-reference-value': -3 } },
      ],
    });
    for (const line of screen.getAllByTestId('grid') as unknown as SVGLineElement[]) {
      expect(line.style.stroke).toBe('var(--chart-grid)');
      expect(line.style.strokeWidth).toBe('1');
      expect(line.getAttribute('stroke-dasharray')).toBeNull();
    }
    const zero = screen.getByTestId('zero') as unknown as SVGLineElement;
    expect(zero.getAttribute('stroke-dasharray')).toBeNull();
    expect(zero.style.stroke).toBe('var(--chart-axis)');
    const threshold = screen.getByTestId('thr') as unknown as SVGLineElement;
    expect(threshold.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(threshold.style.stroke).toBe('var(--chart-threshold)');
    expect(threshold).toHaveAttribute('data-reference-kind', 'threshold');
    expect(threshold).toHaveAttribute('data-reference-value', '-3');
  });
});

describe('ScatterPlot 交互与可达性', () => {
  it('悬停与聚焦给出同一套激活状态、十字线和提示框', () => {
    const onActiveChange = vi.fn();
    renderOrdinal(6, { onActiveChange });

    fireEvent.mouseEnter(screen.getByTestId('pt-4'));
    expect(onActiveChange).toHaveBeenCalledWith('p4');
    expect(screen.getByTestId('pt-4')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('战役 4');
    expect(screen.getByTestId('chart-crosshair-value')).toBeInTheDocument();
    expect(screen.getByTestId('chart-crosshair-column')).toBeInTheDocument();
    const hoverText = screen.getByTestId('chart-tooltip').textContent;

    fireEvent.focus(screen.getByTestId('pt-2'));
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('战役 2');
    expect(screen.getByTestId('chart-tooltip').textContent).not.toBe(hoverText);
  });

  it('点击点位回调对应 id；漫游 tabindex 只留一个可 Tab 的点位', () => {
    const onSelect = vi.fn();
    renderOrdinal(6, { onSelect });
    fireEvent.click(screen.getByTestId('pt-3'));
    expect(onSelect).toHaveBeenCalledWith('p3');

    const buttons = [...screen.getByTestId('plot').querySelectorAll<HTMLElement>('button[data-campaign-id]')];
    expect(buttons.filter(node => node.tabIndex === 0)).toHaveLength(1);
    fireEvent.keyDown(screen.getByTestId('pt-3'), { key: 'End' });
    expect(screen.getByTestId('pt-5')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(screen.getByTestId('pt-5'), { key: 'Home' });
    expect(screen.getByTestId('pt-0')).toHaveAttribute('aria-pressed', 'true');
  });

  it('指针离开图区后提示框与十字线消失，键盘焦点还在时不清', () => {
    const onActiveChange = vi.fn();
    renderOrdinal(6, { onActiveChange });
    fireEvent.mouseEnter(screen.getByTestId('pt-3'));
    expect(screen.getByTestId('chart-tooltip')).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByTestId('scroll'));
    expect(screen.queryByTestId('chart-tooltip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chart-crosshair-value')).not.toBeInTheDocument();
    expect(onActiveChange).toHaveBeenLastCalledWith(null);

    // 键盘焦点停在点位上时，鼠标扫过一下不能把读数抹掉。
    act(() => screen.getByTestId('pt-2').focus());
    fireEvent.mouseLeave(screen.getByTestId('scroll'));
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('战役 2');
  });

  it('提示框对读屏静音：数值由按钮 aria-label 承载，不重复播报', () => {
    renderOrdinal(6);
    fireEvent.mouseEnter(screen.getByTestId('pt-1'));
    expect(screen.getByTestId('chart-tooltip')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('pt-1')).toHaveAccessibleName('第 1 场，-2R');
  });

  it('没有 n= 计数栏的图不给右侧留死白，有的才留', () => {
    const { unmount } = renderOrdinal(6);
    const trackWithout = screen.getByTestId('scroll').querySelector('[style*="right"]') as HTMLElement;
    expect(trackWithout.style.right).toBe('0px');
    unmount();

    renderOrdinal(6, {
      bandCounts: {
        testId: 'band',
        items: [{ key: 'b0', top: 50, count: 2, lower: -1, upper: 1, label: '中段' }],
      },
    });
    const trackWith = screen.getByTestId('scroll').querySelector('[style*="right"]') as HTMLElement;
    expect(trackWith.style.right).toBe('32px');
  });

  it('两个及以上系列时图例强制渲染，身份不只靠颜色', () => {
    renderOrdinal(6);
    const legend = screen.getByLabelText('图例');
    expect(within(legend).getByText('盈利')).toBeInTheDocument();
    expect(within(legend).getByText('亏损')).toBeInTheDocument();
    expect(within(legend).getByText('持平')).toBeInTheDocument();
    // 点位同时带形状，颜色失效时仍可区分。
    expect(screen.getByTestId('pt-0')).toHaveAttribute('data-marker-shape', 'diamond');
  });
});

describe('ScatterPlot 密度处理', () => {
  it('类目模式下同列重叠点确定性横向让开，纵轴一律不动', () => {
    const points = Array.from({ length: 6 }, (_, index) => ({
      id: `m${index}`,
      x: 3,
      y: 0,
      seriesId: 'flat',
      valueText: '0R',
      label: `样本 ${index}`,
      ariaLabel: `样本 ${index}`,
      testId: `m-${index}`,
      dataAttrs: { 'data-campaign-id': `m${index}` },
    }));
    const tree = (
      <ScatterPlot
        points={points}
        series={SERIES}
        yAxis={{ min: -2, max: 2, ticks: [] }}
        xAxis={{ mode: 'category', categories: [1, 2, 3, 4, 5].map(v => ({ value: v, label: String(v) })) }}
        emptyMessage="暂无数据"
        testId="plot"
        scrollAreaTestId="scroll"
      />
    );
    const { rerender } = render(tree);
    const readXs = () => [...screen.getByTestId('plot').querySelectorAll<HTMLElement>('button[data-campaign-id]')]
      .map(node => Number.parseFloat(node.style.left));
    const first = readXs();
    const tops = [...screen.getByTestId('plot').querySelectorAll<HTMLElement>('button[data-campaign-id]')]
      .map(node => node.style.top);

    expect(new Set(first).size).toBe(6);
    const sorted = [...first].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(MIN_PITCH - 0.5);
    }
    // 纵轴是数值本身，绝不位移。
    expect(new Set(tops).size).toBe(1);

    rerender(tree);
    expect(readXs()).toEqual(first);
  });

  it('ordinal 模式不做蜂群位移：每场战役固定占一列', () => {
    renderOrdinal(8);
    const xs = [...screen.getByTestId('plot').querySelectorAll<HTMLElement>('button[data-campaign-id]')]
      .map(node => Number.parseFloat(node.style.left));
    const gaps = xs.slice(1).map((value, index) => Number((value - xs[index]).toFixed(3)));
    expect(new Set(gaps).size).toBe(1);
  });
});

describe('ScatterPlot 在没有 ResizeObserver 的环境里', () => {
  it('仍渲染全部点位、刻度、网格与区间计数，且位置可算', () => {
    const original = globalThis.ResizeObserver;
    // 故意删除以模拟没有 ResizeObserver 的宿主
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    try {
      renderOrdinal(6, {
        bandCounts: {
          testId: 'band',
          items: [{ key: 'b', top: 50, count: 6, lower: -3, upper: 3, label: '区间' }],
        },
      });
      expect(screen.getAllByTestId('tick').length).toBeGreaterThan(0);
      expect(screen.getAllByTestId('grid').length).toBeGreaterThan(0);
      expect(screen.getByTestId('band')).toHaveAttribute('data-count', '6');
      expect(screen.getByTestId('band').classList.contains('text-[8px]')).toBe(true);
      const buttons = [...screen.getByTestId('plot').querySelectorAll<HTMLElement>('button[data-campaign-id]')];
      expect(buttons).toHaveLength(6);
      expect(buttons.every(node => Number.isFinite(Number.parseFloat(node.style.top)))).toBe(true);
    } finally {
      globalThis.ResizeObserver = original;
    }
  });
});
