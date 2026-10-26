import { useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import { qualityFilterChoices, type HoldingVetoDraft } from '@/lib/fish/qualityFilters';
import type { QualityOperator } from '@/lib/fish/qualityVeto';
const field='h-7 min-w-0 rounded-md bg-muted/50 px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring';
export function FishQualityHoldingVetoEditor({draft,setDraft}:{draft:HoldingVetoDraft[];setDraft:(draft:HoldingVetoDraft[])=>void}) {
  const choices=useMemo(()=>qualityFilterChoices(),[]),groups=[...new Set(choices.map(c=>c.group))];
  const patch=(i:number,p:Partial<HoldingVetoDraft>)=>setDraft(draft.map((d,j)=>j===i?{...d,...p}:d));
  return <section className="border-t border-border pt-3 space-y-2" data-testid="quality-holding-veto-editor">
    <p className="text-xs font-medium">持仓一票否决卖出</p>
    <p className="text-[10.5px] leading-relaxed text-muted-foreground">任一启用条件达标即卖出，无需等待原卖出条件，以最先触发者为准。否决规则只作用于当前这套卖出方案（固定它做探测比较时同样生效），其他方案各有各的。阈值由你填写，未启用不生效。</p>
    <div className="space-y-2">{draft.map((d,i)=>{const risk=d.choice==='static-drawdown'||d.choice==='dynamic-drawdown';return <div key={i} className="flex items-center gap-1">
      <input type="checkbox" className="h-3 w-3 shrink-0" aria-label={`启用持仓否决 ${i+1}`} checked={d.enabled} onChange={e=>patch(i,{enabled:e.target.checked})}/>
      <select aria-label={`持仓否决 ${i+1} 指标`} className={`${field} flex-1`} value={d.choice} onChange={e=>patch(i,{choice:e.target.value,direction:e.target.value.endsWith('-drawdown')?'>=':d.direction})}>
        <optgroup label="持仓过程"><option value="static-drawdown">持仓过程静态最大回撤</option><option value="dynamic-drawdown">持仓过程动态最大回撤</option></optgroup>
        {groups.map(g=><optgroup key={g} label={g}>{choices.filter(c=>c.group===g).map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>)}
      </select>
      <select aria-label={`持仓否决 ${i+1} 方向`} className={`${field} w-14`} value={d.direction} disabled={risk} onChange={e=>patch(i,{direction:e.target.value as QualityOperator})}>{(risk?['>=']:['>=','>','<=','<']).map(v=><option key={v} value={v}>{v==='>='?'≥':v==='<='?'≤':v}</option>)}</select>
      <input aria-label={`持仓否决 ${i+1} 阈值`} type="number" step="any" placeholder="自行设置" className={`${field} w-20`} value={d.threshold} onChange={e=>patch(i,{threshold:e.target.value})}/>{risk&&<span className="text-[10px]">%</span>}
      <button type="button" aria-label={`删除持仓否决 ${i+1}`} className="p-1 text-muted-foreground" onClick={()=>setDraft(draft.filter((_,j)=>i!==j))}><X className="h-3 w-3"/></button>
    </div>;})}</div>
    <p className="text-[10px] leading-relaxed text-muted-foreground">静态：相对买入价的最大下跌。动态：先前高点至后续低点的最大跌幅。按止损单成交：盘中一触及止损价即按止损价卖出，回撤停在阈值；开盘就跳空越线的按开盘价卖出，回撤可能略超阈值。同一分钟高低点先后不明时，不假定高点先发生。</p>
    <p className="text-[10px] text-muted-foreground">指标选项来自当前账号公式，含自定义指标及公式变量；新增指标可在 Deep dig 定义。</p>
    <div><button type="button" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" onClick={()=>setDraft([...draft,{choice:'static-drawdown',direction:'>=',threshold:'',enabled:false}])}><Plus className="h-3 w-3"/>添加否决条件</button></div>
  </section>;
}
