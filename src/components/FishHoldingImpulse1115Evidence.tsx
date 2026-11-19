import {useState} from 'react';
import {impulse1115ClassificationText,IMPULSE_1115_STATUS} from '@/lib/impulse1115Classification';
import type {HoldingImpulse1115Reading} from '@/lib/fish/holdingImpulse1115Classification';
import {formatUTC8} from '@/lib/timeFormat';

export function FishHoldingImpulse1115Evidence({value,compact=false}:{value?:HoldingImpulse1115Reading;compact?:boolean}){
  const [selected,setSelected]=useState('');
  const line=value?.row?.lines.find(line=>line.lineId===selected)??value?.row?.current;
  const label=value?.status==='ready'&&line?impulse1115ClassificationText(line):value?.message??'等待持仓分类';
  if(compact)return <span data-testid="holding-impulse1115-reading" className="col-span-4 whitespace-normal text-left text-[10px] text-muted-foreground" title={value?formatUTC8(value.through)+' · '+label:label}>{label}</span>;
  if(!value)return null;
  return <section data-testid="holding-impulse1115-evidence" className="space-y-2 rounded border border-border/60 bg-muted/10 p-3 text-[11px]">
    <p className="font-medium">DBL-5-急拉线-1115 · 持仓分类</p>
    <p>{label}</p>
    <p className="text-muted-foreground">最近已收盘证据 {formatUTC8(value.through)} · 分类不触发交易</p>
    {!!value.row?.lines.length&&<details>
      <summary className="cursor-pointer">查看各条急拉线的冻结历史</summary>
      <select aria-label="持仓分类历史急拉线" className="my-2 max-w-full rounded border bg-background p-1" value={line?.lineId??''} onChange={e=>setSelected(e.target.value)}>
        {value.row.lines.map(line=><option key={line.lineId} value={line.lineId}>{formatUTC8(line.detectedAt)} · 线价 {line.price}</option>)}
      </select>
      {line&&<div className="max-h-60 overflow-auto">
        <p className="mb-2">冻结线价 {line.price} · {impulse1115ClassificationText(line)}</p>
        <table className="w-full text-left"><thead><tr><th className="p-1">确认时点</th><th className="p-1">主分类｜细分状态</th></tr></thead>
          <tbody>{line.history.map((event,i)=><tr key={i} className="border-t border-border/40">
            <td className="whitespace-nowrap p-1">{formatUTC8(event.at)}</td>
            <td className="p-1">{event.mainClass===1?'一类｜':'二类｜'}{IMPULSE_1115_STATUS[event.status]}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </details>}
  </section>;
}
