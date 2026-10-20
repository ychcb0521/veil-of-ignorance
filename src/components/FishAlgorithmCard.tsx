import {compileFishProgram,fishStatistics} from '@/lib/fish/algorithm';
import type {DeepDigFeatureDef} from '@/lib/deepDig/features';
import {readFishPreference,type FishPreference} from '@/lib/fish/preferences';
import {useMemo,useEffect,type ReactNode} from 'react';
import {fishSuggestionTitle,mayFillFishThreshold,suggestedFishThreshold,type FishSuggestion} from '@/lib/fish/suggestions';
import { Ellipsis, RotateCw, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
// 用户于 2026-10-19 指定保留的截图区间；固定参考备注，不随新计算覆盖。
export const RECORDED_RANGES:Record<string,{statistic:string;low:string;high:string;samples:number}>={
 bss:{statistic:'avg_BSS',low:'-0.0227936',high:'0.0827297',samples:745},
 cba:{statistic:'avg_CBA',low:'2.05893',high:'7.73665',samples:733},
 cbi2:{statistic:'avg_CBI2',low:'-0.0108802',high:'0.0396005',samples:715},
 'drift-speed-z':{statistic:'avg_a',low:'2.0469',high:'10.0813',samples:707},
};
export interface FishCard {id:string;featureId:string;enabled:boolean;pref:FishPreference}
export function FishAlgorithmCard({card,defs,locked,index,onChange,onDelete,canDelete=true,suggestion=null,computing='',queued=false,librarySize=0,footer,onRecalculate,recalculateDisabled=false,recalculating=false}:{card:FishCard;defs:DeepDigFeatureDef[];locked:boolean;index:number;onChange:(card:FishCard)=>void;onDelete:()=>void;canDelete?:boolean;suggestion?:FishSuggestion|null;computing?:string;queued?:boolean;librarySize?:number;footer?:ReactNode;onRecalculate?:()=>void;recalculateDisabled?:boolean;recalculating?:boolean}) {
 const def=defs.find(d=>d.id===card.featureId),p=card.pref,recorded=RECORDED_RANGES[card.featureId];
 const update=(patch:Partial<FishPreference>)=>onChange({...card,pref:{...p,...patch,constraints:[]}});
 // A card added before a shared suggestion finishes must also consume that cached result.
 useEffect(()=>{if(locked||!card.enabled||!suggestion||!mayFillFishThreshold(p.threshold,p.lastSuggestion))return;const value=suggestedFishThreshold(suggestion,p.direction);if(value!==null&&String(value)!==p.threshold)update({threshold:String(value),lastSuggestion:String(value)});},[suggestion,p.threshold,p.lastSuggestion,p.direction,locked,card.enabled,onChange]);
 let stats:ReturnType<typeof fishStatistics>=[],error='';try{if(!def)throw Error('特征值已不存在');stats=fishStatistics(def);if(card.enabled){const plan=compileFishProgram(def,{statistic:p.statistic,direction:p.direction,threshold:p.threshold.trim()?Number(p.threshold):NaN,constraints:[]});error=plan.unavailable??'';}}catch(e){error=e instanceof Error?e.message:String(e);}
 const cls='h-7 min-w-0 w-full rounded border border-border/60 bg-background px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring';
 const options=useMemo(()=>defs.map(d=>{try{const plan=compileFishProgram(d,{direction:'>',threshold:0,constraints:[]});return {def:d,reason:plan.unavailable};}catch(e){return {def:d,reason:e instanceof Error?e.message:String(e)};}}),[defs]);
 const label=(field:string)=>index===1?`捕捞${field==='特征值'?'算法':field}`:`算法 ${index} ${field}`;
 const refresh=onRecalculate?<button type="button" aria-label={index===1?'计算建议':`重新计算算法 ${index} 的区间`} title="重新计算区间（点击后才取数）" disabled={recalculateDisabled} className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded align-middle text-muted-foreground/35 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-30" onClick={onRecalculate}><RotateCw className={`h-2.5 w-2.5 ${recalculating?'animate-spin':''}`}/></button>:null;
 const suggestionText=footer??<>{suggestion?<span className="text-[10px] text-muted-foreground" data-testid={`fish-suggestion-${index}`} title={fishSuggestionTitle(suggestion)}>{suggestion.samples.p25===null?'信号库暂无有效建议':`信号库建议 ${Number(suggestion.samples.p25.toPrecision(6))} ~ ${Number(suggestion.samples.p75!.toPrecision(6))}`}（{suggestion.samples.n} / {librarySize} 条）</span>:computing?<span className="text-[10px] text-muted-foreground/70" data-testid={`fish-suggestion-auto-${index}`}>信号库建议计算中 {computing}</span>:queued&&card.enabled&&librarySize>0?<span className="text-[10px] text-muted-foreground/50">信号库建议排队中</span>:null}</>;
 return <fieldset disabled={locked} className={`w-fit min-w-0 max-w-full rounded-md bg-muted/25 px-2 py-1 text-[11px] ${card.enabled?'':'opacity-50'}`} aria-label={`算法 ${index}`}>
 <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
 <label className="flex w-14 shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground"><input className="h-3.5 w-3.5 accent-primary" aria-label={`启用算法 ${index}`} type="checkbox" checked={card.enabled} onChange={e=>onChange({...card,enabled:e.target.checked})}/>算法 {index}</label>
 <select aria-label={label('特征值')} title={def?.name} className={`${cls} !w-24 shrink-0`} value={card.featureId} onChange={e=>onChange({...card,featureId:e.target.value,pref:{...readFishPreference(e.target.value),constraints:[]}})}>{options.map(({def:d,reason})=><option key={d.id} value={d.id} label={`${d.short || d.name}${reason?' · 不可用':''}`} aria-label={`${d.short} · ${d.name}${reason?`（${reason}）`:''}`} disabled={!!reason}>{d.short} · {d.name}{reason?`（${reason}）`:''}</option>)}</select>
 <select aria-label={label('统计量')} title={stats.find(s=>s.name===(p.statistic??'结果'))?.label} className={`${cls} !w-32 shrink-0`} value={p.statistic??'结果'} onChange={e=>update({statistic:e.target.value,threshold:'',lastSuggestion:undefined})}>{stats.map(s=><option key={s.name} value={s.name} label={s.name==='结果'?s.label:s.name} aria-label={s.label}>{s.label}</option>)}</select>
 <select aria-label={label('方向')} className={`${cls} !w-11 shrink-0 px-1`} value={p.direction} onChange={e=>{const direction=e.target.value as '>'|'<',fill=suggestion?suggestedFishThreshold(suggestion,direction):null;if(fill!==null&&p.lastSuggestion!==undefined&&mayFillFishThreshold(p.threshold,p.lastSuggestion))update({direction,threshold:String(fill),lastSuggestion:String(fill)});else update({direction});}}><option value=">">&gt;</option><option value="<">&lt;</option></select>
 <div className="relative w-[5.5rem] shrink-0"><input aria-label={label('阈值')} title={p.statistic&&p.statistic!=='结果'?'原值':def?.unit} className={`${cls} pr-7 font-mono tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`} type="number" step="any" value={p.threshold} onChange={e=>update({threshold:e.target.value,lastSuggestion:undefined})}/><span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground">{p.statistic&&p.statistic!=='结果'?'原值':def?.unit}</span></div>
 <div className="order-2 flex min-w-0 flex-[0_1_auto] flex-wrap items-center gap-x-2 text-[10px] leading-5 lg:order-1">
 {/* 【用户要求】2026-10-20「渔中的这个 x 也放在 … 中」：每张卡都有「…」——记录区间（有的话）与「删除这个算法」都收在里面 */}
 {recorded?null:<span className="empty:hidden">{suggestionText}{refresh}</span>}
 {(recorded||canDelete)&&<Popover><PopoverTrigger asChild><button type="button" aria-label={`算法 ${index} 的更多操作`} title={recorded?'记录区间 · 删除':'删除'} className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/30 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"><Ellipsis className="h-3 w-3"/></button></PopoverTrigger><PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] space-y-1 p-2 text-[10px] leading-5">
 {recorded&&<>
 <div className="flex flex-wrap items-center text-muted-foreground" title={`2026-10-19 截图记录 · ${recorded.samples} / 793 条；固定参考区间`} data-testid={`fish-recorded-range-${index}`}>{recorded.statistic}：<span className="font-mono tabular-nums">{recorded.low} ~ {recorded.high}</span>{refresh}</div>
 <div className="empty:hidden">{suggestionText}</div>
 </>}
 {canDelete&&<button type="button" aria-label={`删除算法 ${index}`} className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-muted-foreground hover:bg-accent hover:text-destructive ${recorded?'mt-1 border-t border-border/50 pt-1.5':''}`} onClick={onDelete}><X className="h-3 w-3"/>删除这个算法</button>}
 </PopoverContent></Popover>}
 </div>
 </div>
 {card.enabled&&error&&<p className="mt-1 break-words text-destructive" role="alert">{error}</p>}</fieldset>;
}
