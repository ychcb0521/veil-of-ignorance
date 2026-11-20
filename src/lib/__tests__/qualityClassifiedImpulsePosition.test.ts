import {defaultStructureAddition} from '@/lib/fish/qualityAdditionStructure';
import {it,expect} from 'vitest';
import {defaultClassifiedImpulsePosition,createClassifiedImpulsePositionReader,CLASSIFIED_IMPULSE_POSITION_VERSION,CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION,CLASSIFIED_IMPULSE_ORIGIN_K_POSITION_VERSION,validateClassifiedImpulsePositions} from '@/lib/fish/qualityClassifiedImpulsePosition';
import {Dbl5GuardPlusEngine,IMPULSE_1115_CONFIGURABLE_K_VERSION} from '@/lib/dbl5GuardPlus';
import {withTuringInitialization} from '@/lib/fish/qualityInitialization';
import {findCalculatorAdditions} from '@/lib/fish/qualityAdditionCalculator';
import {HOLDING_LEDGER_ADDITION_VERSION} from '@/lib/fish/qualityHoldingLedger';
import {ADDITION_K_TOUCH_VERSION,additionIdentity,validateQualityAddition,type QualityAdditionRule,type QualityAdditionFill} from '@/lib/fish/qualityAddition';
import {freezeQualityPlan,planVersionChanges} from '@/lib/fish/qualityPlanVersions';
import {makeQualitySellPlan} from '@/lib/fish/qualitySellPlans';
import {BUILTIN_FEATURES,definitionKey} from '@/lib/deepDig/features';
import {compileFishProgram} from '@/lib/fish/algorithm';
import {usdtFollowCampaigns,currentUsdtFollowCampaign} from '@/lib/fish/usdtFollow';
import {INSTANT_TEMPLATE_MONITOR} from '@/lib/fish/instantMonitorSettings';
import {raceSharedAddition} from '@/lib/fish/qualityPlanRouter';
import {warm,impulse,bar,START,TICK} from './fixtures/dbl5GuardPlusBars';
import type {ResearchBar} from '@/lib/deepRsa/window';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
const M=60000,F=5*M,entry=START+20*F,signal=new AbortController().signal,row={id:'s',symbol:'TURING:TURING 1',timeMs:entry,timeLabel:'',fallbackZone:''};
const seed=[...warm(),impulse()],engine=new Dbl5GuardPlusEngine({symbol:row.symbol,tickSize:TICK,initializationStart:START,initializationId:'native-example'}),points=seed.map(b=>engine.push(b)!);
const native=points.at(-1)!.plus.early_impulse_event!,line=native.impulse_guard_value,atr=native.frozen_atr;
const round=(x:number)=>Math.round(x*100)/100;
const future=[bar(21,round(line+2*atr),round(line+3*atr),round(line-atr),round(line+2*atr)),...Array.from({length:10},(_,i)=>bar(22+i,round(line+2*atr),round(line+3*atr),round(line+atr),round(line+2*atr)))];
const nativeBars=new Map([...seed,...future].map(b=>[b.openTime,{...b,quoteVolume:1000,takerBuyQuoteVolume:500} as ResearchBar]));
const price=(t:number):ResearchBar=>({openTime:t,open:112,high:112.2,low:111.9,close:112,volume:100,quoteVolume:1000,takerBuyVolume:50,takerBuyQuoteVolume:500,DBL5_tick_size:TICK});
const raw:FishReconstructionLoader=async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>p.step===M?price(a+i*M):nativeBars.get(a+i*p.step)??({...price(a+i*p.step),open:102,high:102.1,low:101.9,close:102}));
const load=withTuringInitialization(raw,row.symbol,START);
const position=(mainClass:1|2)=>({...defaultClassifiedImpulsePosition(mainClass,[],CLASSIFIED_IMPULSE_POSITION_VERSION),skipNative:true as const});
const options=()=>({row,entry,entryPrice:80,notional:100,end:entry+15*M,since:entry,prices:Array.from({length:15},(_,i)=>price(entry+i*M)),previous:[] as QualityAdditionFill[],repeat:false,maxRounds:1,candidates:[],positionVersion:HOLDING_LEDGER_ADDITION_VERSION,load,signal});
it('直接复用原生急拉和分类证据，一类形成与二类快速收回各从确认根开始',async()=>{
 const read=createClassifiedImpulsePositionReader({row,entry,load,signal});
 expect(await read(position(1),entry,entry+F,[])).toBeUndefined();
 const first=await read(position(1),entry,entry+F+M,[]);expect(first).toMatchObject({at:entry+F,structureEvidence:{algorithmVersion:CLASSIFIED_IMPULSE_POSITION_VERSION,impulseClassification:{mainClass:1,case:1,status:'UNTESTED',linePrice:line}}});
 expect(await read(position(2),entry,entry+2*F,[])).toBeUndefined();
 const second=await read(position(2),entry,entry+2*F+M,[]);expect(second).toMatchObject({at:entry+2*F,structureEvidence:{nativeAtr:atr,impulseClassification:{mainClass:2,case:4,status:'QUICK_RECLAIM',lineId:first!.structureEvidence!.impulseClassification!.lineId}}});
 expect(await read(position(2),second!.at,entry+5*F,[])).toBeUndefined();
});
it('预热已经形成的状态不补机会；已成交事件、过期实盘事件不重放',async()=>{
 const p=position(1),read=createClassifiedImpulsePositionReader({row,entry,load,signal}),hit=await read(p,entry,entry+2*F,[]);
 const used=[{...hit!,quantity:1,notional:112}];expect(await read(p,entry,entry+2*F,used)).toBeUndefined();
 const warmed=createClassifiedImpulsePositionReader({row,entry:entry+F,load,signal});expect(await warmed(p,entry+F,entry+3*F,[])).toBeUndefined();
 expect(await createClassifiedImpulsePositionReader({row,entry,load,signal,liveAt:entry+2*F})(p,entry,entry+3*F,[])).toBeUndefined();
});
it('历史前缀与完整回放的较早机会相同，参数快照不随未来状态修订',async()=>{
 const p=position(1),a=createClassifiedImpulsePositionReader({row,entry,load,signal}),b=createClassifiedImpulsePositionReader({row,entry,load,signal});
 expect(await a(p,entry,entry+F+M,[])).toEqual(await b(p,entry,entry+6*F,[]));
});
it('JSONB 字段重排仍产生同一原生线、分类事件和动作身份',async()=>{
 const p=position(1);p.definition.DBL5_config={n:3,window_minutes:360};
 const reordered=JSON.parse(JSON.stringify(p,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v));
 const a=createClassifiedImpulsePositionReader({row,entry,load,signal}),b=createClassifiedImpulsePositionReader({row,entry,load,signal});
 expect(await a(p,entry,entry+2*F,[])).toEqual(await b(reordered,entry,entry+2*F,[]));
});
it.each([1,2] as const)('第 %s 类进入原计算器定量及 K，暂停续算一致',async mainClass=>{
 const opts={...options(),classifiedImpulsePositions:[position(mainClass)]},whole=await findCalculatorAdditions(opts);
 expect(whole.fills).toHaveLength(1);expect(whole.fills[0]).toMatchObject({at:entry+mainClass*F,structureEvidence:{impulseClassification:{mainClass}},positionVersion:HOLDING_LEDGER_ADDITION_VERSION});
 expect(whole.fills[0].quantity).toBeGreaterThan(0);
 const prior=await findCalculatorAdditions({...opts,end:entry+6*M,prices:opts.prices.slice(0,6)});
 const resumed=await findCalculatorAdditions({...opts,since:entry+6*M,previous:prior.fills,prices:opts.prices.slice(6)});expect(resumed.fills).toEqual(whole.fills);
});
it('原方向和涨幅否决仍独立拦截新分类位置',async()=>{
 const def={id:'always-zero',name:'方向',short:'方向',definition:'',formula:'0',interval:'5m' as const,scale:1,unit:'',positive:'1',control:'0'},plan=compileFishProgram(def,{statistic:'结果',direction:'>',threshold:1,constraints:[]});
 const required=[{plan,scale:1,metric:'raw',label:'方向',direction:'>' as const,threshold:1,featureId:def.id,definitionKey:definitionKey(def)}];
 const r=await findCalculatorAdditions({...options(),classifiedImpulsePositions:[position(1)],required});expect(r.fills).toHaveLength(0);expect(r.skipped?.some(s=>s.kind==='direction')).toBe(true);
 const gain=await findCalculatorAdditions({...options(),classifiedImpulsePositions:[position(1)],minGainPct:200});expect(gain.fills).toHaveLength(0);expect(gain.skipped?.some(s=>s.kind==='gain')).toBe(true);
});
it('主分支二类和备选一类独立竞速，较早的一类成为唯一成交',async()=>{
 const result=await findCalculatorAdditions({...options(),roundRules:[{candidates:[],classifiedImpulsePositions:[position(2)],alternative:{candidates:[],classifiedImpulsePositions:[position(1)]}}]});
 expect(result.fills).toHaveLength(1);expect(result.fills[0]).toMatchObject({at:entry+F,lane:'attack',structureEvidence:{impulseClassification:{mainClass:1}}});
});
it('实盘动作沿用能力检查和五分钟有效期，JSON 保存恢复保持动作 ID（仅本地数据转换）',async()=>{
 const fills=(await findCalculatorAdditions({...options(),classifiedImpulsePositions:[position(1)]})).fills;
 const source={...row,symbol:'TESTUSDT',exchange:'binance' as const},plan=freezeQualityPlan({...makeQualitySellPlan('state:state','<',.4,BUILTIN_FEATURES),addition:{enabled:true,source:'structure',stricterPct:10,structure:defaultStructureAddition(),quantityMode:'calculator',quantity:1,classifiedImpulsePositions:[position(1)]}});
 const record={id:'r',roundId:'round',status:'matched',startTime:entry,cursor:entry,matchedAt:entry,updatedAt:entry,readings:[],sample:{id:'s',source,basis:'signal',groups:[],enteredAt:entry,importedAt:entry}},round={id:'round',startedAt:entry,updatedAt:entry,state:'complete',instantTrading:true,hours:1,filters:[],instantMonitor:{version:INSTANT_TEMPLATE_MONITOR,templateId:'fixture',name:'fixture',plan}};
 const tracking={admitted:[{record,round}],monitorResults:new Map([['r',{status:'open',additionFills:fills}]]),alerts:new Map(),enabled:false,active:0,awaitingMail:0,error:'',saving:false,setEnabled:async()=>{}} as unknown as Parameters<typeof usdtFollowCampaigns>[0];
 const campaign=usdtFollowCampaigns(tracking)[0],action=campaign.actions.find(a=>a.action==='add')!;
 expect(campaign.requiresGuardPlus).toBe(true);expect(action.id).toMatch(/^add-class-/);expect(action.impulseFreshUntil).toBe(fills[0].at+F);
 expect(currentUsdtFollowCampaign(campaign,false,fills[0].at)).toBeUndefined();expect(currentUsdtFollowCampaign(campaign,true,action.impulseFreshUntil!)!.actions.some(a=>a.action==='add')).toBe(false);
 const restored={...tracking,monitorResults:new Map([['r',JSON.parse(JSON.stringify(tracking.monitorResults!.get('r')))]])};expect(usdtFollowCampaigns(restored)[0].actions).toEqual(campaign.actions);
});
it('分类位置属于分支各自的轮次字段，主／备选不同分类不污染公共设置',()=>{
 const base={enabled:true,source:'structure' as const,stricterPct:10,structure:defaultStructureAddition(),quantityMode:'calculator' as const,quantity:1};
 expect(raceSharedAddition({...base,classifiedImpulsePositions:[position(1)]})).toEqual(raceSharedAddition({...base,classifiedImpulsePositions:[position(2)]}));
});
it('新增版本、类别、分类定义与 K 随轮次和备选冻结；旧身份原样保留',()=>{
 const base=makeQualitySellPlan('state:state','<',.4,BUILTIN_FEATURES),legacy=freezeQualityPlan({...base,addition:{enabled:true,source:'structure',stricterPct:10,structure:defaultStructureAddition(),quantityMode:'calculator',quantity:1,positionVersion:HOLDING_LEDGER_ADDITION_VERSION,maxRounds:1,rounds:[{source:'structure',stricterPct:10,structure:defaultStructureAddition()}]}}),before=JSON.stringify(legacy);
 const addition:QualityAdditionRule={enabled:true,source:'structure',stricterPct:10,structure:defaultStructureAddition(),quantityMode:'calculator',quantity:1,positionVersion:HOLDING_LEDGER_ADDITION_VERSION,maxRounds:1,classifiedImpulsePositions:[position(1)],rounds:[{source:'structure',stricterPct:10,structure:defaultStructureAddition(),classifiedImpulsePositions:[position(1)]}],alternativeRounds:[{source:'structure',stricterPct:10,structure:defaultStructureAddition(),classifiedImpulsePositions:[position(2)]}]};
 // Structural transport is supplied by the UI; this identity fixture uses classifier-only rounds.
 const frozen=freezeQualityPlan({...base,addition});validateQualityAddition(frozen.addition);expect(planVersionChanges(frozen)).toEqual([]);
 const reordered=JSON.parse(JSON.stringify(frozen,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v));expect(planVersionChanges(reordered)).toEqual([]);
 expect(frozen.frozenVersions!.some(v=>v.key==='addition-impulse-class-primary-1-1')).toBe(true);expect(frozen.frozenVersions!.some(v=>v.key==='addition-impulse-class-alternative-1-2')).toBe(true);
 const changed=structuredClone(frozen);changed.addition!.rounds![0].classifiedImpulsePositions![0].bufferAtr=1;expect(planVersionChanges(changed).length).toBeGreaterThan(0);
 expect(additionIdentity(legacy.addition)).not.toEqual(additionIdentity(addition));expect(JSON.stringify(legacy)).toBe(before);expect(planVersionChanges(legacy)).toEqual([]);
});
it('拒绝错误版本、重复分类、非5分钟、空参数及非计算器执行',()=>{
 const p=position(1);for(const bad of [{...p,version:'wrong'},{...p,bufferAtr:NaN},{...p,definition:{...p.definition,interval:'1h'}}])expect(()=>validateClassifiedImpulsePositions([bad as typeof p])).toThrow();
 expect(()=>validateClassifiedImpulsePositions([p,p])).toThrow();expect(()=>validateQualityAddition({enabled:true,source:'custom',stricterPct:10,quantityMode:'fixed',quantity:1,classifiedImpulsePositions:[p]})).toThrow('计算器');
});
it.each([1,2] as const)('新版第 %s 类的 K 从急拉线扣手填 N×冻结 ATR，旧版起涨低点仍保持',async mainClass=>{
 const read=createClassifiedImpulsePositionReader({row,entry,load,signal});
 for(const n of [0,1.5]){
  const p={...defaultClassifiedImpulsePosition(mainClass,[],CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION),bufferAtr:n,skipNative:true as const},before=JSON.stringify(p);
  const hit=await read(p,entry,entry+mainClass*F+M,[]),expected=Math.floor((line-n*atr)/Number(TICK)+1e-9)*Number(TICK);
  expect(hit!.reading).toBeCloseTo(expected,10);expect(hit!.structureEvidence).toMatchObject({algorithmVersion:CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION,basePrice:line,buffer:n,nativeAtr:atr,impulseClassification:{linePrice:line,mainClass}});
  const old=await read({...p,version:CLASSIFIED_IMPULSE_POSITION_VERSION},entry,entry+mainClass*F+M,[]);
  expect(old!.reading).toBeCloseTo(Math.floor((native.impulse_origin_low-n*atr)/Number(TICK)+1e-9)*Number(TICK),10);expect(old!.structureEvidence!.basePrice).toBe(native.impulse_origin_low);
  expect(old!.structureEvidence!.eventId).not.toBe(hit!.structureEvidence!.eventId);expect(JSON.stringify(p)).toBe(before);
 }
});
it.each([1,2] as const)('新版第 %s 类的定量与卖出 K 共用新公式，暂停恢复和原生支撑减仓互不混用',async mainClass=>{
 const p={...defaultClassifiedImpulsePosition(mainClass,[],CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION),bufferAtr:1.5,skipNative:true as const};
 const opts={...options(),classifiedImpulsePositions:[p],supportReduction:{enabled:true,minDropAtr:.5,maxPct:80,version:2 as const}},whole=await findCalculatorAdditions(opts),expected=Math.floor((line-1.5*atr)/Number(TICK)+1e-9)*Number(TICK);
 expect(whole.fills).toHaveLength(1);expect(whole.fills[0].sizing!.support).toBeCloseTo(expected,10);expect(whole.fills[0].structureEvidence!.guardPrice).toBeCloseTo(expected,10);
 const prior=await findCalculatorAdditions({...opts,end:entry+6*M,prices:opts.prices.slice(0,6)}),resumed=await findCalculatorAdditions({...opts,since:entry+6*M,previous:prior.fills,prices:opts.prices.slice(6)});
 expect(resumed.fills).toEqual(whole.fills);expect(whole.reductions??[]).toHaveLength(0);
});
it('新公式冻结实际执行版本，改基准会被指纹拦截；v1 清单保持可执行',()=>{
 const old=freezeQualityPlan({...makeQualitySellPlan('state:state','<',.4,BUILTIN_FEATURES),addition:{enabled:true,source:'structure',stricterPct:10,structure:defaultStructureAddition(),quantityMode:'calculator',quantity:1,classifiedImpulsePositions:[position(1)]}}),before=JSON.stringify(old);
 const next=structuredClone(old);next.addition!.classifiedImpulsePositions![0].version=CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION;
 expect(planVersionChanges(next).length).toBeGreaterThan(0);
 const frozen=freezeQualityPlan(next);expect(planVersionChanges(JSON.parse(JSON.stringify(frozen)))).toEqual([]);
 expect(frozen.frozenVersions!.find(v=>v.key==='addition-impulse-class-primary-1-1')!.version).toContain(CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION);
 expect(planVersionChanges(old)).toEqual([]);expect(JSON.stringify(old)).toBe(before);expect(additionIdentity(next.addition)).not.toEqual(additionIdentity(old.addition));
});
it.each([1,2] as const)('起涨点 v3 第 %s 类只扣一次 N×冻结 ATR，原生分类及 v1/v2 输出不变',async mainClass=>{
 const read=createClassifiedImpulsePositionReader({row,entry,load,signal});
 for(const n of [0,.5,1.3]){
  const p={...defaultClassifiedImpulsePosition(mainClass),bufferAtr:n,skipNative:true as const};
  validateClassifiedImpulsePositions([p]);
  const hit=await read(p,entry,entry+mainClass*F+M,[]),expected=Math.floor((native.impulse_origin_low-n*atr)/Number(TICK)+1e-9)*Number(TICK);
  expect(hit!.reading).toBeCloseTo(expected,10);expect(hit!.structureEvidence).toMatchObject({algorithmVersion:CLASSIFIED_IMPULSE_ORIGIN_K_POSITION_VERSION,basePrice:native.impulse_origin_low,buffer:n,nativeAtr:atr,impulseClassification:{linePrice:line,mainClass}});
  const oldOrigin=await read({...p,version:CLASSIFIED_IMPULSE_POSITION_VERSION},entry,entry+mainClass*F+M,[]),oldLine=await read({...p,version:CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION},entry,entry+mainClass*F+M,[]);
  expect(hit!.reading).toBe(oldOrigin!.reading);expect(oldLine!.reading).toBeCloseTo(Math.floor((line-n*atr)/Number(TICK)+1e-9)*Number(TICK),10);
  expect(hit!.structureEvidence!.impulseClassification).toEqual(oldLine!.structureEvidence!.impulseClassification);
  expect(hit!.structureEvidence!.eventId).not.toBe(oldOrigin!.structureEvidence!.eventId);expect(hit!.structureEvidence!.eventId).not.toBe(oldLine!.structureEvidence!.eventId);
 }
});
it.each([1,2] as const)('起涨点 v3 第 %s 类与原1115使用同一基准及冻结ATR，定量和卖出K一致',async mainClass=>{
 const p={...defaultClassifiedImpulsePosition(mainClass,[],CLASSIFIED_IMPULSE_ORIGIN_K_POSITION_VERSION),bufferAtr:1.3,skipNative:true as const};
 const opts={...options(),classifiedImpulsePositions:[p]},whole=await findCalculatorAdditions(opts),original=await findCalculatorAdditions({...options(),impulse1115Position:{version:IMPULSE_1115_CONFIGURABLE_K_VERSION,bufferAtr:1.3,skipNative:true}});
 expect(whole.fills).toHaveLength(1);expect(original.fills).toHaveLength(1);
 const fill=whole.fills[0],reference=original.fills[0];
 expect(fill.structureEvidence!.basePrice).toBe(reference.structureEvidence!.basePrice);expect(fill.structureEvidence!.nativeAtr).toBe(reference.structureEvidence!.guardPlus!.early_impulse_event!.frozen_atr);
 expect(fill.sizing!.support).toBe(reference.sizing!.support);expect(fill.structureEvidence!.guardPrice).toBe(reference.structureEvidence!.guardPrice);expect(fill.quantity).toBe(reference.quantity);
 const prior=await findCalculatorAdditions({...opts,end:entry+6*M,prices:opts.prices.slice(0,6)}),resumed=await findCalculatorAdditions({...opts,since:entry+6*M,previous:prior.fills,prices:opts.prices.slice(6)});
 expect(resumed.fills).toEqual(whole.fills);
 const widened=await findCalculatorAdditions({...opts,classifiedImpulsePositions:[{...p,minDistancePct:20}],kStopVersion:ADDITION_K_TOUCH_VERSION,prices:opts.prices.map(b=>b.openTime===entry+mainClass*F+M?{...b,open:100,high:101,low:88,close:90}:b)});
 expect(widened.fills[0].sizing!.support).toBeCloseTo(112*.8,10);expect(widened.fills[0].structureEvidence).toMatchObject({k:widened.fills[0].sizing!.support,minDistancePct:20});
 expect(widened.stop).toMatchObject({at:entry+mainClass*F+M,price:widened.fills[0].sizing!.support,atOpen:false});
});
it('起涨点 v3 主分支与备选各自冻结版本，切换旧公式必须重新冻结运行副本',()=>{
 const base=makeQualitySellPlan('state:state','<',.4,BUILTIN_FEATURES),oldPosition={...defaultClassifiedImpulsePosition(1,[],CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION),skipNative:true as const},old=freezeQualityPlan({...base,addition:{enabled:true,source:'structure',stricterPct:10,structure:defaultStructureAddition(),quantityMode:'calculator',quantity:1,classifiedImpulsePositions:[oldPosition]}}),before=JSON.stringify(old);
 const next=structuredClone(old);next.addition!.classifiedImpulsePositions![0].version=CLASSIFIED_IMPULSE_ORIGIN_K_POSITION_VERSION;
 expect(planVersionChanges(next).length).toBeGreaterThan(0);
 const frozen=freezeQualityPlan(next);expect(planVersionChanges(JSON.parse(JSON.stringify(frozen)))).toEqual([]);
 expect(frozen.frozenVersions!.find(v=>v.key==='addition-impulse-class-primary-1-1')).toMatchObject({version:expect.stringContaining(CLASSIFIED_IMPULSE_ORIGIN_K_POSITION_VERSION),summary:expect.stringContaining('起涨点')});
 const round=(mainClass:1|2)=>({source:'structure' as const,stricterPct:10,structure:defaultStructureAddition(),classifiedImpulsePositions:[{...defaultClassifiedImpulsePosition(mainClass,[],CLASSIFIED_IMPULSE_ORIGIN_K_POSITION_VERSION),skipNative:true as const,bufferAtr:mainClass}]});
 const both=freezeQualityPlan({...base,addition:{...next.addition!,maxRounds:1,repeat:false,rounds:[round(1)],alternativeRounds:[round(2)]}});validateQualityAddition(both.addition);
 expect(planVersionChanges(JSON.parse(JSON.stringify(both)))).toEqual([]);
 for(const key of ['addition-impulse-class-primary-1-1','addition-impulse-class-alternative-1-2'])expect(both.frozenVersions!.find(v=>v.key===key)!.version).toContain(CLASSIFIED_IMPULSE_ORIGIN_K_POSITION_VERSION);
 expect(planVersionChanges(old)).toEqual([]);expect(JSON.stringify(old)).toBe(before);expect(additionIdentity(next.addition)).not.toEqual(additionIdentity(old.addition));
});
