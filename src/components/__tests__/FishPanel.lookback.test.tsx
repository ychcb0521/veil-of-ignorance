import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {FishPanel} from '@/components/FishPanel';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {readFishLookback} from '@/lib/fish/lookback';
import {initialFishProgress} from '@/lib/fishScanner';
const defs=[{...CBI2_DEF,formula:'X = C\nX',scale:1}];
vi.mock('@/hooks/useFishFeatures',()=>({useFishFeatures:()=>defs}));
const props={signals:[],progress:null,inputs:{time:'',threshold:''},onInputsChange:vi.fn(),selection:{exchanges:['binance' as const],includeDuplicates:false},onSelectionChange:vi.fn(),onStart:vi.fn((_settings:any)=>{}),onCancel:vi.fn(),onJump:vi.fn(),onDelete:vi.fn(),onRate:vi.fn(),jumpingSignalId:null,tradedDayIndex:new Set<string>(),campaignDayIndex:new Set<string>()};
beforeEach(()=>{localStorage.clear();sessionStorage.clear();vi.clearAllMocks();});afterEach(cleanup);
it('defaults to 12 hours, sends the custom hours to manual capture and restores them on reopen',async()=>{
 const h=render(<FishPanel {...props}/>);expect(screen.getByLabelText('扫描覆盖时间（小时）')).toHaveValue(12);
 fireEvent.change(screen.getByLabelText('扫描覆盖时间（小时）'),{target:{value:'10'}});fireEvent.blur(screen.getByLabelText('扫描覆盖时间（小时）'));
 expect(readFishLookback()).toBe(10);fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));await waitFor(()=>expect(props.onStart).toHaveBeenCalled());
 expect(props.onStart.mock.calls[0][0]).toMatchObject({lookbackHours:10});h.unmount();render(<FishPanel {...props}/>);expect(screen.getByLabelText('扫描覆盖时间（小时）')).toHaveValue(10);
});
it('shows the frozen range of the previous round and prevents invalid or mid-run edits',()=>{
 const progress={...initialFishProgress(),lookbackHours:12,status:'complete' as const};const h=render(<FishPanel {...props} progress={progress}/>);
 fireEvent.change(screen.getByLabelText('扫描覆盖时间（小时）'),{target:{value:'2'}});fireEvent.blur(screen.getByLabelText('扫描覆盖时间（小时）'));
 expect(screen.getByTestId('fish-lookback-used')).toHaveTextContent('本轮覆盖过去 12 小时');expect(screen.getByTestId('fish-lookback-changed')).toHaveTextContent('下一轮生效');
 fireEvent.change(screen.getByLabelText('扫描覆盖时间（小时）'),{target:{value:'0'}});fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));expect(props.onStart).not.toHaveBeenCalled();expect(screen.getByText('扫描覆盖时间须大于 0 且不超过 8784 小时')).toBeInTheDocument();
 h.rerender(<FishPanel {...props} progress={{...progress,status:'running'}}/>);expect(screen.getByLabelText('扫描覆盖时间（小时）')).toBeDisabled();
});
