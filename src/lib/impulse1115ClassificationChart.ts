import {registerIndicator,type IndicatorDrawParams,type KLineData} from 'klinecharts';
import {DBL5_STEP} from './dbl5m';
import {
  IMPULSE_1115_CLASSIFICATION_CHART_ID,
  IMPULSE_1115_STATUS_CODES,type Impulse1115Status,
} from './impulse1115Classification';
import {impulse1115TooltipRow,type Impulse1115ChartRow} from './impulse1115Chart';
import {IMPULSE_1115_CLASS_COLORS,IMPULSE_1115_REFERENCE_CLASS,IMPULSE_1115_REFERENCE_DETECTED_AT,IMPULSE_1115_DISPLAY_REFERENCE} from './impulse1115ClassificationDisplay';
import {accountResearchIndicators,researchChartSeries,researchKcName,type ResearchIndicator} from './researchIndicators';

export interface Impulse1115ClassificationChartRow extends Impulse1115ChartRow {
  mainClass?: number;
  state?: number;
  status?: Impulse1115Status;
  frozenLine?: number;
  detectedAt?: number;
  tests?: number;
  pierced?: boolean;
  changed?: boolean;
  valid?: boolean;
  referenceClass?:1|2;
  referenceDetectedAt?:number;
}
const cache=new WeakMap<ReturnType<typeof researchChartSeries>,Impulse1115ClassificationChartRow[]>();
export function impulse1115ClassificationChartRows(bars:KLineData[],period:number,fetchReference=true,
  item=accountResearchIndicators().find(item=>item.id===IMPULSE_1115_CLASSIFICATION_CHART_ID)!) {
  const series=researchChartSeries(bars,item,period,{fetchReference});
  const cached=cache.get(series);
  if(cached)return cached;
  const rows=bars.map((bar,i):Impulse1115ClassificationChartRow=>{
    const get=(name:string)=>series.components?.[name]?.[i]??undefined;
    const status=IMPULSE_1115_STATUS_CODES[(get('DBL5C_status')??0)-1];
    const reference=get(IMPULSE_1115_DISPLAY_REFERENCE);
    const referenceClass=get(IMPULSE_1115_REFERENCE_CLASS);
    return {time:bar.timestamp,available:get('DBL5C_valid')!==undefined,pending:!!series.pending,
      ...(reference==null?{}:{value:reference}),
      ...(referenceClass===1||referenceClass===2?{referenceClass}:{}),referenceDetectedAt:get(IMPULSE_1115_REFERENCE_DETECTED_AT),
      mainClass:series.core[i]??undefined,state:get('DBL5C_state'),status,frozenLine:get('DBL5C_line'),
      detectedAt:get('DBL5C_detected_at'),tests:get('DBL5C_tests'),pierced:get('DBL5C_pierced')===1,
      changed:get('DBL5C_changed')===1,valid:get('DBL5C_valid')===1};
  });
  cache.set(series,rows);
  return rows;
}
export function classificationChartText(row:Impulse1115ClassificationChartRow|undefined) {
  if(row?.value==null)return '尚无已确认急拉线';
  return row.referenceClass===1?'一类':row.referenceClass===2?'二类':'等待分类确认';
}
export function drawImpulse1115Classification(
  params:Pick<IndicatorDrawParams<Impulse1115ClassificationChartRow>,'ctx'|'visibleRange'|'xAxis'|'yAxis'>,
  rows:readonly Impulse1115ClassificationChartRow[],
) {
  const {ctx,visibleRange,xAxis,yAxis}=params;
  ctx.save();ctx.font='11px sans-serif';ctx.lineWidth=2.2;ctx.setLineDash([]);
  const start=Math.max(0,Math.floor(visibleRange.from)-2),end=Math.min(rows.length,Math.ceil(visibleRange.to)+1);
  for(const mainClass of [1,2] as const){
    ctx.strokeStyle=IMPULSE_1115_CLASS_COLORS[mainClass];ctx.beginPath();let drawn=false;
    for(let i=start;i<end;i++){
      const row=rows[i],previous=rows[i-1],x=xAxis.convertToPixel(i+1);
      const carries=row.available&&row.valid&&previous?.value!=null&&row.time-previous.time===DBL5_STEP;
      // Each interval keeps the class already confirmed at its left endpoint.
      if(carries&&previous.referenceClass===mainClass){const y=yAxis.convertToPixel(previous.value!);ctx.moveTo(xAxis.convertToPixel(i),y);ctx.lineTo(x,y);drawn=true;}
      if(row.value!=null&&row.referenceClass===mainClass&&(!carries||row.value!==previous.value)){
        const y=yAxis.convertToPixel(row.value);ctx.moveTo(x-1,y);ctx.lineTo(x+1,y);drawn=true;
      }
    }
    if(drawn)ctx.stroke();
  }
  for(const [mainClass,x,label] of [[1,8,'一类'],[2,78,'二类']] as const){
    ctx.strokeStyle=IMPULSE_1115_CLASS_COLORS[mainClass];ctx.fillStyle=IMPULSE_1115_CLASS_COLORS[mainClass];
    ctx.beginPath();ctx.moveTo(x,53);ctx.lineTo(x+18,53);ctx.stroke();ctx.fillText(label,x+24,57);
  }
  ctx.restore();
}
export function registerImpulse1115ClassificationChart(item:ResearchIndicator) {
  registerIndicator<Impulse1115ClassificationChartRow>({
    name:researchKcName(item.id),shortName:item.short,calcParams:[3,0,0],precision:12,
    figures:[{key:'value',title:'急拉线: ',type:'line',styles:data=>({color:IMPULSE_1115_CLASS_COLORS[data.current.indicatorData?.referenceClass===2?2:1],size:2.2})}],
    calc:(bars,indicator)=>impulse1115ClassificationChartRows(bars,indicator.calcParams[0],true,item),
    draw:params=>{drawImpulse1115Classification(params,params.indicator.result);return true;},
    createTooltipDataSource:({indicator,crosshair,defaultStyles})=>{
      const row=impulse1115TooltipRow(indicator.result,crosshair?.dataIndex) as Impulse1115ClassificationChartRow|undefined;
      const format=(v:number|undefined)=>v==null?'—':Number(v.toPrecision(12)).toString();
      return {name:item.short,calcParamsText:indicator.result.at(-1)?.pending?' · 正在准备 5m 行情':' · 5m 已收盘',
        icons:defaultStyles.tooltip.icons,values:[
          {title:'分类: ',value:classificationChartText(row)},
          {title:'急拉线: ',value:format(row?.value)},
        ]};
    },
  });
}
