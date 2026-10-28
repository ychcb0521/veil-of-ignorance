import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FishPanel } from '@/components/FishPanel';
import { CBI2_DEF } from '@/lib/deepDig/features';
import { saveFishPreference } from '@/lib/fish/preferences';
import { readFishDownwardWick } from '@/lib/fish/downwardWick';
import { initialFishProgress } from '@/lib/fishScanner';
import { buildFishScanSettings } from '@/lib/fish/scanPlan';
import { readFishCards } from '@/lib/fish/cards';
vi.mock('@/hooks/useFishFeatures',()=>({useFishFeatures:()=>[CBI2_DEF]}));
const start=vi.fn(),diagnose=vi.fn(async(_o:any)=>({outcome:'skipped' as const,lines:['向下大插针，已过滤']}));
const props={onDiagnose:diagnose,signals:[],progress:null,inputs:{time:'',threshold:'.3'},onInputsChange:()=>{},selection:{exchanges:['binance' as const],includeDuplicates:false},onSelectionChange:()=>{},onStart:start,onCancel:()=>{},onJump:()=>{},onDelete:()=>{},onRate:()=>{},jumpingSignalId:null,tradedDayIndex:new Set<string>(),campaignDayIndex:new Set<string>()};
beforeEach(()=>{localStorage.clear();sessionStorage.clear();vi.clearAllMocks();saveFishPreference('cbi2',{statistic:'结果',direction:'>',threshold:'.3',constraints:[]});});
async function scope(){fireEvent.click(screen.getByRole('button',{name:'更多'}));fireEvent.click(await screen.findByRole('button',{name:'捕捞范围'}));}
it('scope defaults on, settings persist and manual/auto/single-coin receive identical rules',async()=>{
 const view=render(<FishPanel {...props}/>);await scope();expect(screen.getByLabelText('过滤向下大插针')).toBeChecked();
 expect(screen.getByLabelText('插针回看时长')).toHaveValue('48');expect(screen.getByLabelText('插针 ATR 倍数')).toHaveValue('3');
 fireEvent.change(screen.getByLabelText('插针回看时长'),{target:{value:'48'}});fireEvent.change(screen.getByLabelText('插针 ATR 倍数'),{target:{value:'1.5'}});
 expect(readFishDownwardWick()).toEqual({enabled:true,hours:48,atrMultiple:1.5});expect(screen.getByText(/过滤设置将在下次捕捞生效/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));await vi.waitFor(()=>expect(start).toHaveBeenCalled());
 const built=buildFishScanSettings({cards:readFishCards(),defs:[CBI2_DEF],combination:'and',selection:props.selection,time:''});expect(built.settings!.downwardWick).toEqual(start.mock.calls[0][0].downwardWick);
 fireEvent.click(screen.getByRole('button',{name:'更多'}));fireEvent.click(await screen.findByRole('button',{name:'查单个币'}));fireEvent.change(screen.getByLabelText('查单个币的标的'),{target:{value:'COIN'}});fireEvent.click(screen.getByRole('button',{name:/^查$/}));await vi.waitFor(()=>expect(diagnose).toHaveBeenCalled());expect(diagnose.mock.calls[0][0].downwardWick).toEqual(start.mock.calls[0][0].downwardWick);
 view.unmount();render(<FishPanel {...props}/>);expect(screen.getByLabelText('插针回看时长')).toHaveValue('48');expect(screen.getByLabelText('插针 ATR 倍数')).toHaveValue('1.5');
 // 口径说明收进 ⓘ
 fireEvent.click(screen.getByRole('button',{name:'插针过滤说明'}));expect(screen.getByText(/以开盘价减最低价计跌幅/)).toBeInTheDocument();
 fireEvent.click(screen.getByLabelText('过滤向下大插针'));expect(screen.getByLabelText('插针回看时长')).toBeDisabled();expect(readFishDownwardWick().enabled).toBe(false);
});
it('locked during scan; rejected count is visible',async()=>{
 render(<FishPanel {...props} progress={{...initialFishProgress(),wickSkipped:3}}/>);await scope();expect(screen.getByLabelText('过滤向下大插针')).toBeDisabled();expect(screen.getByLabelText('插针 ATR 倍数')).toBeDisabled();expect(screen.getByTestId('fish-wick-skipped')).toHaveTextContent('插针过滤 3');
});
