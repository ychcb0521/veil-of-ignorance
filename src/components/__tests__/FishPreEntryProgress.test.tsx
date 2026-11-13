import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import * as screening from '@/lib/fish/qualityScreeningResults';
import {FishPreEntryProgress} from '../FishPreEntryProgress';
import {emptyPreEntryLibrary,type PreEntryRecord} from '@/lib/fish/preEntryMonitor';
import type {FishQualityState} from '@/hooks/useFishQuality';
const T=Date.UTC(2026,10,8),statuses=['matched','unmatched','warming','error','paused','queued','scanning'] as const;
function monitor():NonNullable<FishQualityState['preEntry']>{
 const records:PreEntryRecord[]=statuses.map((status,i)=>({id:status,roundId:'r',status,startTime:T,cursor:T+60000,matchedAt:status==='matched'?T+60000:undefined,updatedAt:T+60000,readings:[],detail:'原因-'+status,sample:{id:status,source:{id:status,symbol:`TEST${i}USDT`,timeMs:T,timeLabel:'',fallbackZone:''},enteredAt:T,basis:'signal',groups:[],importedAt:T}}));
 return {library:{...emptyPreEntryLibrary(),rounds:[{id:'r',state:'running',startedAt:T,updatedAt:T,filters:[],hours:0}],records},ready:true,running:true,progress:{done:4,total:7,current:'TEST6USDT'},error:'',retry:vi.fn()} as unknown as NonNullable<FishQualityState['preEntry']>;
}
afterEach(cleanup);
it('shows a cancellable cooldown as waiting for automatic continuation without changing outcomes',()=>{
 const state=monitor(),before=structuredClone(state.library);state.progress={...state.progress!,waitingUntil:T+180000};
 render(<FishPreEntryProgress monitor={state}/>);expect(screen.getByRole('status')).toHaveTextContent('等待续跑');expect(screen.getByLabelText('查看本轮筛选结果')).toHaveAttribute('title',expect.stringContaining('后自动继续'));expect(state.library).toEqual(before);
});
it('keeps the module row to simple live progress and puts verbose details in the result dialog',()=>{
 const state=monitor(),view=render(<FishPreEntryProgress monitor={state}/>);
 const status=screen.getByRole('status');expect(status).toHaveTextContent('筛选进行中');expect(status).toHaveTextContent('4 / 7');expect(status).not.toHaveTextContent('入选');expect(screen.queryByText('TEST6USDT')).not.toBeInTheDocument();expect(screen.queryByText(/扫描到 2026/)).not.toBeInTheDocument();
 expect(screen.getByTestId('pre-entry-hit-count')).toHaveTextContent('命中 1');
 expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','4');expect(screen.queryByText('本轮结果')).not.toBeInTheDocument();
 const next=structuredClone(state.library);next.records[6]={...next.records[6],status:'matched',cursor:T+120000,matchedAt:T+120000};view.rerender(<FishPreEntryProgress monitor={{...state,library:next}}/>);
 expect(screen.getByTestId('pre-entry-hit-count')).toHaveTextContent('命中 2');
 expect(screen.getByRole('status')).toHaveTextContent('5 / 7');fireEvent.click(screen.getByLabelText('查看本轮筛选结果'));expect(within(screen.getByRole('dialog')).getByText(/入选 2 · 未入选/)).toBeInTheDocument();
});
it('opens every outcome, including rejected, waiting and missing-data records, while running',()=>{
 const state=monitor(),before=structuredClone(state.library);render(<FishPreEntryProgress monitor={state}/>);fireEvent.click(screen.getByLabelText('查看本轮筛选结果'));
 const dialog=screen.getByRole('dialog');expect(within(dialog).getAllByTestId('pre-entry-current-result-row')).toHaveLength(7);
 for(const label of ['已入选','未入选','历史不足','缺数据','已暂停','待筛选','筛选中'])expect(within(dialog).getByText(label)).toBeInTheDocument();
 expect(within(dialog).getByText('原因-error')).toBeInTheDocument();expect(state.library).toEqual(before);
});
it('hides the whole progress strip when paused or complete, while preserving results for the menu dialog',()=>{
 const state=monitor();state.running=false;state.progress=null;state.library.rounds[0].state='paused';const before=structuredClone(state.library),view=render(<FishPreEntryProgress monitor={state}/>);
 expect(screen.queryByTestId('pre-entry-progress')).not.toBeInTheDocument();expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();expect(screen.queryByText('4 / 7')).not.toBeInTheDocument();
 expect(screen.queryByTestId('pre-entry-hit-count')).not.toBeInTheDocument();
 view.rerender(<FishPreEntryProgress monitor={state} open/>);
 expect(screen.getByRole('dialog')).toHaveTextContent('已暂停');expect(screen.getAllByTestId('pre-entry-current-result-row')).toHaveLength(7);expect(state.library).toEqual(before);
 view.rerender(<FishPreEntryProgress monitor={{...state,library:{...state.library,rounds:[{...state.library.rounds[0],state:'complete'}]}}} open={false}/>);
 expect(screen.queryByTestId('pre-entry-progress')).not.toBeInTheDocument();expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 expect(screen.queryByTestId('pre-entry-hit-count')).not.toBeInTheDocument();
});
it('follows the active older round when resumed rather than presenting newer archived outcomes',()=>{
 const state=monitor();state.library.rounds.push({id:'newer',state:'complete',startedAt:T+1,updatedAt:T+1,filters:[],hours:1});render(<FishPreEntryProgress monitor={state}/>);
 expect(screen.getByRole('status')).toHaveTextContent('4 / 7');fireEvent.click(screen.getByLabelText('查看本轮筛选结果'));expect(within(screen.getByRole('dialog')).getAllByTestId('pre-entry-current-result-row')).toHaveLength(7);
});
it('shows preparation and loading errors directly even when no result has been admitted',()=>{
 const state=monitor();state.library.records=[];render(<FishPreEntryProgress monitor={{...state,ready:false,error:'本机存储读取失败'}}/>);
 expect(screen.getByRole('status')).toHaveTextContent('筛选异常');expect(screen.queryByRole('alert')).not.toBeInTheDocument();fireEvent.click(screen.getByLabelText('查看筛选错误'));expect(screen.getByRole('alert')).toHaveTextContent('本机存储读取失败');fireEvent.click(screen.getByText('重试读取'));expect(state.retry).toHaveBeenCalledOnce();
});

it('does no result-row formatting while closed and bounds open rows without dropping outcomes',()=>{
 const state=monitor(),base=state.library.records[0];
 state.library.records=Array.from({length:2500},(_,i)=>({...base,id:String(i),sample:{...base.sample,source:{...base.sample.source,symbol:`LOAD${i}USDT`}}}));
 const formatter=vi.spyOn(screening,'screeningCell');
 const view=render(<FishPreEntryProgress monitor={state}/>);
 expect(formatter).not.toHaveBeenCalled();
 view.rerender(<FishPreEntryProgress monitor={{...state,progress:{done:1,total:2500,current:'LOAD1USDT'}}}/>);
 expect(formatter).not.toHaveBeenCalled();
 fireEvent.click(screen.getByLabelText('查看本轮筛选结果'));
 expect(screen.getAllByTestId('pre-entry-current-result-row')).toHaveLength(100);
 expect(screen.getByRole('navigation',{name:'筛选结果分页'})).toHaveTextContent('共 2500 项');
 expect(screen.getByText('LOAD0USDT')).toBeInTheDocument();
 fireEvent.click(screen.getByText('下一页'));expect(screen.getByText('LOAD100USDT')).toBeInTheDocument();
 expect(screen.queryByText('LOAD0USDT')).not.toBeInTheDocument();
 fireEvent.click(screen.getByText('上一页'));expect(screen.getByText('LOAD0USDT')).toBeInTheDocument();
 formatter.mockRestore();
});
