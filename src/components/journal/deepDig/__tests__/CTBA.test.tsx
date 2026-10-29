import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FeatureView } from '../FeatureView';
import { CTBA_DEF, CTBA_12H_DEF } from '@/lib/deepDig/features';
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

import { SeriesChart } from '../SeriesChart';
import { seriesOffsets, seriesRangeOf, type DeepDigSeries } from '@/lib/deepDig/series';

it('CTBA-12H research keeps zero at the axis center for positive-only samples and shows score plus components on hover', () => {
  const data=makeData();data.definition=snapshotOf(CTBA_12H_DEF);data.rows=[{...data.rows[1],group:'positive',v:20}];
  const offsets=seriesOffsets(seriesRangeOf(CTBA_12H_DEF));
  const values=new Float64Array(4*144);for(let i=0;i<144;i++){values[i]=10+i/20;values[144+i]=.1;values[288+i]=.2;values[432+i]=-.3;}
  const series:DeepDigSeries={finishedAt:1,offsets,names:['CTBA','T','M','F'],result:'CTBA',byEvent:{[data.rows[0].id]:values}};
  render(<SeriesChart data={data} series={series} variable="CTBA" onVariable={vi.fn()} />);
  const svg=screen.getByTestId('deep-dig-series-chart');
  expect(screen.getByText('0｜综合均衡基准')).toBeVisible();
  const zero=screen.getByTestId('deep-dig-series-fixed-zero');
  const y=Number(zero.getAttribute('y1'));
  const gradient=svg.querySelector('linearGradient')!;
  expect(gradient.getAttribute('gradientUnits')).toBe('userSpaceOnUse');
  expect(y).toBe((Number(gradient.getAttribute('y1'))+Number(gradient.getAttribute('y2')))/2);
  const hit=screen.getByTestId('deep-dig-series-hit');
  vi.spyOn(hit,'getBoundingClientRect').mockReturnValue({left:44,width:532,top:22,height:176,right:576,bottom:198,x:44,y:22,toJSON:()=>({})});
  fireEvent.mouseMove(hit,{clientX:300,clientY:100});
  expect(screen.getByText(/T 0.10000/)).toBeVisible();
  expect(screen.getByText(/M 0.20000/)).toBeVisible();
  expect(screen.getByText(/F -0.30000/)).toBeVisible();
});
