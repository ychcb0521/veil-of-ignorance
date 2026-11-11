import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FishPanel } from '@/components/FishPanel';
import { CBI2_DEF } from '@/lib/deepDig/features';
import { saveFishPreference } from '@/lib/fish/preferences';
import { readFishDownwardWick } from '@/lib/fish/downwardWick';
import { initialFishProgress } from '@/lib/fishScanner';
import { buildFishScanSettings } from '@/lib/fish/scanPlan';
import { readFishCards } from '@/lib/fish/cards';

vi.mock('@/hooks/useFishFeatures',()=>({useFishFeatures:()=>[CBI2_DEF]}));
const start=vi.fn();
const props={signals:[],progress:null,inputs:{time:'',threshold:'.3'},onInputsChange:()=>{},selection:{exchanges:['binance' as const],includeDuplicates:false},onSelectionChange:()=>{},onStart:start,onCancel:()=>{},onJump:()=>{},onDelete:()=>{},onRate:()=>{},jumpingSignalId:null,tradedDayIndex:new Set<string>(),campaignDayIndex:new Set<string>()};

beforeEach(()=>{
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  saveFishPreference('cbi2',{statistic:'结果',direction:'>',threshold:'.3',constraints:[]});
});

async function openSettings() {
  const capture = screen.getByRole('button', { name: '捕捞' });
  if (capture.getAttribute('aria-expanded') === 'false') fireEvent.click(capture);
  expect(screen.queryByRole('button', { name: '插针回看设置' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '更多' }));
  const menu = within(await screen.findByRole('dialog', { name: '更多捕捞选项' }));
  expect(menu.queryByRole('button', { name: '插针回看设置' })).not.toBeInTheDocument();
  expect(menu.queryByRole('button', { name: '查单个币' })).not.toBeInTheDocument();
  fireEvent.click(menu.getByRole('button', { name: '设置' }));
  const settings = within(await screen.findByRole('dialog', { name: '设置' }));
  fireEvent.click(settings.getByRole('button', { name: '插针回看设置' }));
  return within(await screen.findByRole('dialog', { name: '插针回看设置' }));
}

it('saves only submitted settings and gives manual and automatic scans the same custom rule', async () => {
  const view = render(<FishPanel {...props}/>);
  let settings = await openSettings();
  expect(settings.getByLabelText('过滤向下大插针')).toBeChecked();
  expect(settings.getByLabelText('回看时长')).toHaveValue(48);
  expect(settings.getByLabelText('插针幅度（ATR 倍数）')).toHaveValue(3);
  expect(settings.getByRole('list', { name: '成交额门槛' })).toHaveTextContent('≥ 1,000 万 USDT');
  fireEvent.change(settings.getByLabelText('回看时长'), { target: { value: '1' } });
  fireEvent.change(settings.getByLabelText('插针幅度（ATR 倍数）'), { target: { value: '4.2' } });
  expect(readFishDownwardWick()).toEqual({ enabled:true, hours:48, atrMultiple:3 });
  fireEvent.click(settings.getByRole('button', { name: '保存插针设置' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '插针回看设置' })).not.toBeInTheDocument());
  const expected = { enabled:true, hours:1, atrMultiple:4.2 };
  expect(readFishDownwardWick()).toEqual(expected);

  fireEvent.click(screen.getByRole('button', { name: '开始捕捞' }));
  await waitFor(() => expect(start).toHaveBeenCalled());
  expect(start.mock.calls[0][0].downwardWick).toEqual(expected);
  const built = buildFishScanSettings({ cards:readFishCards(), defs:[CBI2_DEF], combination:'and', selection:props.selection, time:'' });
  expect(built.settings?.downwardWick).toEqual(expected);

  view.unmount();
  render(<FishPanel {...props}/>);
  settings = await openSettings();
  expect(settings.getByLabelText('回看时长')).toHaveValue(1);
  expect(settings.getByLabelText('插针幅度（ATR 倍数）')).toHaveValue(4.2);
  fireEvent.click(settings.getByLabelText('过滤向下大插针'));
  fireEvent.click(settings.getByRole('button', { name:'保存插针设置' }));
  await waitFor(() => expect(readFishDownwardWick()).toEqual({ ...expected, enabled:false }));
});

it('shows validation errors and preserves the previously saved rule', async () => {
  render(<FishPanel {...props}/>);
  const settings = await openSettings();
  fireEvent.change(settings.getByLabelText('插针幅度（ATR 倍数）'), { target: { value:'0' } });
  fireEvent.click(settings.getByRole('button', { name:'保存插针设置' }));
  expect(await settings.findByRole('alert')).toHaveTextContent('须为大于 0 的 ATR 倍数');
  expect(readFishDownwardWick().atrMultiple).toBe(3);
});

it('locks edits during scans and keeps the rejection count visible', async () => {
  render(<FishPanel {...props} progress={{...initialFishProgress(),wickSkipped:3}}/>);
  const settings = await openSettings();
  expect(settings.getByLabelText('过滤向下大插针')).toBeDisabled();
  expect(settings.getByLabelText('插针幅度（ATR 倍数）')).toBeDisabled();
  expect(screen.getByTestId('fish-wick-skipped')).toHaveTextContent('插针过滤 3');
});
