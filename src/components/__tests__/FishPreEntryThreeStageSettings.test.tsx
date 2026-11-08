import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FishPreEntrySettings } from '../FishPreEntrySettings';
import { TooltipProvider } from '../ui/tooltip';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
import { makeQualitySellPlan } from '@/lib/fish/qualitySellPlans';
import { qualityFilterChoices } from '@/lib/fish/qualityFilters';
import { newQualityStudy } from '@/lib/fish/quality';
import { emptyPreEntryConditions } from '@/lib/fish/preEntryConditions';
import { PRE_ENTRY_THREE_STAGE_VERSION } from '@/lib/fish/preEntryThreeStage';
import type { FishQualityState } from '@/hooks/useFishQuality';

afterEach(cleanup);
function setup(){
  const plan=makeQualitySellPlan(qualityFilterChoices(BUILTIN_FEATURES)[0].key,'>',0,BUILTIN_FEATURES,undefined,'old');
  plan.label='旧版资产';plan.preEntryConditions=emptyPreEntryConditions();
  const configure=vi.fn(),restart=vi.fn(),done=vi.fn(),study=newQualityStudy();
  const state={ready:true,study,preEntry:{ready:true,configure,restart,library:{version:1,rounds:[],records:[],settings:{updatedAt:1,plans:[plan],hours:0}}}} as unknown as FishQualityState;
  render(<TooltipProvider><FishPreEntrySettings state={state} selectedCount={1} done={done}/></TooltipProvider>);
  return {plan,configure,restart,done,state};
}
it('requires an explicit new copy and groups the editor in exactly three ordered modules',()=>{
  const f=setup(),before=structuredClone(f.plan);
  expect(screen.queryByTestId('pre-entry-three-stage-settings')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'新建三阶方案副本'}));
  expect(screen.getAllByRole('heading').map(e=>e.textContent)).toEqual(['① 一阶排除门槛','② 二阶排除门槛','③ 三阶准入门槛']);
  expect(within(screen.getByTestId('three-stage-first')).getByLabelText('启用入选前否决 二次急跌未收复')).toBeInTheDocument();
  expect(within(screen.getByTestId('three-stage-third')).queryByText(/确认当分钟不入选/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'保存三阶方案'}));
  const saved=f.configure.mock.calls[0][0][0];
  expect(saved.id).not.toBe(f.plan.id);expect(saved.preEntryThreeStage.version).toBe(PRE_ENTRY_THREE_STAGE_VERSION);
  expect(saved.preEntryThreeStage.required[0].snapshot).toEqual(f.plan.snapshot);
  expect(saved.preEntryConditions).toBeUndefined();expect(f.plan).toEqual(before);expect(f.restart).not.toHaveBeenCalled();
});
it('saves a complete nested sell expression and its explicit confirmation clock',()=>{
  const f=setup();fireEvent.click(screen.getByRole('button',{name:'新建三阶方案副本'}));
  fireEvent.click(screen.getByRole('button',{name:'添加完整卖出规则'}));
  fireEvent.change(screen.getByLabelText('卖出 1 组合关系'),{target:{value:'all'}});
  fireEvent.click(screen.getByRole('button',{name:'添加且／或子组'}));
  fireEvent.change(screen.getByLabelText('完整卖出 1 确认次数'),{target:{value:'2'}});
  fireEvent.change(screen.getByLabelText('完整卖出 1 确认周期'),{target:{value:'5'}});
  fireEvent.click(screen.getByRole('button',{name:'保存并开始三阶筛选'}));
  expect(f.configure).toHaveBeenCalledOnce();expect(f.restart).toHaveBeenCalledOnce();
  const seller=f.configure.mock.calls[0][0][0].preEntryThreeStage.sellRules[0];
  expect(seller.confirmation).toEqual({samples:2,minutes:5});
  expect(seller.expression.join).toBe('all');expect(seller.expression.children[1].join).toBe('any');
});
it('blocks saving an enabled condition with an empty threshold and keeps the legacy source untouched',()=>{
  const f=setup(),before=structuredClone(f.plan);
  fireEvent.click(screen.getByRole('button',{name:'新建三阶方案副本'}));
  fireEvent.change(screen.getByLabelText('必要条件 1 门槛'),{target:{value:''}});
  fireEvent.click(screen.getByRole('button',{name:'保存并开始三阶筛选'}));
  expect(screen.getByRole('alert')).toHaveTextContent('有限门槛');expect(f.configure).not.toHaveBeenCalled();expect(f.restart).not.toHaveBeenCalled();expect(f.plan).toEqual(before);
});
it('copies unsaved veto and hard-stop drafts into another three-stage plan',()=>{
  const f=setup();fireEvent.click(screen.getByRole('button',{name:'新建三阶方案副本'}));
  fireEvent.click(screen.getByLabelText('启用入选前否决 二次急跌未收复'));
  fireEvent.change(screen.getByLabelText('二次急跌未收复 回落ATR倍数'),{target:{value:'3'}});
  fireEvent.click(screen.getByRole('button',{name:'复制整套三阶方案'}));
  fireEvent.click(screen.getByRole('button',{name:'保存三阶方案'}));
  expect(f.configure.mock.calls[0][0]).toHaveLength(2);
  for(const p of f.configure.mock.calls[0][0])expect(p.preEntryThreeStage.additionVetoes[0]).toMatchObject({kind:'double-drop',atr:3,pct:4,enabled:true});
});
