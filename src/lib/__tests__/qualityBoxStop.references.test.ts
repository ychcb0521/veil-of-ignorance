import {it,expect} from 'vitest';
import {featureWindowMs,DBL5_GUARD_PLUS_DEF} from '@/lib/deepDig/features';
import {chartAtr} from '@/lib/atr';
import {impulse5mChartSeries} from '@/lib/impulse5mChart';
import {IMPULSE_5M_VERSION} from '@/lib/impulse5m';
import {Dbl5GuardPlusEngine} from '@/lib/dbl5GuardPlus';
import {createImpulse0StopReference,BOX_STOP_REFERENCE_VERSION,type BoxStopReferenceKind} from '@/lib/fish/qualityBoxReference';
import {createBoxStopReader,defaultBoxStop,selectBoxStopReference,selectBoxStopTimeframe,clearBoxStopReference,validateBoxStop,boxStopIdentity,type BoxStopRule} from '@/lib/fish/qualityBoxStop';
import {structureAdditionK} from '@/lib/fish/qualityAdditionStructure';
import {findCalculatorAdditions} from '@/lib/fish/qualityAdditionCalculator';
import {HOLDING_LEDGER_ADDITION_VERSION} from '@/lib/fish/qualityHoldingLedger';
import {freezeQualityPlan,planVersionChanges} from '@/lib/fish/qualityPlanVersions';
import {holdingVetoDraft,parseHoldingVetoDraft} from '@/lib/fish/qualityFilters';
import {evaluateQualitySample,type QualitySample,type QualityGroup} from '@/lib/fish/quality';
import {createPreEntryGate} from '@/lib/fish/preEntryGate';
import {emptyPreEntryConditions} from '@/lib/fish/preEntryConditions';
import {withTuringInitialization} from '@/lib/fish/qualityInitialization';
import {warm,impulse,bar as plusBar,START,TICK} from './fixtures/dbl5GuardPlusBars';
import type {ResearchBar} from '@/lib/deepRsa/window';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
const M=60000,F=5*M,T=Date.UTC(2026,10,19),signal=new AbortController().signal;
const row={id:'s',symbol:'TESTUSDT',exchange:'binance' as const,timeMs:T,timeLabel:'',fallbackZone:''};
const minute=(at:number,open=112,low=open-.1):ResearchBar=>({openTime:at,open,high:open+.2,low,close:open,volume:500,quoteVolume:1000,takerBuyVolume:250,takerBuyQuoteVolume:500,DBL5_tick_size:'.01'});
const zeroBar=(at:number):ResearchBar=>({...minute(at,110,109.9),high:at===T+4*F?112:at>T+4*F?112.1:110.2,close:at===T+4*F?111.8:at>T+4*F?111.9:110,
 open:at>T+4*F?111.9:110,low:at>T+4*F?111.5:109.9,quoteVolume:at===T+4*F?1800:1000,takerBuyQuoteVolume:at===T+4*F?1150:500});
const zeroLoad=(price=minute):FishReconstructionLoader=>async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>p.step===M?price(a+i*M):zeroBar(a+i*F));
const veto=(rule:BoxStopRule)=>({id:'v',kind:'box-stop' as const,label:'K',enabled:true,direction:'<=' as const,threshold:0,boxStop:rule});
const selected=(kind:BoxStopReferenceKind):BoxStopRule=>{const r=selectBoxStopReference(defaultBoxStop(),kind);return {...r,structure:{...r.structure,buffer:0}};};
const reader=(r:BoxStopRule,load=zeroLoad(),entry=T,since=entry,previous?:Parameters<typeof createBoxStopReader>[0]['previous'],source=row)=>createBoxStopReader({vetoes:[veto(r)],row:source,entry,since,load,signal,previous});
const group=(r:BoxStopRule):QualityGroup=>({id:'g',label:'K',metric:'raw',snapshot:{featureId:'p',definitionKey:'C',statistic:'raw',interval:'5m',scale:1,threshold:0,direction:'<',average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:T},holdingVetoes:[veto(r)],vetoFill:'stop'});
it('matches every valid native impulse-0 chart point, including expiry and line loss',()=>{
 const bars=Array.from({length:330},(_,i)=>zeroBar(T+(i-281)*F));
 const chart=impulse5mChartSeries([...bars,zeroBar(bars.at(-1)!.openTime+F)].map(b=>({timestamp:b.openTime,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume!,turnover:b.quoteVolume!,takerBuyTurnover:b.takerBuyQuoteVolume!})));
 const read=createImpulse0StopReference();
 expect(bars.map(b=>read(b)?.price)).toEqual(chart.slice(1).map(p=>p.value));
 expect(chart.some(p=>p.value===109.9)).toBe(true);
 expect(chart.at(-1)?.value).toBeUndefined();
});
it('cannot use an unconfirmed impulse and follows its actual chart reference before touching K',async()=>{
 const r=reader(selected('impulse0'));
 expect(await r.read(minute(T+24*M,112,1))).toBeUndefined();expect(r.states().v.line).toBeUndefined();
 expect(await r.read(minute(T+25*M))).toBeUndefined();expect(r.states().v.line).toBe(109.9);
 expect(await r.read(minute(T+26*M,108,107))).toMatchObject({at:T+26*M,fillPrice:108,atOpen:true,cause:{boxStopEvidence:{version:BOX_STOP_REFERENCE_VERSION,line:109.9}}});
});
it('uses the same impulse-0 trigger, ATR and tick-floor calculation as the addition engine',async()=>{
 const rule=selected('impulse0');rule.structure.buffer=.25;
 const r=reader(rule);await r.read(minute(T+25*M));
 const end=T+30*M,prices=Array.from({length:30},(_,i)=>minute(T+i*M));
 const result=await findCalculatorAdditions({row,entry:T,entryPrice:100,notional:100,end,since:T,prices,previous:[],candidates:[],repeat:false,maxRounds:1,
  impulsePosition:{version:IMPULSE_5M_VERSION,bufferAtr:.25,skipNative:true},positionVersion:HOLDING_LEDGER_ADDITION_VERSION,load:zeroLoad(),signal});
 expect(result.fills).toHaveLength(1);expect(result.fills[0].at).toBe(T+25*M);
 expect(result.fills[0].sizing!.support).toBe(r.states().v.line);
});
it('retains an established protective K after native reference expiry, and resumes exactly',async()=>{
 const rule=selected('impulse0'),r=reader(rule);await r.read(minute(T+25*M));
 await r.read(minute(T+100*M));expect(r.states().v.line).toBe(109.9);
 const resumed=reader(rule,zeroLoad(),T,T+101*M,JSON.parse(JSON.stringify(r.states())));
 expect(await resumed.read(minute(T+101*M,108,107))).toMatchObject({fillPrice:108});
 const sample:QualitySample={id:'s',enteredAt:T,basis:'signal',importedAt:T,groups:[],source:row},g=group(rule);
 const load=zeroLoad(at=>at===T+27*M?minute(at,108,107):minute(at));
 const whole=await evaluateQualitySample(sample,g,0,T+30*M,load,signal);
 const prior=await evaluateQualitySample(sample,g,0,T+26*M,load,signal);
 expect(await evaluateQualitySample(sample,g,0,T+30*M,load,signal,prior)).toEqual(whole);
 expect(whole).toMatchObject({status:'closed',endTime:T+27*M,endPrice:108});
});
for(const kind of ['impulse1115','guard-plus1115'] as const)it('uses the exact native '+kind+' reference and configurable native buffer',async()=>{
 const rule=selected(kind);if(rule.reference?.kind!=='impulse0')rule.reference!.impulseBufferAtr=.25;
 const entry=START+20*F,source={...row,symbol:'TURING:TURING 1',timeMs:entry};
 const sequence=[...warm(),impulse(),plusBar(21,101.4,102,101.2,101.9)];
 const byTime=new Map(sequence.map(b=>[b.openTime,{...b,quoteVolume:1000,takerBuyQuoteVolume:500} as ResearchBar]));
 const raw:FishReconstructionLoader=async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>p.step===M?minute(a+i*M):byTime.get(a+i*F)??({...minute(a+i*F,102,101.9),high:102.1}));
 const load=withTuringInitialization(raw,source.symbol,START);
 const engine=new Dbl5GuardPlusEngine({symbol:source.symbol,tickSize:TICK,config:rule.structure.definition.DBL5_config,initializationStart:START,initializationId:'box-stop:'+START,impulseBufferAtr:.25});
 const expected=sequence.map(b=>engine.push(b)!);
 expect(expected[20].plus.early_impulse_event).not.toBeNull();
 const base=kind==='impulse1115'?expected[20].plus.impulse_guard_value:expected[20].plus.guard_plus_value;
 expect(base).toBeGreaterThan(0);
 const r=reader(rule,load,entry,entry,undefined,source);
 await r.read(minute(entry+F- M));
 if(kind==='impulse1115')expect(r.states().v.line).toBeUndefined();
 await r.read(minute(entry+F));expect(r.states().v.line).toBe(base);
 const buffered={...rule,structure:{...rule.structure,buffer:.75}},rb=reader(buffered,load,entry,entry,undefined,source);
 await rb.read(minute(entry+F));
 const atr=chartAtr(sequence.slice(0,21)).at(-1)!;
 expect(rb.states().v.line).toBe(structureAdditionK({basePrice:base!,buffer:.75,bufferUnit:'atr',tickSize:TICK},atr)!.k);
 const resumed=reader(rule,load,entry,entry+F+M,r.states(),source);
 expect(await resumed.read(minute(entry+F+M,90,89))).toMatchObject({fillPrice:90});
});
it('applies the selected K in the shared screening gate without a future reference',async()=>{
 const rule=selected('impulse0'),conditions={...emptyPreEntryConditions(),hardVetoes:[veto(rule)]};
 const gate=createPreEntryGate({conditions,start:T,row,load:zeroLoad(at=>at===T+25*M?minute(at,108,107):minute(at)),signal});
 expect((await gate(T+24*M)).pending).toContain('等待有效箱体');
 expect((await gate(T+26*M)).blocked).toBeTruthy();
});
it('freezes each reference and parameter, restores JSONB field order, and never changes an old asset',()=>{
 const original=freezeQualityPlan(group(defaultBoxStop())),before=JSON.stringify(original);
 for(const kind of ['impulse0','impulse1115','guard-plus1115'] as const){
  const rule=selected(kind),frozen=freezeQualityPlan(group(rule));
  expect(planVersionChanges(frozen)).toEqual([]);
  expect(frozen.frozenVersions?.find(v=>v.key==='hard-stop-box-0')?.version).toContain(rule.reference!.version);
  expect(parseHoldingVetoDraft(holdingVetoDraft(frozen.holdingVetoes))[0].boxStop).toEqual(rule);
  const reverse=(x:unknown)=>JSON.parse(JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v));
  expect(planVersionChanges(reverse(frozen))).toEqual([]);
  const entryPlan=freezeQualityPlan({...group(rule),holdingVetoes:undefined,preEntryConditions:{...emptyPreEntryConditions(),hardVetoes:[veto(rule)]}});
  expect(planVersionChanges(reverse(entryPlan))).toEqual([]);
  const changed=structuredClone(frozen);changed.holdingVetoes![0].boxStop!.structure.buffer=.314159265358979;
  expect(planVersionChanges(changed).some(v=>v.key==='hard-stop-box-0')).toBe(true);
  expect(boxStopIdentity(rule)).not.toEqual(boxStopIdentity(defaultBoxStop()));
 }
 expect(JSON.stringify(original)).toBe(before);expect(planVersionChanges(original)).toEqual([]);
 expect(clearBoxStopReference(defaultBoxStop())).toEqual(defaultBoxStop());
});
it('rejects incompatible versions, unsupported periods, invalid native data and unsupported markets',async()=>{
 const rule=selected('impulse0');
 expect(()=>selectBoxStopTimeframe(rule,'1h')).toThrow('原生 5 分钟');
 expect(()=>validateBoxStop({...rule,version:'holding-box-stop-v1'})).toThrow('执行版本不符');
 expect(()=>reader(rule,zeroLoad(),T,T,undefined,{...row,symbol:'TURING:TURING 1'})).toThrow('仅支持币安');
 const missing:FishReconstructionLoader=async(_r,a,b,p)=>(await zeroLoad()(_r,a,b,p,signal)).map(x=>({...x,takerBuyQuoteVolume:null}));
 await expect(reader(rule,missing).read(minute(T+25*M))).rejects.toThrow('不能跳过缺口');
});
