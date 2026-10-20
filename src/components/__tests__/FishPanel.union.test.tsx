// 【用户要求】2026-10-19「多重选择除了交集，再增加一种并集（即，只要符合其中一个算法的，都留下）」
import {beforeEach,it,expect,vi} from 'vitest';
import {fireEvent,render,screen,cleanup} from '@testing-library/react';
import {FishPanel} from '@/components/FishPanel';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {saveFishPreference} from '@/lib/fish/preferences';
vi.mock('@/hooks/useFishFeatures',()=>({useFishFeatures:()=>[CBI2_DEF]}));
const start=vi.fn(),diagnose=vi.fn(async(_o:any)=>({outcome:'hit' as const,lines:['ok']}));
const panel=()=><FishPanel onDiagnose={diagnose} signals={[]} progress={null} inputs={{time:'',threshold:'.3'}} onInputsChange={()=>{}} selection={{exchanges:['binance'],includeDuplicates:false}} onSelectionChange={()=>{}} onStart={start} onCancel={()=>{}} onAdd={()=>{}} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>;
beforeEach(()=>{localStorage.clear();sessionStorage.clear();start.mockClear();saveFishPreference('cbi2',{statistic:'结果',direction:'>',threshold:'0.3',constraints:[]});});
it('两个及以上算法时可选交集 / 并集：默认交集；选并集后规则写「或」、开始捕捞与查单个币都带上；跟账号记住',async()=>{
 render(panel());expect(screen.queryByLabelText('多重算法合并方式')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'+ 算法'}));const mode=screen.getByLabelText('多重算法合并方式');expect([...mode.querySelectorAll('option')].map(o=>o.textContent)).toEqual(['交集','并集']);expect(screen.queryByText('多重算法',{exact:true})).toBeNull();expect(mode).toHaveValue('and');expect(screen.getByTestId('fish-rule')).toHaveTextContent(' 且 ');
 fireEvent.change(mode,{target:{value:'or'}});expect(screen.getByTestId('fish-rule')).toHaveTextContent(' 或 ');expect(screen.getByTestId('fish-rule')).not.toHaveTextContent(' 且 ');
 fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));await vi.waitFor(()=>expect(start).toHaveBeenCalled());expect(start.mock.calls[0][0]).toMatchObject({combination:'or'});expect(start.mock.calls[0][0].algorithms).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'查单个币'}));fireEvent.change(screen.getByLabelText('查单个币的标的'),{target:{value:'AAA'}});fireEvent.click(screen.getByRole('button',{name:'查'}));await vi.waitFor(()=>expect(diagnose).toHaveBeenCalled());expect(diagnose.mock.calls[0][0]).toMatchObject({combination:'or'});
 cleanup();render(panel());expect(screen.getByLabelText('多重算法合并方式')).toHaveValue('or');
});
