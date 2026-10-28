import { Suspense, type ReactNode } from 'react';
import { ModuleErrorBoundary } from '@/components/ModuleErrorBoundary';

/** The provider tree stays mounted while a route chunk downloads. */
export function RouteLoading() {
  return <div role="status" className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
    正在打开页面…
  </div>;
}

export function RouteLoadBoundary({ children }: { children: ReactNode }) {
  return <ModuleErrorBoundary label="页面" page><Suspense fallback={<RouteLoading />}>{children}</Suspense></ModuleErrorBoundary>;
}
