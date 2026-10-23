import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ cache: new Map<string, unknown>(), evaluate: vi.fn(), fetchBars: vi.fn() }));
vi.mock('../avgHighlightStorage', () => ({ readAvgCache: async (k: string) => mocks.cache.get(k), writeAvgCache: async (k: string, value: unknown) => { mocks.cache.set(k, value); } }));
vi.mock('@/lib/deepRsa/marketData', () => ({ fetchResearchKlines: mocks.fetchBars, clearMarketDataCache: vi.fn() }));
vi.mock('@/lib/deepDig/features', async original => ({ ...await original<typeof import('@/lib/deepDig/features')>(), evaluateOnBars: mocks.evaluate }));
import { AVG_CALIBRATION_CUTOFF, AVG_HIGHLIGHT_SPECS, avgCoreKey } from '../avgHighlight';

describe('background average calibration', () => {
  it('reuses cached cores for a new N, while preserving existing named 24h account averages', async () => {
    const symbols = Array.from({ length: 30 }, (_, i) => `S${i}USDT`), start = AVG_CALIBRATION_CUTOFF - 100 * 300000;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ symbols: [...symbols, 'BTCUSDT'].map(symbol => ({ symbol, onboardDate: start, status: 'TRADING' })) }) })));
    mocks.fetchBars.mockResolvedValue(Array.from({ length: 100 }, (_, i) => ({ openTime: start + i * 300000, close: 100, quoteVolume: 100, takerBuyQuoteVolume: 50 })));
    mocks.evaluate.mockImplementation(() => ({ vars: new Map([['CDA', new Float64Array(100).fill(1)], ['avg_CDA', new Float64Array(100).fill(.25)], ['avg_CDA_2', new Float64Array(100).fill(-.75)]]) }));
    const received: { key: string; limits?: { d: number }; error?: string }[] = [];
    const workerSelf = { postMessage: (data: typeof received[number]) => received.push(data), onmessage: undefined as ((event: { data: unknown }) => void) | undefined };
    vi.stubGlobal('self', workerSelf);
    await import('../avgHighlight.worker');
    const def = { id: 'cda', formula: 'CDA = 1\navg_CDA = .25\navg_CDA_2 = -.75', scale: 1 }, spec = AVG_HIGHLIGHT_SPECS.find(s => s.id === 'CDA')!;
    const base = { symbols, featureId: 'cda', period: 6, coreKey: avgCoreKey(symbols, def, 6), definitions: [{ spec, def, period: 6, names: { core: 'CDA', avg: 'avg_CDA', avg2: 'avg_CDA_2' } }] };
    const run = async (key: string, hours: number, kind: string) => {
      workerSelf.onmessage!({ data: { ...base, key, hours, kind } });
      await vi.waitFor(() => expect(received.find(r => r.key === key && (r.limits || r.error))).toBeTruthy());
      const result = received.find(r => r.key === key && (r.limits || r.error))!;
      expect(result.error).toBeUndefined(); return result.limits!;
    };
    expect((await run('six', 6, 'avg')).d).toBe(1);
    expect(mocks.evaluate).toHaveBeenCalledTimes(30);
    expect((await run('forty-eight', 48, 'avg')).d).toBe(1);
    expect(mocks.evaluate).toHaveBeenCalledTimes(30);
    expect((await run('named', 24, 'avg')).d).toBe(.25);
    expect((await run('named2', 24, 'avg2')).d).toBe(.75);
    const count = mocks.evaluate.mock.calls.length;
    await run('named-again', 24, 'avg');
    expect(mocks.evaluate).toHaveBeenCalledTimes(count);
    vi.unstubAllGlobals();
  });
});
