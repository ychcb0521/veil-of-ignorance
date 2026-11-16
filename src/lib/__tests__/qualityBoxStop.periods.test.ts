import { expect, it } from 'vitest';
import { computeDbl5, DBL5_STEP, DBL5_PROFILES, DBL5_VARIANT_TIMEFRAMES, dbl5Step, DBL5_RETEST_GUARD_VERSION } from '@/lib/dbl5m';
import { featureWindowMs } from '@/lib/deepDig/features';
import { advanceChartAtr, type ChartAtrState } from '@/lib/atr';
import { createBoxStopReader, defaultBoxBreak, defaultBoxStop, selectBoxStopTimeframe, validateBoxStop } from '@/lib/fish/qualityBoxStop';
import { holdingVetoDraft, parseHoldingVetoDraft } from '@/lib/fish/qualityFilters';
import { freezeQualityPlan, planVersionChanges } from '@/lib/fish/qualityPlanVersions';
import type { FishReconstructionLoader } from '@/lib/fish/reconstruction';
import type { ResearchBar } from '@/lib/deepRsa/window';
import { T, sample } from './fixtures/dblBars';

const M = 60_000, symbol = 'TESTUSDT';
const row = {id:'s',symbol,timeMs:T,timeLabel:'',fallbackZone:''};
const candle = (openTime:number, open=100, low=99, close=open):ResearchBar => ({
  openTime,open,low,high:Math.max(open,close),close,volume:1,takerBuyVolume:.5,DBL5_tick_size:1,
});
const sampleAt = (step:number) => sample().map(b => ({...b,openTime:T+(b.openTime-T)*step/DBL5_STEP}));
const veto = (boxStop:ReturnType<typeof defaultBoxStop>) => ({
  id:'box',label:'箱体',kind:'box-stop' as const,direction:'<=' as const,threshold:0,enabled:true,boxStop,
});
const signal = new AbortController().signal;

it.each(DBL5_VARIANT_TIMEFRAMES)('preserves bar-by-bar price, regime and freshness results at %s',timeframe=>{
  const H=dbl5Step(timeframe);
  const original = computeDbl5(sample(),{symbol,tickSize:1});
  const hourly = sampleAt(H);
  const config = {timeframe};
  const result = computeDbl5(hourly,{symbol,tickSize:1,config});
  const outputs = (r:typeof result.rows[number])=>[
    r.darvas_5m_lower,r.darvas_5m_upper,r.darvas_5m_event,r.darvas_5m_guard,
    r.darvas_5m_guard_broken,r.darvas_5m_guard_regime,r.darvas_5m_freshness,
  ];
  expect(result.rows.map(outputs)).toEqual(original.rows.map(outputs));
  expect(result.rows.map(r=>r.at)).toEqual(hourly.map(b=>b.openTime+H));
  expect(result.checkpoint).toMatchObject({algorithm_version:DBL5_PROFILES[timeframe].version,timeframe,effective_parameters:{window_minutes:72*H/M,n:3}});
  expect(result.checkpoint.config_hash).not.toBe(original.checkpoint.config_hash);
  expect(()=>computeDbl5(hourly,{symbol,config,checkpoint:original.checkpoint})).toThrow('检查点');
  expect(computeDbl5(hourly,{symbol,config,asOf:T+H-1}).rows).toEqual([]);
  const first = computeDbl5(hourly.slice(0,14),{symbol,tickSize:1,config});
  expect(computeDbl5(hourly.slice(14),{symbol,checkpoint:JSON.parse(JSON.stringify(first.checkpoint))}).rows).toEqual(result.rows.slice(14));
});

it.each(DBL5_VARIANT_TIMEFRAMES)('builds a touch stop from native closed %s guard and ATR, while using minute fills',async timeframe=>{
  const H=dbl5Step(timeframe);
  const legacy=defaultBoxBreak();
  const hardStop={...defaultBoxStop(),structure:{...legacy.structure,buffer:.75}};
  const hourly=selectBoxStopTimeframe(hardStop,timeframe);
  const entry=T+17*H;
  const from=entry-featureWindowMs(hourly.structure.definition);
  const fixtures=new Map(sampleAt(H).map(b=>[b.openTime,b]));
  const readBars=(a:number,b:number)=>Array.from({length:(b-a)/H},(_,i)=>fixtures.get(a+i*H)??candle(a+i*H,100,97));
  const load:FishReconstructionLoader=async(_row,a,b,plan)=>{
    expect(plan.step).toBe(H);
    expect(a%H).toBe(0);
    expect(b).toBeLessThanOrEqual(entry);
    return readBars(a,b);
  };
  const bars=readBars(from,entry);
  const native=computeDbl5(bars,{symbol,tickSize:1,config:hourly.structure.definition.DBL5_config}).rows;
  let atr:ChartAtrState|undefined, expected:number|undefined;
  for(let i=0;i<bars.length;i++){
    atr=advanceChartAtr(atr,bars[i]);
    const point=native[i];
    if(point.at===entry&&point.darvas_5m_guard!=null)expected=point.darvas_5m_guard-.75*atr.value;
  }
  expect(expected).toBeGreaterThan(1);
  const reader=createBoxStopReader({vetoes:[veto(hourly)],row,entry,since:entry,load,signal});
  expect(await reader.read(candle(entry,120,1))).toMatchObject({at:entry,fillPrice:expected,cause:{boxStopEvidence:{confirmedAt:entry}}});
  expect(await reader.read(candle(entry+M,80,75))).toMatchObject({at:entry+M,fillPrice:80,atOpen:true});
  const closeReader=createBoxStopReader({
    vetoes:[veto({...hourly,confirmation:'close-'+timeframe as typeof hourly.confirmation})],
    row,entry,since:entry,load,signal,
  });
  expect(await closeReader.read(candle(entry+5*M- M,90,80))).toBeUndefined();
  expect(await closeReader.read(candle(entry+H-M,90,80))).toMatchObject({at:entry+H,cause:{boxStopEvidence:{confirmation:'close-'+timeframe}}});
});

it.each(DBL5_VARIANT_TIMEFRAMES)('confirms the actual %s red cross only after the candle closes and fills at the next minute open',async timeframe=>{
  const H=dbl5Step(timeframe);
  const rule=selectBoxStopTimeframe(defaultBoxBreak(),timeframe);
  const from=T-featureWindowMs(rule.structure.definition);
  let seed=7,price=10000;
  const random=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648);
  const bars=Array.from({length:700},(_,i)=>{
    const drift=i<200?0:i<500?6:(11800-price)*.02, open=price;
    const close=Math.max(100,Math.round(open+drift+(random()-.5)*60));
    const wick=i>=500&&random()<.08?120:20;
    const high=Math.max(open,close)+Math.round(random()*20);
    const low=Math.max(1,Math.min(open,close)-Math.round(random()*wick));
    price=close;
    return {...candle(from+i*H,open,low,close),high,DBL5_closed:true};
  });
  const expected=computeDbl5(bars,{symbol,tickSize:1,config:rule.structure.definition.DBL5_config})
    .rows.find(r=>r.at>T&&r.darvas_5m_guard_broken);
  expect(expected).toBeDefined();
  const at=expected!.at;
  const load:FishReconstructionLoader=async(_row,a,b,plan)=>{
    expect(plan.step).toBe(H);
    return bars.filter(x=>x.openTime>=a&&x.openTime<b);
  };
  const reader=createBoxStopReader({vetoes:[veto(rule)],row,entry:T,since:T,load,signal});
  expect(await reader.read(candle(at-M,100,1))).toBeUndefined();
  expect(await reader.read(candle(at,83,1))).toMatchObject({
    at,fillPrice:83,atOpen:true,cause:{label:expect.stringContaining(DBL5_PROFILES[timeframe].label),
      boxBreakEvidence:{event: 'darvas_'+timeframe+'_guard_broken',confirmedAt:at,sourceBarOpenTime:at-H}},
  });
});

it.each(DBL5_VARIANT_TIMEFRAMES)('freezes %s structure, guard and close confirmation separately from the old plan',timeframe=>{
  const base=defaultBoxBreak([],DBL5_RETEST_GUARD_VERSION);
  const rule={...defaultBoxStop(),structure:{...base.structure,buffer:.75},confirmation:'close-5m' as const,closes:3};
  const hourly=selectBoxStopTimeframe(rule,timeframe);
  expect(hourly).toMatchObject({confirmation:'close-'+timeframe,closes:3,structure:{
    buffer:.75,versions:{box:DBL5_PROFILES[timeframe].version,guard:'dbl5-'+timeframe+'-guard-retest-v1'},
    definition:{interval:timeframe,DBL5_config:{window_minutes:72*dbl5Step(timeframe)/M,n:3}},
  }});
  expect(selectBoxStopTimeframe(hourly,'5m')).toEqual(rule);
  expect(()=>validateBoxStop({...hourly,confirmation:'close-5m'})).toThrow();
  const [oldSaved,newSaved]=parseHoldingVetoDraft(holdingVetoDraft([veto(rule),veto(hourly)]));
  expect(oldSaved.id).not.toBe(newSaved.id);
  expect(oldSaved.boxStop).toEqual(rule);
  const plan=freezeQualityPlan({id:'p',label:'两周期',metric:'raw',holdingVetoes:[oldSaved,newSaved],snapshot:{
    featureId:'p',definitionKey:'C',statistic:'raw',interval:'5m',scale:1,threshold:0,direction:'<',
    average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:T,
  }});
  const restored=JSON.parse(JSON.stringify(plan)) as typeof plan;
  const definition=restored.holdingVetoes![1].boxStop!.structure.definition;
  definition.DBL5_config=Object.fromEntries(Object.entries(definition.DBL5_config!).reverse());
  expect(planVersionChanges(restored)).toEqual([]);
  expect(plan.frozenVersions?.filter(v=>v.key.startsWith('hard-stop-box')).map(v=>v.name))
    .toEqual([expect.stringContaining('DBL-5-5mins 防守线'),expect.stringContaining(DBL5_PROFILES[timeframe].label+' 防守线')]);
});
