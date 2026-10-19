/** Manual CBI-2 scanner. No trading, scheduler, or mutable formula settings. */
import { CBI2_FORMULA, compileFeatureFormula, evaluateOnBars } from '@/lib/deepDig/features';
import { parseBinanceKlineRow, type ResearchBar } from '@/lib/deepRsa/window';
import type { TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';

export const FISH_STEP = 300_000;
export const FISH_BARS = 2000;
export const FISH_FIRST_USABLE = 1454;
export const FISH_THRESHOLD = 0.3;
export interface FishScanSettings { anchorMs?: number; threshold?: number; }
/** Explicit UTC+8 parsing; independent of the browser's local timezone. */
export function parseFishSettings(time: string, value: string): FishScanSettings {
  const threshold = value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) throw new Error('阈值请输入 -1 到 1 之间的数字');
  const input = time.trim();
  if (!input) return { threshold };
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/.exec(input);
  if (!match) throw new Error('时间请输入 YYYY-MM-DD HH:mm:ss（UTC+8）');
  const normalized = `${match[1]} ${match[2]}:${match[3] ?? '00'}`;
  const anchorMs = Date.parse(`${normalized.replace(' ', 'T')}+08:00`);
  if (!Number.isFinite(anchorMs) || anchorMs <= 0 || formatUTC8(anchorMs) !== normalized) throw new Error('捕捞时间无效，请检查日期和时间');
  return { anchorMs, threshold };
}
const formula = compileFeatureFormula(`${CBI2_FORMULA}\nfishAvg = avg(CBI2, 24)`);
export interface FishReading { average: number; cbi2: number; startAverage: number; previousAverage: number; cutoffMs: number; threshold: number; }
export type FishOutcome = 'hit' | 'below' | 'unknown' | 'gap' | 'readings' | 'failed';
export interface FishProgress {
  cutoffMs: number | null; anchorMs?: number | null; threshold?: number; total: number; done: number; current: string;
  counts: Record<FishOutcome, number>; status: 'running' | 'complete' | 'cancelled' | 'aborted'; error?: string;
}
export const initialFishProgress = (): FishProgress => ({ cutoffMs: null, anchorMs: null, threshold: FISH_THRESHOLD, total: 0, done: 0, current: '', counts: { hit: 0, below: 0, unknown: 0, gap: 0, readings: 0, failed: 0 }, status: 'running' });
export class FishError extends Error { constructor(message: string, readonly kind: 'gap' | 'readings' | 'failed' | 'banned') { super(message); } }
const check = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('已取消', 'AbortError'); };
export function fishDelay(ms: number, signal: AbortSignal): Promise<void> {
  check(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
/** Rolling 60s budget, serialized reservations; retained between scans. Includes failed HTTP requests. */
export class FishWeightBudget {
  private events: { at: number; weight: number }[] = [];
  private tail: Promise<void> = Promise.resolve();
  private cooldown = 0;
  constructor(private now = Date.now, private sleep = fishDelay) {}
  pauseUntil(time: number) { this.cooldown = Math.max(this.cooldown, time); }
  take(weight: number, signal: AbortSignal): Promise<void> {
    const run = this.tail.catch(() => {}).then(async () => {
      check(signal);
      for (;;) {
        const now = this.now();
        this.events = this.events.filter(e => now - e.at < 60_000);
        const used = this.events.reduce((sum, e) => sum + e.weight, 0);
        const wait = Math.max(this.cooldown - now, used + weight > 1200 ? this.events[0].at + 60_000 - now : 0);
        if (wait <= 0) { this.events.push({ at: now, weight }); return; }
        await this.sleep(wait, signal); check(signal);
      }
    });
    this.tail = run;
    return run;
  }
}
export function calculateFishReadings(bars: readonly ResearchBar[]): { cbi2: Float64Array; average: Float64Array } {
  const result = evaluateOnBars(bars, formula, { interval: '5m', avgHours: 24 });
  return { cbi2: result.vars.get('CBI2') as Float64Array, average: result.last as Float64Array };
}
/** Detect the start of the CURRENT uninterrupted > threshold episode, strictly after warm-up. */
export function classifyFishReadings(symbol: string, bars: readonly ResearchBar[], cbi2: ArrayLike<number>, average: ArrayLike<number>, cutoffMs: number, threshold = FISH_THRESHOLD): { outcome: FishOutcome; signal?: TradeSignal } {
  const last = bars.length - 1;
  if (last < FISH_FIRST_USABLE || average.length !== bars.length || cbi2.length !== bars.length) return { outcome: 'readings' };
  for (let i = FISH_FIRST_USABLE - 287; i <= last; i++) if (!Number.isFinite(cbi2[i])) return { outcome: 'readings' };
  for (let i = FISH_FIRST_USABLE; i <= last; i++) if (!Number.isFinite(average[i])) return { outcome: 'readings' };
  if (!(average[last] > threshold)) return { outcome: 'below' };
  let k = last;
  while (k > FISH_FIRST_USABLE && average[k - 1] > threshold) k--;
  if (k <= FISH_FIRST_USABLE) return { outcome: 'unknown' };
  const timeMs = bars[k].openTime + FISH_STEP;
  return { outcome: 'hit', signal: {
    id: `fish-${symbol}-${timeMs}`, symbol, timeMs, timeLabel: formatUTC8(timeMs), fallbackZone: '',
    fish: { average: average[last], cbi2: cbi2[last], startAverage: average[k], previousAverage: average[k - 1], cutoffMs, threshold },
  } };
}
export function validateFishBars(bars: readonly ResearchBar[], cutoffMs: number): void {
  if (bars.length !== FISH_BARS) throw new FishError('K线不足2000根', 'gap');
  for (let i = 0; i < bars.length; i++) if (bars[i].openTime !== cutoffMs - (FISH_BARS - i) * FISH_STEP) throw new FishError('K线有缺口或重复', 'gap');
}
export class FishScanner {
  private cache = new Map<string, { cutoffMs: number; bars: ResearchBar[] }>();
  private running = false;
  readonly budget: FishWeightBudget;
  constructor(private request: typeof fetch = fetch, budget = new FishWeightBudget(), private calculate = calculateFishReadings) { this.budget = budget; }
  private async json(path: string, weight: number, signal: AbortSignal): Promise<unknown> {
    await this.budget.take(weight, signal); check(signal);
    // Native browser fetch requires Window/Worker as receiver, never the scanner instance.
    const response = await this.request.call(globalThis, `https://fapi.binance.com/fapi/v1/${path}`, { signal });
    if (response.status === 418) throw new FishError('HTTP 418：币安已限制访问，整次扫描中止', 'banned');
    if (response.status === 429) {
      const retry = Number(response.headers.get('Retry-After') ?? 0);
      this.budget.pauseUntil(Date.now() + (Number.isFinite(retry) ? Math.max(60_000, retry * 1000) : 60_000));
    }
    if (!response.ok) throw new FishError(`HTTP ${response.status}`, 'failed');
    return response.json();
  }
  private async candles(symbol: string, cutoffMs: number, signal: AbortSignal): Promise<ResearchBar[]> {
    const cached = this.cache.get(symbol);
    const from = cutoffMs - FISH_BARS * FISH_STEP;
    // Reuse only the intersection, including when moving backwards in simulated time.
    const collected = cached ? cached.bars.filter(b => b.openTime >= from && b.openTime < cutoffMs) : [];
    const ranges = collected.length
      ? [[from, collected[0].openTime], [collected[collected.length - 1].openTime + FISH_STEP, cutoffMs]]
      : [[from, cutoffMs]];
    for (const [start, stop] of ranges) {
      let cursor = start;
      while (cursor < stop) {
        const end = Math.min(stop, cursor + 1000 * FISH_STEP);
        const query = new URLSearchParams({ symbol, interval: '5m', startTime: String(cursor), endTime: String(end - 1), limit: '1000' });
        const raw = await this.json(`klines?${query}`, 5, signal);
        if (!Array.isArray(raw)) throw new FishError('K线响应无效', 'failed');
        for (const row of raw) {
          const bar = parseBinanceKlineRow(row);
          if (!bar) throw new FishError('K线关键读数无效', 'readings');
          if (bar.openTime >= cursor && bar.openTime < end && bar.openTime + FISH_STEP <= cutoffMs) collected.push(bar);
        }
        cursor = end;
      }
    }
    check(signal);
    collected.sort((a,b) => a.openTime - b.openTime);
    validateFishBars(collected, cutoffMs);
    this.cache.set(symbol, { cutoffMs, bars: collected });
    return collected;
  }
  async scan(options: FishScanSettings & { signal: AbortSignal; onProgress: (progress: FishProgress) => void; onSignal: (signal: TradeSignal) => void }): Promise<FishProgress> {
    if (this.running) throw new Error('扫描正在进行');
    const { anchorMs, threshold = FISH_THRESHOLD } = options;
    this.running = true;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal.addEventListener('abort', cancel, { once: true });
    if (options.signal.aborted) cancel();
    const signal = controller.signal;
    const progress = initialFishProgress();
    const publish = () => options.onProgress({ ...progress, counts: { ...progress.counts } });
    let fatal: string | undefined;
    try {
      progress.threshold = threshold;
      if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) throw new Error('阈值请输入 -1 到 1 之间的数字');
      if (anchorMs !== undefined && (!Number.isFinite(anchorMs) || anchorMs <= 0)) throw new Error('捕捞时间无效');
      publish();
      const clock = await this.json('time', 1, signal) as { serverTime?: number };
      if (!Number.isFinite(clock.serverTime) || clock.serverTime! <= 0) throw new Error('服务器时间无效');
      if (anchorMs !== undefined && anchorMs > clock.serverTime!) throw new Error('捕捞时间不能晚于币安服务器当前时间');
      progress.anchorMs = anchorMs ?? clock.serverTime!;
      const cutoffMs = Math.floor(progress.anchorMs / FISH_STEP) * FISH_STEP;
      progress.cutoffMs = cutoffMs; publish();
      const info = await this.json('exchangeInfo', 1, signal) as { symbols?: { symbol: string; contractType: string; quoteAsset: string; status: string }[] };
      if (!Array.isArray(info.symbols)) throw new Error('交易标的列表无效');
      const symbols = [...new Set(info.symbols.filter(s => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING' && typeof s.symbol === 'string').map(s => s.symbol))].sort();
      progress.total = symbols.length; publish();
      let btc: ResearchBar[];
      try { btc = await this.candles('BTCUSDT', cutoffMs, signal); }
      catch (error) { if (signal.aborted) throw error; throw new Error(`BTC参考K线不完整或请求失败，整次扫描中止：${error instanceof Error ? error.message : error}`); }
      // BTC is validated before starting any symbol; join reference closes by openTime.
      const btcClose = new Map(btc.map(b => [b.openTime, b.close]));
      let next = 0;
      const worker = async () => {
        while (!signal.aborted) {
          const index = next++; if (index >= symbols.length) return;
          const symbol = symbols[index]; progress.current = symbol; publish();
          try {
            const source = symbol === 'BTCUSDT' ? btc : await this.candles(symbol, cutoffMs, signal);
            check(signal);
            const bars = source.map(b => ({ ...b, refClose: btcClose.get(b.openTime)! }));
            if (bars.some(b => b.quoteVolume == null || b.takerBuyQuoteVolume == null)) throw new FishError('成交额读数不全', 'readings');
            const readings = this.calculate(bars);
            const result = classifyFishReadings(symbol, bars, readings.cbi2, readings.average, cutoffMs, threshold);
            check(signal);
            progress.counts[result.outcome]++;
            if (result.signal) options.onSignal(result.signal);
          } catch (error) {
            if (error instanceof FishError && error.kind === 'banned') { fatal = error.message; controller.abort(); }
            else if (!signal.aborted) progress.counts[error instanceof FishError ? error.kind : 'failed']++;
          }
          if (signal.aborted) return;
          progress.done++; publish();
          await fishDelay(0, signal); // Let the browser paint and deliver cancellation between symbols.
        }
      };
      await Promise.allSettled(Array.from({ length: Math.min(3, symbols.length) }, worker));
      progress.status = fatal ? 'aborted' : signal.aborted ? 'cancelled' : 'complete';
      if (fatal) progress.error = fatal;
    } catch (error) {
      progress.status = options.signal.aborted ? 'cancelled' : 'aborted';
      if (!options.signal.aborted) progress.error = error instanceof Error ? error.message : String(error);
      controller.abort();
    } finally {
      options.signal.removeEventListener('abort', cancel); this.running = false;
      progress.current = ''; publish();
    }
    return { ...progress, counts: { ...progress.counts } };
  }
}
