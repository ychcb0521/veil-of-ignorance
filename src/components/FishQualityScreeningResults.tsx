import {FishScreeningProcessButton} from './FishScreeningProcess';
import {screeningCell,type QualityScreeningResult} from '@/lib/fish/qualityScreeningResults';
export type ScreeningSortKey='screening:plan'|'screening:status'|'screening:time';
const columns=[['screening:plan','筛选方案'],['screening:status','筛选结果'],['screening:time','首次满足时间']] as const;
export function ScreeningHeaders({cell,sort,ascending,onSort}:{cell:string;sort:string;ascending:boolean;onSort:(key:ScreeningSortKey)=>void}){
 return <>{columns.map(([key,label])=><th key={key} className={`${cell} min-w-[176px] border-l border-border/40 font-medium`} data-testid="quality-screening-column" aria-sort={sort===key?ascending?'ascending':'descending':'none'}><button type="button" className="block text-left hover:text-foreground" aria-label={`按动态${label}排序`} onClick={()=>onSort(key)}>{label}{sort===key?ascending?' ↑':' ↓':''}</button></th>)}<th className={`${cell} min-w-[112px] border-l border-border/40 font-medium`} data-testid="quality-screening-column">排除过程</th></>;
}
export function ScreeningCells({cell,results}:{cell:string;results:QualityScreeningResult[]}){
 const value=screeningCell(results);
 return <><td className={`${cell} border-l border-t border-border/40 text-muted-foreground`} data-testid="quality-screening-plan" title={value.detail}>{value.plan}</td><td className={`${cell} border-l border-t border-border/40 ${value.matched?'text-emerald-600 dark:text-emerald-400':value.error?'text-destructive':'text-muted-foreground'}`} data-testid="quality-screening-result" title={value.detail}>{value.status}</td><td className={`${cell} border-l border-t border-border/40 font-mono text-muted-foreground`} data-testid="quality-screening-time" title={value.detail}>{value.at}</td><td className={`${cell} border-l border-t border-border/40`} data-testid="quality-screening-process"><FishScreeningProcessButton results={results}/></td></>;
}
