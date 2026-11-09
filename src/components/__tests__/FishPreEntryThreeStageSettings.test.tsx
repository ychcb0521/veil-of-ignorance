import {ModuleErrorBoundary} from '../ModuleErrorBoundary';
import {freezeQualityPlan} from '@/lib/fish/qualityPlanVersions';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FishPreEntrySettings } from '../FishPreEntrySettings';
import { TooltipProvider } from '../ui/tooltip';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
import { makeQualitySellPlan } from '@/lib/fish/qualitySellPlans';
import { qualityFilterChoices } from '@/lib/fish/qualityFilters';
import { newQualityStudy } from '@/lib/fish/quality';
import { emptyPreEntryConditions } from '@/lib/fish/preEntryConditions';
import { emptyPreEntryThreeStage, PRE_ENTRY_RETRY_VERSION, PRE_ENTRY_THREE_STAGE_V5, PRE_ENTRY_THREE_STAGE_VERSION } from '@/lib/fish/preEntryThreeStage';
import type { FishQualityState } from '@/hooks/useFishQuality';

afterEach(()=>{cleanup();vi.restoreAllMocks();localStorage.clear();});
function setup(){
  const plan=makeQualitySellPlan(qualityFilterChoices(BUILTIN_FEATURES)[0].key,'>',0,BUILTIN_FEATURES,undefined,'old');
  plan.label='旧版资产';plan.preEntryConditions=emptyPreEntryConditions();
  const configure=vi.fn(),restart=vi.fn(),done=vi.fn(),study=newQualityStudy();
  const state={ready:true,study,preEntry:{ready:true,configure,restart,library:{version:1,rounds:[],records:[],settings:{updatedAt:1,plans:[plan],hours:0}}}} as unknown as FishQualityState;
  render(<TooltipProvider><FishPreEntrySettings state={state} selectedCount={1} done={done}/></TooltipProvider>);
  return {plan,configure,restart,done,state};
}
it('shows the three-stage editor directly and groups it in the new ordered modules',()=>{
  const f=setup(),before=structuredClone(f.plan);
  // 旧版编辑器已下线：面板打开就是三阶编辑器，没有「新建三阶方案副本」引导。
  expect(screen.getByTestId('pre-entry-three-stage-settings')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'新建三阶方案副本'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'返回旧版设置'})).not.toBeInTheDocument();
  expect(screen.queryByLabelText('切换已存筛选方案集')).not.toBeInTheDocument();
  expect(screen.getAllByRole('heading',{level:4}).map(e=>e.textContent)).toEqual(['⓪ 必要条件','① 新事件准入','② 排除门槛']);
  // 加仓共用否决并入最后的排除段。
  expect(within(screen.getByTestId('three-stage-second')).getByLabelText('启用入选前否决 二次急跌未收复')).toBeInTheDocument();
  expect(within(screen.getByTestId('three-stage-zero')).queryByLabelText('启用入选前否决 二次急跌未收复')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'保存三阶方案'}));
  const saved=f.configure.mock.calls[0][0][0];
  expect(saved.id).not.toBe(f.plan.id);expect(saved.preEntryThreeStage.version).toBe(PRE_ENTRY_THREE_STAGE_VERSION);
  expect(saved.preEntryThreeStage.required[0].snapshot).toEqual(f.plan.snapshot);
  expect(saved.preEntryConditions).toBeUndefined();expect(f.plan).toEqual(before);expect(f.restart).not.toHaveBeenCalled();
});
it('saves a complete nested sell expression and its explicit confirmation clock',()=>{
  const f=setup();
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
  fireEvent.change(screen.getByLabelText('必要条件 1 门槛'),{target:{value:''}});
  fireEvent.click(screen.getByRole('button',{name:'保存并开始三阶筛选'}));
  expect(screen.getByRole('alert')).toHaveTextContent('有限门槛');expect(f.configure).not.toHaveBeenCalled();expect(f.restart).not.toHaveBeenCalled();expect(f.plan).toEqual(before);
});
it('keeps unsaved veto drafts in the sole active screening plan',()=>{
  const f=setup();
  fireEvent.click(screen.getByLabelText('启用入选前否决 二次急跌未收复'));
  fireEvent.change(screen.getByLabelText('二次急跌未收复 回落ATR倍数'),{target:{value:'3'}});
  expect(screen.queryByRole('button',{name:'复制整套三阶方案'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'保存三阶方案'}));
  expect(f.configure.mock.calls[0][0]).toHaveLength(1);
  for(const p of f.configure.mock.calls[0][0])expect(p.preEntryThreeStage.additionVetoes[0]).toMatchObject({kind:'double-drop',atr:3,pct:4,enabled:true});
});

function singleFixture(){
 const p=makeQualitySellPlan(qualityFilterChoices(BUILTIN_FEATURES)[0].key,'>',0,BUILTIN_FEATURES,undefined,'keep');p.label='三阶筛选 2';p.preEntryThreeStage=emptyPreEntryThreeStage();p.preEntryThreeStage.hardVetoes=[{id:'custom',kind:'drop-1m',label:'原参数',enabled:true,direction:'>=',threshold:7}];
 const current=freezeQualityPlan(p),configure=vi.fn(),savePlanTemplate=vi.fn(),deletePlanTemplate=vi.fn(),state={ready:true,study:newQualityStudy(),savePlanTemplate,deletePlanTemplate,preEntry:{ready:true,configure,restart:vi.fn(),library:{version:1,records:[],rounds:[],settings:{updatedAt:1,plans:[{...structuredClone(current),id:'other-one',label:'状态S · 三阶副本'},current,{...structuredClone(current),id:'other-three',label:'三阶筛选 3'},{...structuredClone(current),id:'other-four',label:'三阶筛选 4'}],hours:12}}}} as unknown as FishQualityState;
 return {current,state,configure,savePlanTemplate,deletePlanTemplate};
}
it('explicitly copies the old plan into v7 with OR admission, state S default 0.8 and an editable algorithm list, retaining every saved asset',()=>{
 const f=singleFixture();f.state.study.planTemplates=[{id:'protected',name:'旧模板',savedAt:1,updatedAt:1,plan:structuredClone(f.current)}];const before=structuredClone(f.state.preEntry!.library),templates=structuredClone(f.state.study.planTemplates);
 render(<TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={vi.fn()}/></TooltipProvider>);
 fireEvent.click(screen.getByRole('button',{name:'配置新事件准入（另存副本）'}));
 expect(screen.getByRole('heading',{name:'① 新事件准入'})).toBeInTheDocument();expect(screen.getByLabelText('启用原生防守线准入')).toBeChecked();expect(screen.getByLabelText('准入算法 1 门槛')).toHaveValue(.8);expect(screen.getByLabelText('准入算法 1 指标')).toHaveValue('state:state');
 fireEvent.click(screen.getByRole('button',{name:'添加新事件'}));expect(screen.getByLabelText('准入算法 2 门槛')).toHaveValue(.8);fireEvent.change(screen.getByLabelText('准入算法 2 门槛'),{target:{value:'0.9'}});
 fireEvent.click(screen.getByRole('button',{name:'保存三阶方案'}));const next=f.configure.mock.calls[0][0][0];expect(next.id).not.toBe(f.current.id);expect(next.preEntryThreeStage).toMatchObject({version:PRE_ENTRY_RETRY_VERSION,observationBasis:'retry-origin-v2',admission:{guardEnabled:true,algorithms:[{threshold:.8},{threshold:.9}]}});expect(next.preEntryThreeStage.hardVetoes).toEqual(f.current.preEntryThreeStage!.hardVetoes);expect(next.preEntryThreeStage.required).toEqual(f.current.preEntryThreeStage!.required);expect(f.configure.mock.calls[0][1]).toBe(12);expect(f.state.preEntry!.library).toEqual(before);expect(f.state.study.planTemplates).toEqual(templates);
});
it('refuses a v7 plan with every admission route disabled',()=>{
 const f=singleFixture();render(<TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={vi.fn()}/></TooltipProvider>);
 fireEvent.click(screen.getByRole('button',{name:'配置新事件准入（另存副本）'}));fireEvent.click(screen.getByLabelText('启用原生防守线准入'));fireEvent.click(screen.getByLabelText('准入算法 1 启用'));fireEvent.click(screen.getByRole('button',{name:'保存三阶方案'}));expect(screen.getByRole('alert')).toHaveTextContent('至少启用一条');expect(f.configure).not.toHaveBeenCalled();
});
it('offers long-window drawdown as an opt-in veto and requires the user to enter its threshold',()=>{
 const f=singleFixture();render(<TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={vi.fn()}/></TooltipProvider>);fireEvent.click(screen.getByRole('button',{name:'配置新事件准入（另存副本）'}));expect(screen.getByLabelText('启用长周期回撤否决')).not.toBeChecked();fireEvent.click(screen.getByLabelText('启用长周期回撤否决'));fireEvent.click(screen.getByRole('button',{name:'保存三阶方案'}));expect(f.configure).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('回撤阈值');fireEvent.change(screen.getByLabelText('长周期回撤回看时长（小时）'),{target:{value:'72'}});fireEvent.change(screen.getByLabelText('长周期回撤阈值（%）'),{target:{value:'8'}});fireEvent.change(screen.getByLabelText('长周期回撤口径'),{target:{value:'maximum'}});fireEvent.click(screen.getByRole('button',{name:'保存三阶方案'}));expect(f.configure.mock.calls[0][0][0].preEntryThreeStage.longDrawdown).toEqual({enabled:true,hours:72,pct:8,mode:'maximum'});
});
it('keeps the confirmed saved second scheme unchanged and removes the redundant scheme controls',()=>{
 const f=singleFixture(),before=structuredClone(f.state.preEntry!.library);render(<TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={vi.fn()}/></TooltipProvider>);
 expect(screen.getByLabelText('三阶方案名称')).toHaveValue('三阶筛选 2');for(const name of ['新增三阶方案','复制整套三阶方案','删除当前副本'])expect(screen.queryByRole('button',{name})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'保存三阶方案'}));expect(f.configure).toHaveBeenCalledWith([f.current],12);expect(f.state.preEntry!.library).toEqual(before);
});
it('uses the same template picker for screening only and replaces the sole draft without altering saved versions',()=>{
 const f=singleFixture(),templatePlan=structuredClone(f.current);templatePlan.id='from-template';templatePlan.preEntryThreeStage!.version=PRE_ENTRY_THREE_STAGE_V5;const frozen=freezeQualityPlan(templatePlan),entry={id:'entry-template',name:'筛选模板',savedAt:1,updatedAt:1,entryHours:24,plan:frozen},holding={id:'hold-template',name:'持仓资产',savedAt:1,updatedAt:1,plan:freezeQualityPlan({...f.current,preEntryThreeStage:undefined})};f.state.study.planTemplates=[entry,holding];const before=structuredClone(f.state.study.planTemplates);
 render(<TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={vi.fn()}/></TooltipProvider>);fireEvent.click(screen.getByRole('button',{name:/模板库/}));
 expect(screen.getByTestId('plan-template-list')).toBeInTheDocument();expect(screen.getAllByTestId('plan-template-item')).toHaveLength(1);expect(screen.queryByTestId('plan-template-builtins')).not.toBeInTheDocument();expect(screen.queryByText('持仓资产')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'用模板 筛选模板 新建方案'}));expect(screen.getByLabelText('三阶方案名称')).toHaveValue('筛选模板');expect(f.configure).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'保存三阶方案'}));
 const saved=f.configure.mock.calls[0][0];expect(saved).toHaveLength(1);expect(saved[0].id).not.toBe(frozen.id);expect(saved[0].preEntryThreeStage).toEqual(frozen.preEntryThreeStage);expect(saved[0].frozenVersions).toEqual(frozen.frozenVersions);expect(f.configure.mock.calls[0][1]).toBe(24);expect(f.state.study.planTemplates).toEqual(before);
});
it('offers save-as-template for the already saved current screening scheme',()=>{
 const f=singleFixture();render(<TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={vi.fn()}/></TooltipProvider>);fireEvent.click(screen.getByRole('button',{name:'把当前筛选方案存为模板'}));fireEvent.change(screen.getByLabelText('模板名称'),{target:{value:'我的三阶模板'}});fireEvent.click(screen.getByRole('button',{name:'保存模板'}));expect(f.savePlanTemplate).toHaveBeenCalledWith(f.current.id,'我的三阶模板');expect(f.configure).not.toHaveBeenCalled();
});

it('keeps the saved screening editor mounted when a numeric threshold is cleared before replacement',()=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});const f=singleFixture(),p=f.current;p.preEntryThreeStage!.required=[{id:'required',label:'必要数值',metric:p.metric,snapshot:p.snapshot,enabled:true,direction:'>',threshold:1,timing:'intrabar'}];p.frozenVersions=freezeQualityPlan(p).frozenVersions;const before=structuredClone(f.state.preEntry!.library);
 render(<ModuleErrorBoundary label="鱼质量" backgroundTasks><TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={vi.fn()}/></TooltipProvider></ModuleErrorBoundary>);
 fireEvent.change(screen.getByLabelText('必要条件 1 门槛'),{target:{value:''}});expect(screen.queryByText('鱼质量显示暂时异常')).not.toBeInTheDocument();expect(screen.getByTestId('pre-entry-three-stage-settings')).toBeInTheDocument();expect(f.state.preEntry!.library).toEqual(before);expect(f.configure).not.toHaveBeenCalled();
});

it('allows intermediate inputs across saved numeric controls, blocks invalid saves and preserves every stored snapshot',()=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});const f=singleFixture(),p=f.current,c=p.preEntryThreeStage!,condition={id:'required',label:'必要数值',metric:p.metric,snapshot:p.snapshot,enabled:true,direction:'>' as const,threshold:1,timing:'intrabar' as const};
 c.required=[condition];c.detectors=[{id:'detector',stricterPct:0,match:'all'}];c.sellRules=[{id:'seller',label:'退出条件',enabled:true,expression:{condition:{...structuredClone(condition),id:'seller-condition'}},confirmation:{samples:1,minutes:1}}];p.frozenVersions=freezeQualityPlan(p).frozenVersions;
 f.state.study.planTemplates=[{id:'protected',name:'原样保留',savedAt:1,updatedAt:1,plan:structuredClone(p)}];const library=structuredClone(f.state.preEntry!.library),templates=structuredClone(f.state.study.planTemplates),done=vi.fn();
 render(<ModuleErrorBoundary label="鱼质量" backgroundTasks><TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={done}/></TooltipProvider></ModuleErrorBoundary>);
 for(const [label,value] of [['必要条件 1 门槛','-0.25'],['原探测 1 提高幅度','2.5'],['完整卖出 1 确认次数','3'],['完整卖出 1 确认周期','5'],['卖出 1 门槛','0.75'],['三阶准入 箱体确认 n','4'],['三阶准入 几何窗口（分钟）','60'],['三阶准入 上涨期防守冗余','0.75']]){
   fireEvent.change(screen.getByLabelText(label),{target:{value:''}});expect(screen.queryByText('鱼质量显示暂时异常')).not.toBeInTheDocument();expect(screen.getByTestId('plan-version-draft-pending')).toHaveTextContent('已保存版本保持不变');
   fireEvent.click(screen.getByRole('button',{name:'保存并开始三阶筛选'}));expect(f.configure).not.toHaveBeenCalled();expect(f.state.preEntry!.restart).not.toHaveBeenCalled();expect(done).not.toHaveBeenCalled();
   fireEvent.change(screen.getByLabelText(label),{target:{value}});expect(screen.queryByTestId('plan-version-draft-pending')).not.toBeInTheDocument();
 }
 fireEvent.click(screen.getByRole('button',{name:'保存并开始三阶筛选'}));expect(f.configure).toHaveBeenCalledOnce();expect(f.state.preEntry!.restart).toHaveBeenCalledOnce();expect(done).toHaveBeenCalledOnce();
 const saved=f.configure.mock.calls[0][0][0];expect(saved.preEntryThreeStage.required[0].threshold).toBe(-0.25);expect(saved.preEntryThreeStage.guard.rule.structure.definition.DBL5_config.guard_trend_atr).toBe(.75);expect(saved.preEntryThreeStage.sellRules[0].confirmation).toEqual({samples:3,minutes:5});expect(f.state.preEntry!.library).toEqual(library);expect(f.state.study.planTemplates).toEqual(templates);
});

it('restores a configurable time limit and preserves saved nonzero scope on save and start',()=>{
 const f=singleFixture(),before=structuredClone(f.state.preEntry!.library);
 render(<TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={()=>{}}/></TooltipProvider>);
 expect(screen.getByLabelText('单标的筛选时限（小时）')).toHaveValue(12);
 expect(screen.queryByText('筛选时长')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'保存并开始三阶筛选'}));
 expect(f.configure).toHaveBeenCalledWith([before.settings!.plans[1]],12);
 expect(f.state.preEntry!.restart).toHaveBeenCalledWith(12);
 expect(f.state.preEntry!.library).toEqual(before);
});

it('defaults an unlimited draft to 48 hours and blocks creating another unlimited run',()=>{
 const f=setup(),before=structuredClone(f.state.preEntry!.library);
 expect(screen.getByLabelText('单标的筛选时限（小时）')).toHaveValue(48);
 fireEvent.change(screen.getByLabelText('单标的筛选时限（小时）'),{target:{value:'0'}});
 fireEvent.click(screen.getByRole('button',{name:'保存并开始三阶筛选'}));expect(f.configure).not.toHaveBeenCalled();
 expect(screen.getByRole('alert')).toHaveTextContent('大于 0');
 fireEvent.change(screen.getByLabelText('单标的筛选时限（小时）'),{target:{value:'24'}});
 fireEvent.click(screen.getByRole('button',{name:'保存并开始三阶筛选'}));
 expect(f.configure.mock.calls[0][1]).toBe(24);expect(f.restart).toHaveBeenCalledWith(24);expect(f.state.preEntry!.library).toEqual(before);
});

it('defaults all admission alternatives to selected and allows all/individual choices without changing saved plans',()=>{
 const f=singleFixture(),before=structuredClone(f.state.preEntry!.library);
 render(<TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={vi.fn()}/></TooltipProvider>);
 fireEvent.click(screen.getByRole('button',{name:'配置新事件准入（另存副本）'}));
 expect(screen.getByLabelText('启用原生防守线准入')).toBeChecked();expect(screen.getByLabelText('准入算法 1 启用')).toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:'添加新事件'}));expect(screen.getByLabelText('准入算法 2 启用')).toBeChecked();
 fireEvent.change(screen.getByLabelText('准入算法 2 指标'),{target:{value:'state:state'}});fireEvent.change(screen.getByLabelText('准入算法 2 方向'),{target:{value:'<='}});fireEvent.change(screen.getByLabelText('准入算法 2 门槛'),{target:{value:'0.4'}});
 fireEvent.click(screen.getByRole('button',{name:'取消全选'}));expect(screen.getByLabelText('启用原生防守线准入')).not.toBeChecked();expect(screen.getByLabelText('准入算法 1 启用')).not.toBeChecked();expect(screen.getByLabelText('准入算法 2 启用')).not.toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:'全选准入标准'}));expect(screen.getByLabelText('启用原生防守线准入')).toBeChecked();expect(screen.getByLabelText('准入算法 1 启用')).toBeChecked();expect(screen.getByLabelText('准入算法 2 启用')).toBeChecked();
 fireEvent.click(screen.getByLabelText('启用原生防守线准入'));fireEvent.click(screen.getByRole('button',{name:'保存三阶方案'}));
 expect(f.configure.mock.calls[0][0][0].preEntryThreeStage.admission).toMatchObject({guardEnabled:false,algorithms:[{enabled:true,threshold:.8},{enabled:true,direction:'<=',threshold:.4}]});expect(f.state.preEntry!.library).toEqual(before);
});

it('shows the common new-event stage and offers state admission directly on a saved guard-only scheme',()=>{
 const f=singleFixture(),before=structuredClone(f.state.preEntry!.library);render(<TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={vi.fn()}/></TooltipProvider>);
 const first=within(screen.getByTestId('three-stage-first'));expect(first.getByRole('heading',{name:'① 新事件准入'})).toBeInTheDocument();expect(first.getByLabelText('启用原生防守线准入')).toBeChecked();expect(first.getByLabelText('启用状态 S 新事件准入')).not.toBeChecked();expect(first.getByRole('button',{name:'添加新事件'})).toBeInTheDocument();expect(f.configure).not.toHaveBeenCalled();
 fireEvent.click(first.getByLabelText('启用状态 S 新事件准入'));expect(screen.getByLabelText('准入算法 1 指标')).toHaveValue('state:state');expect(screen.getByLabelText('准入算法 1 门槛')).toHaveValue(.8);expect(screen.getByLabelText('准入算法 1 启用')).toBeChecked();expect(screen.getByLabelText('启用原生防守线准入')).toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:'保存三阶方案'}));expect(f.configure.mock.calls[0][0][0].id).not.toBe(f.current.id);expect(f.configure.mock.calls[0][0][0].preEntryThreeStage.version).toBe(PRE_ENTRY_RETRY_VERSION);expect(f.state.preEntry!.library).toEqual(before);
});
it('creates a state-only independent copy when the saved guard admission is turned off',()=>{
 const f=singleFixture(),before=structuredClone(f.state.preEntry!.library);render(<TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={vi.fn()}/></TooltipProvider>);
 fireEvent.click(screen.getByLabelText('启用原生防守线准入'));expect(screen.getByLabelText('启用原生防守线准入')).not.toBeChecked();expect(screen.getByLabelText('准入算法 1 启用')).toBeChecked();fireEvent.click(screen.getByRole('button',{name:'保存三阶方案'}));expect(f.configure.mock.calls[0][0][0].preEntryThreeStage.admission).toMatchObject({guardEnabled:false,algorithms:[{enabled:true,threshold:.8}]});expect(f.state.preEntry!.library).toEqual(before);
});
it('gives every stage a subtle clickable help symbol without changing any saved configuration',()=>{
 const f=singleFixture(),before=structuredClone(f.state.preEntry!.library);render(<TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={vi.fn()}/></TooltipProvider>);
 for(const [stage,label,text] of [['three-stage-zero','必要条件使用说明','所有已启用的必要条件都满足'],['three-stage-first','新事件准入使用说明','彼此是“或”的关系'],['three-stage-second','排除门槛使用说明','硬性终止一旦成立立即排除']] as const){
  const trigger=within(screen.getByTestId(stage)).getByRole('button',{name:label});expect(trigger.className).toContain('text-muted-foreground/35');expect(trigger).toHaveAttribute('title',label);fireEvent.click(trigger);expect(screen.getByText(new RegExp(text))).toBeInTheDocument();fireEvent.click(trigger);
 }
 expect(f.configure).not.toHaveBeenCalled();expect(f.state.preEntry!.library).toEqual(before);
});

it('keeps each event toggle, settings, help and removal inside its own independent module',()=>{
 const f=singleFixture(),before=structuredClone(f.state.preEntry!.library);render(<TooltipProvider><FishPreEntrySettings state={f.state} selectedCount={1} done={vi.fn()}/></TooltipProvider>);
 fireEvent.click(screen.getByLabelText('启用状态 S 新事件准入'));const guard=screen.getByTestId('admission-guard-module');let indicators=screen.getAllByTestId('admission-indicator-module');expect(indicators).toHaveLength(1);
 expect(within(guard).getByRole('heading',{name:'防守线新事件',level:5})).toBeInTheDocument();expect(within(guard).getByRole('button',{name:'防守线新事件模块使用说明'})).toBeInTheDocument();expect(within(guard).getByText('参数设置')).toBeInTheDocument();expect(within(guard).queryByLabelText('准入算法 1 门槛')).toBeNull();
 expect(within(indicators[0]).getByRole('heading',{name:'状态 S',level:5})).toBeInTheDocument();expect(within(indicators[0]).getByLabelText('准入算法 1 门槛')).toHaveValue(.8);expect(within(indicators[0]).getAllByRole('checkbox')).toHaveLength(1);expect(within(indicators[0]).queryByText('参数设置')).toBeNull();
 expect(screen.queryByRole('button',{name:'添加准入算法'})).toBeNull();expect(screen.queryByRole('button',{name:'添加其他准入标准'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'添加新事件'}));indicators=screen.getAllByTestId('admission-indicator-module');expect(indicators).toHaveLength(2);
 fireEvent.change(within(indicators[1]).getByLabelText('准入算法 2 门槛'),{target:{value:'0.95'}});fireEvent.change(within(indicators[1]).getByLabelText('准入算法 2 方向'),{target:{value:'>='}});fireEvent.click(within(indicators[0]).getByLabelText('准入算法 1 启用'));
 expect(within(guard).getByLabelText('启用原生防守线准入')).toBeChecked();expect(within(indicators[1]).getByLabelText('准入算法 2 启用')).toBeChecked();expect(within(indicators[0]).getByLabelText('准入算法 1 门槛')).toHaveValue(.8);
 fireEvent.click(within(indicators[1]).getByRole('button',{name:'准入算法 2 删除'}));expect(screen.getAllByTestId('admission-indicator-module')).toHaveLength(1);expect(screen.getByLabelText('准入算法 1 启用')).not.toBeChecked();fireEvent.click(screen.getByRole('button',{name:'保存三阶方案'}));expect(f.configure.mock.calls[0][0][0].preEntryThreeStage.admission).toMatchObject({guardEnabled:true,algorithms:[{enabled:false,threshold:.8}]});expect(f.state.preEntry!.library).toEqual(before);
});
