import {registerIndicator,type IndicatorDrawParams} from 'klinecharts';
import {researchChartSeries,researchKcName,type ResearchIndicator} from './researchIndicators';
export function dbl5StepPath(points:readonly {x:number;y:number|null;episode:string|number|null}[]):string {
 let d='',previous:typeof points[number]|undefined;
 for(const p of points){if(p.y===null||!Number.isFinite(p.y)||p.episode===null){previous=undefined;continue;}d+=previous&&previous.episode===p.episode?` H${p.x} V${p.y}`:` M${p.x},${p.y}`;previous=p;}
 return d.trim();
}
export function registerDbl5Indicator(item:ResearchIndicator){
 const price=!!item.priceOverlay;
 registerIndicator<Record<string,number>>({name:researchKcName(item.id),shortName:item.short,calcParams:[3,0,0],precision:price?12:2,
  figures:(price?['value','DBL5_upper']:['value']).map(key=>({key,title:(key==='value'?item.short:'固定上轨')+': ',type:'line' as const})),
  calc:(bars,indicator)=>{const out=researchChartSeries(bars,item,indicator.calcParams[0]);return out.core.map((value,i)=>({...((value!==null&&Number.isFinite(value))?{value}:{}),...Object.fromEntries(Object.entries(out.components??{}).map(([k,a])=>[k,a[i]??undefined])),_pending:out.pending?1:0}));},
  draw:({ctx,indicator,visibleRange,xAxis,yAxis}:IndicatorDrawParams<Record<string,number>>)=>{
    ctx.save();ctx.setLineDash([]);
    for(const field of price?['value','DBL5_upper']:['value']){
      let previous:{x:number;y:number;identity:number}|undefined;
      for(let i=Math.max(0,visibleRange.from-2);i<Math.min(indicator.result.length,visibleRange.to+1);i++){
        const row=indicator.result[i],value=row?.[field],identity=row?.[field==='DBL5_upper'?'_DBL5_box':'_DBL5_episode'];
        if(!Number.isFinite(value)||!Number.isFinite(identity)){previous=undefined;continue;}
        // Source candle timestamps are opens. Publish at its close, never at its opening centre.
        const x=xAxis.convertToPixel(i+1),y=yAxis.convertToPixel(value);ctx.beginPath();ctx.lineWidth=field==='value'?1.8:1;ctx.strokeStyle=field==='DBL5_upper'?'#8a96a5':row._DBL5_nested===1?'#bd952f':'#0b9f78';
        if(previous?.identity===identity){ctx.moveTo(previous.x,previous.y);ctx.lineTo(x,previous.y);ctx.lineTo(x,y);}else {ctx.moveTo(x-1,y);ctx.lineTo(x+1,y);}ctx.stroke();previous={x,y,identity};
      }
    }
    if(price)for(let i=Math.max(0,visibleRange.from-1);i<Math.min(indicator.result.length,visibleRange.to+1);i++){
      const row=indicator.result[i];if(row?.DBL5_event_support_broken===1||row?.DBL5_event_support_expired===1){const old=indicator.result[i-1]?.value;if(!Number.isFinite(old))continue;const x=xAxis.convertToPixel(i+1),y=yAxis.convertToPixel(old);ctx.strokeStyle=row.DBL5_event_support_broken===1?'#d37c72':'#bd952f';ctx.beginPath();ctx.moveTo(x-3,y-3);ctx.lineTo(x+3,y+3);ctx.moveTo(x-3,y+3);ctx.lineTo(x+3,y-3);ctx.stroke();}
    }
    const visible=indicator.result.slice(Math.max(0,visibleRange.from),Math.min(indicator.result.length,visibleRange.to));
    if(visible.length&&!visible.some(r=>Number.isFinite(r?.value))){const last=visible.at(-1),text=last?._pending?'正在准备5m历史行情…':last?._DBL5_invalid===1?'行情或历史价格精度不可验证':last?._DBL5_warmup===1?'连续5m行情预热中':'当前可见范围暂无已确认箱体';ctx.fillStyle='#8895a5';ctx.font='11px sans-serif';ctx.fillText(item.short+' · '+text,8,40);}
    ctx.restore();return true;
  },
  createTooltipDataSource:({indicator,crosshair,defaultStyles})=>{
    // Crosshair candle at open t can only read a completed result <= t.
    const index=crosshair?.dataIndex,previous=index===undefined?indicator.result.length-1:index-1,row=indicator.result[previous],n=(v:number)=>Number.isFinite(v)?Number(v.toPrecision(12)).toString():'—';
    const type=row?row._pending?'正在准备5m历史行情':row._DBL5_invalid===1?'行情或历史价格精度不可验证':row._DBL5_warmup===1?'连续行情预热中':row._DBL5_nested===1?'内部箱底抬高':row._DBL5_up_step===1?'完整上移':row._DBL5_same_floor===1?'同底新箱':row._DBL5_baseline===1?'基准箱':'无有效箱体':'尚无已确认结果';
    return {name:item.short,calcParamsText:'5m已收盘 · '+type,icons:defaultStyles.tooltip.icons,values:[{title:price?'下轨: ':item.short+': ',value:n(row?.value)},...(price?[{title:'固定上轨: ',value:n(row?.DBL5_upper)}]:[])]};
  }
 });
}
