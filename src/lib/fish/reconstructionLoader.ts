import { intervalOf } from '@/lib/deepDig/features';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { FishDataAdapter } from './adapters';
import { EXCHANGE_NAMES, type FishExchange, type FishMarket } from './exchanges';
import type { FishReconstructionLoader } from './reconstruction';
import { fishRetentionReason } from './retention';
import { FishError, validateFishBars } from './shared';
import { fetchResearchKlines } from '@/lib/deepRsa/marketData';
import { readTuringCupTickSize } from '@/lib/turingCupMarketData';
import { isTuringCupSymbol, turingCupSymbol } from '@/lib/turingCupSymbol';
import { loadTuringReplayArchive } from '@/lib/turingCupReplayArchive';
import { turingCupTicker } from '@/lib/turingCupSymbol';
import { formatUTC8 } from '@/lib/timeFormat';

const loadTuringWindow: FishReconstructionLoader = async (row, from, cut, plan, signal) => {
  const archive = await loadTuringReplayArchive();
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  const series = archive?.markets[turingCupTicker(row.symbol)];
  if (archive && series) {
    if (plan.compiled.usesBtc && !archive.markets.BTCUSDT) {
      throw new FishError('当前条件依赖 BTC，但图灵杯行情没有 BTCUSDT。请另选“无 BTC”版本；不会替换原版公式。', 'readings');
    }
    const first = series.findIndex(bar => bar !== null);
    const available = archive.anchorMs + first * 60_000;
    if (first >= 0 && from < available) throw new FishError(`图灵杯历史不足：此条件需要从 ${formatUTC8(from)} 开始的 K 线，现有行情始于 ${formatUTC8(available)}。可先运行买前监测，待预热后生成新的入场节点。`, 'history');
  }
  const interval = intervalOf(plan.def);
  const count = (cut - from) / plan.step;
  const read = (symbol: string) => fetchResearchKlines(symbol, from, cut, undefined, signal, interval, true);
  const bars = await read(row.symbol);
  validateFishBars(bars, cut, count, plan.step);
  if (bars.some(bar => (plan.compiled.usesAmounts && !Number.isFinite(bar.quoteVolume)) ||
      (plan.usesTaker && !Number.isFinite(bar.takerBuyQuoteVolume)))) {
    throw new FishError('图灵杯离线数据缺少本指标所需的成交额或主动买入额', 'readings');
  }
  const marketEvidence = plan.compiled.usesDbl5 || plan.compiled.usesSbs5m || plan.compiled.usesPrs6h || plan.compiled.usesAti6h;
  const tick = marketEvidence ? await readTuringCupTickSize(row.symbol, signal) : null;
  const btc = plan.compiled.usesBtc ? await read(turingCupSymbol('BTCUSDT')) : null;
  if (btc) validateFishBars(btc, cut, count, plan.step);
  return bars.map((bar, index) => ({
    ...bar,
    ...(marketEvidence ? {
      DBL5_tick_size: tick, SBS5M_tick_size: tick, ATI6H_tick_size: tick, PRS6H_tick_size: tick,
      ATI6H_quoteVolume: bar.quoteVolume, ATI6H_takerBuyQuoteVolume: bar.takerBuyQuoteVolume,
      PRS6H_symbol: row.symbol, PRS6H_data_source: 'turing-cup',
    } : {}),
    ...(btc ? { refClose: btc[index].close } : {}),
  }));
};

/** Per-run historical loader. It shares the scanner's adapters, candle cache and rate limits. */
export function createFishReconstructionLoader(
  adapters: ReadonlyMap<FishExchange, FishDataAdapter>,
  serverClock: (signal: AbortSignal) => Promise<number>,
): FishReconstructionLoader {
  let clock: Promise<number> | undefined;
  const lists = new Map<FishExchange, Promise<FishMarket[]>>();
  const fetchWindow: FishReconstructionLoader = async (row, from, cut, plan, signal) => {
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    const count = (cut - from) / plan.step;
    // Reject invalid caller bounds before making even a clock or metadata request.
    if (!Number.isFinite(row.timeMs) || !Number.isFinite(from) || from < 0 ||
        !Number.isInteger(count) || count <= 0 || from % plan.step !== 0 || cut % plan.step !== 0 ||
        cut > Math.floor(row.timeMs / plan.step) * plan.step) {
      throw new FishError('复原取数必须止于信号时刻之前已收盘的 K 线', 'readings');
    }
    if (isTuringCupSymbol(row.symbol)) return loadTuringWindow(row, from, cut, plan, signal);
    // Retention is relative to a freshly sampled clock, including when all signals are historical.
    clock ??= serverClock(signal);
    const now = await clock;
    if (!Number.isFinite(now) || now <= 0) throw new FishError('币安服务器时间无效', 'failed');
    if (cut > Math.floor(now / plan.step) * plan.step) throw new FishError('该信号时刻尚未全部收盘', 'readings');
    const exchange = row.exchange ?? 'binance';
    const adapter = adapters.get(exchange);
    if (!adapter) throw new FishError(`不支持的交易所 ${exchange}`, 'history');
    const query = { interval: intervalOf(plan.def), count, beforeCutoff: true,...((plan.compiled.usesDbl5||plan.compiled.usesSbs5m||plan.compiled.usesPrs6h||plan.compiled.usesAti6h)?{marketEvidence:true}:{}) };
    const retention = fishRetentionReason(exchange, cut, now, count, plan.step, plan.usesTaker, query.interval);
    if (retention) throw new FishError(`${EXCHANGE_NAMES[exchange]}：${retention}`, 'skipped');
    let market: FishMarket | undefined;
    if (exchange === 'binance' && row.market !== 'us_stock') {
      market = { symbol: row.symbol, instrument: row.symbol, base: row.symbol.replace(/USDT$/, ''), multiplier: 1 };
    } else {
      let list = lists.get(exchange);
      if (!list) { list = adapter.list(signal); lists.set(exchange, list); }
      const markets = await list;
      const code = (row.underlying || row.symbol.replace(/USDT$/, '')).toUpperCase();
      market = markets.find(m => m.symbol === row.symbol && (row.market === 'us_stock') === (m.market === 'us_stock'))
        ?? (row.market === 'us_stock' ? markets.find(m => m.market === 'us_stock' && (m.underlying || m.base).toUpperCase() === code) : undefined);
      if (!market) throw new FishError(`${EXCHANGE_NAMES[exchange]}现在没有 ${row.symbol} 这个合约`, 'history');
    }
    // Defend the evaluation boundary even against an injected/misbehaving adapter or a warm cache.
    const bounded = (bars: readonly ResearchBar[]) => bars.filter(b => b.openTime >= from && b.openTime + plan.step <= cut);
    const raw = bounded(await adapter.candles(market, cut, signal, query));
    validateFishBars(raw, cut, count, plan.step);
    const bars = plan.usesTaker ? bounded(await adapter.taker(market, raw, signal, query)) : raw;
    validateFishBars(bars, cut, count, plan.step);
    if (bars.some(b => plan.compiled.usesAmounts && (!Number.isFinite(b.quoteVolume) ||
        (plan.usesTaker && !Number.isFinite(b.takerBuyQuoteVolume))))) throw new FishError('成交额读数不全', 'readings');
    if (!plan.compiled.usesBtc) return bars;
    const btcMarket = exchange === 'binance'
      ? { symbol: 'BTCUSDT', instrument: 'BTCUSDT', base: 'BTC', multiplier: 1 }
      : adapter.btc();
    const btc = bounded(await adapter.candles(btcMarket, cut, signal, query));
    validateFishBars(btc, cut, count, plan.step);
    if (btc.some(b => !(b.close > 0) || !Number.isFinite(b.close))) throw new FishError('BTC参考收盘价无效', 'readings');
    const closes = new Map(btc.map(b => [b.openTime, b.close]));
    return bars.map(b => ({ ...b, refClose: closes.get(b.openTime)! }));
  };
  // As in fishing, a banned venue stops issuing requests for this run. Other venues still work.
  const banned = new Map<FishExchange, FishError>();
  return async (...args) => {
    const [row, , , , signal] = args, exchange = row.exchange ?? 'binance';
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    const blocked = isTuringCupSymbol(row.symbol) ? undefined : banned.get(exchange);
    if (blocked) throw blocked;
    try { return await fetchWindow(...args); }
    catch (error) {
      if (error instanceof FishError && error.kind === 'banned') banned.set(exchange, error);
      throw error;
    }
  };
}
