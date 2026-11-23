import type {HoldingVetoDraft} from '@/lib/fish/qualityFilters';
import {MIRROR_PNL_THRESHOLD_VERSION,signedMirrorPnl,MIRROR_REVIEW_SCHEDULE_VERSION} from '@/lib/fish/qualityMirrorLossReview';
import {FishBoxStopInfo} from './FishBoxStopInfo';

const field='h-8 shrink-0 rounded-md bg-muted/50 px-2 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring';
const width=(value:string)=>({width:`calc(${Math.max(5,value.length)}ch + 2.5rem)`});
export function FishMirrorLossReviewFields({draft,label,onChange}:{draft:HoldingVetoDraft;label:string;onChange:(next:Partial<HoldingVetoDraft>)=>void}){
 const start=draft.threshold,interval=draft.reviewSchedule?.intervalHours??'0.5',raw=draft.lossThreshold?.value??'0';
 const signed=draft.lossThreshold?.version===MIRROR_PNL_THRESHOLD_VERSION;
 const loss=signed?raw:signedMirrorPnl(-Number(raw));
 const unit=draft.lossThreshold?.unit??'percent',suffix=unit==='percent'?'%':'USDT';
 const lossText=loss.trim()&&Number.isFinite(Number(loss))
  ? `整笔盈亏 ${!signed&&Number(loss)<0?'≤':'<'} ${signedMirrorPnl(Number(loss))}${suffix}` : '盈亏门槛待填写';
 return <div className="w-full space-y-2 pt-1" data-testid="mirror-review-simple-settings">
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
   <label className="space-y-1 text-[10px] text-muted-foreground"><span className="block">开始检查</span><span className="flex items-center gap-1 text-foreground">
    <input aria-label={label+'开始时间（小时）'} type="number" min={1/60} max={12} step="any" className={field} style={width(start)} value={start} onChange={e=>onChange({threshold:e.target.value})}/><span>小时后</span>
   </span></label>
   <label className="space-y-1 text-[10px] text-muted-foreground"><span className="block">判断间隔</span><span className="flex items-center gap-1 text-foreground">
    <input aria-label={label+'判断间隔（小时）'} type="number" min={1/60} max={12} step="any" className={field} style={width(interval)} placeholder="留空只查一次" value={interval} onChange={e=>onChange({saved:undefined,
      lossThreshold:draft.lossThreshold??{version:MIRROR_PNL_THRESHOLD_VERSION,unit:'percent',value:'0'},
      reviewSchedule:{version:MIRROR_REVIEW_SCHEDULE_VERSION,intervalHours:e.target.value,endHours:12}})}/><span>小时</span>
   </span></label>
   <div className="space-y-1 text-[10px] text-muted-foreground"><div className="flex items-center gap-1"><span>盈亏门槛</span><FishBoxStopInfo label={label+(unit==='percent'?'百分比依据':'金额依据')}>
    <p>{unit==='percent'?'盈亏百分比按整笔账面盈亏 ÷ 累计投入金额 ×100% 判断，含已成交加仓及已实现盈亏，与监测收益率同口径。':'盈亏金额按整笔账面盈亏判断，单位为 USDT，含已成交加仓及已实现盈亏。'}</p>
    <p>正值表示盈利，负值表示亏损。新条件在检查点低于门槛时退出，达到门槛则继续持有。</p>
   </FishBoxStopInfo></div><label className="flex items-center gap-1 text-foreground">
    <input aria-label={label+'盈亏门槛'} type="text" inputMode="decimal" className={field} style={width(loss)} value={signed && Number(loss)>0 && !loss.startsWith('+') ? '+'+loss : loss} onChange={e=>onChange({saved:undefined,lossThreshold:{version:MIRROR_PNL_THRESHOLD_VERSION,unit,value:e.target.value}})}/><span data-testid="mirror-review-loss-unit">{suffix}</span>
   </label></div>
  </div>
  <p className="text-[10px] leading-relaxed text-foreground" data-testid="mirror-review-rule-summary">未完成镜像止盈时，{interval.trim()?`从持仓 ${start||'…'} 小时开始，每 ${interval} 小时判断`:`持仓 ${start||'…'} 小时后只检查一次`}；{lossText}时，全余仓市价平仓。</p>
  <p className="text-[10px] text-muted-foreground">{interval.trim()&&"检查至持仓 12 小时；"}已镜像后结束本项，未触发则继续按原规则持有。</p>
 </div>;
}
