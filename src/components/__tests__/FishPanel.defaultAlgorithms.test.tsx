// 【用户要求】2026-10-20「我希望渔默认为这四个算法，每次点开始都默认为这四个算法和顺序」
import {beforeEach,it,expect,vi} from 'vitest';
import {fireEvent,render,screen,cleanup,within} from '@testing-library/react';
import {FishPanel,FISH_DEFAULT_ALGORITHMS} from '@/components/FishPanel';
import {BSS_DEF,CBA_DEF,CBI2_DEF,CBI_DEF,DRIFT_SPEED_Z_DEF} from '@/lib/deepDig/features';
const avg=(d:any,n:string)=>({...d,formula:`${d.formula}\navg_${n} = avg(${n}, 24)`});
const defs=vi.hoisted(()=>({list:[] as any[]}));
vi.mock('@/hooks/useFishFeatures',()=>({useFishFeatures:()=>defs.list}));
const start=vi.fn();
const panel=(extra:object={})=><FishPanel defaultAlgorithms={FISH_DEFAULT_ALGORITHMS} signals={[]} progress={null} inputs={{time:'',threshold:''}} onInputsChange={()=>{}} selection={{exchanges:['binance'],includeDuplicates:false}} onSelectionChange={()=>{}} onStart={start} onCancel={()=>{}} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()} {...extra}/>;
const features=()=>[1,2,3,4,5,6].flatMap(i=>{const el=screen.queryByLabelText(i===1?'捕捞算法':`算法 ${i} 特征值`,{selector:'select'});return el?[(el as HTMLSelectElement).value]:[];});
beforeEach(()=>{localStorage.clear();sessionStorage.clear();start.mockClear();defs.list=[avg(CBI2_DEF,'CBI2'),CBI_DEF,DRIFT_SPEED_Z_DEF,avg(CBA_DEF,'CBA'),avg(BSS_DEF,'BSS')];});
it('默认四个算法：CBI-2 → DSP·a → CBA → BSS，全部勾选，默认门槛；开始捕捞按这个顺序带上四个',async()=>{
 render(panel());
 expect(FISH_DEFAULT_ALGORITHMS).toEqual(['cbi2','drift-speed-z','cba','bss']);
 expect(features()).toEqual(['cbi2','drift-speed-z','cba','bss']);
 for(const i of [1,2,3,4])expect(screen.getByLabelText(`启用算法 ${i}`,{selector:'input'})).toBeChecked();
 expect([screen.getByLabelText('捕捞阈值'),...[2,3,4].map(i=>screen.getByLabelText(`算法 ${i} 阈值`))].map(e=>(e as HTMLInputElement).value)).toEqual(['0.04','15','8','0.08']);
 expect(screen.queryByRole('alert')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
 await vi.waitFor(()=>expect(start).toHaveBeenCalled());
 expect(start.mock.calls[0][0].algorithms.map((a:any)=>a.feature.id)).toEqual(['cbi2','drift-speed-z','cba','bss']);
});
it('会话里增删、停用、换顺序都行；重新打开恢复成这四个与这个顺序，阈值沿用上次的',()=>{
 render(panel());
 fireEvent.change(screen.getByLabelText('算法 2 阈值'),{target:{value:'20'}});
 fireEvent.click(screen.getByLabelText('启用算法 3',{selector:'input'}));
 fireEvent.click(screen.getByRole('button',{name:'算法 4 的更多操作'}));fireEvent.click(screen.getByRole('button',{name:'删除算法 4'}));
 fireEvent.click(screen.getByRole('button',{name:'+ 算法'}));
 expect(features()).toEqual(['cbi2','drift-speed-z','cba','cbi2']);
 cleanup();render(panel());
 expect(features()).toEqual(['cbi2','drift-speed-z','cba','bss']);
 for(const i of [1,2,3,4])expect(screen.getByLabelText(`启用算法 ${i}`,{selector:'input'})).toBeChecked();
 expect(screen.getByLabelText('算法 2 阈值')).toHaveValue(20);expect(screen.getByLabelText('算法 4 阈值')).toHaveValue(.08);
});
it('Deep dig 里删掉的算法跳过；不传 defaultAlgorithms 时仍恢复上次保存的卡片',()=>{
 defs.list=defs.list.filter(d=>d.id!=='cba');render(panel());expect(features()).toEqual(['cbi2','drift-speed-z','bss']);
 cleanup();render(panel({defaultAlgorithms:undefined}));expect(features()).toEqual(['cbi2','drift-speed-z','bss']);
 fireEvent.click(screen.getByRole('button',{name:'算法 3 的更多操作'}));fireEvent.click(screen.getByRole('button',{name:'删除算法 3'}));
 cleanup();render(panel({defaultAlgorithms:undefined}));expect(features()).toEqual(['cbi2','drift-speed-z']);
});
it('刷新后恢复上一轮：打开时不按默认卡重新合并（新鱼不变），用户改了勾选才重新合并',()=>{
 const recombine=vi.fn(()=>true);
 render(panel({hasRound:true,onRecombine:recombine,progress:{status:'complete',total:1,done:1,current:'',cutoffMs:1,counts:{hit:1,below:0,unknown:0,gap:0,readings:0,failed:0}}}));
 expect(recombine).not.toHaveBeenCalled();
 fireEvent.click(screen.getByLabelText('启用算法 2',{selector:'input'}));
 expect(recombine).toHaveBeenCalledTimes(1);
});
