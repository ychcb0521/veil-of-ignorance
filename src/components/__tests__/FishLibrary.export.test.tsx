import {beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,within} from '@testing-library/react';
import {FishPanel} from '@/components/FishPanel';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {downloadFishCabin} from '@/lib/fish/export';
import type {TradeSignal} from '@/lib/signalLibrary';
vi.mock('@/hooks/useFishFeatures',()=>({useFishFeatures:()=>[CBI2_DEF]}));
vi.mock('@/lib/fish/export',()=>({downloadFishCabin:vi.fn()}));
const a:TradeSignal={id:'a',symbol:'AAAUSDT',timeMs:1,timeLabel:'',fallbackZone:''},b={...a,id:'b',symbol:'BBBUSDT'},fresh={...a,id:'fresh',symbol:'NEWUSDT',freshCatch:true};
const panel=(signals:TradeSignal[]) => <FishPanel signals={signals} progress={null} inputs={{time:'',threshold:''}} onInputsChange={()=>{}} selection={{exchanges:['binance'],includeDuplicates:false}} onSelectionChange={()=>{}} onStart={()=>{}} onCancel={()=>{}} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>;
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();localStorage.clear();});
it('one export entry belongs to the cabin, exports all stored fish despite filters, and hides its export while the cabin is collapsed',()=>{
 const view=render(panel([a,b,fresh]));
 const cabin=screen.getByTestId('fish-cabin');
 fireEvent.change(within(cabin).getByLabelText('筛选鱼舱信号'),{target:{value:'AAA'}});
 expect(within(cabin).queryByText('BBBUSDT')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'捕捞'}));
 fireEvent.click(within(cabin).getByRole('button',{name:'导出鱼舱数据'}));
 expect(downloadFishCabin).toHaveBeenLastCalledWith([a,b]);
 fireEvent.click(within(cabin).getByRole('button',{name:/^鱼舱/}));
 expect(within(cabin).queryByRole('button',{name:'导出鱼舱数据'})).toBeNull();expect(downloadFishCabin).toHaveBeenCalledTimes(1);
 fireEvent.click(within(cabin).getByRole('button',{name:/^鱼舱/}));
 fireEvent.click(within(cabin).getByRole('button',{name:'导出鱼舱数据'}));
 expect(downloadFishCabin).toHaveBeenCalledTimes(2);
 expect(screen.getAllByRole('button',{name:'导出鱼舱数据'})).toHaveLength(1);
 view.rerender(panel([fresh]));
 expect(within(cabin).getByRole('button',{name:'导出鱼舱数据'})).toBeDisabled();
});

it('鱼舱按实际捕捞时间双向排序，旧记录始终排在末尾', () => {
 const signals = [{ ...a, timeMs: 40, caughtAt: 200 }, { ...b, timeMs: 50, caughtAt: 100 }, { ...fresh, freshCatch: false, timeMs: 60 }];
 const view = render(panel(signals));
 const cabin = within(screen.getByTestId('fish-cabin'));
 const header = cabin.getByRole('button', { name: '捕捞时间' });
 const symbols = () => cabin.getAllByText(/^(AAA|BBB|NEW)USDT$/).map(node => node.textContent);
 expect(symbols()).toEqual(['NEWUSDT', 'BBBUSDT', 'AAAUSDT']);
 fireEvent.click(header);
 expect(header).toHaveAttribute('aria-sort', 'descending');
 expect(symbols()).toEqual(['AAAUSDT', 'BBBUSDT', 'NEWUSDT']);
 fireEvent.click(header);
 expect(header).toHaveAttribute('aria-sort', 'ascending');
 expect(symbols()).toEqual(['BBBUSDT', 'AAAUSDT', 'NEWUSDT']);
 view.unmount();
 render(panel(signals));
 expect(within(screen.getByTestId('fish-cabin')).getByRole('button', { name: '捕捞时间' })).toHaveAttribute('aria-sort', 'ascending');
});

it('新鱼和鱼舱在算法类型左侧显示实际列出的命中类型数量', () => {
 const base = { featureShort:'CBA', average:2, cbi2:2, startAverage:2, previousAverage:1, threshold:1, cutoffMs:2 };
 const result: TradeSignal = {...fresh,fish:{...base,combination:'or',hitAlgorithms:[1,3,4],algorithms:[
  base, {...base,featureShort:'未命中'}, {...base,featureShort:'BSS'}, {...base},
 ]}};
 render(panel([result,a]));
 const newList = within(screen.getByTestId('fish-new'));
 const cabin = within(screen.getByTestId('fish-cabin'));
 for (const list of [newList,cabin]) {
  const head = within(list.getByTestId('signal-library-header'));
  expect(head.getByText('算法数量').nextElementSibling).toBe(head.getByRole('button',{name:'算法类型'}));
 }
 expect(newList.getByTestId('fish-algorithm-count')).toHaveTextContent(/^2$/);
 expect(newList.getByTestId('fish-algorithm-type')).toHaveTextContent('CBA · BSS');
 expect(cabin.getByTestId('fish-algorithm-count')).toHaveTextContent(/^1$/);
});
