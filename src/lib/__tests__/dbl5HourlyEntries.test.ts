import {expect,it} from 'vitest';
import {DBL5_PROFILES,computeDbl5} from '@/lib/dbl5m';
import {BUILTIN_FEATURES,checkDefinition,definitionKey} from '@/lib/deepDig/features';
import {chartFeatureSeries} from '@/lib/featureSource';
import {createStructureAdditionReader,defaultStructureAddition,selectStructureTimeframe} from '@/lib/fish/qualityAdditionStructure';
import {createNativeGuardReader} from '@/lib/fish/preEntryGuardEvent';
import {guardDistanceConfig} from '@/lib/fish/qualityAdditionVeto';
import {parseAdditionVetoDraft,vetoDraftOf} from '@/lib/fish/qualityEntryVetoDraft';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
import {sample,T} from './fixtures/dblBars';

const M=60_000,H=60*M,FIVE=5*M;
const symbol='NATIVE_HOURLY_TEST';
const profile=DBL5_PROFILES['1h'];
const hourly=sample().map((b,i)=>({...b,openTime:T+i*H}));
const options={symbol,tickSize:1,config:{timeframe:'1h' as const}};
const direct=computeDbl5(hourly,options).rows;
const toChart=(bars:ReturnType<typeof sample>)=>bars.map(({openTime,...b})=>({
  ...b,timestamp:openTime,researchSymbol:symbol,PRS6H_tick_size:1,volume:1,
}));

it('uses actual hourly chart inputs and independent definitions for the box and its three readings',()=>{
  const definitions=BUILTIN_FEATURES.filter(d=>d.chartTemplate===profile.id);
  expect(definitions).toHaveLength(4);
  expect(new Set(definitions.map(d=>definitionKey(d))).size).toBe(4);
  for(const definition of definitions){
    expect(checkDefinition(definition)).toEqual({formula:null,groups:null,scale:null});
    expect(chartFeatureSeries(toChart(sample()),definition.id,undefined)).toBeNull();
  }
  const series=chartFeatureSeries(toChart(hourly),profile.id,undefined);
  expect(series?.core).toEqual(direct.map(r=>r.darvas_5m_lower));
  const last=[...hourly.slice(0,14),{...hourly[14],cba2Closed:false}];
  const chart=toChart(last);
  expect(chartFeatureSeries(chart,profile.id,undefined)?.core.at(-1)).toBeNull();
});

it('uses a closed hourly candle for native addition and an hourly boundary for entry guard events',async()=>{
  const source={id:'hourly',symbol,timeMs:T,timeLabel:'',fallbackZone:''};
  const signal=new AbortController().signal;
  const bars=new Map(hourly.map(b=>[b.openTime,b]));
  const load:FishReconstructionLoader=async(_row,from,to,plan)=>{
    expect(plan.step).toBe(H);
    expect(from%H).toBe(0);
    expect(to%H).toBe(0);
    return Array.from({length:(to-from)/H},(_,i)=>{
      const openTime=from+i*H;
      return bars.get(openTime)??{openTime,open:100,high:101,low:99,close:100,volume:1,takerBuyVolume:.5,DBL5_tick_size:1};
    });
  };
  const rule=selectStructureTimeframe({...defaultStructureAddition(),kSource:'current',trigger:'confirm'},'1h');
  const first=T+8*H;
  const readAddition=createStructureAdditionReader({row:source,entry:T,end:first+M,load,signal});
  expect(await readAddition(rule,T,first,[])).toBeUndefined();
  const addition=await readAddition(rule,T,first+M,[]);
  expect(addition).toMatchObject({at:first,barOpenTime:first-H,featureId:profile.id,structureEvidence:{algorithmVersion:profile.version}});
  expect(addition?.structureEvidence?.nativeAtr).toBeGreaterThan(0);

  const guard=createNativeGuardReader({row:source,start:T,load,signal},rule.definition);
  expect((await guard(first-M)).event).toBeUndefined();
  expect((await guard(first)).event).toMatchObject({at:first,algorithmVersion:profile.version});
  expect((await guard(first+FIVE)).event).toBeUndefined();
});

it('stores both distance vetoes independently and round-trips the frozen parameters',()=>{
  const legacy={kind:'guard-distance' as const,enabled:true,atr:2.1234567,guardDistance:guardDistanceConfig()};
  const hourly={kind:'guard-distance' as const,enabled:true,atr:4.567891,guardDistance:guardDistanceConfig(undefined,undefined,'1h')};
  const saved=[legacy,hourly];
  const draft=vetoDraftOf(JSON.parse(JSON.stringify(saved)));
  expect(draft['guard-distance'].atr).toBe('2.1234567');
  expect(draft['guard-distance-1h']?.atr).toBe('4.567891');
  expect(parseAdditionVetoDraft(draft)).toEqual(saved);
  expect(parseAdditionVetoDraft({...draft,'guard-distance-1h':{...draft['guard-distance-1h']!,enabled:false}})).toEqual([legacy]);
});
