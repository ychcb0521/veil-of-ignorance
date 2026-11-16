import {describe,expect,it} from 'vitest';
import {cleanAcceleration1116Series} from '../cleanAcceleration1116Chart';

const STEP = 300_000;
const history = Array.from({length:14}, (_,i) => ({
  timestamp:i*STEP, open:100, high:100.15, low:99.85, close:100, cba2Closed:true,
}));

function sequence(gains: number[]) {
  let close = 100;
  return [...history,...gains.map((gain,i) => {
    const open = close;
    close += gain;
    return {
      timestamp:(history.length+i)*STEP, open, high:close+.04, low:open-.03, close, cba2Closed:true,
    };
  })];
}

describe('纯净加速时机线-1116', () => {
  it('starts at the fourth qualifying close and steps up only through continuing acceleration', () => {
    const bars = sequence([.28,.36,.55,.71,.92,-.2]);
    const rows = cleanAcceleration1116Series(bars);
    expect(rows.slice(0,17).every(row=>row.value==null)).toBe(true);
    expect(rows[17]).toEqual({value:bars[17].low,gainAtr:expect.closeTo(1.9/.3),paceRatio:expect.closeTo(1.26/.64)});
    expect(rows[18].value).toBe(bars[18].low);
    expect(rows[19]).toEqual({});
  });

  it('rejects a sharp single jump, steady gains, a low that breaks the staircase, and sub-ATR acceleration', () => {
    const pullback = sequence([.28,.36,.55,.71]);
    pullback[16] = {...pullback[16],low:pullback[15].low-.1};
    const small = sequence([.16,.17,.2,.26]).map((bar,i)=>i<14 ? {...bar,low:99,high:100.04} : bar);
    for (const bars of [sequence([0,0,0,2]),sequence([.5,.5,.5,.5]),pullback,small]) {
      expect(cleanAcceleration1116Series(bars).every(row=>row.value==null)).toBe(true);
    }
  });

  it('waits for a forming bar to close and never changes earlier rows when future candles arrive', () => {
    const bars = sequence([.28,.36,.55,.71,.92]);
    const throughConfirmation = bars.slice(0,18);
    const forming = [...throughConfirmation.slice(0,-1),{...bars[17],cba2Closed:false}];
    expect(cleanAcceleration1116Series(forming).at(-1)).toEqual({});
    const unmarked = bars.map(bar=>({...bar,cba2Closed:undefined}));
    expect(cleanAcceleration1116Series(unmarked.slice(0,18)).at(-1)).toEqual({});
    const latest = cleanAcceleration1116Series(throughConfirmation).at(-1);
    expect(latest?.value).toBe(bars[17].low);
    expect(cleanAcceleration1116Series(unmarked)[17]).toEqual(latest);
    expect(cleanAcceleration1116Series(bars).slice(0,18)).toEqual(cleanAcceleration1116Series(throughConfirmation));
  });

  it('resets across gaps, validates OHLC, and only uses contiguous five-minute candles', () => {
    const bars = sequence([.28,.36,.55,.71,.92]);
    const gap = bars.map((bar,i)=>({...bar,timestamp:bar.timestamp+(i>=11?STEP:0)}));
    const invalid = bars.map((bar,i)=>i===10?{...bar,close:NaN}:bar);
    const fifteenMinute = bars.map(bar=>({...bar,timestamp:bar.timestamp*3}));
    for (const series of [gap,invalid,fifteenMinute]) {
      expect(cleanAcceleration1116Series(series).every(row=>row.value==null)).toBe(true);
    }
  });
});
