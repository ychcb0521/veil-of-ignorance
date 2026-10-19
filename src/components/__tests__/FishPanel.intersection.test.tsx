import {beforeEach,it,expect,vi} from 'vitest';
import {fireEvent,render,screen,cleanup} from '@testing-library/react';
import {FishPanel,type FishPanelProps} from '@/components/FishPanel';
import {CBI2_DEF} from '@/lib/deepDig/features';
vi.mock('@/hooks/useFishFeatures',()=>({useFishFeatures:()=>[CBI2_DEF]}));
import {initialFishProgress} from '@/lib/fishScanner';
import {saveFishPreference} from '@/lib/fish/preferences';
const start=vi.fn();
function panel(progress:FishPanelProps['progress']=null){return <FishPanel signals={[]} progress={progress} inputs={{time:'',threshold:'.3'}} onInputsChange={()=>{}} selection={{exchanges:['binance'],includeDuplicates:false}} onSelectionChange={()=>{}} onStart={start} onCancel={()=>{}} onAdd={()=>{}} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>;}
// 阈值默认留空（等信号库的建议填，或手动输入）；这里按用户已给 CBI-2 填过 0.3
beforeEach(()=>{localStorage.clear();sessionStorage.clear();start.mockClear();saveFishPreference('cbi2',{statistic:'结果',direction:'>',threshold:'0.3',constraints:[]});});
it('按顺序保存独立卡片，停用、删除、最多六个与扫描锁定',()=>{const view=render(panel());fireEvent.click(screen.getByRole('button',{name:'+ 算法'}));fireEvent.change(screen.getByLabelText('算法 2 阈值'),{target:{value:'0.7'}});fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));expect(start.mock.calls[0][0].algorithms.map(a=>a.algorithm.threshold)).toEqual([.3,.7]);cleanup();render(panel());expect(screen.getByLabelText('算法 2 阈值')).toHaveValue(.7);fireEvent.click(screen.getByLabelText('启用算法 2',{selector:'input'}));fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));expect(start.mock.calls.at(-1)[0].algorithms).toHaveLength(1);for(let i=0;i<4;i++)fireEvent.click(screen.getByRole('button',{name:'+ 算法'}));expect(screen.getByRole('button',{name:'+ 算法'})).toBeDisabled();cleanup();const next=render(panel({...initialFishProgress(),algorithmHits:[3,2],counts:{...initialFishProgress().counts,hit:1}}));expect(screen.getByLabelText('算法 2 阈值')).toBeDisabled();expect(screen.getByRole('button',{name:'+ 算法'})).toBeDisabled();expect(screen.getByTestId('fish-status')).toHaveTextContent('命中 1');expect(screen.getByTestId('fish-status')).toHaveAttribute('title','算法 1 命中 3；算法 2 命中 2');},30000);
