import {it,expect} from 'vitest';
import {definitionKey} from '@/lib/deepDig/features';
import {evaluateQualitySample,qualityResultKey,type QualityGroup,type QualitySample} from '@/lib/fish/quality';
import {defaultQualityAddition,qualityAdditionFills} from '@/lib/fish/qualityAddition';
import {validateQualitySellStages,qualitySellStagesIdentity,type QualitySellStage} from '@/lib/fish/qualitySellStages';
import {buildQualityCampaignData} from '@/lib/fish/qualityCampaigns';
import {makeQualityHoldingVeto} from '@/lib/fish/qualityFilters';
import {qualitySellKey} from '@/lib/fish/qualityCampaignArchive';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
import type {ResearchBar} from '@/lib/deepRsa/window';
const M=60000,T=Date.UTC(2026,9,29);
const def={id:'stage-base',name:'原算法',short:'原算法',definition:'',formula:'raw = B',scale:1,unit:'',positive:'1',control:'0',interval:'1m' as const};
const snapshot={featureId:def.id,featureName:def.name,featureShort:def.short,definitionKey:definitionKey(def),statistic:'raw',interval:'1m',scale:1,threshold:.5,direction:'>' as const,average:1,cbi2:1,startAverage:1,previousAverage:0,cutoffMs:T};
const sample:QualitySample={id:'stage-test',enteredAt:T,basis:'capture',importedAt:T,groups:[],source:{id:'stage-test',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:'',fish:snapshot}};
const group=():QualityGroup=>({id:'g',label:'动态卖出',metric:'raw',snapshot,rule:{metric:'raw',direction:'<',threshold:-1},execution:'intrabar-1m',mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50},addition:{...defaultQualityAddition(),enabled:true,source:'custom',condition:{id:'add',label:'加仓条件',metric:'raw',direction:'>',threshold:.5,enabled:true,snapshot}}});
const stage=(n:number,formula='raw = C',direction:'<'|'>'='>',threshold=1000,label='阶段'+n):QualitySellStage=>{const d={...def,id:'seller-'+n,name:label,short:label,formula};return {afterAdditions:n,label,metric:'raw',snapshot:{...snapshot,featureId:d.id,featureName:label,featureShort:label,definitionKey:definitionKey(d)},rule:{metric:'raw',direction,threshold}};};
const bar=(minute:number,open=100+minute*50,volume=1,low=open-1,high=minute===0?106:open+1,close=open):ResearchBar=>({openTime:T+minute*M,open,close,low,high,volume,quoteVolume:100,takerBuyVolume:0,takerBuyQuoteVolume:volume});
const loader=(path:(m:number)=>ResearchBar=bar):FishReconstructionLoader=>async(_row,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{const at=from+i*p.step;return p.step===M?(at<T?{...bar(-1,100,0,99,101),openTime:at}:path((at-T)/M)):{...bar(-1,100,0,99,101),openTime:at};});
const run=async(g:QualityGroup,n=10,previous?:Awaited<ReturnType<typeof evaluateQualitySample>>,load=loader())=>{const r=await evaluateQualitySample(sample,g,0,T+n*M,load,new AbortController().signal,previous);if(r.status==='error')throw Error(r.reason);return r;};

import {stagedHoldingVetoes,validateQualityVetoStages,qualityVetoStagesIdentity} from '@/lib/fish/qualityVetoStages';
import {qualityCampaignStaticRisk} from '@/lib/fish/qualityCampaignRisk';
const dynamic=(n:number)=>makeQualityHoldingVeto('dynamic-drawdown','>=',n);
const vetoGroup=():QualityGroup=>({...group(),vetoPeakBasis:'holding',holdingVetoes:[dynamic(50)],vetoStages:[{afterAdditions:6,conditions:[dynamic(20)]},{afterAdditions:7,conditions:[dynamic(15)]}]});
const atrLoader=(path:(m:number)=>ResearchBar=bar):FishReconstructionLoader=>async(_row,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{const at=from+i*p.step;return p.step===M?(at<T?{...bar(-1,100,0,99,101),openTime:at}:path((at-T)/M)):{...bar(-1,100,0,90,110),openTime:at};});
it('switches dynamic drawdown to 20% after six real additions and 15% after seven, including resumes',async()=>{
 for(const cap of [6,7]){
  const g=vetoGroup();g.addition!.maxRounds=cap;
  const load=atrLoader(m=>m<cap?bar(m):m===cap?bar(m,100+m*50,0,100+m*50-1,600,590):bar(m,580,0,470,590,500));
  const r=await run(g,10,undefined,load);expect(r).toMatchObject({status:'closed',endTime:T+(cap+1)*M,endPrice:cap===6?480:510,activeVetoStage:{afterAdditions:cap},exitSnapshot:{cause:{kind:'dynamic-drawdown',threshold:cap===6?20:15}}});
  expect(r.additionFills).toHaveLength(cap);expect(r.reason).toContain(`第 ${cap} 次加仓后一票条件`);
  for(const n of [5,6,7,8])expect(await run(g,10,await run(g,n,undefined,load),load)).toEqual(r);
 }
});
it('does not retroactively sell an old recovered drawdown and preserves the original historical metrics',async()=>{
 const g=vetoGroup();g.addition!.maxRounds=6;g.vetoStages=[{afterAdditions:6,conditions:[dynamic(10)]}];
 const load=atrLoader(m=>m===4?bar(m,300,1,299,400,320):m===5?bar(m,350,1,349,420,400):m>=6?bar(m,400,0,390,405,400):bar(m));
 const r=await run(g,8,undefined,load);expect(r.status).toBe('open');expect(r.activeVetoStage?.afterAdditions).toBe(6);expect(r.drawdownPct).toBeGreaterThanOrEqual(20);expect(r.vetoPath!.dynamic).toBeLessThan(10);
 expect(await run(g,8,await run(g,7,undefined,load),load)).toEqual(r);
});
it('can carry the holding peak or restart the peak at the switching addition without changing the global peak metric',async()=>{
 const g=vetoGroup();g.addition!.maxRounds=6;g.vetoStages=[{afterAdditions:6,conditions:[dynamic(10)]}];
 const load=atrLoader(m=>m===4?bar(m,300,1,299,400,320):m===5?bar(m,350,1,349,420,400):m===6?bar(m,400,0,399,405,400):m>=7?bar(m,400,0,375,405,400):bar(m));
 const held=await run(g,9,undefined,load),reset=await run({...g,vetoPeakBasis:'stage'},9,undefined,load);
 expect(held).toMatchObject({status:'closed',endPrice:378,exitSnapshot:{cause:{kind:'dynamic-drawdown'}}});expect(reset.status).toBe('open');const defaultPeak=await run({...g,vetoPeakBasis:undefined},9,undefined,load);expect(defaultPeak).toEqual(reset);expect(reset.peakPct).toBe(320);expect(reset.vetoPath!.peak).toBe(405);
});
it('replaces matching conditions cumulatively or whole profiles, and allows explicitly disabling a matching base rule',()=>{
 const g=vetoGroup(),stop=makeQualityHoldingVeto('static-drawdown','>=',5);g.holdingVetoes!.push(stop);expect(stagedHoldingVetoes(g,5)).toEqual(g.holdingVetoes);expect(stagedHoldingVetoes(g,6)).toEqual([stop,dynamic(20)]);expect(stagedHoldingVetoes(g,7)).toEqual([stop,dynamic(15)]);
 expect(stagedHoldingVetoes({...g,vetoStageMode:'replace'},7)).toEqual([dynamic(15)]);
 g.vetoStages![0].conditions=[{...dynamic(50),enabled:false}];expect(stagedHoldingVetoes(g,6)).toEqual([stop,{...dynamic(50),enabled:false}]);
});
it('combines ordinary seller and veto count boundaries and preserves K stops after the addition cap',async()=>{
 const g=vetoGroup();g.sellStages=[stage(3,'raw = C','>',99999,'CDA'),stage(7,'raw = C','>',99999,'MBI')];g.addition!.maxRounds=7;
 const load=atrLoader(m=>m<8?bar(m):bar(m,410,0,400,415));const r=await run(g,10,undefined,load);expect(r).toMatchObject({status:'closed',endPrice:410,exitSnapshot:{cause:{kind:'addition-support'}},activeVetoStage:{afterAdditions:7},activeSellStage:{afterAdditions:7}});expect(r.sellStageSwitches?.map(s=>s.afterAdditions)).toEqual([3,7]);expect(r.vetoStageSwitches?.map(s=>s.afterAdditions)).toEqual([6,7]);
 expect(await run(g,10,await run(g,7,undefined,load),load)).toEqual(r);
});
it('activates no stage before a successful fill and versions the full settings without altering legacy identities',async()=>{
 const g=vetoGroup();g.addition!.maxRounds=1;const r=await run(g,5,undefined,atrLoader());expect(r.activeVetoStage).toBeUndefined();expect(r.vetoStageSwitches).toBeUndefined();expect(r.additionFills).toHaveLength(1);
 const base={...g,vetoStages:undefined};expect(qualityResultKey(sample,{...base,vetoStages:[]},0)).toBe(qualityResultKey(sample,base,0));expect(qualitySellKey({...base,vetoStages:[]})).toBe(qualitySellKey(base));
 for(const changed of [{...g,vetoPeakBasis:'stage' as const},{...g,vetoStageMode:'replace' as const},{...g,vetoStages:[{afterAdditions:5,conditions:[dynamic(20)]}]},{...g,vetoStages:[{afterAdditions:6,conditions:[dynamic(19)]}]},{...g,vetoStages:[{afterAdditions:6,conditions:[{...dynamic(20),enabled:false}]}]}])expect(qualityVetoStagesIdentity(changed)).not.toEqual(qualityVetoStagesIdentity(g));
 expect(()=>validateQualityVetoStages({...g,vetoStages:[g.vetoStages![0],g.vetoStages![0]]})).toThrow('同一次');for(const afterAdditions of [0,1.2,101,NaN])expect(()=>validateQualityVetoStages({...g,vetoStages:[{afterAdditions,conditions:[dynamic(20)]}]})).toThrow('整数');
});
it('freezes actual veto stages, keeps initial static risk for b, and exports all configurations and actual switch times',async()=>{
 const {newQualityStudy,importQualityLibrary,qualityComparisonRows}=await import('@/lib/fish/quality'),{buildQualitySheets}=await import('@/lib/fish/qualityExport'),{beginQualityMonitorRound,captureQualityMonitorResult}=await import('@/lib/fish/qualityMonitorLibrary'),{buildMonitorSheets}=await import('@/lib/fish/qualityMonitorTable');
 const g=vetoGroup();g.addition!.maxRounds=6;g.holdingVetoes!.push(makeQualityHoldingVeto('static-drawdown','>=',5));g.vetoStageMode='replace';g.vetoStages=[{afterAdditions:6,conditions:[dynamic(20),makeQualityHoldingVeto('static-drawdown','>=',2)]}];
 const study={...importQualityLibrary(newQualityStudy(T),[sample.source]),sellPlans:[g]},row=qualityComparisonRows(study)[0];study.selectedRowIds=[row.id];const load=atrLoader(m=>m<6?bar(m):m===6?bar(m,400,0,399,600,590):bar(m,580,0,470,590,500)),r=await evaluateQualitySample(row,g,0,T+10*M,load,new AbortController().signal);expect(r.status).toBe('closed');study.results=[r];
 const campaign=buildQualityCampaignData('u',{sample:row,plan:g,result:r,detectors:[],observeHours:0,firstEvaluatedAt:T},'sell').campaign;
 expect(campaign.comparison!.sellEvidence).toMatchObject({initialStaticStopPct:5,activeVetoStage:{afterAdditions:6},vetoStageSwitches:[{afterAdditions:6}],holdingVetoes:[{threshold:20},{threshold:2}]});expect(qualityCampaignStaticRisk(campaign)?.percent).toBe(5);
 const noInitial={...campaign,comparison:{...campaign.comparison!,sellEvidence:{...campaign.comparison!.sellEvidence!,initialStaticStopPct:null}}};expect(qualityCampaignStaticRisk(noInitial)).toBeUndefined();
 const begin=beginQualityMonitorRound(study,study,T),saved=captureQualityMonitorResult(begin.study,begin.capture,r,T+10*M),lib=saved.monitorLibrary!;
 for(const sheets of [buildQualitySheets(study,[row]),buildMonitorSheets(lib.records,new Map(lib.settings.map(s=>[s.id,s])))]){expect(sheets.every(s=>s.rows.every(r=>r.length===s.columns.length))).toBe(true);const switched=sheets.find(s=>s.name==='一票次数切换')!;expect(switched.rows[0][2]).toBe(6);expect(switched.rows[0][7]).toBe('是');expect(JSON.parse(switched.rows[0][8] as string)[0].threshold).toBe(20);expect(switched.rows[0][6]).toBeTruthy();}
});

it('discards future missing readings of a replaced veto indicator after its actual switch boundary',async()=>{
 const g=vetoGroup();g.rule=undefined;g.addition!.maxRounds=1;g.vetoStages=[{afterAdditions:1,conditions:[dynamic(20)]}];g.vetoStageMode='replace';g.holdingVetoes=[{id:'old',kind:'indicator',label:'旧否决',direction:'>',threshold:9,metric:'raw',snapshot,enabled:true}];
 const good=atrLoader(),load:FishReconstructionLoader=async(...args)=>(await good(...args)).map(b=>b.openTime>=T+M?{...b,takerBuyQuoteVolume:NaN}:b);
 // The addition source shares B, so freeze its one valid pre-switch observation and do not ask for more additions.
 const r=await run(g,5,undefined,load);expect(r.status).toBe('open');expect(r.activeVetoStage?.afterAdditions).toBe(1);expect(r.additionFills).toHaveLength(1);
});
