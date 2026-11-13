import { dbl5TickRule } from '@/lib/dbl5m';
import { DBL5_TICK_CHANGES } from '@/lib/dbl5mMarketRules';
import type { FishReconstructionLoader } from './reconstruction';

export const BOX_MARKET_REPAIR_VERSION = 'holding-dbl5-binance-trade-grid-v1' as const;
export const BOX_STOP_INVALID_DATA = '箱体硬止损行情或报价精度无效，不能跳过缺口';

const rules = {
  RAVEUSDT: DBL5_TICK_CHANGES[0],
  // Binance continues to match outstanding orders on the original grid.
  // https://www.binance.com/en/square/post/355516476087650
  AKEUSDT: { effectiveAt: Date.UTC(2026, 7, 15, 6), before: '0.0000001', after: '0.000001' },
} as const;

export function qualityBoxMarketRepair(load: FishReconstructionLoader, symbol: string): FishReconstructionLoader | undefined {
  if (!Object.prototype.hasOwnProperty.call(rules, symbol)) return;
  const rule = rules[symbol as keyof typeof rules];
  const repaired: FishReconstructionLoader = async (row, from, cut, plan, signal) => {
    const bars = await load(row, from, cut, plan, signal);
    if (row.symbol !== symbol || (row.exchange ?? 'binance') !== 'binance' || row.market === 'us_stock' || !plan.compiled.usesDbl5) return bars;
    return bars.map(bar => {
      const tick = bar.DBL5_tick_size ?? bar.PRS6H_tick_size ?? bar.ATI6H_tick_size;
      if (!bar.DBL5_prices || bar.PRS6H_data_source !== 'binance-usdm' || tick == null) return bar;
      const grid = dbl5TickRule(tick);
      // Use one exact grid throughout this replay. Both announced tick sizes
      // are multiples of the finer grid, so mixed old/new executions fit it
      // without rounding or resetting the box at an order-rule change.
      return grid === rule.after || grid === rule.before ? { ...bar, DBL5_tick_size: rule.before } : bar;
    });
  };
  const scoped: FishReconstructionLoader = (...args) => load(...args);
  scoped.turingInitialization = load.turingInitialization;
  scoped.boxStopMarketLoad = repaired;
  return scoped;
}
