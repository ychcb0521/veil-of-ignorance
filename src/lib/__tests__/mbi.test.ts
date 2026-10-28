import { describe, expect, it } from 'vitest';
import { computeMbi, MBI_N, MBI_Z0 } from '@/lib/mbi';
import { mulberry32 } from '@/lib/deepRsa/grouping';

const close = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(1e-6);
export const defaultMbiPrices = (count = 300) => Array.from({ length: count }, (_, t) => 100 * Math.exp(.02 * Math.sin(t / 9) + .012 * Math.sin(t / 2.7) + .0002 * t));

describe('MBI acceptance A–E', () => {
  it('A: n=3 unmasked recurrence uses the previous M and S', () => {
    const out = computeMbi([100, 101, 102, 101, 103, 104, 103, 105, 106, 107, 106, 108], { MBI_N: 3, MBI_Z0: 1.25 }, { warmup: false });
    const zs = [.750276, 1.240333, .085796, 1.537059, 1.246246, .343717, 1.468330, 1.265009, 1.470990, .491113, 1.592198];
    const mbis = [.537207, .758327, .068530, .842477, .760330, .268246, .825762, .766591, .826437, .373850, .854813];
    close(out.kappa, 1.341641); close(out.initialVariance!, .0000977149);
    zs.forEach((z, i) => { close(out.z[i + 1], z); close(out.mbi[i + 1], mbis[i]); });
    console.info('MBI A', JSON.stringify({ kappa: out.kappa, S0: out.initialVariance, rows: zs.map((_, i) => ({ t: i + 1, z: out.z[i + 1], MBI: out.mbi[i + 1] })) }));
  });

  it('B: default parameters, exactly 125 hidden bars', () => {
    expect([MBI_N, MBI_Z0]).toEqual([25, 1.25]);
    const out = computeMbi(defaultMbiPrices());
    expect(Array.from(out.mbi.slice(0, 125)).every(Number.isNaN)).toBe(true);
    const expected = [[125, 2.421729, .959326], [140, 1.151761, .726563], [160, -.316638, -.248028], [180, 1.184870, .738829], [200, -1.243529, -.759412], [230, 1.011132, .668986], [260, -.054198, -.043331], [299, .877325, .605547]];
    expected.forEach(([t, z, mbi]) => { close(out.z[t], z); close(out.mbi[t], mbi); });
    console.info('MBI B', JSON.stringify({ warmupNulls: 125, kappa: out.kappa, rows: expected.map(([t]) => ({ t, z: out.z[t], MBI: out.mbi[t] })) }));
  });

  it('C: 200,000-bar Gaussian random walk, fixed seed 20261029', () => {
    const random = mulberry32(20261029);
    let logPrice = Math.log(100);
    const prices = Array.from({ length: 200000 }, (_, i) => {
      if (i) logPrice += .01 * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
      return Math.exp(logPrice);
    });
    const out = computeMbi(prices);
    const z = Array.from(out.z).filter(Number.isFinite), mbi = Array.from(out.mbi).filter(Number.isFinite);
    const mean = z.reduce((s, x) => s + x, 0) / z.length;
    const sd = Math.sqrt(z.reduce((s, x) => s + (x - mean) ** 2, 0) / (z.length - 1));
    const share = mbi.filter(x => x > .8).length / mbi.length;
    expect(sd).toBeGreaterThanOrEqual(.97); expect(sd).toBeLessThanOrEqual(1.03);
    expect(share).toBeGreaterThanOrEqual(.075); expect(share).toBeLessThanOrEqual(.095);
    console.info('MBI C', JSON.stringify({ seed: 20261029, bars: prices.length, valid: z.length, zMean: mean, zSd: sd, abovePoint8: share }));
  });

  it('D: 400 bars, +0.1%, −0.1%, flat', () => {
    const values = [1.001, .999, 1].map(factor => computeMbi(Array.from({ length: 400 }, (_, i) => 100 * factor ** i)).mbi[399]);
    close(values[0], .99997265); close(values[1], -.99997265); expect(values[2]).toBe(0);
    console.info('MBI D', JSON.stringify({ rising: values[0], falling: values[1], flat: values[2] }));
  });

  it('E: every finite prefix is bit-for-bit identical with future candles appended', () => {
    const prices = defaultMbiPrices(900), full = computeMbi(prices);
    for (const length of [0, 1, 10, 25, 125, 126, 300, 701]) {
      const prefix = computeMbi(prices.slice(0, length));
      expect(prefix.mbi).toEqual(full.mbi.slice(0, length));
      expect(prefix.z).toEqual(full.z.slice(0, length));
    }
    console.info('MBI E', JSON.stringify({ prefixes: [0, 1, 10, 25, 125, 126, 300, 701], maxDifference: 0 }));
  });

  it('rejects invalid parameters and leaves invalid/missing prices empty', () => {
    for (const params of [{ MBI_N: 0 }, { MBI_N: 2.5 }, { MBI_Z0: 0 }, { MBI_Z0: Infinity }]) expect(() => computeMbi([1, 2], params)).toThrow();
    const prices = defaultMbiPrices(400); prices[250] = 0; prices[300] = NaN;
    const out = computeMbi(prices);
    for (const index of [250, 251, 300, 301]) expect(out.mbi[index]).toBeNaN();
    expect(Number.isFinite(out.mbi[302])).toBe(true);
    expect(Array.from(out.mbi).filter(Number.isFinite).every(x => x >= -1 && x <= 1)).toBe(true);
  });
});
