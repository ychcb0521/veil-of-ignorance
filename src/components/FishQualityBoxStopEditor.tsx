import {FishBoxStopInfo} from './FishBoxStopInfo';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { DBL5_PROFILES, DBL5_VARIANT_TIMEFRAMES, dbl5Defaults, DBL5_GUARD_DEFAULTS, DBL5_RETEST_GUARD_VERSION, dbl5GuardVersion, type Dbl5Config, type Dbl5VariantTimeframe } from '@/lib/dbl5m';
import { SBS5M_DEFAULTS, SBS5M_PARAMETER_SPECS } from '@/lib/sbs5m';
import { defaultStructureAddition } from '@/lib/fish/qualityAdditionStructure';
import { CURRENT_GUARD_VERSION, freezeStructureVersions, structureDbl5Timeframe, selectStructureGuardVersion, structureVersionLabel, structureVersions } from '@/lib/fish/boxAlgorithmVersions';
import { Dbl5GuardVersionSelect } from '@/components/Dbl5GuardVersionSelect';
import {BOX_STOP_REFERENCE_LABELS,type BoxStopReferenceKind} from '@/lib/fish/qualityBoxReference';
import {DBL5_GUARD_PLUS_CONFIGURABLE_K_VERSION,DBL5_GUARD_PLUS_PARAMS} from '@/lib/dbl5GuardPlus';
import { BOX_STOP_GUARD_REGIMES, boxStopChannelSettings, selectBoxStopChannels, BOX_STOP_CHANNEL_LABELS, type BoxStopChannel, boxStopAlgorithmLabel, isBoxBreak, isBoxSecondBreak, isBoxSecondBreakExitOnly, selectBoxStopGuardRegime, selectBoxStopTimeframe, selectBoxStopReference, clearBoxStopReference, type BoxStopRule } from '@/lib/fish/qualityBoxStop';
const field='h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
type BoxStopEditorProps={rule:BoxStopRule;onChange:(rule:BoxStopRule)=>void;disabled:boolean;prefix:string;definitions:readonly DeepDigFeatureDef[];entry?:boolean;admission?:boolean;vetoOnly?:boolean;afterMirror?:boolean};
export function FishQualityBoxStopEditor(props:BoxStopEditorProps) {
  const {rule,onChange,disabled,prefix,definitions,admission,afterMirror}=props;
  if(admission||isBoxBreak(rule))return <FishQualityBoxStopSingleEditor {...props}/>;
  const channels=boxStopChannelSettings(rule,definitions);
  const toggle=(channel:BoxStopChannel,enabled:boolean)=>onChange(selectBoxStopChannels({...channels,[channel]:{...channels[channel],enabled}}));
  const change=(channel:BoxStopChannel,next:BoxStopRule)=>onChange(rule.channels?selectBoxStopChannels({...channels,[channel]:{...channels[channel],rule:next}}):next);
  return <fieldset disabled={disabled} className="w-full min-w-0 border-0 p-0" data-testid="quality-box-stop-editor">
   <div className="space-y-3" data-testid="quality-box-compact-settings" data-quality-box-compact="true">
    {(['regular','impulse'] as const).map(channel=><fieldset key={channel} className={`min-w-0 rounded-lg border px-3 pb-3 pt-2 ${channels[channel].enabled?'border-border bg-background':'border-border/50'}`} data-testid={channel==='regular'?'quality-box-regular-settings':'quality-box-impulse-settings'}>
      <legend className="px-1 text-xs font-medium"><span className="inline-flex items-center gap-1">
       <label className="inline-flex cursor-pointer items-center gap-2"><input type="checkbox" className="h-3.5 w-3.5 accent-primary" aria-label={prefix+'使用'+BOX_STOP_CHANNEL_LABELS[channel]} checked={channels[channel].enabled} onChange={e=>toggle(channel,e.target.checked)}/>{channel==='regular'?'非急拉线 · 箱体 / 防守线':'急拉线'}</label>
       <FishBoxStopInfo label={prefix+BOX_STOP_CHANNEL_LABELS[channel]+'设置说明'}><p>急拉线与非急拉线可同时勾选。两路的 ATR 冗余、K 更新及确认方式各自独立；{props.entry?'任一路触发则本分钟不入选':'任一路先触发即退出全部持仓'}。取消一路保留该路参数，保存后只运行仍勾选的路。</p>{afterMirror&&<p>仅在本次镜像平衡减仓实际成交后启动，启动前证据不追补。</p>}</FishBoxStopInfo>
      </span></legend>
      {channels[channel].enabled?<FishQualityBoxStopSingleEditor {...props} afterMirror={false} rule={channels[channel].rule} onChange={next=>change(channel,next)} channel={channel} prefix={prefix+(rule.channels?BOX_STOP_CHANNEL_LABELS[channel]+' ':'')}/>:<span className="text-[11px] text-muted-foreground">未启用</span>}
    </fieldset>)}
   </div>
  </fieldset>;
}
function FishQualityBoxStopSingleEditor({rule,onChange,disabled,prefix,definitions,entry=false,admission=false,vetoOnly=false,afterMirror=false,channel}:BoxStopEditorProps&{channel?:BoxStopChannel}) {
  const s=rule.structure,def=s.definition,eventMode=isBoxBreak(rule),secondBreak=isBoxSecondBreak(rule),exitOnly=isBoxSecondBreakExitOnly(rule),put=(patch:Partial<BoxStopRule>)=>onChange({...rule,...patch});
  const timeframe=structureDbl5Timeframe(s), alternate=timeframe!=='5m';
  const {periodLabel,minutes}=DBL5_PROFILES[timeframe];
  const algorithmLabel=boxStopAlgorithmLabel(rule);
  const guardVersion=alternate?dbl5GuardVersion(def.DBL5_config):structureVersions(s).guard??CURRENT_GUARD_VERSION;
  const algorithmOptions=<><option value="dbl5">{DBL5_PROFILES['5m'].label} 达瓦斯箱体</option>
    {DBL5_VARIANT_TIMEFRAMES.filter(period=>!entry||period==='1h').map(period=><option key={period} value={period}>{DBL5_PROFILES[period].label} 达瓦斯箱体</option>)}</>;
  const algorithmValue=alternate?timeframe:s.algorithm;
  const putStructure=(patch:Partial<typeof s>)=>put({structure:{...s,...patch}});
  const putBasis = (structure: typeof s) => {
    const base=clearBoxStopReference(rule),next = { ...base, structure };
    onChange(base.guardRegime && structure.kSource !== 'guard' ? selectBoxStopGuardRegime(next, 'both') : next);
  };
  const chooseBasis=(value:string)=>Object.prototype.hasOwnProperty.call(BOX_STOP_REFERENCE_LABELS,value)
    ?onChange(selectBoxStopReference(rule,value as BoxStopReferenceKind))
    :putBasis({...s,kSource:value==='guard'?'guard':'current',kBasis:value==='invalidation'?'invalidation':'support'});
  const putImpulseBuffer=(value:number)=>{
    const reference=rule.reference;if(!reference||reference.kind==='impulse0')return;
    put({reference:{...reference,version:DBL5_GUARD_PLUS_CONFIGURABLE_K_VERSION,impulseBufferAtr:value}});
  };
  const selectAlgorithm=(algorithm:'dbl5'|'sbs5m'|Dbl5VariantTimeframe)=>{
    if(algorithm!=='sbs5m'&&s.algorithm==='dbl5'){
      onChange(selectBoxStopTimeframe(rule,algorithm==='dbl5'?'5m':algorithm,definitions));
      return;
    }
    const next=freezeStructureVersions({...defaultStructureAddition(algorithm==='sbs5m'?'sbs5m':'dbl5',definitions),kSource:'current'});
    if(algorithm!=='dbl5'&&algorithm!=='sbs5m')onChange(selectBoxStopTimeframe({...rule,structure:next},algorithm,definitions));
    else if(alternate&&algorithm==='sbs5m'){
      const legacy=selectBoxStopTimeframe(rule,'5m',definitions);
      onChange(selectBoxStopGuardRegime({...legacy,structure:next},'both'));
    }else putBasis(next);
  };
  const onAlgorithmChange=(e:React.ChangeEvent<HTMLSelectElement>)=>selectAlgorithm(e.target.value as Parameters<typeof selectAlgorithm>[0]);
  const dbl=(key:keyof Dbl5Config,value:number)=>putStructure({definition:{...def,DBL5_config:{...def.DBL5_config,[key]:value}}});
  const number=(label:string,value:number,onValue:(n:number)=>void,min=0,max?:number,step='any',caption=label)=><label className="inline-flex min-w-0 flex-wrap items-center gap-2 text-xs">{caption}<input disabled={disabled} aria-label={prefix+label} className={field+' shrink-0 font-mono text-[13px] tabular-nums'} style={{width:`calc(${Math.max(4,String(Number.isFinite(value)?value:'').length)}ch + 4.5rem)`,minWidth:'7rem',flexShrink:0}} type="number" min={min} max={max} step={step} value={Number.isFinite(value)?value:''} onChange={e=>onValue(e.target.value.trim()?Number(e.target.value):NaN)}/></label>;
  const executionDescription=rule.reference?`只使用原生已收盘5分钟参考，K＝所选参考线－此处额外冗余，按报价步长向下取整。急拉线-0取原生起涨低点线；急拉线-1115取含原生ATR冗余的急拉参考；组合版沿用原生有效参考的取高规则。1115使用防守线v1基线。尚无有效参考时等待；已建立的K在线断开或到期后继续保护，新线按所选K更新方式处理。加仓位置和此处硬性终止各自设置、分别保存。`:vetoOnly?`从本次${entry?'筛选起点':'持仓开始'}累计已收盘 ${periodLabel}结构的原生防守线红叉。首次断裂后，${entry?'本轮持续不入选':'启用本条件的加仓轮次／分支持续否决'}；防守线重建、暂停恢复${entry?'及重筛':''}均不解除。起点之前的预热事件不计入，影线触碰与缺失线不当作断裂。此条件本身不触发平仓。`:exitOnly?`从${afterMirror?'本次镜像平衡减仓成交后':'本次持仓开始'}，只累计已收盘 ${periodLabel}结构的独立防守线红叉。第一次确认后只保留计数，本条件不停加仓；加仓仍须满足原有条件与各项否决。第二次独立红叉确认后，按下一分钟开盘价全仓卖出。${afterMirror?'启动前事件':'买入前预热事件'}不计数；持续跌在线下不重复计数。防守线重建不清零，暂停续算保留计数；其他止损、减仓和普通卖出继续生效。`:secondBreak?`从${afterMirror?'本次镜像平衡减仓成交后':'本次持仓开始'}，只累计已收盘 ${periodLabel}结构的独立防守线红叉。第一次确认后，本笔持仓的主分支、备选分支及后续各轮均停止加仓，防守线重建也不解锁。第二次独立红叉确认后，按下一分钟开盘价全仓卖出。${afterMirror?'启动前事件':'买入前预热事件'}不计数；持续跌在线下不重复计数。暂停续算保留计数；其他止损、减仓和普通卖出继续生效。`:admission?`使用已收盘的 ${periodLabel}箱体和防守线，只记录新线事件；断裂本身不构成准入。`:entry?(eventMode?`筛选起点后的已收盘 ${periodLabel}结构确认原生红叉时，该分钟不入选。`:`使用已收盘的 ${periodLabel}结构计算 K。触及 K 或达到所选收盘确认条件时，该分钟不入选。`):alternate?(eventMode?`使用已收盘的 ${periodLabel} K 线，按原防守线规则确认红叉。确认后按下一分钟开盘价模拟卖出。`:`使用已收盘的 ${periodLabel} K 线建立止损线，额外冗余使用 ${periodLabel} ATR(14)。选择触价时按分钟行情执行，选择收盘确认时按下一分钟开盘价执行。`):eventMode?'只认持仓后已收盘 5 分钟结构的原生防守线断裂事件。上涨期 1 根收盘严格低于防守线确认；震荡期按细节设置的连续根数确认。影线触碰、尚无支撑或数据缺失不当作红叉。与图表使用相同参数和历史时才能逐点对齐。与其他一票否决、加仓 K 各自独立，任一条件先触发都会先卖出；不改变加仓定量。':'只读已收盘 5 分钟结构，K＝所选基准−冗余；额外 ATR 沿用盘面 ATR(14)。尚无有效线时等待；已有 K 在结构失效后继续保护。K 改变后重新累计收盘确认根数。触价模式开盘越线按开盘价，否则按 K 模拟卖出全部持仓；收盘确认按下一分钟开盘价。独立于加仓 K，不改变加仓定量。';
  const nativeDetails=<div className="mt-3 flex min-w-0 flex-wrap gap-x-4 gap-y-3">
      {s.algorithm==='dbl5'?<>
        {number('箱体确认 n',def.DBL5_config?.n??dbl5Defaults(timeframe).n,n=>dbl('n',n),1,1007,'1')}
        {number('几何窗口（分钟）',def.DBL5_config?.window_minutes??dbl5Defaults(timeframe).window_minutes,n=>dbl('window_minutes',n),4*minutes,2016*minutes,String(minutes))}
        {s.kSource==='guard'&&<>{number('上涨期防守冗余',def.DBL5_config?.guard_trend_atr??DBL5_GUARD_DEFAULTS.guard_trend_atr,n=>dbl('guard_trend_atr',n),0,20)}{number('震荡期防守冗余',def.DBL5_config?.guard_range_atr??DBL5_GUARD_DEFAULTS.guard_range_atr,n=>dbl('guard_range_atr',n),0,20)}{number('防守线震荡断线根数',def.DBL5_config?.guard_range_closes??DBL5_GUARD_DEFAULTS.guard_range_closes,n=>dbl('guard_range_closes',n),1,12,'1')}</>}
      </>:<>{SBS5M_PARAMETER_SPECS.map(spec=><span key={spec.key} title={spec.description}>{number(spec.label+'（'+spec.unit+'）',def.SBS5M_config?.[spec.key]??SBS5M_DEFAULTS[spec.key],n=>putStructure({definition:{...def,SBS5M_config:{...def.SBS5M_config,[spec.key]:n}}}),spec.min,spec.max,spec.integer?'1':'any')}</span>)}<label className="text-[11px]">成交量口径 <select aria-label={prefix+'成交量口径'} className={field} value={def.SBS5M_config?.volume_mode??SBS5M_DEFAULTS.volume_mode} onChange={e=>putStructure({definition:{...def,SBS5M_config:{...def.SBS5M_config,volume_mode:e.target.value as 'quote'|'base_times_close'}}})}><option value="quote">原始成交额</option><option value="base_times_close">成交量 × 收盘价</option></select></label></>}
  </div>;
  const nativeBasics=<div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 text-xs">
    <label className="inline-flex min-w-0 flex-wrap items-center gap-2">算法 <select aria-label={prefix+'算法'} className={field} disabled={!!rule.reference} title={rule.reference?'急拉线固定使用原生5分钟':undefined} value={algorithmValue} onChange={onAlgorithmChange}>{algorithmOptions}{!admission&&!eventMode&&<option value="sbs5m">SBS-5M 台阶箱体</option>}</select></label>
    <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">{timeframe}</span>
    {!admission&&!eventMode&&!rule.reference&&<label className="inline-flex min-w-0 flex-wrap items-center gap-2">K 基准 <select aria-label={prefix+'K基准'} className={field} value={s.kSource==='guard'?'guard':s.kBasis} onChange={e=>chooseBasis(e.target.value)}><option value="support">当前已确认箱底</option>{s.algorithm==='dbl5'?<option value="guard">{algorithmLabel} 防守线</option>:<option value="invalidation">SBS 算法失效线</option>}</select></label>}
    {!admission&&!eventMode&&s.algorithm==='dbl5'&&s.kSource==='guard'&&!rule.reference&&<label className="inline-flex flex-wrap items-center gap-2">线型 <select aria-label={prefix+'防守线类型'} className={field} value={rule.guardRegime??'both'} onChange={e=>onChange(selectBoxStopGuardRegime(rule,e.target.value as keyof typeof BOX_STOP_GUARD_REGIMES))}>{Object.entries(BOX_STOP_GUARD_REGIMES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}
    {s.algorithm==='dbl5'&&s.kSource==='guard'&&!rule.reference&&<Dbl5GuardVersionSelect label={prefix+'防守线版本'} value={guardVersion} onChange={version=>put({structure:selectStructureGuardVersion(s,version)})}/>}
    {(admission||eventMode)&&<span className="text-[11px] text-muted-foreground">{admission?'新线事件准入':vetoOnly?(entry?'首次断裂后本轮不入选':'首次断裂后停止加仓'):exitOnly?'首次观察 · 二次退出':secondBreak?'首次停加仓 · 二次退出':'红叉确认后退出'}</span>}
    <FishBoxStopInfo label={prefix+'参考线说明'}>
      {rule.reference?<p>{rule.reference.kind==='impulse0'?'急拉线-0直接取原生起涨低点，无须填写箱体参数。':'1115沿用原生5分钟箱体背景与防守线v1基线；本区参数独立于非急拉线。'}</p>:<p>所选基准用于建立和更新 K。防守线上涨期为实线、震荡期为虚线；线型切换后，已建立的 K 继续有效。</p>}
      <p>{executionDescription}</p>
      <p className="break-all font-mono text-[10px] text-muted-foreground">{rule.version}{rule.reference?` · ${rule.reference.version}`:''} · {structureVersionLabel(s)} · 保存时冻结参数与版本</p>
    </FishBoxStopInfo>
  </div>;
  return <fieldset disabled={disabled} className="m-0 w-full min-w-0 space-y-3 border-0 p-0 [&_select]:h-8 [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-background [&_select]:text-xs" data-testid={channel?"quality-box-stop-single-editor":"quality-box-stop-editor"}>
    {channel!=='impulse'&&<fieldset className="min-w-0 border-0 p-0" data-testid="quality-box-native-background-settings"><legend className="sr-only">箱体 / 防守线参数</legend>{nativeBasics}</fieldset>}
    {!admission&&!eventMode&&channel==='impulse'&&rule.reference&&<div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 text-xs" data-testid="quality-box-impulse-reference">
      <label className="inline-flex min-w-0 flex-wrap items-center gap-2">K 基准 <select aria-label={prefix+'K基准'} className={field} value={rule.reference.kind} onChange={e=>chooseBasis(e.target.value)}>{Object.entries(BOX_STOP_REFERENCE_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      {rule.reference.kind!=='impulse0'&&<span className="inline-flex min-w-0 flex-wrap items-center gap-2">{number('急拉线向下缓冲（ATR 倍数）',rule.reference.impulseBufferAtr??DBL5_GUARD_PLUS_PARAMS.bufferAtr,putImpulseBuffer,0,20,'any','原生缓冲')}<span className="text-[11px] text-muted-foreground">ATR</span></span>}
      <FishBoxStopInfo label={prefix+'急拉线缓冲说明'}>
        {rule.reference.kind==='impulse0'?<p>急拉线-0直接使用原生起涨低点，生成参考时不扣 ATR；本路“额外冗余”仍可单独设置。</p>:<><p>先生成急拉线：起涨低点 − 此倍数 × 急拉开始前冻结的5m ATR(14)，按报价步长向下取整。0.5表示半个 ATR，不是百分比；数值越大，急拉线越低。这只影响急拉参考，不修改原防守线。</p><p>例：起涨低点100、冻结ATR为2，缓冲0.5，则急拉线约99。本路额外冗余0.7、更新参考时盘面ATR为2，则止损K约97.6；实际按报价步长取整。</p>{rule.reference.kind==='guard-plus1115'&&<p>组合版按原规则从有效防守线和急拉线中取高，再扣本路额外冗余。因此急拉缓冲变化未必改变组合K。</p>}</>}
      </FishBoxStopInfo>
    </div>}
    {!admission&&!eventMode&&<div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 text-xs" data-testid="quality-box-stop-execution">
      <span className="inline-flex min-w-0 flex-wrap items-center gap-2">{number('额外冗余',s.buffer,n=>putStructure({buffer:n}))}<select aria-label={prefix+'冗余单位'} className={field} value={s.bufferUnit} onChange={e=>putStructure({bufferUnit:e.target.value as typeof s.bufferUnit})}><option value="atr">倍 ATR(14)</option><option value="percent">%</option></select></span>
      <label className="inline-flex min-w-0 flex-wrap items-center gap-2">K 更新 <select aria-label={prefix+'更新方式'} className={field} value={rule.update} onChange={e=>put({update:e.target.value as BoxStopRule['update']})}><option value="fixed">首次固定</option><option value="raise-only">只升不降</option><option value="follow">跟随结构（可下移）</option></select></label>
      <span className="inline-flex min-w-0 flex-wrap items-center gap-1"><label className="inline-flex min-w-0 flex-wrap items-center gap-2">{entry?'排除方式':'卖出方式'} <select aria-label={prefix+'确认方式'} className={field} value={rule.confirmation} onChange={e=>put({confirmation:e.target.value as BoxStopRule['confirmation']})}><option value="touch">{entry?'触价不入选':'触价全仓退出'}</option><option value="close-1m">1分钟收盘</option><option value={`close-${timeframe}`}>{periodLabel}收盘</option></select></label>
      <FishBoxStopInfo label={prefix+'执行与版本说明'}><p>K＝所选参考线−本路额外冗余。ATR取更新该参考时已收盘的{timeframe} ATR(14)，百分比则按参考线价格计算；与急拉线自身缓冲分两步使用，取值时点可能不同，不能直接相加。</p><p>{executionDescription}</p><p className="break-all font-mono text-[10px] text-muted-foreground">{rule.version}{rule.reference?` · ${rule.reference.version}`:''} · {structureVersionLabel(s)} · 保存时冻结参数与版本</p></FishBoxStopInfo></span>
      {rule.confirmation!=='touch'&&number('连续确认根数',rule.closes,n=>put({closes:n}),1,100,'1','确认根数')}
    </div>}
    {channel==='impulse'?<details className="text-xs"><summary className="cursor-pointer text-muted-foreground">原生参数 · {timeframe}</summary><fieldset className="mt-3 min-w-0 space-y-3 border-0 p-0" data-testid="quality-box-native-background-settings"><legend className="sr-only">急拉线原生背景参数</legend>{nativeBasics}{rule.reference?.kind!=='impulse0'&&nativeDetails}</fieldset></details>:rule.reference?.kind!=='impulse0'&&<details className="text-xs"><summary className="cursor-pointer text-muted-foreground" aria-label="箱体算法细节设置">细节参数</summary>{nativeDetails}</details>}
    {(admission||eventMode)&&<span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">执行规则<FishBoxStopInfo label={prefix+'执行与版本说明'}><p>{executionDescription}</p>{afterMirror&&<p>启动时点：本次镜像平衡减仓实际成交后，启动前的断裂不追补。</p>}{eventMode&&!admission&&guardVersion===DBL5_RETEST_GUARD_VERSION&&<p>遇到需独立回踩的首根低点，新防守线在回踩确认后才生效。等待期间仍检查已有防守线的断裂。</p>}<p className="break-all font-mono text-[10px] text-muted-foreground">{rule.version} · {structureVersionLabel(s)} · 保存时冻结参数与版本</p></FishBoxStopInfo></span>}
  </fieldset>;
}
