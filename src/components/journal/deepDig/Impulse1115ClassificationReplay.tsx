import {useState} from 'react';
import {impulse1115ClassificationText,IMPULSE_1115_STATUS} from '@/lib/impulse1115Classification';
import {formatUTC8} from '@/lib/timeFormat';
import type {DeepDigData} from '@/lib/deepDig/analysis';
import type {DeepDigSeries} from '@/lib/deepDig/series';

/** Reads only the saved run's evidence. Changing today's definition never recomputes this panel. */
export function Impulse1115ClassificationReplay({data,series}:{data:DeepDigData;series?:DeepDigSeries|null}){
  const [sample,setSample]=useState(''),[lineId,setLineId]=useState(''),[index,setIndex]=useState<number|null>(null);
  const available=data.rows.filter(row=>row.DBL5C_details||series?.DBL5_windows?.[row.id]?.classificationRows?.length);
  const event=available.find(row=>row.id===sample)??available[0];
  const rows=event?(series?.DBL5_windows?.[event.id]?.classificationRows??(event.DBL5C_details?[event.DBL5C_details]:[])):[];
  const selected=Math.min(index??rows.length-1,rows.length-1);
  const row=rows[selected],line=row?.lines.find(s=>s.lineId===lineId)??row?.current;
  if(!event||!row)return <p className="text-xs text-muted-foreground">本份冻结结果没有持仓分类证据，请保留原结果；新运行可记录分类历史。</p>;
  return <section aria-label="急拉线持仓分类历史" className="space-y-3 rounded border border-border p-3 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <strong>急拉线持仓分类 · 冻结证据</strong>
      <select aria-label="分类历史样本" value={event.id} className="max-w-full rounded border bg-background p-1"
        onChange={e=>{setSample(e.target.value);setLineId('');setIndex(null);}}>
        {available.map(event=><option key={event.id} value={event.id}>{event.symbol} · {formatUTC8(event.anchorMs)}</option>)}
      </select>
      <select aria-label="分类历史急拉线" value={line?.lineId??''} className="max-w-full rounded border bg-background p-1"
        onChange={e=>setLineId(e.target.value)}>
        {!row.lines.length&&<option value="">尚无已确认急拉线</option>}
        {row.lines.map(line=><option key={line.lineId} value={line.lineId}>{formatUTC8(line.detectedAt)} · {line.price}</option>)}
      </select>
    </div>
    {rows.length>1&&<label className="block">已收盘时点 · {formatUTC8(row.at)}
      <input aria-label="持仓分类回放时点" type="range" min={0} max={rows.length-1} value={selected}
        onChange={e=>setIndex(e.target.valueAsNumber)} className="mt-1 w-full"/>
    </label>}
    {line?<div className="space-y-2">
      <p className="font-medium text-foreground">{impulse1115ClassificationText(line)}</p>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        <span>冻结线价 {line.price}</span><span>反弹观察过程 {line.tests} 次</span>
        <span>状态生效 {formatUTC8(line.at)}</span>
        <span>曾刺穿 {line.piercedAt===null?'否':formatUTC8(line.piercedAt)}</span>
      </p>
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-left"><thead><tr><th className="p-1">已收盘确认时点</th><th className="p-1">主分类｜细分状态</th><th className="p-1">反弹过程</th></tr></thead>
          <tbody>{line.history.map((state,i)=><tr key={i} className="border-t border-border/50">
            <td className="whitespace-nowrap p-1">{formatUTC8(state.at)}</td>
            <td className="p-1">{state.mainClass===1?'一类｜':'二类｜'}{IMPULSE_1115_STATUS[state.status]}</td>
            <td className="p-1">{state.tests}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>:<p>尚无已确认急拉线</p>}
    <p className="text-muted-foreground">仅展示本次运行冻结的参数和逐根证据。原线断开或到期后仍观察冻结价；缺口暂停该线。
      第1、2种属于一类，第3至6种属于二类；分类不触发交易动作。</p>
  </section>;
}
