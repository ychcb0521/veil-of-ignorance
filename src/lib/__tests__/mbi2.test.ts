import { describe, expect, it } from 'vitest';
import { computeMbi2Core, computeMbi2, mbi2NOf, mbi2States } from '@/lib/mbi2';
const MBI2_N=25,MBI2_Z0=1.25;
const computeCopy=(prices:ArrayLike<number>,p:{MBI2_N?:number;MBI2_Z0?:number}={},o:{warmup?:boolean}={})=>computeMbi2Core(prices,p.MBI2_N??25,p.MBI2_Z0??1.25,o);
import { mulberry32 } from '@/lib/deepRsa/grouping';

const close = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(1e-6);
export const defaultMbiPrices = (count = 300) => Array.from({ length: count }, (_, t) => 100 * Math.exp(.02 * Math.sin(t / 9) + .012 * Math.sin(t / 2.7) + .0002 * t));

describe('MBI2 copied recurrence acceptance A–E', () => {
  it('A: n=3 unmasked recurrence uses the previous M and S', () => {
    const out = computeCopy([100, 101, 102, 101, 103, 104, 103, 105, 106, 107, 106, 108], { MBI2_N: 3, MBI2_Z0: 1.25 }, { warmup: false });
    const zs = [.750276, 1.240333, .085796, 1.537059, 1.246246, .343717, 1.468330, 1.265009, 1.470990, .491113, 1.592198];
    const mbis = [.537207, .758327, .068530, .842477, .760330, .268246, .825762, .766591, .826437, .373850, .854813];
    close(out.kappa, 1.341641); close(out.initialVariance!, .0000977149);
    zs.forEach((z, i) => { close(out.z[i + 1], z); close(out.mbi[i + 1], mbis[i]); });
    console.info('MBI2 A', JSON.stringify({ kappa: out.kappa, S0: out.initialVariance, rows: zs.map((_, i) => ({ t: i + 1, z: out.z[i + 1], MBI: out.mbi[i + 1] })) }));
  });

  it('B: default parameters, exactly 125 hidden bars', () => {
    expect([MBI2_N, MBI2_Z0]).toEqual([25, 1.25]);
    const out = computeCopy(defaultMbiPrices());
    expect(Array.from(out.mbi.slice(0, 125)).every(Number.isNaN)).toBe(true);
    const expected = [[125, 2.421729, .959326], [140, 1.151761, .726563], [160, -.316638, -.248028], [180, 1.184870, .738829], [200, -1.243529, -.759412], [230, 1.011132, .668986], [260, -.054198, -.043331], [299, .877325, .605547]];
    expected.forEach(([t, z, mbi]) => { close(out.z[t], z); close(out.mbi[t], mbi); });
    console.info('MBI2 B', JSON.stringify({ warmupNulls: 125, kappa: out.kappa, rows: expected.map(([t]) => ({ t, z: out.z[t], MBI: out.mbi[t] })) }));
  });

  it('C: 200,000-bar Gaussian random walk, fixed seed 20261029', () => {
    const random = mulberry32(20261029);
    let logPrice = Math.log(100);
    const prices = Array.from({ length: 200000 }, (_, i) => {
      if (i) logPrice += .01 * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
      return Math.exp(logPrice);
    });
    const out = computeCopy(prices);
    const z = Array.from(out.z).filter(Number.isFinite), mbi = Array.from(out.mbi).filter(Number.isFinite);
    const mean = z.reduce((s, x) => s + x, 0) / z.length;
    const sd = Math.sqrt(z.reduce((s, x) => s + (x - mean) ** 2, 0) / (z.length - 1));
    const share = mbi.filter(x => x > .8).length / mbi.length;
    expect(sd).toBeGreaterThanOrEqual(.97); expect(sd).toBeLessThanOrEqual(1.03);
    expect(share).toBeGreaterThanOrEqual(.075); expect(share).toBeLessThanOrEqual(.095);
    console.info('MBI2 C', JSON.stringify({ seed: 20261029, bars: prices.length, valid: z.length, zMean: mean, zSd: sd, abovePoint8: share }));
  });

  it('D: 400 bars, +0.1%, −0.1%, flat', () => {
    const values = [1.001, .999, 1].map(factor => computeCopy(Array.from({ length: 400 }, (_, i) => 100 * factor ** i)).mbi[399]);
    close(values[0], .99997265); close(values[1], -.99997265); expect(values[2]).toBe(0);
    console.info('MBI2 D', JSON.stringify({ rising: values[0], falling: values[1], flat: values[2] }));
  });

  it('E: every finite prefix is bit-for-bit identical with future candles appended', () => {
    const prices = defaultMbiPrices(900), full = computeCopy(prices);
    for (const length of [0, 1, 10, 25, 125, 126, 300, 701]) {
      const prefix = computeCopy(prices.slice(0, length));
      expect(prefix.mbi).toEqual(full.mbi.slice(0, length));
      expect(prefix.z).toEqual(full.z.slice(0, length));
    }
    console.info('MBI2 E', JSON.stringify({ prefixes: [0, 1, 10, 25, 125, 126, 300, 701], maxDifference: 0 }));
  });

  it('rejects invalid parameters and leaves invalid/missing prices empty', () => {
    for (const params of [{ MBI2_N: 0 }, { MBI2_N: 2.5 }, { MBI2_Z0: 0 }, { MBI2_Z0: Infinity }]) expect(() => computeCopy([1, 2], params)).toThrow();
    const prices = defaultMbiPrices(400); prices[250] = 0; prices[300] = NaN;
    const out = computeCopy(prices);
    for (const index of [250, 251, 300, 301]) expect(out.mbi[index]).toBeNaN();
    expect(Number.isFinite(out.mbi[302])).toBe(true);
    expect(Array.from(out.mbi).filter(Number.isFinite).every(x => x >= -1 && x <= 1)).toBe(true);
  });
});

it('C: derives n from hours using actual timeframe minutes',()=>{
 const cases=[[5,2.0833,25],[15,6.25,25],[60,25,25],[5,12,144],[60,2,5]];
 for(const [minutes,hours,n] of cases)expect(mbi2NOf({MBI2_T_HOURS:hours},minutes)).toBe(n);
 console.info('MBI2 C calendar',JSON.stringify(cases));
});
it('D: exactly matches the supplied strict 16-bar state, lead and confirmation sequence',()=>{
 const values=[.1,.25,.5,.85,.4,.05,-.15,-.25,-.5,-.85,-.1,.15,.3,.9,-.9,.2];
 const out=mbi2States(values),state=[0,1,1,2,2,2,2,-1,-1,-2,-2,-2,1,2,-2,-2];
 const lead=[0,0,1,2,3,4,5,0,1,2,3,4,0,1,0,1],confirm=[0,0,0,0,1,2,3,0,0,0,1,2,0,0,0,1];
 expect(Array.from(out.state)).toEqual(state);
 Array.from(out.lead).forEach((v,i)=>expect(v).toBe(lead[i]*5/60));
 Array.from(out.confirm).forEach((v,i)=>expect(v).toBe(confirm[i]*5/60));
 expect(mbi2States([.8,.800001,-.8,-.800001]).state).toEqual(new Float64Array([1,2,-1,-2]));
 expect(mbi2States([-.9,-.2,0,.2]).state).toEqual(new Float64Array([-2,-2,-2,-2]));
 expect(mbi2States(new Float64Array(1000).fill(.9)).lead.at(-1)).toBe(48);
 console.info('MBI2 D state',JSON.stringify({state,leadBars:lead,confirmBars:confirm,t6LeadHours:out.lead[6],t6ConfirmHours:out.confirm[6]}));
});
it('F and G: causal states, isolated raw calculation, changed hours and return to identical defaults',()=>{
 const prices=defaultMbiPrices(1600),full=computeMbi2(prices);
 for(const length of [126,701,1000]){const prefix=computeMbi2(prices.slice(0,length));for(const key of ['mbi','state','lead','confirm'] as const)expect(prefix[key]).toEqual(full[key].slice(0,length));}
 const old=computeCopy(prices),changed=computeMbi2(prices,{MBI2_T_HOURS:12});
 expect(changed.n).toBe(144);expect(changed.mbi.at(-1)).not.toBe(old.mbi.at(-1));
 expect(computeCopy(prices).mbi).toEqual(old.mbi);expect(computeMbi2(prices).mbi).toEqual(old.mbi);
 console.info('MBI2 F/G',JSON.stringify({prefixMaxDifference:0,defaultN:full.n,changedN:changed.n,originalLast:old.mbi.at(-1),changedLast:changed.mbi.at(-1),restoredLast:full.mbi.at(-1)}));
});
