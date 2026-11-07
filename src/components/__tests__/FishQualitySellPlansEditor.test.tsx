import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishQualitySellPlansEditor } from '../FishQualitySellPlansEditor';
import { enableQualityComparison, ensureQualitySellCombo } from '@/lib/fish/qualityComparison';
import { newQualityStudy, type QualityGroup } from '@/lib/fish/quality';
import { makeQualitySellPlan, replaceQualitySellPlans } from '@/lib/fish/qualitySellPlans';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
import { buildFusionTemplatePlan } from '@/lib/fish/qualityBuiltinTemplates';
import { freezeQualityPlan } from '@/lib/fish/qualityPlanVersions';
afterEach(() => { cleanup(); localStorage.clear(); });
it('splits a saved routed combination into two complete independent drafts and keeps the original', () => {
  const plan = freezeQualityPlan(buildFusionTemplatePlan(BUILTIN_FEATURES, 'routed', '原组合'));
  const before = structuredClone(plan), save = vi.fn();
  render(<FishQualitySellPlansEditor plans={[plan]} ready onSave={save}/>);
  fireEvent.click(screen.getByLabelText('拆分卖出组合 1'));
  expect(save).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('卖出算法 2 名称')).toHaveValue('原组合 · 结构型');
  expect(screen.getByLabelText('卖出算法 3 名称')).toHaveValue('原组合 · 进攻型');
  const [original, structure, attack]: QualityGroup[] = save.mock.calls[0][0];
  expect(original).toEqual(before);
  for (const [copy, branch] of [[structure, 'structure'], [attack, 'attack']] as const) {
    expect(copy.router).toBeUndefined(); expect(copy.addition).toEqual(plan.router![branch].addition);
    expect(copy.snapshot).toEqual(plan.router![branch].snapshot);
    expect(copy.holdingVetoes).toEqual(plan.router![branch].holdingVetoes);
    expect(copy.sellStages).toEqual(plan.router![branch].sellStages);
  }
  expect(new Set([original.id, structure.id, attack.id]).size).toBe(3);
  expect(plan).toEqual(before);
});
it('offers save-and-split for pending settings and hides splitting from embedded branch editors', () => {
  const plan = buildFusionTemplatePlan(BUILTIN_FEATURES, 'routed');
  const view = render(<FishQualitySellPlansEditor plans={[plan]} ready extraDirty onSave={vi.fn()}/>);
  expect(screen.getByLabelText('拆分卖出组合 1')).toBeEnabled();
  expect(screen.getByLabelText('拆分卖出组合 1')).toHaveTextContent('保存并拆成');
  view.rerender(<FishQualitySellPlansEditor plans={[plan]} ready embedded onSave={vi.fn()}/>);
  expect(screen.queryByLabelText('拆分卖出组合 1')).toBeNull();
});
it('atomically saves pending branch parameters and both detached plans, and leaves the source intact',()=>{
 const plan=freezeQualityPlan(buildFusionTemplatePlan(BUILTIN_FEATURES,'pending','原组合')),before=structuredClone(plan),save=vi.fn();
 render(<FishQualitySellPlansEditor plans={[plan]} ready extraDirty onSave={save} prepare={next=>next.map(p=>({...p,router:{...p.router!,attack:{...p.router!.attack,addition:{...p.router!.attack.addition!,rounds:p.router!.attack.addition!.rounds!.map((r,i)=>i===5?{...r,minGainPct:2.25}:r)}}}}))}/>);
 fireEvent.click(screen.getByLabelText('拆分卖出组合 1'));
 expect(save).toHaveBeenCalledOnce();const saved:QualityGroup[]=save.mock.calls[0][0];expect(saved).toHaveLength(3);
 expect(saved[0].router!.attack.addition!.rounds![5].minGainPct).toBe(2.25);
 expect(saved[2].addition!.rounds![5].minGainPct).toBe(2.25);expect(saved[1].addition).toEqual(plan.router!.structure.addition);expect(plan).toEqual(before);
});
it('keeps all drafts and writes nothing when save-and-split validation fails',()=>{
 const plan=buildFusionTemplatePlan(BUILTIN_FEATURES,'invalid'),save=vi.fn();
 render(<FishQualitySellPlansEditor plans={[plan]} ready extraDirty onSave={save} prepare={()=>{throw Error('分支参数不完整');}}/>);
 fireEvent.click(screen.getByLabelText('拆分卖出组合 1'));expect(save).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('分支参数不完整');expect(screen.getAllByTestId(/sell-plan-draft-\d/)).toHaveLength(1);
});
it('recovers the saved full snapshot into the active list without rebuilding it from templates',()=>{
 const original=initial()[0],missing=freezeQualityPlan({...structuredClone(original),id:'missing',label:'已保存的结构型',rule:{metric:original.metric,direction:'<',threshold:.37}}),save=vi.fn();
 render(<FishQualitySellPlansEditor plans={[original]} ready onSave={save} recoverablePlans={[{plan:missing,at:1,source:'监测快照'}]}/>);
 fireEvent.click(screen.getByRole('button',{name:'找回已保存方案（1）'}));fireEvent.click(screen.getByRole('button',{name:'恢复并保存 已保存的结构型'}));
 expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][0]).toEqual([original,missing]);
});
const initial = () => ensureQualitySellCombo(enableQualityComparison(newQualityStudy())).sellPlans!;
it('adds either bearish feature or a custom series with editable direction/threshold while preserving existing plans', () => {
  const save = vi.fn(), plans = initial();
  render(<FishQualitySellPlansEditor plans={plans} ready onSave={save}/>);
  fireEvent.click(screen.getByRole('button', { name: '新增卖出算法' }));
  fireEvent.change(screen.getByLabelText('卖出算法 4 指标 特征值'), { target: { value: 'mbi-bear' } });
  fireEvent.change(screen.getByLabelText('卖出算法 4 指标'), { target: { value: 'mbi-bear:MBI_bear' } });
  fireEvent.change(screen.getByLabelText('卖出算法 4 门槛'), { target: { value: '-0.6' } });
  fireEvent.click(screen.getByRole('button', { name: '保存卖出算法' }));
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0]).toHaveLength(4);
  expect(save.mock.calls[0][0][3]).toMatchObject({ metric: 'MBI_bear', definitionSource: 'account', rule: { direction: '<', threshold: -.6 }, snapshot: { featureId: 'mbi-bear' } });
  expect(plans).toHaveLength(3);
});
it('allows deleting every default and does not restore deleted defaults after loading again', () => {
  const save = vi.fn();
  render(<FishQualitySellPlansEditor plans={initial()} ready onSave={save}/>);
  for (let i = 0; i < 3; i++) fireEvent.click(screen.getByLabelText('删除卖出算法 1'));
  fireEvent.click(screen.getByRole('button', { name: '保存卖出算法' }));
  expect(save).toHaveBeenCalledWith([]);
  const saved = replaceQualitySellPlans(ensureQualitySellCombo(enableQualityComparison(newQualityStudy())), []);
  expect(ensureQualitySellCombo(enableQualityComparison(structuredClone(saved))).sellPlans).toEqual([]);
});
it('edits both phases of a combination and keeps the plan identity and holding settings', () => {
  const plans = initial(), old = plans[2], save = vi.fn();
  old.holdingVetoes = [{ id: 'risk', kind: 'static-drawdown', direction: '>=', threshold: 2, enabled: true, label: '风险' }];
  render(<FishQualitySellPlansEditor plans={plans} ready onSave={save}/>);
  fireEvent.change(screen.getByLabelText('卖出算法 3 指标 特征值'), { target: { value: 'ctba-bear' } });
  fireEvent.change(screen.getByLabelText('卖出算法 3 指标'), { target: { value: 'ctba-bear:CTBA_bear' } });
  fireEvent.change(screen.getByLabelText('卖出算法 3 门槛'), { target: { value: '-10' } });
  fireEvent.change(screen.getByLabelText('卖出算法 3 后段指标 特征值'), { target: { value: 'mbi-bear' } });
  fireEvent.change(screen.getByLabelText('卖出算法 3 后段指标'), { target: { value: 'mbi-bear:MBI_bear' } });
  fireEvent.change(screen.getByLabelText('卖出算法 3 后段门槛'), { target: { value: '-0.5' } });
  fireEvent.change(screen.getByLabelText('卖出算法 3 切换涨幅'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: '保存卖出算法' }));
  const next: QualityGroup = save.mock.calls[0][0][2];
  expect(next.id).toBe(old.id); expect(next.holdingVetoes).toEqual(old.holdingVetoes);
  expect(next).toMatchObject({ metric: 'CTBA_bear', rule: { threshold: -10 }, combo: { switchPct: 4, after: { metric: 'MBI_bear', rule: { threshold: -.5 } } } });
});
it('rejects invalid input and preserves an existing plan selection when its identity survives', () => {
  const study = enableQualityComparison(newQualityStudy()), plans = study.sellPlans!;
  study.selectedSellId = plans[0].id;
  const plan = makeQualitySellPlan('mbi-bear:MBI_bear', '<', -.5, BUILTIN_FEATURES, plans[0]);
  expect(replaceQualitySellPlans(study, [plan]).selectedSellId).toBe(plan.id);
  expect(replaceQualitySellPlans(study, []).selectedSellId).toBeUndefined();
  expect(() => replaceQualitySellPlans(study, [{ ...plan, rule: { metric: plan.metric, direction: '<', threshold: NaN } }])).toThrow('有限数字');
});

it('merges pending algorithm edits into the latest holding settings instead of restoring an old addition configuration',()=>{
 const plans=initial().slice(0,2),save=vi.fn(),view=render(<FishQualitySellPlansEditor plans={plans} ready onSave={save}/>);
 fireEvent.change(screen.getByLabelText('卖出算法 1 名称'),{target:{value:'保留最新加仓'}});
 const addition={enabled:true,source:'detector' as const,stricterPct:10,amountMode:'fixed' as const,amountUsdt:75};
 view.rerender(<FishQualitySellPlansEditor plans={[{...plans[0],addition},plans[1]]} ready onSave={save}/>);
 fireEvent.click(screen.getByRole('button',{name:'保存卖出算法'}));
 expect(save.mock.calls[0][0][0]).toMatchObject({id:plans[0].id,label:'保留最新加仓',addition});
});

it('preserves untouched execution timing and frozen formulas when saving holding settings or just a name',()=>{
 const plans=initial().slice(0,2);delete plans[0].execution;delete plans[1].execution;delete plans[0].definitionSource;
 const before=structuredClone(plans),save=vi.fn();
 render(<FishQualitySellPlansEditor plans={plans} ready onSave={save} extraDirty prepare={next=>next.map((p,i)=>i===0?{...p,addition:{enabled:true,source:'detector',stricterPct:10,amountMode:'fixed',amountUsdt:75}}:p)}/>);
 fireEvent.change(screen.getByLabelText('卖出算法 1 名称'),{target:{value:'只改名称和加仓'}});fireEvent.click(screen.getByRole('button',{name:'保存卖出算法'}));
 const next:QualityGroup[]=save.mock.calls[0][0];expect(next[0].execution).toBeUndefined();expect(next[0].definitionSource).toBeUndefined();expect(next[0].snapshot).toEqual(before[0].snapshot);expect(next[0].label).toBe('只改名称和加仓');expect(next[1]).toEqual(before[1]);expect(plans).toEqual(before);
});
it('keeps the per-addition sellers set in 加仓细节 unchanged when the combination is edited or renamed',()=>{
 const plans=initial().slice(0,2),stage={afterAdditions:2,label:'CDA',metric:plans[0].metric,snapshot:structuredClone(plans[0].snapshot),rule:{metric:plans[0].metric,direction:'<' as const,threshold:.5}};plans[0].sellStages=[stage];
 const save=vi.fn();render(<FishQualitySellPlansEditor plans={plans} ready onSave={save}/>);expect(screen.queryByLabelText('卖出算法 1 启用次数切换')).toBeNull();
 fireEvent.change(screen.getByLabelText('卖出算法 1 名称'),{target:{value:'改名'}});fireEvent.change(screen.getByLabelText('卖出算法 1 门槛'),{target:{value:'.4'}});fireEvent.click(screen.getByRole('button',{name:'保存卖出算法'}));
 const saved:QualityGroup[]=save.mock.calls[0][0];expect(saved[0]).toMatchObject({label:'改名',rule:{threshold:.4},sellStages:[stage]});expect(saved[1]).toEqual(plans[1]);
});
it('copies a complete combination with unsaved algorithm edits into an independent editable plan without saving or running',()=>{
 const plan=initial()[2];plan.label='组合模板';plan.rule={metric:plan.metric,direction:'<',threshold:.5};plan.addition={enabled:true,source:'detector',stricterPct:10,quantityMode:'calculator',repeat:true,maxRounds:7,rounds:[{source:'detector',stricterPct:10,entryBufferAtr:3,supportOffsetAtr:2}]};plan.buyFilters=[];plan.vetoStages=[{afterAdditions:6,conditions:[{id:'risk',kind:'dynamic-drawdown',label:'动态回撤',direction:'>=',threshold:20,enabled:true}]}];plan.vetoPeakBasis='stage';plan.sellStages=[{afterAdditions:6,label:plan.label,metric:plan.metric,snapshot:structuredClone(plan.snapshot),rule:{...plan.rule}}];
 const before=structuredClone(plan),save=vi.fn(),select=vi.fn();render(<FishQualitySellPlansEditor plans={[plan]} ready onSave={save} onSelectPlan={select}/>);
 fireEvent.change(screen.getByLabelText('卖出算法 1 门槛'),{target:{value:'.7'}});fireEvent.change(screen.getByLabelText('卖出算法 1 后段门槛'),{target:{value:'.3'}});fireEvent.change(screen.getByLabelText('卖出算法 1 切换涨幅'),{target:{value:'6.5'}});fireEvent.click(screen.getByLabelText('复制卖出算法 1'));
 expect(screen.getByLabelText('卖出算法 2 名称')).toHaveValue('组合模板（副本）');expect(screen.getByLabelText('卖出算法 2 门槛')).toHaveValue(.7);expect(screen.getByLabelText('卖出算法 2 后段门槛')).toHaveValue(.3);expect(screen.getByLabelText('卖出算法 2 切换涨幅')).toHaveValue(6.5);expect(save).not.toHaveBeenCalled();expect(select).toHaveBeenLastCalledWith(expect.not.stringMatching(plan.id));
 fireEvent.change(screen.getByLabelText('卖出算法 2 门槛'),{target:{value:'.9'}});expect(screen.getByLabelText('卖出算法 1 门槛')).toHaveValue(.7);fireEvent.click(screen.getByRole('button',{name:'保存卖出算法'}));
 expect(save).toHaveBeenCalledOnce();const [original,copy]:QualityGroup[]=save.mock.calls[0][0];expect(copy.id).not.toBe(plan.id);expect(original.rule?.threshold).toBe(.7);expect(copy).toMatchObject({label:'组合模板（副本）',rule:{threshold:.9},combo:{switchPct:6.5,after:{rule:{threshold:.3}}},vetoStages:plan.vetoStages,sellStages:[{afterAdditions:6,rule:{threshold:.5}}]});expect(copy.addition).toEqual(original.addition);expect(copy.addition).not.toBe(original.addition);copy.addition!.rounds![0].entryBufferAtr=9;expect(original.addition!.rounds![0].entryBufferAtr).toBe(3);expect(plan).toEqual(before);
});
it('copies incomplete drafts and gives repeated copies unique names and IDs without validating or saving',()=>{
 const save=vi.fn();render(<FishQualitySellPlansEditor plans={initial().slice(2,3)} ready onSave={save}/>);fireEvent.change(screen.getByLabelText('卖出算法 1 切换涨幅'),{target:{value:'-1'}});fireEvent.click(screen.getByLabelText('复制卖出算法 1'));expect(screen.getByLabelText('卖出算法 2 切换涨幅')).toHaveValue(-1);fireEvent.click(screen.getByLabelText('复制卖出算法 1'));expect((screen.getByLabelText('卖出算法 2 名称') as HTMLInputElement).value).toContain('副本 2');expect(new Set(screen.getAllByTestId(/sell-plan-draft-\d/).map(n=>n.getAttribute('data-plan-id'))).size).toBe(3);expect(save).not.toHaveBeenCalled();
});
