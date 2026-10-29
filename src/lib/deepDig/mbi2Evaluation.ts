import { computeMbi2, mbi2HoursOf, mbi2NOf, mbi2ConfirmOf, type Mbi2Params } from '@/lib/mbi2';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { DeepDigData, DeepDigRowGroup, DefinitionSnapshot } from './analysis';
import { runInference } from './commands';

export interface Mbi2StudySample { id:string; group:DeepDigRowGroup; anchorMs:number; bars:readonly ResearchBar[] }
export interface Mbi2ScanRow {
  kind:'hours'|'band';hours:number;band:number;n:number;positiveN:number;controlN:number;missing:number;
  positiveProbe:number|null;positiveConfirm:number|null;leadMedian:number|null;confirmMedian:number|null;
  controlProbe:number|null;controlConfirm:number|null;probePer1000:number|null;confirmPer1000:number|null;
  balancedAccuracy:number|null;auc:number|null;accuracyReason?:string;
}
export interface Mbi2Recommendation {campaignId:string;delta:number|null;nMin:number|null;ceilN:number|null;hours:number|null;reason?:'nonpositive_delta'|'missing' }
export interface Mbi2Evaluation {minutes:number;scan:Mbi2ScanRow[];recommendations:Mbi2Recommendation[];q25:number|null;q50:number|null;q75:number|null;excludedDelta:number;missingCampaigns:number;positiveRule:string;controlRule:string;accuracyMethod:string}
const finite=(x:number|null|undefined):x is number=>x!=null&&Number.isFinite(x);
const ratio=(x:number,n:number)=>n?x/n:null;
export function mbi2Quantile(values:readonly number[],q:number):number|null {
  if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),p=(a.length-1)*q,lo=Math.floor(p);return a[lo]+(a[Math.ceil(p)]-a[lo])*(p-lo);
}
export function mbi2ScanSettings(minutes:number,p:Mbi2Params={}) {
  return [...[2,4,8,12,24,48].map(hours=>({kind:'hours' as const,hours,band:.2})),
    ...[0,.1,.2,.3].map(band=>({kind:'band' as const,hours:mbi2HoursOf({},minutes),band}))];
}
/** Every setting takes exactly its own 48h+5n prefix, never a relabelled or future sample. */
export function scanMbi2(samples:readonly Mbi2StudySample[],definition:DefinitionSnapshot,minutes:number):Mbi2ScanRow[] {
  const step=minutes*60000;
  return mbi2ScanSettings(minutes,definition).map(setting=>{
    const p={...definition,MBI2_T_HOURS:setting.hours,MBI2_BAND:setting.band},n=mbi2NOf(p,minutes);
    const positive:{state:number;lead:number;confirm:number}[]=[],control:typeof positive=[],classification:DeepDigData['rows']=[];
    let missing=0,controlBars=0,starts=0,confirms=0;
    for(const sample of samples){
      if(sample.group!=='positive'&&sample.group!=='control')continue;
      const bars=sample.bars.filter(b=>b.openTime>=sample.anchorMs-(48*60/minutes+5*n)*step&&b.openTime+step<=sample.anchorMs).slice().sort((a,b)=>a.openTime-b.openTime);
      if(bars.length<Math.floor(48*60/minutes)+5*n-1||bars.some((b,i)=>i>0&&b.openTime-bars[i-1].openTime!==step)){missing++;continue;}
      const out=computeMbi2(bars.map(b=>b.close),p,minutes,{times:bars.map(b=>b.openTime)}),i=bars.length-1;
      if(!finite(out.state[i])){missing++;continue;}
      const row={state:out.state[i],lead:out.lead[i],confirm:out.confirm[i]};(sample.group==='positive'?positive:control).push(row);
      classification.push({id:sample.id,symbol:'',anchorMs:sample.anchorMs,group:sample.group,memberIds:[],v:out.mbi[i],vars:{MBI2:out.mbi[i]},endRet:null,maxUp:null,maxDown:null,period:'discovery'});
      if(sample.group==='control')bars.forEach((b,k)=>{if(b.openTime+step>sample.anchorMs-48*3600000&&finite(out.state[k])){controlBars++;starts+=out.buyStarts[k];confirms+=out.buyConfirms[k];}});
    }
    // Identical existing logistic-CV path and metric; no new accuracy definition or future outcome target.
    const result=runInference({definition,rows:classification,finishedAt:1},'ml(实验组 ~ X, model=logistic, cv=5, perm=0)').blocks[0];
    const ml=result?.kind==='ml'?result:null;
    return {...setting,n,positiveN:positive.length,controlN:control.length,missing,
      positiveProbe:ratio(positive.filter(r=>r.state>=1).length,positive.length),positiveConfirm:ratio(positive.filter(r=>r.state===2).length,positive.length),
      leadMedian:mbi2Quantile(positive.map(r=>r.lead),.5),confirmMedian:mbi2Quantile(positive.map(r=>r.confirm),.5),
      controlProbe:ratio(control.filter(r=>r.state>=1).length,control.length),controlConfirm:ratio(control.filter(r=>r.state===2).length,control.length),
      probePer1000:controlBars?1000*starts/controlBars:null,confirmPer1000:controlBars?1000*confirms/controlBars:null,
      balancedAccuracy:ml?.balancedAccuracy??null,auc:ml?.auc??null,...(result?.kind==='error'?{accuracyReason:result.message}:{})};
  });
}
export function recommendMbi2(cStart:number,cEnd:number,K:number,s:number,minutes=5,short=false,confirm=.8,z0=1.25) {
  if(!(cStart>0&&cEnd>0&&K>0&&s>0&&minutes>0&&confirm>0&&confirm<1))return {delta:null,nMin:null,ceilN:null,hours:null,reason:'missing' as const};
  const delta=(short?-1:1)*Math.log(cEnd/cStart)/K/s;
  if(delta<=0)return {delta,nMin:null,ceilN:null,hours:null,reason:'nonpositive_delta' as const};
  const zTheta=z0*Math.atanh(confirm),nMin=((zTheta/delta)**2+1)/2,ceilN=Math.ceil(nMin);
  return {delta,nMin,ceilN,hours:ceilN*minutes/60};
}
/** Retrospective campaign path only; none of these post-entry prices enter anchor features or scans. */
export function recommendMbi2Campaign(campaignId:string,bars:readonly ResearchBar[],minutes:number,short:boolean,p:Mbi2Params={}):Mbi2Recommendation {
  const returns=bars.slice(1).map((b,i)=>Math.log(b.close/bars[i].close)),mean=returns.reduce((a,b)=>a+b,0)/returns.length;
  const s=returns.length>=2?Math.sqrt(returns.reduce((a,b)=>a+(b-mean)**2,0)/(returns.length-1)):NaN;
  if(bars.some((b,i)=>i>0&&b.openTime-bars[i-1].openTime!==minutes*60000))return {campaignId,delta:null,nMin:null,ceilN:null,hours:null,reason:'missing'};
  return {campaignId,...recommendMbi2(bars[0]?.close,bars.at(-1)?.close,bars.length,s,minutes,short,mbi2ConfirmOf(p))};
}
export function finishMbi2Evaluation(scan:Mbi2ScanRow[],recommendations:Mbi2Recommendation[],definition:DefinitionSnapshot,minutes:number):Mbi2Evaluation {
  const values=recommendations.map(r=>r.hours).filter(finite);
  return {minutes,scan,recommendations,q25:mbi2Quantile(values,.25),q50:mbi2Quantile(values,.5),q75:mbi2Quantile(values,.75),excludedDelta:recommendations.filter(r=>r.reason==='nonpositive_delta').length,missingCampaigns:recommendations.filter(r=>r.reason==='missing').length,positiveRule:definition.positive,controlRule:definition.control,accuracyMethod:'既有 ml：逻辑回归、5折交叉验证，平衡准确率和样本外AUC；两类各至少5例。'};
}
export function mbi2EvaluationCsv(report:Mbi2Evaluation):string {
 const keys:(keyof Mbi2ScanRow)[]=['kind','hours','band','n','positiveN','controlN','positiveProbe','positiveConfirm','leadMedian','confirmMedian','controlProbe','controlConfirm','probePer1000','confirmPer1000','balancedAccuracy','auc','missing'];
 return '\uFEFF'+[keys.join(','),...report.scan.map(r=>keys.map(k=>r[k]??'').join(','))].join('\r\n');
}
