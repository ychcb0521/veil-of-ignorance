import {Prs6hEngine,type PrsBar,type PrsRow} from '@/lib/prs6h';
export const STEP=300000,BASE=Date.UTC(2026,9,29);
export function prsBar(i:number,c:number,lo=c-.1,hi=c+.1,q=100):PrsBar{return {openTime:BASE+i*STEP,open:c-.02,high:Math.max(hi,c),low:Math.min(lo,c-.02),close:c,volume:1,takerBuyVolume:.6,quoteVolume:q,takerBuyQuoteVolume:q*.6,PRS6H_tick_size:.01};}
/** A causal scenario generator reads only the latest already-computed frozen coordinates. */
export function prsPositive(){
 const engine=new Prs6hEngine({symbol:'TESTUSDT'}),bars:PrsBar[]=[],rows:PrsRow[]=[];
 const push=(bar:PrsBar)=>{bars.push(bar);const row=engine.push(bar)!;rows.push(row);return row;};
 for(let i=0;i<125;i++)push(prsBar(i,100+i*.1,100+i*.1-.15,100+i*.1+.15));
 let baseline:PrsRow|null=null,verified:PrsRow|null=null;
 for(let i=125;i<210;i++){
  const last=rows.at(-1)!,s=last.PRS6H_structure;
  if(last.PRS6H_state==='FROZEN'&&s){
   const close=s.support+2*s.band+.02;const row=push(prsBar(i,close,s.support+s.band*.5,close+.025));
   if(row.PRS6H_state==='BASELINE_ONLY')baseline=row;else if(row.PRS6H_state==='VERIFIED')verified=row;
  }else if(last.PRS6H_state==='VERIFIED'&&s){const line=s.upper+Math.max(.01,.1*s.scale0),since=(BASE+(i+1)*STEP-s.test_completed_at!)/STEP,c=line+.015*since;push(prsBar(i,c,c-.03,c+.005));}
  else{
   const firstBase=baseline?.PRS6H_structure?.support??112.2;
   const after=baseline?i-Math.round((baseline.PRS6H_at-BASE)/STEP)+1:i-125;
   const c=baseline?firstBase+.65+[0,.06,-.02,.07,0,.08][Math.max(0,after)%6]:112.35+[0,.06,-.02,.07,0,.08][(i-125)%6];
   push(prsBar(i,c,c-.08,c+.08));
  }
  if(rows.at(-1)!.PRS6H_event)break;
 }
 return {engine,bars,rows,baseline,verified};
}
