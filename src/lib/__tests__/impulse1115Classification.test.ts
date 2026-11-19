import {describe,expect,it} from 'vitest';
import {DBL5_STEP,type Dbl5Bar} from '../dbl5m';
import {Dbl5GuardPlusEngine,type Dbl5GuardPlusRow,type GuardPlusImpulse} from '../dbl5GuardPlus';
import {
  Impulse1115ClassificationEngine,impulse1115ClassificationParams,impulse1115ClassificationText,
  impulse1115MainClass,type Impulse1115ClassificationParams,
} from '../impulse1115Classification';
import {compileFeatureFormula,evaluateOnBars,IMPULSE_1115_CLASSIFICATION_DEF,DBL5_GUARD_PLUS_DEF,definitionKey,checkDefinition} from '../deepDig/features';
import {compileFishProgram,evaluateFishProgram} from '../fish/algorithm';
import {bar,impulse,warm,START,TICK} from './fixtures/dbl5GuardPlusBars';

import {c,classificationExamples} from './fixtures/impulse1115ClassificationBars';
const event=(id='line-a',at=START+DBL5_STEP):GuardPlusImpulse=>({
  impulse_id:id,phase_id:'phase',start_time:START,detected_at:at,available_at:at,
  impulse_guard_value:100,impulse_origin_low:100.5,frozen_atr:1,
} as GuardPlusImpulse);
const source=(at:number,early:GuardPlusImpulse|null=null):Dbl5GuardPlusRow=>({
  at,available_at:at,early_impulse_event:early,impulse_guard_value:100,reason:null,
} as Dbl5GuardPlusRow);
function run(input:readonly ReturnType<typeof c>[],params?:Partial<Impulse1115ClassificationParams>){
  const engine=new Impulse1115ClassificationEngine({params});
  const seed={...bar(0,103,104,101,103)};
  const rows=[engine.push(seed,source(seed.openTime+DBL5_STEP,event()),TICK)!];
  input.forEach((b,i)=>{
    const candle={...bar(i+1,b.open,b.high,b.low,b.close)};
    rows.push(engine.push(candle,source(candle.openTime+DBL5_STEP),TICK)!);
  });
  return {engine,rows,last:rows.at(-1)!.current!};
}

describe('六段走势逐根分类（固定线100、冻结ATR1）',()=>{
  for(const example of classificationExamples)it(example.name,()=>{
    const {last}=run(example.bars);
    expect(last).toMatchObject({case:example.value,mainClass:example.mainClass});
    expect(impulse1115MainClass(example.value)).toBe(example.mainClass);
    expect(impulse1115ClassificationText(last)).toContain(example.mainClass===1?'一类｜':'二类｜');
    // Every prefix has exactly the same earlier output; there is no backfill from a later confirmation.
    const complete=run(example.bars).rows;
    for(let i=0;i<=example.bars.length;i++)expect(run(example.bars.slice(0,i)).rows).toEqual(complete.slice(0,i+1));
  });
  it('触线、初次反弹、局部高点刚确认均不提前标为第2种',()=>{
    const rows=run(classificationExamples[1].bars).rows;
    expect(rows[0].current).toMatchObject({case:1,status:'UNTESTED',tests:0});
    expect(rows[1].current).toMatchObject({case:null,status:'FIRST_TEST'});
    expect(rows[2].current?.case).toBeNull();
    expect(rows[3].current?.case).toBeNull();
    expect(rows[4].current).toMatchObject({case:2,status:'HELD',at:rows[4].at});
  });
  it('连续贴线只算一次测试；三次独立反弹递减才确认第3种',()=>{
    const adjacent=run([c(101,100.1,100.2),c(100.8,100.2,100.4),c(100.7,100.1,100.3)]);
    expect(adjacent.last).toMatchObject({tests:1,case:null});
    const result=run(classificationExamples[2].bars);
    expect(result.rows.slice(0,-1).some(r=>r.current?.case===3)).toBe(false);
    expect(result.last.testHistory.map(t=>t.peak)).toEqual([104,103,102]);
    expect(result.last).toMatchObject({tests:3,case:3});
  });
  it('影线刺穿和隔一根快速收回都归第4种，刺穿记录不会被后续线上回踩抹去',()=>{
    const wick=run([c(101,99.9,100.8)]);
    expect(wick.last).toMatchObject({case:4,status:'QUICK_RECLAIM'});
    const held=run([...classificationExamples[3].bars,...classificationExamples[1].bars]);
    expect(held.last.case).toBe(4);
    expect(held.last.mainClass).toBe(2);
    expect(held.last.piercedAt).not.toBeNull();
  });
  it('有效跌破先等待反抽，反抽发生后仍等待重新下行才确认第5种',()=>{
    const rows=run(classificationExamples[4].bars).rows;
    expect(rows[2].current).toMatchObject({case:null,status:'BROKEN',mainClass:2});
    expect(rows[3].current).toMatchObject({case:null,status:'BELOW_RETEST'});
    expect(rows[4].current).toMatchObject({case:5,status:'FAILED_RETEST'});
  });
  it('收复、独立离开、再次回踩依次完成才确认第6种，持续在线上不能代替回踩',()=>{
    const rows=run(classificationExamples[5].bars).rows;
    expect(rows[3].current).toMatchObject({case:null,status:'RECLAIMED'});
    expect(rows[4].current?.case).toBeNull();
    expect(rows[5].current).toMatchObject({case:6,status:'REPAIRED',mainClass:2});
    expect(rows[5].current?.brokenAt).toBe(rows[2].at);
    expect(run([...classificationExamples[5].bars.slice(0,4),c(104,102,103)]).last.case).toBeNull();
  });
});

it('新线从尚未受测独立开始，旧线继续分类并保留早先输出与历史',()=>{
  const {engine,rows}=run(classificationExamples[3].bars);
  const frozen=structuredClone(rows);
  const b=bar(3,103,104,101,103),at=b.openTime+DBL5_STEP;
  const row=engine.push(b,source(at,event('line-b',at)),TICK)!;
  expect(row.lines).toHaveLength(2);
  expect(row.current).toMatchObject({lineId:'line-b',case:1,piercedAt:null,tests:0});
  expect(row.lines[0]).toMatchObject({lineId:'line-a',case:4});
  expect(rows).toEqual(frozen);
});

it('持续走高而分类未变时复用冻结证据，避免为每条旧线逐根保留新副本',()=>{
  const {engine,rows}=run(classificationExamples[1].bars);
  const before=rows.at(-1)!;
  for(let i=5;i<105;i++){
    const b=bar(i,102+i,103+i,101+i,102+i),at=b.openTime+DBL5_STEP;
    const row=engine.push(b,source(at),TICK)!;
    expect(row.current).toBe(before.current);
    expect(row.lines).toBe(before.lines);
  }
});

it('所有暂停切点恢复与连续结果一致，重复输入幂等；不同参数或身份拒绝恢复',()=>{
  const bars=classificationExamples[5].bars;
  for(let split=0;split<=bars.length;split++){
    const head=run(bars.slice(0,split));
    const resumed=new Impulse1115ClassificationEngine({checkpoint:JSON.parse(JSON.stringify(head.engine.checkpoint()))});
    bars.slice(split).forEach((b,i)=>{
      const candle=bar(split+i+1,b.open,b.high,b.low,b.close),s=source(candle.openTime+DBL5_STEP);
      const row=resumed.push(candle,s,TICK);
      expect(resumed.push(candle,s,TICK)).toEqual(row);
    });
    expect(resumed.lines()).toEqual(run(bars).engine.lines());
  }
  const cp=run([]).engine.checkpoint();
  expect(()=>new Impulse1115ClassificationEngine({checkpoint:cp,params:{breakCloses:3}})).toThrow();
  expect(()=>new Impulse1115ClassificationEngine({checkpoint:cp,identity:'different-account'})).toThrow();
});

it('未收盘不生效，缺口不跨越推断收回，修订和倒序输入须重放',()=>{
  const {engine}=run([c(100.4,99.5,99.8)]);
  const gap=bar(3,101,101.5,100.1,101.2),s=source(gap.openTime+DBL5_STEP);
  expect(engine.push({...gap,DBL5_closed:false},s,TICK)).toBeNull();
  const row=engine.push(gap,s,TICK)!;
  expect(row.current).toMatchObject({available:false,status:'DATA_GAP',case:null});
  const later=bar(4,103,104,101,103);
  expect(engine.push(later,source(later.openTime+DBL5_STEP),TICK)?.current?.available).toBe(false);
  expect(()=>engine.push({...later,volume:999},source(later.openTime+DBL5_STEP),TICK)).toThrow('修订');
  expect(()=>engine.push(gap,s,TICK)).toThrow('顺序');
});

it('所有新增阈值可配置，非法值被拦截，参数只改变新定义身份',()=>{
  expect(impulse1115ClassificationParams()).toMatchObject({nearAtr:.5,departureAtr:1,breakCloses:2,reclaimCloses:1,quickReclaimBars:2,pivotBars:1,weakeningTests:3});
  for(const p of [{nearAtr:NaN},{pivotBars:0},{breakCloses:1.5},{departureAtr:.5},{weakeningTests:1}])expect(()=>impulse1115ClassificationParams(p)).toThrow();
  expect(run(classificationExamples[3].bars,{quickReclaimBars:0}).last.case).toBeNull();
  const changed={...IMPULSE_1115_CLASSIFICATION_DEF,DBL5C_parameters:{breakCloses:3}};
  expect(definitionKey(changed)).not.toBe(definitionKey(IMPULSE_1115_CLASSIFICATION_DEF));
  expect(checkDefinition(changed).formula).toBeNull();
  expect(checkDefinition({...changed,DBL5C_parameters:{breakCloses:0}}).formula).not.toBeNull();
  expect(DBL5_GUARD_PLUS_DEF).not.toHaveProperty('DBL5C_parameters');
});

it('原生识别输出不变；分类使用同一原生事件和价格，跌破断线后仍观察冻结线',()=>{
  const bars=[...warm(),impulse(),bar(21,101.4,101.7,99.3,100.6),bar(22,100.6,100.7,98.5,98.6),bar(23,98.6,100,98.5,99.8)];
  const input={...IMPULSE_1115_CLASSIFICATION_DEF,DBL5_symbol:'TESTUSDT',DBL5_tick_size:TICK};
  const result=evaluateOnBars(bars,compileFeatureFormula(input.formula),input);
  const old=evaluateOnBars(bars,compileFeatureFormula(DBL5_GUARD_PLUS_DEF.formula),{...DBL5_GUARD_PLUS_DEF,DBL5_symbol:'TESTUSDT',DBL5_tick_size:TICK});
  expect(result.DBL5P_details).toEqual(old.DBL5P_details);
  expect(result.DBL5_checkpoint).toEqual(old.DBL5_checkpoint);
  expect(result.DBL5C_details?.[20].current?.price).toBe(result.DBL5P_details?.[20].early_impulse_event?.impulse_guard_value);
  expect(result.DBL5P_details?.[22].impulse_guard_value).toBeNull();
  expect(result.DBL5C_details?.[23].current?.price).toBe(result.DBL5C_details?.[20].current?.price);
  const cp=result.DBL5C_checkpoint!;
  for(const split of [20,21,22]){
    const head=evaluateOnBars(bars.slice(0,split),compileFeatureFormula(input.formula),input);
    const tail=evaluateOnBars(bars.slice(split),compileFeatureFormula(input.formula),{...input,DBL5P_checkpoint:head.DBL5P_checkpoint,DBL5C_checkpoint:head.DBL5C_checkpoint});
    expect(tail.DBL5C_checkpoint).toEqual(cp);
  }
});

it('持仓检测读取主分类、细分及原生历史证据，不引入任何交易动作',()=>{
  const bars=[...warm(),impulse()];
  const def=IMPULSE_1115_CLASSIFICATION_DEF;
  const plan=compileFishProgram(def,{statistic:'DBL5C',direction:'>',threshold:0,constraints:[]});
  const result=evaluateFishProgram(bars,plan);
  expect(result.value.at(-1)).toBe(1);
  expect(result.DBL5C_details?.at(-1)?.current).toMatchObject({case:1,mainClass:1});
});
