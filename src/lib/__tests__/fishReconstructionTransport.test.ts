import { beforeEach, expect, it, vi } from 'vitest';
import { CBI2_DEF } from '@/lib/deepDig/features';
import { compileFishProgram } from '@/lib/fish/algorithm';
import { FishAdapter, type FishDataAdapter, type FishBarQuery } from '@/lib/fish/adapters';
import { createFishReconstructionLoader } from '@/lib/fish/reconstructionLoader';
import { FishError } from '@/lib/fish/shared';
import type { FishExchange, FishMarket } from '@/lib/fish/exchanges';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { ResearchBar } from '@/lib/deepRsa/window';

const cut = Date.UTC(2026, 9, 19), step = 300000, day = 86400000;
const signal = new AbortController().signal;
const plan = compileFishProgram({ ...CBI2_DEF, id: 'reconstruction-transport', formula: 'avg_X = B', scale: 1 }, { direction: '>', threshold: 1, constraints: [] });
const pricePlan = compileFishProgram({ ...CBI2_DEF, id: 'reconstruction-price', formula: 'avg_X = C', scale: 1 }, { direction: '>', threshold: 1, constraints: [] });
const row = (exchange: FishExchange = 'binance', timeMs = cut): TradeSignal => ({ id: 'test', symbol: 'AAAUSDT', exchange, timeMs, timeLabel: '', fallbackZone: '' });
const market: FishMarket = { symbol: 'AAAUSDT', instrument: 'AAAUSDT', base: 'AAA', multiplier: 1 };
const bars = (from: number, end: number): ResearchBar[] => Array.from({ length: (end - from) / step }, (_, i) => ({ openTime: from + i * step, open: 2, close: 2, high: 3, low: 1, volume: 1, quoteVolume: 2, takerBuyVolume: 1, takerBuyQuoteVolume: 2 }));
function adapter(exchange: FishExchange = 'binance'): FishDataAdapter {
  return { exchange, list: vi.fn(async () => [market]), btc: vi.fn(() => ({ ...market, symbol: 'BTCUSDT', instrument: 'BTC-USDT-SWAP', base: 'BTC' })),
    candles: vi.fn(async (_m, end, _s, q) => bars(end - q!.count * step, end)), taker: vi.fn(async (_m, data) => data) };
}
const loader = (a: FishDataAdapter, clock = vi.fn(async () => cut + day)) => createFishReconstructionLoader(new Map([[a.exchange, a]]), clock);
beforeEach(() => localStorage.clear());

it('invalid or post-signal bounds fail before clock, metadata or candle requests', async () => {
  const a = adapter(), clock = vi.fn(async () => cut), load = loader(a, clock);
  await expect(load(row(), cut - step, cut + step, plan, signal)).rejects.toMatchObject({ kind: 'readings' });
  await expect(load(row(), cut - step + 1, cut, plan, signal)).rejects.toMatchObject({ kind: 'readings' });
  expect(clock).not.toHaveBeenCalled(); expect(a.candles).not.toHaveBeenCalled();
});

it('filters unsolicited future candles before taker work and future taker output before returning', async () => {
  const a = adapter(), past = bars(cut - 3 * step, cut), future = { ...past[0], openTime: cut, close: NaN, quoteVolume: NaN };
  vi.mocked(a.candles).mockResolvedValue([...past, future]);
  vi.mocked(a.taker).mockImplementation(async (_m, input) => { expect(input).toEqual(past); return [...input, { ...future, openTime: cut + step }]; });
  const clock = vi.fn(async () => cut), load = loader(a, clock);
  expect(await load(row(), cut - 3 * step, cut, plan, signal)).toEqual(past);
  future.close = -100000;
  expect(await load(row(), cut - 3 * step, cut, plan, signal)).toEqual(past);
  expect(clock).toHaveBeenCalledTimes(1);
  expect(a.candles).toHaveBeenCalledWith(market, cut, signal, { interval: '5m', count: 3, beforeCutoff: true });
});

it('Binance pagination excludes future rows before parsing and overlapping windows reuse adapter cache', async () => {
  const requested: [number, number][] = [];
  const request = vi.fn(async (path: string) => {
    const q = new URL('https://example.test/' + path).searchParams, start = Number(q.get('startTime')), end = Number(q.get('endTime'));
    requested.push([start, end]);
    const valid = bars(start, end + 1).map(b => [b.openTime, '2', '3', '1', '2', '1', b.openTime + step - 1, '2', 1, '1', '2']);
    // A poisoned future row must neither enter evaluation nor turn this sample into a parse failure.
    return [...valid, [cut + 5 * step, 'invalid']];
  });
  const a = new FishAdapter('binance', request), load = loader(a);
  const from = cut - 1100 * step;
  expect(await load(row(), from, cut, plan, signal)).toHaveLength(1100);
  const calls = request.mock.calls.length;
  expect(await load(row('binance', cut + 2 * step), from + 2 * step, cut + 2 * step, plan, signal)).toHaveLength(1100);
  expect(request.mock.calls.length).toBe(calls + 1);
  expect(requested.slice(0, calls).every(([, end]) => end < cut)).toBe(true);
  expect(requested.at(-1)).toEqual([cut, cut + 2 * step - 1]);
  expect(new Set(requested.flatMap(([start, end]) => Array.from({ length: (end + 1 - start) / step }, (_, i) => start + i * step))).size).toBe(1102);
});

it.each(['okx', 'bitget', 'gate'] as const)('%s reconstruction excludes malformed future candles and trades with bounded historical parameters', async exchange => {
  const from = cut - step, paths: string[] = [];
  const request = vi.fn(async (path: string) => {
    paths.push(path);
    const candle = path.startsWith('market/history-candles') || path.startsWith('history-candles') || path.startsWith('candlesticks');
    const rows = candle
      ? exchange === 'gate' ? [{ t: from / 1000, o: '2', h: '3', l: '1', c: '2', v: '1', sum: '2' }, { t: (cut + step) / 1000, o: 'bad' }]
        : [[String(from), '2', '3', '1', '2', '1', '2', '2', '1'], [String(cut + step), 'bad', 'bad', 'bad', 'bad', 'bad', 'bad', 'bad', '1']]
      : exchange === 'gate' ? [{ id: '10', create_time: (cut - 1) / 1000, size: '1', price: '2' }, { id: 'bad', create_time: (cut + 1) / 1000 }]
        : exchange === 'okx' ? [{ tradeId: '10', ts: String(cut - 1), side: 'buy', sz: '1', px: '2' }, { tradeId: 'bad', ts: String(cut + 1) }]
        : [{ tradeId: '10', ts: String(cut - 1), side: 'buy', size: '1', price: '2' }, { tradeId: 'bad', ts: String(cut + 1) }];
    // OKX needs an empty second page to terminate its descending ID cursor.
    if (exchange === 'okx' && path.includes('type=1')) return { code: '0', data: [] };
    return exchange === 'gate' ? rows : { code: exchange === 'okx' ? '0' : '00000', data: rows };
  });
  const a = new FishAdapter(exchange, request), query: FishBarQuery = { interval: '5m', count: 1, beforeCutoff: true };
  const raw = await a.candles(market, cut, signal, query), out = await a.taker(market, raw, signal, query);
  expect(out).toHaveLength(1); expect(out[0]).toMatchObject({ openTime: from, quoteVolume: 2, takerBuyQuoteVolume: 2 });
  for (const path of paths) {
    const q = new URL('https://example.test/' + path).searchParams;
    if (q.has('endTime')) expect(Number(q.get('endTime'))).toBeLessThanOrEqual(cut);
    if (q.has('to')) expect(Number(q.get('to')) * 1000).toBeLessThanOrEqual(cut);
    if (q.has('after') && q.get('type') !== '1') expect(Number(q.get('after'))).toBeLessThanOrEqual(cut);
  }
  if (exchange === 'bitget') expect(paths.find(p => p.startsWith('fills-history'))).toContain(`endTime=${cut - 1}`);
  // The opt-in does not silently change ordinary fishing's malformed-row handling.
  await expect(new FishAdapter(exchange, request).candles(market, cut, signal, { interval: '5m', count: 1 })).rejects.toMatchObject({ kind: 'readings' });
});

it('Gate uses the exact second cutoff: the final fractional second is historical, not an inclusive future second bucket', async () => {
  // Verified against the public endpoint: from=to=S returned no trades; to=S+1
  // included trades at S+.426 and S+.717. Subtracting a second would lose those fills.
  const source = [
    { id: '20', create_time: (cut - 0.5) / 1000, size: '1', price: '2' },
    { id: '21', create_time: (cut + 0.5) / 1000, size: '100', price: '9000' },
  ];
  const returned: typeof source = [];
  const request = vi.fn(async (path: string) => {
    const q = new URL('https://example.test/' + path).searchParams;
    const end = Number(q.get('to'));
    expect(end).toBe(cut / 1000);
    const selected = source.filter(t => t.create_time >= Number(q.get('from')) && t.create_time < end);
    returned.push(...selected);
    return selected;
  });
  const a = new FishAdapter('gate', request);
  const input = bars(cut - step, cut).map(({ takerBuyQuoteVolume: _, ...b }) => b);
  const out = await a.taker(market, input, signal, { interval: '5m', count: 1, beforeCutoff: true });
  expect(returned.map(t => t.id)).toEqual(['20']);
  expect(out[0].takerBuyQuoteVolume).toBe(2);
  expect(source.filter(t => t.create_time < cut / 1000 - 1)).toHaveLength(0);
});

it('retention covers all requested lookback and uses one fresh clock per reconstruction run', async () => {
  const a = adapter('bitget'), oldCut = cut - 89 * day, from = oldCut - 3 * day;
  const clock = vi.fn(async () => cut), load = loader(a, clock);
  await expect(load(row('bitget', oldCut), from, oldCut, plan, signal)).rejects.toMatchObject({ kind: 'skipped' });
  expect(a.list).not.toHaveBeenCalled(); expect(a.candles).not.toHaveBeenCalled();
  await expect(load(row('bitget', oldCut), from, oldCut, plan, signal)).rejects.toMatchObject({ kind: 'skipped' });
  expect(clock).toHaveBeenCalledTimes(1);
  await expect(loader(a, clock)(row('bitget', oldCut), from, oldCut, plan, signal)).rejects.toMatchObject({ kind: 'skipped' });
  expect(clock).toHaveBeenCalledTimes(2);
});

it('stock identity comes from market metadata and CB uses BTC perpetual from that same venue', async () => {
  const a = adapter('bitget'), crypto = { ...market, instrument: 'CRYPTO' }, stock = { ...market, instrument: 'STOCK', market: 'us_stock' as const, underlying: 'AAA' };
  vi.mocked(a.list).mockResolvedValue([crypto, stock]);
  const btcPlan = compileFishProgram({ ...CBI2_DEF, id: 'reconstruction-cb', formula: 'avg_X = CB', scale: 1 }, { direction: '>', threshold: 1, constraints: [] });
  const load = loader(a), out = await load({ ...row('bitget'), market: 'us_stock', underlying: 'AAA' }, cut - step, cut, btcPlan, signal);
  expect(vi.mocked(a.candles).mock.calls.map(c => c[0].instrument)).toEqual(['STOCK', 'BTC-USDT-SWAP']);
  expect(out[0].refClose).toBe(2); expect(a.list).toHaveBeenCalledTimes(1);
  vi.mocked(a.btc).mockImplementation(() => { throw new FishError('BTC永续合约不存在', 'gap'); });
  await expect(load({ ...row('bitget'), market: 'us_stock' }, cut - step, cut, btcPlan, signal)).rejects.toMatchObject({ kind: 'gap' });
});

it('history, interior gaps, missing amounts and request failures retain distinct reasons', async () => {
  const a = adapter(), load = loader(a), from = cut - 3 * step;
  vi.mocked(a.candles).mockResolvedValue(bars(from + step, cut));
  await expect(load(row(), from, cut, pricePlan, signal)).rejects.toMatchObject({ kind: 'history' });
  vi.mocked(a.candles).mockResolvedValue(bars(from, cut).filter((_, i) => i !== 1));
  await expect(load(row(), from, cut, pricePlan, signal)).rejects.toMatchObject({ kind: 'gap' });
  vi.mocked(a.candles).mockResolvedValue(bars(from, cut).map(b => ({ ...b, takerBuyQuoteVolume: undefined })));
  await expect(load(row(), from, cut, plan, signal)).rejects.toMatchObject({ kind: 'readings' });
  vi.mocked(a.candles).mockRejectedValue(new FishError('HTTP 503', 'failed'));
  await expect(load(row(), from, cut, plan, signal)).rejects.toMatchObject({ kind: 'failed' });
});

it('HTTP 418 blocks subsequent requests to that venue for this run while other venues continue', async () => {
  const blocked = adapter(), healthy = adapter('okx');
  vi.mocked(blocked.candles).mockRejectedValue(new FishError('HTTP 418', 'banned'));
  const clock = vi.fn(async () => cut);
  const load = createFishReconstructionLoader(new Map([['binance', blocked], ['okx', healthy]]), clock);
  await expect(load(row(), cut - step, cut, pricePlan, signal)).rejects.toMatchObject({ kind: 'banned' });
  await expect(load({ ...row(), symbol: 'BBBUSDT' }, cut - step, cut, pricePlan, signal)).rejects.toMatchObject({ kind: 'banned' });
  expect(blocked.candles).toHaveBeenCalledTimes(1);
  expect(await load(row('okx'), cut - step, cut, pricePlan, signal)).toHaveLength(1);
  expect(healthy.candles).toHaveBeenCalledTimes(1); expect(clock).toHaveBeenCalledTimes(1);
  // A new explicit run owns a fresh circuit breaker; cancellation always wins over the cached error.
  await expect(loader(blocked)(row(), cut - step, cut, pricePlan, signal)).rejects.toMatchObject({ kind: 'banned' });
  expect(blocked.candles).toHaveBeenCalledTimes(2);
  const cancelled = new AbortController(); cancelled.abort();
  await expect(load(row(), cut - step, cut, pricePlan, cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
