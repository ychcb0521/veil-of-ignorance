import {it,expect} from 'vitest';
import {defaultBoxStop,defaultBoxBreak,selectBoxStopReference,selectBoxStopChannels,boxStopChannelSettings,createBoxStopReader,validateBoxStop,BOX_STOP_CHANNELS_VERSION,type BoxStopRule} from '@/lib/fish/qualityBoxStop';
import {freezeQualityPlan,planVersionChanges} from '@/lib/fish/qualityPlanVersions';
import {holdingVetoDraft,parseHoldingVetoDraft} from '@/lib/fish/qualityFilters';
import {evaluateQualitySample,type QualitySample,type QualityGroup} from '@/lib/fish/quality';
import {createPreEntryGate} from '@/lib/fish/preEntryGate';
import {emptyPreEntryConditions} from '@/lib/fish/preEntryConditions';
import {withTuringInitialization} from '@/lib/fish/qualityInitialization';
import {POST_MIRROR_PROTECTION_VERSION} from '@/lib/fish/qualityPostMirrorProtection';
import {warm,impulse,bar as plusBar,START} from './fixtures/dbl5GuardPlusBars';
import type {ResearchBar} from '@/lib/deepRsa/window';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
const M=60000,F=5*M,entry=START+20*F,signal=new AbortController().signal;
const row={id:'s',symbol:'TURING:TURING 1',timeMs:entry,timeLabel:'',fallbackZone:''};
const minute=(at:number,open=112,low=open-.1,close=open):ResearchBar=>({openTime:at,open,high:Math.max(112.2,open,close),low,close,volume:500,quoteVolume:1000,takerBuyVolume:250,takerBuyQuoteVolume:500,DBL5_tick_size:'.01'});
const sequence=[...warm(),impulse(),plusBar(21,101.4,102,101.2,101.9)];
const byTime=new Map(sequence.map(b=>[b.openTime,{...b,quoteVolume:1000,takerBuyQuoteVolume:500} as ResearchBar]));
const loader=(price=minute)=>withTuringInitialization((async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>p.step===M?price(a+i*M):byTime.get(a+i*F)??({...minute(a+i*F,102,101.9),high:102.1}))) as FishReconstructionLoader,row.symbol,START);
const pair=()=>{const regular=defaultBoxStop(),imp=selectBoxStopReference(defaultBoxStop(),'impulse1115');regular.structure.buffer=.25;imp.structure.buffer=.75;return selectBoxStopChannels({regular:{enabled:true,rule:regular},impulse:{enabled:true,rule:imp}});};
const veto=(rule:BoxStopRule)=>({id:'v',kind:'box-stop' as const,label:'双路K',enabled:true,direction:'<=' as const,threshold:0,boxStop:rule});
const reader=(rule:BoxStopRule,previous?:Parameters<typeof createBoxStopReader>[0]['previous'],since=entry)=>createBoxStopReader({vetoes:[veto(rule)],row,entry,since,load:loader(),signal,previous});
const group=(rule:BoxStopRule):QualityGroup=>({id:'g',label:'双路K',metric:'raw',snapshot:{featureId:'p',definitionKey:'C',statistic:'raw',interval:'5m',scale:1,threshold:0,direction:'<',average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:entry},holdingVetoes:[veto(rule)],vetoFill:'stop'});
const sample:QualitySample={id:'s',enteredAt:entry,basis:'signal',importedAt:entry,groups:[],source:row};
it('两路 ATR、背景、K 与原生单路输出逐点一致，调整一边不影响另一边',async()=>{
 const p=pair(),c=p.channels!,r=reader(p),a=reader(c.regular.rule),b=reader(c.impulse.rule),at=entry+F;
 await Promise.all([r.read(minute(at)),a.read(minute(at)),b.read(minute(at))]);
 expect(r.states()['v:regular'].line).toBeGreaterThan(0);expect(r.states()['v:impulse'].line).toBeGreaterThan(0);
 expect(r.states()['v:regular']).toEqual(a.states().v);expect(r.states()['v:impulse']).toEqual(b.states().v);
 const changed=selectBoxStopChannels({...c,impulse:{...c.impulse,rule:{...c.impulse.rule,structure:{...c.impulse.rule.structure,buffer:1.5}}}}),next=reader(changed);await next.read(minute(at));
 expect(next.states()['v:regular']).toEqual(r.states()['v:regular']);expect(next.states()['v:impulse'].line).toBeLessThan(r.states()['v:impulse'].line!);
 const original=JSON.stringify(c.impulse.rule),settings=boxStopChannelSettings(p);settings.regular.rule.structure.buffer=2;
 expect(JSON.stringify(c.impulse.rule)).toBe(original);
});
it.each(['regular','impulse'] as const)('两路同时触及时由较高的 %s K 先止损；另一边 ATR 不混用',async channel=>{
 const p=pair(),c=p.channels!;c.regular.rule.structure.buffer=channel==='regular'?0:10;c.impulse.rule.structure.buffer=channel==='impulse'?0:10;
 const r=reader(selectBoxStopChannels(c)),at=entry+F;await r.read(minute(at));
 const line=r.states()['v:'+channel].line!;expect(line).toBeGreaterThan(r.states()['v:'+(channel==='regular'?'impulse':'regular')].line!);
 const hit=await r.read(minute(at+M,112,1));expect(hit).toMatchObject({fillPrice:line,cause:{id:'v',boxStopChannel:channel,boxStopChannelsVersion:BOX_STOP_CHANNELS_VERSION}});
});
it('两路收盘确认独立累计，暂停恢复保持各自 K 与计数',async()=>{
 const c=pair().channels!;for(const [key,n] of [['regular',2],['impulse',3]] as const)c[key].rule={...c[key].rule,update:'fixed',confirmation:'close-1m',closes:n};
 const p=selectBoxStopChannels(c),r=reader(p),at=entry+F;
 expect(await r.read(minute(at,112,80,80))).toBeUndefined();expect(r.states()['v:regular'].count).toBe(1);expect(r.states()['v:impulse'].count).toBe(1);
 const resumed=reader(p,JSON.parse(JSON.stringify(r.states())),at+M),bar=minute(at+M,112,80,80);
 const whole=await r.read(bar);expect(whole?.cause?.boxStopChannel).toBe('regular');expect(await resumed.read(bar)).toEqual(whole);
 expect(resumed.states()).toEqual(r.states());
});
it('停用一路不参与执行，参数仍冻结保留；共用镜像后启动范围',async()=>{
 const c=pair().channels!;c.regular.enabled=false;const p=selectBoxStopChannels(c),r=reader(p);await r.read(minute(entry+F));expect(Object.keys(r.states())).toEqual(['v:impulse']);
 const g=group(p);g.holdingVetoes![0].activation=POST_MIRROR_PROTECTION_VERSION;g.mirrorTakeProfit={enabled:true,gainPct:5,sellPct:50};
 const prices=loader(t=>t===entry+M?minute(t,112,1):t===entry+3*M?minute(t,120,120):t===entry+7*M?minute(t,112,1):minute(t));
 const whole=await evaluateQualitySample(sample,g,0,entry+10*M,prices,signal);
 expect(whole).toMatchObject({status:'closed',endTime:entry+7*M,mirrorFill:{at:entry+3*M},exitSnapshot:{cause:{boxStopChannel:'impulse'}}});
 const first=await evaluateQualitySample(sample,g,0,entry+6*M,prices,signal);expect(await evaluateQualitySample(sample,g,0,entry+10*M,prices,signal,first)).toEqual(whole);
 expect(p.channels!.regular.rule.structure.buffer).toBe(.25);
});
it('动态筛选共用两路原生 K，已准备好后不因父 ID 缺失永久等待',async()=>{
 const p=pair(),gate=createPreEntryGate({conditions:{...emptyPreEntryConditions(),hardVetoes:[veto(p)]},start:entry,row,load:loader(t=>t===entry+7*M?minute(t,112,1):minute(t)),signal});
 const ready=await gate(entry+6*M);expect(ready.pending).toBeFalsy();expect(ready.blocked).toBeFalsy();expect((await gate(entry+8*M)).blocked).toBeTruthy();
});
it('新版本冻结两路参数与启用标志，JSONB 顺序兼容，旧模板不改写',()=>{
 const old=freezeQualityPlan(group(defaultBoxStop())),before=JSON.stringify(old),p=pair(),frozen=freezeQualityPlan(group(p));
 const reverse=(x:unknown)=>JSON.parse(JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v));
 expect(planVersionChanges(reverse(frozen))).toEqual([]);expect(frozen.frozenVersions!.find(v=>v.key==='hard-stop-box-0')!.version).toContain(BOX_STOP_CHANNELS_VERSION);
 expect(parseHoldingVetoDraft(holdingVetoDraft(frozen.holdingVetoes))[0].boxStop).toEqual(frozen.holdingVetoes![0].boxStop);
 for(const key of ['regular','impulse'] as const){const changed=structuredClone(frozen),c=changed.holdingVetoes![0].boxStop!.channels!;c[key].rule.structure.buffer+=.1;changed.holdingVetoes![0].boxStop=selectBoxStopChannels(c);expect(planVersionChanges(changed).some(v=>v.key==='hard-stop-box-0')).toBe(true);}
 const disabled=structuredClone(frozen);disabled.holdingVetoes![0].boxStop!.channels!.impulse.enabled=false;expect(planVersionChanges(disabled).length).toBeGreaterThan(0);
 const screening=freezeQualityPlan({...group(p),holdingVetoes:undefined,preEntryConditions:{...emptyPreEntryConditions(),hardVetoes:[veto(p)]}});expect(planVersionChanges(reverse(screening))).toEqual([]);
 expect(JSON.stringify(old)).toBe(before);expect(planVersionChanges(old)).toEqual([]);
});
it('拒绝混用路别、错误版本、嵌套双路和红叉事件伪装为触价路',()=>{
 const p=pair();expect(()=>validateBoxStop(p)).not.toThrow();expect(()=>validateBoxStop({...p,version:'holding-box-stop-v1'})).toThrow();
 for(const bad of [p,defaultBoxBreak(),selectBoxStopReference(defaultBoxStop(),'impulse1115')]){const c=structuredClone(p.channels!);c.regular.rule=bad;expect(()=>validateBoxStop(selectBoxStopChannels(c))).toThrow();}
 const bad={...structuredClone(p),structure:{...p.structure,buffer:20}};expect(()=>validateBoxStop(bad)).toThrow('冻结参数不一致');
});
