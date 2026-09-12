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

describe('ScatterPlot 堆叠（场数）布局', () => {
  function makeStackPoints(values: number[]) {
    return values.map((value, index) => ({
      id: `s${index}`,
      x: value,
      // 场数轴下 y 不参与布局，统一给 0。
      y: 0,
      seriesId: value > 0 ? 'profit' : value < 0 ? 'loss' : 'flat',
      valueText: `${value}R`,
      label: `战役 ${index}`,
      ariaLabel: `第 ${index} 场，${value}R`,
      testId: `st-${index}`,
      dataAttrs: { 'data-campaign-id': `c${index}`, 'data-metric-value': value },
    }));
  }

  function renderStack(values: number[], extra: Partial<Parameters<typeof ScatterPlot>[0]> = {}) {
    return render(
      <ScatterPlot
        points={makeStackPoints(values)}
        series={SERIES}
        yAxis={{ mode: 'count', tickTestId: 'ctick', gridTestId: 'cgrid', unit: '场' }}
        xAxis={{ mode: 'linear', min: -2, max: 10, labels: [{ at: -2, text: '-2R' }, { at: 10, text: '+10R' }] }}
        emptyMessage="暂无数据"
        testId="plot"
        scrollAreaTestId="scroll"
        {...extra}
      />,
    );
  }

  it('同一 x 的 5 个点从底线向上堆：5 个 mark、5 个 button、top% 严格递减、不滚动', () => {
    renderStack([0.5, 0.5, 0.5, 0.5, 0.5]);
    const plot = screen.getByTestId('plot');
    expect(plot.querySelectorAll('[data-mark-for]')).toHaveLength(5);
    const buttons = [...plot.querySelectorAll<HTMLElement>('button[data-campaign-id]')];
    expect(buttons).toHaveLength(5);
    const tops = buttons.map(node => Number.parseFloat(node.style.top));
    expect(buttons.every(node => node.style.top.endsWith('%'))).toBe(true);
    for (let i = 1; i < tops.length; i += 1) expect(tops[i]).toBeLessThan(tops[i - 1]);
    expect(new Set(buttons.map(node => node.style.left)).size).toBe(1);
    expect([...plot.querySelectorAll('[data-mark-for]')].every(node => !node.hasAttribute('data-campaign-id'))).toBe(true);
    const scroll = screen.getByTestId('scroll');
    expect(scroll).toHaveAttribute('data-fit-mode', 'fit');
    expect(scroll).toHaveAttribute('data-mark-size', '8');
    expect(scroll).toHaveAttribute('data-layout', 'campaign-scatter-landscape');
    expect(Number(scroll.getAttribute('data-mark-pitch'))).toBeGreaterThanOrEqual(MIN_PITCH);
  });

  it('竖向参考线：x1 === x2、data-reference-axis=x、threshold 虚线琥珀 / zero 实线轴色、标签用墨色', () => {
    renderStack([-0.5, 0.5], {
      referenceLines: [
        { axis: 'x', value: -1, kind: 'threshold', label: '-1R 止损', testId: 'wall', dataAttrs: { 'data-reference-value': -1 } },
        { axis: 'x', value: 0, kind: 'zero', label: '0 盈亏平衡', testId: 'be' },
      ],
    });
    const wall = screen.getByTestId('wall') as unknown as SVGLineElement;
    expect(wall.getAttribute('x1')).toBe(wall.getAttribute('x2'));
    expect(wall.getAttribute('y1')).not.toBe(wall.getAttribute('y2'));
    expect(wall).toHaveAttribute('data-reference-axis', 'x');
    expect(wall).toHaveAttribute('data-reference-value', '-1');
    expect(wall.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(wall.style.stroke).toBe('var(--chart-threshold)');
    const breakEven = screen.getByTestId('be') as unknown as SVGLineElement;
    expect(breakEven.getAttribute('stroke-dasharray')).toBeNull();
    expect(breakEven.style.stroke).toBe('var(--chart-axis)');
    expect(Number(breakEven.getAttribute('x1'))).toBeGreaterThan(Number(wall.getAttribute('x1')));
    const label = screen.getByTestId('wall-label') as unknown as SVGTextElement;
    expect(label.tagName.toLowerCase()).toBe('text');
    expect(label.textContent).toBe('-1R 止损');
    expect(label.style.fill).toBe('var(--chart-ink-muted)');
    expect(screen.getByTestId('be-label').textContent).toBe('0 盈亏平衡');
  });

  it('overlay 画在参考线之后、第一个点位之前，且不带 data-mark-for', () => {
    renderStack([0.2, 0.4, 0.6], {
      overlay: scale => (
        <path
          data-testid="curve"
          d={`M ${scale.x(-2)} ${scale.countY(0)} L ${scale.x(10)} ${scale.countY(1)}`}
          fill="none"
          style={{ stroke: 'var(--chart-ink-secondary)' }}
        />
      ),
    });
    const plot = screen.getByTestId('plot');
    const curve = screen.getByTestId('curve');
    expect(curve.hasAttribute('data-mark-for')).toBe(false);
    expect(curve.closest('[data-mark-for]')).toBeNull();
    const firstMark = plot.querySelector('[data-mark-for]')!;
    // eslint-disable-next-line no-bitwise
    expect(curve.compareDocumentPosition(firstMark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(curve.parentElement?.getAttribute('clip-path')).toContain('plot-plot-clip');
    expect(plot.querySelector('clipPath#plot-plot-clip')).not.toBeNull();
    expect(plot.querySelectorAll('[data-mark-for]')).toHaveLength(3);
  });

  it('悬停只给竖向十字线与提示框，不画横向数值线', () => {
    renderStack([0.2, 0.4]);
    fireEvent.mouseEnter(screen.getByTestId('st-1'));
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('战役 1');
    expect(screen.getByTestId('chart-crosshair-column')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-crosshair-value')).not.toBeInTheDocument();
  });

  it('x 越出窗口的点画成三角而不是圆，脚注计数', () => {
    renderStack([0.5, 38]);
    const mark = screen.getByTestId('plot').querySelector('[data-mark-for="s1"] > *')!;
    expect(mark.tagName.toLowerCase()).toBe('path');
    expect(mark.getAttribute('paint-order')).toBe('stroke');
    expect((mark as unknown as SVGPathElement).style.stroke).toBe('var(--chart-surface)');
    const inside = screen.getByTestId('plot').querySelector('[data-mark-for="s0"] > *')!;
    expect(inside.tagName.toLowerCase()).toBe('circle');
    expect(screen.getByTestId('plot').querySelector('figcaption')).toHaveTextContent('1 个点位超出显示区间');
    const buttons = [...screen.getByTestId('plot').querySelectorAll<HTMLElement>('button[data-campaign-id]')];
    expect(Number.parseFloat(buttons[1].style.left)).toBeGreaterThan(Number.parseFloat(buttons[0].style.left));
  });

  it('场数刻度是升序整数、最顶一格带单位、网格实线且落在行的边界上', () => {
    renderStack([0.5, 0.5, 0.5]);
    const ticks = screen.getAllByTestId('ctick');
    const values = ticks.map(node => Number(node.getAttribute('data-tick-value')));
    expect(values.every(Number.isInteger)).toBe(true);
    const ascending = [...values].sort((a, b) => a - b);
    expect(ascending[0]).toBe(0);
    expect(new Set(values).size).toBe(values.length);
    expect(ticks.find(node => Number(node.getAttribute('data-tick-value')) === Math.max(...values))).toHaveTextContent('场');
    const grid = screen.getAllByTestId('cgrid') as unknown as SVGLineElement[];
    expect(grid.length).toBe(ticks.length);
    for (const line of grid) {
      expect(line.style.stroke).toBe('var(--chart-grid)');
      expect(line.getAttribute('stroke-dasharray')).toBeNull();
    }
    // 第 c 条网格线 = 底线 − c × 行距：与按钮的 top% 换算一致。
    const baseline = Number(grid.find(line => line.getAttribute('data-grid-value') === '0')!.getAttribute('y1'));
    const buttons = [...screen.getByTestId('plot').querySelectorAll<HTMLElement>('button[data-campaign-id]')];
    const pitch = Number.parseFloat(buttons[0].style.height);
    expect(pitch).toBeGreaterThanOrEqual(12);
    const step = Number(grid[0].getAttribute('data-grid-value')) === 0
      ? Number(grid[1].getAttribute('data-grid-value'))
      : Number(grid[0].getAttribute('data-grid-value'));
    const stepLine = grid.find(line => Number(line.getAttribute('data-grid-value')) === step)!;
    expect(baseline - Number(stepLine.getAttribute('y1'))).toBeCloseTo(step * pitch, 6);
  });

  it('重复渲染得到完全相同的位置', () => {
    const values = [-1.2, -1, -0.9, -0.5, 0, 0.3, 0.3, 1.1, 7];
    const { rerender } = renderStack(values);
    const read = () => [...screen.getByTestId('plot').querySelectorAll<HTMLElement>('button[data-campaign-id]')]
      .map(node => `${node.style.left}|${node.style.top}`);
    const first = read();
    rerender(
      <ScatterPlot
        points={makeStackPoints(values)}
        series={SERIES}
        yAxis={{ mode: 'count' }}
        xAxis={{ mode: 'linear', min: -2, max: 10 }}
        emptyMessage="暂无数据"
        testId="plot"
        scrollAreaTestId="scroll"
      />,
    );
    expect(read()).toEqual(first);
  });
});

describe('类目柱状（场数轴 + 类目横轴）', () => {
  function makeBarPoints(counts: Record<number, number>) {
    return Object.entries(counts).flatMap(([value, n]) =>
      Array.from({ length: n }, (_, index) => ({
        id: `b${value}-${index}`,
        x: Number(value),
        y: 0,
        seriesId: Number(value) > 0 ? 'profit' : Number(value) < 0 ? 'loss' : 'flat',
        valueText: `档 ${value}`,
        label: `战役 ${value}-${index}`,
        ariaLabel: `战役 ${value}-${index}`,
        dataAttrs: { 'data-campaign-id': `c${value}-${index}`, 'data-metric-value': Number(value) },
      })));
  }

  function renderBars(counts: Record<number, number>, categories: { value: number; label: string; sublabel?: string }[]) {
    return render(
      <ScatterPlot
        points={makeBarPoints(counts)}
        series={SERIES}
        yAxis={{ mode: 'count', tickTestId: 'btick', gridTestId: 'bgrid', unit: '场' }}
        xAxis={{ mode: 'category', categories }}
        emptyMessage="暂无数据"
        testId="bars"
        scrollAreaTestId="bars-scroll"
      />,
    );
  }

  const CATEGORIES = [
    { value: 0, label: '未实现', sublabel: '101 场' },
    { value: 1, label: '亏损', sublabel: '15 场' },
    { value: 2, label: '持平', sublabel: '0 场' },
    { value: 3, label: '盈利', sublabel: '105 场' },
  ];

  it('场数轴与类目横轴能搭配：所有点都画出来，不退回数值布局', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderBars({ 0: 101, 1: 15, 2: 0, 3: 105 }, CATEGORIES);
    const plot = screen.getByTestId('bars');
    expect(plot.querySelectorAll('button[data-campaign-id]')).toHaveLength(221);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  /**
   * 这条是柱状图的诚信条款：一行码 perRow 场时，刻度必须同比放大。
   * 若刻度还按「一行一场」派生，最高一档 105 场的柱子会顶穿一条只到四十几的轴，
   * 读者照着轴读出来的数就会差好几倍。
   */
  it('刻度按每行点数折算：最高一柱读得出的场数覆盖得住它真正的场数', () => {
    renderBars({ 0: 101, 1: 15, 2: 0, 3: 105 }, CATEGORIES);
    const ticks = [...screen.getAllByTestId('btick')].map(node => Number(node.dataset.tickValue));
    const top = Math.max(...ticks);
    expect(top).toBeGreaterThanOrEqual(100);
    expect(ticks).toContain(0);
    // 最高一柱的柱顶落在顶刻度之下：柱顶 top% 不会跑到绘图区外
    const tops = [...screen.getByTestId('bars').querySelectorAll<HTMLElement>('button[data-campaign-id]')]
      .map(node => Number.parseFloat(node.style.top));
    expect(Math.min(...tops)).toBeGreaterThanOrEqual(0);
  });

  // 柱脚那行字由调用方给（元件不自己数点），所以这里只验证「给什么画什么」
  it('柱脚写场数：给了 sublabel 就原样渲染', () => {
    renderBars({ 0: 3, 3: 2 }, CATEGORIES);
    expect(screen.getByTestId('chart-category-count-0')).toHaveTextContent('101 场');
    expect(screen.getByTestId('chart-category-count-2')).toHaveTextContent('0 场');
  });

  it('没有 sublabel 的类目轴不画柱脚数字', () => {
    renderBars({ 0: 3 }, CATEGORIES.map(({ value, label }) => ({ value, label })));
    expect(screen.queryByTestId('chart-category-count-0')).not.toBeInTheDocument();
  });
})
