import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishMiningPanel } from '@/components/FishMiningPanel';
import { DetectCategoryStats } from '@/components/DetectCategoryStats';
import { MINING_START_MS, MINING_STEP_MS, newMiningState, currentDefaultRules } from '@/lib/fish/mining';
afterEach(cleanup);
const api = (patch: object = {}, state: object = {}) => ({ state: { ...newMiningState(), ...state }, running: false, anchorMs: null, progress: null, waiting: '', start: vi.fn(), pause: vi.fn(), setTarget: vi.fn(), ...patch });

it('explains the plan, starts mining and edits the target', () => {
  const m = api(); render(<FishMiningPanel mining={m as never} sellFixed={false} campaignHref="/journal/campaigns?section=detect"/>);
  expect(screen.queryByText(/从 2026-04-01/)).toBeNull();
  expect(screen.queryByText(/还没固定卖出方案/)).toBeNull();
  expect(screen.queryByText('0 / 1000')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '开始挖掘' })); expect(m.start).toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('挖掘目标条数'), { target: { value: '2000' } }); fireEvent.blur(screen.getByLabelText('挖掘目标条数'));
  expect(m.setTarget).toHaveBeenCalledWith(2000);
  fireEvent.click(screen.getByRole('button', { name: '挖掘说明与进度' }));
  expect(screen.getByRole('dialog', { name: '挖掘说明与进度' })).toBeVisible();
  expect(screen.getByText('从 2026-04-01 00:00 起每 12 小时一档')).toBeVisible();
  expect(screen.getByText(/CBI-2 avg > 0.04 · S avg > 0.6 · CBA avg > 8 · az avg > 0.15 · BSS avg > 0.12/)).toBeVisible();
  expect(screen.getByText('已挖 0 / 1000 条 · 已扫 0 档')).toBeVisible();
  expect(screen.getByText(/还没固定卖出方案/)).toBeVisible();
  expect(screen.getByRole('link', { name: /在交易战役查看/ })).toHaveAttribute('href', '/journal/campaigns?section=detect');
});
it('shows the running anchor, reached target, caught-up and error states', () => {
  const rules = currentDefaultRules();
  const { rerender } = render(<FishMiningPanel mining={api({ running: true, anchorMs: MINING_START_MS, progress: { done: 12, total: 300 } }, { enabled: true, rules }) as never} sellFixed campaignHref="#"/>);
  expect(screen.getByRole('status')).toHaveTextContent('挖掘中');expect(screen.getByRole('status')).toHaveTextContent('12/300');
  expect(screen.getByLabelText('本档已扫 12 / 300 个标的')).toBeVisible();
  expect(screen.getByRole('status')).toHaveAccessibleName('正在挖 2026-04-01 00:00 这一档（12 / 300 个标的）');
  expect(screen.getByRole('button', { name: '暂停' })).toBeVisible(); expect(screen.queryByText(/还没固定卖出方案/)).toBeNull();
  rerender(<FishMiningPanel mining={api({}, { enabled: true, rules, mined: 1001 }) as never} sellFixed campaignHref="#"/>);
  expect(screen.getByRole('status')).toHaveTextContent('已达目标');
  fireEvent.click(screen.getByRole('button', { name: '挖掘说明与进度' }));
  expect(screen.getAllByText('已达目标：调高目标可继续往后挖')[0]).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '挖掘说明与进度' }));
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1000');
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '已挖 1001 条，目标 1000 条');
  rerender(<FishMiningPanel mining={api({}, { enabled: true, rules, mined: 10, cursorMs: Date.now() + MINING_STEP_MS }) as never} sellFixed campaignHref="#"/>);
  expect(screen.getByRole('status')).toHaveTextContent('已追上现在');
  rerender(<FishMiningPanel mining={api({}, { enabled: true, rules, mined: 10, lastError: '网络中断' }) as never} sellFixed campaignHref="#"/>);
  expect(screen.getByRole('status')).toHaveTextContent('等待重试');
  expect(screen.getByRole('status')).toHaveAccessibleName('出错：网络中断（2 分钟后原地重试）');
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

it('shows the cause, retry time and actions directly, and exposes configuration recovery without resetting progress',()=>{
 const retry=vi.fn(),scope=vi.fn(),m=api({retry,useCurrentScope:scope},{enabled:true,anchorsDone:93,mined:220,rules:currentDefaultRules(),lastError:'请求超时',lastErrorAt:Date.now()-1000,retryAt:Date.now()+120000,retryCount:2,errorKind:'transient'});
 const h=render(<FishMiningPanel mining={m as never} sellFixed campaignHref="#"/>);
 expect(screen.getByRole('status')).toHaveTextContent('请求超时');expect(screen.getByRole('status')).toHaveTextContent('220/1000');expect(screen.getByRole('status')).toHaveTextContent('连续失败 2 次');
 fireEvent.click(screen.getByRole('button',{name:'立即重试'}));expect(retry).toHaveBeenCalledOnce();
 h.rerender(<FishMiningPanel mining={{...m,state:{...m.state,errorKind:'configuration',retryAt:null,lastError:'算法不存在'}} as never} sellFixed campaignHref="#"/>);
 expect(screen.getByRole('status')).toHaveTextContent('配置需处理');expect(screen.getByRole('status')).not.toHaveTextContent('秒后');
 expect(screen.getByRole('link',{name:'检查算法定义'})).toHaveAttribute('href','/journal/deep-dig');
 fireEvent.click(screen.getByRole('button',{name:'更新为当前捕捞范围'}));expect(scope).toHaveBeenCalledOnce();expect(screen.getByRole('button',{name:'重新检查'})).toBeVisible();
});

it('lets an invalid saved statistic be repaired locally and explicitly resumed without clearing progress',()=>{
 const configure=vi.fn(),m=api({configure,ruleChoices:[{featureId:'drift-speed-z',label:'az',statistics:[{name:'结果',label:'结果 · avg_a_2'},{name:'avg_a',label:'avg_a'}]}]},{mined:220,anchorsDone:93,rules:[{id:'az',featureId:'drift-speed-z',statistic:'avg_az',threshold:'0.15'}],lastError:'统计量已不存在',errorKind:'configuration'});
 render(<FishMiningPanel mining={m as never} sellFixed campaignHref="#"/>);fireEvent.click(screen.getByRole('button',{name:'挖掘条件'}));
 expect(screen.getByRole('option',{name:'avg_az（已失效）'})).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('挖掘算法 1 统计量'),{target:{value:'avg_a'}});fireEvent.click(screen.getByRole('button',{name:'保存并重试'}));
 expect(configure).toHaveBeenCalledWith([{id:'az',featureId:'drift-speed-z',statistic:'avg_a',threshold:'0.15'}]);expect(m.state.mined).toBe(220);
});
