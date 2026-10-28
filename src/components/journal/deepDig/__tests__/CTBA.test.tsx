import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FeatureView } from '../FeatureView';
import { CTBA_DEF } from '@/lib/deepDig/features';
import { makeData } from '@/lib/deepDig/__tests__/fixtures';
import { snapshotOf } from '@/lib/deepDig/analysis';
import { defaultFeatureCommands } from '@/lib/deepDig/commands';

it('CTBA uses the existing research page, shows the score and enables all existing exports', () => {
  const data = makeData();
  data.definition = snapshotOf(CTBA_DEF);
  data.rows = [{ ...data.rows[1], group: 'positive', v: 56.80336111049461,
    vars: { CTBA: 56.80336111049461, T: .877551020408164, M: 3.430288009201976, F: -.0054556700022371915 } }];
  render(<FeatureView def={CTBA_DEF} data={data} inference={null} series={null}
    editing={false} onEditingChange={vi.fn()} onSaveDef={vi.fn()} samples={{ campaigns: [], signals: [] }}
    describeStatus="idle" describeProgress={null} describeError={null} canDescribe onDescribe={vi.fn()} onCancel={vi.fn()}
    inferStatus="idle" inferError={null} onInfer={vi.fn()} onDownload={vi.fn()}
    commands={defaultFeatureCommands('ctba')} onCommandsChange={vi.fn()}
    excluded={[]} onExcludedChange={vi.fn()} tab="describe" onTabChange={vi.fn()}
    group="positive" onGroupChange={vi.fn()} showAll onShowAllChange={vi.fn()}
    onOpenCampaign={vi.fn()} note={null} onSaveNote={vi.fn()} />);
  const table = screen.getByTestId('deep-dig-rows');
  expect(within(table).getByRole('columnheader', { name: 'CTBA' })).toBeInTheDocument();
  expect(within(table).getByText('56.80')).toBeInTheDocument();
  for (const name of ['下载结果 JSON', '下载结果 CSV', '下载统计图片 PNG']) {
    expect(screen.getByRole('button', { name })).toBeEnabled();
  }
});
