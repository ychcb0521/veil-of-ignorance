import {registerIndicator,type IndicatorDrawParams,type KLineData} from 'klinecharts';
import {DBL5_STEP} from './dbl5m';
import {
  IMPULSE_1115_CLASSIFICATION_CHART_ID,IMPULSE_1115_CLASSIFICATION_FIELDS,IMPULSE_1115_STATUS,
  IMPULSE_1115_STATUS_CODES,type Impulse1115Status,
} from './impulse1115Classification';
import {drawImpulse1115Reference,impulse1115TooltipRow,type Impulse1115ChartRow} from './impulse1115Chart';
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
    const reference=get('DBL5C_reference');
    return {time:bar.timestamp,available:get('DBL5C_valid')!==undefined,pending:!!series.pending,
      ...(reference==null?{}:{value:reference}),
      mainClass:series.core[i]??undefined,state:get('DBL5C_state'),status,frozenLine:get('DBL5C_line'),
      detectedAt:get('DBL5C_detected_at'),tests:get('DBL5C_tests'),pierced:get('DBL5C_pierced')===1,
      changed:get('DBL5C_changed')===1,valid:get('DBL5C_valid')===1};
  });
  cache.set(series,rows);
  return rows;
}
export function classificationChartText(row:Impulse1115ClassificationChartRow|undefined) {
  if(!row?.status)return '尚无已确认急拉线';
  if(!row.valid)return IMPULSE_1115_STATUS[row.status];
  return (row.mainClass===1?'一类｜':'二类｜')+IMPULSE_1115_STATUS[row.status];
}
export function drawImpulse1115Classification(
  params:Pick<IndicatorDrawParams<Impulse1115ClassificationChartRow>,'ctx'|'visibleRange'|'xAxis'|'yAxis'>,
  rows:readonly Impulse1115ClassificationChartRow[],
) {
  drawImpulse1115Reference(params,rows);
  const {ctx,visibleRange,xAxis,yAxis}=params;
  ctx.save();ctx.font='11px sans-serif';
  const start=Math.max(0,Math.floor(visibleRange.from)),end=Math.min(rows.length,Math.ceil(visibleRange.to));
  for(let i=start;i<end;i++){
    const row=rows[i];
    if(!row.changed||!row.valid||row.frozenLine==null)continue;
    const x=xAxis.convertToPixel(i+1),y=yAxis.convertToPixel(row.frozenLine);
    ctx.fillStyle=row.mainClass===1?'#14b8a6':'#f59e0b';
    ctx.beginPath();ctx.arc(x,y,3,0,2*Math.PI);ctx.fill();
  }
  // One current readout; all historical statuses remain inspectable with the crosshair.
  const latest=impulse1115TooltipRow(rows) as Impulse1115ClassificationChartRow|undefined;
  ctx.fillStyle=latest?.mainClass===1?'#14b8a6':'#f59e0b';
  ctx.fillText(classificationChartText(latest),8,57);
  ctx.restore();
}
export function registerImpulse1115ClassificationChart(item:ResearchIndicator) {
  registerIndicator<Impulse1115ClassificationChartRow>({
    name:researchKcName(item.id),shortName:item.short,calcParams:[3,0,0],precision:12,
    figures:[{key:'value',title:'原生急拉参考: ',type:'line',styles:()=>({color:'#a21caf',size:2})}],
    calc:(bars,indicator)=>impulse1115ClassificationChartRows(bars,indicator.calcParams[0],true,item),
    draw:params=>{drawImpulse1115Classification(params,params.indicator.result);return true;},
    createTooltipDataSource:({indicator,crosshair,defaultStyles})=>{
      const row=impulse1115TooltipRow(indicator.result,crosshair?.dataIndex) as Impulse1115ClassificationChartRow|undefined;
      const format=(v:number|undefined)=>v==null?'—':Number(v.toPrecision(12)).toString();
      return {name:item.short,calcParamsText:indicator.result.at(-1)?.pending?' · 正在准备 5m 行情':' · 5m 已收盘',
        icons:defaultStyles.tooltip.icons,values:[
          {title:'持仓状态: ',value:classificationChartText(row)},
          {title:'冻结急拉线: ',value:format(row?.frozenLine)},
          {title:'原生当前参考: ',value:format(row?.value)},
          {title:'反弹观察过程: ',value:row?.tests==null?'—':String(row.tests)},
          {title:'曾经刺穿: ',value:row?.status?(row.pierced?'是':'否'):'—'},
          {title:'状态证据: ',value:row?.valid?'仅截至该根已收盘K线':'等待连续已收盘证据'},
        ]};
    },
  });
}
