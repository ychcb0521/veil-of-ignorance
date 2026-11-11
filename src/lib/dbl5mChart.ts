import {registerIndicator,type IndicatorDrawParams} from 'klinecharts';
import {researchChartSeries,researchKcName,type ResearchIndicator} from './researchIndicators';
export function dbl5StepPath(points:readonly {x:number;y:number|null;episode:string|number|null}[]):string {
 let d='',previous:typeof points[number]|undefined;
 for(const p of points){if(p.y===null||!Number.isFinite(p.y)||p.episode===null){previous=undefined;continue;}d+=previous&&previous.episode===p.episode?` H${p.x} V${p.y}`:` M${p.x},${p.y}`;previous=p;}
 return d.trim();
}
/** Read the latest publication inside this viewport, never a result plotted to its right. */
export function dbl5VisibleGuardRegime(result:readonly Record<string,number>[],from:number,to:number,width:number,pixel:(index:number)=>number):'趋势'|'震荡'|null {
 if(!(width>0)||!(to>from))return null;
 for(let i=Math.min(result.length-1,Math.ceil(to));i>=Math.max(0,Math.floor(from)-2);i--){
  const x=pixel(i+1);if(!Number.isFinite(x)||x>width)continue;if(x<0)return null;
  const row=result[i];
  if(!Number.isFinite(row?._DBL5_guard)||!Number.isFinite(row?._DBL5_guard_segment)||![0,1].includes(row?._DBL5_guard_trend)||row._pending===1||row._DBL5_invalid===1||row._DBL5_warmup===1)return null;
  return row._DBL5_guard_trend===1?'趋势':'震荡';
 }
 return null;
}
const chartRows = new WeakMap<ReturnType<typeof researchChartSeries>, Record<string, number>[]>();

export function registerDbl5Indicator(item:ResearchIndicator){
 const price=!!item.priceOverlay;
 registerIndicator<Record<string,number>>({name:researchKcName(item.id),shortName:item.short,calcParams:[3,0,0],precision:price?12:2,
  figures:(price?['value','DBL5_upper','_DBL5_guard']:['value']).map(key=>({key,title:(key==='value'?item.short:key==='_DBL5_guard'?'防守线':'固定上轨')+': ',type:'line' as const})),
  calc:(bars,indicator)=>{
    const out=researchChartSeries(bars,item,indicator.calcParams[0]);
    const cached=chartRows.get(out);
    if(cached)return cached;
    const components=Object.entries(out.components??{}),pending=out.pending?1:0;
    const rows=out.core.map((value,i)=>{
      const row:Record<string,number>={_pending:pending};
      if(value!==null&&Number.isFinite(value))row.value=value;
      for(const [key,values] of components){const point=values[i];if(point!=null)row[key]=point;}
      return row;
    });
    chartRows.set(out,rows);
    return rows;
  },
  draw:({ctx,indicator,visibleRange,xAxis,yAxis,bounding,defaultStyles}:IndicatorDrawParams<Record<string,number>>)=>{
    ctx.save();ctx.setLineDash([]);
    for(const field of price?['value','DBL5_upper']:['value']){
      let previous:{x:number;y:number;identity:number}|undefined;
      let drew=false;
      ctx.beginPath();
      ctx.lineWidth=1;ctx.globalAlpha=field==='value'?.55:.4;ctx.strokeStyle=field==='DBL5_upper'?'#8a96a5':'#0b9f78';
      for(let i=Math.max(0,visibleRange.from-2);i<Math.min(indicator.result.length,visibleRange.to+1);i++){
        const row=indicator.result[i],value=row?.[field],identity=row?.[field==='DBL5_upper'?'_DBL5_box':'_DBL5_episode'];
        if(!Number.isFinite(value)||!Number.isFinite(identity)){previous=undefined;continue;}
        // Source candle timestamps are opens. Publish at its close, never at its opening centre.
        const x=xAxis.convertToPixel(i+1),y=yAxis.convertToPixel(value);
        if(previous?.identity===identity){ctx.moveTo(previous.x,previous.y);ctx.lineTo(x,previous.y);ctx.lineTo(x,y);}else {ctx.moveTo(x-1,y);ctx.lineTo(x+1,y);}
        drew=true;previous={x,y,identity};
      }
      if(drew)ctx.stroke();
    }
    // 【用户要求】2026-11-02「颜色太多分不清」：防守线是唯一的主线（蓝色加粗），上涨期实线、震荡期虚线；箱底、箱顶退为淡色细线；
    // 只保留防守线收盘确认跌破的红叉，箱底被影线刺穿的小叉不再画
    ctx.globalAlpha=1;
    if(price){
      let previous:{x:number;y:number;identity:number;trend:boolean}|undefined;
      let run:{from:number;to:number;y:number;trend:boolean}|undefined;
      // Stroke a whole horizontal run once. Restarting a [5,3] dash at every
      // candle makes it look solid whenever the candle spacing is below 5 px.
      const flush=()=>{
        if(!run)return;
        ctx.beginPath();ctx.setLineDash(run.trend?[]:[5,3]);
        ctx.moveTo(run.from,run.y);ctx.lineTo(run.to,run.y);ctx.stroke();run=undefined;
      };
      ctx.lineWidth=2;ctx.strokeStyle='#2563eb';
      for(let i=Math.max(0,visibleRange.from-2);i<Math.min(indicator.result.length,visibleRange.to+1);i++){
        const row=indicator.result[i],value=row?._DBL5_guard,identity=row?._DBL5_guard_segment;
        if(!Number.isFinite(value)||!Number.isFinite(identity)){flush();previous=undefined;continue;}
        const x=xAxis.convertToPixel(i+1),y=yAxis.convertToPixel(value),trend=row._DBL5_guard_trend===1;
        if(previous?.identity===identity){
          // Until this publication time, both the price and regime belong to
          // the previous completed candle; do not repaint it with a new regime.
          if(run&&run.y===previous.y&&run.trend===previous.trend)run.to=x;
          else {flush();run={from:previous.x,to:x,y:previous.y,trend:previous.trend};}
          // The publication step shares the next candle's opening centre. A
          // faint connector keeps an overlapping real wick visible (ALLO 14:15).
          if(previous.y!==y){flush();ctx.beginPath();ctx.globalAlpha=.25;ctx.lineWidth=1;ctx.setLineDash([2,3]);ctx.moveTo(x,previous.y);ctx.lineTo(x,y);ctx.stroke();ctx.globalAlpha=1;ctx.lineWidth=2;}
        }else {flush();ctx.beginPath();ctx.setLineDash(trend?[]:[5,3]);ctx.moveTo(x-1,y);ctx.lineTo(x+1,y);ctx.stroke();}previous={x,y,identity,trend};
      }
      flush();
      ctx.setLineDash([]);
      for(let i=Math.max(0,visibleRange.from-1);i<Math.min(indicator.result.length,visibleRange.to+1);i++){
        const row=indicator.result[i],old=indicator.result[i-1]?._DBL5_guard;if(row?._DBL5_guard_broken!==1||!Number.isFinite(old))continue;
        const x=xAxis.convertToPixel(i+1),y=yAxis.convertToPixel(old);ctx.strokeStyle='#dc2626';ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(x-4,y-4);ctx.lineTo(x+4,y+4);ctx.moveTo(x-4,y+4);ctx.lineTo(x+4,y-4);ctx.stroke();
      }
      // A small, unboxed key in the pane margin leaves candles and line geometry untouched.
      if(bounding?.width>=140&&bounding.height>=80){
        const regime=dbl5VisibleGuardRegime(indicator.result,visibleRange.from,visibleRange.to,bounding.width,i=>xAxis.convertToPixel(i));
        if(regime){
          ctx.save();ctx.font='10.5px sans-serif';ctx.textAlign='right';ctx.globalAlpha=.78;
          ctx.fillStyle=defaultStyles?.tooltip?.text?.color??'#64748b';
          const text='防守线 · '+regime,right=bounding.width-8,y=bounding.height-10;
          ctx.fillText(text,right,y);
          const lineRight=right-ctx.measureText(text).width-6;
          ctx.strokeStyle='#2563eb';ctx.lineWidth=1.4;ctx.setLineDash(regime==='趋势'?[]:[5,3]);ctx.beginPath();ctx.moveTo(lineRight-18,y-3);ctx.lineTo(lineRight,y-3);ctx.stroke();ctx.restore();
        }
      }
    }
    const visible=indicator.result.slice(Math.max(0,visibleRange.from),Math.min(indicator.result.length,visibleRange.to));
    if(visible.length&&!visible.some(r=>Number.isFinite(r?.value))){const last=visible.at(-1),text=last?._pending?'正在准备5m历史行情…':last?._DBL5_invalid===1?'行情或历史价格精度不可验证':last?._DBL5_warmup===1?'连续5m行情预热中':'当前可见范围暂无已确认箱体';ctx.fillStyle='#8895a5';ctx.font='11px sans-serif';ctx.fillText(item.short+' · '+text,8,40);}
    ctx.restore();return true;
  },
  createTooltipDataSource:({indicator,crosshair,defaultStyles})=>{
    // Crosshair candle at open t can only read a completed result <= t.
    const index=crosshair?.dataIndex,previous=index===undefined?indicator.result.length-1:index-1,row=indicator.result[previous],n=(v:number)=>Number.isFinite(v)?Number(v.toPrecision(12)).toString():'—';
    const type=row?row._pending?'正在准备5m历史行情':row._DBL5_invalid===1?'行情或历史价格精度不可验证':row._DBL5_warmup===1?'连续行情预热中':row._DBL5_nested===1?'内部箱底抬高':row._DBL5_up_step===1?'完整上移':row._DBL5_same_floor===1?'同底新箱':row._DBL5_baseline===1?'基准箱':'无有效箱体':'尚无已确认结果';
    return {name:item.short,calcParamsText:'5m已收盘 · '+type,icons:defaultStyles.tooltip.icons,values:[{title:price?'下轨: ':item.short+': ',value:n(row?.value)},...(price?[{title:'固定上轨: ',value:n(row?.DBL5_upper)},{title:`防守线${Number.isFinite(row?._DBL5_guard)?row._DBL5_guard_trend===1?'（实线·上涨期）':'（虚线·震荡期）':''}: `,value:n(row?._DBL5_guard)}]:[])]};
  }
 });
}
