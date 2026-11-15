import {DBL5_STEP,type Dbl5Bar} from '../../dbl5m';

export const START = Date.UTC(2026,9,10);
export const STEP = DBL5_STEP;
export const TICK = '0.01';
export const bar = (index:number, open:number, high:number, low:number, close:number, volume=100):Dbl5Bar=>({
  openTime:START+index*STEP,open,high,low,close,volume,takerBuyVolume:null,DBL5_tick_size:TICK,
});

/** Wide warm-up, one strictly selected lower box, then two narrow candles. */
export const warm = () => Array.from({length:20},(_,index)=>{
  if(index===15)return bar(index,100,101.5,99.5,100);
  if(index===16)return bar(index,100,100.4,99.35,100);
  if(index>=17)return bar(index,100,100.2,99.95,100);
  return bar(index,100,100.5,99.5,100);
});
export const impulse = (index=20) => bar(index,100,101.5,99.95,101.4,200);
