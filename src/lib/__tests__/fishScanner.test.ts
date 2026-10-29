import {compileFishProgram} from '@/lib/fish/algorithm';
import {CBI2_DEF} from '@/lib/deepDig/features';
const DEFAULT_N=compileFishProgram(CBI2_DEF,{H:24,direction:'>',threshold:.3,constraints:[]}).N;
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BINANCE_COOLDOWN_KEY } from '@/lib/binanceRateLimit';
beforeEach(()=>localStorage.removeItem(BINANCE_COOLDOWN_KEY));
import { parseFishSettings, FishScanner, FishWeightBudget, calculateFishReadings, classifyFishReadings, FISH_STEP, FISH_FIRST_USABLE, type FishProgress } from '@/lib/fishScanner';
import { computeCbi2 } from '@/lib/cbi2';
import { CBI2_FORMULA, compileFeatureFormula, evaluateOnBars } from '@/lib/deepDig/features';
import type { ResearchBar } from '@/lib/deepRsa/window';
import { mulberry32 } from '@/lib/deepRsa/grouping';
import { mergeSignals, type TradeSignal } from '@/lib/signalLibrary';

function research(n: number): ResearchBar[] {
  const rand = mulberry32(123); let price = 100, btc = 50000;
  return Array.from({ length: n }, (_, i) => {
    const open = price; price *= Math.exp((rand() - 0.48) * 0.01);
    btc *= Math.exp((rand() - 0.5) * 0.004);
    const q = 10000 * (0.2 + rand());
    return { openTime: i * FISH_STEP, open, high: Math.max(open, price) * (1 + 0.002 * rand()), low: Math.min(open, price) * (1 - 0.002 * rand()), close: price, volume: q / price, quoteVolume: q, takerBuyQuoteVolume: q * (0.1 + 0.8 * rand()), takerBuyVolume: null, refClose: btc };
  });
}
const cut = 10000 * FISH_STEP;
const bar = (openTime: number): ResearchBar => ({ openTime, open: 100, high: 102, low: 98, close: 101, volume: 100, quoteVolume: 10000, takerBuyQuoteVolume: 6000, takerBuyVolume: null });
const window = (cutoff = cut) => Array.from({ length: 2000 }, (_, i) => bar(cutoff - (2000 - i) * FISH_STEP));
const values = (b: readonly ResearchBar[]) => ({ cbi2: Float64Array.from(b, () => 0.5), average: Float64Array.from(b, x => x.openTime + FISH_STEP >= cut - 20 * FISH_STEP ? 0.31 : 0.2) });
const contract = (symbol: string, extra = {}) => ({ symbol, contractType: 'PERPETUAL', quoteAsset: 'USDT', status: 'TRADING', ...extra });
function market(symbols = ['BTCUSDT','AAAUSDT','BBBUSDT']) {
  let cutoff = cut;
  const calls: URL[] = []; let active = 0, max = 0;
  let missingBtc = false, missing = '', fail = '', banned = '', forming = false;
  const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    const u = new URL(String(url)); calls.push(u);
    if (options?.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.pathname.endsWith('/time')) return response({ serverTime: cutoff + 123456 });
    if (u.pathname.endsWith('/exchangeInfo')) return response({ symbols: [...symbols.map(s => contract(s)), contract('IGNOREUSDC', { quoteAsset: 'USDC' }), contract('IGNORE_QUARTER', { contractType: 'CURRENT_QUARTER' }), contract('IGNORE_CLOSED', { status: 'SETTLING' })] });
    const symbol = u.searchParams.get('symbol')!;
    active++; max = Math.max(max, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    if (symbol === banned) return response({}, 418);
    if (symbol === fail) return response({}, 500);
    const start = Number(u.searchParams.get('startTime')), end = Number(u.searchParams.get('endTime'));
    const rows = [];
    for (let t = start; t <= end; t += FISH_STEP) {
      if ((symbol === 'BTCUSDT' && missingBtc || symbol === missing) && t === cut - 5 * FISH_STEP) continue;
      rows.push([t,100,102,98,101,100,t + FISH_STEP - 1,10000,12,60,6000,0]);
    }
    if (forming && end + 1 === cutoff) rows.push([cutoff,100,102,98,101,100,cutoff+FISH_STEP-1,10000,12,60,6000,0]);
    return response(rows);
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls, max: () => max, next: (n = 1) => { cutoff += n * FISH_STEP; }, missingBtc: () => { missingBtc = true; }, missing: (s: string) => { missing = s; }, fail: (s: string) => { fail = s; }, ban: (s: string) => { banned = s; }, forming: () => { forming = true; } };
}
const options = (found: TradeSignal[] = [], signal = new AbortController().signal) => ({ signal, onProgress: (_: FishProgress) => {}, onSignal: (s: TradeSignal) => found.push(s) });

describe('渔的CBI-2口径', { timeout: 60000 }, () => {
  it('A与evaluateOnBars和computeCbi2逐位一致；1455与3000根最终读数差小于1e-9', () => {
    const b = research(3000);
    const actual = calculateFishReadings(b);
    const expected = evaluateOnBars(b, compileFeatureFormula(`${CBI2_FORMULA}\nAfish = avg(CBI2, 24)`), { avgHours: 24, interval: '5m' }).last as Float64Array;
    const native = computeCbi2(b).map(p => p.cbi2);
    for (let i = FISH_FIRST_USABLE; i < b.length; i++) {
      expect(actual.average[i]).toBe(expected[i]);
      expect(actual.cbi2[i]).toBe(native[i]);
      const mean = native.slice(i - 287, i + 1).reduce<number>((sum, v) => sum + v!, 0) / 288;
      expect(Math.abs(actual.average[i] - mean)).toBeLessThan(1e-12);
    }
    const short = calculateFishReadings(b.slice(-1455));
    expect(Math.abs(short.average[1454] - actual.average[2999])).toBeLessThan(1e-9);
  });
  it('严格上穿才入库；截止后移时间不变；恰好0.3不命中、持续高位起点不明', () => {
    const b = window(); const r = values(b);
    const first = classifyFishReadings('AAAUSDT', b, r.cbi2, r.average, cut);
    expect(first.outcome).toBe('hit');
    expect(first.signal!.timeMs).toBe(cut - 20 * FISH_STEP);
    expect(first.signal!.id).toBe(`fish-AAAUSDT-${cut - 20 * FISH_STEP}`);
    expect(first.signal!.timeLabel).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    const later = window(cut + 3 * FISH_STEP), r2 = values(later);
    expect(classifyFishReadings('AAAUSDT', later, r2.cbi2, r2.average, cut + 3 * FISH_STEP).signal!.timeMs).toBe(first.signal!.timeMs);
    r.average[1999] = 0.3;
    expect(classifyFishReadings('AAAUSDT', b, r.cbi2, r.average, cut).outcome).toBe('below');
    r.average.fill(0.31);
    expect(classifyFishReadings('AAAUSDT', b, r.cbi2, r.average, cut).outcome).toBe('unknown');
    r.average.fill(0.2); r.average.fill(0.31,1454);
    expect(classifyFishReadings('AAAUSDT', b, r.cbi2, r.average, cut).outcome).toBe('unknown');
    r.average[1500] = NaN;
    expect(classifyFishReadings('AAAUSDT', b, r.cbi2, r.average, cut).outcome).toBe('readings');
  });
});

describe('渔扫描取数、缓存、并发和取消', { timeout: 30000 }, () => {
  it('原生fetch的接收者保持为全局对象，默认与注入的fetch都不会Illegal invocation', async () => {
    const m = market(['BTCUSDT']);
    const receivers: unknown[] = [];
    const browserFetch = function(this: unknown, ...args: Parameters<typeof fetch>) {
      receivers.push(this);
      if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      return m.fetcher(...args);
    };
    vi.stubGlobal('fetch', browserFetch);
    try {
      for (const request of [undefined, browserFetch]) {
        const result = await new FishScanner(request, undefined, values).scan(options());
        expect(result.error).toBeUndefined();
        expect(result.status).toBe('complete');
      }
      expect(receivers.length).toBeGreaterThan(0);
      expect(receivers.every(receiver => receiver === globalThis)).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
  it('范围一致、固定截止、BTC只取一次、排除未收盘根；再扫只补新增K线且不重复入库', async () => {
    const m = market(); m.forming(); const found: TradeSignal[] = [];
    const scanner = new FishScanner(m.fetcher, undefined, values);
    expect((await scanner.scan(options(found))).status).toBe('complete');
    let klines = m.calls.filter(u => u.pathname.endsWith('/klines'));
    expect(klines).toHaveLength(3*Math.ceil(DEFAULT_N/1000));
    expect(klines.filter(u => u.searchParams.get('symbol') === 'BTCUSDT')).toHaveLength(Math.ceil(DEFAULT_N/1000));
    expect(klines.every(u => u.searchParams.get('limit') === '1000')).toBe(true);
    expect(klines.every(u => Number(u.searchParams.get('endTime')) < cut)).toBe(true);
    const n = m.calls.length;
    await scanner.scan(options(found));
    expect(m.calls.slice(n).filter(u => u.pathname.endsWith('/klines'))).toHaveLength(0);
    m.next(); const before = m.calls.length;
    await scanner.scan(options(found));
    klines = m.calls.slice(before).filter(u => u.pathname.endsWith('/klines'));
    expect(klines).toHaveLength(3);
    expect(klines.every(u => Number(u.searchParams.get('startTime')) === cut && Number(u.searchParams.get('endTime')) === cut + FISH_STEP - 1)).toBe(true);
    expect(mergeSignals([], found)).toHaveLength(3);
  });
  it('BTC缺一根整次中止，未开始其他币；普通币缺根和请求失败分别计数', async () => {
    const m = market(); m.missingBtc();
    const result = await new FishScanner(m.fetcher, undefined, values).scan(options());
    expect(result.status).toBe('aborted'); expect(result.error).toContain('BTC');
    expect(m.calls.filter(u => u.pathname.endsWith('/klines')).every(u => u.searchParams.get('symbol') === 'BTCUSDT')).toBe(true);
    const ok = market(); ok.missing('AAAUSDT'); ok.fail('BBBUSDT');
    const summary = await new FishScanner(ok.fetcher, undefined, values).scan(options());
    expect(summary.counts.gap).toBe(1); expect(summary.counts.failed).toBe(1);
    expect(summary.done).toBe(3);
  });
  it('并发不超过3；HTTP418中止；取消后不再发送下一批', async () => {
    const m = market(['BTCUSDT', ...Array.from({ length: 8 }, (_, i) => `COIN${i}USDT`)]);
    const result = await new FishScanner(m.fetcher, undefined, values).scan(options());
    expect(result.done).toBe(9); expect(m.max()).toBeLessThanOrEqual(3);
    const blocked = market(['BTCUSDT','AAAUSDT','BBBUSDT','CCCUSDT','DDDUSDT']); blocked.ban('AAAUSDT');
    expect((await new FishScanner(blocked.fetcher, undefined, values).scan(options())).status).toBe('aborted');
    // The cancellation fixture is an independent simulated IP, after the banned fixture.
    localStorage.removeItem(BINANCE_COOLDOWN_KEY);
    const cancelled = market(); const controller = new AbortController();
    const p = options([], controller.signal);
    p.onProgress = (progress: FishProgress) => { if (progress.done >= 1) controller.abort(); };
    expect((await new FishScanner(cancelled.fetcher, undefined, values).scan(p)).status).toBe('cancelled');
  });
  it('rolling每分钟权重≤1200，并在再次扫描之间保留预算', async () => {
    let now = 0; const reservations: number[] = [];
    const budget = new FishWeightBudget(() => now, async ms => { now += ms; });
    const signal = new AbortController().signal;
    for (let i = 0; i < 700; i++) { await budget.take(5,signal); reservations.push(now); }
    for (const time of reservations) expect(reservations.filter(t => t <= time && t > time - 60000).length * 5).toBeLessThanOrEqual(1200);
    expect(reservations[240]).toBe(60000);
  });
});


describe('渔历史时间与可调标准', () => {
  it('明确按UTC+8解析，检查真实日期、阈值和空输入', () => {
    expect(parseFishSettings('2026-10-19 09:04:45', '0.2')).toEqual({ anchorMs: Date.UTC(2026,9,19,1,4,45), threshold: 0.2 });
    expect(parseFishSettings('2026-10-19T09:04', '0')).toEqual({ anchorMs: Date.UTC(2026,9,19,1,4), threshold: 0 });
    expect(parseFishSettings('', '0.3')).toEqual({ threshold: 0.3 });
    for (const time of ['2026-02-30 12:00', '2026-10-19 25:00', 'tomorrow']) expect(() => parseFishSettings(time, '0.2')).toThrow();
    for (const threshold of ['', 'NaN', 'Infinity']) expect(() => parseFishSettings('', threshold)).toThrow();
  });
  it('采用所设阈值确定本轮起点，等于标准不命中', () => {
    const b = window(), cbi2 = Float64Array.from(b, () => 0.5), a = Float64Array.from(b, (_, i) => i < 1900 ? 0.1 : i < 1950 ? 0.25 : 0.35);
    const low = classifyFishReadings('AAAUSDT', b, cbi2, a, cut, 0.2).signal!;
    const high = classifyFishReadings('AAAUSDT', b, cbi2, a, cut, 0.3).signal!;
    expect(low.timeMs).toBe(b[1900].openTime + FISH_STEP);
    expect(high.timeMs).toBe(b[1950].openTime + FISH_STEP);
    expect(low.fish!.threshold).toBe(0.2);
    a[1999] = 0.25;
    expect(classifyFishReadings('AAAUSDT', b, cbi2, a, cut, 0.2).outcome).toBe('hit');
    expect(classifyFishReadings('AAAUSDT', b, cbi2, a, cut, 0.3).outcome).toBe('below');
    a[1999] = 0.2;
    expect(classifyFishReadings('AAAUSDT', b, cbi2, a, cut, 0.2).outcome).toBe('below');
  });
  it('历史截点取整且无未来数据；向后移动缓存只补缺少根，改阈值不重取K线', async () => {
    const m = market(['BTCUSDT','AAAUSDT']);
    const inspected: ResearchBar[][] = [];
    const scanner = new FishScanner(m.fetcher, undefined, b => { inspected.push([...b]); return values(b); });
    await scanner.scan(options());
    const before = m.calls.length;
    const historical = cut - 3 * FISH_STEP;
    const found: TradeSignal[] = [];
    const p = { ...options(found), anchorMs: historical + 12345, threshold: 0.2 };
    const result = await scanner.scan(p);
    expect(result.status).toBe('complete');
    expect(result.cutoffMs).toBe(historical);
    expect(result.anchorMs).toBe(p.anchorMs);
    expect(result.threshold).toBe(0.2);
    expect(found.every(s => s.fish!.threshold === 0.2 && s.timeMs <= historical)).toBe(true);
    const recent = inspected.slice(-2);
    for (const bars of recent) {
      expect(bars).toHaveLength(DEFAULT_N);
      expect(bars[0].openTime).toBe(historical - DEFAULT_N * FISH_STEP);
      expect(bars.at(-1)!.openTime + FISH_STEP).toBe(historical);
      expect(bars.every(b => b.refClose === 101)).toBe(true);
    }
    const requests = m.calls.slice(before).filter(u => u.pathname.endsWith('/klines'));
    expect(requests).toHaveLength(2);
    expect(requests.every(u => Number(u.searchParams.get('endTime')) === cut - DEFAULT_N * FISH_STEP - 1)).toBe(true);
    const same = m.calls.length;
    await scanner.scan({ ...options(), anchorMs: p.anchorMs, threshold: 0.25 });
    expect(m.calls.slice(same).filter(u => u.pathname.endsWith('/klines'))).toHaveLength(0);
    const forward = m.calls.length;
    await scanner.scan(options());
    const added = m.calls.slice(forward).filter(u => u.pathname.endsWith('/klines'));
    expect(added).toHaveLength(0); // 同周期缓存保留已经取过的更晚K线，但历史计算不使用它们
  });
  it('本轮参数在任何回调之前锁定；拒绝未来时间和非法标准', async () => {
    const m = market(['BTCUSDT']);
    const scanner = new FishScanner(m.fetcher, undefined, values);
    const p = { ...options(), anchorMs: cut - 12345, threshold: 0.2 };
    p.onProgress = () => { p.anchorMs = cut + FISH_STEP; p.threshold = 0.8; };
    const result = await scanner.scan(p);
    expect(result.cutoffMs).toBe(cut - FISH_STEP);
    expect(result.threshold).toBe(0.2);
    const before = m.calls.length;
    const invalid = await scanner.scan({ ...options(), anchorMs: cut + FISH_STEP });
    expect(invalid.status).toBe('aborted');
    expect(invalid.error).toContain('不能晚于');
    expect(m.calls.slice(before).map(u => u.pathname)).toEqual(['/fapi/v1/time']);
    expect((await scanner.scan({ ...options(), threshold: NaN })).status).toBe('aborted');
  });
});
