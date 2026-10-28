import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FeatureView } from '../FeatureView';
import { KlineSettings } from '../DefinitionPanel';
import { MBI_DEF } from '@/lib/deepDig/features';
import { makeData } from '@/lib/deepDig/__tests__/fixtures';
import { snapshotOf, type DeepDigRowGroup } from '@/lib/deepDig/analysis';
import { defaultFeatureCommands } from '@/lib/deepDig/commands';
import { deepDigImageRows } from '@/lib/deepDig/export';
import { MBI_TOOLTIP } from '@/lib/mbi';

describe('MBI controls and presentation', () => {
  it('n and z0 save through existing parameter settings; invalid values never commit', () => {
    const change = vi.fn();
    function Parameters() {
      const [value, setValue] = useState({ id: 'mbi', interval: '5m' as const, halfLifeHours: 6, avgHours: 24, MBI_N: 25, MBI_Z0: 1.25 });
      return <KlineSettings value={value} onChange={next => { setValue(next as typeof value); change(next); }} testId="mbi-config" />;
    }
    render(<Parameters />);
    expect(screen.getByTestId('mbi-config-summary')).toHaveTextContent('701 根');
    fireEvent.change(screen.getByLabelText('MBI_N'), { target: { value: '10' } }); fireEvent.blur(screen.getByLabelText('MBI_N'));
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ MBI_N: 10, MBI_Z0: 1.25 }));
    expect(screen.getByTestId('mbi-config-summary')).toHaveTextContent('626 根');
    fireEvent.change(screen.getByLabelText('MBI_Z0'), { target: { value: '.8' } }); fireEvent.blur(screen.getByLabelText('MBI_Z0'));
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ MBI_N: 10, MBI_Z0: .8 }));
    const count = change.mock.calls.length;
    fireEvent.change(screen.getByLabelText('MBI_N'), { target: { value: '1.5' } }); fireEvent.blur(screen.getByLabelText('MBI_N'));
    expect(change).toHaveBeenCalledTimes(count); expect(screen.getByLabelText('MBI_N')).toHaveValue(10);
  });

  it('both values appear in the table, variable chooser, PNG report and exports', () => {
    const data = makeData(); data.definition = snapshotOf(MBI_DEF);
    data.rows = [{ ...data.rows[1], group: 'positive', v: .7464825859628076, vars: { MBI: .7464825859628076, avg_MBI: .45, avg_MBI_2: .5123662315257813 } }];
    function Page() {
      const [group, setGroup] = useState<DeepDigRowGroup>('positive');
      return <FeatureView def={MBI_DEF} data={data} inference={null} series={null} editing={false} onEditingChange={vi.fn()} onSaveDef={vi.fn()}
        samples={{ campaigns: [], signals: [] }} describeStatus="idle" describeProgress={null} describeError={null} canDescribe onDescribe={vi.fn()} onCancel={vi.fn()}
        inferStatus="idle" inferError={null} onInfer={vi.fn()} onDownload={vi.fn()} commands={defaultFeatureCommands('mbi')} onCommandsChange={vi.fn()}
        excluded={[]} onExcludedChange={vi.fn()} tab="describe" onTabChange={vi.fn()} group={group} onGroupChange={setGroup} showAll onShowAllChange={vi.fn()}
        onOpenCampaign={vi.fn()} note={null} onSaveNote={vi.fn()} />;
    }
    render(<Page />);
    const table = screen.getByTestId('deep-dig-rows');
    expect(within(table).getByRole('columnheader', { name: 'MBI' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'avg_MBI_2' })).toHaveAttribute('title', MBI_TOOLTIP);
    expect(within(table).getByText('0.75')).toBeInTheDocument(); expect(within(table).getByText('0.51')).toBeInTheDocument();
    for (const name of ['下载结果 JSON', '下载结果 CSV', '下载统计图片 PNG']) expect(screen.getByRole('button', { name })).toBeEnabled();
    const rows = deepDigImageRows(data);
    expect(rows.map(r => r.name)).toEqual(['MBI', 'MBI', 'MBI', 'MBI', 'avg_MBI_2', 'avg_MBI_2', 'avg_MBI_2', 'avg_MBI_2']);
    expect(rows.find(r => r.name === 'avg_MBI_2' && r.group === 'positive')?.mean).toBe(.5123662315257813);
  });
});
