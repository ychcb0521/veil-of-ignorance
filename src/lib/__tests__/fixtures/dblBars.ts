import {DBL5_STEP,type Dbl5Bar} from '../../dbl5m';
export const T=Date.UTC(2026,9,30);
export function bar(i:number,high:number,low:number,close=high,open=close):Dbl5Bar{return {openTime:T+(i-1)*DBL5_STEP,open,high,low,close,volume:0,quoteVolume:null,takerBuyVolume:null,takerBuyQuoteVolume:null,DBL5_closed:true,DBL5_tick_size:1};}
export const sample=()=>[[101,99],[102,100],[103,101],[104,102],[103,100],[102,101],[103,101],[103,102],[103,101],[106,103],[105,102],[104,103],[105,103],[105,104],[105,103],[105,102],[105,103],[105,101]].map(([h,l],i)=>bar(i+1,h,l,i===17?103:h));
