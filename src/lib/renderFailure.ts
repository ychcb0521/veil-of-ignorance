import { BUILD_STAMP } from '@/lib/buildStamp';

export interface RenderFailure {
  kind: 'resource' | 'runtime';
  message: string;
}
export interface RenderFailureRecord extends RenderFailure {
  id: string;
  at: string;
  build: string;
  scope: string;
  path: string;
  stack: string;
  componentStack: string;
}
export const RENDER_FAILURE_KEY = 'veil.render-failures.v1';
let recent: RenderFailureRecord[] = [];

/** A render exception is not automatically a failed deployment / missing JS chunk. */
export function describeRenderFailure(error: unknown): RenderFailure {
  const value = error as { name?: unknown; message?: unknown } | null;
  const message = (typeof value?.message === 'string' ? value.message : typeof error === 'string' ? error : '未知显示异常').slice(0, 1500);
  const name = typeof value?.name === 'string' ? value.name : '';
  return {
    kind: /ChunkLoadError|Loading (?:CSS )?chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|chunk unavailable/i.test(`${name}: ${message}`) ? 'resource' : 'runtime',
    message,
  };
}

/** Keep a small diagnostic trail in this tab; never read or clear trading / auth storage. */
export function recordRenderFailure(scope: string, error: unknown, componentStack = ''): RenderFailureRecord {
  const failure = describeRenderFailure(error), now = new Date();
  const record: RenderFailureRecord = {
    ...failure, id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: now.toISOString(), build: BUILD_STAMP, scope, path: typeof location === 'undefined' ? '' : location.pathname,
    stack: typeof (error as Error | null)?.stack === 'string' ? (error as Error).stack!.slice(0, 2000) : '',
    componentStack: componentStack.slice(0, 1500),
  };
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(RENDER_FAILURE_KEY) ?? '[]');
    if (Array.isArray(saved)) recent = saved.filter(item => item && typeof item.id === 'string').slice(-4);
  } catch { /* An unavailable / full diagnostic store must not cause another render failure. */ }
  recent = [...recent, record].slice(-5);
  try { sessionStorage.setItem(RENDER_FAILURE_KEY, JSON.stringify(recent)); } catch { /* The original error remains visible even with storage blocked. */ }
  console.error(`[无知之幕显示异常] ${scope} · ${record.id} · ${BUILD_STAMP}`, error, componentStack);
  return record;
}
