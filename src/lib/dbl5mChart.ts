import {registerIndicator,type IndicatorDrawParams} from 'klinecharts';
import {accountResearchIndicators,DBL5_GUARD_CHART,GUARD_1115_CHART_ID,GUARD_PLUS_0_CHART_ID,researchChartSeries,researchKcName,type ResearchIndicator} from './researchIndicators';
import {drawImpulse1115Reference,IMPULSE_1115_LINE_COLOR,type Impulse1115ChartRow} from './impulse1115Chart';
import {drawImpulse5mReference,IMPULSE_5M_LINE_COLOR,impulse5mChartSeries} from './impulse5mChart';
import {DBL5_GUARD_VERSION,DBL5_RETEST_GUARD_VERSION,type Dbl5GuardVersion} from './dbl5m';
import {boxAlgorithmVersion} from './fish/boxAlgorithmVersions';

// Keep the first three native chart parameters unchanged. An absent fourth
// parameter follows the account's research definition, including old layouts.
export const dbl5ChartGuardParam=(version:Dbl5GuardVersion):number=>version===DBL5_RETEST_GUARD_VERSION?2:1;
const chartGuardVersion=(params?:readonly number[]):Dbl5GuardVersion|undefined=>
  params?.[3]===1?DBL5_GUARD_VERSION:params?.[3]===2?DBL5_RETEST_GUARD_VERSION:undefined;
const chartGuardLabel=(params?:readonly number[])=>boxAlgorithmVersion(chartGuardVersion(params))?.label??'防守线';
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
const originalCombinedRows = new WeakMap<ReturnType<typeof researchChartSeries>, Record<string, number>[]>();
const defenseRows = new WeakMap<ReturnType<typeof researchChartSeries>, Record<string, number>[]>();
const impulseRows = new WeakMap<Record<string,number>[],Impulse1115ChartRow[]>();
const GUARD_1115_LINE_COLOR='#229173';

function registerGuardPlusIndicator(item:ResearchIndicator){
 const defenseOnly=item.id===GUARD_1115_CHART_ID;
 const defense={key:'DBL5P_base',title:'防守线: ',type:'line' as const,styles:()=>({color:GUARD_1115_LINE_COLOR})};
 registerIndicator<Record<string,number>>({
  name:researchKcName(item.id),shortName:item.short,calcParams:[3,0,0],precision:12,
  figures:defenseOnly?[defense]:[defense,{key:'DBL5P_impulse',title:'急拉线: ',type:'line',styles:()=>({color:IMPULSE_1115_LINE_COLOR})},
   {key:'value',title:'组合参考: ',type:'line',styles:()=>({color:'#8795a5'})}],
  calc:(bars,indicator)=>{
   const source=defenseOnly?accountResearchIndicators().find(indicator=>indicator.id==='DBL5_GUARD_PLUS')!:item;
   const series=researchChartSeries(bars,source,indicator.calcParams[0]);
   const cache=defenseOnly?defenseRows:chartRows;
   const cached=cache.get(series);
   if(cached)return cached;
   const components=Object.entries(series.components??{}).filter(([key])=>!defenseOnly||key==='DBL5P_base'||key==='_DBL5_guard_segment');
   const rows=series.core.map((value,index)=>{
    const row:Record<string,number>={_pending:series.pending?1:0};
    if(!defenseOnly){
     row._time=bars[index].timestamp;
     if(value!=null&&Number.isFinite(value))row.value=value;
    }
    for(const [key,values] of components){
     const field=values[index];
     if(field!=null&&Number.isFinite(field))row[key]=field;
    }
    return row;
   });
   cache.set(series,rows);
   return rows;
  },
  draw:(params:IndicatorDrawParams<Record<string,number>>)=>{
   const {ctx,indicator,visibleRange,xAxis,yAxis}=params;
   const from=Math.max(0,visibleRange.from-2),to=Math.min(indicator.result.length,visibleRange.to+1);
   const rows=indicator.result.slice(from,to);
   ctx.save();
   let previous:{y:number;id:number}|undefined;
   ctx.beginPath();
   ctx.strokeStyle=GUARD_1115_LINE_COLOR;
   ctx.lineWidth=1.5;
   ctx.setLineDash([]);
   rows.forEach((row,index)=>{
    const value=row.DBL5P_base,id=row._DBL5_guard_segment;
    if(!Number.isFinite(value)||!Number.isFinite(id)){previous=undefined;return;}
    const x=xAxis.convertToPixel(index+from+1),y=yAxis.convertToPixel(value);
    if(previous?.id===id){ctx.lineTo(x,previous.y);ctx.lineTo(x,y);}
    else{ctx.moveTo(x-.7,y);ctx.lineTo(x+.7,y);}
    previous={y,id};
   });
   ctx.stroke();
   if(!defenseOnly){
    const data=indicator.result;
    let points=impulseRows.get(data);
    if(!points){
     points=data.map(row=>({time:row._time,available:Number.isFinite(row.DBL5P_early),pending:row._pending===1,value:row.DBL5P_impulse}));
     impulseRows.set(data,points);
    }
    drawImpulse1115Reference(params,points);
   }
   if(rows.some(row=>row._pending===1)){
    ctx.fillStyle='#8895a5';ctx.font='11px sans-serif';ctx.fillText(item.short+' · 正在准备5m历史行情…',8,40);
   }
   ctx.restore();
   return true;
  },
 });
}

export function registerDbl5Indicator(item:ResearchIndicator){
 if(item.core==='DBL5P'||item.id===GUARD_1115_CHART_ID){registerGuardPlusIndicator(item);return;}
 const price=!!item.priceOverlay;
 const period=item.id.startsWith('DBL5_1H')||item.templateId?.startsWith('DBL5_1H')?'1h':'5m';
 const originalCombined=item.id===GUARD_PLUS_0_CHART_ID;
 registerIndicator<Record<string,number>>({name:researchKcName(item.id),shortName:item.short,calcParams:[3,0,0],precision:price?12:2,
  figures:[
    ...(price?['value','DBL5_upper','_DBL5_guard']:['value']).map(key=>({key,title:(key==='value'?item.short:key==='_DBL5_guard'?'防守线':'固定上轨')+': ',type:'line' as const})),
    ...(originalCombined?[{key:'impulse5mValue',title:'急拉线起涨低点: ',type:'line' as const,styles:()=>({color:IMPULSE_5M_LINE_COLOR})}]:[]),
  ],
  calc:(bars,indicator)=>{
    const out=researchChartSeries(bars,originalCombined?DBL5_GUARD_CHART:item,indicator.calcParams[0],{guardVersion:chartGuardVersion(indicator.calcParams)});
    const cache=originalCombined?originalCombinedRows:chartRows;
    const cached=cache.get(out);
    if(cached)return cached;
    const impulse=originalCombined?impulse5mChartSeries(bars):undefined;
    const components=Object.entries(out.components??{}),pending=out.pending?1:0;
    const rows=out.core.map((value,i)=>{
      const row:Record<string,number>={_pending:pending};
      if(value!==null&&Number.isFinite(value))row.value=value;
      for(const [key,values] of components){const point=values[i];if(point!=null)row[key]=point;}
      const impulsePoint=impulse?.[i];
      if(impulsePoint?.value!=null&&impulsePoint.confirmedAt!=null){
        row.impulse5mValue=impulsePoint.value;
        row.impulse5mConfirmedAt=impulsePoint.confirmedAt;
      }
      return row;
    });
    cache.set(out,rows);
    return rows;
  },
  draw:(params:IndicatorDrawParams<Record<string,number>>)=>{
    const {ctx,indicator,visibleRange,xAxis,yAxis,bounding,defaultStyles}=params;
    ctx.save();ctx.setLineDash([]);
    const field=price?'DBL5_upper':'value',identityField=price?'_DBL5_box':'_DBL5_episode';
    let previousPoint:{x:number;y:number;identity:number}|undefined;
    let drew=false;
    ctx.beginPath();
    ctx.lineWidth=1;ctx.globalAlpha=price?.4:.55;ctx.strokeStyle=price?'#8a96a5':'#0b9f78';
    for(let i=Math.max(0,visibleRange.from-2);i<Math.min(indicator.result.length,visibleRange.to+1);i++){
      const row=indicator.result[i],value=row?.[field],identity=row?.[identityField];
      if(!Number.isFinite(value)||!Number.isFinite(identity)){previousPoint=undefined;continue;}
      // Source candle timestamps are opens. Publish at its close, never at its opening centre.
      const x=xAxis.convertToPixel(i+1),y=yAxis.convertToPixel(value);
      if(previousPoint?.identity===identity){ctx.moveTo(previousPoint.x,previousPoint.y);ctx.lineTo(x,previousPoint.y);ctx.lineTo(x,y);}else {ctx.moveTo(x-1,y);ctx.lineTo(x+1,y);}
      drew=true;previousPoint={x,y,identity};
    }
    if(drew)ctx.stroke();
    // The main pane shows the guard and fixed upper rail. Box-floor readings remain in the tooltip.
    // Only a confirmed close below the guard draws a red cross.
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
          const text=chartGuardLabel(indicator.calcParams)+' · '+regime,right=bounding.width-8,y=bounding.height-10;
          ctx.fillText(text,right,y);
          const lineRight=right-ctx.measureText(text).width-6;
          ctx.strokeStyle='#2563eb';ctx.lineWidth=1.4;ctx.setLineDash(regime==='趋势'?[]:[5,3]);ctx.beginPath();ctx.moveTo(lineRight-18,y-3);ctx.lineTo(lineRight,y-3);ctx.stroke();ctx.restore();
        }
      }
    }
    const visible=indicator.result.slice(Math.max(0,visibleRange.from),Math.min(indicator.result.length,visibleRange.to));
    if(visible.length&&!visible.some(r=>Number.isFinite(r?.value))){const last=visible.at(-1),text=last?._pending?`正在准备${period}历史行情…`:last?._DBL5_invalid===1?'行情或历史价格精度不可验证':last?._DBL5_warmup===1?`连续${period}行情预热中`:'当前可见范围暂无已确认箱体';ctx.fillStyle='#8895a5';ctx.font='11px sans-serif';ctx.fillText(item.short+' · '+text,8,40);}
    ctx.restore();
    if(originalCombined)drawImpulse5mReference(params,row=>({value:row.impulse5mValue,confirmedAt:row.impulse5mConfirmedAt}));
    return true;
  },
  createTooltipDataSource:({indicator,crosshair,defaultStyles})=>{
    // Crosshair candle at open t can only read a completed result <= t.
    const index=crosshair?.dataIndex,previous=index===undefined?indicator.result.length-1:index-1,row=indicator.result[previous],n=(v:number)=>Number.isFinite(v)?Number(v.toPrecision(12)).toString():'—';
    const type=row?row._pending?`正在准备${period}历史行情`:row._DBL5_invalid===1?'行情或历史价格精度不可验证':row._DBL5_warmup===1?'连续行情预热中':row._DBL5_nested===1?'内部箱底抬高':row._DBL5_up_step===1?'完整上移':row._DBL5_same_floor===1?'同底新箱':row._DBL5_baseline===1?'基准箱':'无有效箱体':'尚无已确认结果';
    const values = [{title:price?'下轨: ':item.short+': ',value:n(row?.value)}];
    if(price) {
      const regime = Number.isFinite(row?._DBL5_guard)
        ? (row._DBL5_guard_trend===1?'（实线·上涨期）':'（虚线·震荡期）') : '';
      values.push(
        {title:'固定上轨: ',value:n(row?.DBL5_upper)},
        {title:chartGuardLabel(indicator.calcParams)+regime+': ',value:n(row?._DBL5_guard)},
      );
    }
    // The impulse series already starts at the bar after confirmation.
    const impulse = indicator.result[index??indicator.result.length-1]?.impulse5mValue;
    return {
      name:item.short,calcParamsText:'5m已收盘 · '+type,icons:defaultStyles.tooltip.icons,
      values:originalCombined?[...values,{title:'急拉线起涨低点: ',value:{text:n(impulse),color:IMPULSE_5M_LINE_COLOR}}]:values,
    };
  }
 });
}
