import {SBS5M_STEP,type SbsBar} from '@/lib/sbs5m';
export const SBS_T=Date.UTC(2026,9,30);
export function sbsBar(i:number,close:number,low=close-1,high=close+1,amount=1000):SbsBar{return {openTime:SBS_T+i*SBS5M_STEP,open:close,high,low,close,volume:10,takerBuyVolume:5,quoteVolume:amount,takerBuyQuoteVolume:500,SBS5M_tick_size:.1,SBS5M_closed:true};}
export function sbsFormation(){return [...Array.from({length:30},(_,i)=>sbsBar(i,90+i*.2)),...[102.8,102,103,102,103,102.8].map((v,i)=>sbsBar(30+i,v,100,104))];}
export function sbsBaseline(){return [...sbsFormation(),sbsBar(36,102.8,100.2,103.2)];}
export function sbsBreakout(){return [...sbsBaseline(),sbsBar(37,104.8,104.3,105.2),sbsBar(38,105.2,104.7,105.6)];}
export function sbsHigherPending(){return [...sbsBreakout(),...[106.8,106,107,106,107,106.8].map((v,i)=>sbsBar(39+i,v,104,108))];}
export function sbsComplete(){return [...sbsHigherPending(),sbsBar(45,106.8,104.2,107.2),sbsBar(46,107,106.3,107.5),sbsBar(47,106.8,104.2,107.2),sbsBar(48,109,90,110)];}
