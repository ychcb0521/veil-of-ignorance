import { useMemo } from 'react';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { qualityFilterMenuChoices, qualityFilterChoiceKey, makeQualityBuyFilter } from '@/lib/fish/qualityFilters';
import { INDICATOR_ENTRY_VETO_VERSION } from '@/lib/fish/qualityAdditionVeto';
import type { IndicatorVetoDraft } from '@/lib/fish/qualityEntryVetoDraft';
import type { QualityOperator } from '@/lib/fish/qualityVeto';
import { FishMetricTimeFields } from './FishMetricTimeFields';

const field = 'min-w-0 rounded border border-border/60 bg-background p-1.5 text-xs';

export function FishIndicatorEntryVetoFields({rows, definitions, enabled, onChange}:{
  rows:IndicatorVetoDraft[]; definitions:readonly DeepDigFeatureDef[]; enabled:boolean; onChange:(rows:IndicatorVetoDraft[])=>void;
}) {
  const choices=useMemo(()=>qualityFilterMenuChoices(definitions),[definitions]);
  const options=useMemo(()=>[...new Set(choices.map(c=>c.group))].map(group=><optgroup key={group} label={group}>
    {choices.filter(c=>c.group===group).map(c=><option key={c.key} value={c.key}>{c.label}</option>)}
  </optgroup>),[choices]);
  const newRow=(key:string):IndicatorVetoDraft=>{
    const {label,metric,snapshot}=makeQualityBuyFilter(key,'>',0,true,definitions);
    return {base:{version:INDICATOR_ENTRY_VETO_VERSION,label,metric,snapshot,direction:'>=',threshold:0},enabled:true,threshold:''};
  };
  return <div className="space-y-2">
    <select className={field} aria-label="添加算法否决" disabled={!enabled} value="" onChange={e=>onChange([...rows,newRow(e.target.value)])}>
      <option value="" disabled>＋ 添加算法否决</option>{options}
    </select>
    {rows.map((row,i)=>{
      const label='算法否决 '+(i+1),key=qualityFilterChoiceKey(row.base),disabled=!enabled||!row.enabled;
      const patch=(change:Partial<IndicatorVetoDraft>)=>onChange(rows.map((v,n)=>n===i?{...v,...change}:v));
      return <div key={i} className="flex flex-wrap items-center gap-2 rounded border border-border/50 p-2">
        <input type="checkbox" aria-label={'启用'+label} checked={row.enabled} disabled={!enabled} onChange={e=>patch({enabled:e.target.checked})}/>
        <select className={field} aria-label={label+' 指标'} value={key} disabled={disabled} onChange={e=>{
          const next=newRow(e.target.value);
          patch({base:{...next.base,direction:row.base.direction},time:undefined});
        }}>{!choices.some(c=>c.key===key)&&<option value={key}>{row.base.label}</option>}{options}</select>
        <select className={field} aria-label={label+' 比较方式'} value={row.base.direction} disabled={disabled}
          onChange={e=>patch({base:{...row.base,direction:e.target.value as QualityOperator}})}>
          {['>','>=','<','<='].map(op=><option value={op} key={op}>{op.replace('>=','≥').replace('<=','≤')}</option>)}
        </select>
        <input className={field+' font-mono text-right'} style={{width:`calc(${Math.max(5,row.threshold.length)}ch + 3rem)`}} type="number" step="any"
          aria-label={label+' 阈值'} placeholder="阈值" value={row.threshold} disabled={disabled} onChange={e=>patch({threshold:e.target.value})}/>
        {row.base.snapshot.unit}
        <button type="button" aria-label={'移除'+label} disabled={!enabled} onClick={()=>onChange(rows.filter((_,n)=>n!==i))}>×</button>
        <FishMetricTimeFields label={label} metric={row.base.metric} snapshot={row.base.snapshot} time={row.time}
          disabled={disabled} onChange={time=>patch({time})}/>
      </div>;
    })}
  </div>;
}
