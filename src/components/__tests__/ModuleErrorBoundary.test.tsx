import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ModuleErrorBoundary } from '@/components/ModuleErrorBoundary';
import { RENDER_FAILURE_KEY } from '@/lib/renderFailure';
import { BUILD_STAMP } from '@/lib/buildStamp';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); sessionStorage.clear(); });
it('keeps the task owner and its progress alive through a display failure and local recovery', () => {
  vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => {});
  const stop = vi.fn(), start = vi.fn();
  let fail = false;
  function Display({ done }: { done: number }) { if (fail) throw new Error('Maximum update depth exceeded'); return <p>结果 {done}</p>; }
  function Owner() {
    const [done, setDone] = useState(0);
    useEffect(() => { start(); const timer = setInterval(() => setDone(n => n + 1), 100); return () => { clearInterval(timer); stop(); }; }, []);
    return <><span data-testid="background-progress">{done}</span><ModuleErrorBoundary label="鱼质量" backgroundTasks><Display done={done}/></ModuleErrorBoundary></>;
  }
  render(<Owner/>); fail = true;
  act(() => { vi.advanceTimersByTime(100); });
  expect(screen.getByRole('alert')).toHaveTextContent('已启动的后台任务继续运行');
  expect(screen.getByRole('alert')).not.toHaveTextContent('资源未能加载');
  expect(screen.queryByRole('button', { name: '重新加载页面' })).toBeNull();
  act(() => { vi.advanceTimersByTime(300); });
  expect(screen.getByTestId('background-progress')).toHaveTextContent('4'); expect(stop).not.toHaveBeenCalled();
  const saved = JSON.parse(sessionStorage.getItem(RENDER_FAILURE_KEY)!);
  expect(saved.at(-1)).toEqual(expect.objectContaining({ scope: '鱼质量', build: BUILD_STAMP, kind: 'runtime', message: 'Maximum update depth exceeded' }));
  fail = false; fireEvent.click(screen.getByRole('button', { name: '恢复鱼质量显示' }));
  expect(screen.getByText('结果 4')).toBeVisible(); expect(start).toHaveBeenCalledTimes(1); expect(stop).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(100); }); expect(screen.getByText('结果 5')).toBeVisible();
});

it('continues to show the original error when diagnostic storage is blocked and records only a bounded history', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  sessionStorage.setItem(RENDER_FAILURE_KEY, JSON.stringify(Array.from({ length: 8 }, (_, i) => ({ id: String(i) }))));
  function Broken(): never { throw new Error('原始异常'); }
  const view = render(<ModuleErrorBoundary label="测试"><Broken/></ModuleErrorBoundary>);
  expect(JSON.parse(sessionStorage.getItem(RENDER_FAILURE_KEY)!)).toHaveLength(5);
  view.unmount();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  render(<ModuleErrorBoundary label="测试"><Broken/></ModuleErrorBoundary>);
  fireEvent.click(screen.getByText('查看异常详情')); expect(screen.getByRole('alert')).toHaveTextContent('原始异常');
});
