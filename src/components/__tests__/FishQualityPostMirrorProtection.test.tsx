import {useState} from 'react';
import {expect,it,vi} from 'vitest';
import {render,screen,fireEvent,within} from '@testing-library/react';
import {HoldingMonitorSettings} from '../FishHoldingMonitorSettings';
import {FishQualityMonitorSettingsView} from '../FishQualityMonitorSettingsView';
import {FishQualityHoldingVetoEditor} from '../FishQualityHoldingVetoEditor';
import {BUILTIN_FEATURES} from '@/lib/deepDig/features';
import {newQualityStudy,type QualityGroup} from '@/lib/fish/quality';
import {makeQualitySellPlan} from '@/lib/fish/qualitySellPlans';
import {makeQualityHoldingVeto,holdingVetoDraft,parseHoldingVetoDraft} from '@/lib/fish/qualityFilters';
import {POST_MIRROR_PROTECTION_VERSION as V} from '@/lib/fish/qualityPostMirrorProtection';
import type {FishQualityState} from '@/hooks/useFishQuality';
import type {QualityHoldingVeto} from '@/lib/fish/qualityVeto';

function fixture(){
 const first={...makeQualitySellPlan('state:state','<',.45,BUILTIN_FEATURES,undefined,'first'),label:'第一套',
  holdingVetoes:[makeQualityHoldingVeto('cda:CDA','<',-15,true,BUILTIN_FEATURES)],mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50}};
 const second={...structuredClone(first),id:'second',label:'第二套',holdingVetoes:undefined};
 const plans=[first,second];
 const state={study:{...newQualityStudy(),sellPlans:plans,sellPlansConfigured:true},ready:true,running:false,error:'',setSellPlans:vi.fn(),setHoldingVetoes:vi.fn(),selectSell:vi.fn()} as unknown as FishQualityState;
 return {plans,state};
}
function Settings({state}:{state:FishQualityState}){
 const [active,setActive]=useState('first');
 return <HoldingMonitorSettings state={state} activeId={active} onSelect={setActive} done={()=>{}} selectedCount={0}/>;
}
it('在真实持仓监测中新增两项、分别启用并保存，原 CDA 约束和另一方案原样保留',()=>{
 const {state,plans}=fixture(),before=JSON.stringify(plans);render(<Settings state={state}/>);
 expect(state.setSellPlans).not.toHaveBeenCalled();
 const hard=()=>within(screen.getAllByTestId('quality-hard-stop')[0]);
 fireEvent.click(hard().getByRole('button',{name:'添加镜像减仓后 DBL-5 防守线'}));
 fireEvent.click(hard().getByRole('button',{name:'添加镜像减仓后 CDA＜−15'}));
 const gates=()=>hard().getAllByRole('checkbox',{name:/只在镜像平衡减仓策略后启动/});
 expect(gates()).toHaveLength(3);expect(gates()[0]).not.toBeChecked();expect(gates()[1]).toBeChecked();expect(gates()[2]).toBeChecked();
 fireEvent.click(hard().getByLabelText('启用持仓否决 3'));
 fireEvent.click(hard().getByLabelText('启用持仓否决 4'));
 expect(hard().getByLabelText('持仓否决 4 阈值')).toHaveValue(-15);
 const tabs=within(screen.getByRole('tablist',{name:'选择要设置持仓监测的卖出方案'})).getAllByRole('tab');
 fireEvent.click(tabs[1]);expect(hard().queryByRole('checkbox',{name:/只在镜像平衡减仓策略后启动/})).toBeNull();
 fireEvent.click(tabs[0]);expect(gates()[1]).toBeChecked();expect(gates()[2]).toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:/^保存(全部 \d|到)/}));
 const saved=vi.mocked(state.setSellPlans).mock.lastCall![0] as QualityGroup[];
 expect(saved[0].holdingVetoes?.filter(v=>v.activation===V)).toHaveLength(2);
 expect(saved[0].holdingVetoes?.find(v=>!v.activation)).toEqual(plans[0].holdingVetoes[0]);
 expect(saved[1]).toEqual(plans[1]);expect(JSON.stringify(plans)).toBe(before);
},15000);
it('保存后恢复显示各自的启动开关，取消新开关只更改该条件',()=>{
 const original=makeQualityHoldingVeto('cda:CDA','<',-15,true,BUILTIN_FEATURES);
 const saved:QualityHoldingVeto[]=[original,{...structuredClone(original),id:original.id+'-'+V,activation:V}];
 function Editor(){const [draft,setDraft]=useState(()=>holdingVetoDraft(saved));return <><FishQualityHoldingVetoEditor draft={draft} setDraft={setDraft}/><button onClick={()=>document.querySelector('output')!.textContent=JSON.stringify(parseHoldingVetoDraft(draft,BUILTIN_FEATURES))}>核验保存</button><output/></>;}
 render(<Editor/>);
 const checkboxes=screen.getAllByRole('checkbox',{name:/只在镜像平衡减仓策略后启动/});
 expect(checkboxes[0]).not.toBeChecked();expect(checkboxes[1]).toBeChecked();
 fireEvent.change(screen.getByLabelText('持仓否决 2 阈值'),{target:{value:'-16.123456789'}});
 fireEvent.click(screen.getByRole('button',{name:'核验保存'}));
 const parsed=JSON.parse(document.querySelector('output')!.textContent!);
 expect(parsed[0]).toEqual(original);expect(parsed[1]).toMatchObject({activation:V,threshold:-16.123456789});
});
it('冻结配置只读地显示启动范围；买前筛选不出现新增持仓选项',()=>{
 const {plans}=fixture();plans[0].holdingVetoes[0].activation=V;
 const view=render(<FishQualityMonitorSettingsView plan={plans[0]}/>);
 expect(screen.getByRole('checkbox',{name:/只在镜像平衡减仓策略后启动/})).toBeChecked();
 fireEvent.click(screen.getByRole('checkbox',{name:/只在镜像平衡减仓策略后启动/}));
 expect(screen.getByRole('checkbox',{name:/只在镜像平衡减仓策略后启动/})).toBeChecked();
 view.unmount();render(<FishQualityHoldingVetoEditor entry draft={[]} setDraft={()=>{}}/>);
 expect(screen.queryByRole('button',{name:'添加镜像减仓后 DBL-5 防守线'})).toBeNull();
 expect(screen.queryByRole('button',{name:'添加镜像减仓后 CDA＜−15'})).toBeNull();
});
