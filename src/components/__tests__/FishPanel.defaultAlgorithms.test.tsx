import {beforeEach,it,expect,vi} from 'vitest';
import {fireEvent,render,screen,cleanup} from '@testing-library/react';
import {FishPanel,FISH_DEFAULT_ALGORITHMS} from '@/components/FishPanel';
import {BSS_DEF,CBA_DEF,CDA_DEF,CBI2_DEF,CBI_DEF,DRIFT_SPEED_Z_DEF,STATE_DEF,type DeepDigFeatureDef} from '@/lib/deepDig/features';
import {fishFeatureDefinitions} from '@/lib/fish/features';
const defs=vi.hoisted(()=>({list:[] as DeepDigFeatureDef[]}));
vi.mock('@/hooks/useFishFeatures',()=>({useFishFeatures:()=>defs.list}));
const start=vi.fn();
const panel=(extra:object={})=><FishPanel defaultAlgorithms={FISH_DEFAULT_ALGORITHMS} signals={[]} progress={null} inputs={{time:'',threshold:''}} onInputsChange={()=>{}} selection={{exchanges:['binance'],includeDuplicates:false}} onSelectionChange={()=>{}} onStart={start} onCancel={()=>{}} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()} {...extra}/>;
const features=()=>[1,2,3,4,5,6].flatMap(i=>{const el=screen.queryByLabelText(i===1?'捕捞算法':`算法 ${i} 特征值`,{selector:'select'});return el?[(el as HTMLSelectElement).value]:[];});
beforeEach(()=>{localStorage.clear();sessionStorage.clear();start.mockClear();defs.list=fishFeatureDefinitions([CBI2_DEF,CBI_DEF,CBA_DEF,DRIFT_SPEED_Z_DEF,CDA_DEF,BSS_DEF,STATE_DEF]);});
it('默认四条规则全部勾选，开始捕捞使用截图的阈值、序列和交集',async()=>{
 render(panel());
 expect(FISH_DEFAULT_ALGORITHMS).toEqual(['cbi2','cba','cbi2','cba']);
 expect(features()).toEqual(['cbi2','cba','cbi2','cba']);
 for(const i of [1,2,3,4])expect(screen.getByLabelText(`启用算法 ${i}`,{selector:'input'})).toBeChecked();
 expect(screen.queryByLabelText('启用算法 5',{selector:'input'})).toBeNull();
 expect([screen.getByLabelText('捕捞阈值'),...[2,3,4].map(i=>screen.getByLabelText(`算法 ${i} 阈值`))].map(e=>(e as HTMLInputElement).value)).toEqual(['0.04','8','0.04','8']);
 expect(screen.queryByRole('alert')).toBeNull();
 expect(screen.getByLabelText('算法 2 统计量')).toHaveValue('avg_CBA_2');
 expect((screen.getByLabelText('算法 2 特征值') as HTMLSelectElement).selectedOptions[0].label).toBe('CBA·avg₂');
 expect(screen.getByLabelText('算法 3 统计量')).toHaveValue('avg_CBI2');
 expect(screen.getByLabelText('算法 4 统计量')).toHaveValue('avg_CBA');
 expect(screen.queryByTestId('fish-rule')).toBeNull();
 for(const i of [1,2,3,4])expect(screen.getByRole('button',{name:`算法 ${i} 说明`})).toBeVisible();
 expect(screen.getByRole('radio',{name:'交集'})).toHaveAttribute('aria-checked','true');
 fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
 await vi.waitFor(()=>expect(start).toHaveBeenCalled());
 expect(start.mock.calls[0][0].combination).toBe('and');
 expect(start.mock.calls[0][0].algorithms.map((a:{feature:DeepDigFeatureDef})=>a.feature.id)).toEqual(['cbi2','cba','cbi2','cba']);
});
it('重新打开保留手动增删、勾选、阈值和组合',()=>{
 render(panel());
 fireEvent.change(screen.getByLabelText('算法 2 阈值'),{target:{value:'12'}});
 fireEvent.click(screen.getByLabelText('启用算法 2',{selector:'input'}));
 fireEvent.click(screen.getByRole('radio',{name:'并集'}));
 fireEvent.click(screen.getByRole('button',{name:'算法 4 的更多操作'}));fireEvent.click(screen.getByRole('button',{name:'删除算法 4'}));
 fireEvent.click(screen.getByRole('button',{name:'+ 算法'}));
 cleanup();render(panel());
 expect(features()).toEqual(['cbi2','cba','cbi2','cbi2']);
 expect(screen.getByLabelText('启用算法 2',{selector:'input'})).not.toBeChecked();
 expect(screen.getByLabelText('算法 2 阈值')).toHaveValue(12);
 expect(screen.getByRole('radio',{name:'并集'})).toHaveAttribute('aria-checked','true');
});
it('Deep dig 里删掉的算法跳过；不传 defaultAlgorithms 时仍恢复上次保存的卡片',()=>{
 defs.list=defs.list.filter(d=>d.id!=='cba');render(panel());expect(features()).toEqual(['cbi2','cbi2']);
 cleanup();render(panel({defaultAlgorithms:undefined}));expect(features()).toEqual(['cbi2','cbi2']);
 fireEvent.click(screen.getByRole('button',{name:'算法 2 的更多操作'}));fireEvent.click(screen.getByRole('button',{name:'删除算法 2'}));
 cleanup();render(panel({defaultAlgorithms:undefined}));expect(features()).toEqual(['cbi2']);
});
it('刷新后恢复上一轮：打开时不按默认卡重新合并（新鱼不变），用户改了勾选才重新合并',()=>{
 const recombine=vi.fn(()=>true);
 render(panel({hasRound:true,onRecombine:recombine,progress:{status:'complete',total:1,done:1,current:'',cutoffMs:1,counts:{hit:1,below:0,unknown:0,gap:0,readings:0,failed:0}}}));
 expect(recombine).not.toHaveBeenCalled();
 fireEvent.click(screen.getByLabelText('启用算法 2',{selector:'input'}));
 expect(recombine).toHaveBeenCalledTimes(1);
});

it('CBA·avg₂ 卡修改阈值后刷新仍保留，avg 卡不受影响',()=>{
 render(panel());
 fireEvent.change(screen.getByLabelText('算法 2 阈值'),{target:{value:'12'}});
 cleanup();render(panel());
 expect(screen.getByLabelText('算法 2 统计量')).toHaveValue('avg_CBA_2');
 expect(screen.getByLabelText('算法 2 阈值')).toHaveValue(12);
 expect(screen.getByLabelText('算法 4 阈值')).toHaveValue(8);
});

it('捕捞、鱼舱、鱼质量是三个同级模块，独立折叠', async () => {
 const {newQualityStudy}=await import('@/lib/fish/quality');
 const {enableQualityComparison}=await import('@/lib/fish/qualityComparison');
 const q={study:enableQualityComparison(newQualityStudy()),ready:true,running:false,progress:null,warning:'',error:'',start:vi.fn(),cancel:vi.fn(),setRule:vi.fn(),setObserveHours:vi.fn(),selectSell:vi.fn(),setSelectedRows:vi.fn()};
 render(panel({quality:q}));
 const host=screen.getByTestId('fish-panel');
 for(const id of ['fish-catching','fish-cabin','fish-quality'])expect(screen.getByTestId(id).parentElement).toBe(host);
 fireEvent.click(screen.getByRole('button',{name:'捕捞'}));
 expect(screen.getByRole('button',{name:/^鱼质量/,expanded:true})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:/^鱼质量/,expanded:true}));
 expect(screen.getByRole('button',{name:/^鱼舱/})).toBeVisible();
});

it('邮件来源展示实际捕捞序列与已保存的额外来源，打开或调整捕捞阈值不会覆盖邮件选择',()=>{
 const source={key:JSON.stringify(['drift-speed-z','avg_a_2']),label:'DSP·a·avg₂'};
 const notify={config:{enabled:false,emails:[],serviceId:'',templateId:'',publicKey:'',sourceAlgorithms:[source],sourceCombination:'or' as const},status:null,sending:false,update:vi.fn(),send:vi.fn(),test:vi.fn()};
 render(panel({notify}));
 fireEvent.click(screen.getByRole('button',{name:'更多'}));
 fireEvent.click(screen.getByTestId('fish-notify-toggle'));
 fireEvent.click(screen.getByText(/来源算法 ·/));
 expect(screen.getByRole('checkbox',{name:'邮件来源：DSP·a·avg₂'})).toBeChecked();
 expect(screen.getByRole('checkbox',{name:'邮件来源：CBI-2·avg₂'})).not.toBeChecked();
 expect(screen.getByRole('checkbox',{name:'邮件来源：CBI-2·avg'})).not.toBeChecked();
 expect(screen.getByRole('checkbox',{name:'邮件来源：CBA·avg'})).not.toBeChecked();
 fireEvent.change(screen.getByLabelText('算法 2 阈值'),{target:{value:'12'}});
 expect(notify.update).not.toHaveBeenCalled();
 expect(screen.getByRole('checkbox',{name:'邮件来源：DSP·a·avg₂'})).toBeChecked();
},15_000);
