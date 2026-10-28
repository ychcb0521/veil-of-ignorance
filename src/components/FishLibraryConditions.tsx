import { useState } from 'react';
import { shortFishHash } from '@/lib/fish/algorithm';
import type { LibraryCondition } from '@/lib/fish/libraryConditions';
import { formatUTC8 } from '@/lib/timeFormat';

export function FishLibraryCondition({condition:c}:{condition:LibraryCondition}){
 const [open,setOpen]=useState(false);
 return <div className="min-h-9 space-y-0.5" data-testid="library-frozen-condition">
  <p className="whitespace-normal break-words font-medium text-foreground">{c.text}</p>
  <details onToggle={e=>setOpen(e.currentTarget.open)}><summary className="cursor-pointer whitespace-normal text-[9px] leading-relaxed text-muted-foreground hover:text-foreground" title="查看捕获时保存的公式、参数及完整约束">{c.context} · 详情</summary>
   {open&&<div className="mt-1 space-y-1 whitespace-normal rounded border border-border/50 bg-muted/30 p-2 text-[10px] leading-relaxed">
    <p>{c.evidence}</p><p>具体序列：<span className="font-mono">{c.metric}</span>；门槛：{c.rule}</p>
    {c.formula&&<p>半衰期 {c.halfLifeHours} 小时 · 均值参数 {c.avgHours} 小时{c.snapshot.H?` · 旧版外层均值 ${c.snapshot.H} 小时`:''}</p>}
    <p>附加约束：{c.snapshot.constraints?c.snapshot.constraints.join(' 且 ')||'无':c.snapshot.constraintKey?c.snapshot.constraintKey===shortFishHash('')?'无':'约束指纹 '+c.snapshot.constraintKey+'（原文未记录）':'未记录附加约束'}</p>
    {c.snapshot.lookbackHours!==undefined&&<p>捕捞覆盖：过去 {c.snapshot.lookbackHours} 小时</p>}
    {c.snapshot.cutoffMs? <p>读数截止：{formatUTC8(c.snapshot.cutoffMs)}</p>:null}
    {c.formula?<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-[9px]">{c.formula}</pre>:<p>历史公式未记录，保留已保存的序列与门槛，不使用当前公式替代。</p>}
   </div>}
  </details>
 </div>;
}
export const libraryReading=(value:number|undefined)=>value===undefined||!Number.isFinite(value)?'未记录':String(+value.toPrecision(10));
