import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { DBL5_DEFAULTS, DBL5_GUARD_DEFAULTS, type Dbl5Config } from '@/lib/dbl5m';
import { SBS5M_DEFAULTS, SBS5M_PARAMETER_SPECS } from '@/lib/sbs5m';
import { defaultStructureAddition } from '@/lib/fish/qualityAdditionStructure';
import { freezeStructureVersions, structureVersionLabel } from '@/lib/fish/boxAlgorithmVersions';
import { isBoxBreak, type BoxStopRule } from '@/lib/fish/qualityBoxStop';
const field='h-7 rounded bg-muted/50 px-2 text-[11px] min-w-0';
export function FishQualityBoxStopEditor({rule,onChange,disabled,prefix,definitions,entry=false,admission=false}:{rule:BoxStopRule;onChange:(rule:BoxStopRule)=>void;disabled:boolean;prefix:string;definitions:readonly DeepDigFeatureDef[];entry?:boolean;admission?:boolean}) {
  const s=rule.structure,def=s.definition,eventMode=isBoxBreak(rule),put=(patch:Partial<BoxStopRule>)=>onChange({...rule,...patch});
  const putStructure=(patch:Partial<typeof s>)=>put({structure:{...s,...patch}});
  const dbl=(key:keyof Dbl5Config,value:number)=>putStructure({definition:{...def,DBL5_config:{...def.DBL5_config,[key]:value}}});
  const number=(label:string,value:number,onValue:(n:number)=>void,min=0,max?:number,step='any')=><label className="flex items-center gap-1 text-[11px]">{label}<input disabled={disabled} aria-label={prefix+label} className={field+' w-20'} type="number" min={min} max={max} step={step} value={Number.isFinite(value)?value:''} onChange={e=>onValue(e.target.value.trim()?Number(e.target.value):NaN)}/></label>;
  return <fieldset disabled={disabled} className="w-full space-y-2 rounded border border-border/60 p-2" data-testid="quality-box-stop-editor">
    {admission?<p className="text-[11px]">DBL-5 原生防守线 · 新线事件准入</p>:eventMode?<p className="text-[11px]">DBL-5 防守线断裂 · 与图中红叉使用同一事件 · {entry?'确认当分钟不入选':'确认后按下一分钟开盘价卖出全部持仓'}</p>:<div className="flex flex-wrap items-center gap-2 text-[11px]">
      <label>箱体算法 <select aria-label={prefix+'算法'} className={field} value={s.algorithm} onChange={e=>put({structure:freezeStructureVersions({...defaultStructureAddition(e.target.value as typeof s.algorithm,definitions),kSource:'current'})})}><option value="dbl5">DBL-5 达瓦斯箱体</option><option value="sbs5m">SBS-5M 台阶箱体</option></select></label>
      <label>K 基准 <select aria-label={prefix+'K基准'} className={field} value={s.kSource==='guard'?'guard':s.kBasis} onChange={e=>putStructure({kSource:e.target.value==='guard'?'guard':'current',kBasis:e.target.value==='invalidation'?'invalidation':'support'})}><option value="support">当前已确认箱底</option>{s.algorithm==='dbl5'?<option value="guard">DBL-5 防守线</option>:<option value="invalidation">SBS 算法失效线</option>}</select></label>
      {number('额外冗余',s.buffer,n=>putStructure({buffer:n}))}<select aria-label={prefix+'冗余单位'} className={field} value={s.bufferUnit} onChange={e=>putStructure({bufferUnit:e.target.value as typeof s.bufferUnit})}><option value="atr">倍 ATR(14)</option><option value="percent">%</option></select>
      <label>K 更新 <select aria-label={prefix+'更新方式'} className={field} value={rule.update} onChange={e=>put({update:e.target.value as BoxStopRule['update']})}><option value="fixed">首次有效 K 固定</option><option value="raise-only">只升不降</option><option value="follow">跟随最新结构（允许下移）</option></select></label>
      <label>{entry?'排除方式':'卖出方式'} <select aria-label={prefix+'确认方式'} className={field} value={rule.confirmation} onChange={e=>put({confirmation:e.target.value as BoxStopRule['confirmation']})}><option value="touch">{entry?'触碰 K 当分钟不入选':'触碰 K 立即全仓止损'}</option><option value="close-1m">1 分钟收盘确认</option><option value="close-5m">5 分钟收盘确认</option></select></label>
      {rule.confirmation!=='touch'&&number('连续确认根数',rule.closes,n=>put({closes:n}),1,100,'1')}
    </div>}
    <details><summary className="cursor-pointer text-[11px] text-primary">箱体算法细节设置</summary><div className="mt-2 flex flex-wrap gap-3">
      {s.algorithm==='dbl5'?<>
        {number('箱体确认 n',def.DBL5_config?.n??DBL5_DEFAULTS.n,n=>dbl('n',n),1,1007,'1')}
        {number('几何窗口（分钟）',def.DBL5_config?.window_minutes??DBL5_DEFAULTS.window_minutes,n=>dbl('window_minutes',n),20,10080,'5')}
        {s.kSource==='guard'&&<>{number('上涨期防守冗余',def.DBL5_config?.guard_trend_atr??DBL5_GUARD_DEFAULTS.guard_trend_atr,n=>dbl('guard_trend_atr',n),0,20)}{number('震荡期防守冗余',def.DBL5_config?.guard_range_atr??DBL5_GUARD_DEFAULTS.guard_range_atr,n=>dbl('guard_range_atr',n),0,20)}{number('防守线震荡断线根数',def.DBL5_config?.guard_range_closes??DBL5_GUARD_DEFAULTS.guard_range_closes,n=>dbl('guard_range_closes',n),1,12,'1')}</>}
      </>:<>{SBS5M_PARAMETER_SPECS.map(spec=><span key={spec.key} title={spec.description}>{number(spec.label+'（'+spec.unit+'）',def.SBS5M_config?.[spec.key]??SBS5M_DEFAULTS[spec.key],n=>putStructure({definition:{...def,SBS5M_config:{...def.SBS5M_config,[spec.key]:n}}}),spec.min,spec.max,spec.integer?'1':'any')}</span>)}<label className="text-[11px]">成交量口径 <select aria-label={prefix+'成交量口径'} className={field} value={def.SBS5M_config?.volume_mode??SBS5M_DEFAULTS.volume_mode} onChange={e=>putStructure({definition:{...def,SBS5M_config:{...def.SBS5M_config,volume_mode:e.target.value as 'quote'|'base_times_close'}}})}><option value="quote">原始成交额</option><option value="base_times_close">成交量 × 收盘价</option></select></label></>}
    </div></details>
    <p className="text-[10px] leading-relaxed text-muted-foreground">{admission?'沿用原箱体和防守线公式、参数及已收盘 5 分钟确认时点，仅记录新线事件；断裂本身不构成准入。':entry?(eventMode?'筛选起点后的已收盘 5 分钟结构确认原生红叉时，该分钟不入选。沿用原箱体公式、参数与红叉事件，不模拟卖出。':'只读此前已收盘 5 分钟结构，K＝所选基准−冗余；尚无有效线时等待。分钟触及 K 或满足收盘确认时，该分钟不入选；不模拟卖出。'):eventMode?'只认持仓后已收盘 5 分钟结构的原生防守线断裂事件。上涨期 1 根收盘严格低于防守线确认；震荡期按细节设置的连续根数确认。影线触碰、尚无支撑或数据缺失不当作红叉。与图表使用相同参数和历史时才能逐点对齐。与其他一票否决、加仓 K 各自独立，任一条件先触发都会先卖出；不改变加仓定量。':'只读已收盘 5 分钟结构，K＝所选基准−冗余；额外 ATR 沿用盘面 ATR(14)。尚无有效线时等待；已有 K 在结构失效后继续保护。K 改变后重新累计收盘确认根数。触价模式开盘越线按开盘价，否则按 K 模拟卖出全部持仓；收盘确认按下一分钟开盘价。独立于加仓 K，不改变加仓定量。'}</p>
    <p className="text-[10px] font-mono text-primary">{rule.version} · {structureVersionLabel(s)} · 保存时冻结参数与版本</p>
  </fieldset>;
}
