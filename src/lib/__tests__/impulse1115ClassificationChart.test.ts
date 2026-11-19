import {expect,it,vi} from 'vitest';
import {registerIndicator} from 'klinecharts';
import {Dbl5GuardPlusEngine} from '../dbl5GuardPlus';
import {classificationChartText,impulse1115ClassificationChartRows,registerImpulse1115ClassificationChart} from '../impulse1115ClassificationChart';
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
  expect(classificationChartText(last)).toContain(example.name);
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
