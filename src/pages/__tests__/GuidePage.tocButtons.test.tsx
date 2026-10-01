import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuidePage from '../GuidePage';

describe('【用户要求】使用说明目录：悬停不在左下角弹网址', () => {
  it('目录项是按钮、没有 href；点了把对应章节滚到视野里', () => {
    // jsdom 没有 IntersectionObserver（页面用它追当前章节）：给个不触发的桩
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<MemoryRouter initialEntries={['/guide']}><GuidePage /></MemoryRouter>);
    const toc = screen.getAllByRole('navigation').find(nav => nav.classList.contains('guide-toc'))!;
    expect(toc.querySelectorAll('a[href]')).toHaveLength(0);
    const item = within(toc).getByRole('button', { name: '3.1 交易模式与持仓限制' });
    fireEvent.click(item);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('s3-0'));
  });
});
