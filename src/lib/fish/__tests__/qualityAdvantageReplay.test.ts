import { beforeEach, expect, it, vi } from 'vitest';
import { definitionKey, BUILTIN_FEATURES } from '@/lib/deepDig/features';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { FishReconstructionLoader } from '../reconstruction';
import { evaluateQualitySample, type QualityGroup, type QualitySample } from '../quality';
import { defaultQualityAddition } from '../qualityAddition';
import { defaultStructureAddition } from '../qualityAdditionStructure';
import { makeQualityBuyFilter, makeQualityHoldingVeto } from '../qualityFilters';
import { QUALITY_ADVANTAGE_VERSION, type QualityAdvantageObservation } from '../qualityAdvantage';
const mock=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../qualityAdvantage',async original=>({...await original<typeof import('../qualityAdvantage')>(),createQualityAdvantageReader:()=>mock.read}));
const M=60000,T=Date.UTC(2026,9,29);
const def={id:'test',name:'测试',short:'测试',definition:'',formula:'raw = B',scale:1,unit:'',positive:'1',control:'0',interval:'1m' as const};
const snapshot={featureId:def.id,featureName:def.name,featureShort:def.short,definitionKey:definitionKey(def),statistic:'raw',interval:'1m',scale:1,threshold:.5,direction:'>' as const,average:1,cbi2:1,startAverage:1,previousAverage:0,cutoffMs:T};
const sample:QualitySample={id:'s',enteredAt:T,basis:'capture',importedAt:T,groups:[],source:{id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:'',fish:snapshot}};
const state=makeQualityBuyFilter('state:state','>',.65,true,BUILTIN_FEATURES);
const group=():QualityGroup=>({id:'g',label:'测试',metric:'raw',snapshot,rule:{metric:'raw',direction:'>',threshold:1.5},execution:'intrabar-1m',mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50},
  addition:{...defaultQualityAddition(),enabled:true,maxRounds:4,source:'custom',condition:{id:'a',label:'加仓',metric:'raw',direction:'>',threshold:.5,enabled:true,snapshot}},
  advantage:{version:QUALITY_ADVANTAGE_VERSION,state:{snapshot:state.snapshot,metric:'state'},structure:defaultStructureAddition(),screenWeak:true,beforeFirst:true,afterAddition:true,confirmations:2}});
const bar=(at:number,open=100,volume=0,low=open-1,high=open+1):ResearchBar=>({openTime:at,open,close:open,low,high,volume,quoteVolume:100,takerBuyVolume:0,takerBuyQuoteVolume:volume});
const loader=(path:(m:number)=>ResearchBar):FishReconstructionLoader=>async(_row,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{const at=from+i*p.step;return p.step===M&&at>=T?path((at-T)/M):bar(at);});
const rising=(m:number)=>bar(T+m*M,100+m*10,m<1?1:2,99+m*10,m===0?106:101+m*10);
const run=async(g:QualityGroup,n=6,previous?:Awaited<ReturnType<typeof evaluateQualitySample>>,load=loader(rising))=>{
 const r=await evaluateQualitySample(sample,g,0,T+n*M,load,new AbortController().signal,previous);expect(r.status,r.reason).not.toBe('error');return r;
};
beforeEach(()=>{mock.read.mockReset().mockImplementation(async(at:number):Promise<QualityAdvantageObservation>=>({at:Math.floor(at/(5*M))*5*M,grade:'A',structureValid:true}));});

it('confirms soft exits across a successful addition without resetting the streak; resume is identical',async()=>{
 const g=group(),r=await run(g);
 expect(r).toMatchObject({status:'closed',endTime:T+3*M,exitSnapshot:{advantage:{count:2,required:2}}});
 expect(r.additionFills).toHaveLength(2);
 for(const n of [2,3])expect(await run(g,6,await run(g,n))).toEqual(r);
 const original=await run({...g,advantage:undefined});expect(original.endTime).toBe(T+2*M);expect(original.additionFills).toHaveLength(1);
 expect(r.additionFills![0].quantity).toBe(original.additionFills![0].quantity);
 expect(r.additionFills![0].sizing).toEqual(original.additionFills![0].sizing);
});
it('ordinary B still adds at full original size and exits with the original single reading after amplification',async()=>{
 mock.read.mockImplementation(async(at:number)=>({at,grade:'B',structureValid:true}));
 const g=group(),r=await run(g),old=await run({...g,advantage:undefined});
 expect(r.endTime).toBe(old.endTime);expect(r.additionFills![0].quantity).toBe(old.additionFills![0].quantity);
});
it('weak rejection consumes neither a round nor mirror profit; a later eligible opportunity uses the full formula',async()=>{
 mock.read.mockImplementation(async(at:number)=>({at,grade:at===T+M?'W':'A',structureValid:true}));
 const g=group();g.rule!.threshold=99;const r=await run(g,4);
 expect(r.additionVetoes?.[0]).toMatchObject({at:T+M,round:1,kind:'advantage-weak'});
 const fill=r.additionFills![0];expect(fill.at).toBe(T+2*M);expect(fill.sizing).toMatchObject({coinsBefore:.5,mirrorAvailableBefore:2.5,previousSupport:100});
 expect(fill.quantity).toBeCloseTo((.5*(fill.sizing!.support-100)+2.5)/(fill.price-fill.sizing!.support),12);
 expect(r.additionFills).toHaveLength(2);
});
it('missing auxiliary observations fall back to original adds and single exits and leave an audit record',async()=>{
 mock.read.mockResolvedValue({at:T,grade:'U',reason:'测试缺口'});
 const g=group(),r=await run(g),old=await run({...g,advantage:undefined});
 expect(r.endTime).toBe(old.endTime);expect(r.pnl).toBe(old.pnl);
 expect(r.additionSkips?.some(s=>s.kind==='advantage-unavailable')).toBe(true);
});
it('a K stop is never delayed by soft confirmation',async()=>{
 const g=group(),r=await run(g,4,undefined,loader(m=>m===0?rising(m):bar(T+m*M,110,2,106,111)));
 expect(r).toMatchObject({status:'closed',endTime:T+M,endPrice:107,exitSnapshot:{cause:{kind:'addition-support'}}});
});
it('an immediate hard exit takes priority even when the auxiliary reader cannot run',async()=>{
 mock.read.mockRejectedValue(Error('必须不读取'));
 const g=group();g.holdingVetoes=[makeQualityHoldingVeto('static-drawdown','>=',5)];g.vetoFill='stop';
 const r=await run(g,4,undefined,loader(m=>bar(T+m*M,100,1,90,101)));
 expect(r).toMatchObject({status:'closed',endTime:T,endPrice:95});expect(mock.read).not.toHaveBeenCalled();
});
it('a seller stage switch resets confirmation but a confirmed same-open exit blocks an add',async()=>{
 const g=group();g.rule!.threshold=.5;g.sellStages=[{afterAdditions:1,label:'切换',metric:'raw',snapshot,rule:{metric:'raw',direction:'>',threshold:1.5}}];
 const r=await run(g);expect(r).toMatchObject({status:'closed',endTime:T+3*M,exitSnapshot:{advantage:{count:2}}});expect(r.additionFills).toHaveLength(2);
});
it('turning all overlay switches off preserves original trading outcomes',async()=>{
 const g=group();Object.assign(g.advantage!,{screenWeak:false,beforeFirst:false,afterAddition:false});
 mock.read.mockResolvedValue({at:T,grade:'W',structureValid:true});
 const r=await run(g),old=await run({...g,advantage:undefined});
 for(const k of ['endTime','endPrice','pnl','totalInvested','remainingQuantity'] as const)expect(r[k]).toBe(old[k]);
 expect(r.additionFills?.map(f=>[f.at,f.quantity,f.sizing])).toEqual(old.additionFills?.map(f=>[f.at,f.quantity,f.sizing]));
});
