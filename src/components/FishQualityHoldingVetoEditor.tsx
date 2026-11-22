import {MIRROR_DEADLINE_KIND,MIRROR_DEADLINE_DEFAULT_HOURS} from '@/lib/fish/qualityMirrorDeadline';
import {FishBoxStopInfo} from './FishBoxStopInfo';
import {FishQualityBoxStopEditor} from './FishQualityBoxStopEditor';
import {POST_MIRROR_PROTECTION_VERSION,isCdaProtection} from '@/lib/fish/qualityPostMirrorProtection';
import {BOX_STOP_KIND,BOX_BREAK_CHOICE,BOX_SECOND_BREAK_CHOICE,BOX_SECOND_EXIT_CHOICE,defaultBoxSecondExit,defaultBoxSecondBreak,defaultBoxBreak,defaultBoxStop} from '@/lib/fish/qualityBoxStop';
import { DBL5_RETEST_GUARD_VERSION } from '@/lib/dbl5m';
import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import { useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import { qualityFilterDefinitions, qualityFilterMenuChoices, type HoldingVetoDraft } from '@/lib/fish/qualityFilters';
import { FishMetricTimeFields } from './FishMetricTimeFields';
import { LIMITED_STATIC_DRAWDOWN_CHOICE, LIMITED_STATIC_DRAWDOWN_LABEL, FREE_STATIC_DRAWDOWN_LABEL, isHoldingPriceChoice, ADDITION_PROFIT_KIND, ADDITION_PROFIT_LABEL, PAYOFF_STOP_KIND, type QualityOperator } from '@/lib/fish/qualityVeto';
const field='h-7 min-w-0 rounded-md bg-muted/50 px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring';
type VetoEditorProps={draft:HoldingVetoDraft[];setDraft:(draft:HoldingVetoDraft[])=>void;compact?:boolean;hardStopPanel?:boolean;readOnly?:boolean;labelPrefix?:string;entry?:boolean;mirrorPhase?:'before'|'after'};
const noDefinitions:ReturnType<typeof useFeatureDefinitions>=[];
const ignore=()=>{};
export function FishQualityHoldingVetoEditor(props:VetoEditorProps){
  return <HoldingVetoFields {...props} definitions={useFeatureDefinitions()}/>;
}
export function FishFrozenHoldingVetoEditor(props:Omit<VetoEditorProps,'setDraft'>){
  return <HoldingVetoFields {...props} definitions={noDefinitions} setDraft={ignore} frozen/>;
}
function HoldingVetoFields({draft,setDraft,compact=false,hardStopPanel=false,readOnly=false,labelPrefix='',entry=false,mirrorPhase,definitions,frozen=false}:
  VetoEditorProps & {definitions:ReturnType<typeof useFeatureDefinitions>;frozen?:boolean}) {
  const newBoxSecondExit=()=>defaultBoxSecondExit(definitions, DBL5_RETEST_GUARD_VERSION);
  const newBoxSecondBreak=()=>defaultBoxSecondBreak(definitions, DBL5_RETEST_GUARD_VERSION);
  const newBoxBreak=()=>defaultBoxBreak(definitions, DBL5_RETEST_GUARD_VERSION);
  const choices=useMemo(()=>qualityFilterMenuChoices(definitions),[definitions]),groups=[...new Set(choices.map(c=>c.group))];
  const metricDefinitions=useMemo(()=>qualityFilterDefinitions(definitions),[definitions]);
  const cdaChoice=choices.find(c=>c.featureId==='cda'&&c.metric==='CDA')??choices.find(c=>c.featureId==='cda');
  const patch=(i:number,p:Partial<HoldingVetoDraft>)=>setDraft(draft.map((d,j)=>j===i?{...d,...p}:d));
  const riskSummary=([[LIMITED_STATIC_DRAWDOWN_CHOICE,LIMITED_STATIC_DRAWDOWN_LABEL],['static-drawdown',entry?'筛选过程静态最大回撤':FREE_STATIC_DRAWDOWN_LABEL],['dynamic-drawdown','动态回撤'],['drop-1m','1分钟内跌幅'],['drop-5m','5分钟内跌幅']] as const).map(([kind,label])=>{
    const enabled=draft.filter(d=>d.enabled&&d.choice===kind);
    if(!enabled.length)return `${label}否决未启用`;
    const values=enabled.map(d=>d.threshold.trim()?Number(d.threshold):NaN);
    if(values.some(v=>!Number.isFinite(v)||v<=0||v>100))return `${label}阈值待完善`;
    return `${label} ≥ ${Math.min(...values)}%${enabled.length>1?'（同类条件中较小阈值先触发）':''}`;
  }).join('；');
  const allowDeadline=hardStopPanel&&!entry&&mirrorPhase!=='after';
  const actions=<>
    <div className="flex flex-wrap gap-x-3 gap-y-2">{allowDeadline&&<button type="button" className="inline-flex items-center gap-1 text-[11px] text-primary" onClick={()=>setDraft([...draft,{choice:MIRROR_DEADLINE_KIND,direction:'>=',threshold:String(MIRROR_DEADLINE_DEFAULT_HOURS),enabled:false}])}><Plus className="h-3 w-3"/>添加镜像限时终止</button>}<button type="button" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" onClick={()=>setDraft([...draft,{choice:'static-drawdown',direction:'>=',threshold:'',enabled:false}])}><Plus className="h-3 w-3"/>添加否决条件</button>
      <button type="button" disabled={entry} title={entry?"观察期间没有实际加仓仓位，不适用":undefined} className="inline-flex items-center gap-1 text-[11px] text-primary disabled:opacity-40" onClick={()=>setDraft([...draft,{choice:ADDITION_PROFIT_KIND,direction:'>=',threshold:'5',geometricMultiple:'100',enabled:false}])}><Plus className="h-3 w-3"/>添加加仓止盈约束</button>
      <button type="button" disabled={entry} title={entry?"观察期间没有持仓盈亏，不适用":undefined} className="inline-flex items-center gap-1 text-[11px] text-primary disabled:opacity-40" onClick={()=>setDraft([...draft,{choice:PAYOFF_STOP_KIND,direction:'>=',threshold:'5000',enabled:true}])}><Plus className="h-3 w-3"/>添加盈亏比止盈</button>
      <button type="button" className="inline-flex items-center gap-1 text-[11px] text-primary" onClick={()=>setDraft([...draft,{choice:BOX_STOP_KIND,direction:'<=',threshold:'0',enabled:false,boxStop:defaultBoxStop(definitions)}])}><Plus className="h-3 w-3"/>添加箱体终止</button>
      <button type="button" aria-label={mirrorPhase==='before'?'添加防守线断裂即退出（镜像前）':undefined} className="inline-flex items-center gap-1 text-[11px] text-primary" onClick={()=>setDraft([...draft,{choice:BOX_BREAK_CHOICE,direction:'<=',threshold:'0',enabled:false,boxStop:newBoxBreak()}])}><Plus className="h-3 w-3"/>添加支撑断裂终止</button>
      <button type="button" disabled={entry||mirrorPhase==='before'} className="inline-flex items-center gap-1 text-[11px] text-primary disabled:opacity-40" onClick={()=>setDraft([...draft,{choice:BOX_SECOND_BREAK_CHOICE,direction:'<=',threshold:'0',enabled:false,boxStop:newBoxSecondBreak()}])}><Plus className="h-3 w-3"/>添加二次断裂终止</button>
      <button type="button" aria-label={mirrorPhase==='after'?'添加防守线首次观察、二次退出（镜像后）':undefined} disabled={entry||mirrorPhase==='before'} className="inline-flex items-center gap-1 text-[11px] text-primary disabled:opacity-40" onClick={()=>setDraft([...draft,{choice:BOX_SECOND_EXIT_CHOICE,direction:'<=',threshold:'0',enabled:false,boxStop:newBoxSecondExit()}])}><Plus className="h-3 w-3"/>添加持仓期间二次断裂终止</button></div>
    {!entry&&!mirrorPhase&&<div className="flex flex-wrap gap-3 border-t border-border/50 pt-2">
      <button type="button" className="inline-flex items-center gap-1 text-[11px] text-primary" onClick={()=>setDraft([...draft,{choice:BOX_BREAK_CHOICE,direction:'<=',threshold:'0',enabled:false,boxStop:newBoxBreak(),activation:POST_MIRROR_PROTECTION_VERSION}])}><Plus className="h-3 w-3"/>添加镜像减仓后 DBL-5 防守线</button>
      <button type="button" data-testid="add-post-mirror-observe-second-exit" className="inline-flex items-center gap-1 text-[11px] text-primary" onClick={()=>setDraft([...draft,{choice:BOX_SECOND_EXIT_CHOICE,direction:'<=',threshold:'0',enabled:false,boxStop:newBoxSecondExit(),activation:POST_MIRROR_PROTECTION_VERSION}])}><Plus className="h-3 w-3"/>添加镜像减仓后防守线首次观察、二次退出</button>
      <button type="button" className="inline-flex items-center gap-1 text-[11px] text-primary" onClick={()=>setDraft([...draft,{choice:BOX_SECOND_BREAK_CHOICE,direction:'<=',threshold:'0',enabled:false,boxStop:newBoxSecondBreak(),activation:POST_MIRROR_PROTECTION_VERSION}])}><Plus className="h-3 w-3"/>添加镜像减仓后 DBL-5 二次支撑断裂</button>
      <button type="button" className="inline-flex items-center gap-1 text-[11px] text-primary" onClick={()=>setDraft([...draft,{choice:BOX_SECOND_EXIT_CHOICE,direction:'<=',threshold:'0',enabled:false,boxStop:newBoxSecondExit(),activation:POST_MIRROR_PROTECTION_VERSION}])}><Plus className="h-3 w-3"/>添加镜像减仓后持仓期间二次断裂终止</button>
      <button type="button" disabled={!cdaChoice} className="inline-flex items-center gap-1 text-[11px] text-primary disabled:opacity-40" onClick={()=>cdaChoice&&setDraft([...draft,{choice:cdaChoice.key,direction:'<',threshold:'-15',enabled:false,activation:POST_MIRROR_PROTECTION_VERSION}])}><Plus className="h-3 w-3"/>添加镜像减仓后 CDA＜−15</button>
    </div>}
  </>;

  return <section className={hardStopPanel?"space-y-2":"border-t border-border pt-3 space-y-2"} data-testid="quality-holding-veto-editor">
    {!compact&&!hardStopPanel&&<><p className="text-xs font-medium">持仓一票否决卖出</p>
    <p className="text-[10.5px] leading-relaxed text-muted-foreground">任一启用约束完整达标，立即按最早可确认时点卖出；同一约束中的条件须同时满足，不同约束任一条达标即可，无需设置或等待普通卖出门槛。回撤盘中触价即模拟成交；指标逐分钟复原，不等原周期 K 线收盘。否决规则只作用于当前这套卖出方案（固定它做探测比较时同样生效），其他方案各有各的。阈值由你填写，未启用不生效。</p>
    </>}
    <div className="space-y-2">{draft.map((d,i)=>{const risk=isHoldingPriceChoice(d.choice)||d.choice===LIMITED_STATIC_DRAWDOWN_CHOICE,addition=d.choice===ADDITION_PROFIT_KIND,deadline=d.choice===MIRROR_DEADLINE_KIND,payoff=d.choice===PAYOFF_STOP_KIND,secondBreak=d.choice===BOX_SECOND_BREAK_CHOICE||d.choice===BOX_SECOND_EXIT_CHOICE,box=d.choice===BOX_STOP_KIND||d.choice===BOX_BREAK_CHOICE||secondBreak,afterMirror=!!d.activation||d.mirrorStage?.stage==='after',choice=choices.find(c=>c.key===d.choice),postMirrorKind=d.boxStop?.channels?'箱体 / 急拉线 K':box&&d.boxStop?.structure.algorithm==='dbl5'&&d.boxStop.structure.kSource==='guard'&&!d.boxStop.reference?(d.choice===BOX_SECOND_EXIT_CHOICE?'DBL-5 持仓期间二次断裂终止':secondBreak?'DBL-5 二次支撑断裂':'DBL-5 防守线'):isCdaProtection(choice?.featureId??d.saved?.snapshot?.featureId)?'硬性终止 CDA':undefined;const showMirrorGate=!!(postMirrorKind||d.activation)&&!entry&&!mirrorPhase&&!d.mirrorStage;
      const activationInfo=<><p>以本次持仓的镜像平衡减仓成交记录为准；未启用或未成交时，本条不参与终止。开盘减仓后当分钟可检查；盘中减仓后防守线从下一分钟启动，CDA 从减仓后的首个可确认读数启动。不追补启动前的断裂、收盘计数或指标触发。其他终止与加减仓规则独立生效。</p>{secondBreak&&<p>{d.choice===BOX_SECOND_EXIT_CHOICE?'减仓后第一次独立断裂只计数，不因本条停加仓；第二次独立断裂全仓终止。':'减仓后第一次独立断裂停止本笔后续加仓；第二次独立断裂全仓终止。'}启动前的断裂不计入，暂停恢复保留启动后的计数。</p>}</>;
      return <div key={i} className={addition||box?'flex flex-wrap items-center gap-2 rounded border border-border/60 p-2':'flex flex-wrap items-center gap-1'}>
      {afterMirror&&d.choice===BOX_SECOND_EXIT_CHOICE&&<p data-testid="post-mirror-observe-second-exit" className="w-full text-[11px] font-medium text-primary">镜像平衡减仓后：防守线第一次断裂观察，第二次断裂退出</p>}
      <input type="checkbox" className="h-3 w-3 shrink-0" aria-label={`${labelPrefix}启用持仓否决 ${i+1}`} disabled={entry&&(addition||payoff||secondBreak)} checked={d.enabled} onChange={e=>patch(i,{enabled:e.target.checked})}/>
      <select aria-label={`${labelPrefix}持仓否决 ${i+1} 指标`} className={`${field} flex-1`} style={{minWidth:"12rem",maxWidth:"100%"}} value={frozen&&d.saved?'frozen':d.choice} onChange={e=>patch(i,{choice:e.target.value,time:undefined,saved:undefined,activation:undefined,...(e.target.value===BOX_SECOND_EXIT_CHOICE?{boxStop:newBoxSecondExit(),threshold:'0'}:e.target.value===BOX_SECOND_BREAK_CHOICE?{boxStop:newBoxSecondBreak(),threshold:'0'}:e.target.value===BOX_BREAK_CHOICE?{boxStop:newBoxBreak(),threshold:'0'}:e.target.value===BOX_STOP_KIND?{boxStop:defaultBoxStop(definitions),threshold:'0'}:{}),direction:isHoldingPriceChoice(e.target.value)||e.target.value===LIMITED_STATIC_DRAWDOWN_CHOICE||e.target.value===ADDITION_PROFIT_KIND||e.target.value===PAYOFF_STOP_KIND?'>=':d.direction,...(e.target.value===MIRROR_DEADLINE_KIND?{threshold:String(MIRROR_DEADLINE_DEFAULT_HOURS),direction:'>='}:{}),...(e.target.value===ADDITION_PROFIT_KIND?{threshold:'5',geometricMultiple:'100'}:e.target.value===PAYOFF_STOP_KIND?{threshold:'5000'}:{})})}>
        {frozen&&d.saved&&<option value="frozen">{d.saved.label}</option>}
        {d.choice.includes(':')&&!choices.some(c=>c.key===d.choice)&&<option hidden disabled value={d.choice}>已保存指标：{d.choice}</option>}<optgroup label="止盈"><option value={PAYOFF_STOP_KIND} disabled={entry||mirrorPhase==='before'}>盈亏比 ≥ N R{entry?'（观察期间无持仓，不适用）':'（立刻全部卖出）'}</option><option value={ADDITION_PROFIT_KIND} disabled={entry||mirrorPhase==='before'}>{ADDITION_PROFIT_LABEL}{entry?'（观察筛选不适用）':''}</option></optgroup><optgroup label={entry?'筛选过程':'持仓过程'}><option value={LIMITED_STATIC_DRAWDOWN_CHOICE} disabled={entry}>{LIMITED_STATIC_DRAWDOWN_LABEL}{entry?'（仅适用持仓）':''}</option><option value="static-drawdown">{entry?'筛选过程静态最大回撤':FREE_STATIC_DRAWDOWN_LABEL}</option><option value="dynamic-drawdown">{entry?'筛选过程':'持仓过程'}动态最大回撤</option></optgroup>
        {(allowDeadline||deadline)&&<optgroup label="镜像限时终止"><option value={MIRROR_DEADLINE_KIND} disabled={!allowDeadline}>限时未实现镜像平衡减仓</option></optgroup>}<optgroup label="短时跌幅"><option value="drop-1m">1分钟内跌幅</option><option value="drop-5m">5分钟内跌幅</option></optgroup>
        <optgroup label="箱体硬止损"><option value={BOX_STOP_KIND}>箱体算法 · K 硬止损</option><option value={BOX_BREAK_CHOICE}>支撑断裂即终止 · 防守线红叉</option><option value={BOX_SECOND_BREAK_CHOICE} disabled={entry||mirrorPhase==='before'}>首次断裂停加仓，二次断裂终止{entry?'（仅适用持仓）':''}</option><option value={BOX_SECOND_EXIT_CHOICE} disabled={entry}>持仓期间二次断裂终止{entry?'（仅适用持仓）':''}</option></optgroup>{groups.map(g=><optgroup key={g} label={g}>{choices.filter(c=>c.group===g).map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>)}
      </select>
      {!addition&&!box&&!deadline&&<><select aria-label={`${labelPrefix}持仓否决 ${i+1} 方向`} className={`${field} w-14`} value={d.direction} disabled={risk||payoff} onChange={e=>patch(i,{direction:e.target.value as QualityOperator})}>{(risk||payoff?['>=']:['>=','>','<=','<']).map(v=><option key={v} value={v}>{v==='>='?'≥':v==='<='?'≤':v}</option>)}</select>
      <input aria-label={`${labelPrefix}持仓否决 ${i+1} 阈值`} type="number" step="any" min={risk ? 0 : undefined} max={risk ? 100 : undefined} placeholder="自行设置" className={field} style={{width:`calc(${Math.max(4,d.threshold.length)}ch + 4.5rem)`,flexShrink:0}} value={d.threshold} onChange={e=>patch(i,{threshold:e.target.value})}/>{risk&&<span className="text-[10px]">%</span>}{payoff&&<span className="text-[10px]" title="盈亏比＝整笔盈亏 ÷ L₀；L₀＝初始仓位 × 初始静态回撤阈值">R</span>}</>}
      <button type="button" aria-label={`${labelPrefix}删除持仓否决 ${i+1}`} className="p-1 text-muted-foreground" onClick={()=>setDraft(draft.filter((_,j)=>i!==j))}><X className="h-3 w-3"/></button>
      {deadline&&<><label className="inline-flex items-center gap-1 text-[11px]">持仓<input aria-label={`${labelPrefix}持仓否决 ${i+1} 镜像时限（小时）`} type="number" min={1/60} max={8784} step="any" className={field} style={{width:`calc(${Math.max(4,d.threshold.length)}ch + 3rem)`}} value={d.threshold} onChange={e=>patch(i,{threshold:e.target.value})}/>小时未实现镜像平衡减仓，即清仓</label><p className="w-full pl-4 text-[10px] text-muted-foreground">从首次建仓计时，按分钟检查；可填 0.5 表示 30 分钟。到期前已实际成交镜像减仓则继续按原规则持有，否则发出全仓市价卖出；加仓不重置计时，其他止损照常生效。</p></>}
      {d.choice===LIMITED_STATIC_DRAWDOWN_CHOICE&&(hardStopPanel
        ?<FishBoxStopInfo label={labelPrefix+'限制静态回撤说明'}><p>按首仓买入价计算。盘中触线清仓，开盘越线按开盘价成交。起始阶段的限制阈值可用于计算初始风险。</p></FishBoxStopInfo>
        :<p className="w-full pl-4 text-[10px] text-muted-foreground">限制止损价＝首仓买入价 ×（1−阈值%），盘中触及卖出全部余仓；开盘跳空越线按开盘价。本条按所属阶段生效，起始有效的限制阈值可作为初始风险依据。</p>)}
      {showMirrorGate&&<div className="flex w-full flex-wrap items-center gap-1 pl-4 text-[11px]"><label className="inline-flex cursor-pointer items-center gap-2">
        <input type="checkbox" aria-label={`${labelPrefix}只在镜像平衡减仓策略后启动${postMirrorKind} ${i+1}`} checked={!!d.activation}
          onChange={e=>patch(i,{activation:e.target.checked?POST_MIRROR_PROTECTION_VERSION:undefined})}/>
        {box?'镜像减仓后启用':<>只在镜像平衡减仓策略后启动{postMirrorKind}</>}
      </label>{box&&<FishBoxStopInfo label={`${labelPrefix}箱体止损 ${i+1} 启动说明`}>{activationInfo}</FishBoxStopInfo>}</div>}
      {afterMirror&&box&&!showMirrorGate&&<div className="flex w-full items-center gap-1 pl-4"><span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">镜像后生效</span><FishBoxStopInfo label={`${labelPrefix}箱体止损 ${i+1} 启动说明`}>{activationInfo}</FishBoxStopInfo></div>}
      {afterMirror&&!box&&hardStopPanel&&<FishBoxStopInfo label={labelPrefix+'启动说明'}>{activationInfo}</FishBoxStopInfo>}
      {afterMirror&&!box&&!hardStopPanel&&<p className="w-full pl-4 text-[10px] leading-relaxed text-muted-foreground">以本次持仓的镜像平衡减仓成交记录为准；未启用或未成交时，本条不参与终止。开盘减仓后当分钟可检查；盘中减仓后防守线从下一分钟启动，CDA 从减仓后的首个可确认读数启动。不追补启动前的断裂、收盘计数或指标触发。其他终止与加减仓规则独立生效。</p>}

      {(choice || d.saved?.snapshot) && <FishMetricTimeFields label={`${labelPrefix}持仓否决 ${i+1}`} className="basis-full pl-4"
        metric={d.saved?.metric ?? choice?.metric} definition={choice && metricDefinitions.get(choice.featureId)}
        snapshot={d.saved?.snapshot} time={d.time} onChange={time=>patch(i,{time})}/>}
      {box&&<FishQualityBoxStopEditor afterMirror={afterMirror} entry={entry} rule={d.boxStop??(d.choice===BOX_SECOND_EXIT_CHOICE?newBoxSecondExit():d.choice===BOX_SECOND_BREAK_CHOICE?newBoxSecondBreak():d.choice===BOX_BREAK_CHOICE?defaultBoxBreak(definitions):defaultBoxStop(definitions))} onChange={boxStop=>patch(i,{boxStop})} disabled={!d.enabled} prefix={`${labelPrefix}箱体止损 ${i+1} `} definitions={definitions}/>}
      {addition&&<div className="flex w-full flex-wrap items-center gap-x-2 gap-y-2 text-[11px]"><span>几何仓位 ≥</span><input aria-label={`${labelPrefix}持仓否决 ${i+1} 几何仓位倍数`} type="number" min="0" step="any" value={d.geometricMultiple??'100'} className={field+' w-20'} onChange={e=>patch(i,{geometricMultiple:e.target.value})}/><span>倍，且价格高出均衡价 ≥</span><input aria-label={`${labelPrefix}持仓否决 ${i+1} 均衡价涨幅`} type="number" min="0" step="any" value={d.threshold} className={field+' w-20'} onChange={e=>patch(i,{threshold:e.target.value})}/><span>%</span><p className="w-full text-[10px] text-muted-foreground">实际加仓后才检查；均衡价取最近实际加仓的 K。两项同时满足即卖出全部余仓与加仓，多个约束任一条达标即可。</p></div>}
    </div>;})}</div>
    {!compact&&<details open={hardStopPanel?undefined:true} className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">阈值与成交说明</summary><p className="text-[10.5px] leading-relaxed text-primary" data-testid="quality-veto-risk-summary">当前填写（应用后生效）：{riskSummary}。</p>
    <p className="text-[10px] leading-relaxed text-muted-foreground">{FREE_STATIC_DRAWDOWN_LABEL}以买入价为基准，在此独立勾选和填写阈值。动态回撤是先前高点至后续低点的最大跌幅，需另行启用。按止损单成交：盘中一触及止损价即按止损价卖出；开盘就跳空越线的按开盘价卖出，回撤可能超过阈值。同一分钟高低点先后不明时，不假定高点先发生。</p>
    <p className="text-[10px] leading-relaxed text-muted-foreground">短时跌幅：每分钟收盘检查，跌幅 =（窗口起点开盘价 − 当前收盘价）÷ 起点开盘价 × 100%。1 分钟取最近一根分钟 K 线；5 分钟取最近五根，每分钟滚动，持仓不足五分钟从买入时刻起算。达到你填写的百分比（≥）后，按下一分钟开盘价模拟卖出；不使用买入前价格，也不把盘中下影线当作收盘跌幅。</p>
    <p className="text-[10px] leading-relaxed text-muted-foreground">盈亏比止盈：整笔盈亏（镜像平衡减仓、减仓等已落袋＋按当时价格计的全部持仓）÷ L₀ ≥ N 时，立刻卖出全部持仓（含各次加仓）；盘中触及按目标价、开盘跳过按开盘价成交。新保存的条件有起始限制静态最大回撤时，L₀＝初始仓位 × 该限制阈值；其余方案沿用自由静态最大回撤作为计算依据。目前在启用条件加仓、镜像平衡减仓成交之后生效。</p>
    <p className="text-[10px] text-muted-foreground">指标选项来自当前账号公式，含自定义指标及公式变量；新增指标可在 Deep dig 定义。</p>
    </details>}
    {!readOnly&&(hardStopPanel?<details className="text-xs" data-settings-image-skip="">
      <summary className="w-fit cursor-pointer text-primary">添加条件</summary>
      <div className="mt-2 space-y-2 rounded-md border border-border p-2" onClick={e=>{
        if(!(e.target instanceof Element)||!e.target.closest('button'))return;
        const menu=e.currentTarget.closest('details');
        if(menu){menu.open=false;menu.querySelector('summary')?.focus();}
      }}>{actions}</div>
    </details>:actions)}
  </section>;
}
