import { dbl5PriceTicks, dbl5TickRule } from '@/lib/dbl5m';
import { DBL5_TICK_CHANGES } from '@/lib/dbl5mMarketRules';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { FishReconstructionLoader } from './reconstruction';

export const BOX_MARKET_REPAIR_VERSION = 'holding-dbl5-binance-trade-grid-v1' as const;
export const BULLA_BOX_MARKET_REPAIR_VERSION = 'holding-dbl5-binance-trade-grid-v2' as const;
export const HISTORICAL_BOX_MARKET_REPAIR_VERSION = 'holding-dbl5-binance-trade-grid-v3' as const;
export type BoxMarketRepairVersion = typeof BOX_MARKET_REPAIR_VERSION | typeof BULLA_BOX_MARKET_REPAIR_VERSION | typeof HISTORICAL_BOX_MARKET_REPAIR_VERSION;
export const BOX_STOP_INVALID_DATA = '箱体硬止损行情或报价精度无效，不能跳过缺口';

export const BOX_ADDITION_INVALID_DATA = '箱体加仓行情或历史报价精度无效，不能作为加仓依据';

const rules = {
  RAVEUSDT: { ...DBL5_TICK_CHANGES[0], version: BOX_MARKET_REPAIR_VERSION },
  // Binance continues to match outstanding orders on the original grid.
  // https://www.binance.com/en/square/post/355516476087650
  AKEUSDT: { effectiveAt: Date.UTC(2026, 7, 15, 6), before: '0.0000001', after: '0.000001', version: BOX_MARKET_REPAIR_VERSION },
  // https://www.binance.com/en/support/announcement/detail/2b19feada63c4f97b05322298f4121cb
  BULLAUSDT: { before: '0.000001', after: '0.00001', version: BULLA_BOX_MARKET_REPAIR_VERSION },
  // https://www.binance.com/en/support/announcement/detail/82a93632adbd4d0cb42bbf24c9b35400
  ONUSDT: { effectiveAt: Date.UTC(2026, 7, 15, 6), before: '0.00001', after: '0.0001', version: HISTORICAL_BOX_MARKET_REPAIR_VERSION },
  // https://www.binance.com/en/support/announcement/detail/3d7ade5e0521477cbe75ca92a913c211
  币安人生USDT: { effectiveAt: Date.UTC(2026, 5, 10, 6, 30), before: '0.00001', after: '0.0001', version: HISTORICAL_BOX_MARKET_REPAIR_VERSION },
  // https://www.binance.com/en/support/announcement/detail/a1e0bd9e7e124105ad10fdcfa923ce42
  SOONUSDT: { effectiveAt: Date.UTC(2025, 9, 10, 7), before: '0.00001', after: '0.0001', version: HISTORICAL_BOX_MARKET_REPAIR_VERSION },
} as const;

// The USD-M native candle highs match these individual FIL executions. The timestamp
// keeps a confirmed price from being reused as an exception in an unrelated candle.
// https://data.binance.vision/data/futures/um/daily/aggTrades/FILUSDT/FILUSDT-aggTrades-2026-08-31.zip
// https://data.binance.vision/data/futures/um/daily/aggTrades/FILUSDT/FILUSDT-aggTrades-2026-09-01.zip
const filTrades = [
  { at: 1788220488395, price: '0.682248' }, // aggTrade 358487331
  { at: 1788224714787, price: '0.689927' }, // 358491368
  { at: 1788271325092, price: '0.703675' }, // 358548976
  { at: 1788281351176, price: '0.723155' }, // 358572051
  { at: 1788286048762, price: '0.781515' }, // 358623632
  { at: 1788291612345, price: '0.798371' }, // 358674563
];
function filExecutionBar(bar: ResearchBar, step: number, orderTick: string): ResearchBar {
  if (orderTick !== '0.0001' || !bar.DBL5_prices) return bar;
  try {
    for (const [field, price] of Object.entries(bar.DBL5_prices)) {
      const verifiedHigh = field === 'high' && filTrades.some(trade =>
        bar.openTime <= trade.at && trade.at < bar.openTime + step && dbl5TickRule(price) === trade.price);
      if (!verifiedHigh) dbl5PriceTicks(price, orderTick);
    }
  } catch {
    // Let the reader reject this candle when its timestamp is reached, even in a prefetched batch.
    return bar;
  }
  // Keep one integer representation across checkpoints. Orders still use the venue tick.
  return { ...bar, DBL5_tick_size: '0.000001', DBL5_order_tick_size: orderTick };
}

export function qualityBoxMarketRepair(load: FishReconstructionLoader, symbol: string) {
  const rule = Object.prototype.hasOwnProperty.call(rules, symbol) ? rules[symbol as keyof typeof rules] : undefined;
  if (!rule && symbol !== 'FILUSDT') return;
  const repaired: FishReconstructionLoader = async (row, from, cut, plan, signal) => {
    const bars = await load(row, from, cut, plan, signal);
    if (row.symbol !== symbol || (row.exchange ?? 'binance') !== 'binance' || row.market === 'us_stock' || !plan.compiled.usesDbl5) return bars;
    return bars.map(bar => {
      const tick = bar.DBL5_tick_size ?? bar.PRS6H_tick_size ?? bar.ATI6H_tick_size;
      if (!bar.DBL5_prices || bar.PRS6H_data_source !== 'binance-usdm' || tick == null) return bar;
      const grid = dbl5TickRule(tick);
      if (!rule) return filExecutionBar(bar, plan.step, grid);
      if (grid !== rule.after && grid !== rule.before) return bar;
      if (rule.version === HISTORICAL_BOX_MARKET_REPAIR_VERSION) {
        const orderTick = bar.openTime < rule.effectiveAt ? rule.before : rule.after;
        // Only accept the finer historical grid for candles preceding the change.
        try {
          for (const price of Object.values(bar.DBL5_prices)) dbl5PriceTicks(price, orderTick);
        } catch {
          return { ...bar, DBL5_tick_size: orderTick };
        }
        return { ...bar, DBL5_tick_size: rule.before, DBL5_order_tick_size: orderTick };
      }
      // Original repair versions allow both announced grids for outstanding orders.
      return { ...bar, DBL5_tick_size: rule.before };
    });
  };
  const scoped: FishReconstructionLoader = (...args) => load(...args);
  scoped.turingInitialization = load.turingInitialization;
  scoped.boxStopMarketLoad = repaired;
  const version = rule?.version ?? HISTORICAL_BOX_MARKET_REPAIR_VERSION;
  if (version === HISTORICAL_BOX_MARKET_REPAIR_VERSION) scoped.boxAdditionMarketLoad = repaired;
  return { load: scoped, version };
}
