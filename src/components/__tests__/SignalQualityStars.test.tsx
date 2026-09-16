// @vitest-environment jsdom
/**
 * 五星评分组件本身：点击语义不变，而且在信号库的体量下足够便宜——
 *   · 五颗星共用一个恒定的点击处理器，重渲染也不换身份（791 行 × 5 颗星，每次各造一个闭包是白花的）；
 *   · 整组 memo：props 没变就不重画五颗星；
 *   · 处理器恒定但不陈旧：父组件换了 onChange，点下去调的是最新那一个。
 */
import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SignalQualityStars } from '../SignalQualityStars';

// 每画一颗星就记一次：拿它当「这组星重渲染了没有」的探针。
const starRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('lucide-react', async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return {
    ...actual,
    Star: (props: Record<string, unknown>) => {
      starRenders.count += 1;
      return createElement('svg', { className: props.className as string });
    },
  };
});

/** React 18 把当前 props 挂在 DOM 节点的 `__reactProps$<随机串>` 上；拿它读出按钮上真正挂的 onClick。 */
function clickHandlerOf(node: HTMLElement): unknown {
  const key = Object.keys(node).find(k => k.startsWith('__reactProps$'));
  expect(key).toBeDefined();
  return (node as unknown as Record<string, { onClick?: unknown }>)[key as string].onClick;
}

const stars = (id: string) => [1, 2, 3, 4, 5].map(n => screen.getByTestId(`signal-quality-${id}-${n}`));

beforeEach(() => { starRenders.count = 0; });

describe('SignalQualityStars', () => {
  it('点第 N 颗星回调 N，且不冒泡到外层（外层是跳转按钮的兄弟，也不该被连带触发）', () => {
    const onChange = vi.fn();
    const outer = vi.fn();
    render(
      <div onClick={outer}>
        <SignalQualityStars signalId="s1" value={2} onChange={onChange} />
      </div>,
    );
    fireEvent.click(screen.getByTestId('signal-quality-s1-4'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(4);
    expect(outer).not.toHaveBeenCalled();

    // 当前星数那一颗的文案与选中态照旧
    const current = screen.getByTestId('signal-quality-s1-2');
    expect(current).toHaveAttribute('aria-checked', 'true');
    expect(current).toHaveAttribute('title', '再点一次取消评分');
    expect(current).toHaveAttribute('aria-label', '2 星');
    expect(screen.getByTestId('signal-quality-s1-5')).toHaveAttribute('title', '评 5 星');
  });

  it('五颗星共用同一个点击处理器，重渲染（哪怕换了 onChange）也不换身份', () => {
    const first = vi.fn();
    const { rerender } = render(<SignalQualityStars signalId="s1" value={3} onChange={first} />);
    const handlers = stars('s1').map(clickHandlerOf);
    expect(typeof handlers[0]).toBe('function');
    expect(new Set(handlers).size).toBe(1);

    const second = vi.fn();
    rerender(<SignalQualityStars signalId="s1" value={4} onChange={second} />);
    expect(stars('s1').map(clickHandlerOf)).toEqual(handlers);
    for (const h of stars('s1').map(clickHandlerOf)) expect(h).toBe(handlers[0]);

    // 身份恒定，但调的是最新的 onChange
    fireEvent.click(screen.getByTestId('signal-quality-s1-1'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(1);
  });

  it('props 没变就不重画；分数变了才重画那五颗', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SignalQualityStars signalId="s1" value={3} onChange={onChange} />);
    expect(starRenders.count).toBe(5);

    starRenders.count = 0;
    rerender(<SignalQualityStars signalId="s1" value={3} onChange={onChange} />);
    expect(starRenders.count).toBe(0);

    rerender(<SignalQualityStars signalId="s1" value={5} onChange={onChange} />);
    expect(starRenders.count).toBe(5);
    expect(screen.getByTestId('signal-quality-s1-5')).toHaveAttribute('aria-checked', 'true');
  });
});
