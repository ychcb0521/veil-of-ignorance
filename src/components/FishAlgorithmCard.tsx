import {compileFishProgram,fishStatistics,fishStateHold,FISH_STATE_HOLD_TEXT} from '@/lib/fish/algorithm';
import {fishSourceLabel} from '@/lib/fish/records';
import type {DeepDigFeatureDef} from '@/lib/deepDig/features';
import {readFishPreference,withFishDefaultThreshold,type FishPreference} from '@/lib/fish/preferences';
import {Children,Fragment,isValidElement,useMemo,useEffect,type InputHTMLAttributes,type ReactNode} from 'react';
import {fishSuggestionTitle,mayFillFishThreshold,suggestedFishThreshold,type FishSuggestion} from '@/lib/fish/suggestions';
import { Check, ChevronDown, CircleHelp, Ellipsis, RotateCw, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
// 用户于 2026-10-19 指定保留的截图区间；固定参考备注，不随新计算覆盖。
export const RECORDED_RANGES:Record<string,{statistic:string;low:string;high:string;samples:number}>={
 bss:{statistic:'avg_BSS',low:'-0.0227936',high:'0.0827297',samples:745},
 cba:{statistic:'avg_CBA',low:'2.05893',high:'7.73665',samples:733},
 cbi2:{statistic:'avg_CBI2',low:'-0.0108802',high:'0.0396005',samples:715},
 'drift-speed-z':{statistic:'avg_a',low:'2.0469',high:'10.0813',samples:707},
};
/** 「渔」统一的小勾选框：主色实心 + 白勾，深色主题下未选中也不发白。 */
export function FishCheck({className='',...props}:InputHTMLAttributes<HTMLInputElement>){
 return <span className={`relative inline-flex h-3.5 w-3.5 shrink-0 ${className}`}><input {...props} type="checkbox" className="peer h-3.5 w-3.5 cursor-pointer appearance-none rounded-[4px] border border-muted-foreground/40 bg-background transition-colors checked:border-primary checked:bg-primary hover:border-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50"/><Check aria-hidden strokeWidth={3} className="pointer-events-none absolute inset-0.5 hidden h-2.5 w-2.5 text-primary-foreground peer-checked:block"/></span>;
}
export interface FishCard {id:string;featureId:string;enabled:boolean;pref:FishPreference}
export function FishAlgorithmCard({card,defs,locked,index,onChange,onDelete,canDelete=true,suggestion=null,computing='',queued=false,librarySize=0,footer,onRecalculate,recalculateDisabled=false,recalculating=false}:{card:FishCard;defs:DeepDigFeatureDef[];locked:boolean;index:number;onChange:(card:FishCard)=>void;onDelete:()=>void;canDelete?:boolean;suggestion?:FishSuggestion|null;computing?:string;queued?:boolean;librarySize?:number;footer?:ReactNode;onRecalculate?:()=>void;recalculateDisabled?:boolean;recalculating?:boolean}) {
 const def=defs.find(d=>d.id===card.featureId),p=card.pref,recorded=RECORDED_RANGES[card.featureId];
 const update=(patch:Partial<FishPreference>)=>onChange({...card,pref:{...p,...patch,constraints:[]}});
 // A card added before a shared suggestion finishes must also consume that cached result.
 useEffect(()=>{if(locked||!card.enabled||!suggestion||!mayFillFishThreshold(p.threshold,p.lastSuggestion))return;const value=suggestedFishThreshold(suggestion,p.direction);if(value!==null&&String(value)!==p.threshold)update({threshold:String(value),lastSuggestion:String(value)});},[suggestion,p.threshold,p.lastSuggestion,p.direction,locked,card.enabled,onChange]);
 let stats:ReturnType<typeof fishStatistics>=[],error='';try{if(!def)throw Error('特征值已不存在');stats=fishStatistics(def);if(card.enabled){const plan=compileFishProgram(def,{statistic:p.statistic,direction:p.direction,threshold:p.threshold.trim()?Number(p.threshold):NaN,constraints:[]});error=plan.unavailable??'';}}catch(e){error=e instanceof Error?e.message:String(e);}
 // 【用户要求】2026-10-20「渔的界面要完全按照最高级别的审美标准来设计，既简洁又美观又具备功能性」：
 // 每行只保留操作字段；条件、单位、区间和计算状态统一收进淡色说明入口。
 const field='h-7 min-w-0 w-full rounded-md border border-transparent bg-muted/50 text-[11px] text-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring/60 focus-visible:bg-background';
 const cls=`${field} appearance-none pl-2 pr-6`;
 const options=useMemo(()=>defs.map(d=>{try{const plan=compileFishProgram(d,{direction:'>',threshold:0,constraints:[]});return {def:d,reason:plan.unavailable};}catch(e){return {def:d,reason:e instanceof Error?e.message:String(e)};}}),[defs]);
 const label=(field:string)=>index===1?`捕捞${field==='特征值'?'算法':field}`:`算法 ${index} ${field}`;
 const refresh=onRecalculate?<button type="button" aria-label={index===1?'计算建议':`重新计算算法 ${index} 的区间`} title="重新计算区间（点击后才取数）" disabled={recalculateDisabled} className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded align-middle text-muted-foreground/35 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-30" onClick={onRecalculate}><RotateCw className={`h-2.5 w-2.5 ${recalculating?'animate-spin':''}`}/></button>:null;
 const suggestionText=footer??<>{suggestion?<span className="text-[10px] text-muted-foreground" data-testid={`fish-suggestion-${index}`} title={fishSuggestionTitle(suggestion)}>{suggestion.samples.p25===null?'信号库暂无有效建议':`信号库建议 ${Number(suggestion.samples.p25.toPrecision(6))} ~ ${Number(suggestion.samples.p75!.toPrecision(6))}`}（{suggestion.samples.n} / {librarySize} 条）</span>:computing?<span className="text-[10px] text-muted-foreground/70" data-testid={`fish-suggestion-auto-${index}`}>信号库建议计算中 {computing}</span>:queued&&card.enabled&&librarySize>0?<span className="text-[10px] text-muted-foreground/50">信号库建议排队中</span>:null}</>;
 const chevron=<ChevronDown aria-hidden className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60"/>;
 const unit=p.statistic&&p.statistic!=='结果'?'原值':def?.unit;
 const stateHold=fishStateHold(card.featureId,p.statistic,p.direction);
 const footerHasContent=isValidElement<{children?:ReactNode}>(footer)&&footer.type===Fragment?Children.toArray(footer.props.children).length>0:!!footer;
 const hasReference=recorded||footerHasContent||suggestion||computing||(queued&&card.enabled&&librarySize>0)||(onRecalculate&&!recalculateDisabled);
 const selectedName=def?.id==='state'?fishSourceLabel({featureId:def.id,featureShort:def.short,statistic:p.statistic??'结果',definitionKey:JSON.stringify([def.formula])}):def?.short||def?.name;
 const dim=`transition-opacity ${card.enabled?'':'opacity-40'}`;
 return <fieldset disabled={locked} className="relative min-w-0 py-1 pl-2 pr-8 text-[11px] transition-colors hover:bg-muted/20" aria-label={`算法 ${index}`}>
 <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
 <label className="flex w-8 shrink-0 items-center gap-1.5 pl-0.5" title={`算法 ${index}`}><FishCheck aria-label={`启用算法 ${index}`} checked={card.enabled} onChange={e=>onChange({...card,enabled:e.target.checked})}/><span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">{index}</span></label>
 <span className={`relative w-24 shrink-0 ${dim}`}><select aria-label={label('特征值')} title={def?.name} className={`${cls} font-medium`} value={card.featureId} onChange={e=>onChange({...card,featureId:e.target.value,pref:{...readFishPreference(e.target.value),constraints:[]}})}>{options.map(({def:d,reason})=><option key={d.id} value={d.id} label={`${d.id===card.featureId?selectedName:d.short||d.name}${reason?' · 不可用':''}`} aria-label={`${d.short} · ${d.name}${reason?`（${reason}）`:''}`} disabled={!!reason}>{d.short} · {d.name}{reason?`（${reason}）`:''}</option>)}</select>{chevron}</span>
 <span className={`relative w-32 shrink-0 ${dim}`}><select aria-label={label('统计量')} title={stats.find(s=>s.name===(p.statistic??'结果'))?.label} className={cls} value={p.statistic??'结果'} onChange={e=>{const next=withFishDefaultThreshold(card.featureId,{...p,statistic:e.target.value,threshold:'',lastSuggestion:undefined});update({statistic:next.statistic,threshold:next.threshold,lastSuggestion:undefined});}}>{stats.map(s=><option key={s.name} value={s.name} label={s.name==='结果'?s.label:s.name} aria-label={s.label}>{s.label}</option>)}</select>{chevron}</span>
 <span className={`relative w-11 shrink-0 ${dim}`}><select aria-label={label('方向')} className={`${cls} pl-2.5 pr-5 font-medium`} value={p.direction} onChange={e=>{const direction=e.target.value as '>'|'<',fill=suggestion?suggestedFishThreshold(suggestion,direction):null;if(fill!==null&&p.lastSuggestion!==undefined&&mayFillFishThreshold(p.threshold,p.lastSuggestion))update({direction,threshold:String(fill),lastSuggestion:String(fill)});else update({direction});}}><option value=">">&gt;</option><option value="<">&lt;</option></select>{chevron}</span>
 <span className={`relative w-24 shrink-0 ${dim}`}><input aria-label={label('阈值')} title={unit} className={`${field} px-2 pt-0.5 font-mono font-medium tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`} type="number" step="any" value={p.threshold} onChange={e=>update({threshold:e.target.value,lastSuggestion:undefined})}/></span>
 <Popover><PopoverTrigger asChild><button type="button" aria-label={`算法 ${index} 说明`} title="算法说明" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/30 transition-colors hover:bg-muted/50 hover:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"><CircleHelp aria-hidden strokeWidth={1.4} className="h-3 w-3"/></button></PopoverTrigger><PopoverContent align="start" sideOffset={6} aria-label={`算法 ${index} 说明`} className="max-h-[60vh] w-80 max-w-[calc(100vw-2rem)] space-y-2.5 overflow-y-auto p-3 text-[11px] leading-relaxed">
 <p className="font-medium text-foreground">{selectedName||`算法 ${index}`} · 说明</p>
 <div className="space-y-1 text-muted-foreground"><p>所选序列：{stats.find(s=>s.name===(p.statistic??'结果'))?.label??p.statistic??'结果'}</p><p>当前门槛：<span className="font-mono text-foreground/80">{p.direction} {p.threshold||'—'}</span>{unit?`（${unit}）`:''}，以已收盘读数判定。</p></div>
 {stateHold&&<div className="space-y-1.5 border-t border-border/50 pt-2 text-muted-foreground"><p className="font-medium text-foreground/80">持续条件，满足任一条即可</p><p>{FISH_STATE_HOLD_TEXT}</p><p>两条路径分别从首次高于各自门槛的收盘时刻计时；回到对应门槛或以下，该路径重新计时。当前还须超过左侧门槛（默认 0.7），不要求整个持续期间都高于 0.7。</p></div>}
 {def?.definition&&<p className="border-t border-border/50 pt-2 text-muted-foreground">{def.definition}</p>}
 {hasReference&&<div className="space-y-1 border-t border-border/50 pt-2 text-muted-foreground">
 <div className="flex items-center justify-between gap-2"><span className="font-medium text-foreground/80">{recorded?'区间参考':'信号库建议'}</span>{refresh}</div>
 {recorded&&<p title={`2026-10-19 截图记录 · ${recorded.samples} / 793 条；固定参考区间`} data-testid={`fish-recorded-range-${index}`}>{recorded.statistic}：<span className="font-mono tabular-nums">{recorded.low} ~ {recorded.high}</span></p>}
 <div className="empty:hidden">{suggestionText}</div>
 </div>}
 </PopoverContent></Popover>
 {canDelete&&<Popover><PopoverTrigger asChild><button type="button" aria-label={`算法 ${index} 的更多操作`} title="更多操作" className="absolute right-1 top-1.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/30 transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"><Ellipsis className="h-3.5 w-3.5"/></button></PopoverTrigger><PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)] p-2 text-[10px] leading-5">
 <button type="button" aria-label={`删除算法 ${index}`} className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-muted-foreground hover:bg-accent hover:text-destructive" onClick={onDelete}><X className="h-3 w-3"/>删除这个算法</button>
 </PopoverContent></Popover>}
 </div>
 {card.enabled&&error&&<p className="mt-1 break-words pl-[2.375rem] text-destructive" role="alert">{error}</p>}</fieldset>;
}
