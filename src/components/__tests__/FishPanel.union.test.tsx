// 【用户要求】2026-10-19「多重选择除了交集，再增加一种并集（即，只要符合其中一个算法的，都留下）」
import {beforeEach,it,expect,vi} from 'vitest';
import {fireEvent,render,screen,cleanup,within} from '@testing-library/react';
import {FishPanel} from '@/components/FishPanel';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {saveFishPreference} from '@/lib/fish/preferences';
import {initialFishProgress} from '@/lib/fishScanner';
vi.mock('@/hooks/useFishFeatures',()=>({useFishFeatures:()=>[CBI2_DEF]}));
const start=vi.fn(),diagnose=vi.fn(async(_o:any)=>({outcome:'hit' as const,lines:['ok']}));
const panel=()=><FishPanel onDiagnose={diagnose} signals={[]} progress={null} inputs={{time:'',threshold:'.3'}} onInputsChange={()=>{}} selection={{exchanges:['binance'],includeDuplicates:false}} onSelectionChange={()=>{}} onStart={start} onCancel={()=>{}} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>;
beforeEach(()=>{localStorage.clear();sessionStorage.clear();start.mockClear();saveFishPreference('cbi2',{statistic:'结果',direction:'>',threshold:'0.3',constraints:[]});});
const rule=()=>{const b=screen.getByRole('button',{name:'组合说明'});if(b.getAttribute('aria-expanded')!=='true')fireEvent.click(b);return screen.getByTestId('fish-rule');};
it('两个及以上算法时可选交集 / 并集：默认交集；选并集后规则写「或」、开始捕捞与查单个币都带上；跟账号记住',async()=>{
 render(panel());expect(screen.queryByLabelText('多重算法合并方式')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'+ 算法'}));const mode=screen.getByRole('radiogroup',{name:'多重算法合并方式'});expect(within(mode).getAllByRole('radio').map(o=>o.textContent)).toEqual(['交集','并集']);expect(screen.queryByText('多重算法',{exact:true})).toBeNull();expect(within(mode).getByRole('radio',{name:'交集'})).toHaveAttribute('aria-checked','true');expect(rule()).toHaveTextContent(' 且 ');
 fireEvent.click(within(mode).getByRole('radio',{name:'并集'}));expect(rule()).toHaveTextContent(' 或 ');expect(rule()).not.toHaveTextContent(' 且 ');
 fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));await vi.waitFor(()=>expect(start).toHaveBeenCalled());expect(start.mock.calls[0][0]).toMatchObject({combination:'or'});expect(start.mock.calls[0][0].algorithms).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'更多'}));fireEvent.click(screen.getByRole('button',{name:'查单个币'}));fireEvent.change(screen.getByLabelText('查单个币的标的'),{target:{value:'AAA'}});fireEvent.click(screen.getByRole('button',{name:'查'}));await vi.waitFor(()=>expect(diagnose).toHaveBeenCalled());expect(diagnose.mock.calls[0][0]).toMatchObject({combination:'or'});
 cleanup();render(panel());expect(screen.getByRole('radio',{name:'并集'})).toHaveAttribute('aria-checked','true');
});

// 【用户要求】2026-10-20「渔中的这个 x 也放在 … 中」
it('删除算法收在每张卡的「…」里：卡片上不再有单独的 ×，点「…」再点「删除这个算法」才删除',async()=>{
 render(panel());fireEvent.click(screen.getByRole('button',{name:'+ 算法'}));
 expect(screen.queryByRole('button',{name:'删除算法 2'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'算法 2 的更多操作'}));
 fireEvent.click(await screen.findByRole('button',{name:'删除算法 2'}));
 expect(screen.queryByRole('group',{name:'算法 2'})).toBeNull();
});
// 【用户要求】2026-10-21「我希望捕捞运行的过程中，我也可以灵活切换到并集」
it('捕捞中交集 / 并集仍可点，点了就切过去（并记住）；建议计算等别的任务进行时仍锁住',()=>{
 const live=vi.fn(()=>true);
 const running={...initialFishProgress(),status:'running' as const};
 const view=render(<FishPanel onLiveCombination={live} onDiagnose={diagnose} signals={[]} progress={null} inputs={{time:'',threshold:'.3'}} onInputsChange={()=>{}} selection={{exchanges:['binance'],includeDuplicates:false}} onSelectionChange={()=>{}} onStart={start} onCancel={()=>{}} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>);
 fireEvent.click(screen.getByRole('button',{name:'+ 算法'}));
 view.rerender(<FishPanel onLiveCombination={live} onDiagnose={diagnose} signals={[]} progress={running} inputs={{time:'',threshold:'.3'}} onInputsChange={()=>{}} selection={{exchanges:['binance'],includeDuplicates:false}} onSelectionChange={()=>{}} onStart={start} onCancel={()=>{}} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>);
 const union=screen.getByRole('radio',{name:'并集'});expect(union).not.toBeDisabled();
 fireEvent.click(union);expect(live).toHaveBeenCalledWith('or');expect(union).toHaveAttribute('aria-checked','true');
 fireEvent.click(union);expect(live).toHaveBeenCalledTimes(1);
});
