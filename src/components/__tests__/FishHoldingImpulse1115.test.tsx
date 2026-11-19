import {useState} from 'react';
import {expect,it,vi} from 'vitest';
import {fireEvent,render,screen,within} from '@testing-library/react';
import {HoldingMonitorSettings} from '../FishHoldingMonitorSettings';
import {FishHoldingImpulse1115Evidence} from '../FishHoldingImpulse1115Evidence';
import {FishQualityMonitorSettingsView} from '../FishQualityMonitorSettingsView';
import {newQualityStudy,type QualityGroup} from '@/lib/fish/quality';
import {defaultHoldingImpulse1115Rule,type HoldingImpulse1115Reading} from '@/lib/fish/holdingImpulse1115Classification';
import type {FishQualityState} from '@/hooks/useFishQuality';
import {makeQualitySellPlan} from '@/lib/fish/qualitySellPlans';
import {BUILTIN_FEATURES} from '@/lib/deepDig/features';

function fixture(){
 const study=newQualityStudy();
 const original=makeQualitySellPlan('state:state','<',.45,BUILTIN_FEATURES,undefined,'first');
 const plans=[{...original,id:'first',label:'第一套'},{...structuredClone(original),id:'second',label:'第二套'}];
 return {plans,state:{study:{...study,sellPlans:plans,sellPlansConfigured:true},ready:true,running:false,error:'',
  setSellPlans:vi.fn(),setHoldingVetoes:vi.fn(),selectSell:vi.fn()} as unknown as FishQualityState};
}
function Settings({state}:{state:FishQualityState}){
 const [selected,setSelected]=useState('first');
 return <HoldingMonitorSettings state={state} activeId={selected} onSelect={setSelected} done={()=>{}} selectedCount={0}/>;
}
it('持仓监测真实入口逐方案编辑、切换与保存；原方案字段与模板保持不动',()=>{
 const {plans,state}=fixture(),before=JSON.stringify(plans);
 render(<Settings state={state}/>);fireEvent.click(screen.getByText('分类结果显示设置（本方案）'));
 const checkbox=()=>screen.getByRole('checkbox',{name:'DBL-5-急拉线-1115 · 持仓分类'});
 expect(checkbox()).not.toBeChecked();expect(state.setSellPlans).not.toHaveBeenCalled();
 fireEvent.click(checkbox());
 fireEvent.change(screen.getByLabelText('有效跌破连续收盘'),{target:{value:'3'}});
 fireEvent.change(screen.getByLabelText('回踩附近容差'),{target:{value:'0.375123456789'}});
 const tabs=()=>within(screen.getByRole('tablist',{name:'选择要设置持仓监测的卖出方案'})).getAllByRole('tab');
 fireEvent.click(tabs()[1]);fireEvent.click(screen.getByText('分类结果显示设置（本方案）'));expect(checkbox()).not.toBeChecked();
 fireEvent.click(checkbox());fireEvent.change(screen.getByLabelText('有效跌破连续收盘'),{target:{value:'4'}});
 fireEvent.click(tabs()[0]);
 expect(screen.getByLabelText('有效跌破连续收盘')).toHaveValue(3);
 expect(screen.getByLabelText('回踩附近容差')).toHaveValue(.375123456789);
 fireEvent.click(screen.getByRole('button',{name:'保存全部 2 套方案'}));
 const saved=vi.mocked(state.setSellPlans).mock.lastCall![0] as QualityGroup[];
 expect(saved[0].impulse1115Classification?.definition.DBL5C_parameters).toMatchObject({breakCloses:3,nearAtr:.375123456789});
 expect(saved[1].impulse1115Classification?.definition.DBL5C_parameters).toMatchObject({breakCloses:4,nearAtr:.5});
 expect(saved[0].snapshot).toEqual(plans[0].snapshot);
 expect(saved[0].holdingVetoes).toEqual(plans[0].holdingVetoes);
 expect(saved[0].addition).toEqual(plans[0].addition);
 expect(JSON.stringify(plans)).toBe(before);
},15000);
it('无效分类参数拦截保存并保留输入；关闭开关移除本方案分类设置',()=>{
 const {state}=fixture();render(<Settings state={state}/>);fireEvent.click(screen.getByText('分类结果显示设置（本方案）'));
 const checkbox=screen.getByRole('checkbox',{name:'DBL-5-急拉线-1115 · 持仓分类'});
 fireEvent.click(checkbox);
 fireEvent.change(screen.getByLabelText('有效跌破连续收盘'),{target:{value:''}});
 fireEvent.click(screen.getByRole('button',{name:/^保存到/}));
 expect(state.setSellPlans).not.toHaveBeenCalled();
 expect(screen.getAllByRole('alert').some(e=>e.textContent?.includes('有效跌破连续收盘'))).toBe(true);
 fireEvent.click(checkbox);
 fireEvent.click(screen.getByRole('button',{name:/^保存到/}));
 expect(vi.mocked(state.setSellPlans).mock.lastCall![0][0]).not.toHaveProperty('impulse1115Classification');
});
it('冻结设置只读展示同一分类参数；没有配置的旧模板不自动增加',()=>{
 const {plans}=fixture(),configured={...plans[0],impulse1115Classification:defaultHoldingImpulse1115Rule()};
 const before=JSON.stringify(configured);
 const view=render(<FishQualityMonitorSettingsView plan={configured} holdingOnly/>);fireEvent.click(screen.getByText('分类结果显示设置（本方案）'));
 expect(screen.getByRole('checkbox',{name:'DBL-5-急拉线-1115 · 持仓分类'})).toBeDisabled();
 expect(screen.getByLabelText('有效跌破连续收盘')).toBeDisabled();
 expect(JSON.stringify(configured)).toBe(before);
 view.unmount();render(<FishQualityMonitorSettingsView plan={plans[0]} holdingOnly/>);
 expect(screen.queryByTestId('holding-impulse1115-settings')).not.toBeInTheDocument();
});
it('历史冻结记录没有加仓设置时仍在位置区保留原分类参数，只读不补造规则',()=>{
 const {plans}=fixture(),plan={...plans[0],impulse1115Classification:defaultHoldingImpulse1115Rule()},before=JSON.stringify(plan);
 render(<FishQualityMonitorSettingsView plan={plan} holdingOnly savedOnly/>);
 expect(screen.getByText('原设置未记录加仓。')).toBeInTheDocument();expect(screen.getByTestId('addition-timing')).toContainElement(screen.getByTestId('holding-impulse1115-settings'));
 fireEvent.click(screen.getByText('分类结果显示设置（本方案）'));expect(screen.getByLabelText('有效跌破连续收盘')).toBeDisabled();expect(JSON.stringify(plan)).toBe(before);expect(plan).not.toHaveProperty('addition');
});
it('监测结果显示主分类和细分；等待提示及历史选择均来自冻结结果',()=>{
 const history=[{at:1,mainClass:1,case:1,status:'UNTESTED',tests:0},{at:2,mainClass:2,case:4,status:'QUICK_RECLAIM',tests:0}];
 const current={lineId:'native-a',detectedAt:1,price:100,history,...history[1],available:true};
 const value={status:'ready',through:2,row:{at:2,current,lines:[current]}} as unknown as HoldingImpulse1115Reading;
 const view=render(<FishHoldingImpulse1115Evidence value={value}/>);
 expect(screen.getAllByText('二类｜短暂刺穿，迅速收回').length).toBeGreaterThan(0);
 fireEvent.click(screen.getByText('查看各条急拉线的冻结历史'));
 expect(screen.getByLabelText('持仓分类历史急拉线')).toHaveValue('native-a');
 expect(screen.getByText(/一类｜延续未回踩/)).toBeInTheDocument();
 view.unmount();render(<FishHoldingImpulse1115Evidence value={{...value,status:'waiting',message:'等待5m行情'}} compact/>);
 expect(screen.getByTestId('holding-impulse1115-reading')).toHaveTextContent('等待5m行情');
});
