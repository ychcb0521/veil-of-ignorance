import {registerIndicator,type IndicatorDrawParams} from 'klinecharts';
import {researchChartSeries,researchKcName,type ResearchIndicator} from './researchIndicators';
export interface SbsChartPoint {x:number;y:number|null;episode:string|number|null}
/** Horizontal holds and vertical rises. A missing point or a new episode always starts a new path. */
export function sbsStepPath(points:readonly SbsChartPoint[]):string {
 let path='',last:SbsChartPoint|undefined;
 for(const p of points){if(p.y===null||!Number.isFinite(p.y)||p.episode===null){last=undefined;continue;}
  path+=last&&last.episode===p.episode?` H${p.x} V${p.y}`:` M${p.x},${p.y}`;last=p;
 }return path.trim();
}
const lines=[['value','SBS5M_episode_token','#0b9f78',2,[]],['SBS5M_box_top','SBS5M_episode_token','#94a3b8',1,[]],['SBS5M_invalidation_price','SBS5M_episode_token','#d37c72',1,[5,4]],['SBS5M_candidate_support_price','SBS5M_candidate_token','#c29b35',1.4,[4,4]]] as const;
export function registerSbsPriceIndicator(item:ResearchIndicator){
 registerIndicator<Record<string,number>>({name:researchKcName(item.id),shortName:item.short,calcParams:[6,0,0],precision:8,
  figures:lines.map(([key])=>({key,title:key==='value'?'支撑: ':key+': ',type:'line' as const})),
  calc:(bars,indicator)=>{const data=researchChartSeries(bars,item,indicator.calcParams[0]);return data.core.map((v,i)=>({...(v===null?{}:{value:v}),...Object.fromEntries(Object.entries(data.components??{}).map(([k,a])=>[k,a[i]??undefined]))}));},
  draw:({ctx,indicator,visibleRange,xAxis,yAxis}:IndicatorDrawParams<Record<string,number>>)=>{
   ctx.save();for(const [field,id,color,width,dash] of lines){let previous:{x:number;y:number;id:number}|undefined;ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash([...dash]);
    for(let i=Math.max(0,visibleRange.from-1);i<Math.min(indicator.result.length,visibleRange.to+1);i++){const r=indicator.result[i],v=r?.[field],identity=r?.[id];
     if(!Number.isFinite(v)||!Number.isFinite(identity)){previous=undefined;continue;}const x=xAxis.convertToPixel(i),y=yAxis.convertToPixel(v);
     if(previous?.id===identity){ctx.lineTo(x,previous.y);ctx.lineTo(x,y);}else {ctx.moveTo(x-1.5,y);ctx.lineTo(x+1.5,y);ctx.moveTo(x,y);}previous={x,y,id:identity};
    }ctx.stroke();}ctx.restore();return true;
  },
  createTooltipDataSource:({indicator,crosshair,defaultStyles})=>{const row=indicator.result[crosshair?.dataIndex??indicator.result.length-1];const n=(v:number)=>Number.isFinite(v)?Number(v.toPrecision(8)).toString():'—';return {name:item.short,calcParamsText:'5m · 固定台阶 · 无有效支撑时断线',icons:defaultStyles.tooltip.icons,values:[{title:'支撑: ',value:n(row?.value)},{title:'候选（未确认）: ',value:n(row?.SBS5M_candidate_support_price)},{title:'失效参考: ',value:n(row?.SBS5M_invalidation_price)}]};}
 });
}
