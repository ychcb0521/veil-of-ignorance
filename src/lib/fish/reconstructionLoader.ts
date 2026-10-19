import { intervalOf } from '@/lib/deepDig/features';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { FishDataAdapter } from './adapters';
import { EXCHANGE_NAMES, type FishExchange, type FishMarket } from './exchanges';
import type { FishReconstructionLoader } from './reconstruction';
import { fishRetentionReason } from './retention';
import { FishError, validateFishBars } from './shared';

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
    // Retention is relative to a freshly sampled clock, including when all signals are historical.
    clock ??= serverClock(signal);
    const now = await clock;
    if (!Number.isFinite(now) || now <= 0) throw new FishError('币安服务器时间无效', 'failed');
    if (cut > Math.floor(now / plan.step) * plan.step) throw new FishError('该信号时刻尚未全部收盘', 'readings');
    const exchange = row.exchange ?? 'binance';
    const adapter = adapters.get(exchange);
    if (!adapter) throw new FishError(`不支持的交易所 ${exchange}`, 'history');
    const query = { interval: intervalOf(plan.def), count, beforeCutoff: true };
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
    const blocked = banned.get(exchange);
    if (blocked) throw blocked;
    try { return await fetchWindow(...args); }
    catch (error) {
      if (error instanceof FishError && error.kind === 'banned') banned.set(exchange, error);
      throw error;
    }
  };
}
