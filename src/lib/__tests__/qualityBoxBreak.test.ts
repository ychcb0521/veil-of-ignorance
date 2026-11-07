import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as features from '@/lib/deepDig/features';
import {BOX_BREAK_CHOICE,BOX_BREAK_VERSION,boxStopIdentity,createBoxStopReader,defaultBoxBreak,defaultBoxStop,validateBoxStop} from '@/lib/fish/qualityBoxStop';
import {evaluateQualitySample,type QualityGroup,type QualitySample} from '@/lib/fish/quality';
import {holdingVetoDraft,parseHoldingVetoDraft} from '@/lib/fish/qualityFilters';
import {freezeQualityPlan,planVersionChanges} from '@/lib/fish/qualityPlanVersions';
import {stagedHoldingVetoes} from '@/lib/fish/qualityVetoStages';
import type {QualityHoldingVeto} from '@/lib/fish/qualityVeto';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
import type {ResearchBar} from '@/lib/deepRsa/window';
const M=60000,T=Date.UTC(2026,9,20),signal=new AbortController().signal;
const row={id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''};
const sample:QualitySample={id:'s',enteredAt:T,basis:'signal',importedAt:T,groups:[],source:row};
const bar=(at:number,open=100,low=99,close=100):ResearchBar=>({openTime:at,open,high:Math.max(open,close),low,close,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50});
let broken:(at:number)=>boolean,invalid=false;
beforeEach(()=>{
 broken=()=>false;invalid=false;
 vi.spyOn(features,'evaluateOnBars').mockImplementation(bars=>({vars:new Map(),DBL5_details:bars.map(b=>({at:b.openTime+5*M,data_valid:!invalid,darvas_5m_guard:null,darvas_5m_available:false,darvas_5m_guard_broken:broken(b.openTime+5*M)}))} as unknown as ReturnType<typeof features.evaluateOnBars>));
});
afterEach(()=>vi.restoreAllMocks());
const veto=(rule=defaultBoxBreak()):QualityHoldingVeto=>({id:'break',label:'支撑断裂',kind:'box-stop',direction:'<=',threshold:0,enabled:true,boxStop:rule});
const load=(minute:(t:number)=>ResearchBar=bar):FishReconstructionLoader=>async(_row,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>p.step===M?minute(a+i*M):bar(a+i*p.step));
const reader=()=>createBoxStopReader({vetoes:[veto()],row,entry:T,since:T,load:load(),signal});
const plan=():QualityGroup=>({id:'g',label:'红叉',metric:'raw',vetoFill:'stop',holdingVetoes:[veto()],snapshot:{featureId:'p',definitionKey:'C',statistic:'raw',interval:'5m',scale:1,threshold:0,direction:'<',average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:T}});

it('does not treat a low wick, an absent support or a warmup break as a post-entry red cross',async()=>{
 broken=at=>at<=T;
 const r=reader();expect(await r.read(bar(T,100,1))).toBeUndefined();expect(await r.read(bar(T+5*M,100,1))).toBeUndefined();
});
it('uses the exact native red-cross event only after its 5m close and sells at the following open',async()=>{
 broken=at=>at===T+5*M;
 const r=reader();expect(await r.read(bar(T+4*M,100,1))).toBeUndefined();
 expect(await r.read(bar(T+5*M,82,1,120))).toMatchObject({at:T+5*M,fillPrice:82,atOpen:true,barOpenTime:T,cause:{boxBreakEvidence:{version:BOX_BREAK_VERSION,event:'darvas_5m_guard_broken',confirmedAt:T+5*M,sourceBarOpenTime:T}}});
});
it('saves execution evidence and resumes identically without needing additions or mirror fills',async()=>{
 broken=at=>at===T+5*M;
 const g=plan(),l=load(t=>t===T+5*M?bar(t,82,1,120):bar(t));
 const first=await evaluateQualitySample(sample,g,0,T+4*M,l,signal);
 expect(first.status).toBe('open');
 const continued=await evaluateQualitySample(sample,g,0,T+8*M,l,signal,first);
 expect(continued).toMatchObject({status:'closed',endTime:T+5*M,endPrice:82,exitSnapshot:{cause:{boxBreakEvidence:{confirmedAt:T+5*M}}}});
 expect(continued.reason).toContain('红叉已确认');expect(continued.reason).not.toContain('跳空越线');
 expect(continued).toEqual(await evaluateQualitySample(sample,g,0,T+8*M,l,signal));
});
it('never fills at an invented guard price when only the execution open is available',async()=>{
 broken=at=>at===T+5*M;
 const g=plan(),l=load(t=>t===T+5*M?bar(t,70,1,120):bar(t));
 expect((await evaluateQualitySample(sample,g,0,T+5*M,l,signal)).status).toBe('open');
 expect(await evaluateQualitySample(sample,g,0,T+6*M,l,signal)).toMatchObject({endTime:T+5*M,endPrice:70});
});
it('keeps red-cross and price-stop rules independent through saved drafts and stage overlays',()=>{
 const touch=veto(defaultBoxStop()),event=veto();touch.id='touch';
 const draft=holdingVetoDraft([touch,event]);expect(draft.map(d=>d.choice)).toEqual(['box-stop',BOX_BREAK_CHOICE]);
 const saved=parseHoldingVetoDraft(draft);expect(saved.map(v=>v.boxStop)).toEqual([touch.boxStop,event.boxStop]);
 const g={...plan(),holdingVetoes:[touch],vetoStages:[{afterAdditions:1,conditions:[event]}]};
 expect(stagedHoldingVetoes(g,1)).toEqual([touch,event]);
 const frozen=freezeQualityPlan(g);expect(planVersionChanges(frozen)).toEqual([]);
 expect(freezeQualityPlan(plan()).frozenVersions!.some(v=>v.version.includes(BOX_BREAK_VERSION))).toBe(true);
 expect(boxStopIdentity(defaultBoxBreak())).not.toEqual(boxStopIdentity(defaultBoxStop()));
});
it('rejects missing data and incompatible event versions or price confirmations',async()=>{
 invalid=true;await expect(reader().read(bar(T))).rejects.toThrow('不能跳过缺口');
 expect(()=>validateBoxStop({...defaultBoxBreak(),confirmation:'touch'})).toThrow('原生红叉');
 expect(()=>validateBoxStop({...defaultBoxBreak(),structure:{...defaultBoxBreak().structure,buffer:.5}})).toThrow('原生红叉');
 expect(()=>validateBoxStop({...defaultBoxStop(),confirmation:'guard-break'})).toThrow('确认根数');
});
it('matches the unmocked DBL-5 red-cross renderer flag on a native market sequence',async()=>{
 vi.restoreAllMocks();
 const {computeDbl5,dbl5Numeric}=await import('@/lib/dbl5m');
 const rule=defaultBoxBreak(),step=5*M,from=T-Math.ceil(features.featureWindowMs(rule.structure.definition)/step)*step;
 let seed=7,price=10000;
 const random=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648);
 const bars=Array.from({length:700},(_,i)=>{
  const drift=i<200?0:i<500?6:(11800-price)*.02,open=price,close=Math.max(100,Math.round(open+drift+(random()-.5)*60));
  const wick=i>=500&&random()<.08?120:20,high=Math.max(open,close)+Math.round(random()*20),low=Math.max(1,Math.min(open,close)-Math.round(random()*wick));price=close;
  return {...bar(from+i*step,open,low,close),high,DBL5_tick_size:1,DBL5_closed:true};
 });
 const expected=computeDbl5(bars,{symbol:row.symbol,tickSize:1,config:rule.structure.definition.DBL5_config,initializationStart:from}).rows.find(r=>r.at>T&&dbl5Numeric(r,'_DBL5_guard_broken')===1)!;
 expect(expected).toBeDefined();
 const nativeLoad:FishReconstructionLoader=async(_row,a,b)=>bars.filter(x=>x.openTime>=a&&x.openTime<b);
 const r=createBoxStopReader({vetoes:[veto(rule)],row,entry:T,since:T,load:nativeLoad,signal});
 expect(await r.read(bar(expected.at-M))).toBeUndefined();
 expect(await r.read(bar(expected.at,123))).toMatchObject({at:expected.at,fillPrice:123,cause:{boxBreakEvidence:{confirmedAt:expected.at}}});
});
