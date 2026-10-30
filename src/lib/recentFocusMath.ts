/** Additional relative temporal weights. Legacy calls never enter this module's weighted paths. */
import {computeMbi} from './mbi';
import {computeMbi2Core} from './mbi2';
export const FOCUS_BASE_ARITIES:Readonly<Record<string,readonly number[]>>={avg:[2],sd:[2],zscore:[2],ema:[2,3],retain:[4,5],wsum:[3],rsum:[2],median:[2],mad:[2],rscale:[2],sma:[2],sum:[2],msum:[2],atr:[4],beta:[3],mbiz:[2],mbiz2:[2],ctba:[17]};
export interface RecentFocus {bars:number;weight:number}
export function recentFocus(hours:number,weight:number,minutes:number):RecentFocus {
 if(!(hours>0)||!Number.isFinite(hours)||!(weight>=1)||!Number.isFinite(weight)||!(minutes>0))throw Error('最近加权时长须为正数，权重须为大于等于1的有限数');
 const bars=Math.max(1,Math.round(hours*60/minutes));if(!Number.isSafeInteger(bars)||bars>100000)throw Error('最近加权时长超出有效根数');return {bars,weight};
}
/** Analytic reliability-weight variance: Σw(x−μ)² / (Σw − Σw²/Σw). */
export function focusRolling(x:Float64Array,n:number,f:RecentFocus,kind:'avg'|'sd'|'zscore'|'rsum'|'sma'|'sum'):Float64Array {
 const out=new Float64Array(x.length).fill(NaN),l=Math.min(n,f.bars),d=f.weight-1,d2=f.weight*f.weight-1;
 let sum=0,sq=0,count=0,recent=0,recentSq=0,recentCount=0;
 for(let t=0;t<x.length;t++){
  if(Number.isFinite(x[t])){sum+=x[t];sq+=x[t]*x[t];count++;recent+=x[t];recentSq+=x[t]*x[t];recentCount++;}
  if(t>=n&&Number.isFinite(x[t-n])){sum-=x[t-n];sq-=x[t-n]*x[t-n];count--;}
  if(t>=l&&Number.isFinite(x[t-l])){recent-=x[t-l];recentSq-=x[t-l]*x[t-l];recentCount--;}
  if(!count||(kind==='sma'||kind==='sum')&&(t<n-1||count!==n))continue;
  const w=count+d*recentCount,w2=count+d2*recentCount,mean=(sum+d*recent)/w;
  if(kind==='avg'||kind==='sma'){out[t]=mean;continue;}
  if(kind==='sum'||kind==='rsum'){out[t]=mean*count;continue;}
  if(count<2)continue;
  const numerator=sq+d*recentSq-w*mean*mean,den=w-w2/w,sd=den>0&&numerator>0?Math.sqrt(numerator/den):0;
  out[t]=kind==='sd'?sd:Number.isFinite(x[t])&&sd>1e-12*Math.max(1,Math.abs(mean))?(x[t]-mean)/sd:NaN;
 }return out;
}
/** Reweight an existing EMA kernel, not its nominal half-life/alpha or a final score. */
export function focusEma(x:Float64Array,base:Float64Array,rho:number,f:RecentFocus,explicitSeed=false,resets?:ArrayLike<number>,seed?:{values:Float64Array;n:number}):Float64Array {
 const out=new Float64Array(x.length).fill(NaN),counts=new Int32Array(x.length);let sum=0,mass=0,count=0,first=-1,start=0;
 let seedSum=0,seedCount=0;
 for(let t=0;t<x.length;t++){
  if(resets?.[t]){sum=mass=count=0;first=-1;start=t;}
  if(Number.isFinite(x[t])){const initial=first<0;if(initial)first=t;count++;sum*=rho;mass*=rho;const w=initial&&!explicitSeed?1:1-rho;sum+=w*x[t];mass+=w;}
  counts[t]=count;const old=t-f.bars;
  if(old>=start&&Number.isFinite(x[old])){const w=(old===first&&!explicitSeed?1:1-rho)*rho**(count-counts[old]);sum-=w*x[old];mass-=w;}
  if(!Number.isFinite(base[t]))continue;
  if(seed){if(Number.isFinite(seed.values[t])){seedSum+=seed.values[t];seedCount++;}if(old>=0&&Number.isFinite(seed.values[old])){seedSum-=seed.values[old];seedCount--;}}
  const recentSum=sum+(seed?rho**count*seedSum/seed.n:0),recentMass=mass+(seed?rho**count*seedCount/seed.n:0);
  const delta=recentSum-recentMass*base[t],roundoff=Number.EPSILON*32*Math.max(Number.MIN_VALUE,Math.abs(recentSum),Math.abs(recentMass*base[t]));
  out[t]=base[t]+(Math.abs(delta)<=roundoff?0:(f.weight-1)*delta/(1+(f.weight-1)*Math.max(0,recentMass)));
 }return out;
}
export function focusRetain(k:Float64Array,p:Float64Array,e:Float64Array,rho:number,n:number,f:RecentFocus):Float64Array {
 const out=new Float64Array(p.length).fill(NaN);
 for(let t=0;t<p.length;t++){if(!(p[t]>0))continue;let sum=0,weights=0;const logP=Math.log(p[t]);
  for(let j=0;j<n&&j<=t;j++){const w=rho**j*(j<f.bars?f.weight:1);weights+=w;if(Number.isFinite(k[t-j])&&e[t-j]>0&&Number.isFinite(e[t-j]))sum+=w*k[t-j]*(logP-Math.log(e[t-j]))/(j+1);}
  out[t]=sum/weights;
 }return out;
}
/** Preserve original sum units: normalize relative weights back to original kernel mass. */
export function focusWsum(x:Float64Array,rho:number,n:number,f:RecentFocus):Float64Array {
 const out=new Float64Array(x.length).fill(NaN);for(let t=0;t<x.length;t++){let sum=0,oldMass=0,mass=0,any=false;
  for(let j=0;j<n&&j<=t;j++){const old=rho**j,w=old*(j<f.bars?f.weight:1);oldMass+=old;mass+=w;if(Number.isFinite(x[t-j])){sum+=w*x[t-j];any=true;}}
  if(any)out[t]=sum*oldMass/mass;
 }return out;
}
function weightedMedian(values:{x:number;w:number}[]):number {
 values.sort((a,b)=>a.x-b.x);const total=values.reduce((n,v)=>n+v.w,0);let sum=0;
 for(let i=0;i<values.length;i++){sum+=values[i].w;if(Math.abs(sum-total/2)<=Number.EPSILON*16*total&&i+1<values.length)return (values[i].x+values[i+1].x)/2;if(sum>total/2)return values[i].x;}return values.at(-1)?.x??NaN;
}
export function focusRobust(x:Float64Array,n:number,f:RecentFocus,kind:'median'|'mad'|'rscale'):Float64Array {
 const out=new Float64Array(x.length).fill(NaN);for(let t=0;t<x.length;t++){
  const values:{x:number;w:number}[]=[];for(let j=0;j<n&&j<=t;j++)if(Number.isFinite(x[t-j]))values.push({x:x[t-j],w:j<f.bars?f.weight:1});if(!values.length)continue;
  const median=weightedMedian([...values]);if(kind==='median'){out[t]=median;continue;}
  const deviations=values.map(v=>({x:Math.abs(v.x-median),w:v.w})),mad=weightedMedian([...deviations]);
  out[t]=kind==='mad'?mad:mad>0?1.4826*mad:1.2533*deviations.reduce((s,v)=>s+v.x*v.w,0)/deviations.reduce((s,v)=>s+v.w,0);
 }return out;
}
export function focusBeta(y:Float64Array,x:Float64Array,n:number,f:RecentFocus):Float64Array {
 const out=new Float64Array(y.length).fill(NaN);for(let t=0;t<y.length;t++){let sx=0,sy=0,sxy=0,sxx=0,w=0,count=0;
  for(let j=0;j<n&&j<=t;j++)if(Number.isFinite(x[t-j])&&Number.isFinite(y[t-j])){const a=j<f.bars?f.weight:1;w+=a;count++;sx+=a*x[t-j];sy+=a*y[t-j];sxy+=a*x[t-j]*y[t-j];sxx+=a*x[t-j]**2;}
  const den=w*sxx-sx*sx;if(count>=2&&den>1e-18*Math.max(1,w*sxx))out[t]=(w*sxy-sx*sy)/den;
 }return out;
}
/** Random-walk price-deviation calibration for the reweighted EMA's return-tail coefficients. */
export function focusMbiKappa(n:number,f:RecentFocus):number {
 const rho=1-1/n,tail=rho**f.bars,den=1+(f.weight-1)*(1-tail);let sum=tail*tail/(1-rho*rho);
 for(let j=0;j<f.bars;j++)sum+=(f.weight*rho**j-(f.weight-1)*tail)**2;return Math.sqrt(sum)/den;
}
export function focusMbiZ(closes:Float64Array,n:number,f:RecentFocus,second=false):Float64Array {
 const original=second?computeMbi2Core(closes,n):computeMbi(closes,{MBI_N:n}),out=new Float64Array(closes.length).fill(NaN);
 if(original.initialVariance==null)return out;
 const x=Float64Array.from(closes,v=>v>0&&Number.isFinite(v)?Math.log(v):NaN),first=x.findIndex(Number.isFinite);if(first<0)return out;
 const means=new Float64Array(x.length).fill(NaN),variance=new Float64Array(x.length).fill(NaN),returns=new Float64Array(x.length).fill(NaN),rho=1-1/n;
 let m=x[first],s=original.initialVariance;means[first]=m;variance[first]=s;
 for(let t=first+1;t<x.length;t++){if(Number.isFinite(x[t])){m=rho*m+x[t]/n;if(Number.isFinite(x[t-1])){returns[t]=(x[t]-x[t-1])**2;s=rho*s+returns[t]/n;}}means[t]=m;variance[t]=s;}
 // Original variance seed consists of the first n observed squared returns. Reweight those too
 // when an unusually long focus interval still includes them after the unchanged warmup.
 const seedValues=new Float64Array(x.length).fill(NaN);let seedCount=0;for(let t=first+1;t<x.length&&seedCount<n;t++)if(Number.isFinite(returns[t])){seedValues[t]=returns[t];seedCount++;}
 const focusedM=focusEma(x,means,rho,f),focusedS=focusEma(returns,variance,rho,f,true,undefined,{values:seedValues,n}),kappa=focusMbiKappa(n,f);
 for(let t=first+1;t<x.length;t++)if(Number.isFinite(original.z[t])&&Number.isFinite(focusedM[t-1])&&Number.isFinite(focusedS[t-1]))out[t]=focusedS[t-1]>0?(x[t]-focusedM[t-1])/(kappa*Math.sqrt(focusedS[t-1])):0;
 return out;
}

/** Reweight Wilder's original seed observations and subsequent TRs; no change to n/preheat. */
export function focusAtr(h:Float64Array,l:Float64Array,c:Float64Array,n:number,base:Float64Array,f:RecentFocus):Float64Array {
 const tr=new Float64Array(c.length).fill(NaN),ranks=new Int32Array(c.length),out=new Float64Array(c.length).fill(NaN),rho=1-1/n;let count=0;
 for(let t=0;t<c.length;t++){
  const pc=t>0?c[t-1]:NaN;tr[t]=Number.isFinite(pc)?Math.max(h[t]-l[t],Math.abs(h[t]-pc),Math.abs(l[t]-pc)):h[t]-l[t];
  if(Number.isFinite(tr[t]))count++;ranks[t]=count;if(!Number.isFinite(base[t]))continue;
  let sum=0,mass=0;for(let j=Math.max(0,t-f.bars+1);j<=t;j++)if(Number.isFinite(tr[j])){const w=rho**(count-Math.max(n,ranks[j]))/n;sum+=w*tr[j];mass+=w;}
  out[t]=(base[t]+(f.weight-1)*sum)/(1+(f.weight-1)*mass);
 }return out;
}
