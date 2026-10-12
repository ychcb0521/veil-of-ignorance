import { lazy } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RouteLoadBoundary } from '@/components/RouteLoadBoundary';

describe('route chunk loading boundary', () => {
  it('shows a lightweight status while a route downloads and replaces it with the route', async () => {
    let resolve!: (value: { default: () => JSX.Element }) => void;
    const page = new Promise<{ default: () => JSX.Element }>(done => { resolve = done; });
    const Page = lazy(() => page);
    render(<RouteLoadBoundary><Page /></RouteLoadBoundary>);
    expect(screen.getByRole('status')).toHaveTextContent('正在打开页面');
    resolve({ default: () => <div>战役列表</div> });
    await waitFor(() => expect(screen.getByText('战役列表')).toBeInTheDocument());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('offers an explicit retry rather than a blank screen when a route chunk fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const Page = lazy(async () => { throw new Error('chunk unavailable'); });
      render(<RouteLoadBoundary><Page /></RouteLoadBoundary>);
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('已有交易数据不会被清空'));
      expect(screen.getByRole('button', { name: '重新加载页面' })).toBeInTheDocument();
    } finally { log.mockRestore(); }
  });
});
