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
import {defaultBoxSecondExit,BOX_SECOND_EXIT_CHOICE} from '@/lib/fish/qualityBoxStop';
import {DBL5_RETEST_GUARD_VERSION} from '@/lib/dbl5m';
import {mirrorHardStopStage} from '@/lib/fish/qualityMirrorHardStopStages';
import type {FishQualityState} from '@/hooks/useFishQuality';
import type {QualityHoldingVeto} from '@/lib/fish/qualityVeto';
import {BOX_SECOND_BREAK_VERSION,BOX_SECOND_EXIT_VERSION} from '@/lib/fish/qualityBoxStop';

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
 const gates=()=>hard().getAllByRole('checkbox',{name:/^镜像后 启用持仓否决/});
 expect(gates()).toHaveLength(2);expect(gates()[0]).not.toBeChecked();expect(gates()[1]).not.toBeChecked();
 fireEvent.click(hard().getByLabelText('镜像后 启用持仓否决 1'));
 fireEvent.click(hard().getByLabelText('镜像后 启用持仓否决 2'));
 expect(hard().getByLabelText('镜像后 持仓否决 2 阈值')).toHaveValue(-15);
 const tabs=within(screen.getByRole('tablist',{name:'选择要设置持仓监测的卖出方案'})).getAllByRole('tab');
 fireEvent.click(tabs[1]);expect(hard().queryByRole('checkbox',{name:/只在镜像平衡减仓策略后启动/})).toBeNull();
 fireEvent.click(tabs[0]);expect(gates()[0]).toBeChecked();expect(gates()[1]).toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:/^保存(全部 \d|到)/}));
 const saved=vi.mocked(state.setSellPlans).mock.lastCall![0] as QualityGroup[];
 expect(saved[0].holdingVetoes?.filter(v=>v.activation===V)).toHaveLength(2);
 expect(saved[0].holdingVetoes?.find(v=>!v.activation)).toEqual(plans[0].holdingVetoes[0]);
 expect(saved[1]).toEqual(plans[1]);expect(JSON.stringify(plans)).toBe(before);
},15000);
it('硬性终止真实入口分前后两段；旧全程规则只有明确移入后才改变作用时段',()=>{
 const {state,plans}=fixture(),before=JSON.stringify(plans);render(<Settings state={state}/>);
 const hard=()=>within(screen.getAllByTestId('quality-hard-stop')[0]),front=()=>within(hard().getByTestId('quality-hard-stop-before')),back=()=>within(hard().getByTestId('quality-hard-stop-after'));
 expect(state.setSellPlans).not.toHaveBeenCalled();expect(front().queryAllByRole('checkbox')).toHaveLength(0);
 fireEvent.click(hard().getByRole('button',{name:'将原有全程条件移入镜像前阶段'}));
 expect(front().getByLabelText('镜像前 持仓否决 1 阈值')).toHaveValue(-15);
 fireEvent.click(front().getByRole('button',{name:'添加防守线断裂即退出（镜像前）'}));
 fireEvent.click(back().getByRole('button',{name:'添加防守线首次观察、二次退出（镜像后）'}));
 fireEvent.click(front().getByLabelText('镜像前 启用持仓否决 2'));fireEvent.click(back().getByLabelText('镜像后 启用持仓否决 1'));
 fireEvent.change(front().getByLabelText('镜像前 箱体止损 2 防守线版本'),{target:{value:'dbl5-guard-v1'}});
 expect(back().getByLabelText('镜像后 箱体止损 1 防守线版本')).toHaveValue(DBL5_RETEST_GUARD_VERSION);
 const tabs=within(screen.getByRole('tablist',{name:'选择要设置持仓监测的卖出方案'})).getAllByRole('tab');
 fireEvent.click(tabs[1]);expect(back().queryAllByRole('checkbox')).toHaveLength(0);fireEvent.click(tabs[0]);
 expect(front().getByLabelText('镜像前 箱体止损 2 防守线版本')).toHaveValue('dbl5-guard-v1');
 fireEvent.click(screen.getByRole('button',{name:/^保存(全部 \d|到)/}));
 const saved=vi.mocked(state.setSellPlans).mock.lastCall![0] as QualityGroup[];
 const v=saved[0].holdingVetoes!;
 expect(v.find(v=>v.kind==='indicator')?.mirrorStage).toEqual(mirrorHardStopStage('before'));
 expect(v.find(v=>v.kind==='indicator')?.snapshot).toEqual(plans[0].holdingVetoes[0].snapshot);
 expect(v.filter(v=>v.kind==='box-stop').map(v=>v.mirrorStage?.stage)).toEqual(['before','after']);
 expect(v.find(v=>v.mirrorStage?.stage==='after')?.boxStop?.version).toBe(BOX_SECOND_EXIT_VERSION);
 expect(saved[1]).toEqual(plans[1]);expect(JSON.stringify(plans)).toBe(before);
},20000);
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
 expect(screen.getByLabelText('镜像后 启用持仓否决 1')).toBeChecked();
 fireEvent.click(screen.getByLabelText('镜像后 启用持仓否决 1'));
 expect(screen.getByLabelText('镜像后 启用持仓否决 1')).toBeChecked();
 view.unmount();render(<FishQualityHoldingVetoEditor entry draft={[]} setDraft={()=>{}}/>);
 expect(screen.queryByRole('button',{name:'添加镜像减仓后 DBL-5 防守线'})).toBeNull();
 expect(screen.queryByRole('button',{name:'添加镜像减仓后 CDA＜−15'})).toBeNull();
 expect(screen.queryByRole('button',{name:'添加镜像减仓后 DBL-5 二次支撑断裂'})).toBeNull();
 expect(screen.queryByRole('button',{name:'添加镜像减仓后持仓期间二次断裂终止'})).toBeNull();
 expect(screen.queryByTestId('add-post-mirror-observe-second-exit')).toBeNull();
});
it('保留全部旧选项，二次断裂两种语义都可新增为镜像后启动并独立保存',()=>{
 const {state,plans}=fixture(),before=JSON.stringify(plans);render(<Settings state={state}/>);
 const hard=()=>within(screen.getAllByTestId('quality-hard-stop')[0]);
 expect(within(hard().getByTestId('quality-hard-stop-legacy')).getByRole('button',{name:'添加二次断裂终止'})).toBeInTheDocument();
 expect(within(hard().getByTestId('quality-hard-stop-legacy')).getByRole('button',{name:'添加持仓期间二次断裂终止'})).toBeInTheDocument();
 fireEvent.click(hard().getByRole('button',{name:'添加镜像减仓后 DBL-5 二次支撑断裂'}));
 fireEvent.click(hard().getByRole('button',{name:'添加镜像减仓后持仓期间二次断裂终止'}));
 expect(hard().getByLabelText('镜像后 启用持仓否决 1')).not.toBeChecked();
 expect(hard().getByLabelText('镜像后 启用持仓否决 2')).not.toBeChecked();
 fireEvent.click(hard().getByLabelText('镜像后 启用持仓否决 1'));fireEvent.click(hard().getByLabelText('镜像后 启用持仓否决 2'));
 expect(hard().getAllByText(/启动时点：本次镜像平衡减仓实际成交后/)).toHaveLength(2);
 expect(hard().getByText(/减仓后第一次独立断裂停止本笔后续加仓/)).toBeInTheDocument();
 expect(hard().getByText(/减仓后第一次独立断裂只计数/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/^保存(全部 \d|到)/}));
 const saved=vi.mocked(state.setSellPlans).mock.lastCall![0] as QualityGroup[];
 const rules=saved[0].holdingVetoes!.filter(v=>v.activation===V);
 expect(rules.map(v=>v.boxStop?.version)).toEqual([BOX_SECOND_BREAK_VERSION,BOX_SECOND_EXIT_VERSION]);
 expect(saved[0].holdingVetoes!.find(v=>!v.activation)).toEqual(plans[0].holdingVetoes[0]);
 expect(saved[1]).toEqual(plans[1]);expect(JSON.stringify(plans)).toBe(before);
},15000);
it('明确的首次观察、二次退出入口复用只计数版本，原入口与原方案完整保留',()=>{
 const {state,plans}=fixture(),before=JSON.stringify(plans);render(<Settings state={state}/>);
 const hard=within(screen.getAllByTestId('quality-hard-stop')[0]);
 for(const name of ['添加支撑断裂终止','添加二次断裂终止','添加持仓期间二次断裂终止','添加镜像减仓后 DBL-5 防守线','添加镜像减仓后 DBL-5 二次支撑断裂','添加镜像减仓后持仓期间二次断裂终止'])expect(within(hard.getByTestId('quality-hard-stop-legacy')).getByRole('button',{name})).toBeInTheDocument();
 fireEvent.click(hard.getByRole('button',{name:'添加镜像减仓后防守线首次观察、二次退出'}));
 expect(hard.getByTestId('post-mirror-observe-second-exit')).toHaveTextContent('防守线第一次断裂观察，第二次断裂退出');
 expect(hard.getByLabelText('镜像后 启用持仓否决 1')).not.toBeChecked();
 fireEvent.click(hard.getByLabelText('镜像后 启用持仓否决 1'));
 fireEvent.click(screen.getByRole('button',{name:/^保存(全部 \d|到)/}));
 const saved=vi.mocked(state.setSellPlans).mock.lastCall![0] as QualityGroup[];
 const expected=parseHoldingVetoDraft([{choice:BOX_SECOND_EXIT_CHOICE,direction:'<=',threshold:'0',enabled:true,boxStop:defaultBoxSecondExit(BUILTIN_FEATURES,DBL5_RETEST_GUARD_VERSION),activation:V}],BUILTIN_FEATURES);
 expect(saved[0].holdingVetoes!.filter(v=>v.activation)).toEqual(expected);
 expect(saved[0].holdingVetoes!.find(v=>!v.activation)).toEqual(plans[0].holdingVetoes[0]);
 expect(saved[1]).toEqual(plans[1]);expect(JSON.stringify(plans)).toBe(before);
},15000);
