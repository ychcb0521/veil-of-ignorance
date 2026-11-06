// 【用户要求】2026-11-04 「从模板新建」列表里带内置模板：新建出的方案走普通保存路径（条件分支整套保留、新编号、模板名称）
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishQualitySellPlansEditor } from '../FishQualitySellPlansEditor';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { newQualityStudy, type QualityGroup } from '@/lib/fish/quality';
import { FUSION_ROUTER_THRESHOLD, FUSION_TEMPLATE_ID, FUSION_TEMPLATE_NAME } from '@/lib/fish/qualityBuiltinTemplates';
import { planVersionChanges } from '@/lib/fish/qualityPlanVersions';
import { ADVANTAGE_TEMPLATE_NAME } from '@/lib/fish/qualityAdvantageTemplate';
import { buildFusionTemplatePlan } from '@/lib/fish/qualityBuiltinTemplates';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
afterEach(() => { cleanup(); localStorage.clear(); });

it('creates the advantage template from the selected saved baseline and saves its independent controls',()=>{
  const original=buildFusionTemplatePlan(BUILTIN_FEATURES,'baseline','原 2.5% 方案');
  for (const plan of [original, original.router!.structure, original.router!.attack]) plan.mirrorTakeProfit = { enabled: true, gainPct: 2.5, sellPct: 67 };
  const save=vi.fn(),copy=vi.fn();
  render(<FishQualitySellPlansEditor plans={[original]} ready onSave={save} onCopyPlan={copy} templates={{templates:[],save:vi.fn(),remove:vi.fn()}}/>);
  fireEvent.click(screen.getByRole('button',{name:/从模板新建/}));
  expect(screen.getByLabelText('优势模板沿用原方案')).toHaveValue('plan:baseline');
  fireEvent.click(screen.getByRole('button',{name:`用内置模板 ${ADVANTAGE_TEMPLATE_NAME} 新建方案`}));
  const created=copy.mock.calls[0][1] as QualityGroup;
  expect(created.addition).toEqual(original.addition);expect(created.mirrorTakeProfit).toEqual(original.mirrorTakeProfit);
  expect(screen.getByTestId('quality-advantage-settings')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('筛掉同步走弱的加仓机会'));
  fireEvent.change(screen.getByLabelText('优势状态软退出确认次数'),{target:{value:'1'}});
  fireEvent.click(screen.getByRole('button',{name:'保存卖出算法'}));
  const made=(save.mock.calls[0][0] as QualityGroup[]).at(-1)!;
  expect(made.advantage).toMatchObject({screenWeak:false,confirmations:1});
  expect(made.router!.attack.advantage).toMatchObject({screenWeak:false,confirmations:1});
  expect(made.router!.structure.addition).toEqual(original.router!.structure.addition);
  expect(original.advantage).toBeUndefined();
},90000);

it('can create and save the advantage template without any saved source', () => {
  const save = vi.fn(), copy = vi.fn();
  render(<FishQualitySellPlansEditor plans={[]} ready onSave={save} onCopyPlan={copy} templates={{ templates: [], save: vi.fn(), remove: vi.fn() }}/>);
  fireEvent.click(screen.getByRole('button', { name: /从模板新建/ }));
  expect(screen.getByLabelText('优势模板沿用原方案')).toHaveValue('builtin');
  const create = screen.getByRole('button', { name: `用内置模板 ${ADVANTAGE_TEMPLATE_NAME} 新建方案` });
  expect(create).toBeEnabled();
  fireEvent.click(create);
  expect(screen.queryByTestId('plan-template-list')).not.toBeInTheDocument();
  const made = copy.mock.calls[0][1] as QualityGroup;
  expect(made.advantage).toBeDefined();
  expect(made.router!.afterAdditions).toBe(2);
  expect(made.router!.structure.addition).toMatchObject({ quantityMode: 'calculator', maxRounds: 7 });
  expect(made.router!.attack.addition).toMatchObject({ quantityMode: 'calculator', maxRounds: 8 });
  expect(made.mirrorTakeProfit).toEqual({ enabled: true, gainPct: 5, sellPct: .01 });
  expect(planVersionChanges(made)).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: '保存卖出算法' }));
  expect(save.mock.calls[0][0]).toEqual([made]);
}, 90000);

it('keeps New enabled with multiple sources and asks in place instead of silently choosing one', () => {
  const first = buildFusionTemplatePlan(BUILTIN_FEATURES, 'first', '原方案甲');
  const second = { ...structuredClone(first), id: 'second', label: '原方案乙' };
  const copy = vi.fn();
  render(<FishQualitySellPlansEditor plans={[first, second]} ready onSave={vi.fn()} onCopyPlan={copy} templates={{ templates: [], save: vi.fn(), remove: vi.fn() }}/>);
  fireEvent.click(screen.getByRole('button', { name: /从模板新建/ }));
  const create = screen.getByRole('button', { name: `用内置模板 ${ADVANTAGE_TEMPLATE_NAME} 新建方案` });
  expect(create).toBeEnabled();
  fireEvent.click(create);
  expect(within(screen.getByTestId('plan-template-list')).getByRole('alert')).toHaveTextContent('请先选择要沿用的原方案');
  expect(copy).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('优势模板沿用原方案'), { target: { value: 'plan:second' } });
  fireEvent.click(create);
  expect(copy).toHaveBeenCalledOnce();
  expect(copy.mock.calls[0][1].addition).toEqual(second.addition);
  expect(screen.queryByTestId('plan-template-list')).not.toBeInTheDocument();
}, 90000);

it('shows an incompatible source error inside the picker and lets the user choose the built-in source', () => {
  const original = buildFusionTemplatePlan(BUILTIN_FEATURES, 'outdated');
  original.frozenVersions = [{ key: 'router', part: '条件分支', name: '旧版本', version: 'unknown-v0', summary: '' }];
  const copy = vi.fn();
  render(<FishQualitySellPlansEditor plans={[original]} ready onSave={vi.fn()} onCopyPlan={copy} templates={{ templates: [], save: vi.fn(), remove: vi.fn() }}/>);
  fireEvent.click(screen.getByRole('button', { name: /从模板新建/ }));
  const create = screen.getByRole('button', { name: `用内置模板 ${ADVANTAGE_TEMPLATE_NAME} 新建方案` });
  fireEvent.click(create);
  expect(within(screen.getByTestId('plan-template-list')).getByRole('alert')).toHaveTextContent('原方案的冻结版本已变');
  expect(copy).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('优势模板沿用原方案'), { target: { value: 'builtin' } });
  fireEvent.click(create);
  expect(copy).toHaveBeenCalledOnce();
  expect(screen.queryByTestId('plan-template-list')).not.toBeInTheDocument();
}, 90000);

it('lists the built-in fusion template next to saved templates and creates a routed plan from it', () => {
  const save = vi.fn(), copy = vi.fn(), plans = enableQualityComparison(newQualityStudy()).sellPlans!;
  render(<FishQualitySellPlansEditor plans={plans} ready onSave={save} onCopyPlan={copy} templates={{ templates: [], save: vi.fn(), remove: vi.fn() }}/>);
  fireEvent.click(screen.getByRole('button', { name: /从模板新建/ }));
  const list = screen.getByTestId('plan-template-list');
  expect(within(list).getByText(FUSION_TEMPLATE_NAME)).toBeInTheDocument();
  expect(within(list).getByText('还没有模板。在方案卡片右上角点「存为模板」即可保存整套设置。')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: `用内置模板 ${FUSION_TEMPLATE_NAME} 新建方案` }));
  // 与「从模板新建」同一条路：先把来源交给父级复制监测草稿，再加入列表
  expect(copy).toHaveBeenCalledOnce();
  const [source, created] = copy.mock.calls[0] as [QualityGroup, QualityGroup];
  expect(source.id).toBe(`builtin:${FUSION_TEMPLATE_ID}`); expect(created.router).toBeTruthy(); expect(created.label).toBe(FUSION_TEMPLATE_NAME);
  expect(screen.getByLabelText(`卖出算法 ${plans.length + 1} 名称`)).toHaveValue(FUSION_TEMPLATE_NAME);
  expect(screen.getByText('条件分支方案：在下方修改两个分支的卖出、镜像、加仓与止损设置。')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '保存卖出算法' }));
  expect(save).toHaveBeenCalledOnce();
  const saved: QualityGroup[] = save.mock.calls[0][0];
  expect(saved).toHaveLength(plans.length + 1);
  const made = saved.at(-1)!;
  expect(made.id).toBe(created.id); expect(made.id).toMatch(/^sell-/); expect(made.label).toBe(FUSION_TEMPLATE_NAME);
  expect(made.router).toEqual(created.router); expect(made.router!.threshold).toBe(FUSION_ROUTER_THRESHOLD);
  expect(made.router!.structure.addition!.maxRounds).toBe(7); expect(made.router!.attack.addition!.maxRounds).toBe(8);
  expect(planVersionChanges(made)).toEqual([]);
}, 90000);

it('gives the second copy a distinct name', () => {
  const save = vi.fn(), plans = enableQualityComparison(newQualityStudy()).sellPlans!;
  render(<FishQualitySellPlansEditor plans={plans} ready onSave={save} templates={{ templates: [], save: vi.fn(), remove: vi.fn() }}/>);
  for (let i = 0; i < 2; i++) { fireEvent.click(screen.getByRole('button', { name: /从模板新建/ })); fireEvent.click(screen.getByRole('button', { name: `用内置模板 ${FUSION_TEMPLATE_NAME} 新建方案` })); }
  fireEvent.click(screen.getByRole('button', { name: '保存卖出算法' }));
  const labels = (save.mock.calls[0][0] as QualityGroup[]).slice(-2).map(p => p.label);
  expect(labels).toEqual([FUSION_TEMPLATE_NAME, `${FUSION_TEMPLATE_NAME}（2）`]);
}, 90000);
