import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishPreEntrySettings } from '../FishPreEntrySettings';
import { TooltipProvider } from '../ui/tooltip';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
import { makeQualitySellPlan } from '@/lib/fish/qualitySellPlans';
import { qualityFilterChoices } from '@/lib/fish/qualityFilters';
import { newQualityStudy } from '@/lib/fish/quality';
import { emptyPreEntryConditions, PRE_ENTRY_CONDITIONS_VERSION } from '@/lib/fish/preEntryConditions';
import type { FishQualityState } from '@/hooks/useFishQuality';
afterEach(cleanup);
function setup(){
  const plan=makeQualitySellPlan(qualityFilterChoices(BUILTIN_FEATURES)[0].key,'>',0,BUILTIN_FEATURES,undefined,'entry');
  plan.label='买前方案';plan.preEntryConditions=emptyPreEntryConditions();
  const configure=vi.fn(),restart=vi.fn(),study=newQualityStudy(),done=vi.fn();
  const state={ready:true,study,setFilters:vi.fn(),setSellPlans:vi.fn(),preEntry:{ready:true,configure,restart,library:{version:1,rounds:[],records:[],settings:{updatedAt:1,plans:[plan],hours:0}}}} as unknown as FishQualityState;
  return {state,plan,configure,restart,done};
}
it('offers all market veto groups using the holding controls and explicitly disables position-only choices',()=>{
  const f=setup();render(<TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={f.done}/></TooltipProvider>);
  for(const label of ['长上影线','向下大插针','高震荡','冲高回落','冲高回落·仅ATR','筛选期间急跌'])expect(screen.getByLabelText(`启用入选前否决 ${label}`)).toBeInTheDocument();
  for(const section of ['pre-entry-sell-veto','pre-entry-hard-veto']){
    const area=within(screen.getByTestId(section));
    expect(area.getByRole('button',{name:'添加箱体终止'})).toBeEnabled();
    expect(area.getByRole('button',{name:'添加支撑断裂终止'})).toBeEnabled();
    expect(area.getByRole('button',{name:'添加盈亏比止盈'})).toBeDisabled();
    expect(area.getByRole('button',{name:'添加加仓止盈约束'})).toBeDisabled();
  }
  expect(f.configure).not.toHaveBeenCalled();expect(f.restart).not.toHaveBeenCalled();
});
it('copies unsaved per-plan veto settings and saves independently from static and holding settings',()=>{
  const f=setup(),before=structuredClone(f.plan);render(<TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={f.done}/></TooltipProvider>);
  fireEvent.click(screen.getByLabelText('启用入选前否决 长上影线'));
  fireEvent.change(screen.getByLabelText('长上影线 ATR倍数'),{target:{value:'2.2'}});
  const hard=within(screen.getByTestId('pre-entry-hard-veto'));
  fireEvent.change(hard.getByLabelText('筛选硬性终止 持仓否决 1 指标'),{target:{value:'drop-1m'}});
  fireEvent.change(hard.getByLabelText('筛选硬性终止 持仓否决 1 阈值'),{target:{value:'5'}});
  fireEvent.click(hard.getByLabelText('筛选硬性终止 启用持仓否决 1'));
  fireEvent.click(screen.getByLabelText('复制买入算法 1'));
  fireEvent.click(screen.getByRole('button',{name:'保存方案'}));
  expect(f.configure).toHaveBeenCalledOnce();
  const plans=f.configure.mock.calls[0][0];expect(plans).toHaveLength(2);
  for(const plan of plans){
    expect(plan.preEntryConditions.version).toBe(PRE_ENTRY_CONDITIONS_VERSION);
    expect(plan.preEntryConditions.entryVetoes[0]).toMatchObject({kind:'upper-wick',atr:2.2,enabled:true});
    expect(plan.preEntryConditions.hardVetoes[0]).toMatchObject({kind:'drop-1m',threshold:5,enabled:true});
  }
  expect(plans[0].id).not.toBe(plans[1].id);expect(f.plan).toEqual(before);
  expect(f.state.setFilters).not.toHaveBeenCalled();expect(f.state.setSellPlans).not.toHaveBeenCalled();expect(f.restart).not.toHaveBeenCalled();
});
it('does not start with an invalid enabled exclusion',()=>{
  const f=setup();render(<TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={f.done}/></TooltipProvider>);
  fireEvent.click(screen.getByLabelText('筛选硬性终止 启用持仓否决 1'));
  fireEvent.click(screen.getByRole('button',{name:'保存并开始筛选'}));
  expect(screen.getByRole('alert')).toHaveTextContent('阈值');expect(f.configure).not.toHaveBeenCalled();expect(f.restart).not.toHaveBeenCalled();
});
it('retains an unchanged saved indicator snapshot while editing the scan duration',()=>{
  const f=setup();f.plan.preEntryConditions!.sellVetoes=[{id:'saved',kind:'indicator',enabled:true,label:'冻结指标',direction:'<',threshold:-1,metric:f.plan.metric,snapshot:structuredClone(f.plan.snapshot)}];
  const before=structuredClone(f.plan.preEntryConditions);
  render(<TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={f.done}/></TooltipProvider>);
  fireEvent.change(screen.getByLabelText('筛选时长（小时）'),{target:{value:'24'}});
  fireEvent.click(screen.getByRole('button',{name:'保存方案'}));
  expect(f.configure.mock.calls[0][0][0].preEntryConditions).toEqual(before);expect(f.configure.mock.calls[0][1]).toBe(24);
});
