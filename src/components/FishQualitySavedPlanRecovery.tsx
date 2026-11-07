import {useState} from 'react';
import type {RecoverableQualityPlan} from '@/lib/fish/qualitySavedPlans';
import type {QualityGroup} from '@/lib/fish/quality';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
export function FishQualitySavedPlanRecovery({plans,disabled,onRestore}:{plans:readonly RecoverableQualityPlan[];disabled:boolean;onRestore:(plan:QualityGroup)=>void}){
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 return <Popover onOpenChange={()=>{setError('');setMessage('');}}><PopoverTrigger asChild><button type="button" disabled={disabled} className="h-7 rounded px-2 text-[11px] text-primary disabled:opacity-40">找回已保存方案{plans.length?`（${plans.length}）`:''}</button></PopoverTrigger>
  <PopoverContent className="max-h-80 w-96 max-w-[calc(100vw-2rem)] space-y-2 overflow-y-auto p-3 text-[11px]">
   <p className="font-medium">从已保存的监测或战役快照找回</p><p className="text-muted-foreground">保留快照中的参数和版本。恢复时一并保存当前修改，已有方案保留，不启动监测。</p>
   {!plans.length&&<p>当前未找到缺失方案的完整快照。可从原组合重新拆分；重新拆分使用原组合现有参数。</p>}
   {plans.map(({plan,source,at})=><div key={plan.id} className="space-y-1 rounded border p-2"><p className="font-medium">{plan.label}</p><p className="text-muted-foreground">{source}{at>0?' · '+new Date(at+8*3600000).toISOString().slice(0,16).replace('T',' '):''}</p><button type="button" className="rounded border border-primary/30 px-2 py-1 text-primary" aria-label={'恢复并保存 '+plan.label} onClick={()=>{try{onRestore(plan);setError('');setMessage('已恢复并保存，原有方案保留。');}catch(cause){setError(cause instanceof Error?cause.message:'恢复失败，原方案未改动');}}}>恢复并保存</button></div>)}
   {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="text-destructive">{error}</p>}
  </PopoverContent>
 </Popover>;
}
