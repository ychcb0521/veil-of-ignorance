import type {QualityGroup,QualityResult,QualitySample} from '@/lib/fish/quality';
import {qualityEntryKey,qualityEntryParts,validEntryReading,type QualityEntryReading} from '@/lib/fish/qualityEntry';
import {qualitySalePriceChangePct} from '@/lib/fish/qualityPresentation';
import {qualityTableRange} from '@/lib/fish/qualityTableRows';
import {formatUTC8} from '@/lib/timeFormat';
interface Entry {row:QualitySample;result?:QualityResult;skipped?:boolean}
const pct=(v:number)=>`${v>0?'+':''}${v.toFixed(2)}%`;
export function QualityEntryCell({plan,entries,readings,onRetry,readOnly=false,expanded=false,onExpand}:{expanded?:boolean;onExpand?:()=>void;readOnly?:boolean;plan:QualityGroup;entries:Entry[];readings:ReadonlyMap<string,QualityEntryReading>;onRetry:()=>void}){
 const unique=[...new Map(entries.map(e=>[e.row.signalId??e.row.id,e])).values()];
 const total=unique.length*qualityEntryParts(plan).length;
 if(!expanded)return <td className="border-l border-t border-border/40 px-2 py-1" data-testid="quality-entry-reading" data-sell-plan={plan.id}><button type="button" aria-label={`展开${plan.label}入场读数`} aria-expanded={false} onClick={onExpand} className="text-primary hover:underline">{total} 项 · 展开</button></td>;
 return <td className="border-l border-t border-border/40 px-2 py-1" data-testid="quality-entry-reading" data-sell-plan={plan.id}><div className="space-y-1">{unique.flatMap(e=>qualityEntryParts(plan).map(part=>{
  const key=e.skipped?null:qualityEntryKey(e.row.source,e.result,plan,part),r=key?readings.get(key):undefined,valid=validEntryReading(r);
  const text=e.skipped?'未买入':e.result?.status==='error'?'缺数据':!key?'待买入':valid?Number(r!.value!.toPrecision(9)).toString():r?.error?'缺数据':readOnly?'未归档':'待补算';
  const detail=`${part.label}。${e.result?.entryTime?'买入 '+formatUTC8(e.result.entryTime)+'。':''}${r?`${r.mode==='intrabar'?'盘中复原，仅用买入前已完成分钟':'收盘确认，取最近已收盘指标K线'}。${r.at?'读数时刻 '+formatUTC8(r.at)+'。':''}${r.error??''}`:'按冻结的卖出公式及监测模式补算；不读取买入之后的价格。'}`;
  return <div key={`${e.row.signalId??e.row.id}:${part.id}`} className="whitespace-nowrap" title={detail}><button type="button" disabled={readOnly||valid||!key} onClick={onRetry} className={`font-mono tabular-nums ${valid?'text-foreground':'text-muted-foreground hover:text-primary disabled:hover:text-muted-foreground'}`} data-testid="quality-entry-value">{text}</button>{(part.id!=='main'||unique.length>1)&&<span className="ml-2 text-[9px] text-muted-foreground">{part.id!=='main'?part.label:''}{unique.length>1&&e.result?.entryTime?' · '+formatUTC8(e.result.entryTime):''}</span>}</div>;
 }))}</div></td>;
}
export function QualitySalePriceChangeCell({plan,entries}:{plan:QualityGroup;entries:{result?:QualityResult;skipped?:unknown}[]}){
 const values=entries.map(e=>e.skipped?null:qualitySalePriceChangePct(e.result)),valid=values.filter((v):v is number=>v!=null),range=qualityTableRange(values,pct);
 const text=range!=='—'?range:entries.every(e=>e.skipped)?'未买入':entries.every(e=>e.result?.status==='open')?'持仓中':entries.some(e=>e.result?.status==='error'||e.result?.status==='closed')?'缺数据':'待卖出';
 return <td className={`border-t border-border/40 px-2 py-1 font-mono tabular-nums ${valid.length&&valid.every(v=>v>0)?'text-emerald-600 dark:text-emerald-400':valid.some(v=>v<0)?'text-destructive':'text-muted-foreground'}`} data-testid="quality-sale-price-change" data-sell-plan={plan.id} title="（最终卖出价 ÷ 初始买入价 − 1）× 100%；保留价格涨跌符号，单独于包含镜像和加仓的资金收益率展示。多次买入分别计算后显示范围，未完成不记作0。">{text}</td>;
}
