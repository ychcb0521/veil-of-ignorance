import {expect,it,vi} from 'vitest';
import {registerIndicator} from 'klinecharts';
import {Dbl5GuardPlusEngine} from '../dbl5GuardPlus';
import {classificationChartText,drawImpulse1115Classification,impulse1115ClassificationChartRows,registerImpulse1115ClassificationChart} from '../impulse1115ClassificationChart';
import {IMPULSE_1115_CLASS_COLORS,IMPULSE_1115_CLASSIFICATION_RENDER_FIELDS,IMPULSE_1115_REFERENCE_CLASS,IMPULSE_1115_DISPLAY_REFERENCE,impulse1115ReferenceDisplayVars,classifiedImpulseReplacesReference} from '../impulse1115ClassificationDisplay';
import {IMPULSE_1115_CLASSIFICATION_CHART_ID,IMPULSE_1115_CLASSIFICATION_VERSION} from '../impulse1115Classification';
import {accountResearchIndicators,IMPULSE_1115_CLASSIFICATION_CHART,researchKcName,supportsDbl5GuardVersion} from '../researchIndicators';
import {IMPULSE_1115_CLASSIFICATION_DEF,definitionKey,copyFeatureDefinition} from '../deepDig/features';
import {qualityDefinition} from '../fish/quality';
import {classificationExamples} from './fixtures/impulse1115ClassificationBars';
import {bar,impulse,warm,TICK} from './fixtures/dbl5GuardPlusBars';
vi.mock('klinecharts',async original=>({...await original<typeof import('klinecharts')>(),registerIndicator:vi.fn()}));

for(const example of classificationExamples)it('真实原生急拉→分类图表：'+example.name,()=>{
  const native=new Dbl5GuardPlusEngine({symbol:'TESTUSDT',tickSize:TICK});
  const initial=[...warm(),impulse()];
  const early=initial.map(b=>native.push(b)).at(-1)!.plus.early_impulse_event!;
  const convert=(x:number)=>Math.round((early.impulse_guard_value+(x-100)*early.frozen_atr)*100)/100;
  const tail=example.bars.map((b,i)=>bar(i+21,convert(b.open),convert(b.high),convert(b.low),convert(b.close)));
  const data=[...initial,...tail].map(b=>({...b,timestamp:b.openTime,researchSymbol:'TESTUSDT',PRS6H_tick_size:TICK,cba2Closed:true}));
  const rows=impulse1115ClassificationChartRows(data,3,false),last=rows.at(-1)!;
  expect(last).toMatchObject({mainClass:example.mainClass,state:example.value,valid:true});
  expect(classificationChartText(last)).toBe(example.mainClass===1?'一类':'二类');
  expect(rows.slice(0,20).every(row=>row.state==null)).toBe(true);
  registerImpulse1115ClassificationChart(IMPULSE_1115_CLASSIFICATION_CHART);
  const spec=vi.mocked(registerIndicator).mock.calls.at(-1)![0] as any;
  const tooltip=spec.createTooltipDataSource({indicator:{result:rows},defaultStyles:{tooltip:{icons:[]}}});
  expect(tooltip.values[0].value).toBe(classificationChartText(last));
  // Crosshair on the formation candle cannot read its eventual close early.
  const prior=spec.createTooltipDataSource({indicator:{result:rows},crosshair:{dataIndex:20},defaultStyles:{tooltip:{icons:[]}}});
  expect(prior.values[0].value).toBe('尚无已确认急拉线');
});

it('分类图表独立注册且没有防守线版本切换；更改参数不影响旧定义，副本冻结自己的参数',()=>{
  const items=accountResearchIndicators();
  expect(items.filter(i=>i.id===IMPULSE_1115_CLASSIFICATION_CHART_ID)).toHaveLength(1);
  expect(supportsDbl5GuardVersion(items.find(i=>i.id===IMPULSE_1115_CLASSIFICATION_CHART_ID))).toBe(false);
  const frozen={...IMPULSE_1115_CLASSIFICATION_DEF,DBL5C_parameters:{breakCloses:3,quickReclaimBars:1}};
  const saved=JSON.parse(JSON.stringify({featureId:frozen.id,definitionKey:definitionKey(frozen),scale:1,interval:'5m'}));
  expect(qualityDefinition(saved).DBL5C_parameters).toMatchObject({breakCloses:3,quickReclaimBars:1});
  expect(definitionKey(qualityDefinition(saved))).toBe(definitionKey(frozen));
  const copy=copyFeatureDefinition(frozen,[frozen],1000);
  expect(copy.DBL5C_parameters).toEqual(frozen.DBL5C_parameters);
  expect(copy.DBL5C_parameters).not.toBe(frozen.DBL5C_parameters);
  expect(frozen.id).toBe(IMPULSE_1115_CLASSIFICATION_VERSION);
});
it('在原线价上直接画两色线段，无圆点，分类在确认后才改变颜色',()=>{
 const strokes:{color:string;points:number[][]}[]=[],texts:string[]=[];let path:number[][]=[];
 const ctx={strokeStyle:'',fillStyle:'',lineWidth:0,font:'',save:vi.fn(),restore:vi.fn(),setLineDash:vi.fn(),beginPath:()=>{path=[];},moveTo:(x:number,y:number)=>path.push([x,y]),lineTo:(x:number,y:number)=>path.push([x,y]),stroke:()=>strokes.push({color:ctx.strokeStyle,points:path.slice()}),fillText:(s:string)=>texts.push(s),arc:vi.fn(),fill:vi.fn()};
 const rows=[1,1,2,2].map((mainClass,i)=>({time:(i+1)*300000,available:true,pending:false,valid:true,value:100,referenceClass:mainClass as 1|2}));
 drawImpulse1115Classification({ctx,visibleRange:{from:0,to:4},xAxis:{convertToPixel:(i:number)=>i*10},yAxis:{convertToPixel:(p:number)=>p}} as never,rows);
 const blue=strokes.find(s=>s.color===IMPULSE_1115_CLASS_COLORS[1]&&s.points.some(p=>p[1]===100))!,orange=strokes.find(s=>s.color===IMPULSE_1115_CLASS_COLORS[2]&&s.points.some(p=>p[1]===100))!;
 expect(blue.points).toContainEqual([30,100]);expect(orange.points).toEqual([[30,100],[40,100]]);
 expect(ctx.arc).not.toHaveBeenCalled();expect(ctx.fill).not.toHaveBeenCalled();expect(texts).toEqual([]);
});
it('重叠原线按身份匹配分类，断裂后在原冻结价呈现分类，缺口停止绘制',()=>{
 const a={lineId:'a',detectedAt:300000,price:100,mainClass:1,available:true},b={lineId:'b',detectedAt:600000,price:100,mainClass:2,available:true};
 const output={DBL5C_details:[{at:300000,current:b,lines:[a,b]},{at:600000,current:b,lines:[a,b]},{at:900000,current:{...b,available:false},lines:[]}],DBL5P_details:[{at:300000,impulse_guard_value:100,active_impulse:{impulse_id:'a'}},{at:600000,impulse_guard_value:null,active_impulse:null},{at:900000,impulse_guard_value:null,active_impulse:null}]};
 const result=impulse1115ReferenceDisplayVars([{openTime:0},{openTime:300000},{openTime:600000}],output as never,IMPULSE_1115_CLASSIFICATION_RENDER_FIELDS);
 expect(Array.from(result.get(IMPULSE_1115_REFERENCE_CLASS)!)).toEqual([1,2,NaN]);expect(Array.from(result.get(IMPULSE_1115_DISPLAY_REFERENCE)!)).toEqual([100,100,NaN]);
});
it('分类模式接管原紫线显示，关闭后恢复；各图独立且不改写选择',()=>{
 const catalog=[{id:'plain',core:'DBL5P_impulse'},{id:'classes',core:'DBL5C'},{id:'copy',core:'DBL5C'},{id:'guard',core:'DBL5P_base'}],selected=[{type:'plain',enabled:true},{type:'classes',enabled:true}],before=JSON.stringify(selected);
 expect(classifiedImpulseReplacesReference('plain',selected,catalog)).toBe(true);expect(classifiedImpulseReplacesReference('guard',selected,catalog)).toBe(false);expect(classifiedImpulseReplacesReference('plain',[selected[0]],catalog)).toBe(false);expect(classifiedImpulseReplacesReference('plain',[selected[0],{type:'copy',enabled:true}],catalog)).toBe(true);expect(JSON.stringify(selected)).toBe(before);
});
