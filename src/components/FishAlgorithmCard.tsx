import {compileFishProgram,fishStatistics} from '@/lib/fish/algorithm';
import type {DeepDigFeatureDef} from '@/lib/deepDig/features';
import {readFishPreference,type FishPreference} from '@/lib/fish/preferences';
import {useMemo,useEffect,type ReactNode} from 'react';
import {fishSuggestionTitle,mayFillFishThreshold,suggestedFishThreshold,type FishSuggestion} from '@/lib/fish/suggestions';
import { X } from 'lucide-react';
// 用户于 2026-10-19 指定保留的截图区间；固定参考备注，不随新计算覆盖。
const RECORDED_RANGES:Record<string,{statistic:string;low:string;high:string;samples:number}>={
 bss:{statistic:'avg_BSS',low:'-0.0227936',high:'0.0827297',samples:745},
 cba:{statistic:'avg_CBA',low:'2.05893',high:'7.73665',samples:733},
 cbi2:{statistic:'avg_CBI2',low:'-0.0108802',high:'0.0396005',samples:715},
};
export interface FishCard {id:string;featureId:string;enabled:boolean;pref:FishPreference}
export function FishAlgorithmCard({card,defs,locked,index,onChange,onDelete,canDelete=true,suggestion=null,computing='',queued=false,librarySize=0,footer}:{card:FishCard;defs:DeepDigFeatureDef[];locked:boolean;index:number;onChange:(card:FishCard)=>void;onDelete:()=>void;canDelete?:boolean;suggestion?:FishSuggestion|null;computing?:string;queued?:boolean;librarySize?:number;footer?:ReactNode}) {
 const def=defs.find(d=>d.id===card.featureId),p=card.pref,recorded=RECORDED_RANGES[card.featureId];
 const update=(patch:Partial<FishPreference>)=>onChange({...card,pref:{...p,...patch,constraints:[]}});
 // A card added before a shared suggestion finishes must also consume that cached result.
 useEffect(()=>{if(locked||!card.enabled||!suggestion||!mayFillFishThreshold(p.threshold,p.lastSuggestion))return;const value=suggestedFishThreshold(suggestion,p.direction);if(value!==null&&String(value)!==p.threshold)update({threshold:String(value),lastSuggestion:String(value)});},[suggestion,p.threshold,p.lastSuggestion,p.direction,locked,card.enabled,onChange]);
 let stats:ReturnType<typeof fishStatistics>=[],error='';try{if(!def)throw Error('特征值已不存在');stats=fishStatistics(def);if(card.enabled){const plan=compileFishProgram(def,{statistic:p.statistic,direction:p.direction,threshold:p.threshold.trim()?Number(p.threshold):NaN,constraints:[]});error=plan.unavailable??'';}}catch(e){error=e instanceof Error?e.message:String(e);}
 const cls='h-8 min-w-0 w-full rounded-md border border-border/60 bg-background px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring';
 const options=useMemo(()=>defs.map(d=>{try{const plan=compileFishProgram(d,{direction:'>',threshold:0,constraints:[]});return {def:d,reason:plan.unavailable};}catch(e){return {def:d,reason:e instanceof Error?e.message:String(e)};}}),[defs]);
 const label=(field:string)=>index===1?`捕捞${field==='特征值'?'算法':field}`:`算法 ${index} ${field}`;
 return <fieldset disabled={locked} className={`min-w-0 rounded-md bg-muted/25 p-2 text-[11px] ${card.enabled?'':'opacity-50'}`} aria-label={`算法 ${index}`}>
 <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_3rem_5.5rem_2rem] items-center gap-2 sm:grid-cols-[4.5rem_minmax(0,1.7fr)_minmax(0,1fr)_3rem_5.5rem_2rem]">
 <label className="col-span-4 flex items-center gap-2 whitespace-nowrap text-muted-foreground sm:col-span-1"><input className="h-3.5 w-3.5 accent-primary" aria-label={`启用算法 ${index}`} type="checkbox" checked={card.enabled} onChange={e=>onChange({...card,enabled:e.target.checked})}/>算法 {index}</label>
 <select aria-label={label('特征值')} className={`${cls} col-span-4 sm:col-span-1`} value={card.featureId} onChange={e=>onChange({...card,featureId:e.target.value,pref:{...readFishPreference(e.target.value),constraints:[]}})}>{options.map(({def:d,reason})=><option key={d.id} value={d.id} disabled={!!reason}>{d.short} · {d.name}{reason?`（${reason}）`:''}</option>)}</select>
 <select aria-label={label('统计量')} className={cls} value={p.statistic??'结果'} onChange={e=>update({statistic:e.target.value,threshold:'',lastSuggestion:undefined})}>{stats.map(s=><option key={s.name} value={s.name}>{s.label}</option>)}</select>
 <select aria-label={label('方向')} className={`${cls} px-1`} value={p.direction} onChange={e=>{const direction=e.target.value as '>'|'<',fill=suggestion?suggestedFishThreshold(suggestion,direction):null;if(fill!==null&&p.lastSuggestion!==undefined&&mayFillFishThreshold(p.threshold,p.lastSuggestion))update({direction,threshold:String(fill),lastSuggestion:String(fill)});else update({direction});}}><option value=">">&gt;</option><option value="<">&lt;</option></select>
 <div className="relative min-w-0"><input aria-label={label('阈值')} title={p.statistic&&p.statistic!=='结果'?'原值':def?.unit} className={`${cls} pr-7 font-mono tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`} type="number" step="any" value={p.threshold} onChange={e=>update({threshold:e.target.value,lastSuggestion:undefined})}/><span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground">{p.statistic&&p.statistic!=='结果'?'原值':def?.unit}</span></div>
 <button type="button" aria-label={`删除算法 ${index}`} title="删除算法" disabled={!canDelete} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-background hover:text-foreground disabled:invisible" onClick={onDelete}><X className="h-3.5 w-3.5"/></button>
 </div>
 <div className="mt-1 text-[10px] leading-relaxed sm:pl-20"> {footer??<>{suggestion?<span className="text-[10px] text-muted-foreground" data-testid={`fish-suggestion-${index}`} title={fishSuggestionTitle(suggestion)}>{suggestion.samples.p25===null?'信号库暂无有效建议':`信号库建议 ${Number(suggestion.samples.p25.toPrecision(6))} ~ ${Number(suggestion.samples.p75!.toPrecision(6))}`}（{suggestion.samples.n} / {librarySize} 条）</span>:computing?<span className="text-[10px] text-muted-foreground/70" data-testid={`fish-suggestion-auto-${index}`}>信号库建议计算中 {computing}</span>:queued&&card.enabled&&librarySize>0?<span className="text-[10px] text-muted-foreground/50">信号库建议排队中</span>:null}</>}</div>
 {recorded&&<p className="mt-0.5 break-words text-[10px] leading-relaxed text-muted-foreground/70 sm:pl-20" title={`2026-10-19 截图记录 · ${recorded.statistic} · ${recorded.samples} / 793 条；固定参考区间，保留截图精度`} data-testid={`fish-recorded-range-${index}`}>记录区间 · {recorded.statistic}：<span className="font-mono tabular-nums">{recorded.low} ~ {recorded.high}</span></p>}
 {card.enabled&&error&&<p className="mt-1 break-words text-destructive" role="alert">{error}</p>}</fieldset>;
}
