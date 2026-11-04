// 【用户要求】2026-11-04 「从模板新建」列表里带内置模板：新建出的方案走普通保存路径（条件分支整套保留、新编号、模板名称）
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishQualitySellPlansEditor } from '../FishQualitySellPlansEditor';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { newQualityStudy, type QualityGroup } from '@/lib/fish/quality';
import { FUSION_ROUTER_THRESHOLD, FUSION_TEMPLATE_ID, FUSION_TEMPLATE_NAME } from '@/lib/fish/qualityBuiltinTemplates';
import { planVersionChanges } from '@/lib/fish/qualityPlanVersions';
afterEach(() => { cleanup(); localStorage.clear(); });

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
