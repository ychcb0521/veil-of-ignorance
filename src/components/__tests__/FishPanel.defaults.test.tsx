import {beforeEach,it,expect,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {getUserPrefix} from '@/lib/userStoragePrefix';
import {FishPanel} from '@/components/FishPanel';
vi.mock('@/hooks/useFishFeatures',()=>({useFishFeatures:()=>['cbi2','bss','cba','drift-speed-z'].map(id=>({...CBI2_DEF,id}))}));
const panel=()=> <FishPanel signals={[]} progress={null} inputs={{time:'',threshold:''}} onInputsChange={()=>{}} selection={{exchanges:['binance'],includeDuplicates:false}} onSelectionChange={()=>{}} onStart={()=>{}} onCancel={()=>{}} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>;
beforeEach(()=>{localStorage.clear();sessionStorage.clear();});
it('截图中的四张旧卡首次恢复默认，手改后重新打开不再重置，卡片顺序与开关保留',()=>{
 const ids=['cbi2','bss','cba','drift-speed-z'];
 localStorage.setItem(getUserPrefix()+'fish-cards.v1',JSON.stringify(ids.map((featureId,i)=>({id:'old-'+i,featureId,enabled:i!==1,pref:{statistic:'结果',direction:'>',threshold:['.06','.1','10','15'][i],constraints:[]}}))));
 const view=render(panel());
 expect(screen.getByLabelText('捕捞阈值')).toHaveValue(.04);expect(screen.getByLabelText('算法 2 阈值')).toHaveValue(.12);expect(screen.getByLabelText('算法 3 阈值')).toHaveValue(8);expect(screen.getByLabelText('算法 4 阈值')).toHaveValue(15);
 expect(screen.getByLabelText('启用算法 2',{selector:'input'})).not.toBeChecked();
 fireEvent.change(screen.getByLabelText('算法 3 阈值'),{target:{value:'9'}});fireEvent.change(screen.getByLabelText('捕捞阈值'),{target:{value:'.05'}});
 view.unmount();render(panel());
 expect(screen.getByLabelText('捕捞阈值')).toHaveValue(.05);expect(screen.getByLabelText('算法 3 阈值')).toHaveValue(9);expect(screen.getByLabelText('算法 4 阈值')).toHaveValue(15);
 expect(screen.getByLabelText('启用算法 2',{selector:'input'})).not.toBeChecked();
});
