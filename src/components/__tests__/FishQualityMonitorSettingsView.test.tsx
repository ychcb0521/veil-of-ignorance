// 【用户要求】2026-11-02 交易战役「战役元数据」底部「持仓监测」：完整、只读地呈现当时的条件设置，形式与「条件设置」一致
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { QualityMonitorSettingsButton } from '@/components/FishQualityMonitorSettingsView';
import { makeQualitySellPlan } from '@/lib/fish/qualitySellPlans';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
import { defaultStructureAddition } from '@/lib/fish/qualityAdditionStructure';
import type { QualityGroup } from '@/lib/fish/quality';
const plan = (): QualityGroup => ({ ...makeQualitySellPlan('state:state', '<', .45, BUILTIN_FEATURES, undefined, 'p1'), label: '组合算法1',
  mirrorTakeProfit: { enabled: true, gainPct: 2.5, sellPct: 67 },
  addition: { enabled: true, source: 'structure', stricterPct: 10, quantityMode: 'calculator', repeat: true, maxRounds: 2, structure: { ...defaultStructureAddition('dbl5'), buffer: .1, kSource: 'current' },
    rounds: [{ source: 'structure', stricterPct: 10, structure: { ...defaultStructureAddition('dbl5'), buffer: .1, kSource: 'current' }, minGainPct: 3 }, { source: 'structure', stricterPct: 10, structure: { ...defaultStructureAddition('dbl5'), buffer: .2, kSource: 'previous' } }] },
  holdingVetoes: [{ id: 'v1', label: '持仓过程静态最大回撤', kind: 'static-drawdown', direction: '>=', threshold: 5, enabled: true }] });
it('shows the frozen monitor settings with the same editors, read-only, with round tabs still browsable', () => {
  render(<QualityMonitorSettingsButton plan={plan()}/>);
  fireEvent.click(screen.getByRole('button', { name: '查看持仓监测设置' }));
  const view = screen.getByTestId('quality-monitor-settings-view');
  expect(within(view).getByLabelText('卖出算法 1 门槛')).toHaveValue(.45); expect(within(view).getByLabelText('卖出算法 1 门槛')).toBeDisabled();
  expect(within(view).getByLabelText('镜像止盈卖出百分比')).toHaveValue(67); expect(within(view).getByLabelText('镜像止盈涨幅')).toHaveValue(2.5);
  expect(within(view).getByLabelText('最多加仓次数')).toHaveValue(2); expect(within(view).getByLabelText('箱体支撑冗余')).toHaveValue(.1);
  expect(within(view).getByLabelText('K基准箱体')).toHaveValue('current'); expect(within(view).getByLabelText('加仓涨幅门槛')).toHaveValue(3);
  fireEvent.click(within(within(view).getByRole('tablist', { name: '选择加仓轮次' })).getByRole('tab', { name: '第 2 次' }));
  expect(within(view).getByLabelText('箱体支撑冗余')).toHaveValue(.2); expect(within(view).getByLabelText('K基准箱体')).toHaveValue('previous');
  fireEvent.change(within(view).getByLabelText('箱体支撑冗余'), { target: { value: '9' } }); expect(within(view).getByLabelText('箱体支撑冗余')).toHaveValue(.2);
  expect(within(within(view).getByTestId('quality-hard-stop')).getAllByRole('checkbox').some(c => (c as HTMLInputElement).checked)).toBe(true);
  for (const gone of [/保存/, /新增卖出算法/, /从模板新建/]) expect(within(view).queryByRole('button', { name: gone })).toBeNull();
  expect(within(view).queryByLabelText('复制卖出算法 1')).toBeNull();
  // 2026-11-02 版本保护：只读视图底部列出这场战役冻结的算法版本
  expect(within(within(view).getByTestId('quality-plan-versions')).getByTestId('plan-version-list')).toBeInTheDocument();
},20_000);
