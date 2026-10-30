import {expect,it} from 'vitest';
import {qualityDetectorLabel,QUALITY_LABEL_ZERO_TOLERANCE} from '@/lib/fish/qualityDetectorLabel';
import {enableQualityComparison} from '@/lib/fish/qualityComparison';
import {newQualityStudy,type QualityResult} from '@/lib/fish/quality';
const plan={...enableQualityComparison(newQualityStudy()).sellPlans![0],mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50}};
const fill={at:2000,price:105,fraction:.5,gainPct:5,atOpen:false};
const result=(roi:number,mirror=true):QualityResult=>({key:'frozen',sampleId:'s',groupId:plan.id,status:'closed',evaluatedAt:5000,entryTime:1000,entryPrice:100,endTime:4000,endPrice:90,returnPct:roi,peakPct:20,...(mirror?{mirrorFill:fill}:{})});
it('implements exactly the three specified classes using final whole-position ROI and actual mirror execution',()=>{
 expect(qualityDetectorLabel(plan,result(0)).code).toBe('mild-false');expect(qualityDetectorLabel(plan,result(-3,false)).code).toBe('severe-false');expect(qualityDetectorLabel(plan,result(2)).code).toBe('hit');
 expect(qualityDetectorLabel(plan,result(QUALITY_LABEL_ZERO_TOLERANCE/10)).code).toBe('mild-false');expect(qualityDetectorLabel(plan,result(-QUALITY_LABEL_ZERO_TOLERANCE/10)).code).toBe('mild-false');
 // A final price below entry does not imply a losing combined mirror/addition outcome.
 expect(qualityDetectorLabel(plan,{...result(1),additionFill:{at:2500,price:80,notional:100,quantity:1.25,reading:1,threshold:1,definitionKey:'x',scanFrom:1000,direction:'>',metric:'MBI',label:'加仓测试',barOpenTime:2000},totalInvested:200}).label).toBe('准确击中');
});
it('does not manufacture a mirror fill from a peak or arbitrarily extend the requested three labels',()=>{
 expect(qualityDetectorLabel(plan,result(-1,false)).label).toBe('严重误报');
 for(const r of [result(1,false),result(0,false),result(-1,true)])expect(qualityDetectorLabel(plan,r).code).toBe('unclassified');
 expect(qualityDetectorLabel({...plan,mirrorTakeProfit:undefined},result(-1,false)).code).toBe('disabled');
 expect(qualityDetectorLabel({...plan,mirrorTakeProfit:undefined},result(1,true)).code).toBe('hit');
});
it('keeps unfinished, failed, unbought and invalid execution records out of definitive labels',()=>{
 expect(qualityDetectorLabel(plan).code).toBe('pending');expect(qualityDetectorLabel(plan,{...result(3),status:'open'}).code).toBe('pending');expect(qualityDetectorLabel(plan,{...result(3),status:'error'}).code).toBe('error');expect(qualityDetectorLabel(plan,result(-3,false),true).code).toBe('unbought');
 for(const invalid of [{...result(1),returnPct:NaN},{...result(1),endTime:undefined},{...result(1),endTime:Infinity},{...result(-1,false),entryTime:undefined},{...result(-1,false),entryPrice:0},{...result(1),endPrice:NaN},{...result(1),mirrorFill:{...fill,at:5000}},{...result(1),mirrorFill:{...fill,fraction:0}},{...result(1),mirrorFill:{...fill,price:Infinity}}])expect(qualityDetectorLabel(plan,invalid).code).toBe('error');
});
it('is derived per sell result without mutating saved signals, strategies or monetary results',()=>{
 const r=result(0),before=JSON.stringify([plan,r]);expect(qualityDetectorLabel(plan,r).rank).toBe(1);expect(JSON.stringify([plan,r])).toBe(before);expect(qualityDetectorLabel(plan,result(-2,false)).rank).toBe(0);expect(qualityDetectorLabel(plan,result(1)).rank).toBe(2);
});
