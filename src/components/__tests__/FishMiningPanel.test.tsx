import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FishMiningPanel } from '@/components/FishMiningPanel';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
import { fishFeatureDefinitions } from '@/lib/fish/features';
import { FISH_HIT_RATE_SETTINGS_KEY, type FishHitRateSettings } from '@/lib/fish/hitRateSettings';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { initialMiningSettings, readMiningSettings } from '@/lib/fish/miningSettings';
import { DetectCategoryStats } from '@/components/DetectCategoryStats';
import { MINING_START_MS, MINING_STEP_MS, newMiningState, currentDefaultRules } from '@/lib/fish/mining';
const hydrate = vi.hoisted(() => vi.fn<typeof import('@/lib/simStateSync').hydrateSimState>());
vi.mock('@/lib/simStateSync', async original => ({
  ...await original<typeof import('@/lib/simStateSync')>(),
  hydrateSimState: hydrate,
}));
beforeEach(() => { localStorage.clear(); hydrate.mockReset(); });
afterEach(cleanup);
const api = (patch: object = {}, state: object = {}) => ({ state: { ...newMiningState(), ...state }, running: false, anchorMs: null, progress: null, waiting: '', start: vi.fn(), pause: vi.fn(), stop: vi.fn(), setTarget: vi.fn(), defs: fishFeatureDefinitions(BUILTIN_FEATURES), captureSelection: { exchanges: ['binance'], includeDuplicates: false }, ...patch });

it('opens with the last saved profile after hydration and preserves a draft through mining progress', async () => {
  const account = 'mining-settings-owner';
  const m = api({ account });
  const saved = initialMiningSettings({ ...m.state, target: 50 }, { exchanges: ['binance'], includeDuplicates: false });
  saved.scan.lookbackHours = 1;
  saved.rules[0].threshold = '0.05';
  let finish!: () => void;
  hydrate.mockImplementationOnce(() => new Promise(resolve => {
    finish = () => {
      localStorage.setItem(getUserPrefix(account) + 'fish-mining-settings.v1', JSON.stringify(saved));
      resolve({ status: 'hydrated', applied: 1 });
    };
  }));
  const view = render(<FishMiningPanel mining={m as never} sellFixed campaignHref="#"/>);
  fireEvent.click(screen.getByRole('button', { name: '批量捕捞设置' }));
  const form = within(screen.getByRole('dialog'));
  expect(form.getByRole('status')).toHaveTextContent('正在读取上次保存的批量捕捞设置');
  expect(form.queryByLabelText('批量捕捞目标条数')).toBeNull();
  expect(hydrate).toHaveBeenCalledWith(account, ['fish-mining-settings.v1'], expect.any(AbortSignal));
  await act(async () => finish());
  expect(form.getByLabelText('批量捕捞目标条数')).toHaveValue(50);
  expect(form.getByLabelText('每档回看（小时）')).toHaveValue(1);
  expect(form.getByLabelText('批量捕捞算法 1 门槛')).toHaveValue(0.05);

  fireEvent.change(form.getByLabelText('批量捕捞目标条数'), { target: { value: '65' } });
  view.rerender(<FishMiningPanel mining={{ ...m, state: { ...m.state, target: 50, mined: 3 } } as never} sellFixed campaignHref="#"/>);
  expect(form.getByLabelText('批量捕捞目标条数')).toHaveValue(65);
  expect(readMiningSettings(account)?.target).toBe(50);
  fireEvent.click(form.getByRole('button', { name: '取消' }));

  hydrate.mockResolvedValueOnce({ status: 'error', applied: 0 });
  fireEvent.click(screen.getByRole('button', { name: '批量捕捞设置' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('无法读取账号的批量捕捞设置');
  expect(screen.queryByLabelText('批量捕捞目标条数')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '使用本机已保存设置' }));
  expect(screen.getByLabelText('批量捕捞目标条数')).toHaveValue(50);
});

it('saves both interval bounds and rejects a reversed interval at the editor',()=>{
 const base={id:'range',featureId:'cbi2',statistic:'结果',threshold:'0.04'};
 const m=api({ruleChoices:[{featureId:'cbi2',label:'CBI-2',statistics:[{name:'结果',label:'结果'}]}]},{rules:[base]});
 render(<FishMiningPanel mining={m as never} sellFixed campaignHref="#"/>);
 fireEvent.click(screen.getByRole('button',{name:'批量捕捞设置'}));
 const change=(name:string,value:string)=>fireEvent.change(screen.getByLabelText('批量捕捞算法 1 '+name),{target:{value}});
 change('上限','0.01');
 fireEvent.click(screen.getByRole('button',{name:'保存设置'}));
 expect(screen.getByRole('alert')).toHaveTextContent('下限不能大于上限');
 expect(readMiningSettings()).toBeNull();
 change('下限','0');
 change('上限','0.08');
 fireEvent.click(screen.getByRole('button',{name:'保存设置'}));
 expect(readMiningSettings()?.rules[0].threshold).toBe('[0,0.08]');
 fireEvent.click(screen.getByRole('button',{name:'批量捕捞设置'}));
 expect(screen.getByLabelText('批量捕捞算法 1 上限')).toHaveValue(0.08);
});

it('adds restored DSP·a as a selectable mining algorithm without replacing existing rules',()=>{
 const base={id:'base',featureId:'cbi2',statistic:'avg_CBI2_2',threshold:'0.04'};
 const m=api({ruleChoices:[{featureId:'cbi2',label:'CBI-2',statistics:[{name:'结果',label:'结果'},{name:'avg_CBI2_2',label:'avg₂'}]},
  {featureId:'drift-speed',label:'DSP·a',statistics:['结果','a','avg_a','avg_a_2'].map(name=>({name,label:name}))}]},{rules:[base],mined:220,anchorsDone:93});
 render(<FishMiningPanel mining={m as never} sellFixed campaignHref="#"/>);
 fireEvent.click(screen.getByRole('button',{name:'批量捕捞设置'}));fireEvent.click(screen.getByRole('button',{name:'新增批量捕捞算法'}));
 fireEvent.change(screen.getByLabelText('批量捕捞算法 2 特征值'),{target:{value:'drift-speed'}});
 expect(screen.getByLabelText('批量捕捞算法 2 统计量')).toHaveValue('结果');
 for(const name of ['a','avg_a','avg_a_2'])expect(within(screen.getByLabelText('批量捕捞算法 2 统计量')).getByRole('option',{name})).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('批量捕捞算法 2 统计量'),{target:{value:'avg_a_2'}});
 fireEvent.click(screen.getByRole('button',{name:'保存设置'}));
 expect(screen.getByRole('alert')).toHaveTextContent('填写有限数字门槛');
 fireEvent.change(screen.getByLabelText('批量捕捞算法 2 门槛'),{target:{value:'0.003'}});
 expect(screen.getByLabelText('批量捕捞算法 1 门槛')).toHaveValue(0.04);
 fireEvent.click(screen.getByRole('button',{name:'取消'}));
 expect(readMiningSettings()).toBeNull();
 expect(m.state.mined).toBe(220);expect(m.state.anchorsDone).toBe(93);
});

it('explains the plan, starts mining and keeps the library next to settings', () => {
  const m = api(); render(<FishMiningPanel mining={m as never} sellFixed={false} campaignHref="/journal/campaigns?section=detect"/>);
  expect(screen.queryByText(/从 2026-04-01/)).toBeNull();
  expect(screen.queryByText(/还没固定卖出方案/)).toBeNull();
  expect(screen.queryByText('0 / 1000')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  const controls=screen.getByTestId('fish-mining-panel');
  expect(within(controls).getAllByRole('button').map(b=>b.getAttribute('aria-label')??b.textContent).filter(name=>['开始批量捕捞','开始批量捕捞的其他方式','本轮条件','批量捕捞设置','打开捕捞库','重新开始'].includes(name!))).toEqual(['开始批量捕捞','开始批量捕捞的其他方式','批量捕捞设置','打开捕捞库']);
  fireEvent.click(screen.getByRole('button', { name: '开始批量捕捞' })); expect(m.start).toHaveBeenCalled();
  expect(screen.queryByLabelText('批量捕捞目标条数')).toBeNull();
  expect(screen.queryByRole('button', { name: '本轮条件' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '批量捕捞说明与进度' }));
  expect(screen.getByRole('dialog', { name: '批量捕捞说明与进度' })).toBeVisible();
  expect(screen.getByText('从 2026-04-01 00:00 起，每 12 小时一档。')).toBeVisible();
  expect(screen.getByText(/CBI-2 avg₂ > 0.04 · CBA avg₂ > 8 · CBI-2 avg > 0.04 · CBA avg > 8/)).toBeVisible();
  expect(screen.getByText('已捕捞 0 / 1000 条 · 已扫 0 档')).toBeVisible();
  expect(screen.getByText(/还没固定卖出方案/)).toBeVisible();
  expect(screen.getByRole('link', { name: /在交易战役查看/ })).toHaveAttribute('href', '/journal/campaigns?section=detect');
});
it('shows the running anchor, reached target, caught-up and error states', () => {
  const rules = currentDefaultRules();
  const anchorMs = MINING_START_MS + MINING_STEP_MS + 15_000;
  const state = { enabled: true, rules, target: 50, mined: 27, anchorsDone: 1, cursorMs: anchorMs,
    lastAnchorMs: MINING_START_MS, endMs: MINING_START_MS + 3 * MINING_STEP_MS };
  const { rerender } = render(<FishMiningPanel mining={api({ running: true, anchorMs, progress: { done: 12, total: 300 } }, state) as never} sellFixed campaignHref="#"/>);
  expect(screen.getByRole('status')).toHaveTextContent('捕捞中27/50');
  expect(screen.queryByText('正在扫')).toBeNull();
  expect(screen.queryByText(/04-01 12:00:15/)).toBeNull();
  expect(screen.queryByText('12/300')).toBeNull();
  expect(screen.getByRole('button', { name: '暂停' })).toBeVisible(); expect(screen.queryByText(/还没固定卖出方案/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '批量捕捞设置' }));
  const progress = within(screen.getByRole('region', { name: '本轮捕捞进度' }));
  expect(progress.getByText('12/300')).toBeVisible();
  expect(within(progress.getByText('正在扫').parentElement!).getByText('2026-04-01 12:00:15')).toHaveAttribute('dateTime', '2026-04-01T04:00:15.000Z');
  expect(progress.getByText('已扫至').parentElement).toHaveTextContent('2026-04-01 00:00');
  expect(progress.getByText('扫描结束').parentElement).toHaveTextContent('2026-04-02 12:00');
  expect(progress.queryByText('下一档')).toBeNull();
  rerender(<FishMiningPanel mining={api({}, { ...state, enabled: false, mined: 53, anchorsDone: 2,
    cursorMs: anchorMs + MINING_STEP_MS, lastAnchorMs: anchorMs }) as never} sellFixed campaignHref="#"/>);
  expect(progress.getByText('已扫至').parentElement).toHaveTextContent('2026-04-01 12:00:15');
  expect(progress.queryByText('正在扫')).toBeNull();
  expect(progress.queryByText('下一档')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.getByRole('status')).toHaveTextContent('已达目标53/50');
  expect(screen.queryByText('已扫至')).toBeNull();
  expect(screen.queryByText(/04-01 12:00:15/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '批量捕捞说明与进度' }));
  expect(screen.getAllByText('已达目标，本轮已停止。提高目标后可从下一档继续。')[0]).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '批量捕捞说明与进度' }));
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '已捕捞 53 条，目标 50 条');
  rerender(<FishMiningPanel mining={api({}, { enabled: true, rules, mined: 10, cursorMs: Date.now() + MINING_STEP_MS }) as never} sellFixed campaignHref="#"/>);
  expect(screen.getByRole('status')).toHaveTextContent('已追上现在');
  rerender(<FishMiningPanel mining={api({}, { enabled: true, rules, mined: 10, lastError: '网络中断' }) as never} sellFixed campaignHref="#"/>);
  expect(screen.getByRole('status')).toHaveTextContent('等待重试');
  expect(screen.getByRole('status')).toHaveAccessibleName('出错：网络中断（2 分钟后原地重试）');
  rerender(<FishMiningPanel mining={api({}, { enabled: false, rules, anchorsDone: 3 }) as never} sellFixed campaignHref="#"/>);
  expect(screen.getByRole('button', { name: '继续批量捕捞' })).toBeVisible();
});
it('lets the user stop a reached round in the toolbar and opens a new round only on request', () => {
  const cursor = Date.parse('2026-04-02T12:00:00+08:00');
  const mining = api({}, {enabled:true, mined:105, target:100, anchorsDone:7, cursorMs:cursor});
  const view = render(<FishMiningPanel mining={mining as never} sellFixed campaignHref="#"/>);
  fireEvent.click(screen.getByRole('button', {name:'停止本轮'}));
  expect(mining.stop).toHaveBeenCalledOnce();
  expect(mining.start).not.toHaveBeenCalled();
  view.rerender(<FishMiningPanel mining={{...mining,state:{...mining.state,stopped:true,enabled:false}} as never} sellFixed campaignHref="#"/>);
  expect(screen.getByRole('status')).toHaveTextContent('已停止105/100');
  expect(screen.queryByRole('button', {name:'继续批量捕捞'})).toBeNull();
  fireEvent.click(screen.getByRole('button', {name:'开始新一轮'}));
  const dialog = within(screen.getByRole('dialog', {name:'重新开始批量捕捞'}));
  expect(dialog.getByLabelText('扫描起点（北京时间）')).toHaveValue('2026-04-02T12:00');
  fireEvent.click(dialog.getByRole('button', {name:'取消'}));
  expect(mining.start).not.toHaveBeenCalled();
});
it('shows a target stop even if the saved run was enabled and allows adding to the same round',()=>{
  const m=api({}, {enabled:true,rules:currentDefaultRules(),target:100,mined:106,anchorsDone:13,
    lastAnchorMs:MINING_START_MS+12*3_600_000,cursorMs:MINING_START_MS+13*3_600_000,endMs:MINING_START_MS+9*MINING_STEP_MS});
  render(<FishMiningPanel mining={m as never} sellFixed campaignHref="#"/>);
  expect(screen.queryByRole('button',{name:'暂停'})).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('已达目标106/100');
  fireEvent.click(screen.getByRole('button',{name:'批量捕捞设置'}));
  const progress=within(screen.getByRole('region',{name:'本轮捕捞进度'}));
  expect(progress.getByText(/已达到本轮目标并停止/)).toBeVisible();
  const resume=progress.getByRole('button',{name:'提高目标并继续'});
  expect(resume).toBeDisabled();
  fireEvent.change(progress.getByLabelText('本轮新目标'),{target:{value:'200'}});
  fireEvent.click(resume);
  expect(m.setTarget).toHaveBeenCalledWith(200);
  expect(m.start).toHaveBeenCalledOnce();
});

it('does not display a cancelled anchor or a pending anchor as completed', () => {
  const startMs = MINING_START_MS + MINING_STEP_MS;
  const mining = api({ running: true, anchorMs: MINING_START_MS, progress: { done: 29, total: 30 } },
    { enabled: true, startMs, cursorMs: startMs, round: { id: 'new-round', startedAt: Date.now() } });
  render(<FishMiningPanel mining={mining as never} sellFixed campaignHref="#"/>);
  expect(screen.getByRole('status')).toHaveTextContent('排队中');
  expect(screen.queryByText('04-01 00:00')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '批量捕捞设置' }));
  const progress = within(screen.getByRole('region', { name: '本轮捕捞进度' }));
  expect(progress.getByText('尚未完成首档')).toBeVisible();
  expect(progress.getByText('下一档').parentElement).toHaveTextContent('2026-04-01 12:00');
  expect(progress.queryByText('29/30')).toBeNull();
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
 expect(screen.getByRole('status')).toHaveAccessibleName(expect.stringContaining('请求超时'));expect(screen.getByRole('status')).toHaveTextContent('220/1000');expect(screen.getByRole('status')).not.toHaveTextContent('连续失败 2 次');fireEvent.click(screen.getByRole('button',{name:'批量捕捞说明与进度'}));expect(screen.getByRole('dialog',{name:'批量捕捞说明与进度'})).toHaveTextContent('连续失败 2 次');fireEvent.click(screen.getByRole('button',{name:'批量捕捞说明与进度'}));
 fireEvent.click(screen.getByRole('button',{name:'立即重试'}));expect(retry).toHaveBeenCalledOnce();
 h.rerender(<FishMiningPanel mining={{...m,state:{...m.state,errorKind:'configuration',retryAt:null,lastError:'算法不存在'}} as never} sellFixed campaignHref="#"/>);
 expect(screen.getByRole('status')).toHaveTextContent('配置需处理');expect(screen.getByRole('status')).not.toHaveTextContent('秒后');
 expect(screen.getByRole('link',{name:'检查算法定义'})).toHaveAttribute('href','/journal/deep-dig');
 fireEvent.click(screen.getByRole('button',{name:'更新为当前捕捞范围'}));expect(scope).toHaveBeenCalledOnce();expect(screen.getByRole('button',{name:'重新检查'})).toBeVisible();
});

it('edits a new round while a scan is running and waits for explicit confirmation', () => {
  const restart = vi.fn();
  const rules = [currentDefaultRules()[0]];
  const m = api({ running: true, restart, ruleChoices: [
    { featureId: 'cbi2', label: 'CBI-2', statistics: [{ name: rules[0].statistic, label: 'avg₂' }] },
    { featureId: 'cba', label: 'CBA', statistics: [{ name: '结果', label: '结果' }] },
  ] }, { enabled: true, rules });
  render(<FishMiningPanel mining={m as never} sellFixed campaignHref="#"/>);
  const open = () => {fireEvent.click(screen.getByRole('button', { name: '开始批量捕捞的其他方式' }));fireEvent.click(screen.getByRole('button', { name: '重新开始' }));};
  expect(screen.queryByRole('button',{name:'重新开始'})).not.toBeInTheDocument();
  open();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(restart).not.toHaveBeenCalled();
  expect(m.pause).not.toHaveBeenCalled();

  open();
  const form = within(screen.getByRole('dialog', { name: '重新开始批量捕捞' }));
  const date = form.getByLabelText('扫描起点（北京时间）');
  const submit = form.getByRole('button', { name: '开始新一轮' });
  fireEvent.change(date, { target: { value: '' } });
  fireEvent.click(submit);
  expect(form.getByRole('alert')).toHaveTextContent('扫描起点');
  expect(restart).not.toHaveBeenCalled();

  fireEvent.change(date, { target: { value: '2026-01-15T07:30' } });
  const end=form.getByLabelText('扫描结束（北京时间）');
  fireEvent.change(end,{target:{value:''}});fireEvent.click(submit);expect(restart).not.toHaveBeenCalled();expect(form.getByRole('alert')).toHaveTextContent('扫描结束');
  fireEvent.change(end,{target:{value:'2026-01-14T07:30'}});fireEvent.click(submit);expect(restart).not.toHaveBeenCalled();
  fireEvent.change(end,{target:{value:'2026-01-16T07:30'}});
  fireEvent.change(form.getByLabelText('批量捕捞目标条数'), { target: { value: '80' } });
  fireEvent.change(form.getByLabelText('批量捕捞算法 1 特征值'), { target: { value: 'cba' } });
  fireEvent.change(form.getByLabelText('批量捕捞算法 1 门槛'), { target: { value: '9' } });
  fireEvent.click(submit);
  expect(restart).toHaveBeenCalledWith({
    startMs: Date.parse('2026-01-15T07:30:00+08:00'), endMs:Date.parse('2026-01-16T07:30:00+08:00'), target: 80,
    rules: [{ ...rules[0], featureId: 'cba', statistic: '结果', threshold: '9' }],
    settings: expect.objectContaining({ target: 80 }),
  });
});

it('copies capture scope into a new round while keeping the historical round frozen', () => {
  const mining = api({ captureSelection: { exchanges: ['binance', 'okx'], includeUsStocks: true, includeDuplicates: true } }, {
    selection: { exchanges: ['gate'], includeDuplicates: false },
    stepMs: MINING_STEP_MS * 2,
  });
  render(<FishMiningPanel mining={mining as never} sellFixed campaignHref="#" />);
  fireEvent.click(screen.getByRole('button', { name: '开始批量捕捞的其他方式' }));
  fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
  const next = within(screen.getByRole('dialog', { name: '重新开始批量捕捞' }));
  expect(next.getByLabelText('Gate')).toBeChecked();
  expect(next.queryByLabelText('扫描间隔（小时）')).toBeNull();
  fireEvent.click(next.getByRole('button', { name: '复制已保存的捕捞条件' }));
  expect(next.getByLabelText('币安')).toBeChecked();
  expect(next.getByLabelText('OKX')).toBeChecked();
  expect(next.getByLabelText('美股合约')).toBeChecked();
  expect(next.getByLabelText('含跨所重复标的')).toBeChecked();
  expect(mining.state).toMatchObject({ stepMs: MINING_STEP_MS * 2, selection: { exchanges: ['gate'] } });
});

it('saves independently edited values and leaves the current round paused', () => {
  localStorage.clear();
  const rule = { ...currentDefaultRules()[0], statistic: '结果' };
  const mining = api({ ruleChoices: [{ featureId: 'cbi2', label: 'CBI-2', statistics: [{ name: '结果', label: '结果' }] }] }, { rules: [rule], mined: 20 });
  try {
    render(<FishMiningPanel mining={mining as never} sellFixed campaignHref="#"/>);
    fireEvent.click(screen.getByRole('button', { name: '批量捕捞设置' }));
    const dialog = within(screen.getByRole('dialog', { name: '批量捕捞设置' }));
    expect(dialog.queryByLabelText('扫描间隔（小时）')).toBeNull();
    fireEvent.change(dialog.getByLabelText('每档回看（小时）'), { target: { value: '2.5' } });
    fireEvent.change(dialog.getByLabelText('算法组合'), { target: { value: 'and' } });
    fireEvent.click(dialog.getByLabelText('OKX'));
    fireEvent.change(dialog.getByLabelText('1 小时成交额（USDT）'), { target: { value: '600000' } });
    expect(readMiningSettings()).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: '保存设置' }));
    expect(readMiningSettings()).toMatchObject({ stepMs: 2.5 * 3_600_000, selection: { exchanges: ['binance', 'okx'] },
      scan: { lookbackHours: 2.5, combination: 'and', turnover: { floors: [{ hours: 1, min: 600_000 }, { hours: 12, min: 8_000_000 }, { hours: 24, min: 10_000_000 }] } } });
    expect(mining.start).not.toHaveBeenCalled();
    expect(mining.setTarget).not.toHaveBeenCalled();
  } finally { localStorage.clear(); }
});


it('copies saved capture-quality settings into an editable mining draft for future rounds', () => {
  localStorage.clear();
  const key = getUserPrefix() + FISH_HIT_RATE_SETTINGS_KEY;
  const source: FishHitRateSettings = {
    version: 1,
    cards: [
      { id: 'quality-cbi2', featureId: 'cbi2', enabled: true, pref: { statistic: 'CBI2', threshold: '0.032', direction: '<', constraints: [] } },
      { id: 'quality-cba', featureId: 'cba', enabled: false, pref: { threshold: '2.2', direction: '>', constraints: [] } },
    ],
    combination: 'and',
    selection: { exchanges: ['okx', 'gate'], includeDuplicates: true, includeUsStocks: true },
    downwardWick: { enabled: false, hours: 8, atrMultiple: 3.5 },
    turnover: { enabled: false, floors: [{ hours: 1, min: 650_000 }, { hours: 12, min: 3_000_000 }, { hours: 24, min: 4_000_000 }] },
    window: { beforeHours: 5, afterHours: 0.1 },
  };
  const snapshot = JSON.stringify(source);
  const mining = api({ ruleChoices: [
    { featureId: 'cbi2', label: 'CBI-2', statistics: [{ name: 'CBI2', label: '原值' }] },
    { featureId: 'cba', label: 'CBA', statistics: [{ name: '结果', label: '结果' }] },
  ] }, { target: 50, stepMs: 24 * 3_600_000 });
  try {
    render(<FishMiningPanel mining={mining as never} sellFixed campaignHref="#" />);
    const open = () => fireEvent.click(screen.getByRole('button', { name: '批量捕捞设置' }));
    const form = () => within(screen.getByRole('dialog', { name: '批量捕捞设置' }));
    const copy = () => fireEvent.click(form().getByRole('button', { name: '复制捕捞质量设置' }));
    open();
    fireEvent.change(form().getByLabelText('批量捕捞目标条数'), { target: { value: '99' } });
    expect(form().queryByLabelText('扫描间隔（小时）')).toBeNull();
    copy();
    expect(form().getByRole('alert')).toHaveTextContent('保存独立设置');
    localStorage.setItem(key, snapshot);
    copy();
    expect(form().getByLabelText('批量捕捞算法 1 方向')).toHaveValue('<');
    expect(form().getByLabelText('批量捕捞算法 1 门槛')).toHaveValue(0.032);
    expect(form().getByLabelText('启用批量捕捞算法 2')).not.toBeChecked();
    expect(form().getByLabelText('每档回看（小时）')).toHaveValue(5.1);
    expect(form().getByLabelText('批量捕捞目标条数')).toHaveValue(99);
    expect(readMiningSettings()).toBeNull();
    fireEvent.click(form().getByRole('button', { name: '取消' }));
    open();
    expect(form().getByLabelText('批量捕捞目标条数')).toHaveValue(50);
    copy();
    fireEvent.change(form().getByLabelText('批量捕捞算法 1 门槛'), { target: { value: '0.04' } });
    fireEvent.click(form().getByRole('button', { name: '保存设置' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(readMiningSettings()).toMatchObject({
      target: 50, stepMs: 5.1 * 3_600_000, selection: source.selection,
      scan: { combination: source.combination, downwardWick: source.downwardWick, turnover: source.turnover, lookbackHours: 5.1 },
      rules: [
        { featureId: 'cbi2', statistic: 'CBI2', direction: '<', threshold: '0.04', enabled: true },
        { featureId: 'cba', statistic: '结果', direction: '>', threshold: '2.2', enabled: false },
      ],
    });
    expect(localStorage.getItem(key)).toBe(snapshot);
    expect(mining.start).not.toHaveBeenCalled();
    expect(mining.pause).not.toHaveBeenCalled();
  } finally {
    localStorage.clear();
  }
});
