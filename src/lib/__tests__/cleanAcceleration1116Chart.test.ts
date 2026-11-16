import {describe,expect,it} from 'vitest';
import {accelerationPositions,cleanAcceleration1116Signals} from '../cleanAcceleration1116Chart';
import {accelerationMissingRange} from '@/hooks/useCleanAccelerationMinutes';

const M=60_000;
const history = Array.from({length:15}, (_,i) => ({
  time:i*M,open:100,high:100.15,low:99.85,close:100,
}));

function sequence(gains:number[]) {
  let close=100;
  return [...history,...gains.map((gain,i)=>{
    const open=close;
    close+=gain;
    return {time:(history.length+i)*M,open,high:Math.max(open,close)+.04,low:Math.min(open,close)-.03,close};
  })];
}

describe('纯净加速时机线-1116',()=>{
  it('starts on the fourth qualifying 1m close',()=>{
    const bars=sequence([.28,.36,.55,.71,.92,-.2]);
    const signals=cleanAcceleration1116Signals(bars);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toEqual({at:19*M,value:bars[18].low,gainAtr:expect.closeTo(1.9/.3),paceRatio:expect.closeTo(1.26/.64)});
    expect(signals[1]).toMatchObject({at:20*M,value:bars[19].low});
  });

  it('rejects one jump, steady gains, a dropped low, and gains below the ATR gate',()=>{
    const pullback=sequence([.28,.36,.55,.71]);
    pullback[17]={...pullback[17],low:pullback[16].low-.1};
    const small=sequence([.16,.17,.2,.26]).map((bar,i)=>i<15?{...bar,low:99,high:100.04}:bar);
    for(const bars of [sequence([0,0,0,2]),sequence([.5,.5,.5,.5]),pullback,small]){
      expect(cleanAcceleration1116Signals(bars)).toEqual([]);
    }
  });

  it('resets at missing or invalid minute candles and ignores other sample cadences',()=>{
    const bars=sequence([.28,.36,.55,.71,.92]);
    expect(cleanAcceleration1116Signals(bars.filter((_,i)=>i!==9))).toEqual([]);
    expect(cleanAcceleration1116Signals(bars.map((bar,i)=>i===9?{...bar,close:NaN}:bar))).toEqual([]);
    expect(cleanAcceleration1116Signals(bars.map(bar=>({...bar,time:bar.time*5})))).toEqual([]);
    const prefix={...bars[0],time:-M};
    expect(cleanAcceleration1116Signals([prefix,...bars])).toEqual(cleanAcceleration1116Signals(bars));
  });

  it('projects the earliest 1m confirmation into its 5m candle and hides future signals after a seek',()=>{
    const signals=cleanAcceleration1116Signals(sequence([.28,.36,.55,.71,.92,1.2]));
    const candles=[10*M,15*M,20*M,25*M].map(timestamp=>({timestamp}));
    const project=(through:number)=>accelerationPositions(candles,{signals,through,timezone:'Asia/Shanghai',status:'ready'});
    expect(project(18*M)).toEqual([{}, {}, {}, {}]);
    expect(project(19*M)).toEqual([{}, signals[0], {}, {}]);
    expect(project(24*M)).toEqual([{}, signals[0], signals[1], {}]);
    expect(signals[2].at).toBe(21*M);
  });

  it('fetches only the missing historical or right edge minutes',()=>{
    const current={from:10*M,through:20*M};
    expect(accelerationMissingRange(current,10*M,21*M)).toEqual({from:20*M,through:21*M,side:'right'});
    expect(accelerationMissingRange(current,5*M,20*M)).toEqual({from:5*M,through:10*M,side:'left'});
    expect(accelerationMissingRange(current,10*M,14*M)).toBeUndefined();
    expect(accelerationMissingRange(current,60*M,65*M)).toEqual({from:60*M,through:65*M,side:'replace'});
  });
});
