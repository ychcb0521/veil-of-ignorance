import { expect, it, vi } from 'vitest';
import { STATE_DEF, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { classifyFishProgram, compileFishProgram, evaluateFishProgram, constraintFingerprint, FISH_STATE_HOLD_TEXT, type FishProgram } from '@/lib/fish/algorithm';
import { fishTail, tightenFishResult, sameFamily } from '@/lib/fish/refilter';
import { FishScanner } from '@/lib/fishScanner';
import { intervalMs } from '@/lib/deepRsa/marketData';
import type { FishDataAdapter } from '@/lib/fish/adapters';
import type { ResearchBar } from '@/lib/deepRsa/window';

const cut = Date.UTC(2026, 9, 25, 10), signal = new AbortController().signal;
const def: DeepDigFeatureDef = { ...STATE_DEF, formula: 'state = C\navg_state_2 = avg(state, 24)' };
const settings = { statistic: 'state', direction: '>' as const, threshold: 0.7, constraints: [] };
const compile = (d = def, threshold = 0.7) => compileFishProgram(d, { ...settings, threshold });
function bars(plan: FishProgram, count: number, runSamples: number, current = 0.71, plateau = 0.6): ResearchBar[] {
  return Array.from({ length: count }, (_, i) => {
    const close = i === count - 1 ? current : i >= count - runSamples ? plateau : 0.5;
    return { openTime: cut - (count - i) * plan.step, open: close, close, high: close, low: close, volume: 1, quoteVolume: 1e6, takerBuyVolume: null };
  });
}
function classify(plan: FishProgram, sample: ResearchBar[]) {
  return classifyFishProgram('SUSDT', sample, evaluateFishProgram(sample, plan), cut, plan);
}

it('requires 6 elapsed hours above 0.55, with current S > 0.7; 5h55m is insufficient', () => {
  const p = compile();
  expect(classify(p, bars(p, p.N, 72)).outcome).toBe('blocked');
  const result = classify(p, bars(p, p.N, 73));
  expect(result.outcome).toBe('hit');
  expect(result.signal?.timeMs).toBe(cut);
  expect(result.signal?.fish?.stateHold).toEqual({ threshold: 0.55, requiredHours: 6, fromMs: cut - 6 * 3600000, verifiedHours: 6, minimum: 0.6 });
  expect(result.signal?.fish?.constraints).toEqual([FISH_STATE_HOLD_TEXT]);
});

it.each([0.55, 0.54])('a dip to %s resets the 0.55 clock, even if most of the preceding hours passed', value => {
  const p = compile(), sample = bars(p, p.N, 100);
  sample.at(-36)!.close = value;
  expect(classify(p, sample).outcome).toBe('blocked');
});

it('does not require S > 0.7 for all 6 hours; later dips below 0.7 do not reset the 0.55 clock', () => {
  const p = compile(), sample = bars(p, p.N, 100);
  sample.at(-20)!.close = 0.75;
  sample.at(-19)!.close = 0.58;
  expect(classify(p, sample).outcome).toBe('hit');
  expect(classify(p, bars(p, p.N, 100, 0.7)).outcome).toBe('below');
  expect(classify(p, bars(p, p.N, 100, 0.69)).outcome).toBe('below');
});

it('starts the signal only when the duration condition matures, even if S was already over 0.7', () => {
  const p = compile(), sample = bars(p, p.N, 73, 0.75, 0.75);
  const result = classify(p, sample);
  expect(result.outcome).toBe('hit');
  expect(result.signal?.timeMs).toBe(cut);
  expect(result.signal?.fish?.previousAverage).toBe(0.75);
  expect(result.signal?.fish?.startConstraints).toEqual([1]);
});

it('missing S readings cannot count as continuous time', () => {
  const p = compile({ ...def, formula: 'state = if(C > 0, C, 1 / 0)' }), sample = bars(p, p.N, 100);
  sample.at(-20)!.close = 0;
  expect(classify(p, sample).outcome).toBe('readings');
});

it.each(['1m', '5m', '15m', '1h'] as const)('measures elapsed hours consistently on %s bars', interval => {
  const p = compile({ ...def, interval }), n = Math.ceil(6 * 3600000 / intervalMs(interval)) + 1;
  expect(classify(p, bars(p, p.N, n - 1)).outcome).toBe('blocked');
  expect(classify(p, bars(p, p.N, n)).signal?.fish?.stateHold?.verifiedHours).toBe(6);
});

it('keeps averages, other features, and opposite-direction scans independent; invalidates old raw-S rounds', () => {
  for (const p of [compileFishProgram(def, { ...settings, statistic: 'avg_state_2' }), compile({ ...def, id: 'state2' }), compileFishProgram(def, { ...settings, direction: '<' })]) {
    expect(p.stateHold).toBeUndefined(); expect(p.texts).toEqual([]);
  }
  const p = compile(), legacy = { ...p, stateHold: undefined, constraintKey: constraintFingerprint([]) };
  expect(sameFamily(legacy, p)).toBe(false);
  expect(compileFishProgram(p.def, p.settings).texts).toEqual([FISH_STATE_HOLD_TEXT]);
  expect(compile(STATE_DEF).unavailable).toBeUndefined();
});

it('tightening a completed scan preserves the duration gate and matches a fresh calculation', () => {
  const p = compile(), sample = bars(p, p.N, 100, 0.85), readings = evaluateFishProgram(sample, p);
  const result = classifyFishProgram('SUSDT', sample, readings, cut, p);
  const tail = fishTail(sample, readings, p, cut, { symbol: 'SUSDT', exchange: 'binance' });
  const target = compile(def, 0.8);
  expect(tightenFishResult({ ...result, tail }, target)?.signal).toEqual(classify(target, sample).signal);
});

it('single, intersection, union and single-coin diagnosis use the same S duration rule; gaps are rejected', async () => {
  const p = compile(), coin = (base: string) => ({ base, symbol: `${base}USDT`, instrument: `${base}USDT`, multiplier: 1 });
  const adapter: FishDataAdapter = {
    exchange: 'binance', list: async () => ['GOOD', 'SHORT', 'DIP', 'LOW', 'GAP'].map(coin), btc: () => coin('BTC'), taker: async (_, b) => b,
    candles: vi.fn(async (market, _, _signal, q) => {
      const sample = bars(p, q.count, market.base === 'SHORT' ? 72 : 100, market.base === 'LOW' ? 0.69 : 0.71);
      if (market.base === 'DIP') sample.at(-20)!.close = 0.55;
      if (market.base === 'GAP') sample.splice(sample.length - 20, 1);
      return sample;
    }),
  };
  const scanner = () => new FishScanner(async () => new Response(JSON.stringify({ serverTime: cut })), undefined, undefined, { binance: adapter });
  for (const combination of [undefined, 'and', 'or'] as const) {
    const hits: string[] = [];
    const options = { feature: def, algorithm: settings, anchorMs: cut, includeDuplicates: true, signal, onProgress: () => {}, onSignal: (s: { symbol: string }) => hits.push(s.symbol) };
    await scanner().scan({ ...options, ...(combination ? { algorithms: [{ feature: def, algorithm: settings }, { feature: def, algorithm: settings }], combination } : {}) });
    expect(hits).toEqual(['GOODUSDT']);
  }
  const diagnose = (symbol: string) => scanner().diagnose({ symbol, feature: def, algorithm: settings, anchorMs: cut, signal });
  expect((await diagnose('GOOD')).outcome).toBe('hit');
  expect((await diagnose('SHORT')).lines.join(' ')).toContain(FISH_STATE_HOLD_TEXT);
  expect((await diagnose('DIP')).outcome).toBe('blocked');
});
