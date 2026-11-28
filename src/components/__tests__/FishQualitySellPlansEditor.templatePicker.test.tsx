import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TemplatePicker } from '../FishQualitySellPlansEditor';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { newQualityStudy } from '@/lib/fish/quality';

it('omits built-in and screening templates in the holding template picker',async()=>{
 const {emptyPreEntryThreeStage}=await import('@/lib/fish/preEntryThreeStage'),p=enableQualityComparison(newQualityStudy()).sellPlans![0],entry={id:'screening',name:'筛选资产',savedAt:1,updatedAt:1,plan:{...p,preEntryThreeStage:emptyPreEntryThreeStage()}},holding={id:'holding',name:'持仓资产',savedAt:1,updatedAt:1,plan:p};
 render(<TemplatePicker disabled={false} actions={{templates:[entry,holding],save:vi.fn(),remove:vi.fn()}} onUse={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:/从模板新建/}));expect(screen.queryAllByTestId('plan-template-builtin')).toHaveLength(0);const items=screen.getAllByTestId('plan-template-item');expect(items).toHaveLength(1);expect(items[0]).toHaveTextContent('持仓资产');expect(screen.queryByText('筛选资产')).not.toBeInTheDocument();
});

it('imports into an empty holding library with frozen settings and rejects another library’s file', async () => {
  const plan = enableQualityComparison(newQualityStudy()).sellPlans![0];
  const restore = vi.fn(), onUse = vi.fn();
  render(<TemplatePicker disabled={false} actions={{templates:[], restore, save:vi.fn(), remove:vi.fn()}} onUse={onUse}/>);
  fireEvent.click(screen.getByRole('button', {name:/从模板新建/}));
  const upload = (text: string) => fireEvent.change(screen.getByLabelText('选择模板文件'), {
    target: { files: [{name:'template.json', text:async () => text}] },
  });
  const template = {id:'source',name:'原参数',savedAt:1,updatedAt:1,plan};
  upload(JSON.stringify({...template, entryHours: 2}));
  expect(await screen.findByRole('alert')).toHaveTextContent('动态筛选');
  expect(restore).not.toHaveBeenCalled();
  const {serializeAccountBlob} = await import('@/lib/accountBlobCodec');
  upload(serializeAccountBlob(template));
  await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
  expect(serializeAccountBlob(restore.mock.calls[0][0])).toBe(serializeAccountBlob(template));
  expect(await screen.findByRole('status')).toHaveTextContent('原参数');
  expect(onUse).not.toHaveBeenCalled();
});

it.each(['static', 'entry'] as const)('imports the matching %s template from its library', async purpose => {
  const base = enableQualityComparison(newQualityStudy()).sellPlans![0];
  const plan = purpose === 'static' ? {...base, staticFilter:{version:'static-filter-v1', filters:[], metrics:[]}} : base;
  const template = {id:'old',name:'已保存设置',savedAt:1,updatedAt:1,plan,...(purpose === 'entry' ? {entryHours:12} : {})};
  const restore = vi.fn();
  render(<TemplatePicker purpose={purpose} disabled={false} actions={{templates:[],restore,save:vi.fn(),remove:vi.fn()}}/>);
  fireEvent.click(screen.getByRole('button',{name:'模板库'}));
  fireEvent.change(screen.getByLabelText('选择模板文件'),{target:{files:[{text:async () => JSON.stringify(template)}]}});
  await waitFor(() => expect(restore).toHaveBeenCalledWith(JSON.parse(JSON.stringify(template))));
});
