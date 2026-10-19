import {beforeEach,describe,it,expect,vi} from 'vitest';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {useState} from 'react';
import {FishPanel,type FishPanelProps} from '@/components/FishPanel';
import {FEATURES_KEY,CBI2_DEF,type DeepDigFeatureDef} from '@/lib/deepDig/features';
import {getUserPrefix} from '@/lib/userStoragePrefix';
import {notifyPersistedStateHydrated} from '@/lib/persistedStateStorage';
import {readFishPreference} from '@/lib/fish/preferences';
const start=vi.fn(),custom:DeepDigFeatureDef={...CBI2_DEF,id:'custom-fish',short:'Z',name:'新增特征',formula:'z = C',scale:2,unit:'点',builtin:false};
function Harness(){const [inputs,onInputsChange]=useState({time:'',threshold:'.3'}),[selection,onSelectionChange]=useState<FishPanelProps['selection']>({exchanges:['binance'],includeDuplicates:false});return <FishPanel signals={[]} progress={null} inputs={inputs} onInputsChange={onInputsChange} selection={selection} onSelectionChange={onSelectionChange} onStart={start} onCancel={()=>{}} onAdd={()=>{}} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>;}
const save=(defs:DeepDigFeatureDef[])=>{const key=getUserPrefix()+FEATURES_KEY;localStorage.setItem(key,JSON.stringify(defs));act(()=>notifyPersistedStateHydrated(key));};
beforeEach(()=>{localStorage.clear();start.mockReset();});
describe('渔的通用算法设置',()=>{
 it('共享目录：新增项出现，removed消失，错误公式和超5000根置灰并显示原因；默认CBI2缺失选第一项',()=>{
  render(<Harness/>);expect(screen.getByLabelText('捕捞算法')).toHaveValue('cbi2');save([custom,{...custom,id:'bad',name:'错误公式',formula:'missing_name'},{...custom,id:'huge',name:'过长历史',formula:'avg(C,10000)'}]);expect(screen.getByRole('option',{name:/Z · 新增特征/})).toBeEnabled();expect(screen.getByRole('option',{name:/错误公式/})).toBeDisabled();expect(screen.getByRole('option',{name:/过长历史/})).toHaveTextContent('5000');save([{...CBI2_DEF,removed:true},{...custom,removed:true}]);expect(screen.queryByRole('option',{name:/新增特征/})).not.toBeInTheDocument();expect(screen.getByLabelText('捕捞算法')).toHaveValue('drift-speed');
 });
 it('每个特征单独记方向、阈值（不再有外层 avg 的 H）；其它指标必须填写阈值；超出旧±1范围仍可扫',()=>{
  save([custom]);render(<Harness/>);fireEvent.change(screen.getByLabelText('捕捞算法'),{target:{value:custom.id}});expect(screen.getByLabelText('捕捞阈值')).toHaveValue(null);expect(screen.getByRole('button',{name:'开始捕捞'})).toBeDisabled();fireEvent.change(screen.getByLabelText('捕捞阈值'),{target:{value:'100'}});expect(screen.queryByLabelText('捕捞平均时长')).toBeNull();fireEvent.change(screen.getByLabelText('捕捞方向'),{target:{value:'<'}});fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));expect(start).toHaveBeenCalledWith(expect.objectContaining({feature:expect.objectContaining({id:custom.id}),algorithm:expect.objectContaining({direction:'<',threshold:100})}));expect(start.mock.calls[0][0].algorithm.H).toBeUndefined();expect(readFishPreference(custom.id)).toMatchObject({threshold:'100',direction:'<'});fireEvent.change(screen.getByLabelText('捕捞算法'),{target:{value:'cbi2'}});expect(screen.getByLabelText('捕捞阈值')).toHaveValue(.3);fireEvent.change(screen.getByLabelText('捕捞算法'),{target:{value:custom.id}});expect(screen.getByLabelText('捕捞阈值')).toHaveValue(100);
 });
 it('预设可编辑、逐条停用/删除；错误行中文提示且禁用开始，停用不参与判定',()=>{
  render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:/附加约束/}));fireEvent.change(screen.getByLabelText('添加约束预设'),{target:{value:'0'}});expect(screen.getAllByRole('checkbox',{name:/启用约束/})).toHaveLength(5);expect(screen.getByTestId('fish-rule')).toHaveTextContent('且 5 条约束');fireEvent.change(screen.getByLabelText('约束 1',{exact:true}),{target:{value:'X >'}});expect(screen.getByRole('button',{name:'开始捕捞'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('行');fireEvent.click(screen.getByLabelText('启用约束 1'));expect(screen.getByRole('button',{name:'开始捕捞'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'删除约束 1'}));expect(screen.getAllByRole('checkbox',{name:/启用约束/})).toHaveLength(4);fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));expect(start.mock.calls[0][0].algorithm.constraints).toHaveLength(4);
 });
});

it('美股范围默认勾选，用户可关闭并传入冻结的本轮设置',()=>{render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'捕捞范围'}));expect(screen.getByRole('checkbox',{name:'美股'})).toBeChecked();fireEvent.click(screen.getByRole('checkbox',{name:'美股'}));fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));expect(start).toHaveBeenCalledWith(expect.objectContaining({includeUsStocks:false}));});
