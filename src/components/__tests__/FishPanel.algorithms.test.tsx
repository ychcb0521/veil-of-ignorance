import {beforeEach,describe,it,expect,vi} from 'vitest';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {useState} from 'react';
import {FishPanel,type FishPanelProps} from '@/components/FishPanel';
import {FEATURES_KEY,CBI2_DEF,type DeepDigFeatureDef} from '@/lib/deepDig/features';
import {getUserPrefix} from '@/lib/userStoragePrefix';
import {notifyPersistedStateHydrated} from '@/lib/persistedStateStorage';
import {readFishPreference,saveFishPreference} from '@/lib/fish/preferences';
const start=vi.fn(),custom:DeepDigFeatureDef={...CBI2_DEF,id:'custom-fish',short:'Z',name:'新增特征',formula:'z = C',scale:2,unit:'点',builtin:false};
function Harness(){const [inputs,onInputsChange]=useState({time:'',threshold:'.3'}),[selection,onSelectionChange]=useState<FishPanelProps['selection']>({exchanges:['binance'],includeDuplicates:false});return <FishPanel signals={[]} progress={null} inputs={inputs} onInputsChange={onInputsChange} selection={selection} onSelectionChange={onSelectionChange} onStart={start} onCancel={()=>{}} onAdd={()=>{}} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>;}
const save=(defs:DeepDigFeatureDef[])=>{const key=getUserPrefix()+FEATURES_KEY;localStorage.setItem(key,JSON.stringify(defs));act(()=>notifyPersistedStateHydrated(key));};
// 阈值默认留空（等信号库的建议填，或手动输入）；这里按用户已给 CBI-2 填过 0.3 测其余流程
beforeEach(()=>{localStorage.clear();start.mockReset();saveFishPreference('cbi2',{statistic:'结果',direction:'>',threshold:'0.3',constraints:[]});});
describe('渔的通用算法设置',()=>{
 it('共享目录：新增项出现，removed消失，错误公式和超5000根置灰并显示原因；默认CBI2缺失选第一项',()=>{
  render(<Harness/>);expect(screen.getByLabelText('捕捞算法')).toHaveValue('cbi2');save([custom,{...custom,id:'bad',name:'错误公式',formula:'missing_name'},{...custom,id:'huge',name:'过长历史',formula:'avg(C,10000)'}]);expect(screen.getByRole('option',{name:/Z · 新增特征/})).toBeEnabled();expect(screen.getByRole('option',{name:/错误公式/})).toBeDisabled();expect(screen.getByRole('option',{name:/过长历史/})).toHaveTextContent('5000');save([{...CBI2_DEF,removed:true},{...custom,removed:true}]);expect(screen.queryByRole('option',{name:/新增特征/})).not.toBeInTheDocument();expect(screen.getByLabelText('捕捞算法')).toHaveValue('drift-speed');
 });
 it('每个特征单独记方向、阈值（不再有外层 avg 的 H）；其它指标必须填写阈值；超出旧±1范围仍可扫',()=>{
  save([custom]);render(<Harness/>);fireEvent.change(screen.getByLabelText('捕捞算法'),{target:{value:custom.id}});expect(screen.getByLabelText('捕捞阈值')).toHaveValue(null);expect(screen.getByRole('button',{name:'开始捕捞'})).toBeDisabled();fireEvent.change(screen.getByLabelText('捕捞阈值'),{target:{value:'100'}});expect(screen.queryByLabelText('捕捞平均时长')).toBeNull();fireEvent.change(screen.getByLabelText('捕捞方向'),{target:{value:'<'}});fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));expect(start).toHaveBeenCalledWith(expect.objectContaining({feature:expect.objectContaining({id:custom.id}),algorithm:expect.objectContaining({direction:'<',threshold:100})}));expect(start.mock.calls[0][0].algorithm.H).toBeUndefined();expect(readFishPreference(custom.id)).toMatchObject({threshold:'100',direction:'<'});fireEvent.change(screen.getByLabelText('捕捞算法'),{target:{value:'cbi2'}});expect(screen.getByLabelText('捕捞阈值')).toHaveValue(.3);fireEvent.change(screen.getByLabelText('捕捞算法'),{target:{value:custom.id}});expect(screen.getByLabelText('捕捞阈值')).toHaveValue(100);
 });
 it('移除约束入口，旧本机约束也不再进入任一算法的扫描设置',()=>{
  saveFishPreference('cbi2',{...readFishPreference('cbi2'),constraints:[{id:'legacy',text:'X >',enabled:true}]});
  localStorage.setItem(getUserPrefix()+'fish-cards.v1',JSON.stringify([{id:'a',featureId:'cbi2',enabled:true,pref:readFishPreference('cbi2')},{id:'b',featureId:'cbi2',enabled:true,pref:readFishPreference('cbi2')}]));
  render(<Harness/>);expect(screen.queryByText(/附加约束/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
  expect(start.mock.calls[0][0].algorithms).toHaveLength(2);
  for(const a of start.mock.calls[0][0].algorithms)expect(a.algorithm.constraints).toEqual([]);
 });
});

it('美股范围默认勾选，用户可关闭并传入冻结的本轮设置',()=>{render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'捕捞范围'}));expect(screen.getByRole('checkbox',{name:'美股'})).toBeChecked();fireEvent.click(screen.getByRole('checkbox',{name:'美股'}));fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));expect(start).toHaveBeenCalledWith(expect.objectContaining({includeUsStocks:false}));});
