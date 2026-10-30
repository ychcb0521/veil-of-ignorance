import {expect,it} from 'vitest';
import {qualityAlgorithmExit,qualitySellError,sellErrorExportValues} from '@/lib/fish/qualitySellError';
import {POST_EXIT_HOURS,qualityPostExitKey,evaluateQualityPostExit,type QualityPostExitReading} from '@/lib/fish/qualityPostExit';
import {enableQualityComparison} from '@/lib/fish/qualityComparison';
import {newQualityStudy,evaluateQualitySample,type QualityResult,type QualityGroup,type QualitySample} from '@/lib/fish/quality';
import {definitionKey} from '@/lib/deepDig/features';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
const T=Date.UTC(2026,9,20),M=60000,NOW=T+8*3600000;
const source={id:'s',symbol:'TESTUSDT',timeMs:T-M,timeLabel:'',fallbackZone:''};
const plan:QualityGroup={...enableQualityComparison(newQualityStudy()).sellPlans![0],rule:{metric:'state',direction:'<',threshold:.5}};
const result:QualityResult={key:'frozen',sampleId:'s',groupId:plan.id,status:'closed',evaluatedAt:T+M,entryTime:T-3600000,entryPrice:100,endTime:T,endPrice:110,returnPct:10,pnl:10,exitReading:.4,exitSnapshot:{barOpenTime:T-5*M,observedAt:T}};
const reading=(r=result,p=plan):QualityPostExitReading=>({key:qualityPostExitKey(source,r,p)!,evaluatedAt:NOW,exitTime:r.endTime!,exitPrice:r.endPrice!,startMs:r.endTime!,excludedExitMinute:false,windows:POST_EXIT_HOURS.map(hours=>({hours,status:'ready',peakPct:4,drawdown2Pct:1}))});
const tag=(peakPct:number,drawdown2Pct:number)=>qualitySellError(source,plan,result,{...reading(),windows:[{hours:.5,status:'ready',peakPct,drawdown2Pct}]},.5,false,NOW);
it('uses strict twice-drawdown comparison independently for each window, including zero and floating equality',()=>{
 for(const [peak,dd,expected] of [[4,1,1],[2,1,0],[1,1,0],[1,0,1],[0,0,0],[2+1e-8,1,1],[2+Number.EPSILON*4,1,0]] as const)expect(tag(peak,dd).value).toBe(expected);
 for(const [peak,dd] of [[NaN,1],[1,NaN],[-1,0],[1,-1],[Infinity,1],[1,101]])expect(tag(peak,dd).code).toBe('error');
 const r=reading();r.windows=r.windows.map((w,i)=>({...w,peakPct:[4,2,1,0,3][i],drawdown2Pct:[1,1,0,0,2][i]}));
 expect(POST_EXIT_HOURS.map(h=>qualitySellError(source,plan,result,r,h,false,NOW).value)).toEqual([1,0,1,0,0]);
 expect(sellErrorExportValues(source,result,plan,[r],false,NOW)).toEqual(['卖出误报','未达误报','卖出误报','未达误报','未达误报']);
});
it('attributes only recorded algorithm exits and excludes all veto/mirror causes even if its own rule also qualifies',()=>{
 expect(qualityAlgorithmExit(plan,result)).toBeNull();
 for(const kind of ['static-drawdown','dynamic-drawdown','drop-1m','drop-5m','indicator','mirror-take-profit'] as const){const r={...result,exitSnapshot:{...result.exitSnapshot!,cause:{id:'v',kind,label:'独立触发',direction:'<' as const,threshold:1}}};expect(qualitySellError(source,plan,r,reading(r),.5,false,NOW).code).toBe('other-exit');}
 expect(qualityAlgorithmExit(plan,{...result,mirrorFill:{at:T-M,price:105,fraction:.5,gainPct:5,atOpen:false}})).toBeNull();
 expect(qualityAlgorithmExit(plan,{...result,mirrorFill:{at:T,price:110,fraction:1,gainPct:10,atOpen:false}})?.code).toBe('other-exit');
 expect(qualityAlgorithmExit(plan,{...result,exitSnapshot:undefined,reason:undefined})?.code).toBe('unknown-cause');
 expect(qualityAlgorithmExit(plan,{...result,status:'open'})?.code).toBe('pending');expect(qualityAlgorithmExit(plan,result,true)?.code).toBe('unbought');
 expect(qualityAlgorithmExit(plan,{...result,status:'error'})?.code).toBe('error');
});
it('keeps combination stages and legacy evidence tied to the frozen triggered rule',()=>{
 const combo={...plan,combo:{switchPct:5,beforeLabel:'前段',after:{label:'后段',metric:'CDA',snapshot:plan.snapshot,rule:{metric:'CDA',direction:'<' as const,threshold:-.5}}}};
 expect(qualityAlgorithmExit(combo,{...result,exitSnapshot:{...result.exitSnapshot!,stage:'before'}})).toBeNull();
 const after={...result,exitReading:-.6,exitSnapshot:{...result.exitSnapshot!,stage:'after' as const}};
 expect(qualitySellError(source,combo,after,reading(after,combo),.5,false,NOW)).toMatchObject({code:'false-exit',detail:expect.stringContaining('组合后段：后段')});
 expect(qualityAlgorithmExit(combo,{...after,exitReading:.4})?.code).toBe('unknown-cause');
 expect(qualityAlgorithmExit(combo,result)?.code).toBe('unknown-cause');
 expect(qualityAlgorithmExit(plan,{...result,exitSnapshot:undefined,reason:'指标收盘确认，下一分钟开盘卖出'})).toBeNull();
 expect(qualityAlgorithmExit(plan,{...result,exitSnapshot:undefined,reason:'指标收盘确认，下一分钟开盘卖出',exitReading:1})?.code).toBe('unknown-cause');
 expect(qualityAlgorithmExit(plan,{...result,exitSnapshot:undefined,reason:'一票否决：静态止损'})?.code).toBe('other-exit');
 expect(qualityAlgorithmExit(plan,{...result,exitSnapshot:{...result.exitSnapshot!,observedAt:T-M}})?.code).toBe('unknown-cause');
});
it('never turns an unfinished, missing, failed, invalid or differently keyed window into a definitive label',()=>{
 expect(qualitySellError(source,plan,result,reading(),1,false,T+59*M).label).toBe('待满1h');
 expect(qualitySellError(source,plan,result,undefined,.5,false,NOW).label).toBe('待补算');
 const error={...reading(),windows:[{hours:.5 as const,status:'error' as const,error:'行情缺根'}]};expect(qualitySellError(source,plan,result,error,.5,false,NOW)).toMatchObject({label:'缺数据',detail:'行情缺根'});
 for(const r of [{...reading(),key:'old'},{...reading(),exitPrice:100},{...reading(),exitTime:T-M}])expect(qualitySellError(source,plan,result,r,.5,false,NOW).label).toBe('待补算');
 expect(qualitySellError({...source,exchange:'bybit'},plan,result,reading(),.5,false,NOW).label).toBe('待补算');
 expect(qualitySellError(source,plan,{...result,endTime:Infinity},reading(),.5,false,NOW).code).toBe('error');
 expect(qualitySellError(source,plan,result,{...reading(),windows:[{hours:.5,status:'ready'}]},.5,false,NOW).code).toBe('error');
});
it('uses sale-price-based counterfactuals regardless of prior return/peak/drawdown, preserving all inputs',()=>{
 const r={...result,returnPct:-30,pnl:-30,peakPct:300,adversePct:-90,drawdownPct:50},cache=reading(r),before=JSON.stringify([plan,r,cache]);
 expect(qualitySellError(source,plan,r,cache,.5,false,NOW).code).toBe('false-exit');expect(JSON.stringify([plan,r,cache])).toBe(before);
});
it('recognises actual replay trigger records and uses the existing counterfactual engine without changing the sell result',async()=>{
 const def={id:'sell-error-test',name:'价格',short:'价格',formula:'raw = C',definition:'',scale:1,unit:'',positive:'1',control:'0',interval:'5m' as const};
 const g:QualityGroup={...plan,metric:'raw',execution:'intrabar-1m',rule:{metric:'raw',direction:'<',threshold:95},snapshot:{...plan.snapshot,featureId:def.id,statistic:'raw',definitionKey:definitionKey(def)}};
 const sample:QualitySample={id:'s',source,enteredAt:T,basis:'signal',importedAt:T,groups:[]};
 const load:FishReconstructionLoader=async(_s,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>{const t=a+i*p.step,open=t===T+2*M?92:100,close=t===T+M?90:open;return {openTime:t,open,high:Math.max(open,close),low:Math.min(open,close),close,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50};});
 const exit=await evaluateQualitySample(sample,g,0,T+10*M,load,new AbortController().signal);expect(exit.status).toBe('closed');expect(qualityAlgorithmExit(g,exit)).toBeNull();
 const before=JSON.stringify(exit),out=await evaluateQualityPostExit({source,plan:g,result:exit},async(_s,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>({openTime:a+i*p.step,open:exit.endPrice!,close:exit.endPrice!,high:exit.endPrice!*1.04,low:exit.endPrice!*.99,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50})),NOW,new AbortController().signal);
 expect(POST_EXIT_HOURS.map(h=>qualitySellError(source,g,exit,out,h,false,NOW).value)).toEqual([1,1,1,1,1]);expect(JSON.stringify(exit)).toBe(before);
 const stop=await evaluateQualitySample(sample,{...g,vetoFill:'stop',holdingVetoes:[{id:'stop',label:'止损',kind:'static-drawdown',enabled:true,direction:'>=',threshold:5}]},0,T+10*M,load,new AbortController().signal);
 expect(stop.exitSnapshot?.cause?.kind).toBe('static-drawdown');expect(qualityAlgorithmExit(g,stop)?.code).toBe('other-exit');
});
