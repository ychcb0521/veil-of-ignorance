import {expect,it} from 'vitest';
import {findCalculatorAdditions} from '../qualityAdditionCalculator';
import {ADDITION_K_TOUCH_VERSION,ADDITION_POSITION_FLOOR_VERSION,ADDITION_POSITION_FLOOR_INTRABAR_VERSION,type QualityAdditionFill,type QualityBreakevenFloorRule} from '../qualityAddition';
import {IMPULSE_1115_CONFIGURABLE_K_VERSION} from '@/lib/dbl5GuardPlus';
import {CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION} from '../qualityClassifiedImpulsePosition';
import {IMPULSE_5M_VERSION} from '@/lib/impulse5m';
const M=60_000,at=Date.UTC(2026,7,7),K=100;
type Options=Parameters<typeof findCalculatorAdditions>[0];
function fixture({floorAtr=0,version=ADDITION_POSITION_FLOOR_INTRABAR_VERSION,algorithmVersion=IMPULSE_1115_CONFIGURABLE_K_VERSION,mainClass}: {
  floorAtr?:number;version?:QualityBreakevenFloorRule['version'];algorithmVersion?:string;mainClass?:1|2;
}={}):Options {
  const originalImpulse=algorithmVersion===IMPULSE_5M_VERSION;
  const fill:QualityAdditionFill={at,price:105,quantity:1,notional:105,scanFrom:at-M,reading:0,threshold:0,direction:'>',metric:'confirmed_support',label:'synthetic impulse fill',barOpenTime:at-5*M,
    structureEvidence:{algorithm:originalImpulse?'impulse5m':'dbl5',trigger:'confirm',event:'IMPULSE_EARLY',eventId:'fixture',boxId:'fixture',episodeId:'fixture',at:at-M,confirmedAt:at-M,
      supportPrice:K,upperPrice:104,nativeInvalidation:null,tickSize:'0.01',algorithmVersion,definitionKey:'fixture',parameters:{mainClass},initializationStart:at-20*M,dataChecksum:'fixture',marketRuleVersion:'fixture',
      kBasis:'support',basePrice:K,bufferUnit:'atr',buffer:0,guardPrice:K,guardRegime:'trend',...(!originalImpulse?{guardCloses:1}:{}),k:K},
    sizing:{support:K-floorAtr,previousSupport:90,atr:1,atrAt:at,coinsBefore:1,realAverageBefore:90,baseCoins:1,mirrorCoins:0,mirrorUsed:0,positionK:K,floorAtr}};
  return {row:{id:'synthetic',symbol:'TESTUSDT',timeMs:at,timeLabel:'',fallbackZone:''},entry:at-10*M,entryPrice:90,notional:100,end:at+10*M,since:at,
    prices:Array.from({length:10},(_,i)=>({openTime:at+i*M,open:103,high:104,low:i===2?99:102,close:103,volume:1,quoteVolume:103,takerBuyVolume:0,takerBuyQuoteVolume:0})),
    previous:[fill],maxRounds:1,mirror:{at:at-5*M,price:95,fraction:.583,atOpen:true,gainPct:5},repeat:true,candidates:[],entryBufferAtr:0,
    breakevenFloor:{enabled:true,atr:floorAtr,version},ordinaryExit:{at:at+2*M,price:98,atOpen:false,mirror:false},load:async()=>[],signal:new AbortController().signal};
}
it.each([
  ['原急拉线1115',IMPULSE_1115_CONFIGURABLE_K_VERSION,undefined],
  ['一类急拉线',CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION,1],
  ['二类急拉线',CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION,2],
] as const)('%s zero ATR floor sells on a wick without a five-minute close',async(_name,algorithmVersion,mainClass)=>{
  const o=fixture({algorithmVersion,mainClass}),result=await findCalculatorAdditions(o);
  expect(result.stop).toMatchObject({at:at+2*M,price:K,atOpen:false,cause:{id:'addition-floor',threshold:K}});
  expect(result.fills).toEqual(o.previous);
});
it('also supports the original impulse-0 touch execution',async()=>{
  expect((await findCalculatorAdditions(fixture({algorithmVersion:IMPULSE_5M_VERSION}))).stop).toMatchObject({at:at+2*M,price:K,atOpen:false});
});
it('keeps positive ATR sizing and the independently triggered F',async()=>{
  const o=fixture({floorAtr:.5}),before=structuredClone(o.previous);
  const result=await findCalculatorAdditions(o);
  expect(result.stop).toMatchObject({at:at+2*M,price:99.5,cause:{id:'addition-floor'}});
  expect(o.previous).toEqual(before);
  expect((await findCalculatorAdditions({...o,breakevenFloor:{enabled:true,atr:.5,version:ADDITION_POSITION_FLOOR_VERSION}})).stop).toEqual(result.stop);
});
it('counts equality as a floor touch',async()=>{
  const o=fixture();o.prices=o.prices.map(b=>b.openTime===at+2*M?{...b,low:K}:b);
  expect((await findCalculatorAdditions(o)).stop).toMatchObject({price:K,atOpen:false,cause:{id:'addition-floor'}});
});
it('fills a gap through F at the actual open',async()=>{
  const o=fixture();o.prices=o.prices.map(b=>b.openTime===at+2*M?{...b,open:97,low:96}:b);
  expect((await findCalculatorAdditions(o)).stop).toMatchObject({at:at+2*M,price:97,atOpen:true,cause:{id:'addition-floor'}});
});
it('resumes with the same frozen K and F',async()=>{
  const o=fixture(),full=await findCalculatorAdditions(o);
  expect(await findCalculatorAdditions({...o,since:at+M,prices:o.prices.filter(b=>b.openTime>=at+M)})).toEqual(full);
});
it('does not touch the floor before the addition exists or when no later bar touches it',async()=>{
  const o=fixture(),before={...o.prices[0],openTime:at-M,low:99};
  o.prices=[before,...o.prices.map(b=>({...b,low:102}))];
  expect((await findCalculatorAdditions(o)).stop).toBeUndefined();
});
it('keeps an earlier ordinary exit and a better exit in the same minute',async()=>{
  const o=fixture();
  expect((await findCalculatorAdditions({...o,ordinaryExit:{at:at+2*M,price:101,atOpen:false,mirror:false}})).stop).toBeUndefined();
  expect((await findCalculatorAdditions({...o,ordinaryExit:{at:at+2*M,price:97,atOpen:true,mirror:false}})).stop).toBeUndefined();
});
it('does not enable the new floor when it is disabled',async()=>{
  const o=fixture();o.breakevenFloor={...o.breakevenFloor!,enabled:false};
  expect((await findCalculatorAdditions(o)).stop).toBeUndefined();
});
it('preserves v2 zero ATR close confirmation and explicit K-touch behavior',async()=>{
  const o=fixture({version:ADDITION_POSITION_FLOOR_VERSION});
  expect((await findCalculatorAdditions(o)).stop).toBeUndefined();
  expect((await findCalculatorAdditions({...o,kStopVersion:ADDITION_K_TOUCH_VERSION})).stop).toMatchObject({price:K,atOpen:false});
});
it('preserves the original guard-only floor execution',async()=>{
  const o=fixture();o.breakevenFloor={enabled:true,atr:0};
  const fill=o.previous[0];o.previous=[{...fill,sizing:{...fill.sizing!,positionK:undefined,guardK:K}}];
  expect((await findCalculatorAdditions(o)).stop).toMatchObject({price:K,cause:{id:'addition-floor'}});
});
