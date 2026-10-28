/** Covel-inspired extension, not a formula from the book. All periods are bars. */
export const CTBA_DEFAULTS = { N:576, f:12, s:48, m:48, lambda:Math.LN2/144, epsilon:1e-12, alpha:.35, beta:.40, gamma:.25 } as const;
export type CtbaParams = { [K in keyof typeof CTBA_DEFAULTS]: number };
export const CTBA_DESCRIPTION = 'CTBA｜趋势买方优势：100·tanh[α·tanh(T)+β·tanh(M)+γ·F]。T 为不含当根的历史区间位置（不截断），M 为真实 VWAP 对数的快慢 EMA 差除以近期收益率标准差，F 为主动买卖成交金额的衰减加权差额。正负表示综合方向，不是上涨概率；这是趋势跟踪思想的扩展模型。';
export function validateCtba(p: CtbaParams) {
  for (const k of ['N','f','s','m'] as const) if (!Number.isSafeInteger(p[k]) || p[k] < (k==='m'?2:1)) throw Error('CTBA '+k+' 必须为有效正整数（m ≥ 2）');
  if (p.f >= p.s) throw Error('CTBA 必须满足 f < s');
  if (!Number.isFinite(p.lambda) || p.lambda<0 || !Number.isFinite(p.epsilon) || p.epsilon<=0) throw Error('CTBA 要求 λ ≥ 0，ε > 0');
  if (![p.alpha,p.beta,p.gamma].every(v=>Number.isFinite(v)&&v>=0) || Math.abs(p.alpha+p.beta+p.gamma-1)>1e-12) throw Error('CTBA 权重必须非负且合计为 1');
}
export interface CtbaInput { C:ArrayLike<number>; H:ArrayLike<number>; L:ArrayLike<number>; E:ArrayLike<number>; B:ArrayLike<number>; S:ArrayLike<number>; time:ArrayLike<number> }
/** Closed ascending 5m bars supplied by the shared window pipeline. No price filling. */
export function computeCtbaSeries(b:CtbaInput, p:CtbaParams={...CTBA_DEFAULTS}) {
  validateCtba(p);
  const size=b.C.length, blank=()=>new Float64Array(size).fill(NaN);
  const T=blank(),M=blank(),F=blank(),CTBA=blank(),noTrade=blank(),complete=new Float64Array(size);
  const rho=Math.exp(-p.lambda), tail=rho**p.N, af=2/(p.f+1),as=2/(p.s+1);
  let ef=NaN,es=NaN,emaCount=0,weightedB=0,weightedS=0,missing=0;
  const buys=blank(),sells=blank(),returns=blank();
  for(let t=0;t<size;t++){
    const amountOk=Number.isFinite(b.B[t])&&b.B[t]>=0&&Number.isFinite(b.S[t])&&b.S[t]>=0;
    buys[t]=amountOk?b.B[t]:NaN;sells[t]=amountOk?b.S[t]:NaN;
    if(!amountOk)missing++;
    if(t>=p.N&&!Number.isFinite(buys[t-p.N]))missing--;
    weightedB=(amountOk?buys[t]:0)+rho*weightedB;
    weightedS=(amountOk?sells[t]:0)+rho*weightedS;
    if(t>=p.N){weightedB-=tail*(Number.isFinite(buys[t-p.N])?buys[t-p.N]:0);weightedS-=tail*(Number.isFinite(sells[t-p.N])?sells[t-p.N]:0);}
    const gap=t>0&&b.time[t]-b.time[t-1]!==300000;
    if(gap){ef=es=NaN;emaCount=0;}
    const e=b.E[t], prior=t>0?b.E[t-1]:NaN;
    if(e>0&&Number.isFinite(e)){
      const x=Math.log(e);ef=Number.isFinite(ef)?af*x+(1-af)*ef:x;es=Number.isFinite(es)?as*x+(1-as)*es:x;emaCount++;
      if(!gap&&prior>0&&Number.isFinite(prior))returns[t]=Math.log(e/prior);
    }else{ef=es=NaN;emaCount=0;}
    if(t>=p.N-1 && missing===0 && b.time[t]-b.time[t-p.N+1]===(p.N-1)*300000){
      // Explicit count/sum avoids subtractive residue falsely labelling an empty window.
      let total=0;for(let j=t-p.N+1;j<=t;j++)total+=buys[j]+sells[j];
      noTrade[t]=total===0?1:0;
      F[t]=total===0?0:(weightedB-weightedS)/(weightedB+weightedS+p.epsilon);
    }
    if(t>=p.N && b.time[t]-b.time[t-p.N]===p.N*300000 && b.C[t]>0 && Number.isFinite(b.C[t])){
      let hi=-Infinity,lo=Infinity,ok=true;
      for(let j=t-p.N;j<t;j++){if(!(b.H[j]>0&&b.L[j]>0&&Number.isFinite(b.H[j])&&Number.isFinite(b.L[j])&&b.H[j]>=b.L[j])){ok=false;break;}hi=Math.max(hi,b.H[j]);lo=Math.min(lo,b.L[j]);}
      if(ok)T[t]=hi===lo?0:2*(b.C[t]-lo)/(hi-lo)-1;
    }
    if(t>=p.m && emaCount>=5*p.s){
      let sum=0,ok=true;for(let j=t-p.m+1;j<=t;j++){if(!Number.isFinite(returns[j])){ok=false;break;}sum+=returns[j];}
      if(ok){const mean=sum/p.m;let sq=0;for(let j=t-p.m+1;j<=t;j++)sq+=(returns[j]-mean)**2;
        M[t]=(ef-es)/(Math.sqrt(sq/(p.m-1))+p.epsilon);}
    }
    if([T[t],M[t],F[t]].every(Number.isFinite)){complete[t]=1;CTBA[t]=100*Math.tanh(p.alpha*Math.tanh(T[t])+p.beta*Math.tanh(M[t])+p.gamma*F[t]);}
  }
  return {T,M,F,CTBA,noTrade,complete};
}
/** Parameter assignments live together and are edited/persisted by the existing formula editor. */
export function ctbaFormula(p:CtbaParams={...CTBA_DEFAULTS}) {
  validateCtba(p);
  const args='C,H,L,E,B,S,clock,N,f,s,m,lambda,epsilon,alpha,ctba_beta,gamma';
  return [
    '# CTBA v1：5m 已收盘；参数以根计；真实 E=成交金额/成交数量',
    ...Object.entries(p).map(([k,v])=>(k==='beta'?'ctba_beta':k)+' = '+v+(k==='beta'?' # β：趋势动能权重':'')),
    'ctba_version = 1',
    '# EMA α=2/(k+1)，从首个有效 ln(E) 起算，连续 5s 根预热；Std 使用样本标准差（m−1）',
    'clock = T',
    ...['T','M','F','no_trade','data_complete','CTBA'].map((name,i)=>name+' = ctba('+args+','+[0,1,2,4,5,3][i]+')'),
  ].join('\n');
}
