import {compileFishProgram,fishStatistics,FISH_PRESETS} from '@/lib/fish/algorithm';
import type {DeepDigFeatureDef} from '@/lib/deepDig/features';
import {readFishPreference,type FishPreference} from '@/lib/fish/preferences';
export interface FishCard {id:string;featureId:string;enabled:boolean;pref:FishPreference}
export function FishAlgorithmCard({card,defs,locked,index,onChange,onDelete}:{card:FishCard;defs:DeepDigFeatureDef[];locked:boolean;index:number;onChange:(card:FishCard)=>void;onDelete:()=>void}) {
 const def=defs.find(d=>d.id===card.featureId),p=card.pref;
 const update=(patch:Partial<FishPreference>)=>onChange({...card,pref:{...p,...patch}});
 let stats:ReturnType<typeof fishStatistics>=[],error='';try{if(!def)throw Error('特征值已不存在');stats=fishStatistics(def);if(card.enabled){const plan=compileFishProgram(def,{statistic:p.statistic,direction:p.direction,threshold:p.threshold.trim()?Number(p.threshold):NaN,constraints:p.constraints});error=plan.unavailable??'';}}catch(e){error=e instanceof Error?e.message:String(e);}
 const cls='rounded border border-border/60 bg-background px-1.5 py-1';
 return <fieldset disabled={locked} className="space-y-2 rounded border border-border/40 p-2 text-[11px]" aria-label={`算法 ${index}`}>
 <div className="flex flex-wrap items-center gap-2"><label><input type="checkbox" checked={card.enabled} onChange={e=>onChange({...card,enabled:e.target.checked})}/> 算法 {index}</label>
 <select aria-label={`算法 ${index} 特征值`} className={`${cls} w-56 max-w-full`} value={card.featureId} onChange={e=>onChange({...card,featureId:e.target.value,pref:readFishPreference(e.target.value)})}>{defs.map(d=><option key={d.id} value={d.id}>{d.short} · {d.name}</option>)}</select>
 <select aria-label={`算法 ${index} 统计量`} className={`${cls} w-28 max-w-full`} value={p.statistic??'结果'} onChange={e=>update({statistic:e.target.value,threshold:''})}>{stats.map(s=><option key={s.name} value={s.name}>{s.label}</option>)}</select>
 <select aria-label={`算法 ${index} 方向`} className={cls} value={p.direction} onChange={e=>update({direction:e.target.value as '>'|'<'})}><option value=">">&gt;</option><option value="<">&lt;</option></select>
 <input aria-label={`算法 ${index} 阈值`} className={`${cls} w-20`} type="number" step="any" value={p.threshold} onChange={e=>update({threshold:e.target.value})}/><span>{p.statistic&&p.statistic!=='结果'?'原值':def?.unit}</span><button className={cls} onClick={onDelete}>删除算法</button></div>
 <details><summary className="cursor-pointer text-muted-foreground">附加约束 {p.constraints.filter(c=>c.enabled).length}</summary><div className="mt-2 space-y-1">{p.constraints.map((c,i)=><div key={c.id} className="flex gap-2"><input type="checkbox" aria-label={`算法 ${index} 启用约束 ${i+1}`} checked={c.enabled} onChange={e=>update({constraints:p.constraints.map((x,j)=>j===i?{...x,enabled:e.target.checked}:x)})}/><input className={`${cls} flex-1 font-mono`} aria-label={`算法 ${index} 约束 ${i+1}`} value={c.text} onChange={e=>update({constraints:p.constraints.map((x,j)=>j===i?{...x,text:e.target.value}:x)})}/><button onClick={()=>update({constraints:p.constraints.filter((_,j)=>j!==i)})}>删除</button></div>)}
 <button onClick={()=>update({constraints:[...p.constraints,{id:crypto.randomUUID(),text:'',enabled:true}]})}>+ 自定义</button>
 <select aria-label={`算法 ${index} 添加约束预设`} value="" onChange={e=>{if(e.target.value!=='')update({constraints:[...p.constraints,...FISH_PRESETS[Number(e.target.value)].lines.map(text=>({id:crypto.randomUUID(),text,enabled:true}))]});}}><option value="">+ 预设</option>{FISH_PRESETS.map((p,i)=><option key={p.name} value={i}>{p.name}</option>)}</select></div></details>
 {card.enabled&&error&&<p className="text-destructive" role="alert">{error}</p>}</fieldset>;
}
