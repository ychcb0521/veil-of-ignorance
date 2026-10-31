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
const bar=(minute:number,open=100+minute*10,volume=1,low=open-1,high=minute===0?106:open+1,close=open):ResearchBar=>({openTime:T+minute*M,open,close,low,high,volume,quoteVolume:100,takerBuyVolume:0,takerBuyQuoteVolume:volume});
const loader=(path:(m:number)=>ResearchBar=bar):FishReconstructionLoader=>async(_row,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{const at=from+i*p.step;return p.step===M?(at<T?{...bar(-1,100,0,99,101),openTime:at}:path((at-T)/M)):{...bar(-1,100,0,99,101),openTime:at};});
const run=async(g:QualityGroup,n=10,previous?:Awaited<ReturnType<typeof evaluateQualitySample>>,load=loader())=>{const r=await evaluateQualitySample(sample,g,0,T+n*M,load,new AbortController().signal,previous);if(r.status==='error')throw Error(r.reason);return r;};
it('switches only after actual sixth and seventh fills, uses the selected seller, and preserves switches after resume',async()=>{
 const g=group();g.sellStages=[stage(6,'raw = C','>',165,'CDA'),stage(7,'raw = B','>',1.5,'MBI')];
 const load=loader(m=>bar(m,100+m*10,m>=7?2:1)),r=await run(g,10,undefined,load);
 expect(r).toMatchObject({status:'closed',endTime:T+8*M,endPrice:180,activeSellStage:{afterAdditions:7,label:'MBI'},sellStageSwitches:[{afterAdditions:6,at:T+6*M},{afterAdditions:7,at:T+7*M}]});expect(r.additionFills).toHaveLength(7);expect(r.reason).toContain('第 7 次加仓后，按 MBI > 1.5');
 for(const n of [5,6,7,8])expect(await run(g,10,await run(g,n,undefined,load),load)).toEqual(r);
 const before=await run(g,6,undefined,load);expect(before.activeSellStage).toBeUndefined();expect(before.additionFills).toHaveLength(5);
 const evidence=buildQualityCampaignData('u',{sample,plan:g,result:r,detectors:[],observeHours:0,firstEvaluatedAt:T},'sell').campaign.comparison!.sellEvidence!;expect(evidence).toMatchObject({featureId:'seller-7',threshold:1.5,activeSellStage:{afterAdditions:7},sellStageSwitches:[{afterAdditions:6},{afterAdditions:7}]});expect(evidence.formula).toContain('raw = B');
});
it('replaces the old ordinary seller, rather than keeping it as an additional exit',async()=>{
 const g=group();g.rule={metric:'raw',direction:'>',threshold:1.5};g.sellStages=[stage(1)];g.addition!.maxRounds=1;
 const load=loader(m=>bar(m,100+m*10,m<2?1:2)),r=await run(g,6,undefined,load);expect(r.status).toBe('open');expect(r.activeSellStage?.afterAdditions).toBe(1);expect(r.additionFills).toHaveLength(1);
 expect((await run({...g,sellStages:undefined},6,undefined,load)).status).toBe('closed');
});
it('starts the new seller with observations after the fill and gives an existing same-open sell priority over an addition',async()=>{
 const g=group();g.sellStages=[stage(1,'raw = C','>',99)];const r=await run(g,4);expect(r).toMatchObject({status:'closed',endTime:T+2*M,additionFills:[{at:T+M}],activeSellStage:{afterAdditions:1}});expect(r.sellStageSwitches).toHaveLength(1);
 const sold=await run({...g,rule:{metric:'raw',direction:'>',threshold:.5}},4);expect(sold).toMatchObject({status:'closed',endTime:T+M});expect(qualityAdditionFills(sold)).toHaveLength(0);expect(sold.activeSellStage).toBeUndefined();
});
it('retains the original gain-based combination before the count boundary and replaces both phases after it',async()=>{
 const g=group();g.combo={switchPct:1,beforeLabel:'原前段',after:{...stage(1),label:'原后段'}};g.sellStages=[stage(1,'raw = C','>',115)];const r=await run(g,5);expect(r).toMatchObject({status:'closed',endTime:T+3*M,activeSellStage:{afterAdditions:1}});
});
it('does not activate an unreachable stage or count conditions that did not execute',async()=>{
 const g=group();g.addition!.maxRounds=1;g.sellStages=[stage(6,'raw = C','>',99)];const r=await run(g,5);expect(r.status).toBe('open');expect(r.activeSellStage).toBeUndefined();expect(r.sellStageSwitches).toBeUndefined();expect(r.additionFills).toHaveLength(1);
});
it('keeps support stops and holding vetoes active across seller switches',async()=>{
 const g=group();g.addition!.maxRounds=1;g.sellStages=[stage(1)];
 const gap=await run(g,5,undefined,loader(m=>m<2?bar(m):bar(m,104,1,103,105)));expect(gap).toMatchObject({status:'closed',endTime:T+2*M,endPrice:104,exitSnapshot:{cause:{kind:'addition-support'}},activeSellStage:{afterAdditions:1}});
 g.holdingVetoes=[makeQualityHoldingVeto('dynamic-drawdown','>=',5)];const veto=await run(g,5,undefined,loader(m=>m===0?bar(0,100,1,99,106,106):m===1?bar(1,110,1,109,113,112):bar(m,112,1,105,113,111)));expect(veto).toMatchObject({status:'closed',endTime:T+2*M,endPrice:expect.closeTo(107.35),exitSnapshot:{cause:{kind:'dynamic-drawdown'}}});
});
it('versions counts, directions, thresholds and frozen formulas independently without changing legacy identities',()=>{
 const g=group(),key=qualityResultKey(sample,g,0),sellKey=qualitySellKey(g);expect(qualityResultKey(sample,{...g,sellStages:[]},0)).toBe(key);expect(qualitySellKey({...g,sellStages:[]})).toBe(sellKey);
 const a=stage(6),configured={...g,sellStages:[a]};for(const changed of [{...a,afterAdditions:7},{...a,rule:{...a.rule,direction:'<' as const}},{...a,rule:{...a.rule,threshold:999}},{...a,snapshot:{...a.snapshot,definitionKey:a.snapshot.definitionKey+'x'}}])expect(qualitySellStagesIdentity({...g,sellStages:[changed]})).not.toEqual(qualitySellStagesIdentity(configured));
 expect(()=>validateQualitySellStages({...g,sellStages:[a,{...a,label:'重复'}]})).toThrow('同一次');for(const afterAdditions of [0,-1,1.5,101,NaN])expect(()=>validateQualitySellStages({...g,sellStages:[{...a,afterAdditions}]})).toThrow('整数');expect(()=>validateQualitySellStages({...g,sellStages:[{...a,rule:{...a.rule,threshold:NaN}}]})).toThrow('有限数字');
});
it('does not let missing readings of a discarded seller after the switch invalidate the selected stage',async()=>{
 const g=group();g.rule={metric:'raw',direction:'>',threshold:1.5};g.addition!.maxRounds=1;g.sellStages=[stage(1)];
 const base=loader(),brokenOld:FishReconstructionLoader=async(...args)=>(await base(...args)).map(b=>b.openTime>=T+M?{...b,takerBuyQuoteVolume:NaN}:b);
 const r=await run(g,5,undefined,brokenOld);expect(r.status).toBe('open');expect(r.activeSellStage?.afterAdditions).toBe(1);expect(r.additionFills).toHaveLength(1);
});
it('exports the actual selected formula and frozen switch history in both libraries',async()=>{
 const {newQualityStudy,importQualityLibrary,qualityComparisonRows}=await import('@/lib/fish/quality'),{buildQualitySheets}=await import('@/lib/fish/qualityExport'),{beginQualityMonitorRound,captureQualityMonitorResult}=await import('@/lib/fish/qualityMonitorLibrary'),{buildMonitorSheets}=await import('@/lib/fish/qualityMonitorTable');
 const g=group();g.sellStages=[stage(1,'raw = C','>',115,'CDA')];const study={...importQualityLibrary(newQualityStudy(T),[sample.source]),sellPlans:[g]},row=qualityComparisonRows(study)[0];study.selectedRowIds=[row.id];const r=await evaluateQualitySample(row,g,0,T+5*M,loader(),new AbortController().signal);study.results=[r];
 const begin=beginQualityMonitorRound(study,study,T),saved=captureQualityMonitorResult(begin.study,begin.capture,r,T+5*M),lib=saved.monitorLibrary!;
 const sets=[buildQualitySheets(study,[row]),buildMonitorSheets(lib.records,new Map(lib.settings.map(s=>[s.id,s])))];
 for(const sheets of sets){for(const sheet of sheets)expect(sheet.rows.every(row=>row.length===sheet.columns.length)).toBe(true);const switches=sheets.find(s=>s.name==='卖出次数切换')!;expect(switches.rows[0]).toContain(1);expect(switches.rows[0]).toContain('CDA');expect(switches.rows[0]).toContain('是');expect(JSON.parse(switches.rows[0].at(-1) as string).featureId).toBe('seller-1');}
 const results=sets[0].find(s=>s.name==='运行结果')!,headers=results.columns.map(c=>c.header);expect(results.rows[0][headers.indexOf('卖出门槛')]).toBe(115);expect(results.rows[0][headers.indexOf('实际卖出公式')]).toContain('raw = C');
});
it('keeps a newly active five-minute seller causal and sells before a seventh addition at the same open',async()=>{
 const g=group(),six=stage(6,'raw = C','>',159,'CDA'),seven=stage(7,'raw = B','>',999,'MBI');six.snapshot={...six.snapshot,interval:'5m',definitionKey:definitionKey({...def,formula:'raw = C',interval:'5m' as const})};g.sellStages=[six,seven];
 const r=await run(g,10);expect(r).toMatchObject({status:'closed',endTime:T+7*M,endPrice:170,activeSellStage:{afterAdditions:6}});expect(r.additionFills).toHaveLength(6);expect(r.sellStageSwitches).toHaveLength(1);expect(await run(g,10,await run(g,7))).toEqual(r);
});

it('records the new seller execution timing when switching from a legacy close-confirmed seller',async()=>{
 const g=group();delete g.execution;g.sellStages=[stage(1,'raw = C','>',115,'CDA')];const r=await run(g,5);expect(r.status).toBe('closed');const c=buildQualityCampaignData('u',{sample,plan:g,result:r,detectors:[],observeHours:0,firstEvaluatedAt:T},'sell').campaign;expect(c.comparison?.sellEvidence).toMatchObject({execution:'intrabar-1m',activeSellStage:{afterAdditions:1}});
});
