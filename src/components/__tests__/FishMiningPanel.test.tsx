import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishMiningPanel } from '@/components/FishMiningPanel';
import { DetectCategoryStats } from '@/components/DetectCategoryStats';
import { MINING_START_MS, MINING_STEP_MS, newMiningState, currentDefaultRules } from '@/lib/fish/mining';
afterEach(cleanup);
const api = (patch: object = {}, state: object = {}) => ({ state: { ...newMiningState(), ...state }, running: false, anchorMs: null, progress: null, waiting: '', start: vi.fn(), pause: vi.fn(), setTarget: vi.fn(), ...patch });

it('explains the plan, starts mining and edits the target', () => {
  const m = api(); render(<FishMiningPanel mining={m as never} sellFixed={false} campaignHref="/journal/campaigns?section=detect"/>);
  expect(screen.getByTestId('fish-mining-panel')).toHaveTextContent('从 2026-04-01 00:00 起每 12 小时一档');
  expect(screen.getByText(/CBI-2 > 0.04 · S avg₂ > 0.6 · CBA > 8 · az > 15 · BSS > 0.12/)).toBeVisible();
  expect(screen.getByText('已挖 0 / 1000 条 · 已扫 0 档')).toBeVisible();
  expect(screen.getByText(/还没固定卖出方案/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '开始挖掘' })); expect(m.start).toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('挖掘目标条数'), { target: { value: '2000' } }); fireEvent.blur(screen.getByLabelText('挖掘目标条数'));
  expect(m.setTarget).toHaveBeenCalledWith(2000);
  expect(screen.getByRole('link', { name: /在交易战役查看探测比较/ })).toHaveAttribute('href', '/journal/campaigns?section=detect');
});
it('shows the running anchor, reached target, caught-up and error states', () => {
  const rules = currentDefaultRules();
  const { rerender } = render(<FishMiningPanel mining={api({ running: true, anchorMs: MINING_START_MS, progress: { done: 12, total: 300 } }, { enabled: true, rules }) as never} sellFixed campaignHref="#"/>);
  expect(screen.getByRole('status')).toHaveTextContent('正在挖 2026-04-01 00:00 这一档（12 / 300 个标的）');
  expect(screen.getByRole('button', { name: '暂停' })).toBeVisible(); expect(screen.queryByText(/还没固定卖出方案/)).toBeNull();
  rerender(<FishMiningPanel mining={api({}, { enabled: true, rules, mined: 1000 }) as never} sellFixed campaignHref="#"/>);
  expect(screen.getByRole('status')).toHaveTextContent('已达目标');
  rerender(<FishMiningPanel mining={api({}, { enabled: true, rules, mined: 10, cursorMs: Date.now() + MINING_STEP_MS }) as never} sellFixed campaignHref="#"/>);
  expect(screen.getByRole('status')).toHaveTextContent('已追上现在');
  rerender(<FishMiningPanel mining={api({}, { enabled: true, rules, mined: 10, lastError: '网络中断' }) as never} sellFixed campaignHref="#"/>);
  expect(screen.getByRole('status')).toHaveTextContent('出错：网络中断');
  rerender(<FishMiningPanel mining={api({}, { enabled: false, rules, anchorsDone: 3 }) as never} sellFixed campaignHref="#"/>);
  expect(screen.getByRole('button', { name: '继续挖掘' })).toBeVisible();
});
it('summarises detect categories, sorts any column and filters by clicking a category', () => {
  const c = (category: string, pnl: number | null, n = 1) => ({ campaign: { closed_at: pnl == null ? null : 'x', final_realized_pnl: pnl, comparison: { category, detectors: Array(n).fill({ id: 'd', label: 'd' }) } } as never });
  const onSelect = vi.fn();
  render(<DetectCategoryStats rows={[c('CBI-2·avg₂', 5), c('CBI-2·avg₂', -1), c('CBI-2·avg₂ + BSS·avg₂', 9, 2), c('BSS·avg₂', null)]} active="" onSelect={onSelect}/>);
  const names = () => within(screen.getByTestId('detect-category-stats')).getAllByRole('button', { pressed: false }).map(b => b.textContent);
  expect(names()[0]).toBe('CBI-2·avg₂'); // 默认按场数
  fireEvent.click(screen.getByRole('button', { name: '按平均收益排序' })); expect(names()).toEqual(['CBI-2·avg₂ + BSS·avg₂', 'CBI-2·avg₂', 'BSS·avg₂']); // 没卖出的在最后
  fireEvent.click(screen.getByRole('button', { name: 'CBI-2·avg₂ + BSS·avg₂' })); expect(onSelect).toHaveBeenCalledWith('CBI-2·avg₂ + BSS·avg₂');
  expect(screen.getByTestId('detect-category-stats')).toHaveTextContent('+2.00%'); // CBI-2 单独：(5 − 1) / 2
});
