import { ArrowRightCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { FishPopoverContent as PopoverContent } from './FishPopoverContent';
import { SettingsImageButton, useSettingsImageCapture } from './SettingsImageExport';
import { HOLDING_LEDGER_ADDITION_VERSION } from '@/lib/fish/qualityHoldingLedger';
import type { QualityMonitorTimeBasis } from '@/lib/fish/qualityAdmissionTime';
import { prepareQualityRouterDraft } from '@/lib/fish/qualityRouterDraft';
import { isRaceRouter, raceAttackFromRound, routerNextOrdinal, routerOrdinal, routerPrefixText } from '@/lib/fish/qualityPlanRouter';
import { FishQualityMonitorSettingsView } from './FishQualityMonitorSettingsView';
import { isLegacyQualityPlan } from '@/lib/fish/qualityLegacyEngine';
import { FishQualitySellPlansEditor, type SellPlansDraftView } from './FishQualitySellPlansEditor';
import { activeQualityPlanTemplates } from '@/lib/fish/qualityPlanTemplates';
import { validateQualitySellStages } from '@/lib/fish/qualitySellStages';
import type { VetoStagesDraft } from './FishQualityVetoStagesEditor';
import { validateQualityVetoStages } from '@/lib/fish/qualityVetoStages';
import { recoverableQualityPlans, readSavedQualityPlans } from '@/lib/fish/qualitySavedPlans';
import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import { FishQualityAdditionEditor, additionDraft, parseAdditionDraft, parseAdditionSellStages } from './FishQualityAdditionEditor';
import { FishQualityMirrorEditor, mirrorDraft, parseMirrorDraft } from './FishQualityMirrorEditor';
import { defaultQualityMirror, validateQualityMirror } from '@/lib/fish/qualityMirror';
import { FishQualityHoldingVetoEditor } from './FishQualityHoldingVetoEditor';
import { FishQualityInfo } from './FishQualityModule';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { hasQualityExit, type QualityGroup } from '@/lib/fish/quality';
import { holdingVetoDraft, planHoldingVetoDraft, parseHoldingVetoDraft } from '@/lib/fish/qualityFilters';
import { FishQualityPositionManagement, positionManagementDraft, parsePositionManagement, type PositionManagementDraft } from './FishQualityPositionManagement';
import { INSTANT_POSITION } from '@/lib/fish/instantMonitorExecution';
import { qualityPositionSize } from '@/lib/fish/qualityPositionManagement';

const EMPTY_PLANS: readonly QualityGroup[] = [];
const field = 'h-7 min-w-0 rounded-md border border-transparent bg-muted/50 px-2 text-[11px] outline-none hover:bg-muted focus-visible:border-ring/60';
const button = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40';

/**
 * 【用户要求】2026-10-27「持仓监测中也需要一个条件设置」「持仓一票否决卖出其实隶属于持仓监测」：
 * 这套卖出方案的持仓一票否决在这里设（观察时长已于 0d3dc61c 从界面移除，不放回来）。
 */
type MonitorDraft = { addition: ReturnType<typeof additionDraft>; mirror: ReturnType<typeof mirrorDraft>; vetoes: ReturnType<typeof holdingVetoDraft>;vetoStages:VetoStagesDraft };
const monitorDraftOf = (plan: QualityGroup): MonitorDraft => ({ addition: additionDraft(plan.addition, plan.sellStages), mirror: mirrorDraft(plan.mirrorTakeProfit ?? defaultQualityMirror()), vetoes: planHoldingVetoDraft(plan.holdingVetoes),vetoStages:{enabled:!!plan.vetoStages?.length,mode:plan.vetoStageMode??'overlay',peakBasis:plan.vetoPeakBasis??'stage',stages:(plan.vetoStages??[]).map(s=>({afterAdditions:String(s.afterAdditions),conditions:holdingVetoDraft(s.conditions)}))} });
const monitorBaseKey = (plan: QualityGroup) => JSON.stringify([plan.holdingVetoes,plan.mirrorTakeProfit,plan.addition,plan.sellStages,plan.vetoStages,plan.vetoStageMode,plan.vetoPeakBasis]);
function parseMonitorDraft(draft: MonitorDraft, definitions: Parameters<typeof parseAdditionDraft>[1]) {
  const holdingVetoes = parseHoldingVetoDraft(draft.vetoes,definitions), mirrorTakeProfit = parseMirrorDraft(draft.mirror), addition = parseAdditionDraft(draft.addition,definitions), sellStages = parseAdditionSellStages(draft.addition,definitions);
  const vetoStages=draft.vetoStages.enabled?draft.vetoStages.stages.map(s=>({afterAdditions:s.afterAdditions.trim()?Number(s.afterAdditions):NaN,conditions:parseHoldingVetoDraft(s.conditions,definitions)})).sort((a,b)=>a.afterAdditions-b.afterAdditions):undefined;
  if(draft.vetoStages.enabled&&!vetoStages?.length)throw Error('请添加至少一个一票条件切换阶段');
  const staged={vetoStages,vetoStageMode:draft.vetoStages.mode,vetoPeakBasis:draft.vetoStages.peakBasis};validateQualityVetoStages({...staged,addition});
  validateQualitySellStages({sellStages,addition});validateQualityMirror(mirrorTakeProfit); return { holdingVetoes, mirrorTakeProfit, addition, sellStages,...staged };
}
function HoldingMonitorEditor({ ready, plan, draft, setDraft, save, error, allDirty, count, hideSave = false }: {
  ready: boolean; plan: QualityGroup; draft: MonitorDraft; setDraft: (draft: MonitorDraft) => void;
  save: () => void; error: string; allDirty: boolean; count: number; hideSave?: boolean;
}) {
  return <div className="space-y-3" data-testid="quality-monitor-editor" data-plan-id={plan.id}>
    <div className="flex items-center gap-1.5"><p className="text-xs font-medium">持仓监测 · {plan.label}</p><FishQualityInfo label="持仓监测说明"><p>买入之后依次是：① 组合算法（上方卡片）→ ② 镜像平衡减仓 → ③ 加仓细节 → ④ 硬性终止。各项分别保存在对应方案中；切换方案保留本次填写，保存时一起保存。</p></FishQualityInfo></div>
    <FishQualityMirrorEditor draft={draft.mirror} setDraft={mirror => setDraft({...draft,mirror})} additionEnabled={draft.addition.enabled} holdingLedger={draft.addition.positionVersion===HOLDING_LEDGER_ADDITION_VERSION}/>
    <FishQualityAdditionEditor stickyRounds draft={draft.addition} setDraft={addition => setDraft({...draft,addition})} vetoStages={draft.vetoStages} setVetoStages={vetoStages=>setDraft({...draft,vetoStages})}/>
    <section className="space-y-2 rounded-lg border border-destructive/20 bg-destructive/[0.02] p-3" data-testid="quality-hard-stop"><div className="flex items-center gap-1.5"><h4 className="text-xs font-medium">④ 硬性终止</h4><span className="text-[10px] text-muted-foreground">必要充分 · 任一达标即卖出全部持仓</span><FishQualityInfo label="硬性终止说明"><p>与「加仓细节 · 卖出」并列：硬性终止的任一启用条件、或某次加仓的卖出条件，任何一个先达标，都立即卖出全部仓位（含各次加仓买入的部分），不等普通卖出算法。某次加仓后另加或收紧的否决条件，在「③ 加仓细节 · 卖出」里按次设置。</p></FishQualityInfo></div>
      <FishQualityHoldingVetoEditor draft={draft.vetoes} setDraft={vetoes => setDraft({...draft,vetoes})}/>
    </section>
    {!hideSave && <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-border/50 bg-popover px-4 py-2.5"><SettingsImageButton/><button type="button" disabled={!ready} onClick={save} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40">{allDirty ? `保存全部 ${count} 套方案` : `保存到「${plan.label}」`}</button></div>}
    {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
  </div>;
}
/** Editing one section must not rebuild the frozen formulas/settings in the other sections. */
function parseRouterMonitorDraft(plan: QualityGroup, draft: MonitorDraft, definitions: Parameters<typeof parseAdditionDraft>[1]) {
  const original = monitorDraftOf(plan), parsed = parseMonitorDraft(draft, definitions);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (same(draft.mirror, original.mirror)) parsed.mirrorTakeProfit = plan.mirrorTakeProfit;
  if (same(draft.vetoes, original.vetoes)) parsed.holdingVetoes = plan.holdingVetoes;
  if (same(draft.vetoStages, original.vetoStages)) {
    parsed.vetoStages = plan.vetoStages; parsed.vetoStageMode = plan.vetoStageMode; parsed.vetoPeakBasis = plan.vetoPeakBasis;
  }
  if (same(draft.addition, original.addition)) { parsed.addition = plan.addition; parsed.sellStages = plan.sellStages; return parsed; }
  if (plan.addition && parsed.addition) {
    const restoreAdditionField=<K extends keyof NonNullable<QualityGroup['addition']>>(key:K)=>{parsed.addition![key]=plan.addition![key];};
    const roundKeys = Object.keys({ ...additionDraft().otherRounds[0], time: undefined, savedCondition: undefined }).filter(k => k !== 'sellSwitch');
    const roundDraftAt = (d: MonitorDraft, i: number) => { const value = i ? d.addition.otherRounds[i - 1] : d.addition; return value ? Object.fromEntries(roundKeys.map(k => [k, value[k]])) : undefined; };
    const oldFirst = plan.addition.rounds?.[0];
    if (oldFirst && same(roundDraftAt(draft, 0), roundDraftAt(original, 0))) {
      // Preserve the first-round fields duplicated on the root addition rule as well.
      for (const key of ['source','structure','stricterPct','condition','conditions','prerequisites','indicatorIncrease','minGainPct','entryBufferAtr','supportOffsetAtr','entryDistanceAtr','gainBasis','entryVetoes','detectorPrerequisite'] as const) {
        if (plan.addition[key] === undefined) delete parsed.addition[key]; else restoreAdditionField(key);
      }
    }
    parsed.addition.rounds = parsed.addition.rounds?.map((r, i) => plan.addition!.rounds?.[i] && same(roundDraftAt(draft, i), roundDraftAt(original, i)) ? plan.addition!.rounds[i] : r);
    for (const key of ['supportReduction','geometricLock','breakevenFloor'] as const) {
      if (same(draft.addition[key], original.addition[key])) restoreAdditionField(key);
    }
    parsed.sellStages = parsed.sellStages?.map(stage => {
      const old = plan.sellStages?.find(s => s.afterAdditions === stage.afterAdditions);
      const switchAt = (d: MonitorDraft) => stage.afterAdditions === 1 ? d.addition.sellSwitch : d.addition.otherRounds[stage.afterAdditions - 2]?.sellSwitch;
      return old && same(switchAt(draft), switchAt(original)) ? old : stage;
    });
  }
  return parsed;
}

type RouterDraftHandle = { build: () => import('@/lib/fish/qualityPlanRouter').QualityPlanRouter };
/** Keep both branch forms mounted so raw edits survive tab switches and are saved atomically. */
function EditableQualityRouter({ plan, ready, controller, onDirtyChange }: {
  plan: QualityGroup; ready: boolean; controller: { current: RouterDraftHandle | null }; onDirtyChange: (id: string, dirty: boolean) => void;
}) {
  const imageCapture=useSettingsImageCapture();
  const router = plan.router!, definitions = useFeatureDefinitions();
  const [branch, setBranch] = useState<'structure' | 'attack'>('structure');
  const [visited, setVisited] = useState({ structure: true, attack: false });
  const branchPlans = useMemo(() => ({ structure: [router.structure], attack: [router.attack] }), [router]);
  const branchDirtyCallbacks = useMemo(() => ({
    structure: (value: boolean) => setDirtyBranches(old => old.structure === value ? old : { ...old, structure: value }),
    attack: (value: boolean) => setDirtyBranches(old => old.attack === value ? old : { ...old, attack: value }),
  }), []);
  const [threshold, setThreshold] = useState(String(router.threshold));
  // 【用户要求】2026-11-06 结构开局：每轮分流时进攻分支从第几次加仓起参与竞速（1＝每一次）
  const [attackFrom, setAttackFrom] = useState(String(raceAttackFromRound(router)));
  const [drafts, setDrafts] = useState(() => ({ structure: monitorDraftOf(router.structure), attack: monitorDraftOf(router.attack) }));
  const [dirtyBranches, setDirtyBranches] = useState({ structure: false, attack: false });
  const views = useRef<Partial<Record<'structure' | 'attack', SellPlansDraftView>>>({});
  const dirty = threshold !== String(router.threshold) || isRaceRouter(router) && attackFrom !== String(raceAttackFromRound(router)) || dirtyBranches.structure || dirtyBranches.attack;
  useEffect(() => { onDirtyChange(plan.id, dirty); }, [plan.id, dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(plan.id, false), [plan.id, onDirtyChange]);
  controller.current = { build: () => {
    if (!threshold.trim()) throw Error('请填写分支状态 S 门槛');
    if (isRaceRouter(router) && !attackFrom.trim()) throw Error('请填写进攻分支从第几次加仓起参与');
    const buildBranch = (key: 'structure' | 'attack') => {
      const view = views.current[key]; if (!view) return router[key];
      try { return view.build()[0]; } catch (cause) { throw Error(`${key === 'structure' ? '结构' : '进攻'}分支：${cause instanceof Error ? cause.message : '参数无效'}`); }
    };
    return prepareQualityRouterDraft(router, buildBranch('structure'), buildBranch('attack'), Number(threshold), isRaceRouter(router) ? Number(attackFrom) : undefined);
  } };
  return <section className="space-y-3 rounded border border-primary/25 bg-primary/5 p-3 text-[11px]" data-testid="quality-router-editor">
    <p className="font-medium">条件分支 · 编辑工作副本</p>
    {isRaceRouter(router) ? <div className="flex flex-wrap items-center gap-2">每一次加仓前都分流：结构分支与进攻分支这一次的加仓规则同时等候，先满足者成交（同一分钟先结构）。进攻分支各次的状态 S 门槛不低于
      <input aria-label="分支状态 S 门槛" type="number" step="any" min="0" max="1" value={threshold} onChange={e => setThreshold(e.target.value)} className={field + ' w-20'}/>
      ；进攻分支从第
      <input aria-label="进攻分支从第几次加仓起参与" type="number" step="1" min="1" max="100" value={attackFrom} onChange={e => setAttackFrom(e.target.value)} className={field + ' w-16'}/>
      次加仓起参与竞速（1＝每一次；填 3 则前两次只走结构分支）。
    </div> : <label className="flex flex-wrap items-center gap-2">第{routerOrdinal(router)}次结构加仓时，此前已收盘状态 S 大于
      <input aria-label="分支状态 S 门槛" type="number" step="any" min="0" max="1" value={threshold} onChange={e => setThreshold(e.target.value)} className={field + ' w-20'}/>
      则从第{routerNextOrdinal(router)}次起使用进攻分支，否则保持结构分支。只选择一次。
    </label>}
    <p className="text-muted-foreground">{isRaceRouter(router)
      ? '这是独立工作副本，修改后可保存、运行，再存为新模板。初始卖出、镜像、止损、加仓通用设置、卖出切换和否决阶段为公共设置；修改一边后，保存时同步到另一边。两个分支各次加仓条件分别修改，进攻分支的轮数不多于结构分支。'
      : `这是独立工作副本，修改后可保存、运行，再存为新模板。初始卖出、镜像、止损、加仓通用设置和${routerPrefixText(router)}加仓为公共设置；修改一边后，保存时同步到另一边。第${routerNextOrdinal(router)}次及之后的加仓、卖出切换和否决阶段可分别修改。`}</p>
    <div role="tablist" aria-label="编辑条件分支" className="flex gap-2">{(['structure', 'attack'] as const).map(key => <button type="button" role="tab" aria-selected={branch === key} key={key} onClick={() => { setBranch(key); setVisited(old => ({ ...old, [key]: true })); }} className={`rounded px-2 py-1 ${branch === key ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{key === 'structure' ? '结构分支' : '进攻分支'}</button>)}</div>
    {(['structure', 'attack'] as const).map(key => {
      if (!visited[key] && !imageCapture) return null;
      const original = router[key], monitorDirty = JSON.stringify(drafts[key]) !== JSON.stringify(monitorDraftOf(original));
      return <div key={key} hidden={branch !== key} data-settings-image-include="" data-testid={`router-branch-${key}`}>
        {imageCapture&&<h3 hidden data-settings-image-include="">{key==='structure'?'结构分支':'进攻分支'}</h3>}
        <FishQualitySellPlansEditor plans={branchPlans[key]} ready={ready} embedded onSave={() => {}} extraDirty={monitorDirty}
          onDirtyChange={branchDirtyCallbacks[key]}
          prepare={plans => monitorDirty ? plans.map(p => ({ ...p, ...parseRouterMonitorDraft(original, drafts[key], definitions) })) : plans}
          renderHolding={view => { views.current[key] = view; return <HoldingMonitorEditor ready={ready} plan={view.plans[0]} draft={drafts[key]}
            setDraft={draft => setDrafts(old => ({ ...old, [key]: draft }))} save={() => {}} error="" allDirty={false} count={1} hideSave/>; }}/>
      </div>;
    })}
  </section>;
}

/** The tab list and algorithm cards are projections of the same draft IDs and order. */
export function MonitorTimePicker({ trigger, onChoose, restart = false, running = false }: {
  trigger: ReactElement;
  onChoose: (basis: QualityMonitorTimeBasis) => void;
  restart?: boolean;
  running?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const choose = (basis: QualityMonitorTimeBasis) => {
    setOpen(false);
    onChoose(basis);
  };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
    <PopoverContent align="start" className="w-64 p-1" aria-label={restart ? '选择重新计算起点' : '选择监测起点'}>
      {restart && <div className="px-2 py-1 text-[11px]">
        <p className="font-medium">从头重新计算</p>
        {running && <p className="text-[10px] text-muted-foreground">选定起点后，先停止当前批次。</p>}
      </div>}
      <button type="button" aria-label="基于信号时间" className="block w-full rounded px-2 py-1.5 text-left hover:bg-muted" onClick={() => choose('signal')}>
        <span className="block text-[11px] font-medium">基于信号时间</span>
        <span className="block text-[10px] text-muted-foreground">从组合表的原信号时点开始</span>
      </button>
      <button type="button" aria-label="基于筛选时间" className="block w-full rounded px-2 py-1.5 text-left hover:bg-muted" onClick={() => choose('screening')}>
        <span className="block text-[11px] font-medium">基于筛选时间</span>
        <span className="block text-[10px] text-muted-foreground">从动态筛选首次满足的时点开始，跳过无入选时点的记录</span>
      </button>
    </PopoverContent>
  </Popover>;
}

export function HoldingMonitorSettings({state,activeId,onSelect,done,selectedCount,outsideHint,instant}:{state:FishQualityState;activeId:string|null;onSelect:(id:string)=>void;done:()=>void;selectedCount:number;outsideHint?:ReactNode;instant?:boolean}) {
  const imageCapture=useSettingsImageCapture();
  const definitions=useFeatureDefinitions(),plans=state.study.sellPlans??EMPTY_PLANS;
  const [positions, setPositions] = useState<Record<string, PositionManagementDraft>>({});
  const [drafts,setDrafts]=useState<Record<string,{base:string;draft:MonitorDraft}>>({});
  const forPlan=(p:QualityGroup)=>drafts[p.id]?.base===monitorBaseKey(p)?drafts[p.id].draft:monitorDraftOf(p);
  const changed=(p:QualityGroup)=>JSON.stringify(forPlan(p))!==JSON.stringify(monitorDraftOf(p));
  const controllers=useRef<Record<string,{current:RouterDraftHandle|null}>>({});
  const [routerDirty,setRouterDirty]=useState<Record<string,boolean>>({});
  const setRouterDirtyFlag=useCallback((id:string,dirty:boolean)=>setRouterDirty(old=>old[id]===dirty?old:{...old,[id]:dirty}),[]);
  const extraDirty=Object.keys(positions).length>0||plans.some(changed)||Object.values(routerDirty).some(Boolean);
  const merge=(next:QualityGroup[])=>next.map(original=>{
    const draft = positions[original.id];
    const isNewPlan = !original.frozenVersions && !plans.some(p => p.id === original.id);
    const positionManagement = draft ? parsePositionManagement(draft)
      : original.positionManagement ?? (isNewPlan ? parsePositionManagement(positionManagementDraft()) : undefined);
    const p = positionManagement && !isLegacyQualityPlan(original) ? { ...original, positionManagement } : original;
    // 【用户要求】2026-11-03 旧引擎方案不经过新版监测表单（表单会把加仓改写成箱体），原样保存
    if(p.router){
      const router=controllers.current[p.id]?.current?.build()??p.router;
      return router===p.router?p:{...router.structure,id:p.id,label:p.label,buyFilters:p.buyFilters,frozenVersions:p.frozenVersions,router,...(positionManagement ? { positionManagement } : {})};
    }
    if(!changed(p)||isLegacyQualityPlan(p))return p;
    try { return {...p,...parseMonitorDraft(forPlan(p),definitions)}; } catch(cause) { throw new Error(`${p.label}：${cause instanceof Error?cause.message:'监测条件无效'}`); }
  });
  return <FishQualitySellPlansEditor plans={plans} ready={state.ready} singlePlan={instant} onSave={next => { state.setSellPlans(next); if (!instant) setPositions({}); }} onSelectPlan={onSelect} recoverablePlans={instant ? undefined : recoverableQualityPlans(state.study,readSavedQualityPlans(state.account))} templates={!instant&&state.savePlanTemplate&&state.deletePlanTemplate?{owner:state.account,restore:state.restorePlanTemplate,templates:activeQualityPlanTemplates(state.study),save:state.savePlanTemplate,remove:state.deletePlanTemplate}:undefined} onCopyPlan={(source,copy)=>{
    const position = positions[source.id];
    if (position) setPositions(current => ({ ...current, [copy.id]: { ...position } }));
    if(copy.router){copy.router=structuredClone(controllers.current[source.id]?.current?.build()??copy.router);return;}
    setDrafts(current=>({...current,[copy.id]:{base:monitorBaseKey(copy),draft:structuredClone(forPlan(source))}}));
  }} extraDirty={extraDirty} prepare={merge} renderHolding={view=>{
    const active=view.plans.find(p=>p.id===activeId)??view.plans[0];
    const savedPlan=plans.find(p=>p.id===active?.id);
    return <>
      <p className="mb-2 text-[10.5px] text-muted-foreground" data-testid="monitor-plan-draft-count">监测方案 {view.plans.length} 套 · 与上方按编号一一对应{view.dirty?' · 有待保存设置':''}</p>
      {view.plans.length>0&&<div role="tablist" aria-label="选择要设置持仓监测的卖出方案" className="mb-3 flex flex-wrap gap-1 rounded-md bg-muted/60 p-1 text-[10.5px]">{view.plans.map((p,i)=>{
        const d=forPlan(p),n=d.vetoes.filter(v=>v.enabled).length+(d.mirror.enabled?1:0)+(d.addition.enabled?1:0)+[d.addition,...d.addition.otherRounds].slice(0,Math.max(1,Number(d.addition.maxRounds)||1)).filter(r=>r.sellSwitch?.enabled).length+(d.vetoStages.enabled?d.vetoStages.stages.length:0);
        return <button type="button" role="tab" key={p.id} data-plan-id={p.id} aria-selected={active?.id===p.id} onClick={()=>onSelect(p.id)} className={`inline-flex min-h-6 items-center gap-1 rounded px-2 py-1 ${active?.id===p.id?'bg-background font-medium shadow-sm':'text-muted-foreground hover:text-foreground'}`}><span className="text-muted-foreground">{i+1}.</span>{p.label}<span title="当前填写中已启用的监测条件数" className="rounded bg-primary/15 px-1 text-[9px] tabular-nums text-primary">{n} 项条件</span></button>;
      })}</div>}
      {!instant&&savedPlan&&hasQualityExit(savedPlan)&&<button type="button" className={button+' mb-2'} disabled={!state.ready} aria-pressed={state.study.selectedSellId===savedPlan.id} onClick={()=>state.selectSell(savedPlan.id)}>固定此方案，比较探测算法</button>}
      {active && !isLegacyQualityPlan(active) && <div className="mb-3">
        <FishQualityPositionManagement
          draft={positions[active.id] ?? positionManagementDraft(active.positionManagement ?? (!savedPlan ? undefined : instant ? { leverage: INSTANT_POSITION.leverage, notional: INSTANT_POSITION.leverage * INSTANT_POSITION.marginUsdt } : qualityPositionSize(active)))}
          onChange={state.ready ? draft => setPositions(current => ({ ...current, [active.id]: draft })) : undefined}
          note={savedPlan && !savedPlan.positionManagement && !positions[active.id]
            ? '保存后应用于新运行。' : undefined}/>
        {savedPlan && !savedPlan.positionManagement && !positions[active.id] && <button type="button" className={button}
          disabled={!state.ready} onClick={() => setPositions(current => ({ ...current, [active.id]: positionManagementDraft() }))}>采用默认仓位</button>}
      </div>}
      {view.plans.filter(p=>p.router).map(p=><div key={p.id+':'+JSON.stringify(p.router)} hidden={active?.id!==p.id} data-settings-image-include="">
        <EditableQualityRouter plan={p} ready={state.ready} controller={controllers.current[p.id]??(controllers.current[p.id]={current:null})} onDirtyChange={setRouterDirtyFlag}/>
      </div>)}
      {active&&isLegacyQualityPlan(active)?<div className="space-y-3" data-testid="quality-monitor-legacy" data-plan-id={active.id}>
        <p className="text-xs font-medium">持仓监测 · {active.label}</p>
        <FishQualityMonitorSettingsView plan={active} holdingOnly/>
        <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-border/50 bg-popover px-4 py-2.5"><SettingsImageButton/><button type="button" disabled={!state.ready} onClick={()=>{if(view.save())done();}} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40">{`保存全部 ${view.plans.length} 套方案`}</button></div>
        {view.error&&<p role="alert" className="text-[11px] text-destructive">{view.error}</p>}
      </div>:active?.router?<div className="contents" data-testid="quality-monitor-router-settings">
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border/50 bg-popover px-4 py-2.5">
          {view.error&&<p role="alert" className="w-full text-[11px] text-destructive">{view.error}</p>}
          <span className="mr-auto text-[10.5px] text-muted-foreground">{view.dirty?'方案尚未保存':'当前方案已保存'} · 本轮已勾选 {selectedCount} 条{outsideHint&&<> · {outsideHint}</>}</span>
          <SettingsImageButton/>
          <button type="button" disabled={!state.ready} onClick={()=>{if(view.save())done();}} className="h-7 rounded-md border border-primary/30 px-2.5 text-[11px] text-primary disabled:opacity-40">保存方案</button>
          {!instant && <MonitorTimePicker onChoose={basis => { if (view.save()) { done(); void state.start(false, undefined, false, basis); } }}
            trigger={<button type="button" disabled={!state.ready || !selectedCount} title={selectedCount ? '选择起点后保存方案并开始监测' : '请先在组合表中勾选本轮要监测的信号'} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40">保存并开始监测</button>}/> }
        </div>
      </div>:active?<HoldingMonitorEditor key={active.id} ready={state.ready} plan={active} draft={forPlan(active)} setDraft={draft=>setDrafts(current=>({...current,[active.id]:{base:monitorBaseKey(active),draft}}))}
        allDirty={view.algorithmsDirty || view.plans.some(p=>p.id!==active.id&&changed(p))} count={view.plans.length} error={view.error} save={()=>{
          const saved=view.save(next=>next.map(p=>{
            // Untouched saved/copied settings must not be rebuilt from form defaults on Save.
            if(p.id!==active.id||isLegacyQualityPlan(p)||p.router||!changed(active))return p;
            try { return {...p,...parseMonitorDraft(forPlan(active),definitions)}; } catch(cause) { throw new Error(`${p.label}：${cause instanceof Error?cause.message:'监测条件无效'}`); }
          }));
          if(saved)done();
        }}/>:<p className="pb-3 text-[11px] text-muted-foreground">暂无监测方案；新增上方算法后即可设置加仓条件。<SettingsImageButton className="ml-2"/></p>}
      {imageCapture&&<div hidden data-settings-image-include="">{view.plans.filter(p=>p.id!==active?.id&&!p.router).map(p=><div key={p.id}><h3>持仓监测 · {p.label}</h3>{isLegacyQualityPlan(p)?<FishQualityMonitorSettingsView plan={p} holdingOnly/>:<HoldingMonitorEditor ready={false} plan={p} draft={forPlan(p)} setDraft={()=>{}} save={()=>{}} error="" allDirty={false} count={view.plans.length} hideSave/>}</div>)}</div>}
    </>;
  }}/>;
}
