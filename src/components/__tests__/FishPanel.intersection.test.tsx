import {beforeEach,it,expect,vi} from 'vitest';
import {fireEvent,render,screen,cleanup} from '@testing-library/react';
import {FishPanel,type FishPanelProps} from '@/components/FishPanel';
import {CBI2_DEF} from '@/lib/deepDig/features';
vi.mock('@/hooks/useFishFeatures',()=>({useFishFeatures:()=>[CBI2_DEF]}));
import {initialFishProgress} from '@/lib/fishScanner';
import {saveFishPreference} from '@/lib/fish/preferences';
import {compileFishProgram} from '@/lib/fish/algorithm';
const start=vi.fn();
function panel(progress:FishPanelProps['progress']=null){return <FishPanel signals={[]} progress={progress} inputs={{time:'',threshold:'.3'}} onInputsChange={()=>{}} selection={{exchanges:['binance'],includeDuplicates:false}} onSelectionChange={()=>{}} onStart={start} onCancel={()=>{}} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>;}
// 阈值默认留空（等信号库的建议填，或手动输入）；这里按用户已给 CBI-2 填过 0.3
beforeEach(()=>{localStorage.clear();sessionStorage.clear();start.mockClear();saveFishPreference('cbi2',{statistic:'结果',direction:'>',threshold:'0.3',constraints:[]});});
it('按顺序保存独立卡片，停用、删除、最多六个与扫描锁定',()=>{const view=render(panel());fireEvent.click(screen.getByRole('button',{name:'+ 算法'}));fireEvent.change(screen.getByLabelText('算法 2 阈值'),{target:{value:'0.7'}});fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));expect(start.mock.calls[0][0].algorithms.map(a=>a.algorithm.threshold)).toEqual([.3,.7]);cleanup();render(panel());expect(screen.getByLabelText('算法 2 阈值')).toHaveValue(.7);fireEvent.click(screen.getByLabelText('启用算法 2',{selector:'input'}));fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));expect(start.mock.calls.at(-1)[0].algorithms).toHaveLength(1);for(let i=0;i<4;i++)fireEvent.click(screen.getByRole('button',{name:'+ 算法'}));expect(screen.getByRole('button',{name:'+ 算法'})).toBeDisabled();cleanup();const next=render(panel({...initialFishProgress(),algorithmHits:[3,2],counts:{...initialFishProgress().counts,hit:1}}));expect(screen.getByLabelText('算法 2 阈值')).toBeDisabled();expect(screen.getByRole('button',{name:'+ 算法'})).toBeDisabled();expect(screen.getByTestId('fish-status')).toHaveTextContent('命中 1');expect(screen.getByTestId('fish-status')).toHaveAttribute('title','算法 1 命中 3；算法 3 命中 2');},30000);
it('自由组合：未勾选卡仍计算，扫后勾选和交并集触发本地重合并',()=>{
 const recombine=vi.fn((_mode:'and'|'or',_keys:readonly string[])=>true);
 const props={signals:[],inputs:{time:'',threshold:'.3'},onInputsChange:()=>{},selection:{exchanges:['binance'] as any,includeDuplicates:false},onSelectionChange:()=>{},onStart:start,onCancel:()=>{},onJump:()=>{},onDelete:()=>{},onRate:()=>{},jumpingSignalId:null,tradedDayIndex:new Set<string>(),campaignDayIndex:new Set<string>(),onRecombine:recombine};
 const view=render(<FishPanel {...props} progress={null}/>);
 fireEvent.click(screen.getByRole('button',{name:'+ 算法'}));fireEvent.change(screen.getByLabelText('算法 2 阈值'),{target:{value:'0.7'}});fireEvent.click(screen.getByLabelText('启用算法 2',{selector:'input'}));fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
 expect(start.mock.calls[0][0]).toMatchObject({retainMembers:true});expect(start.mock.calls[0][0].algorithms).toHaveLength(2);expect(start.mock.calls[0][0].displayAlgorithmKeys).toHaveLength(1);
 view.rerender(<FishPanel {...props} hasRound progress={{...initialFishProgress(),status:'complete'}}/>);
 fireEvent.click(screen.getByLabelText('启用算法 2',{selector:'input'}));expect(recombine.mock.calls.at(-1)?.[1]).toHaveLength(2);
 fireEvent.change(screen.getByLabelText('多重算法合并方式'),{target:{value:'or'}});expect(recombine.mock.calls.at(-1)?.[0]).toBe('or');
 fireEvent.click(screen.getByLabelText('启用算法 1',{selector:'input'}));fireEvent.click(screen.getByLabelText('启用算法 2',{selector:'input'}));expect(recombine.mock.calls.at(-1)?.[1]).toEqual([]);expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 fireEvent.click(screen.getByLabelText('启用算法 1',{selector:'input'}));recombine.mockReturnValue(false);fireEvent.change(screen.getByLabelText('捕捞阈值'),{target:{value:'.9'}});expect(screen.getByText(/上一轮没算过/)).toBeInTheDocument();
 view.rerender(<FishPanel {...props} hasRound progress={{...initialFishProgress(),status:'running'}}/>);expect(screen.queryByTestId('fish-stale-round')).not.toBeInTheDocument();
 expect(start).toHaveBeenCalledTimes(1);
},30000);
it('调严即时过滤；放宽时说明本轮按多少扫的、往哪边调能即时过滤',()=>{
 const recombine=vi.fn((_mode:'and'|'or',_keys:readonly string[],plans?:readonly any[])=>(plans?.[0]?.settings.threshold??0)>=0.3);
 const scanned=compileFishProgram(CBI2_DEF,{statistic:'结果',direction:'>',threshold:0.3,constraints:[]});
 const props={signals:[],inputs:{time:'',threshold:'.3'},onInputsChange:()=>{},selection:{exchanges:['binance'] as any,includeDuplicates:false},onSelectionChange:()=>{},onStart:start,onCancel:()=>{},onJump:()=>{},onDelete:()=>{},onRate:()=>{},jumpingSignalId:null,tradedDayIndex:new Set<string>(),campaignDayIndex:new Set<string>(),onRecombine:recombine,roundPlans:[scanned]};
 render(<FishPanel {...props} hasRound progress={{...initialFishProgress(),status:'complete'}}/>);
 fireEvent.change(screen.getByLabelText('捕捞阈值'),{target:{value:'0.5'}});
 expect(recombine.mock.calls.at(-1)?.[2]?.[0].settings.threshold).toBe(0.5);expect(screen.queryByTestId('fish-stale-round')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('捕捞阈值'),{target:{value:'0.1'}});
 expect(screen.getByTestId('fish-stale-round')).toHaveTextContent('算法 1 本轮按 > 0.3 扫过：阈值调大（≥ 0.3）可即时过滤，调小要重新捕捞');
 expect(start).not.toHaveBeenCalled();
});
