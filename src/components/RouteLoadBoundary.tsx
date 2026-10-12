import { Component, Suspense, type ReactNode } from 'react';

/** The provider tree stays mounted while a route chunk downloads. */
export function RouteLoading() {
  return <div role="status" className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
    正在打开页面…
  </div>;
}

export class RouteLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert" className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <p>页面资源暂时未能加载，已有交易数据不会被清空。</p>
      <button type="button" className="rounded border border-border bg-card px-3 py-1.5 text-foreground" onClick={() => window.location.reload()}>重新加载页面</button>
    </div>;
    return <Suspense fallback={<RouteLoading />}>{this.props.children}</Suspense>;
  }
}
