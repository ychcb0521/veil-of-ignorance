import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {FishPanel} from '@/components/FishPanel';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {readFishLookback} from '@/lib/fish/lookback';
import {initialFishProgress} from '@/lib/fishScanner';
import { FISH_ACCOUNT_SETTINGS_KEY, readFishAccountSettings, type FishAccountSettings } from '@/lib/fish/accountSettings';
vi.mock('@/lib/simStateSync',async importOriginal=>({...await importOriginal<typeof import('@/lib/simStateSync')>(),pushSimStateImmediately:vi.fn(async()=>true)}));
const defs=[{...CBI2_DEF,formula:'X = C\nX',scale:1}];
vi.mock('@/hooks/useFishFeatures',()=>({useFishFeatures:()=>defs}));
const props={signals:[],progress:null,inputs:{time:'',threshold:''},onInputsChange:vi.fn(),selection:{exchanges:['binance' as const],includeDuplicates:false},onSelectionChange:vi.fn(),onStart:vi.fn((_settings:any)=>{}),onCancel:vi.fn(),onJump:vi.fn(),onDelete:vi.fn(),onRate:vi.fn(),jumpingSignalId:null,tradedDayIndex:new Set<string>(),campaignDayIndex:new Set<string>()};
beforeEach(()=>{localStorage.clear();sessionStorage.clear();vi.clearAllMocks();});afterEach(cleanup);
it('defaults to 1 hour, sends the custom hours to manual capture and restores them on reopen',async()=>{
 const h=render(<FishPanel {...props}/>);expect(screen.getByLabelText('扫描覆盖时间（小时）')).toHaveValue(1);
 fireEvent.change(screen.getByLabelText('扫描覆盖时间（小时）'),{target:{value:'10'}});fireEvent.blur(screen.getByLabelText('扫描覆盖时间（小时）'));
 expect(readFishLookback()).toBe(10);fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));await waitFor(()=>expect(props.onStart).toHaveBeenCalled());
 expect(props.onStart.mock.calls[0][0]).toMatchObject({lookbackHours:10});h.unmount();render(<FishPanel {...props}/>);expect(screen.getByLabelText('扫描覆盖时间（小时）')).toHaveValue(10);
});
it('shows the frozen range of the previous round and prevents invalid or mid-run edits',()=>{
 const progress={...initialFishProgress(),lookbackHours:12,status:'complete' as const};const h=render(<FishPanel {...props} progress={progress}/>);
 fireEvent.change(screen.getByLabelText('扫描覆盖时间（小时）'),{target:{value:'2'}});fireEvent.blur(screen.getByLabelText('扫描覆盖时间（小时）'));
 expect(screen.getByTestId('fish-status')).toHaveAttribute('title',expect.stringContaining('本轮覆盖过去 12 小时'));expect(screen.getByTestId('fish-status')).toHaveAttribute('title',expect.stringContaining('覆盖时间改为过去 2 小时，下一轮生效'));
 fireEvent.change(screen.getByLabelText('扫描覆盖时间（小时）'),{target:{value:'0'}});fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));expect(props.onStart).not.toHaveBeenCalled();expect(screen.getByText('扫描覆盖时间须大于 0 且不超过 8784 小时')).toBeInTheDocument();
 h.rerender(<FishPanel {...props} progress={{...progress,status:'running'}}/>);expect(screen.getByLabelText('扫描覆盖时间（小时）')).toBeDisabled();
});
it('autosaves coverage over an older fixed account value without resetting algorithm edits', async () => {
 localStorage.setItem('sb-test-auth-token',JSON.stringify({user:{id:'coverage-user'}}));
 const saved:FishAccountSettings={version:1,cards:[{id:'first',featureId:'cbi2',enabled:true,pref:{statistic:'结果',direction:'>',threshold:'0.7',constraints:[]}}],
  combination:'and',lookbackHours:24,downwardWick:{enabled:false,hours:12,atrMultiple:2},selection:props.selection};
 localStorage.setItem('sim_coverage-user_'+FISH_ACCOUNT_SETTINGS_KEY,JSON.stringify(saved));
 const view=render(<FishPanel {...props}/>);
 expect(screen.getByLabelText('扫描覆盖时间（小时）')).toHaveValue(24);
 fireEvent.change(screen.getByLabelText('捕捞阈值'),{target:{value:'0.9'}});
 fireEvent.change(screen.getByLabelText('扫描覆盖时间（小时）'),{target:{value:'1'}});
 fireEvent.blur(screen.getByLabelText('扫描覆盖时间（小时）'));
 await waitFor(()=>expect(readFishAccountSettings()?.lookbackHours).toBe(1));
 expect(screen.getByLabelText('捕捞阈值')).toHaveValue(.9);
 expect(readFishAccountSettings()?.cards).toEqual(saved.cards);
 view.unmount();render(<FishPanel {...props}/>);
 expect(screen.getByLabelText('扫描覆盖时间（小时）')).toHaveValue(1);
 expect(screen.getByLabelText('捕捞阈值')).toHaveValue(.7);
});
it('shows the actual frozen Beijing window and keeps a four-day-old hydrated fresh flag out of the current new-fish table without deleting it',()=>{
 const anchor=Date.UTC(2026,10,10,5,35),signal={id:'stale',symbol:'ICNTUSDT',timeMs:Date.UTC(2026,10,6,7,45),timeLabel:'2026-11-06 15:45:00',fallbackZone:'',freshCatch:true};
 const original=JSON.stringify(signal);
 render(<FishPanel {...props} signals={[signal]} progress={{...initialFishProgress(),anchorMs:anchor,cutoffMs:anchor,lookbackHours:1,status:'complete'}}/>);
 const range = screen.getByTestId('fish-scan-window');
 expect(range).toHaveTextContent(/^2026-11-10 12:35:00 ～ 13:35:00$/);
 expect(range).toHaveAttribute('title','2026-11-10 12:35:00 ～ 2026-11-10 13:35:00（UTC+8）');
 expect(within(screen.getByTestId('fish-new')).queryByText('ICNTUSDT')).toBeNull();
 expect(screen.getByTestId('fish-old')).toHaveTextContent('1');expect(JSON.stringify(signal)).toBe(original);
});
