import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import { useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import { qualityFilterChoices, type HoldingVetoDraft } from '@/lib/fish/qualityFilters';
import { isHoldingPriceChoice, ADDITION_PROFIT_KIND, ADDITION_PROFIT_LABEL, type QualityOperator } from '@/lib/fish/qualityVeto';
const field='h-7 min-w-0 rounded-md bg-muted/50 px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring';
export function FishQualityHoldingVetoEditor({draft,setDraft}:{draft:HoldingVetoDraft[];setDraft:(draft:HoldingVetoDraft[])=>void}) {
  const definitions=useFeatureDefinitions();
  const choices=useMemo(()=>qualityFilterChoices(definitions),[definitions]),groups=[...new Set(choices.map(c=>c.group))];
  const patch=(i:number,p:Partial<HoldingVetoDraft>)=>setDraft(draft.map((d,j)=>j===i?{...d,...p}:d));
  const riskSummary=([['static-drawdown','静态回撤'],['dynamic-drawdown','动态回撤'],['drop-1m','1分钟内跌幅'],['drop-5m','5分钟内跌幅']] as const).map(([kind,label])=>{
    const enabled=draft.filter(d=>d.enabled&&d.choice===kind);
    if(!enabled.length)return `${label}否决未启用`;
    const values=enabled.map(d=>d.threshold.trim()?Number(d.threshold):NaN);
    if(values.some(v=>!Number.isFinite(v)||v<=0||v>100))return `${label}阈值待完善`;
    return `${label} ≥ ${Math.min(...values)}%${enabled.length>1?'（同类条件中较小阈值先触发）':''}`;
  }).join('；');
  return <section className="border-t border-border pt-3 space-y-2" data-testid="quality-holding-veto-editor">
    <p className="text-xs font-medium">持仓一票否决卖出</p>
    <p className="text-[10.5px] leading-relaxed text-muted-foreground">任一启用约束完整达标，立即按最早可确认时点卖出；同一约束中的条件须同时满足，不同约束任一条达标即可，无需设置或等待普通卖出门槛。回撤盘中触价即模拟成交；指标逐分钟复原，不等原周期 K 线收盘。否决规则只作用于当前这套卖出方案（固定它做探测比较时同样生效），其他方案各有各的。阈值由你填写，未启用不生效。</p>
    <div className="space-y-2">{draft.map((d,i)=>{const risk=isHoldingPriceChoice(d.choice),addition=d.choice===ADDITION_PROFIT_KIND;return <div key={i} className={addition?'flex flex-wrap items-center gap-2 rounded border border-border/60 p-2':'flex items-center gap-1'}>
      <input type="checkbox" className="h-3 w-3 shrink-0" aria-label={`启用持仓否决 ${i+1}`} checked={d.enabled} onChange={e=>patch(i,{enabled:e.target.checked})}/>
      <select aria-label={`持仓否决 ${i+1} 指标`} className={`${field} flex-1`} value={d.choice} onChange={e=>patch(i,{choice:e.target.value,direction:isHoldingPriceChoice(e.target.value)||e.target.value===ADDITION_PROFIT_KIND?'>=':d.direction,...(e.target.value===ADDITION_PROFIT_KIND?{threshold:'5',geometricMultiple:'100'}:{})})}>
        <optgroup label="加仓止盈"><option value={ADDITION_PROFIT_KIND}>{ADDITION_PROFIT_LABEL}</option></optgroup><optgroup label="持仓过程"><option value="static-drawdown">持仓过程静态最大回撤</option><option value="dynamic-drawdown">持仓过程动态最大回撤</option></optgroup>
        <optgroup label="短时跌幅"><option value="drop-1m">1分钟内跌幅</option><option value="drop-5m">5分钟内跌幅</option></optgroup>
        {groups.map(g=><optgroup key={g} label={g}>{choices.filter(c=>c.group===g).map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>)}
      </select>
      {!addition&&<><select aria-label={`持仓否决 ${i+1} 方向`} className={`${field} w-14`} value={d.direction} disabled={risk} onChange={e=>patch(i,{direction:e.target.value as QualityOperator})}>{(risk?['>=']:['>=','>','<=','<']).map(v=><option key={v} value={v}>{v==='>='?'≥':v==='<='?'≤':v}</option>)}</select>
      <input aria-label={`持仓否决 ${i+1} 阈值`} type="number" step="any" min={risk ? 0 : undefined} max={risk ? 100 : undefined} placeholder="自行设置" className={`${field} w-20`} value={d.threshold} onChange={e=>patch(i,{threshold:e.target.value})}/>{risk&&<span className="text-[10px]">%</span>}</>}
      <button type="button" aria-label={`删除持仓否决 ${i+1}`} className="p-1 text-muted-foreground" onClick={()=>setDraft(draft.filter((_,j)=>i!==j))}><X className="h-3 w-3"/></button>
      {addition&&<div className="flex w-full flex-wrap items-center gap-x-2 gap-y-2 text-[11px]"><span>几何仓位 ≥</span><input aria-label={`持仓否决 ${i+1} 几何仓位倍数`} type="number" min="0" step="any" value={d.geometricMultiple??'100'} className={field+' w-20'} onChange={e=>patch(i,{geometricMultiple:e.target.value})}/><span>倍，且价格高出均衡价 ≥</span><input aria-label={`持仓否决 ${i+1} 均衡价涨幅`} type="number" min="0" step="any" value={d.threshold} className={field+' w-20'} onChange={e=>patch(i,{threshold:e.target.value})}/><span>%</span><p className="w-full text-[10px] text-muted-foreground">实际加仓后才检查；均衡价取最近实际加仓的 K。两项同时满足即卖出全部余仓与加仓，多个约束任一条达标即可。</p></div>}
    </div>;})}</div>
    <p className="text-[10.5px] leading-relaxed text-primary" data-testid="quality-veto-risk-summary">当前填写（应用后生效）：{riskSummary}。</p>
    <p className="text-[10px] leading-relaxed text-muted-foreground">静态：相对买入价的最大下跌，只约束静态回撤；动态：先前高点至后续低点的最大跌幅，需另行启用。按止损单成交：盘中一触及止损价即按止损价卖出；开盘就跳空越线的按开盘价卖出，回撤可能超过阈值。同一分钟高低点先后不明时，不假定高点先发生。</p>
    <p className="text-[10px] leading-relaxed text-muted-foreground">短时跌幅：每分钟收盘检查，跌幅 =（窗口起点开盘价 − 当前收盘价）÷ 起点开盘价 × 100%。1 分钟取最近一根分钟 K 线；5 分钟取最近五根，每分钟滚动，持仓不足五分钟从买入时刻起算。达到你填写的百分比（≥）后，按下一分钟开盘价模拟卖出；不使用买入前价格，也不把盘中下影线当作收盘跌幅。</p>
    <p className="text-[10px] text-muted-foreground">指标选项来自当前账号公式，含自定义指标及公式变量；新增指标可在 Deep dig 定义。</p>
    <div><button type="button" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" onClick={()=>setDraft([...draft,{choice:'static-drawdown',direction:'>=',threshold:'',enabled:false}])}><Plus className="h-3 w-3"/>添加否决条件</button><button type="button" className="ml-3 inline-flex items-center gap-1 text-[11px] text-primary" onClick={()=>setDraft([...draft,{choice:ADDITION_PROFIT_KIND,direction:'>=',threshold:'5',geometricMultiple:'100',enabled:false}])}><Plus className="h-3 w-3"/>添加加仓止盈约束</button></div>
  </section>;
}
